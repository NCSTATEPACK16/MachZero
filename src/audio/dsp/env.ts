/**
 * Envelopes: an ADSR with a linear attack and exponential decay and release, and a decaying pitch envelope.
 * Times are in seconds. The release falls 60 dB over its time and is exactly 0 at its end.
 */

export interface Adsr {
  a: number;
  d: number;
  s: number;
  r: number;
}

/** The ADSR's level `n` samples after note-on, with the gate held for `gate` samples. */
export class Envelope {
  private level = 0;
  private relFrom = 0;
  private readonly aN: number;
  private readonly dK: number;
  private readonly rN: number;
  private readonly rK: number;

  constructor(
    private readonly e: Adsr,
    private readonly gate: number,
    sampleRate: number,
  ) {
    this.aN = Math.max(1, Math.round(e.a * sampleRate));
    this.dK = Math.exp(-5 / Math.max(1, e.d * sampleRate));
    this.rN = Math.max(1, Math.round(e.r * sampleRate));
    this.rK = Math.exp(-6.9 / this.rN);
  }

  /** Samples from note-on to silence. */
  get length(): number {
    return this.gate + this.rN;
  }

  /** The level at sample `n` (call with n = 0, 1, 2, … in order). */
  at(n: number): number {
    if (n < this.gate) {
      if (n < this.aN) this.level = n / this.aN;
      else this.level = this.e.s + (this.level - this.e.s) * this.dK;
      this.relFrom = this.level;
      return this.level;
    }
    const k = n - this.gate;
    if (k >= this.rN) return (this.level = 0);
    if (k === 0) this.level = this.relFrom;
    // An exponential fall, bent to reach exactly 0 at the end.
    this.level *= this.rK;
    return this.level * (1 - (k + 1) / this.rN) ** 0.25;
  }
}

/** A pitch envelope: `semis` at note-on, decaying with time constant `decay` (s). */
export const pitchEnv = (semis: number, decay: number, t: number): number => (semis === 0 ? 0 : semis * Math.exp(-t / Math.max(decay, 1e-4)));
