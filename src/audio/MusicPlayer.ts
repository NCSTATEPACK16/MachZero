/**
 * The music player (IMPLEMENTATION §M6b): plays the director's cues with rendered songs.
 *
 * The song chain on the music bus (§M6.1, built only with `music` on):
 *   each song's gain → duck gain → pause low-pass → EQ dip (−4 dB at 1.5 kHz, Q 1) → music bus (MUSIC × the trim)
 * A song is three sources started together: the intro at t0, the loop (`loop = true`) and the lift (gain 0) both at
 * t0 + the intro's length, so they stay sample-locked; without the intro, loop and lift start at t0.
 *
 * Every level change is a ramp from the level the player knows the param has (its own record of the ramps it
 * scheduled; an AudioParam's `value` is never read), so nothing clicks. Ducks (decision C): countdown −8 dB, stinger
 * −10, warning −4, pause −12 with a 1.2 kHz low-pass; the deepest active one wins, with its attack or release.
 * A song not rendered yet is requested; it starts when it lands, if still wanted, with a fade of at least 1 s.
 */
import type { AudioEngine } from './AudioEngine';
import { BufferCache, CACHE_BYTES } from './BufferCache';
import { COUNTDOWN_DUCK_HOLD, DUCKS, dbToGain, duckTarget, rampTau, type DuckSource } from './duck';
import type { RenderedSong } from './dsp/render';
import type { MusicCue } from './MusicDirector';
import type { MusicId } from './songs/format';

/** Where songs come from (the render client, or a test). */
export interface SongSource {
  request(id: MusicId, purpose: 'play' | 'prepare'): Promise<RenderedSong | null>;
}

/** A source starts this far ahead of now, so every node is in place first. */
const START_LEAD = 0.05;
/** A song that lands late fades in over at least this long. */
const LATE_FADE = 1;
/** The shortest fade (a cue's 0 still ramps). */
const MIN_FADE = 0.02;
/** One-shot warnings hold their duck this long when the caller gives no length. */
const WARNING_HOLD = 0.4;
const OPEN_HZ = 20000;
const EQ_HZ = 1500;
const EQ_DB = -4;

interface SongBuffers {
  intro: AudioBuffer | null;
  loop: AudioBuffer;
  lift: AudioBuffer | null;
}

interface Entry {
  meta: Omit<RenderedSong, 'intro' | 'loop' | 'lift'>;
  /** The samples until the context exists, then null. */
  data: Pick<RenderedSong, 'intro' | 'loop' | 'lift'> | null;
  buffers: SongBuffers | null;
}

/** A linear ramp the player scheduled, so it knows the level at any time. */
class Level {
  private scheduled = false;
  private v0: number;
  private v1: number;
  private t0 = 0;
  private t1 = 0;
  constructor(v: number) {
    this.v0 = this.v1 = v;
  }
  at(t: number): number {
    if (t <= this.t0) return this.v0;
    if (t >= this.t1) return this.v1;
    return this.v0 + ((this.v1 - this.v0) * (t - this.t0)) / (this.t1 - this.t0);
  }
  /** Ramp to `v` from `t0` (holding the level reached at `from` until then) to `t1`. */
  ramp(param: AudioParam, from: number, t0: number, v: number, t1: number): void {
    const start = this.at(from);
    const held = this.at(t0);
    if (this.scheduled) param.cancelScheduledValues(from);
    this.scheduled = true;
    param.setValueAtTime(start, from);
    if (t0 > from) param.setValueAtTime(held, t0);
    param.linearRampToValueAtTime(v, t1);
    this.v0 = held;
    this.t0 = t0;
    this.v1 = v;
    this.t1 = t1;
  }
  get target(): number {
    return this.v1;
  }
}

interface Playing {
  id: MusicId;
  key: string;
  gain: GainNode;
  level: Level;
  liftGain: GainNode | null;
  lift: Level;
  liftOn: boolean;
  srcs: AudioBufferSourceNode[];
  /** When the loop starts, and a bar's length (s). */
  tLoop: number;
  bar: number;
  ending: boolean;
  nodes: number;
}

export interface MusicChain {
  duck: GainNode;
  lowpass: BiquadFilterNode;
  eq: BiquadFilterNode;
}

export interface MusicDebug {
  song: MusicId | null;
  lift: boolean;
  muffle: boolean;
  duckDb: number;
  bufferBytes: number;
}

export class MusicPlayer {
  chain: MusicChain | null = null;
  private readonly cache: BufferCache<Entry>;
  private current: Playing | null = null;
  private readonly fading = new Set<Playing>();
  /** The cue waiting for its song to land. */
  private wanted: MusicCue | null = null;
  private wantedSince = 0;
  private lastCue: MusicCue | null = null;
  private readonly inFlight = new Set<MusicId>();
  private readonly holds = new Map<DuckSource, number>();
  private countdownOn = false;
  private muffle = false;
  private duckDb = 0;
  private duckLp: number | null = null;
  private readonly stats_ = new Map<MusicId, { renderMs: number; bytes: number; lufs: number; truePeakDb: number; seconds: number }>();

  constructor(
    private readonly engine: AudioEngine,
    private readonly source: SongSource,
    cacheBytes = CACHE_BYTES,
  ) {
    this.cache = new BufferCache<Entry>(cacheBytes);
    engine.onContext((ac) => this.build(ac));
  }

  private build(ac: AudioContext): void {
    const out = this.engine.music;
    if (!out) return;
    const duck = ac.createGain();
    const lowpass = ac.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = OPEN_HZ;
    lowpass.Q.value = 0.707;
    const eq = ac.createBiquadFilter();
    eq.type = 'peaking';
    eq.frequency.value = EQ_HZ;
    eq.gain.value = EQ_DB;
    eq.Q.value = 1;
    duck.connect(lowpass);
    lowpass.connect(eq);
    eq.connect(out);
    this.engine.made(3);
    this.chain = { duck, lowpass, eq };
  }

  // ---------------------------------------------------------------------
  // Cues
  // ---------------------------------------------------------------------

  apply(cue: MusicCue): void {
    const prev = this.lastCue;
    this.lastCue = cue;
    this.muffle = cue.muffle;
    const ac = this.engine.ac;
    const restart = !prev || cue.key !== prev.key;
    if (restart) {
      this.wanted = null;
      if (this.current) this.fadeOut(this.current, cue.fadeOut);
      this.current = null;
      if (cue.song) {
        this.cache.pin(cue.song);
        if (prev?.song) this.cache.unpin(prev.song);
        this.wanted = cue;
        this.wantedSince = ac?.currentTime ?? 0;
        this.startIfReady();
      } else if (prev?.song) this.cache.unpin(prev.song);
    } else if (this.current && cue.lift !== this.current.liftOn) this.setLift(this.current, cue.lift);
    else if (!this.current && this.wanted && cue.lift !== this.wanted.lift) this.wanted = { ...this.wanted, lift: cue.lift };
    // The song to play is asked for first; then the ones worth preparing.
    for (const id of cue.prepare) this.prepare(id);
    this.tickDucks();
  }

  /** Per frame: start a song that landed, and keep the ducks up to date. */
  tick(): void {
    if (this.wanted) this.startIfReady();
    this.tickDucks();
  }

  /** The race's countdown: 3, 2, 1, then 0 (GO). */
  countdown(value: number): void {
    const now = this.engine.ac?.currentTime ?? 0;
    if (value > 0) {
      this.countdownOn = true;
      this.holds.delete('countdown');
    } else {
      this.countdownOn = false;
      this.holds.set('countdown', now + COUNTDOWN_DUCK_HOLD);
    }
  }

  /** A warning sound (priority 0) is playing for `seconds`. */
  warning(seconds = WARNING_HOLD): void {
    this.holdDuck('warning', seconds);
  }

  /** Hold a duck for `seconds` from now (stingers, warnings). */
  holdDuck(source: DuckSource, seconds: number): void {
    const now = this.engine.ac?.currentTime ?? 0;
    this.holds.set(source, Math.max(this.holds.get(source) ?? 0, now + seconds));
  }

  /** The race went away (a new race, the menus): the countdown duck ends. */
  resetRace(): void {
    this.countdownOn = false;
    this.holds.delete('countdown');
  }

  // ---------------------------------------------------------------------
  // Songs
  // ---------------------------------------------------------------------

  private prepare(id: MusicId): void {
    if (this.cache.has(id) || this.inFlight.has(id)) return;
    this.fetch(id, 'prepare');
  }

  private fetch(id: MusicId, purpose: 'play' | 'prepare'): void {
    this.inFlight.add(id);
    void this.source.request(id, purpose).then((song) => {
      this.inFlight.delete(id);
      if (song) this.store(song);
      if (this.wanted?.song === id) this.startIfReady();
    });
  }

  private store(song: RenderedSong): void {
    const bytes = [...(song.intro ?? []), ...song.loop, ...(song.lift ? [song.lift] : [])].reduce((n, b) => n + b.byteLength, 0);
    const { intro, loop, lift, ...meta } = song;
    const id = song.id as MusicId;
    this.stats_.set(id, { renderMs: song.renderMs, bytes, lufs: song.lufs, truePeakDb: song.truePeakDb, seconds: song.loopSamples / song.sampleRate });
    this.cache.put(id, { meta, data: { intro, loop, lift }, buffers: null }, bytes);
  }

  /** The song's AudioBuffers (made once, when the context exists; the samples are then let go). */
  private buffersFor(id: MusicId): { entry: Entry; buffers: SongBuffers } | null {
    const ac = this.engine.ac;
    const entry = this.cache.get(id);
    if (!ac || !entry) return null;
    if (!entry.buffers && entry.data) {
      const sr = entry.meta.sampleRate;
      const make = (chs: Float32Array[]) => {
        const b = ac.createBuffer(chs.length, Math.max(1, chs[0].length), sr);
        chs.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
        return b;
      };
      const d = entry.data;
      entry.buffers = { intro: d.intro ? make(d.intro) : null, loop: make(d.loop), lift: d.lift ? make([d.lift]) : null };
      entry.data = null;
    }
    return entry.buffers ? { entry, buffers: entry.buffers } : null;
  }

  private startIfReady(): void {
    const cue = this.wanted;
    const ac = this.engine.ac;
    if (!cue?.song) return;
    if (!this.cache.has(cue.song)) {
      if (!this.inFlight.has(cue.song)) this.fetch(cue.song, 'play');
      return;
    }
    if (!ac || ac.state !== 'running' || !this.chain) return;
    const got = this.buffersFor(cue.song);
    if (!got) return;
    this.wanted = null;
    const late = ac.currentTime - this.wantedSince > 0.25;
    this.current = this.start(cue, got.entry, got.buffers, late ? Math.max(cue.fadeIn, LATE_FADE) : cue.fadeIn);
  }

  private start(cue: MusicCue, entry: Entry, b: SongBuffers, fadeIn: number): Playing {
    const ac = this.engine.ac!;
    const t0 = ac.currentTime + START_LEAD;
    const meta = entry.meta;
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(this.chain!.duck);
    const level = new Level(0);
    level.ramp(gain.gain, t0, t0, 1, t0 + Math.max(MIN_FADE, fadeIn));
    const srcs: AudioBufferSourceNode[] = [];
    let nodes = 1;
    const withIntro = cue.fromIntro && b.intro !== null;
    const tLoop = withIntro ? t0 + meta.introSamples / meta.sampleRate : t0;
    if (withIntro) {
      const s = ac.createBufferSource();
      s.buffer = b.intro;
      s.connect(gain);
      s.start(t0);
      srcs.push(s);
      nodes++;
    }
    const loop = ac.createBufferSource();
    loop.buffer = b.loop;
    loop.loop = true;
    loop.connect(gain);
    srcs.push(loop);
    nodes++;
    let liftGain: GainNode | null = null;
    if (b.lift) {
      liftGain = ac.createGain();
      liftGain.gain.value = 0;
      liftGain.connect(gain);
      const lift = ac.createBufferSource();
      lift.buffer = b.lift;
      lift.loop = true;
      lift.connect(liftGain);
      srcs.push(lift);
      nodes += 2;
    }
    for (const s of srcs.slice(withIntro ? 1 : 0)) s.start(tLoop);
    this.engine.made(nodes);
    const p: Playing = { id: cue.song!, key: cue.key, gain, level, liftGain, lift: new Level(0), liftOn: false, srcs, tLoop, bar: 240 / meta.bpm, ending: false, nodes };
    let ended = 0;
    for (const s of srcs) {
      s.onended = () => {
        if (++ended === srcs.length) this.release(p);
      };
    }
    if (cue.lift) this.setLift(p, true);
    return p;
  }

  /** The lift comes in (or goes) over one bar, from the next bar line of the loop. */
  private setLift(p: Playing, on: boolean): void {
    p.liftOn = on;
    const ac = this.engine.ac;
    if (!ac || !p.liftGain) return;
    const now = ac.currentTime;
    const next = now <= p.tLoop ? p.tLoop : p.tLoop + Math.ceil((now - p.tLoop) / p.bar - 1e-9) * p.bar;
    p.lift.ramp(p.liftGain.gain, Math.min(now, next), next, on ? 1 : 0, next + p.bar);
  }

  private fadeOut(p: Playing, seconds: number): void {
    const ac = this.engine.ac;
    if (!ac || p.ending) return;
    p.ending = true;
    const now = ac.currentTime;
    const end = now + Math.max(MIN_FADE, seconds);
    p.level.ramp(p.gain.gain, now, now, 0, end);
    for (const s of p.srcs) s.stop(end + START_LEAD);
    this.fading.add(p);
  }

  private release(p: Playing): void {
    for (const s of p.srcs) s.disconnect();
    p.liftGain?.disconnect();
    p.gain.disconnect();
    this.engine.freed(p.nodes);
    this.fading.delete(p);
    if (this.current === p) this.current = null;
  }

  // ---------------------------------------------------------------------
  // Ducks
  // ---------------------------------------------------------------------

  private tickDucks(): void {
    const ac = this.engine.ac;
    const chain = this.chain;
    if (!ac || !chain) return;
    const now = ac.currentTime;
    const active: DuckSource[] = [];
    if (this.countdownOn) active.push('countdown');
    if (this.muffle) active.push('pause');
    for (const [s, until] of this.holds) {
      if (until > now) active.push(s);
      else this.holds.delete(s);
    }
    const t = duckTarget(active);
    if (t.db !== this.duckDb) {
      // Deeper: the new source's attack; shallower: the release of the source that ended.
      const deeper = t.db < this.duckDb;
      const spec = deeper ? DUCKS[t.source!] : DUCKS[this.duckSource ?? 'warning'];
      chain.duck.gain.setTargetAtTime(dbToGain(t.db), now, rampTau(deeper ? spec.attack : spec.release));
      this.duckDb = t.db;
    }
    this.duckSource = t.source ?? this.duckSource;
    if (t.lowpassHz !== this.duckLp) {
      const on = t.lowpassHz !== null;
      chain.lowpass.frequency.setTargetAtTime(t.lowpassHz ?? OPEN_HZ, now, rampTau(on ? DUCKS.pause.attack : DUCKS.pause.release));
      this.duckLp = t.lowpassHz;
    }
  }

  private duckSource: DuckSource | null = null;

  // ---------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------

  debug(): MusicDebug {
    return { song: this.current?.id ?? null, lift: this.current?.liftOn ?? false, muffle: this.muffle, duckDb: this.duckDb, bufferBytes: this.cache.bytes };
  }

  /** Tests: the playing song's gains. */
  debugNodes(): { songGain: GainNode | null; liftGain: GainNode | null } {
    return { songGain: this.current?.gain ?? null, liftGain: this.current?.liftGain ?? null };
  }

  /** SOUND TEST: a rendered song's numbers. */
  stats(id: MusicId): { renderMs: number; bytes: number; lufs: number; truePeakDb: number; seconds: number } | null {
    return this.stats_.get(id) ?? null;
  }

  cached(): string[] {
    return this.cache.ids();
  }

  /** Whether a song is rendered (or being rendered). */
  has(id: MusicId): boolean {
    return this.cache.has(id);
  }

  dispose(): void {
    const ac = this.engine.ac;
    for (const p of [this.current, ...this.fading]) {
      if (!p) continue;
      if (ac) for (const s of p.srcs) s.stop();
      this.release(p);
    }
    this.current = null;
  }
}
