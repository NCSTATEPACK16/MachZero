/**
 * Dynamic resolution: scales the preset's render resolution down when frames miss 60 Hz and back up when they
 * have been clean for a while. WebGL on iOS has no GPU timer, so this works on whole-frame times: at vsync a
 * frame is 16.7 ms whatever the headroom, so the way up is a cautious probe that backs off (the wait doubles)
 * whenever a step up is followed by misses. Changing the scale reallocates the render targets, so it moves at
 * most once per evaluation window.
 */
import { MISSED_FRAME_MS } from '../core/FrameStats';

export const DYNRES_MIN = 0.6;
export const DYNRES_STEP_DOWN = 0.1;
export const DYNRES_STEP_UP = 0.05;
/** Evaluation window (ms of frames). */
export const DYNRES_WINDOW_MS = 1000;
/** Missed-frame fraction in a window that steps down. */
export const DYNRES_DOWN_MISSED = 0.1;
/** At most this missed fraction counts as a clean window. */
export const DYNRES_CLEAN_MISSED = 0.01;
const UP_WAIT_START = 3;
const UP_WAIT_MAX = 30;
/** A step down within this many windows of a step up means the step up was too far. */
const UP_REGRET_WINDOWS = 4;
/** Longer frames are stalls (loading, tab switch, GC), not GPU load: ignored. */
const STALL_MS = 250;

export class DynamicResolution {
  private _scale = 1;
  private windowMs = 0;
  private windowFrames = 0;
  private windowMissed = 0;
  private clean = 0;
  private upWait = UP_WAIT_START;
  private sinceUp = Infinity;

  constructor(private readonly min = DYNRES_MIN) {}

  get scale(): number {
    return this._scale;
  }

  /** Forget the window (call when racing resumes after a pause or loading, so the gap is not judged). */
  resetWindow(): void {
    this.windowMs = this.windowFrames = this.windowMissed = 0;
  }

  /** Feed one frame; returns true when the scale changed. */
  feed(frameMs: number): boolean {
    if (!(frameMs > 0) || frameMs > STALL_MS) return false;
    this.windowMs += frameMs;
    this.windowFrames++;
    if (frameMs > MISSED_FRAME_MS) this.windowMissed++;
    if (this.windowMs < DYNRES_WINDOW_MS) return false;
    const missed = this.windowMissed / this.windowFrames;
    this.resetWindow();
    this.sinceUp++;

    if (missed > DYNRES_DOWN_MISSED) {
      this.clean = 0;
      if (this.sinceUp <= UP_REGRET_WINDOWS) this.upWait = Math.min(UP_WAIT_MAX, this.upWait * 2);
      const next = Math.max(this.min, round2(this._scale - DYNRES_STEP_DOWN));
      if (next === this._scale) return false;
      this._scale = next;
      return true;
    }
    if (missed > DYNRES_CLEAN_MISSED) {
      this.clean = 0;
      return false;
    }
    if (++this.clean < this.upWait || this._scale >= 1) return false;
    this.clean = 0;
    this.sinceUp = 0;
    this._scale = Math.min(1, round2(this._scale + DYNRES_STEP_UP));
    return true;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
