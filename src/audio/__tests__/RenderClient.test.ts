import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderClient, RENDER_TIMEOUT_MS, type PresetRequest, type WorkerLike } from '../render/RenderClient';
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
  sent: PresetRequest[] = [];
  terminated = false;
  postMessage(msg: unknown): void {
    this.sent.push(msg as PresetRequest);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(): void {
    const req = this.sent[0];
    this.onmessage?.({ data: { kind: 'presets', req: req.req, ids: req.ids, data: req.ids.map(() => new Float32Array(4)), ms: 12 } } as MessageEvent);
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

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
    void client.renderPresets(['ui.move', 'ui.tab'], 44100).then((r) => (result = r));
    timers.advance(RENDER_TIMEOUT_MS - 1);
    await flush();
    expect(result).toBeNull();
    timers.advance(1);
    // One preset per slice.
    timers.advance(0);
    await flush();
    timers.advance(10);
    await flush();
    expect(result).not.toBeNull();
    expect(result!.by).toBe('main');
    expect(result!.samples.get('ui.move')!.length).toBeGreaterThan(100);
    expect(w.terminated).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    // Later requests go straight to the main thread, with no new warning.
    void client.renderPresets(['ui.back'], 44100);
    timers.advance(10);
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
    const p = client.renderPresets(['ui.move'], 44100);
    timers.advance(1);
    const r = await p;
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
    timers.advance(1);
    expect((await p).by).toBe('main');
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
