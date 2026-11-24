/**
 * The main thread's side of the render Worker (IMPLEMENTATION §M6a, decision A). M6a renders the SFX presets;
 * M6b extends the protocol to songs, stingers and ambience.
 *
 * The Worker is created on the first request (the App makes that request after the first rendered frame, with
 * `music` on). Fallback: if `new Worker` throws, the Worker reports an error, or there is no answer within 10 s, the
 * presets render on the main thread, one preset per `setTimeout(0)` slice, with one `console.warn` (never an error).
 */
import { PRESETS, renderPreset, type PresetId, type SfxPreset } from '../sfx/presets';

export interface RenderResult {
  samples: Map<string, Float32Array>;
  sampleRate: number;
  /** Render time in ms (the Worker's own measure, or the fallback's wall time). */
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
  /** Seconds before an unanswered request falls back (10). */
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface PresetRequest {
  kind: 'presets';
  req: number;
  ids: string[];
  sampleRate: number;
}

export interface PresetReply {
  kind: 'presets';
  req: number;
  ids: string[];
  data: Float32Array[];
  ms: number;
}

export const RENDER_TIMEOUT_MS = 10_000;

function defaultWorker(): WorkerLike {
  return new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

export class RenderClient {
  private worker: WorkerLike | null = null;
  private failed = false;
  private warned = false;
  private seq = 0;
  private readonly makeWorker: () => WorkerLike;
  private readonly timeoutMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(opts: RenderClientOptions = {}) {
    this.makeWorker = opts.makeWorker ?? defaultWorker;
    this.timeoutMs = opts.timeoutMs ?? RENDER_TIMEOUT_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  /** Whether the Worker failed and renders now happen on the main thread. */
  get fallback(): boolean {
    return this.failed;
  }

  renderPresets(ids: readonly PresetId[], sampleRate: number): Promise<RenderResult> {
    if (this.failed) return this.renderOnMain(ids, sampleRate);
    let worker: WorkerLike;
    try {
      worker = this.worker ?? (this.worker = this.makeWorker());
    } catch (err) {
      this.fail(err);
      return this.renderOnMain(ids, sampleRate);
    }
    const req = ++this.seq;
    return new Promise<RenderResult>((resolve) => {
      let done = false;
      const finish = (r: Promise<RenderResult> | RenderResult) => {
        if (done) return;
        done = true;
        this.clearTimer(timer);
        resolve(r);
      };
      const timer = this.setTimer(() => {
        this.fail(new Error(`no answer in ${this.timeoutMs} ms`));
        finish(this.renderOnMain(ids, sampleRate));
      }, this.timeoutMs);
      worker.onerror = (ev) => {
        this.fail(ev);
        finish(this.renderOnMain(ids, sampleRate));
      };
      worker.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as PresetReply;
        if (!msg || msg.kind !== 'presets' || msg.req !== req) return;
        const samples = new Map<string, Float32Array>();
        msg.ids.forEach((id, i) => samples.set(id, msg.data[i]));
        finish({ samples, sampleRate, ms: msg.ms, by: 'worker' });
      };
      try {
        const message: PresetRequest = { kind: 'presets', req, ids: [...ids], sampleRate };
        worker.postMessage(message);
      } catch (err) {
        this.fail(err);
        finish(this.renderOnMain(ids, sampleRate));
      }
    });
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

  /** The fallback: one preset per timer slice, so no slice blocks a frame for long. */
  private renderOnMain(ids: readonly PresetId[], sampleRate: number): Promise<RenderResult> {
    const samples = new Map<string, Float32Array>();
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let busy = 0;
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        if (i >= ids.length) {
          resolve({ samples, sampleRate, ms: busy || (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0, by: 'main' });
          return;
        }
        const id = ids[i++];
        const s = typeof performance !== 'undefined' ? performance.now() : Date.now();
        samples.set(id, renderPreset(PRESETS[id] as SfxPreset, sampleRate));
        busy += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - s;
        this.setTimer(step, 0);
      };
      this.setTimer(step, 0);
    });
  }

  dispose(): void {
    try {
      this.worker?.terminate();
    } catch {
      // ignore
    }
    this.worker = null;
  }
}
