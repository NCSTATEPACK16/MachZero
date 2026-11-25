/**
 * Two-operator FM: a sine carrier phase-modulated by a sine at `ratio` × its frequency, with the modulation index on
 * its own decaying envelope (index → indexSus over `indexDecay` s). Bells, the electric piano, the FM bass, metals.
 */
import { TAU } from './osc';

export class Fm {
  private pc = 0;
  private pm = 0;
  private fb = 0;
  constructor(
    private readonly ratio: number,
    private readonly feedback = 0,
  ) {}

  /** One sample at carrier phase step `dt` (Hz / rate) with modulation `index` (radians). */
  next(dt: number, index: number): number {
    const m = Math.sin(TAU * this.pm + this.fb * this.feedback);
    this.fb = m;
    const v = Math.sin(TAU * this.pc + index * m);
    this.pc += dt;
    this.pm += dt * this.ratio;
    if (this.pc >= 1) this.pc -= Math.floor(this.pc);
    if (this.pm >= 1) this.pm -= Math.floor(this.pm);
    return v;
  }
}

/** The index at time t (s). */
export const fmIndex = (index: number, sus: number, decay: number, t: number): number => sus + (index - sus) * Math.exp(-t / Math.max(decay, 1e-4));
