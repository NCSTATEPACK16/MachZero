import { CONFIG } from './config';

export interface LoopCallbacks {
  /** Called 0..MAX_SUBSTEPS times per frame with CONFIG.FIXED_DT. */
  fixed(dt: number): void;
  /** Called once per animation frame. alpha = interpolation between previous and current fixed state. */
  frame(dt: number, alpha: number, time: number): void;
}

/** Fixed-timestep simulation loop with render interpolation. */
export class GameLoop {
  private accumulator = 0;
  private last = 0;
  private running = false;
  private rafId = 0;
  private elapsed = 0;

  constructor(private readonly cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      this.advance(Math.min((now - this.last) / 1000, CONFIG.MAX_FRAME_DT));
      this.last = now;
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Advance by a real-time delta (exposed for headless tests). */
  advance(dt: number): void {
    const step = CONFIG.FIXED_DT;
    this.accumulator += dt;
    this.elapsed += dt;
    let steps = 0;
    while (this.accumulator >= step && steps < CONFIG.MAX_SUBSTEPS) {
      this.cb.fixed(step);
      this.accumulator -= step;
      steps++;
    }
    if (steps === CONFIG.MAX_SUBSTEPS) this.accumulator = Math.min(this.accumulator, step);
    this.cb.frame(dt, this.accumulator / step, this.elapsed);
  }
}
