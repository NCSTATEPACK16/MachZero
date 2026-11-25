/**
 * Loudness (ITU-R BS.1770-4) and true peak, for normalising songs and stingers (IMPLEMENTATION decision J: −14 LUFS
 * integrated, peaks ≤ −1 dBFS).
 *  - K-weighting: the high shelf and the high-pass of BS.1770, computed for any sample rate from their analog
 *    prototypes (frequency, gain and Q) as libebur128 does; at 48 kHz they give BS.1770's own coefficients.
 *  - Gating: 400 ms blocks every 100 ms; an absolute gate at −70 LUFS, then a relative gate 10 LU below the
 *    absolute-gated loudness.
 *  - True peak: 4× oversampling by a windowed-sinc interpolator, evaluated around the loud samples only.
 * Both are incremental (`push` a range at a time), so the main-thread fallback can measure in slices.
 */

class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}
  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: the high shelf (+4 dB above ~1.7 kHz), as libebur128 derives it for any rate.
  let K = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  let Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = new Biquad((Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  // Stage 2: the high-pass (~38 Hz).
  K = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const hp = new Biquad(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  return [shelf, hp];
}

/** Integrated loudness, fed in ranges. */
export class LoudnessMeter {
  private readonly filters: Array<[Biquad, Biquad]>;
  private readonly hop: number;
  private acc = 0;
  private count = 0;
  /** Per 100 ms hop: the sum over channels of the mean square. */
  private readonly hops: number[] = [];

  constructor(
    sampleRate: number,
    channels: number,
  ) {
    this.filters = Array.from({ length: channels }, () => kWeighting(sampleRate));
    this.hop = Math.round(sampleRate * 0.1);
  }

  push(chs: readonly Float32Array[], from = 0, to = chs[0].length): void {
    for (let i = from; i < to; i++) {
      for (let c = 0; c < chs.length; c++) {
        const f = this.filters[c];
        const y = f[1].process(f[0].process(chs[c][i]));
        this.acc += y * y;
      }
      if (++this.count === this.hop) {
        this.hops.push(this.acc / this.hop);
        this.acc = 0;
        this.count = 0;
      }
    }
  }

  /** LUFS (−Infinity for silence or less than 400 ms). */
  integrated(): number {
    const blocks: number[] = [];
    for (let j = 0; j + 4 <= this.hops.length; j++) blocks.push((this.hops[j] + this.hops[j + 1] + this.hops[j + 2] + this.hops[j + 3]) / 4);
    const lk = (z: number) => -0.691 + 10 * Math.log10(z);
    const abs = blocks.filter((z) => z > 0 && lk(z) > -70);
    if (abs.length === 0) return -Infinity;
    const rel = lk(abs.reduce((s, z) => s + z, 0) / abs.length) - 10;
    const gated = abs.filter((z) => lk(z) > rel);
    return lk(gated.reduce((s, z) => s + z, 0) / gated.length);
  }
}

const TAPS = 8;
/** Hann-windowed sinc weights for the three in-between positions 0.25, 0.5, 0.75. */
const WEIGHTS: Float64Array[] = [0.25, 0.5, 0.75].map((f) => {
  const w = new Float64Array(2 * TAPS);
  for (let k = -TAPS + 1; k <= TAPS; k++) {
    const x = k - f;
    const sinc = Math.sin(Math.PI * x) / (Math.PI * x);
    const hann = 0.5 + 0.5 * Math.cos((Math.PI * x) / (TAPS + 1));
    w[k + TAPS - 1] = sinc * hann;
  }
  return w;
});

/** The true peak (linear), fed in ranges. */
export class TruePeakMeter {
  peak = 0;
  push(chs: readonly Float32Array[], from = 0, to = chs[0].length): void {
    for (const x of chs) {
      const n = x.length;
      for (let i = from; i < to; i++) {
        const a = Math.abs(x[i]);
        if (a > this.peak) this.peak = a;
        if (a < this.peak * 0.5 || i < TAPS - 1 || i + TAPS >= n) continue;
        for (const w of WEIGHTS) {
          let s = 0;
          for (let k = 0; k < 2 * TAPS; k++) s += x[i - TAPS + 1 + k] * w[k];
          const v = Math.abs(s);
          if (v > this.peak) this.peak = v;
        }
      }
    }
  }
}

export const toDb = (v: number): number => 20 * Math.log10(v);

/** Integrated loudness of whole buffers. */
export function lufs(chs: readonly Float32Array[], sampleRate: number): number {
  const m = new LoudnessMeter(sampleRate, chs.length);
  m.push(chs);
  return m.integrated();
}

/** True peak of whole buffers (linear). */
export function truePeak(chs: readonly Float32Array[]): number {
  const m = new TruePeakMeter();
  m.push(chs);
  return m.peak;
}
