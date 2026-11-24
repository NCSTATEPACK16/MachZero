/**
 * Effects (IMPLEMENTATION §M6b), processed in blocks:
 *  - a stereo ping-pong delay, tempo-synced, with feedback and a one-pole low-pass in the loop;
 *  - a reverb after Freeverb (4 parallel damped combs and 2 all-passes per channel, size and damping 0..1);
 *  - a chorus (two short delays modulated by a sine, one per side);
 *  - drive (tanh), bit crush, and the sidechain pump.
 * Every effect here is linear (or time-invariant) apart from drive and crush, which run inside a voice; so a loop's
 * tail can be folded onto its start exactly (render.ts).
 */
import { OnePole } from './filter';
import { TAU } from './osc';

export class Delay {
  private readonly l: Float32Array;
  private readonly r: Float32Array;
  private readonly n: number;
  private i = 0;
  private readonly lpL: OnePole;
  private readonly lpR: OnePole;

  /** `seconds` of delay (rounded to a sample), `feedback` 0..0.95, `tone` the loop's low-pass in Hz. */
  constructor(
    seconds: number,
    private readonly feedback: number,
    tone: number,
    sampleRate: number,
  ) {
    this.n = Math.max(1, Math.round(seconds * sampleRate));
    this.l = new Float32Array(this.n);
    this.r = new Float32Array(this.n);
    this.lpL = new OnePole(tone, sampleRate);
    this.lpR = new OnePole(tone, sampleRate);
  }

  /** Mono `input` in, adds the wet stereo to `outL` / `outR`. The first repeat is on the left, then right, left… */
  process(input: Float32Array, outL: Float32Array, outR: Float32Array, len = input.length): void {
    const fb = this.feedback;
    for (let k = 0; k < len; k++) {
      const yl = this.l[this.i];
      const yr = this.r[this.i];
      this.l[this.i] = input[k] + this.lpR.process(yr) * fb;
      this.r[this.i] = this.lpL.process(yl) * fb;
      outL[k] += yl;
      outR[k] += yr;
      if (++this.i >= this.n) this.i = 0;
    }
  }
}

class Comb {
  private readonly buf: Float32Array;
  private i = 0;
  private store = 0;
  constructor(
    size: number,
    private readonly feedback: number,
    private readonly damp: number,
  ) {
    this.buf = new Float32Array(size);
  }
  process(x: number): number {
    const y = this.buf[this.i];
    this.store = y * (1 - this.damp) + this.store * this.damp;
    this.buf[this.i] = x + this.store * this.feedback;
    if (++this.i >= this.buf.length) this.i = 0;
    return y;
  }
}

class AllPass {
  private readonly buf: Float32Array;
  private i = 0;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  process(x: number): number {
    const b = this.buf[this.i];
    this.buf[this.i] = x + b * 0.5;
    if (++this.i >= this.buf.length) this.i = 0;
    return b - x;
  }
}

/** Freeverb's tunings at 44.1 kHz (4 of its 8 combs, 2 of its 4 all-passes) and its stereo spread. */
const COMBS = [1116, 1277, 1422, 1557];
const ALLPASSES = [556, 341];
const SPREAD = 23;

export class Reverb {
  private readonly cl: Comb[];
  private readonly cr: Comb[];
  private readonly al: AllPass[];
  private readonly ar: AllPass[];

  /** size and damp 0..1. */
  constructor(size: number, damp: number, sampleRate: number) {
    const k = sampleRate / 44100;
    const fb = 0.7 + 0.28 * Math.min(Math.max(size, 0), 1);
    const d = 0.4 * Math.min(Math.max(damp, 0), 1);
    this.cl = COMBS.map((c) => new Comb(Math.round(c * k), fb, d));
    this.cr = COMBS.map((c) => new Comb(Math.round((c + SPREAD) * k), fb, d));
    this.al = ALLPASSES.map((c) => new AllPass(Math.round(c * k)));
    this.ar = ALLPASSES.map((c) => new AllPass(Math.round((c + SPREAD) * k)));
  }

  /** Mono `input` in, adds the wet stereo to `outL` / `outR`. */
  process(input: Float32Array, outL: Float32Array, outR: Float32Array, len = input.length): void {
    for (let k = 0; k < len; k++) {
      const x = input[k] * 0.1;
      let l = 0;
      let r = 0;
      for (let c = 0; c < 4; c++) {
        l += this.cl[c].process(x);
        r += this.cr[c].process(x);
      }
      for (let a = 0; a < 2; a++) {
        l = this.al[a].process(l);
        r = this.ar[a].process(r);
      }
      outL[k] += l;
      outR[k] += r;
    }
  }
}

/**
 * A chorus: each side reads a short delay (`base` s ± `depth` s) modulated by a sine at `rate` Hz, the right side a
 * quarter cycle behind. `t0` is the first sample's index on the segment's own clock, so the modulation is periodic
 * with the loop when `rate` fits it a whole number of times (the renderer picks such a rate).
 */
export class Chorus {
  private readonly buf: Float32Array;
  private w = 0;
  constructor(
    private readonly rate: number,
    private readonly sampleRate: number,
    private readonly base = 0.012,
    private readonly depth = 0.004,
  ) {
    this.buf = new Float32Array(Math.ceil((base + depth) * sampleRate) + 4);
  }

  /** Mono in; writes `mix` of the chorused signal (plus the dry) to outL / outR. */
  process(input: Float32Array, outL: Float32Array, outR: Float32Array, len: number, t0: number, mix: number, gl: number, gr: number): void {
    const n = this.buf.length;
    const sr = this.sampleRate;
    for (let k = 0; k < len; k++) {
      this.buf[this.w] = input[k];
      const ph = (TAU * this.rate * (t0 + k)) / sr;
      const dl = (this.base + this.depth * Math.sin(ph)) * sr;
      const dr = (this.base + this.depth * Math.cos(ph)) * sr;
      const wl = read(this.buf, this.w - dl, n);
      const wr = read(this.buf, this.w - dr, n);
      outL[k] += (input[k] * (1 - mix) + wl * mix) * gl;
      outR[k] += (input[k] * (1 - mix) + wr * mix) * gr;
      if (++this.w >= n) this.w = 0;
    }
  }
}

function read(buf: Float32Array, pos: number, n: number): number {
  let p = pos;
  while (p < 0) p += n;
  const i = Math.floor(p);
  const f = p - i;
  return buf[i % n] * (1 - f) + buf[(i + 1) % n] * f;
}

/** Drive: tanh with a gain, levelled so a full-scale input stays near full scale. */
export const drive = (x: number, gain: number): number => (gain <= 0 ? x : Math.tanh(x * (1 + gain)) / Math.tanh(1 + gain));

/** Bit crush in place: `bits` of depth and a sample-and-hold of `hold` samples. */
export function crush(buf: Float32Array, bits: number, hold = 1): void {
  if (!bits) return;
  const q = Math.pow(2, bits - 1);
  let held = 0;
  for (let i = 0; i < buf.length; i++) {
    if (i % hold === 0) held = Math.round(buf[i] * q) / q;
    buf[i] = held;
  }
}

/**
 * The sidechain pump: the gain at time `t` given the trigger's hit times (sorted). Each hit drops the gain to
 * 1 − depth, which recovers over `release` s along a squared curve.
 */
export function pumpGain(hits: Float64Array, t: number, depth: number, release: number, from = 0): { gain: number; index: number } {
  let i = from;
  while (i + 1 < hits.length && hits[i + 1] <= t) i++;
  while (i > 0 && hits[i] > t) i--;
  const h = hits[i];
  if (h === undefined || h > t) return { gain: 1, index: i };
  const x = (t - h) / release;
  return { gain: x >= 1 ? 1 : 1 - depth * (1 - x) * (1 - x), index: i };
}
