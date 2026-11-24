/**
 * A jsfxr-style sound-effect synthesiser (IMPLEMENTATION §M6a). Pure: parameters in, mono Float32 samples out, no Web
 * Audio, so it runs in the render Worker, on the main thread (the fallback) and in Node tests alike.
 *
 * The synthesis follows DrPetter's sfxr (and jsfxr): an oscillator (square with duty sweep, saw, sine or noise) at
 * 8× oversampling, a frequency slide with its own delta, vibrato, an arpeggio jump, an attack-sustain(+punch)-decay
 * envelope, a resonant low-pass with sweep, a high-pass with sweep, and a repeat that restarts the pitch section.
 * Parameters keep sfxr's 0..1 (or −1..1) ranges so presets can be tuned by ear in any sfxr editor and copied here.
 * The noise is seeded, so the same parameters always give the same samples.
 */

export type SfxrWave = 'square' | 'saw' | 'sine' | 'noise';

export interface SfxrParams {
  wave: SfxrWave;
  /** Envelope 0..1 (length grows with the square: 1 ≈ 2.27 s). */
  attack?: number;
  sustain?: number;
  /** Extra level at the start of the sustain 0..1. */
  punch?: number;
  decay?: number;
  /** Start frequency 0..1 (0.3 ≈ 440 Hz), the lowest frequency 0..1 before the sound stops, the slide and its change −1..1. */
  freq: number;
  freqLimit?: number;
  slide?: number;
  deltaSlide?: number;
  /** Vibrato depth and speed 0..1. */
  vibDepth?: number;
  vibSpeed?: number;
  /** Arpeggio: pitch multiplier −1..1 and how soon it jumps 0..1. */
  arpMod?: number;
  arpSpeed?: number;
  /** Square duty 0..1 and its sweep −1..1. */
  duty?: number;
  dutySweep?: number;
  /** Restart the pitch section this often 0..1 (0 = never). */
  repeat?: number;
  /** Low-pass cutoff 0..1 (1 = open), its sweep −1..1 and resonance 0..1. */
  lpf?: number;
  lpfSweep?: number;
  lpfResonance?: number;
  /** High-pass cutoff 0..1 and its sweep −1..1. */
  hpf?: number;
  hpfSweep?: number;
  /** Noise seed. */
  seed?: number;
}

/** sfxr's native rate; other rates are resampled from it. */
export const SFXR_RATE = 44100;
const OVERSAMPLE = 8;

/** The envelope's length in samples at SFXR_RATE (the sound's full length unless the frequency limit cuts it). */
export function sfxrLength(p: SfxrParams): number {
  const a = Math.floor(sq(p.attack ?? 0) * 100000);
  const s = Math.floor(sq(p.sustain ?? 0.3) * 100000);
  const d = Math.floor(sq(p.decay ?? 0.4) * 100000);
  return a + s + d + 3;
}

const sq = (x: number): number => x * x;
const cube = (x: number): number => x * x * x;

function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Render one preset to mono samples, peak-normalised to `peak` (default 0.9). */
export function renderSfxr(p: SfxrParams, sampleRate = SFXR_RATE, peak = 0.9): Float32Array {
  const raw = synth(p);
  normalise(raw, peak);
  return sampleRate === SFXR_RATE ? raw : resample(raw, SFXR_RATE, sampleRate);
}

function synth(p: SfxrParams): Float32Array {
  const random = rng(p.seed ?? 1);
  const wave = p.wave;
  const attack = p.attack ?? 0;
  const sustain = p.sustain ?? 0.3;
  const punch = p.punch ?? 0;
  const decay = p.decay ?? 0.4;
  const freqLimit = p.freqLimit ?? 0;
  const lpfFreq = p.lpf ?? 1;

  // The pitch section (restarted by the repeat).
  let fperiod = 0;
  let fmaxperiod = 0;
  let fslide = 0;
  let fdslide = 0;
  let squareDuty = 0;
  let squareSlide = 0;
  let arpMod = 0;
  let arpTime = 0;
  let arpLimit = 0;
  const resetPitch = (): void => {
    fperiod = 100 / (sq(p.freq) + 0.001);
    fmaxperiod = 100 / (sq(freqLimit) + 0.001);
    fslide = 1 - cube(p.slide ?? 0) * 0.01;
    fdslide = -cube(p.deltaSlide ?? 0) * 0.000001;
    squareDuty = 0.5 - (p.duty ?? 0) * 0.5;
    squareSlide = -(p.dutySweep ?? 0) * 0.00005;
    const am = p.arpMod ?? 0;
    arpMod = am >= 0 ? 1 - sq(am) * 0.9 : 1 + sq(am) * 10;
    arpTime = 0;
    const as = p.arpSpeed ?? 0;
    arpLimit = as === 1 ? 0 : Math.floor(sq(1 - as) * 20000 + 32);
    if ((p.arpMod ?? 0) === 0) arpLimit = 0;
  };
  resetPitch();

  // Filters, vibrato, envelope.
  let fltp = 0;
  let fltdp = 0;
  let fltw = cube(lpfFreq) * 0.1;
  const fltwD = 1 + (p.lpfSweep ?? 0) * 0.0001;
  let fltdmp = (5 / (1 + sq(p.lpfResonance ?? 0) * 20)) * (0.01 + fltw);
  if (fltdmp > 0.8) fltdmp = 0.8;
  let fltphp = 0;
  let flthp = sq(p.hpf ?? 0) * 0.1;
  const flthpD = 1 + (p.hpfSweep ?? 0) * 0.0003;
  let vibPhase = 0;
  const vibSpeed = sq(p.vibSpeed ?? 0) * 0.01;
  const vibAmp = (p.vibDepth ?? 0) * 0.5;
  const envLength = [Math.floor(sq(attack) * 100000), Math.floor(sq(sustain) * 100000), Math.floor(sq(decay) * 100000)];
  let envStage = 0;
  let envTime = 0;
  let envVol = 0;
  const rep = p.repeat ?? 0;
  const repLimit = rep === 0 ? 0 : Math.floor(sq(1 - rep) * 20000 + 32);
  let repTime = 0;

  const noise = new Float32Array(32);
  const fillNoise = (): void => {
    for (let i = 0; i < 32; i++) noise[i] = random() * 2 - 1;
  };
  fillNoise();
  let phase = 0;

  const out = new Float32Array(sfxrLength(p));
  let n = 0;
  for (; n < out.length; n++) {
    repTime++;
    if (repLimit !== 0 && repTime >= repLimit) {
      repTime = 0;
      resetPitch();
    }
    arpTime++;
    if (arpLimit !== 0 && arpTime >= arpLimit) {
      arpLimit = 0;
      fperiod *= arpMod;
    }
    fslide += fdslide;
    fperiod *= fslide;
    if (fperiod > fmaxperiod) {
      fperiod = fmaxperiod;
      if (freqLimit > 0) break;
    }
    let rfperiod = fperiod;
    if (vibAmp > 0) {
      vibPhase += vibSpeed;
      rfperiod = fperiod * (1 + Math.sin(vibPhase) * vibAmp);
    }
    let period = Math.floor(rfperiod);
    if (period < 8) period = 8;
    squareDuty += squareSlide;
    if (squareDuty < 0) squareDuty = 0;
    if (squareDuty > 0.5) squareDuty = 0.5;

    envTime++;
    while (envStage < 3 && envTime > envLength[envStage]) {
      envTime = 0;
      envStage++;
    }
    if (envStage === 3) break;
    if (envStage === 0) envVol = envLength[0] > 0 ? envTime / envLength[0] : 1;
    else if (envStage === 1) envVol = 1 + (1 - envTime / Math.max(1, envLength[1])) * 2 * punch;
    else envVol = 1 - envTime / Math.max(1, envLength[2]);

    if (flthpD !== 1) {
      flthp *= flthpD;
      if (flthp < 0.00001) flthp = 0.00001;
      if (flthp > 0.1) flthp = 0.1;
    }

    let ssample = 0;
    for (let si = 0; si < OVERSAMPLE; si++) {
      let sample = 0;
      phase++;
      if (phase >= period) {
        phase %= period;
        if (wave === 'noise') fillNoise();
      }
      const fp = phase / period;
      switch (wave) {
        case 'square':
          sample = fp < squareDuty ? 0.5 : -0.5;
          break;
        case 'saw':
          sample = 1 - fp * 2;
          break;
        case 'sine':
          sample = Math.sin(fp * 2 * Math.PI);
          break;
        case 'noise':
          sample = noise[Math.floor((phase * 32) / period) % 32];
          break;
      }
      const pp = fltp;
      fltw *= fltwD;
      if (fltw < 0) fltw = 0;
      if (fltw > 0.1) fltw = 0.1;
      if (lpfFreq !== 1) {
        fltdp += (sample - fltp) * fltw;
        fltdp -= fltdp * fltdmp;
      } else {
        fltp = sample;
        fltdp = 0;
      }
      fltp += fltdp;
      fltphp += fltp - pp;
      fltphp -= fltphp * flthp;
      ssample += fltphp * envVol;
    }
    out[n] = ssample / OVERSAMPLE;
  }
  return n < out.length ? out.slice(0, n) : out;
}

/** Scale in place so the peak is `peak` (a silent buffer stays silent). */
export function normalise(buf: Float32Array, peak: number): void {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > max) max = a;
  }
  if (max <= 1e-9) return;
  const k = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= k;
}

/** Linear resampling (presets are short and bright content is already band-limited by the oversampling). */
export function resample(src: Float32Array, from: number, to: number): Float32Array {
  const len = Math.max(1, Math.round((src.length * to) / from));
  const out = new Float32Array(len);
  const step = from / to;
  for (let i = 0; i < len; i++) {
    const x = i * step;
    const i0 = Math.floor(x);
    const f = x - i0;
    const a = src[i0] ?? 0;
    const b = src[i0 + 1] ?? a;
    out[i] = a + (b - a) * f;
  }
  return out;
}
