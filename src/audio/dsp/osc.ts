/**
 * Oscillators (IMPLEMENTATION §M6b): band-limited saw and pulse by polyBLEP, a triangle integrated from the pulse,
 * sine, and seeded white and pink noise. Pure: phases in 0..1, `dt` = frequency / sample rate.
 */

export const TAU = Math.PI * 2;

/** The polyBLEP residual for a step at phase 0 (t: phase 0..1, dt: phase step). */
export function blep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** A band-limited saw, −1..1, rising. */
export function saw(phase: number, dt: number): number {
  return 2 * phase - 1 - blep(phase, dt);
}

/** A band-limited pulse of `width` (0.05..0.95), −1..1. */
export function pulse(phase: number, dt: number, width: number): number {
  let p2 = phase + 1 - width;
  if (p2 >= 1) p2 -= 1;
  return (phase < width ? 1 : -1) + blep(phase, dt) - blep(p2, dt);
}

/** A seeded generator in [0, 1) (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A string's 32-bit hash (FNV-1a): song ids seed the noise. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Pink noise (Paul Kellet's economy filter) over a white source. */
export function pinkNoise(white: () => number): () => number {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  return () => {
    const w = white() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.25;
  };
}

export type Wave = 'saw' | 'pulse' | 'tri' | 'sine' | 'noise';

/**
 * The residual of a 4-point band-limited step (the integral of a cubic B-spline, minus the step) at `x` samples from
 * the discontinuity. Four samples around each jump are corrected, which rejects aliasing far better than the 2-point
 * polyBLEP (`blep`) at the cost of two samples of delay.
 */
export function blep4(x: number): number {
  if (x <= -2 || x >= 2) return 0;
  if (x < -1) return (2 + x) ** 4 / 24;
  if (x < 0) return 1 / 24 + (4 * x - 2 * x ** 3 - 0.75 * x ** 4 + 2.75) / 6;
  if (x < 1) return -(1 / 24 + (-4 * x + 2 * x ** 3 - 0.75 * x ** 4 + 2.75) / 6);
  return -((2 - x) ** 4) / 24;
}

/**
 * One oscillator's state. Saw and pulse are band-limited by `blep4` (their output runs two samples late); `tri`
 * integrates the band-limited pulse (a leaky integrator scaled by the frequency).
 */
export class Osc {
  phase = 0;
  private tri = -1;
  /** Samples n−2, n−1, n and the corrections waiting for n+1. */
  private readonly q = new Float64Array(4);

  constructor(
    readonly wave: Wave,
    private readonly noise: () => number = Math.random,
  ) {}

  /** Start at `p` (0..1), with the triangle's integrator where the phase puts it. */
  setPhase(p: number): void {
    this.phase = p;
    this.tri = p < 0.5 ? -1 + 4 * p : 3 - 4 * p;
  }

  /** A jump of `h` that happened `d` samples (0..1) before the current sample. */
  private jump(h: number, d: number): void {
    const q = this.q;
    q[0] += h * blep4(d - 2);
    q[1] += h * blep4(d - 1);
    q[2] += h * blep4(d);
    q[3] += h * blep4(d + 1);
  }

  private stepped(dt: number, width: number): number {
    // Advance, then place this sample's naive value and the corrections for any jump since the last one.
    let p = this.phase + dt;
    const wrapped = p >= 1;
    if (wrapped) p -= Math.floor(p);
    const prev = this.phase;
    this.phase = p;
    const q = this.q;
    if (this.wave === 'saw') {
      q[2] += 2 * p - 1;
      if (wrapped) this.jump(-2, p / dt);
    } else {
      q[2] += p < width ? 1 : -1;
      if (wrapped) this.jump(2, p / dt);
      // The fall at `width`: crossed since the last sample (before the wrap, or after it).
      if (wrapped ? prev < width : prev < width && p >= width) this.jump(-2, (wrapped ? p + 1 - width : p - width) / dt);
      else if (wrapped && p >= width) this.jump(-2, (p - width) / dt);
    }
    const out = q[0];
    q[0] = q[1];
    q[1] = q[2];
    q[2] = q[3];
    q[3] = 0;
    return out;
  }

  next(dt: number, width = 0.5): number {
    switch (this.wave) {
      case 'saw':
      case 'pulse':
        return this.stepped(dt, width);
      case 'tri':
        this.tri = this.tri * (1 - dt * 0.05) + 4 * dt * this.stepped(dt, 0.5);
        return this.tri;
      case 'sine': {
        const v = Math.sin(TAU * this.phase);
        this.phase += dt;
        if (this.phase >= 1) this.phase -= Math.floor(this.phase);
        return v;
      }
      default:
        return this.noise() * 2 - 1;
    }
  }
}

/** MIDI note number → Hz (A4 = 69 = 440 Hz). */
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
