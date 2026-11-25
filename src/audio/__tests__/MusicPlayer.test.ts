import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../AudioEngine';
import { dbToGain } from '../duck';
import type { MusicCue } from '../MusicDirector';
import { MusicPlayer, type SongSource } from '../MusicPlayer';
import type { RenderedSong } from '../dsp/render';
import type { MusicId } from '../songs/format';
import { FakeAudioContext, makeFakeDom, type FakeAudioNode, type FakeDom } from './fakeAudio';

const SR = 44100;
let dom: FakeDom;

beforeEach(() => {
  FakeAudioContext.reset('running');
  dom = makeFakeDom();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', dom.navigator);
});

afterEach(() => vi.unstubAllGlobals());

/** A rendered song at 120 BPM (a bar is 2 s): a 1-bar intro and a 4-bar loop. */
function rendered(id: string, opts: { lift?: boolean; intro?: boolean; offset?: number } = {}): RenderedSong {
  const loop = 8 * SR;
  const intro = opts.intro === false ? 0 : 2 * SR;
  return {
    id,
    sampleRate: SR,
    bpm: 120,
    intro: intro ? [new Float32Array(intro + SR), new Float32Array(intro + SR)] : null,
    introSamples: intro,
    loopOffset: opts.offset ?? 0,
    loop: [new Float32Array(loop), new Float32Array(loop)],
    loopSamples: loop,
    lift: opts.lift === false ? null : new Float32Array(loop),
    introBars: intro ? 1 : 0,
    loopBars: 4,
    lufs: -14,
    truePeakDb: -1.5,
    gain: 1,
    renderMs: 100,
  };
}

/** A source that answers when the test says so. */
class Source implements SongSource {
  readonly asked: Array<{ id: MusicId; purpose: string; resolve: (s: RenderedSong | null) => void }> = [];
  request(id: MusicId, purpose: 'play' | 'prepare'): Promise<RenderedSong | null> {
    return new Promise((resolve) => this.asked.push({ id, purpose, resolve }));
  }
  /** Answer every request for `id`. */
  land(id: MusicId, song = rendered(id)): void {
    for (const a of this.asked.filter((x) => x.id === id)) a.resolve(song);
    this.asked.splice(0, this.asked.length, ...this.asked.filter((x) => x.id !== id));
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const cue = (over: Partial<MusicCue>): MusicCue => ({ song: 'neon-bay', key: 'neon-bay#0', fromIntro: true, lift: false, muffle: false, fadeOut: 0, fadeIn: 0.3, restart: true, changed: true, prepare: [], ...over });

async function setup(): Promise<{ engine: AudioEngine; player: MusicPlayer; src: Source; ac: FakeAudioContext }> {
  const engine = new AudioEngine(true);
  const src = new Source();
  const player = new MusicPlayer(engine, src);
  dom.fire('pointerdown');
  const ac = FakeAudioContext.instances[0];
  return { engine, player, src, ac };
}

/** Start `id` and let it land; returns the log lines written after the start. */
async function play(p: { player: MusicPlayer; src: Source; ac: FakeAudioContext }, c: Partial<MusicCue> = {}, song?: RenderedSong): Promise<void> {
  const full = cue(c);
  p.player.apply(full);
  await flush();
  p.src.land(full.song!, song);
  await flush();
  p.player.tick();
}

const nodesOf = (ac: FakeAudioContext, kind: string) => ac.nodes.filter((n) => n.kind === kind);
const lines = (ac: FakeAudioContext, re: RegExp) => ac.log.filter((l) => re.test(l));
const sources = (ac: FakeAudioContext) => nodesOf(ac, 'BufferSource').filter((n) => n.prop('buffer') !== null && (n.prop('buffer') as { name: string }).name !== 'buf1');

/**
 * Evaluates an AudioParam's automation from the fake's log, as the browser would: setValueAtTime, linear ramps,
 * setTargetAtTime and cancelScheduledValues. A "jump" is a setValueAtTime to a value other than the one the param
 * already has at that time.
 */
function jumps(ac: FakeAudioContext, nodeId: number, param: string): string[] {
  type Ev = { kind: 'set' | 'ramp' | 'target'; v: number; t: number; tau?: number };
  const evs: Ev[] = [];
  let initial = 1;
  const found: string[] = [];
  /** The level just before a cancel, for a set at the same time (the two act as one step). */
  let held: { t: number; v: number } | null = null;
  const valueAt = (t: number): number => {
    let v = initial;
    let tPrev = 0;
    let target: Ev | null = null;
    for (const e of evs) {
      if (e.t > t) {
        if (e.kind === 'ramp' && t > tPrev) return v + ((e.v - v) * (t - tPrev)) / (e.t - tPrev);
        break;
      }
      if (target) v = target.v + (v - target.v) * Math.exp(-(e.t - target.t) / target.tau!);
      target = null;
      if (e.kind === 'target') {
        target = e;
        tPrev = e.t;
        continue;
      }
      v = e.v;
      tPrev = e.t;
    }
    if (target) v = target.v + (v - target.v) * Math.exp(-(t - target.t) / target.tau!);
    return v;
  };
  const re = new RegExp(`^#${nodeId}\\.${param}(?: = (\\S+)|\\.(\\w+)\\(([^)]*)\\))$`);
  for (const line of ac.log) {
    const m = re.exec(line);
    if (!m) continue;
    if (m[1] !== undefined) {
      initial = Number(m[1]);
      continue;
    }
    const args = m[3].split(', ').map(Number);
    if (m[2] === 'cancelScheduledValues') {
      held = { t: args[0], v: valueAt(args[0]) };
      for (let i = evs.length - 1; i >= 0; i--) if (evs[i].t >= args[0]) evs.splice(i, 1);
      continue;
    } else if (m[2] === 'setValueAtTime') {
      const before = held && held.t === args[1] ? held.v : valueAt(args[1]);
      if (Math.abs(before - args[0]) > 1e-3) found.push(`${line} (was ${before.toFixed(4)})`);
      evs.push({ kind: 'set', v: args[0], t: args[1] });
    } else if (m[2] === 'linearRampToValueAtTime') evs.push({ kind: 'ramp', v: args[0], t: args[1] });
    else if (m[2] === 'setTargetAtTime') evs.push({ kind: 'target', v: args[0], t: args[1], tau: args[2] });
    held = null;
    evs.sort((a, b) => a.t - b.t);
  }
  return found;
}

describe('MusicPlayer (§M6b step 6)', () => {
  it('builds the song chain on the music bus: duck gain → pause low-pass → EQ dip at 1.5 kHz', async () => {
    const { engine, player, ac } = await setup();
    const chain = player.chain!;
    expect(chain).toBeTruthy();
    const duck = chain.duck as unknown as FakeAudioNode;
    const lp = chain.lowpass as unknown as FakeAudioNode;
    const eq = chain.eq as unknown as FakeAudioNode;
    expect([...duck.outputs]).toEqual([lp]);
    expect([...lp.outputs]).toEqual([eq]);
    expect([...eq.outputs]).toEqual([engine.music as unknown as FakeAudioNode]);
    expect(lp.prop('type')).toBe('lowpass');
    expect(eq.prop('type')).toBe('peaking');
    expect(eq.param('frequency').value).toBe(1500);
    expect(eq.param('gain').value).toBe(-4);
    expect(eq.param('Q').value).toBe(1);
    expect(ac).toBeTruthy();
  });

  it('starts the intro, then the loop and the lift together, sample-locked at the intro’s end', async () => {
    const p = await setup();
    p.ac.currentTime = 10;
    await play(p);
    const [intro, loop, lift] = sources(p.ac);
    expect(lines(p.ac, new RegExp(`^#${intro.id}\\.start`))).toEqual([`#${intro.id}.start(10.05)`]);
    expect(lines(p.ac, new RegExp(`^#${loop.id}\\.start`))).toEqual([`#${loop.id}.start(12.05)`]);
    expect(lines(p.ac, new RegExp(`^#${lift.id}\\.start`))).toEqual([`#${lift.id}.start(12.05)`]);
    expect(intro.prop('loop')).toBe(false);
    expect(loop.prop('loop')).toBe(true);
    expect(lift.prop('loop')).toBe(true);
    expect(p.player.debug().song).toBe('neon-bay');
  });

  it('when the intro runs on into the loop, the loop and the lift take over at that offset', async () => {
    const p = await setup();
    p.ac.currentTime = 10;
    await play(p, {}, rendered('neon-bay', { offset: SR / 2 }));
    const [, loop, lift] = sources(p.ac);
    expect(lines(p.ac, new RegExp(`^#${loop.id}\\.start`))).toEqual([`#${loop.id}.start(12.55, 0.5)`]);
    expect(lines(p.ac, new RegExp(`^#${lift.id}\\.start`))).toEqual([`#${lift.id}.start(12.55, 0.5)`]);
    // Bar lines still count from the loop's first bar (12.05): a lift at 12.3 comes in at 14.05.
    p.ac.currentTime = 12.3;
    p.player.apply(cue({ lift: true, restart: false }));
    const g = p.player.debugNodes().liftGain as unknown as FakeAudioNode;
    expect(lines(p.ac, new RegExp(`^#${g.id}\\.gain\\.linearRamp`))).toEqual([`#${g.id}.gain.linearRampToValueAtTime(1, 16.05)`]);
  });

  it('without the intro, the loop and the lift start together at once', async () => {
    const p = await setup();
    p.ac.currentTime = 3;
    await play(p, { fromIntro: false });
    const srcs = sources(p.ac);
    expect(srcs).toHaveLength(2);
    for (const s of srcs) expect(lines(p.ac, new RegExp(`^#${s.id}\\.start`))).toEqual([`#${s.id}.start(3.05)`]);
  });

  it('fades the song in over the cue’s fade-in', async () => {
    const p = await setup();
    p.ac.currentTime = 10;
    await play(p, { fadeIn: 0.3 });
    const g = p.player.debugNodes().songGain as unknown as FakeAudioNode;
    expect(lines(p.ac, new RegExp(`^#${g.id}\\.gain\\.`))).toEqual([`#${g.id}.gain.setValueAtTime(0, 10.05)`, `#${g.id}.gain.linearRampToValueAtTime(1, 10.35)`]);
  });

  it('brings the lift in over one bar from the next bar line', async () => {
    const p = await setup();
    p.ac.currentTime = 10;
    await play(p);
    const lift = p.player.debugNodes().liftGain as unknown as FakeAudioNode;
    // The loop started at 12.05; a bar is 2 s. At 15.2 the next bar line is 16.05.
    p.ac.currentTime = 15.2;
    p.player.apply(cue({ lift: true, restart: false, fadeIn: 0 }));
    const auto = lines(p.ac, new RegExp(`^#${lift.id}\\.gain\\.`));
    expect(auto.slice(-2)).toEqual([`#${lift.id}.gain.setValueAtTime(0, 16.05)`, `#${lift.id}.gain.linearRampToValueAtTime(1, 18.05)`]);
    expect(p.player.debug().lift).toBe(true);
    expect(jumps(p.ac, lift.id, 'gain')).toEqual([]);
  });

  it('a lift asked for during the intro comes in at the loop’s first bar', async () => {
    const p = await setup();
    p.ac.currentTime = 10;
    await play(p);
    const lift = p.player.debugNodes().liftGain as unknown as FakeAudioNode;
    p.ac.currentTime = 11;
    p.player.apply(cue({ lift: true, restart: false }));
    expect(lines(p.ac, new RegExp(`^#${lift.id}\\.gain\\.linearRamp`))).toEqual([`#${lift.id}.gain.linearRampToValueAtTime(1, 14.05)`]);
  });

  it('crossfades: both gains ramp, and the old sources stop and disconnect after the fade', async () => {
    const p = await setup();
    p.ac.currentTime = 10;
    await play(p);
    const old = p.player.debugNodes();
    const oldGain = old.songGain as unknown as FakeAudioNode;
    const oldSrcs = sources(p.ac);
    const nodesBefore = p.engine.nodeCount;
    p.ac.currentTime = 20;
    await play(p, { song: 'menu', key: 'menu', fadeOut: 1, fadeIn: 1 });
    expect(lines(p.ac, new RegExp(`^#${oldGain.id}\\.gain\\.`)).slice(-3)).toEqual([`#${oldGain.id}.gain.cancelScheduledValues(20)`, `#${oldGain.id}.gain.setValueAtTime(1, 20)`, `#${oldGain.id}.gain.linearRampToValueAtTime(0, 21)`]);
    for (const s of oldSrcs) expect(lines(p.ac, new RegExp(`^#${s.id}\\.stop`))).toEqual([`#${s.id}.stop(21.05)`]);
    const newGain = p.player.debugNodes().songGain as unknown as FakeAudioNode;
    expect(lines(p.ac, new RegExp(`^#${newGain.id}\\.gain\\.`))).toEqual([`#${newGain.id}.gain.setValueAtTime(0, 20.05)`, `#${newGain.id}.gain.linearRampToValueAtTime(1, 21.05)`]);
    for (const s of oldSrcs) s.fireEnded();
    expect(oldGain.outputs.size).toBe(0);
    for (const s of oldSrcs) expect(s.outputs.size).toBe(0);
    // The new song's nodes replaced the old song's.
    expect(p.engine.nodeCount).toBe(nodesBefore);
    expect(p.player.debug().song).toBe('menu');
  });

  it('a fade-out in the middle of a fade-in starts from where the fade-in had got to (no jump)', async () => {
    const p = await setup();
    p.ac.currentTime = 10;
    await play(p, { fadeIn: 2 });
    const g = p.player.debugNodes().songGain as unknown as FakeAudioNode;
    p.ac.currentTime = 11.05; // halfway through the 2 s fade-in
    p.player.apply(cue({ song: null, key: '', fadeOut: 1 }));
    expect(lines(p.ac, new RegExp(`^#${g.id}\\.gain\\.setValueAtTime\\(0\\.5`))).toHaveLength(1);
    expect(jumps(p.ac, g.id, 'gain')).toEqual([]);
  });

  it('ducks the songs: countdown −8, stinger −10, warning −4, pause −12 with a 1.2 kHz low-pass; the deepest wins', async () => {
    const p = await setup();
    p.ac.currentTime = 10;
    await play(p);
    const duck = p.player.chain!.duck as unknown as FakeAudioNode;
    const lp = p.player.chain!.lowpass as unknown as FakeAudioNode;
    const last = () => lines(p.ac, new RegExp(`^#${duck.id}\\.gain\\.setTargetAtTime`)).at(-1);
    const g = (db: number) => String(Number(dbToGain(db).toPrecision(10)));

    p.player.countdown(3);
    p.player.tick();
    expect(last()).toMatch(new RegExp(`setTargetAtTime\\(${g(-8)}, 10, `));
    expect(p.player.debug().duckDb).toBe(-8);

    p.player.warning(0.4);
    p.player.tick();
    expect(p.player.debug().duckDb).toBe(-8); // the deepest wins

    p.player.countdown(0); // GO: the countdown duck holds 0.6 s more
    p.ac.currentTime = 10.5;
    p.player.tick();
    expect(p.player.debug().duckDb).toBe(-8);
    p.ac.currentTime = 10.7;
    p.player.tick();
    expect(p.player.debug().duckDb).toBe(0);
    expect(last()).toMatch(/setTargetAtTime\(1, 10\.7, 0\.2\)/); // the countdown's release: 600 ms (τ = 0.2)

    p.player.warning(0.4);
    p.player.tick();
    expect(p.player.debug().duckDb).toBe(-4);
    expect(last()).toMatch(new RegExp(`setTargetAtTime\\(${g(-4)}, 10\\.7, `));

    p.player.holdDuck('stinger', 2);
    p.player.tick();
    expect(p.player.debug().duckDb).toBe(-10);

    p.player.apply(cue({ muffle: true, restart: false, fadeIn: 0 }));
    p.player.tick();
    expect(p.player.debug()).toMatchObject({ duckDb: -12, muffle: true });
    expect(lines(p.ac, new RegExp(`^#${lp.id}\\.frequency\\.setTargetAtTime`)).at(-1)).toMatch(/setTargetAtTime\(1200, 10\.7, /);

    p.ac.currentTime = 13;
    p.player.apply(cue({ muffle: false, restart: false, fadeIn: 0 }));
    p.player.tick();
    expect(p.player.debug().duckDb).toBe(0);
    expect(lines(p.ac, new RegExp(`^#${lp.id}\\.frequency\\.setTargetAtTime`)).at(-1)).toMatch(/setTargetAtTime\(20000, 13, /);
  });

  it('never jumps a gain: every level change in a whole session is a ramp', async () => {
    const p = await setup();
    p.ac.currentTime = 1;
    await play(p, { song: 'menu', key: 'menu', fadeIn: 1.5 });
    p.ac.currentTime = 1.8;
    p.player.apply(cue({ song: null, key: '', fadeOut: 1 }));
    p.ac.currentTime = 2.2;
    await play(p, { fadeIn: 0.3 });
    p.player.countdown(3);
    p.ac.currentTime = 4;
    p.player.tick();
    p.player.countdown(0);
    p.ac.currentTime = 9;
    p.player.apply(cue({ lift: true, restart: false }));
    p.player.apply(cue({ lift: true, muffle: true, restart: false }));
    p.ac.currentTime = 9.1;
    p.player.tick();
    p.player.apply(cue({ lift: true, muffle: false, restart: false }));
    p.ac.currentTime = 10;
    p.player.tick();
    p.player.apply(cue({ key: 'neon-bay#1', fadeOut: 0.5 }));
    await flush();
    p.player.tick();
    p.ac.currentTime = 11;
    p.player.apply(cue({ song: null, key: '', fadeOut: 1.5 }));
    p.player.tick();
    const gains = p.ac.nodes.filter((n) => n.kind === 'Gain');
    for (const n of gains) expect(jumps(p.ac, n.id, 'gain'), `#${n.id}`).toEqual([]);
  });

  it('a song that is not ready starts with a fade when it lands, if it is still wanted', async () => {
    const p = await setup();
    p.ac.currentTime = 5;
    p.player.apply(cue({ fadeIn: 0.3 }));
    expect(p.src.asked).toMatchObject([{ id: 'neon-bay', purpose: 'play' }]);
    expect(sources(p.ac)).toHaveLength(0);
    p.ac.currentTime = 9;
    p.src.land('neon-bay');
    await flush();
    p.player.tick();
    const g = p.player.debugNodes().songGain as unknown as FakeAudioNode;
    // Late: it fades in over at least 1 s, from where the loop would have been… it starts from its beginning.
    expect(lines(p.ac, new RegExp(`^#${g.id}\\.gain\\.linearRamp`))).toEqual([`#${g.id}.gain.linearRampToValueAtTime(1, 10.05)`]);

    // Not wanted any more by the time it lands: it does not start.
    const q = await setup2(p);
    q.player.apply(cue({ song: 'orbital-ring', key: 'orbital-ring#0' }));
    q.player.apply(cue({ song: 'menu', key: 'menu' }));
    await flush();
    const before = sources(q.ac).length;
    q.src.land('orbital-ring');
    await flush();
    q.player.tick();
    expect(sources(q.ac).length).toBe(before);
  });

  it('prepares songs on request, once each, and keeps the cache within 100 MB', async () => {
    const p = await setup();
    p.player.apply(cue({ song: 'menu', key: 'menu', prepare: ['neon-bay', 'orbital-ring'] }));
    p.player.apply(cue({ song: 'menu', key: 'menu', restart: false, changed: false, prepare: ['neon-bay', 'orbital-ring'] }));
    expect(p.src.asked.map((a) => `${a.id}:${a.purpose}`)).toEqual(['menu:play', 'neon-bay:prepare', 'orbital-ring:prepare']);
    const big = (id: string) => ({ ...rendered(id), loop: [new Float32Array(9e6), new Float32Array(9e6)] as [Float32Array, Float32Array] });
    p.src.land('menu', big('menu'));
    p.src.land('neon-bay', big('neon-bay'));
    p.src.land('orbital-ring', big('orbital-ring'));
    await flush();
    p.player.tick();
    expect(p.player.debug().bufferBytes).toBeLessThanOrEqual(100 * 1024 * 1024);
    // The menu theme is playing: it stays.
    expect(p.player.cached()).toContain('menu');
  });

  it('reports what it holds and plays (the debug hook)', async () => {
    const p = await setup();
    await play(p, { lift: true });
    expect(p.player.debug()).toMatchObject({ song: 'neon-bay', lift: true, muffle: false, duckDb: 0 });
    expect(p.player.debug().bufferBytes).toBeGreaterThan(0);
    expect(p.player.stats('neon-bay')).toMatchObject({ renderMs: 100, lufs: -14 });
  });
});

async function setup2(p: { player: MusicPlayer }): Promise<{ player: MusicPlayer; src: Source; ac: FakeAudioContext }> {
  p.player.dispose();
  FakeAudioContext.reset('running');
  return setup();
}
