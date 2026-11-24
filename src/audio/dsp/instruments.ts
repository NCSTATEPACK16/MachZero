/**
 * The instrument set (IMPLEMENTATION §M6b, §M6.3): each id is a voice recipe (`kind` plus parameters) and its MIDI
 * range. Three kinds of voice:
 *  - synth: two oscillators (saw, pulse, triangle, sine or noise) and noise, a resonant filter with its own
 *    envelope, an ADSR, vibrato, glide, a pitch envelope, drive and crush;
 *  - fm: two-operator FM with a decaying index, an ADSR, a pitch envelope;
 *  - drum: a hit from dsp/drums.ts (the note is ignored).
 * A track may override any parameter (`TrackDef.params`). `renderNote` renders one note whole, its release included.
 *
 * Tuned for the first three songs (menu, neon-bay, orbital-ring): saw-pad, saw-lead, pulse-lead, square-arp,
 * saw-bass, fm-epiano, bell, sine-sub, kick, kick-soft, snare, snare-big, hat, hat-open, rim. The others are simple
 * first recipes that M6c tunes by ear.
 */
import { renderDrum, type DrumParams } from './drums';
import { drive } from './effects';
import { Envelope, pitchEnv } from './env';
import { Svf, type FilterMode } from './filter';
import { Fm, fmIndex } from './fm';
import { mtof, Osc, TAU, type Wave } from './osc';

export type InstrumentId =
  | 'saw-pad'
  | 'saw-lead'
  | 'pulse-lead'
  | 'square-arp'
  | 'saw-bass'
  | 'fm-bass'
  | 'tri-bass'
  | 'pulse-chip'
  | 'bell'
  | 'fm-epiano'
  | 'pluck'
  | 'stab'
  | 'breath-pad'
  | 'flute'
  | 'sine-sub'
  | 'blip'
  | 'kick'
  | 'kick-soft'
  | 'kick-chip'
  | 'snare'
  | 'snare-big'
  | 'snare-gated'
  | 'snare-chip'
  | 'clap'
  | 'hat'
  | 'hat-open'
  | 'hat-chip'
  | 'ride'
  | 'crash'
  | 'rim'
  | 'shaker'
  | 'tom-lo'
  | 'tom-mid'
  | 'tom-hi'
  | 'metal'
  | 'anvil';

export interface InstrumentParams {
  /** Oscillators: the first's wave, the second's wave, its detune (cents), its offset (semitones) and level. */
  osc: Wave;
  osc2?: Wave;
  detune?: number;
  semi2?: number;
  mix2?: number;
  /** Pulse width 0.05..0.95, its LFO depth and rate (Hz). */
  width?: number;
  pwm?: number;
  pwmRate?: number;
  /** White noise level. */
  noise?: number;
  /** FM (kind fm): the modulator's ratio, the index at note-on, its sustain and decay (s), feedback. */
  ratio?: number;
  index?: number;
  indexSus?: number;
  indexDecay?: number;
  /** The filter: mode, cutoff (Hz), resonance 0..1, envelope amount (octaves), its decay (s) and sustain, key tracking 0..1. */
  filter?: FilterMode;
  cutoff?: number;
  res?: number;
  envAmt?: number;
  fDecay?: number;
  fSus?: number;
  keytrack?: number;
  /** The amp envelope (s, s, level, s). */
  a: number;
  d: number;
  s: number;
  r: number;
  /** The gate as a fraction of the written length (legato 1). */
  gate?: number;
  /** Vibrato depth (semitones), rate (Hz) and delay (s). */
  vib?: number;
  vibRate?: number;
  vibDelay?: number;
  /** Glide from the previous note (s). */
  glide?: number;
  /** A pitch envelope: semitones at note-on, decay (s). */
  pitch?: number;
  pitchDecay?: number;
  /** Drive gain (0 = clean), bit depth (0 = off). */
  drive?: number;
  bits?: number;
  /** The track's chorus mix 0..1 (a track insert, render.ts). */
  chorus?: number;
  /** The voice's level. */
  level?: number;
  /** Drums only. */
  drum?: DrumParams;
}

export interface InstrumentDef {
  kind: 'synth' | 'fm' | 'drum';
  params: InstrumentParams;
  /** The playable MIDI range [lowest, highest]. */
  range: readonly [number, number];
}

const DRUM_RANGE = [0, 127] as const;
const drum = (d: DrumParams): InstrumentDef => ({ kind: 'drum', params: { osc: 'noise', a: 0, d: 0, s: 1, r: 0, drum: d }, range: DRUM_RANGE });
const synth = (range: readonly [number, number], p: InstrumentParams): InstrumentDef => ({ kind: 'synth', params: p, range });
const fm = (range: readonly [number, number], p: InstrumentParams): InstrumentDef => ({ kind: 'fm', params: p, range });

export const INSTRUMENTS: Readonly<Record<InstrumentId, InstrumentDef>> = {
  // --- tuned for M6b ---
  'saw-pad': synth([36, 96], { osc: 'saw', osc2: 'saw', detune: 11, mix2: 0.9, filter: 'lp', cutoff: 1500, res: 0.1, envAmt: 0.6, fDecay: 1.2, fSus: 0.4, keytrack: 0.3, a: 0.35, d: 1.2, s: 0.8, r: 1.0, gate: 1, chorus: 0.5, level: 0.32 }),
  'saw-lead': synth([48, 96], { osc: 'saw', osc2: 'saw', detune: 7, mix2: 0.6, filter: 'lp', cutoff: 2400, res: 0.2, envAmt: 1.2, fDecay: 0.35, fSus: 0.5, keytrack: 0.5, a: 0.01, d: 0.3, s: 0.75, r: 0.18, gate: 0.95, vib: 0.18, vibRate: 5.2, vibDelay: 0.25, glide: 0.03, drive: 0.4, level: 0.4 }),
  'pulse-lead': synth([48, 100], { osc: 'pulse', width: 0.3, pwm: 0.12, pwmRate: 3, osc2: 'pulse', semi2: 12, mix2: 0.25, filter: 'lp', cutoff: 3200, res: 0.15, envAmt: 0.8, fDecay: 0.25, fSus: 0.6, keytrack: 0.5, a: 0.008, d: 0.2, s: 0.7, r: 0.15, gate: 0.9, vib: 0.12, vibRate: 5.5, vibDelay: 0.2, level: 0.34 }),
  'square-arp': synth([48, 100], { osc: 'pulse', width: 0.5, filter: 'lp', cutoff: 1300, res: 0.35, envAmt: 2.2, fDecay: 0.09, fSus: 0, keytrack: 0.6, a: 0.002, d: 0.14, s: 0.25, r: 0.06, gate: 0.6, level: 0.3 }),
  'saw-bass': synth([24, 60], { osc: 'saw', osc2: 'pulse', semi2: -12, width: 0.5, mix2: 0.5, filter: 'lp', cutoff: 420, res: 0.3, envAmt: 2.0, fDecay: 0.12, fSus: 0.15, keytrack: 0.4, a: 0.003, d: 0.25, s: 0.8, r: 0.05, gate: 0.8, drive: 0.6, level: 0.5 }),
  'fm-epiano': fm([40, 96], { osc: 'sine', ratio: 1, index: 2.2, indexSus: 0.3, indexDecay: 0.6, a: 0.003, d: 1.6, s: 0.25, r: 0.4, gate: 0.95, chorus: 0.45, level: 0.42 }),
  bell: fm([60, 108], { osc: 'sine', ratio: 3.5, index: 3.2, indexSus: 0.4, indexDecay: 0.5, a: 0.001, d: 1.4, s: 0, r: 0.9, gate: 1, level: 0.32 }),
  'sine-sub': synth([24, 60], { osc: 'sine', osc2: 'tri', mix2: 0.15, a: 0.01, d: 0.3, s: 0.9, r: 0.12, gate: 0.95, drive: 0.3, level: 0.6 }),
  kick: drum({ kind: 'kick', tune: 52, drop: 3.2, decay: 0.32, length: 0.5, noise: 0.15, level: 0.95 }),
  'kick-soft': drum({ kind: 'kick', tune: 48, drop: 2.2, decay: 0.26, length: 0.45, noise: 0.05, level: 0.8 }),
  snare: drum({ kind: 'snare', tune: 190, decay: 0.08, noiseDecay: 0.12, length: 0.3, noise: 0.65, tone: 2600, level: 0.7 }),
  'snare-big': drum({ kind: 'snare', tune: 175, decay: 0.12, noiseDecay: 0.22, length: 0.5, noise: 0.7, tone: 2000, level: 0.8 }),
  hat: drum({ kind: 'hat', tune: 330, decay: 0.035, length: 0.12, level: 0.35 }),
  'hat-open': drum({ kind: 'hat', tune: 330, decay: 0.22, length: 0.5, level: 0.3 }),
  rim: drum({ kind: 'rim', tune: 1650, decay: 0.012, noiseDecay: 0.01, length: 0.07, noise: 0.35, tone: 3500, level: 0.45 }),

  // --- first recipes, tuned in M6c ---
  'fm-bass': fm([24, 60], { osc: 'sine', ratio: 1, index: 3, indexSus: 0.8, indexDecay: 0.15, a: 0.002, d: 0.3, s: 0.7, r: 0.06, gate: 0.85, drive: 0.5, level: 0.5 }),
  'tri-bass': synth([24, 60], { osc: 'tri', a: 0.003, d: 0.2, s: 0.85, r: 0.05, gate: 0.85, level: 0.6 }),
  'pulse-chip': synth([48, 100], { osc: 'pulse', width: 0.125, a: 0.001, d: 0.1, s: 0.8, r: 0.03, gate: 0.85, bits: 6, level: 0.28 }),
  pluck: synth([40, 96], { osc: 'saw', osc2: 'pulse', mix2: 0.4, filter: 'lp', cutoff: 600, res: 0.2, envAmt: 3, fDecay: 0.08, fSus: 0, keytrack: 0.7, a: 0.001, d: 0.3, s: 0, r: 0.1, gate: 0.5, level: 0.36 }),
  stab: synth([36, 96], { osc: 'saw', osc2: 'saw', detune: 15, mix2: 0.9, filter: 'lp', cutoff: 900, res: 0.25, envAmt: 2, fDecay: 0.12, fSus: 0.2, a: 0.004, d: 0.2, s: 0.3, r: 0.12, gate: 0.6, level: 0.3 }),
  'breath-pad': synth([36, 96], { osc: 'tri', osc2: 'sine', semi2: 12, mix2: 0.3, noise: 0.08, filter: 'bp', cutoff: 1200, res: 0.2, a: 0.6, d: 1, s: 0.8, r: 1.2, gate: 1, chorus: 0.4, level: 0.35 }),
  flute: synth([60, 96], { osc: 'sine', osc2: 'tri', mix2: 0.25, noise: 0.06, filter: 'lp', cutoff: 3000, a: 0.06, d: 0.3, s: 0.85, r: 0.15, gate: 0.95, vib: 0.2, vibRate: 5, vibDelay: 0.2, level: 0.4 }),
  blip: synth([48, 100], { osc: 'sine', pitch: 12, pitchDecay: 0.03, a: 0.001, d: 0.12, s: 0, r: 0.05, gate: 0.5, level: 0.35 }),
  'kick-chip': drum({ kind: 'kick', tune: 55, drop: 4, decay: 0.2, length: 0.3, crush: 5, hold: 3, level: 0.8 }),
  'snare-gated': drum({ kind: 'snare', tune: 185, decay: 0.1, length: 0.35, noise: 0.75, tone: 2200, gate: 0.18, level: 0.75 }),
  'snare-chip': drum({ kind: 'snare', tune: 200, decay: 0.05, noiseDecay: 0.09, length: 0.2, noise: 0.8, tone: 3000, crush: 4, hold: 4, level: 0.6 }),
  clap: drum({ kind: 'clap', tune: 0, decay: 0.1, noiseDecay: 0.12, length: 0.35, noise: 1, tone: 1200, level: 0.6 }),
  'hat-chip': drum({ kind: 'hat', tune: 360, decay: 0.03, length: 0.08, crush: 4, hold: 4, level: 0.3 }),
  ride: drum({ kind: 'cymbal', tune: 520, ratio: 2.76, index: 2, decay: 0.9, noiseDecay: 0.3, length: 1.4, level: 0.25 }),
  crash: drum({ kind: 'cymbal', tune: 410, ratio: 3.17, index: 4, decay: 1.2, noiseDecay: 1, length: 2, level: 0.35 }),
  shaker: drum({ kind: 'shaker', tune: 0, decay: 0.05, length: 0.12, noise: 1, level: 0.3 }),
  'tom-lo': drum({ kind: 'tom', tune: 90, drop: 1.6, decay: 0.3, length: 0.5, level: 0.7 }),
  'tom-mid': drum({ kind: 'tom', tune: 130, drop: 1.6, decay: 0.26, length: 0.45, level: 0.65 }),
  'tom-hi': drum({ kind: 'tom', tune: 180, drop: 1.6, decay: 0.22, length: 0.4, level: 0.6 }),
  metal: drum({ kind: 'metal', tune: 380, ratio: 1.41, index: 5, decay: 0.25, length: 0.45, level: 0.4 }),
  anvil: drum({ kind: 'metal', tune: 900, ratio: 2.73, index: 3, decay: 0.5, length: 0.8, level: 0.4 }),
};

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS) as InstrumentId[];

export const isDrum = (id: InstrumentId): boolean => INSTRUMENTS[id].kind === 'drum';

/** An instrument with a track's overrides applied. */
export interface ResolvedInstrument {
  kind: InstrumentDef['kind'];
  p: InstrumentParams;
}

export function resolveInstrument(id: InstrumentId, overrides?: Partial<InstrumentParams>): ResolvedInstrument {
  const def = INSTRUMENTS[id];
  const p = { ...def.params, ...overrides };
  if (def.params.drum && overrides?.drum) p.drum = { ...def.params.drum, ...overrides.drum };
  return { kind: def.kind, p };
}

/** Samples of release after the gate (drums: their whole length is the note). */
export function releaseSeconds(inst: ResolvedInstrument): number {
  return inst.kind === 'drum' ? inst.p.drum!.length : inst.p.r;
}

const BLOCK = 128;

/**
 * Render one note whole: `gate` samples held, then the release. `prev` is the previous note on the track (glide).
 * Control values (pitch, the filter, PWM) update once per 128-sample block.
 */
export function renderNote(inst: ResolvedInstrument, midi: number, velocity: number, gate: number, sampleRate: number, rand: () => number, prev: number | null = null): Float32Array {
  const p = inst.p;
  if (inst.kind === 'drum') return renderDrum(p.drum!, velocity, sampleRate, rand);
  const env = new Envelope(p, gate, sampleRate);
  const n = env.length;
  const out = new Float32Array(n);
  const o1 = new Osc(p.osc, rand);
  const o2 = p.osc2 ? new Osc(p.osc2, rand) : null;
  const op = inst.kind === 'fm' ? new Fm(p.ratio ?? 1) : null;
  const filt = p.filter ? new Svf(sampleRate) : null;
  const mix2 = p.mix2 ?? 0.5;
  const noise = p.noise ?? 0;
  const ratio2 = Math.pow(2, ((p.semi2 ?? 0) * 100 + (p.detune ?? 0)) / 1200);
  const level = (p.level ?? 0.5) * velocity;
  const glideFrom = prev !== null && p.glide ? prev - midi : 0;
  // Start the second oscillator a little out of phase, as an analog voice would.
  if (o2) o2.setPhase(0.37);
  for (let b = 0; b < n; b += BLOCK) {
    const t = b / sampleRate;
    let semis = pitchEnv(p.pitch ?? 0, p.pitchDecay ?? 0.05, t);
    if (glideFrom) semis += glideFrom * Math.exp(-t / (p.glide! / 3));
    if (p.vib) semis += p.vib * Math.sin(TAU * (p.vibRate ?? 5) * t) * Math.min(1, Math.max(0, (t - (p.vibDelay ?? 0)) / 0.3));
    const f = mtof(midi + semis);
    const dt = f / sampleRate;
    const width = Math.min(0.95, Math.max(0.05, (p.width ?? 0.5) + (p.pwm ?? 0) * Math.sin(TAU * (p.pwmRate ?? 1) * t)));
    if (filt) {
      const fenv = (p.fSus ?? 0) + (1 - (p.fSus ?? 0)) * Math.exp(-t / Math.max(p.fDecay ?? 0.2, 1e-3));
      const key = Math.pow(2, ((p.keytrack ?? 0) * (midi - 60)) / 12);
      filt.set((p.cutoff ?? 2000) * key * Math.pow(2, (p.envAmt ?? 0) * fenv) * (0.75 + 0.25 * velocity), p.res ?? 0);
    }
    const index = op ? fmIndex(p.index ?? 1, p.indexSus ?? 0, p.indexDecay ?? 0.3, t) : 0;
    const end = Math.min(n, b + BLOCK);
    for (let i = b; i < end; i++) {
      let v = op ? op.next(dt, index) : o1.next(dt, width);
      if (o2) v = v * (1 - mix2 * 0.5) + o2.next(dt * ratio2, width) * mix2;
      if (noise) v += (rand() * 2 - 1) * noise;
      if (filt) v = filt.process(v, p.filter!);
      if (p.drive) v = drive(v, p.drive);
      out[i] = v * env.at(i) * level;
    }
  }
  if (p.bits) {
    const q = Math.pow(2, p.bits - 1);
    for (let i = 0; i < n; i++) out[i] = Math.round(out[i] * q) / q;
  }
  return out;
}
