/** Test helpers: a radix-2 FFT power spectrum and band energies. */
export function powerSpectrum(x: Float32Array, n = 8192, offset = 0): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (x[offset + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
  const p = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
  return p;
}

export function bandEnergy(p: Float64Array, sampleRate: number, lo: number, hi: number): number {
  const n = p.length * 2;
  let s = 0;
  for (let i = Math.ceil((lo * n) / sampleRate); i < Math.min(p.length, (hi * n) / sampleRate); i++) s += p[i];
  return s;
}

export const peakOf = (b: Float32Array): number => {
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]));
  return m;
};

export const rms = (b: Float32Array, from = 0, to = b.length): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += b[i] * b[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
