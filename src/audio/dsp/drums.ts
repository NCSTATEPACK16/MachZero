/**
 * Drum voices (IMPLEMENTATION §M6b): each hit is rendered whole, from a recipe and a seeded noise source, so the same
 * hit always gives the same samples (a drum machine; seamless loops depend on it). Kinds:
 *   kick   a sine with a pitch drop and a click          tom    the same, tuned higher, longer
 *   snare  noise and a body tone                         clap   three noise bursts and a tail
 *   hat    six square partials (as the 808) high-passed  rim    a short tone and a click
 *   shaker high-passed noise with a soft attack          cymbal FM metal and noise (ride, crash)
 *   metal  inharmonic FM                                 (any kind may be bit-crushed: the -chip drums)
 */
import { Svf } from './filter';
import { Fm } from './fm';
import { pulse, TAU } from './osc';

export type DrumKind = 'kick' | 'snare' | 'clap' | 'hat' | 'tom' | 'rim' | 'shaker' | 'cymbal' | 'metal';

export interface DrumParams {
  kind: DrumKind;
  /** Body pitch (Hz) and where a pitch drop starts, as a multiple of it. */
  tune: number;
  drop?: number;
  /** Seconds: the body's decay, the noise's decay, the whole hit's length. */
  decay: number;
  noiseDecay?: number;
  length: number;
  /** Noise level against the body, 0..1; noise filter centre (Hz). */
  noise?: number;
  tone?: number;
  /** Seconds the noise holds before it is cut (gated snare). */
  gate?: number;
  /** Bit depth of a crusher (0 = off) and its sample-hold factor. */
  crush?: number;
  hold?: number;
  /** FM ratio and index (metal, cymbal). */
  ratio?: number;
  index?: number;
  level?: number;
}

const decayK = (t: number, d: number) => Math.exp(-t / Math.max(d, 1e-4));

/** Render one hit at `velocity` (0..1). */
export function renderDrum(p: DrumParams, velocity: number, sampleRate: number, rand: () => number): Float32Array {
  const n = Math.max(1, Math.round(p.length * sampleRate));
  const out = new Float32Array(n);
  const noiseAmt = p.noise ?? 0;
  const nd = p.noiseDecay ?? p.decay;
  const bp = new Svf(sampleRate).set(p.tone ?? 3000, 0.25);
  const hp = new Svf(sampleRate).set(p.kind === 'hat' || p.kind === 'cymbal' ? 6500 : p.kind === 'shaker' ? 5500 : 120, 0);
  const fm = new Fm(p.ratio ?? 1.41, 0.3);
  let phase = 0;
  const parts = [1, 1.483, 1.932, 2.546, 2.63, 3.897];
  const ph = new Float64Array(6);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let body = 0;
    let nz = 0;
    switch (p.kind) {
      case 'kick':
      case 'tom': {
        const f = p.tune * (1 + ((p.drop ?? 3) - 1) * decayK(t, p.kind === 'kick' ? 0.03 : 0.05));
        phase += f / sampleRate;
        body = Math.sin(TAU * phase) * decayK(t, p.decay);
        if (t < 0.004) nz = (rand() * 2 - 1) * (1 - t / 0.004);
        break;
      }
      case 'snare':
      case 'rim': {
        phase += p.tune / sampleRate;
        body = (Math.sin(TAU * phase) + 0.5 * Math.sin(TAU * phase * 1.73)) * 0.7 * decayK(t, p.decay);
        nz = bp.process(rand() * 2 - 1, 'bp') * 1.6 + (rand() * 2 - 1) * 0.35;
        nz *= p.gate !== undefined ? (t < p.gate ? 1 : decayK(t - p.gate, 0.008)) : decayK(t, nd);
        break;
      }
      case 'clap': {
        const burst = t < 0.03 ? decayK(t % 0.01, 0.0025) : decayK(t - 0.03, nd);
        nz = bp.process(rand() * 2 - 1, 'bp') * 2.2 * burst;
        break;
      }
      case 'hat': {
        let s = 0;
        for (let k = 0; k < 6; k++) {
          ph[k] += (p.tune * parts[k]) / sampleRate;
          if (ph[k] >= 1) ph[k] -= 1;
          s += pulse(ph[k], (p.tune * parts[k]) / sampleRate, 0.5);
        }
        body = hp.process(s / 6 + (rand() * 2 - 1) * 0.3, 'hp') * decayK(t, p.decay) * 1.6;
        break;
      }
      case 'shaker': {
        const env = Math.min(1, t / 0.012) * decayK(Math.max(0, t - 0.012), p.decay);
        nz = hp.process(rand() * 2 - 1, 'hp') * env;
        break;
      }
      case 'cymbal':
      case 'metal': {
        const idx = (p.index ?? 3) * (0.4 + 0.6 * decayK(t, p.decay * 0.5));
        body = fm.next(p.tune / sampleRate, idx) * decayK(t, p.decay);
        if (p.kind === 'cymbal') body = hp.process(body + (rand() * 2 - 1) * 0.8 * decayK(t, nd), 'hp');
        break;
      }
    }
    out[i] = body * (1 - noiseAmt * 0.5) + nz * noiseAmt;
  }
  // Crush (the -chip drums): fewer bits and a sample-and-hold.
  if (p.crush) {
    const q = Math.pow(2, p.crush - 1);
    const hold = Math.max(1, p.hold ?? 1);
    let held = 0;
    for (let i = 0; i < n; i++) {
      if (i % hold === 0) held = Math.round(out[i] * q) / q;
      out[i] = held;
    }
  }
  // A fade over the last 20% (at most 40 ms) to exactly 0, and the level.
  const level = (p.level ?? 1) * velocity;
  const fade = Math.max(1, Math.min(Math.round(n * 0.2), Math.round(0.04 * sampleRate)));
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const norm = peak > 1e-9 ? level / Math.max(peak, 1) : 0;
  for (let i = 0; i < n; i++) out[i] *= norm * (i >= n - fade ? (n - 1 - i) / fade : 1);
  return out;
}
