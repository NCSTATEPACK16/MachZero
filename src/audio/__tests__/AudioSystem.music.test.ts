import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameContext, RaceSnapshot } from '../../core/contracts';
import { EventBus, type GameEvents } from '../../core/events';
import { makeCircleTrack, makeShip, placeShip } from '../../game/__tests__/helpers';
import { AudioSystem, type MusicScene } from '../AudioSystem';
import type { WorkerLike } from '../render/RenderClient';
import { FakeAudioContext, makeFakeDom, type FakeDom } from './fakeAudio';

class Worker implements WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: Array<{ kind: string; req: number; id?: string }> = [];
  postMessage(msg: unknown): void {
    this.sent.push(msg as (typeof this.sent)[number]);
  }
  terminate(): void {}
}

let dom: FakeDom;
beforeEach(() => {
  FakeAudioContext.reset('running');
  dom = makeFakeDom();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', dom.navigator);
});
afterEach(() => vi.unstubAllGlobals());

const scene = (over: Partial<MusicScene> = {}): MusicScene => ({ route: 'menu', overRace: false, worldId: 'neon-bay', race: 'title', intro: false, run: 0, resultsOpen: false, stinger: false, ...over });
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('AudioSystem and the music (§M6b step 7)', () => {
  it('with music off there is no player, no director and no song chain', () => {
    const audio = new AudioSystem({ modern: false });
    expect(audio.player).toBeNull();
    dom.fire('pointerdown');
    audio.setScene(scene());
    const ac = FakeAudioContext.instances[0];
    expect(ac.nodes.some((n) => n.kind === 'BiquadFilter' && n.prop('type') === 'peaking')).toBe(false);
    expect(audio.debug().song).toBeNull();
  });

  it('with music on, the song chain sits on the music bus once the context exists', () => {
    const audio = new AudioSystem({ modern: true, render: { makeWorker: () => new Worker() } });
    dom.fire('pointerdown');
    expect(audio.player!.chain).not.toBeNull();
  });

  it('nothing is asked of the Worker before rendering starts (after the first frame); then the menu theme is', async () => {
    const w = new Worker();
    const audio = new AudioSystem({ modern: true, render: { makeWorker: () => w }, songReady: () => true });
    audio.setScene(scene());
    expect(w.sent).toHaveLength(0);
    audio.startRendering();
    audio.setScene(scene());
    await flush();
    // The presets go first; the menu theme waits its turn (one request at a time).
    expect(w.sent.map((m) => m.kind)).toEqual(['presets']);
    w.onmessage?.({ data: { kind: 'presets', req: w.sent[0].req, ids: [], data: [], ms: 1 } } as MessageEvent);
    await flush();
    expect(w.sent.map((m) => m.id ?? m.kind)).toEqual(['presets', 'menu']);
  });

  it('the race forwards the countdown and the player’s laps; a priority-0 sound ducks the music', async () => {
    const bus = new EventBus<GameEvents>();
    const audio = new AudioSystem({ modern: true, render: { makeWorker: () => new Worker() } });
    dom.fire('pointerdown');
    audio.attach(bus);
    const track = makeCircleTrack();
    const player = makeShip(0, true);
    placeShip(player, track, 0.1);
    const ctx: FrameContext = { dt: 1 / 60, alpha: 1, time: 0, hazardTime: 0, telegraphScale: 1, ships: [player], player, track, race: { state: 'countdown', player, ships: [player] } as unknown as RaceSnapshot };
    bus.emit('race:countdown', { value: 3 });
    bus.emit('race:lap', { shipId: 0, lap: 2, lapTime: 30, isBest: false, isRecord: false });
    audio.update(ctx);
    expect(audio.race.playerLap).toBe(2);
    expect(audio.debug().duckDb).toBe(-8);
    expect(audio.debug().audioMs).toBeGreaterThanOrEqual(0);
    bus.emit('race:finish', { shipId: 0, position: 1, totalTime: 90 });
    audio.update(ctx);
    expect(audio.race.playerFinished).toBe(true);
  });

  it('SOUND TEST’s jukebox picks a song; stop gives the menu theme back', () => {
    const audio = new AudioSystem({ modern: true, render: { makeWorker: () => new Worker() } });
    audio.jukebox({ play: 'orbital-ring' });
    expect(audio.jukeboxSong).toMatchObject({ id: 'orbital-ring', fromIntro: true, lift: false, seq: 1 });
    audio.jukebox({ lift: true });
    expect(audio.jukeboxSong).toMatchObject({ lift: true, seq: 1 });
    audio.jukebox({ play: 'orbital-ring', fromIntro: false });
    expect(audio.jukeboxSong).toMatchObject({ fromIntro: false, lift: true, seq: 2 });
    audio.jukebox('stop');
    expect(audio.jukeboxSong).toBeNull();
  });
});
