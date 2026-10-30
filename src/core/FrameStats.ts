/**
 * Frame-time statistics for the perf overlay (`?perf=1`) and the race summary: a ring buffer of recent frames
 * (for percentiles and the graph), plus running totals since the last `resetRun()` (one race). Times in ms.
 * Allocation-free per frame.
 */

/** A frame slower than this missed a 60 Hz vsync (16.7 ms × 1.25). */
export const MISSED_FRAME_MS = 20.8;
/** A frame slower than this is a visible hitch. */
export const HITCH_MS = 50;

export interface FrameSample {
  /** Wall time since the previous frame. */
  frameMs: number;
  /** Fixed steps (physics, AI, race) run this frame. */
  simMs: number;
  /** Per-frame presentation: graphics update, HUD, audio. */
  updateMs: number;
  /** Render submission (CPU side of the GPU work). */
  renderMs: number;
}

export interface FrameSummary {
  frames: number;
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  worst: number;
  /** Fraction of frames over MISSED_FRAME_MS. */
  missed: number;
  hitches: number;
  simMs: number;
  updateMs: number;
  renderMs: number;
}

export class FrameStats {
  /** Recent frame times, oldest first from `head` (exposed for the graph). */
  readonly ring: Float32Array;
  private head = 0;
  private count = 0;
  private readonly sorted: Float32Array;
  // recent-window phase averages (exponential)
  private sim = 0;
  private update = 0;
  private render = 0;
  // run totals
  private runFrames = 0;
  private runTime = 0;
  private runMissed = 0;
  private runHitches = 0;
  private runWorst = 0;

  constructor(readonly capacity = 240) {
    this.ring = new Float32Array(capacity);
    this.sorted = new Float32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** Index in `ring` of the oldest sample. */
  get start(): number {
    return this.count < this.capacity ? 0 : this.head;
  }

  push(s: FrameSample): void {
    this.ring[this.head] = s.frameMs;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    const k = this.runFrames === 0 ? 1 : 0.05;
    this.sim += (s.simMs - this.sim) * k;
    this.update += (s.updateMs - this.update) * k;
    this.render += (s.renderMs - this.render) * k;
    this.runFrames++;
    this.runTime += s.frameMs;
    if (s.frameMs > MISSED_FRAME_MS) this.runMissed++;
    if (s.frameMs > HITCH_MS) this.runHitches++;
    if (s.frameMs > this.runWorst) this.runWorst = s.frameMs;
  }

  /** Start a new run (a race); the recent window is kept for the graph. */
  resetRun(): void {
    this.runFrames = this.runTime = this.runMissed = this.runHitches = this.runWorst = 0;
  }

  /** Percentiles over the recent window; fps, missed, hitches and worst over the run. */
  summary(): FrameSummary {
    const n = this.count;
    this.sorted.set(this.ring);
    const view = this.sorted.subarray(0, n).sort();
    const pct = (p: number) => (n === 0 ? 0 : view[Math.min(n - 1, Math.floor(p * n))]);
    return {
      frames: this.runFrames,
      fps: this.runTime > 0 ? (this.runFrames * 1000) / this.runTime : 0,
      p50: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
      worst: this.runWorst,
      missed: this.runFrames > 0 ? this.runMissed / this.runFrames : 0,
      hitches: this.runHitches,
      simMs: this.sim,
      updateMs: this.update,
      renderMs: this.render,
    };
  }
}
