/**
 * v1's sound recipes, moved verbatim from `game/AudioSystem.ts` (IMPLEMENTATION §M6a). Each recipe makes its layers
 * through `SfxOut.tone` and `SfxOut.noise`, the same one-shot primitives v1 had, with the same parameters, so the
 * v1 golden test reproduces v1's Web Audio calls exactly. `g` is the level (v1's nearness or intensity); `x` carries a
 * recipe's one extra argument (the lap record flag, the win flag).
 */

export interface ToneOptions {
  freqEnd?: number;
  delay?: number;
  attack?: number;
}

export interface NoiseOptions {
  filter: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  delay?: number;
  attack?: number;
}

export interface SfxOut {
  tone(freq: number, dur: number, type: OscillatorType, vol: number, opts?: ToneOptions): void;
  noise(dur: number, vol: number, o: NoiseOptions): void;
}

export type V1Recipe = (o: SfxOut, g: number, x: number) => void;

export const V1_SOUNDS = {
  'countdown.beep': (o) => {
    o.tone(330, 0.28, 'square', 0.16);
    o.tone(165, 0.28, 'sine', 0.2);
  },
  'countdown.go': (o) => {
    o.tone(660, 0.8, 'sawtooth', 0.14, { attack: 0.01 });
    o.tone(990, 0.8, 'square', 0.1, { attack: 0.01 });
    o.tone(1320, 0.5, 'sine', 0.12, { attack: 0.01 });
  },
  boost: (o, g) => {
    o.noise(0.95, 0.55 * g, { filter: 'bandpass', f0: 350, f1: 3800, q: 1.1, attack: 0.05 });
    o.tone(110, 0.7, 'sawtooth', 0.16 * g, { freqEnd: 380, attack: 0.04 });
  },
  dash: (o, g) => {
    o.tone(280, 0.3, 'sawtooth', 0.15 * g, { freqEnd: 1900, attack: 0.01 });
    o.tone(560, 0.22, 'square', 0.07 * g, { freqEnd: 2600, attack: 0.01, delay: 0.03 });
    o.noise(0.18, 0.2 * g, { filter: 'highpass', f0: 2500, q: 0.7 });
  },
  'draft.whoosh': (o) => {
    o.noise(0.6, 0.22, { filter: 'bandpass', f0: 2600, f1: 600, q: 1.6, attack: 0.12 });
  },
  /** `g` is the impact level (intensity × nearness). */
  'hit.rail': (o, i) => {
    o.noise(0.2, 0.5 * i, { filter: 'lowpass', f0: 2200, f1: 180, q: 0.8 });
    o.tone(120, 0.22, 'sine', 0.45 * i, { freqEnd: 45 });
  },
  /** `g` is the impact level (clamped 0.35 + intensity, × nearness). */
  'hit.ship': (o, i) => {
    o.noise(0.16, 0.5 * i, { filter: 'lowpass', f0: 1600, f1: 120, q: 0.9 });
    o.tone(95, 0.26, 'sine', 0.55 * i, { freqEnd: 38 });
    o.tone(210, 0.1, 'square', 0.12 * i, { freqEnd: 90 });
  },
  'emp.fire': (o, g) => {
    o.tone(400, 0.25, 'sawtooth', 0.14 * g, { freqEnd: 2400, attack: 0.005 });
  },
  'emp.hit': (o, g) => {
    o.noise(0.45, 0.4 * g, { filter: 'bandpass', f0: 5000, f1: 900, q: 2.5, attack: 0.005, delay: 0.08 });
    o.tone(880, 0.6, 'square', 0.1 * g, { freqEnd: 70, delay: 0.08 });
  },
  'mine.blast': (o, g) => {
    o.noise(0.6, 0.75 * g, { filter: 'lowpass', f0: 6000, f1: 150, q: 0.8, attack: 0.003 });
    o.tone(180, 0.55, 'sine', 0.6 * g, { freqEnd: 35 });
    o.tone(1400, 0.08, 'square', 0.12 * g, { freqEnd: 300 });
  },
  'mine.beep': (o) => {
    o.tone(1760, 0.05, 'square', 0.05, { attack: 0.002 });
  },
  'shield.up': (o, g) => {
    o.tone(300, 0.35, 'triangle', 0.16 * g, { freqEnd: 1200, attack: 0.01 });
    o.tone(110, 0.6, 'sine', 0.12 * g, { delay: 0.05 });
  },
  'mine.drop': (o, g) => {
    o.tone(140, 0.18, 'square', 0.18 * g, { freqEnd: 60, attack: 0.002 });
    o.noise(0.12, 0.2 * g, { filter: 'lowpass', f0: 1800, f1: 300, q: 1, attack: 0.002 });
  },
  'shield.block': (o, g) => {
    o.noise(0.3, 0.45 * g, { filter: 'highpass', f0: 3000, f1: 6000, q: 0.7, attack: 0.002 });
    o.tone(1760, 0.4, 'triangle', 0.16 * g, { freqEnd: 880 });
    o.tone(2640, 0.25, 'sine', 0.08 * g, { delay: 0.02 });
  },
  'alarm.emp': (o) => {
    for (let i = 0; i < 3; i++) o.tone(1320, 0.07, 'square', 0.11, { delay: i * 0.13, attack: 0.002 });
  },
  'item.fail': (o) => {
    o.tone(220, 0.12, 'square', 0.08, { freqEnd: 160 });
  },
  'pit.enter': (o) => {
    o.tone(660, 0.12, 'sine', 0.12);
    o.tone(990, 0.16, 'sine', 0.12, { delay: 0.1 });
  },
  'alarm.energy': (o) => {
    for (let i = 0; i < 3; i++) o.tone(1200, 0.09, 'square', 0.09, { delay: i * 0.16, attack: 0.005 });
  },
  ko: (o, g) => {
    o.noise(1.7, 0.95 * g, { filter: 'lowpass', f0: 4200, f1: 70, q: 0.7, attack: 0.005 });
    o.tone(150, 1.5, 'sine', 0.75 * g, { freqEnd: 26 });
    o.tone(75, 1.2, 'sawtooth', 0.25 * g, { freqEnd: 22 });
  },
  /** `x` = 1 when the lap is a record. */
  'lap.chime': (o, _g, record) => {
    o.tone(1318.5, 0.55, 'sine', 0.2);
    o.tone(1760, 0.8, 'sine', 0.18, { delay: 0.12 });
    o.tone(2637, 0.4, 'triangle', 0.06, { delay: 0.12 });
    if (record) o.tone(2093, 0.9, 'sine', 0.16, { delay: 0.26 });
  },
  'lap.final': (o) => {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      o.tone(f, 0.28, 'square', 0.09, { delay: i * 0.11, attack: 0.008 });
      o.tone(f * 2, 0.28, 'sine', 0.07, { delay: i * 0.11, attack: 0.008 });
    });
    o.tone(1046.5, 0.9, 'sawtooth', 0.08, { delay: 0.46, attack: 0.01 });
    o.tone(1318.5, 0.9, 'sine', 0.1, { delay: 0.46, attack: 0.01 });
  },
  /** `x` = 1 for the win variant. */
  'finish.fanfare': (o, _g, win) => {
    const notes = win ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568] : [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      o.tone(f, 0.34, 'square', 0.09, { delay: i * 0.13, attack: 0.008 });
      o.tone(f / 2, 0.34, 'sawtooth', 0.06, { delay: i * 0.13, attack: 0.008 });
    });
    const end = notes.length * 0.13;
    o.tone(1046.5, 1.4, 'sine', 0.14, { delay: end });
    o.tone(1318.5, 1.4, 'sine', 0.12, { delay: end });
    o.tone(1568, 1.4, 'sine', 0.1, { delay: end });
  },
} satisfies Record<string, V1Recipe>;

export type V1SoundId = keyof typeof V1_SOUNDS;
export const V1_SOUND_IDS = Object.keys(V1_SOUNDS) as V1SoundId[];
