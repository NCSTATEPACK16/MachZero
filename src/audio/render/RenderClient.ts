/**
 * The main thread's side of the render Worker (IMPLEMENTATION §M6a, §M6b, decision A): the SFX presets and the songs.
 *
 * - The Worker is created on the first request (the App makes that request after the first rendered frame, with
 *   `music` on).
 * - One request at a time. A newer song request for the same purpose ('play' or 'prepare') replaces one still
 *   waiting in the queue (that one answers null).
 * - A song the Worker cannot render answers `{ ok: false, error }`: the request answers null, with one
 *   `console.warn`.
 * - Fallback: if `new Worker` throws, the Worker reports an error, or there is no answer in time (10 s for the first
 *   request; 60 s once the Worker has answered, since a song takes a few seconds), everything renders on the main
 *   thread from then on, with one `console.warn` (never an error). The fallback loads as its own chunk and works in
 *   slices: one preset per `setTimeout(0)`, and a song in slices of about 6 ms of work each, so the game never stalls.
 */
import type { RenderedSong } from '../dsp/render';
import type { PresetId } from '../sfx/presetMeta';
import type { MusicId } from '../songs/format';
import type { FallbackModule } from './fallback';
import type { PresetReply, PresetRequest, SongReply, SongRequest } from './protocol';

export type { PresetReply, PresetRequest, SongReply, SongRequest } from './protocol';

export interface RenderResult {
  samples: Map<string, Float32Array>;
  sampleRate: number;
  /** Render time in ms (the Worker's own measure, or the fallback's busy time). */
  ms: number | null;
  by: 'worker' | 'main';
}

/** What the client needs of a Worker (a real one, or a test's fake). */
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface RenderClientOptions {
  makeWorker?: () => WorkerLike;
  /** Ms before the first unanswered request falls back (10 s), and later ones (60 s). */
  timeoutMs?: number;
  songTimeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  /** The main-thread fallback (tests inject one). */
  loadFallback?: () => Promise<FallbackModule>;
  /** A clock in ms (performance.now). */
  now?: () => number;
}

export const RENDER_TIMEOUT_MS = 10_000;
export const SONG_TIMEOUT_MS = 60_000;
/** Work per main-thread slice while rendering a song. */
export const SLICE_MS = 6;
export const SONG_SAMPLE_RATE = 44100;

function defaultWorker(): WorkerLike {
  return new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

type Job =
  | { kind: 'presets'; ids: readonly PresetId[]; sampleRate: number; resolve: (r: RenderResult) => void }
  | { kind: 'song'; id: MusicId; purpose: 'play' | 'prepare'; resolve: (r: RenderedSong | null) => void };

export class RenderClient {
  private worker: WorkerLike | null = null;
  private failed = false;
  private warned = false;
  private answered = false;
  private seq = 0;
  private readonly queue: Job[] = [];
  private busy = false;
  private disposed = false;
  private fallbackModule: Promise<FallbackModule> | null = null;
  private readonly makeWorker: () => WorkerLike;
  private readonly timeoutMs: number;
  private readonly songTimeoutMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;
  private readonly loadFallback: () => Promise<FallbackModule>;
  private readonly now: () => number;

  constructor(opts: RenderClientOptions = {}) {
    this.makeWorker = opts.makeWorker ?? defaultWorker;
    this.timeoutMs = opts.timeoutMs ?? RENDER_TIMEOUT_MS;
    this.songTimeoutMs = opts.songTimeoutMs ?? SONG_TIMEOUT_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.loadFallback = opts.loadFallback ?? (() => import('./fallback'));
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  /** Whether the Worker failed and renders now happen on the main thread. */
  get fallback(): boolean {
    return this.failed;
  }

  /** Requests waiting (not counting the one running). */
  get waiting(): number {
    return this.queue.length;
  }

  renderPresets(ids: readonly PresetId[], sampleRate: number): Promise<RenderResult> {
    return new Promise((resolve) => this.enqueue({ kind: 'presets', ids, sampleRate, resolve }));
  }

  /** Render a song (null when it cannot be had, or when a newer request for the same purpose replaced this one). */
  renderSong(id: MusicId, purpose: 'play' | 'prepare'): Promise<RenderedSong | null> {
    return new Promise((resolve) => {
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const j = this.queue[i];
        if (j.kind === 'song' && j.purpose === purpose) {
          this.queue.splice(i, 1);
          j.resolve(null);
        }
      }
      this.enqueue({ kind: 'song', id, purpose, resolve });
    });
  }

  private enqueue(job: Job): void {
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    if (this.busy || this.disposed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    const done = () => {
      this.busy = false;
      this.pump();
    };
    if (job.kind === 'presets') void this.runPresets(job).then((r) => (job.resolve(r), done()));
    else void this.runSong(job).then((r) => (job.resolve(r), done()));
  }

  // ---------------------------------------------------------------------
  // The Worker
  // ---------------------------------------------------------------------

  private ensureWorker(): WorkerLike | null {
    if (this.failed) return null;
    try {
      return this.worker ?? (this.worker = this.makeWorker());
    } catch (err) {
      this.fail(err);
      return null;
    }
  }

  /** Send one message and wait for its answer, or fall back. */
  private ask<R extends { req: number; kind: string }>(msg: PresetRequest | SongRequest, onMain: () => Promise<unknown>): Promise<{ reply: R } | { main: unknown }> {
    const worker = this.ensureWorker();
    if (!worker) return onMain().then((main) => ({ main }));
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v: Promise<{ reply: R } | { main: unknown }> | { reply: R } | { main: unknown }) => {
        if (settled) return;
        settled = true;
        this.clearTimer(timer);
        resolve(v);
      };
      const toMain = (err: unknown) => {
        this.fail(err);
        finish(onMain().then((main) => ({ main })));
      };
      const limit = this.answered ? this.songTimeoutMs : this.timeoutMs;
      const timer = this.setTimer(() => toMain(new Error(`no answer in ${limit} ms`)), limit);
      worker.onerror = (ev) => toMain(ev);
      worker.onmessage = (ev: MessageEvent) => {
        const reply = ev.data as R;
        if (!reply || reply.kind !== msg.kind || reply.req !== msg.req) return;
        this.answered = true;
        finish({ reply });
      };
      try {
        worker.postMessage(msg);
      } catch (err) {
        toMain(err);
      }
    });
  }

  private async runPresets(job: Extract<Job, { kind: 'presets' }>): Promise<RenderResult> {
    const msg: PresetRequest = { kind: 'presets', req: ++this.seq, ids: [...job.ids], sampleRate: job.sampleRate };
    const r = await this.ask<PresetReply>(msg, () => this.presetsOnMain(job.ids, job.sampleRate));
    if ('main' in r) return r.main as RenderResult;
    const samples = new Map<string, Float32Array>();
    r.reply.ids.forEach((id, i) => samples.set(id, r.reply.data[i]));
    return { samples, sampleRate: job.sampleRate, ms: r.reply.ms, by: 'worker' };
  }

  private async runSong(job: Extract<Job, { kind: 'song' }>): Promise<RenderedSong | null> {
    const msg: SongRequest = { kind: 'song', req: ++this.seq, id: job.id, sampleRate: SONG_SAMPLE_RATE };
    const r = await this.ask<SongReply>(msg, () => this.songOnMain(job.id));
    if ('main' in r) return r.main as RenderedSong | null;
    if (r.reply.ok) return r.reply.song;
    console.warn(`[audio] the song ${job.id} could not be rendered: ${r.reply.error}`);
    return null;
  }

  private fail(err: unknown): void {
    this.failed = true;
    try {
      this.worker?.terminate();
    } catch {
      // already gone
    }
    this.worker = null;
    if (!this.warned) {
      this.warned = true;
      console.warn('[audio] the render worker failed; rendering sounds on the main thread', err);
    }
  }

  // ---------------------------------------------------------------------
  // The main-thread fallback
  // ---------------------------------------------------------------------

  private fallbackMod(): Promise<FallbackModule> {
    return (this.fallbackModule ??= this.loadFallback());
  }

  /** One preset per timer slice. */
  private async presetsOnMain(ids: readonly PresetId[], sampleRate: number): Promise<RenderResult> {
    const { PRESETS, renderPreset } = await this.fallbackMod();
    const samples = new Map<string, Float32Array>();
    let busy = 0;
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        if (i >= ids.length) {
          resolve({ samples, sampleRate, ms: busy, by: 'main' });
          return;
        }
        const id = ids[i++];
        const s = this.now();
        samples.set(id, renderPreset(PRESETS[id], sampleRate));
        busy += this.now() - s;
        this.setTimer(step, 0);
      };
      this.setTimer(step, 0);
    });
  }

  /** A song in slices of about SLICE_MS of work, one per timer tick. */
  private async songOnMain(id: MusicId): Promise<RenderedSong | null> {
    const mod = await this.fallbackMod();
    const def = mod.SONGS[id];
    if (!def) {
      console.warn(`[audio] the song ${id} could not be rendered: it is not written`);
      return null;
    }
    const job = new mod.SongRender(def, { sampleRate: SONG_SAMPLE_RATE, now: this.now });
    return new Promise((resolve) => {
      const step = () => {
        if (this.disposed) return resolve(null);
        try {
          if (job.step(SLICE_MS)) return resolve(job.result());
        } catch (err) {
          console.warn(`[audio] the song ${id} could not be rendered`, err);
          return resolve(null);
        }
        this.setTimer(step, 0);
      };
      this.setTimer(step, 0);
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const j of this.queue.splice(0)) {
      if (j.kind === 'song') j.resolve(null);
    }
    try {
      this.worker?.terminate();
    } catch {
      // ignore
    }
    this.worker = null;
  }
}
