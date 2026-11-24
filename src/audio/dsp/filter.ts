/**
 * A topology-preserving-transform state-variable filter (Zavalishin / Simper): low-pass, band-pass and high-pass from
 * one structure, stable under fast cutoff changes. Coefficients are set per 128-sample block (`set`), smoothed by the
 * caller's envelope.
 */
export type FilterMode = 'lp' | 'bp' | 'hp';

export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 1;
  private a2 = 0;
  private a3 = 0;
  private k = Math.SQRT2;

  constructor(private readonly sampleRate: number) {}

  /** Cutoff in Hz; resonance 0..1 (0 = Q 0.707, 1 = Q 10). */
  set(cutoff: number, res = 0): this {
    const fc = Math.min(Math.max(cutoff, 10), this.sampleRate * 0.45);
    const g = Math.tan((Math.PI * fc) / this.sampleRate);
    this.k = 1 / (0.7071 + 9.3 * Math.min(Math.max(res, 0), 1));
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    return this;
  }

  process(v0: number, mode: FilterMode): number {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return mode === 'lp' ? v2 : mode === 'bp' ? v1 : v0 - this.k * v1 - v2;
  }
}

/** A one-pole low-pass (the delay's tone, the reverb's damping). */
export class OnePole {
  y = 0;
  private a = 0;
  constructor(cutoff: number, sampleRate: number) {
    this.a = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  }
  process(x: number): number {
    this.y = x + this.a * (this.y - x);
    return this.y;
  }
}
