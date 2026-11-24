import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderClient, RENDER_TIMEOUT_MS, type WorkerLike } from '../render/RenderClient';
import { renderSong, SongRender, type RenderedSong } from '../dsp/render';
import { testSong } from '../dsp/__tests__/testSong';
import type { FallbackModule } from '../render/fallback';
import { PRESETS, renderPreset } from '../sfx/presets';
import { AudioSystem } from '../AudioSystem';
import { PRESET_IDS } from '../sfx/presets';
import { FakeAudioContext, makeFakeDom } from './fakeAudio';

/** A manual clock for the client's timers. */
function fakeTimers() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let next = 1;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id: unknown) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    /** Advance the clock, running every timer due (including ones scheduled while running). */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        now = t.at;
        t.fn();
      }
      now = end;
    },
  };
}

class FakeWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: Array<{ kind: string; req: number; ids: string[]; id: string; sampleRate: number }> = [];
  terminated = false;
  postMessage(msg: unknown): void {
    this.sent.push(msg as (typeof this.sent)[number]);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(): void {
    const req = this.sent[0];
    this.onmessage?.({ data: { kind: 'presets', req: req.req, ids: req.ids, data: req.ids.map(() => new Float32Array(4)), ms: 12 } } as MessageEvent);
  }
  /** Answer the n-th request (a song). */
  song(n: number, ok = true): void {
    const req = this.sent[n];
    const data = ok ? { kind: 'song', req: req.req, ok: true, song: { id: req.id } } : { kind: 'song', req: req.req, ok: false, error: 'boom' };
    this.onmessage?.({ data } as MessageEvent);
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** Advance the fake clock in small steps, letting real tasks (the fallback's dynamic import) run, until `p` settles. */
async function settle<T>(p: Promise<T>, timers: ReturnType<typeof fakeTimers>): Promise<T> {
  let done = false;
  let value: T | undefined;
  void p.then((v) => {
    done = true;
    value = v;
  });
  for (let i = 0; i < 500 && !done; i++) {
    timers.advance(5);
    await new Promise((r) => setTimeout(r, 0));
  }
  if (!done) throw new Error('did not settle');
  return value as T;
}

afterEach(() => vi.restoreAllMocks());

describe('RenderClient: the Worker and its fallback', () => {
  it('returns the Worker’s samples when it answers', async () => {
    const w = new FakeWorker();
    const timers = fakeTimers();
    const client = new RenderClient({ makeWorker: () => w, ...timers });
    const p = client.renderPresets(['ui.move', 'ui.confirm'], 44100);
    expect(w.sent[0]).toMatchObject({ kind: 'presets', ids: ['ui.move', 'ui.confirm'], sampleRate: 44100 });
    w.reply();
    const r = await p;
    expect(r.by).toBe('worker');
    expect(r.ms).toBe(12);
    expect([...r.samples.keys()]).toEqual(['ui.move', 'ui.confirm']);
    expect(client.fallback).toBe(false);
  });

  it('falls back to the main thread after 10 s without an answer, warning once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = new FakeWorker();
    const timers = fakeTimers();
    const client = new RenderClient({ makeWorker: () => w, ...timers });
    let result: Awaited<ReturnType<RenderClient['renderPresets']>> | null = null;
    const p = client.renderPresets(['ui.move', 'ui.tab'], 44100);
    void p.then((r) => (result = r));
    timers.advance(RENDER_TIMEOUT_MS - 1);
    await flush();
    expect(result).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    const r = await settle(p, timers);
    expect(r.by).toBe('main');
    expect(r.samples.get('ui.move')!.length).toBeGreaterThan(100);
    expect(w.terminated).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    // Later requests go straight to the main thread, with no new warning.
    expect((await settle(client.renderPresets(['ui.back'], 44100), timers)).by).toBe('main');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falls back at once when the Worker cannot be created', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const timers = fakeTimers();
    const client = new RenderClient({
      makeWorker: () => {
        throw new Error('no module workers');
      },
      ...timers,
    });
    const r = await settle(client.renderPresets(['ui.move'], 44100), timers);
    expect(r.by).toBe('main');
    expect(client.fallback).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falls back when the Worker reports an error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = new FakeWorker();
    const timers = fakeTimers();
    const client = new RenderClient({ makeWorker: () => w, ...timers });
    const p = client.renderPresets(['ui.move'], 44100);
    w.onerror?.(new Event('error'));
    expect((await settle(p, timers)).by).toBe('main');
  });

  it('is never created before startRendering, and only with music on', () => {
    const make = vi.fn(() => new FakeWorker());
    const off = new AudioSystem({ modern: false, render: { makeWorker: make } });
    off.startRendering();
    const on = new AudioSystem({ modern: true, render: { makeWorker: make } });
    expect(make).not.toHaveBeenCalled();
    on.startRendering();
    expect(make).toHaveBeenCalledTimes(1);
    on.startRendering();
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('keeps samples that arrive before the first input, and makes buffers when the context exists', async () => {
    FakeAudioContext.reset('running');
    const dom = makeFakeDom();
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.document);
    vi.stubGlobal('navigator', dom.navigator);
    const w = new FakeWorker();
    const audio = new AudioSystem({ modern: true, render: { makeWorker: () => w } });
    audio.startRendering();
    w.reply();
    await flush();
    expect(audio.bank.hasBuffer('ui.move')).toBe(false);
    dom.fire('pointerdown');
    expect(PRESET_IDS.every((id) => audio.bank.hasBuffer(id))).toBe(true);
    expect(audio.debug()).toMatchObject({ state: 'running', presetsBy: 'worker', presetsMs: 12 });
    vi.unstubAllGlobals();
  });
});

describe('RenderClient: songs (§M6b step 7)', () => {
  it('asks the Worker for a song and answers its render', async () => {
    const w = new FakeWorker();
    const client = new RenderClient({ makeWorker: () => w, ...fakeTimers() });
    const p = client.renderSong('neon-bay', 'play');
    await flush();
    expect(w.sent[0]).toMatchObject({ kind: 'song', id: 'neon-bay', sampleRate: 44100 });
    w.song(0);
    expect(((await p) as RenderedSong).id).toBe('neon-bay');
  });

  it('a song the Worker cannot render answers null, with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = new FakeWorker();
    const client = new RenderClient({ makeWorker: () => w, ...fakeTimers() });
    const p = client.renderSong('menu', 'play');
    await flush();
    w.song(0, false);
    expect(await p).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(client.fallback).toBe(false);
  });

  it('runs one request at a time, in order', async () => {
    const w = new FakeWorker();
    const client = new RenderClient({ makeWorker: () => w, ...fakeTimers() });
    const a = client.renderSong('menu', 'play');
    const b = client.renderSong('neon-bay', 'prepare');
    await flush();
    expect(w.sent.map((m) => m.id)).toEqual(['menu']);
    w.song(0);
    await a;
    await flush();
    expect(w.sent.map((m) => m.id)).toEqual(['menu', 'neon-bay']);
    w.song(1);
    expect(((await b) as RenderedSong).id).toBe('neon-bay');
  });

  it('a newer request for the same purpose replaces one still waiting', async () => {
    const w = new FakeWorker();
    const client = new RenderClient({ makeWorker: () => w, ...fakeTimers() });
    const first = client.renderSong('menu', 'play');
    const queued = client.renderSong('neon-bay', 'prepare');
    const newer = client.renderSong('orbital-ring', 'prepare');
    expect(await queued).toBeNull();
    expect(client.waiting).toBe(1);
    w.song(0);
    await first;
    await flush();
    expect(w.sent.map((m) => m.id)).toEqual(['menu', 'orbital-ring']);
    w.song(1);
    expect(((await newer) as RenderedSong).id).toBe('orbital-ring');
  });

  it('without a Worker, renders a song on the main thread in slices, the same samples as at once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const timers = fakeTimers();
    let slices = 0;
    const def = testSong();
    const fallback = { PRESETS, renderPreset, SongRender, SONGS: { 'neon-bay': def } } as unknown as FallbackModule;
    // A clock that moves 1 ms each time it is read: each slice does a few units of work, then yields.
    let clock = 0;
    const client = new RenderClient({
      makeWorker: () => {
        throw new Error('no module workers');
      },
      loadFallback: async () => fallback,
      now: () => (clock += 1),
      setTimer: (fn, ms) => timers.setTimer(() => (slices++, fn()), ms),
      clearTimer: timers.clearTimer,
    });
    const song = (await settle(client.renderSong('neon-bay', 'play'), timers)) as RenderedSong;
    expect(slices).toBeGreaterThan(50);
    const whole = renderSong(def);
    expect(song.loop[0]).toEqual(whole.loop[0]);
    expect(song.lift).toEqual(whole.lift);
    expect(client.fallback).toBe(true);
  });

  it('on the main thread, a song not written answers null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const timers = fakeTimers();
    const client = new RenderClient({
      makeWorker: () => {
        throw new Error('no');
      },
      loadFallback: async () => ({ PRESETS, renderPreset, SongRender, SONGS: {} }) as unknown as FallbackModule,
      ...timers,
    });
    expect(await settle(client.renderSong('results', 'play'), timers)).toBeNull();
  });
});
