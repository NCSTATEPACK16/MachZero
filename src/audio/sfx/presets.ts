/**
 * The M6 sound effects as sfxr presets (IMPLEMENTATION §M6.2's M6 rows); their levels are in `presetMeta.ts`. Each
 * preset is one or more sfxr layers mixed
 * at time offsets; `renderPreset` turns it into mono samples (pure, so the Worker, the main-thread fallback and the Node
 * tests share it). The values were set by ear; the owner's listening pass in the M6a device check may rework any.
 *
 * Loops (`loop: true`) are the continuous voices: their ends are folded together so they repeat without a click.
 */
import { PRESET_IDS, type PresetId } from './presetMeta';
import { normalise, renderSfxr, SFXR_RATE, type SfxrParams } from './sfxr';

export interface PresetLayer {
  p: SfxrParams;
  /** Start offset in seconds. */
  at?: number;
  /** Layer level before the mix is normalised. */
  gain?: number;
}

export interface SfxPreset {
  layers: readonly PresetLayer[];
  /** A continuous voice: rendered to `loopSeconds` and folded to loop seamlessly. */
  loop?: boolean;
  loopSeconds?: number;
}

/** A deterministic scatter of short bursts across `seconds` (crackles, sparkles, coins). */
function scatter(count: number, seconds: number, seed: number, make: (i: number, r: () => number) => SfxrParams, gainRange: [number, number] = [0.5, 1]): PresetLayer[] {
  let s = seed >>> 0 || 1;
  const r = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const layers: PresetLayer[] = [];
  for (let i = 0; i < count; i++) {
    const at = r() * seconds;
    const gain = gainRange[0] + r() * (gainRange[1] - gainRange[0]);
    layers.push({ p: make(i, r), at, gain });
  }
  return layers;
}

export const PRESETS = {
  // --- Race (M6 rows of §M6.2) ---
  respawn: {
    layers: [
      { p: { wave: 'square', freq: 0.32, slide: 0.22, duty: 0.3, dutySweep: 0.2, attack: 0.15, sustain: 0.25, decay: 0.45, lpf: 0.7, seed: 11 } },
      { p: { wave: 'sine', freq: 0.5, slide: 0.18, vibDepth: 0.25, vibSpeed: 0.7, attack: 0.15, sustain: 0.2, decay: 0.45, seed: 12 }, gain: 0.7, at: 0.04 },
    ],
  },
  'jump.launch': {
    layers: [{ p: { wave: 'noise', freq: 0.32, slide: 0.18, attack: 0.12, sustain: 0.15, decay: 0.42, lpf: 0.45, lpfSweep: 0.35, lpfResonance: 0.3, seed: 21 } }],
  },
  'jump.land': {
    layers: [
      { p: { wave: 'noise', freq: 0.1, sustain: 0.05, punch: 0.5, decay: 0.32, lpf: 0.35, seed: 31 } },
      { p: { wave: 'sine', freq: 0.17, slide: -0.3, sustain: 0.05, decay: 0.3, seed: 32 }, gain: 0.9 },
      { p: { wave: 'square', freq: 0.56, duty: 0.6, sustain: 0.02, decay: 0.28, hpf: 0.3, vibDepth: 0.1, vibSpeed: 0.8, seed: 33 }, gain: 0.25, at: 0.01 },
    ],
  },
  'ice.crackle': {
    loop: true,
    loopSeconds: 1.3,
    layers: [
      { p: { wave: 'noise', freq: 0.7, sustain: 0.9, decay: 0.1, hpf: 0.35, seed: 41 }, gain: 0.12 },
      ...scatter(18, 1.25, 42, (i, r) => ({ wave: 'noise', freq: 0.6 + r() * 0.25, sustain: 0.01, decay: 0.05 + r() * 0.07, hpf: 0.25, seed: 43 + i })),
    ],
  },
  'wind.gust': {
    layers: [{ p: { wave: 'noise', freq: 0.24, attack: 0.3, sustain: 0.35, decay: 0.5, lpf: 0.35, lpfSweep: 0.12, lpfResonance: 0.55, hpf: 0.05, seed: 51 } }],
  },
  'gate.hit': {
    layers: [
      { p: { wave: 'noise', freq: 0.09, sustain: 0.06, punch: 0.6, decay: 0.42, lpf: 0.3, seed: 61 } },
      { p: { wave: 'noise', freq: 0.26, sustain: 0.04, decay: 0.26, hpf: 0.2, seed: 62 }, gain: 0.5, at: 0.02 },
      ...scatter(5, 0.25, 63, (i) => ({ wave: 'noise', freq: 0.35, sustain: 0.01, decay: 0.06, lpf: 0.6, seed: 64 + i }), [0.2, 0.4]),
    ],
  },
  'debris.hit': {
    layers: [
      { p: { wave: 'square', freq: 0.62, duty: 0.3, sustain: 0.03, punch: 0.6, decay: 0.45, vibDepth: 0.05, vibSpeed: 0.9, seed: 71 } },
      { p: { wave: 'square', freq: 0.83, duty: 0.55, sustain: 0.02, decay: 0.32, seed: 72 }, gain: 0.5 },
      { p: { wave: 'noise', freq: 0.5, sustain: 0.02, decay: 0.1, seed: 73 }, gain: 0.6 },
    ],
  },
  'lightning.hit': {
    layers: [
      { p: { wave: 'saw', freq: 0.7, slide: -0.35, vibDepth: 0.5, vibSpeed: 0.8, sustain: 0.08, decay: 0.36, lpf: 0.8, seed: 81 } },
      { p: { wave: 'noise', freq: 0.8, sustain: 0.06, decay: 0.32, repeat: 0.6, hpf: 0.15, seed: 82 }, gain: 0.7 },
    ],
  },
  'geyser.hit': {
    layers: [
      { p: { wave: 'noise', freq: 0.75, sustain: 0.3, decay: 0.5, hpf: 0.35, seed: 91 }, gain: 0.7 },
      { p: { wave: 'sine', freq: 0.15, slide: -0.3, sustain: 0.04, decay: 0.3, seed: 92 } },
    ],
  },
  'jet.hit': {
    layers: [
      { p: { wave: 'noise', freq: 0.35, sustain: 0.08, punch: 0.5, decay: 0.45, lpf: 0.45, lpfSweep: -0.2, seed: 101 } },
      { p: { wave: 'sine', freq: 0.2, slide: -0.4, sustain: 0.03, decay: 0.22, seed: 102 }, gain: 0.9 },
    ],
  },
  // --- Hazard timelines ---
  'gate.rumble': {
    layers: [
      { p: { wave: 'noise', freq: 0.06, attack: 0.3, sustain: 0.4, decay: 0.45, lpf: 0.35, lpfResonance: 0.4, seed: 111 } },
      { p: { wave: 'saw', freq: 0.12, vibDepth: 0.3, vibSpeed: 0.4, attack: 0.3, sustain: 0.4, decay: 0.45, lpf: 0.28, seed: 112 }, gain: 0.4 },
    ],
  },
  'lightning.charge': {
    loop: true,
    loopSeconds: 1.1,
    layers: [
      { p: { wave: 'noise', freq: 0.62, sustain: 0.8, decay: 0.1, hpf: 0.3, lpf: 0.85, seed: 121 }, gain: 0.25 },
      { p: { wave: 'saw', freq: 0.42, vibDepth: 0.3, vibSpeed: 0.9, sustain: 0.8, decay: 0.1, lpf: 0.6, lpfResonance: 0.5, seed: 122 }, gain: 0.3 },
      ...scatter(14, 1.05, 123, (i, r) => ({ wave: 'noise', freq: 0.7 + r() * 0.2, sustain: 0.01, decay: 0.04 + r() * 0.05, seed: 124 + i })),
    ],
  },
  'lightning.bolt': {
    layers: [
      { p: { wave: 'noise', freq: 0.3, sustain: 0.08, punch: 0.8, decay: 0.78, lpf: 0.6, lpfSweep: -0.15, seed: 141 } },
      { p: { wave: 'noise', freq: 0.08, attack: 0.1, sustain: 0.2, decay: 0.72, lpf: 0.3, seed: 142 }, gain: 0.8, at: 0.05 },
    ],
  },
  'geyser.rumble': {
    loop: true,
    loopSeconds: 1.2,
    layers: [
      { p: { wave: 'noise', freq: 0.05, sustain: 0.85, decay: 0.1, lpf: 0.25, lpfResonance: 0.3, seed: 151 } },
      { p: { wave: 'sine', freq: 0.09, vibDepth: 0.2, vibSpeed: 0.5, sustain: 0.85, decay: 0.1, seed: 152 }, gain: 0.5 },
    ],
  },
  'geyser.erupt': {
    layers: [
      { p: { wave: 'noise', freq: 0.2, attack: 0.15, sustain: 0.4, decay: 0.55, lpf: 0.55, seed: 161 } },
      { p: { wave: 'noise', freq: 0.06, attack: 0.15, sustain: 0.4, decay: 0.5, lpf: 0.3, seed: 162 }, gain: 0.7 },
    ],
  },
  'jet.hiss': {
    loop: true,
    loopSeconds: 1.0,
    layers: [
      { p: { wave: 'noise', freq: 0.85, sustain: 0.8, decay: 0.1, hpf: 0.45, seed: 171 } },
      ...scatter(10, 0.95, 172, (i, r) => ({ wave: 'sine', freq: 0.45 + r() * 0.2, slide: 0.3, sustain: 0.02, decay: 0.08, seed: 173 + i }), [0.15, 0.3]),
    ],
  },
  'jet.fire': {
    layers: [
      { p: { wave: 'noise', freq: 0.18, attack: 0.1, sustain: 0.15, decay: 0.55, lpf: 0.4, lpfSweep: 0.3, seed: 181 } },
      { p: { wave: 'sine', freq: 0.16, slide: -0.25, sustain: 0.05, decay: 0.4, seed: 182 }, gain: 0.8 },
    ],
  },
  // --- Menus ---
  'ui.move': {
    layers: [{ p: { wave: 'sine', freq: 0.62, sustain: 0.04, decay: 0.12, hpf: 0.1, seed: 201 } }],
  },
  'ui.confirm': {
    layers: [{ p: { wave: 'square', freq: 0.55, duty: 0.4, sustain: 0.14, decay: 0.2, arpMod: 0.4, arpSpeed: 0.62, lpf: 0.75, seed: 211 } }],
  },
  'ui.back': {
    layers: [{ p: { wave: 'square', freq: 0.55, duty: 0.4, sustain: 0.14, decay: 0.2, arpMod: -0.12, arpSpeed: 0.62, lpf: 0.7, seed: 221 } }],
  },
  'ui.slider': {
    layers: [{ p: { wave: 'sine', freq: 0.5, sustain: 0.03, decay: 0.08, seed: 231 } }],
  },
  'ui.tab': {
    layers: [{ p: { wave: 'noise', freq: 0.55, attack: 0.12, sustain: 0.05, decay: 0.18, hpf: 0.35, lpf: 0.75, seed: 241 } }],
  },
  'ui.locked': {
    layers: [
      { p: { wave: 'square', freq: 0.2, duty: 0.5, sustain: 0.03, decay: 0.14, lpf: 0.3, seed: 251 } },
      { p: { wave: 'square', freq: 0.18, duty: 0.5, sustain: 0.03, decay: 0.16, lpf: 0.28, seed: 252 }, at: 0.12 },
    ],
  },
  'ui.buy': {
    layers: [
      { p: { wave: 'square', freq: 0.6, duty: 0.5, sustain: 0.08, punch: 0.4, decay: 0.35, arpMod: 0.45, arpSpeed: 0.6, seed: 261 } },
      { p: { wave: 'sine', freq: 0.75, sustain: 0.05, punch: 0.3, decay: 0.55, seed: 262 }, at: 0.15, gain: 0.8 },
    ],
  },
  'ui.equip': {
    layers: [
      { p: { wave: 'noise', freq: 0.15, sustain: 0.02, punch: 0.4, decay: 0.13, lpf: 0.4, seed: 271 } },
      { p: { wave: 'square', freq: 0.7, duty: 0.5, sustain: 0.01, decay: 0.06, seed: 272 }, at: 0.07, gain: 0.5 },
    ],
  },
  'ui.deny': {
    layers: [{ p: { wave: 'saw', freq: 0.18, sustain: 0.15, decay: 0.2, lpf: 0.35, vibDepth: 0.2, vibSpeed: 0.6, seed: 281 } }],
  },
  'ui.tally': {
    layers: [{ p: { wave: 'sine', freq: 0.58, sustain: 0.02, decay: 0.12, seed: 291 } }],
  },
  'ui.coin': {
    layers: [0, 0.06, 0.12, 0.18, 0.26].map((at, i) => ({
      p: { wave: 'square', freq: 0.62 + i * 0.025, duty: 0.5, sustain: 0.04, decay: 0.3, arpMod: 0.4, arpSpeed: 0.7, seed: 301 + i } as SfxrParams,
      at,
      gain: 1 - i * 0.12,
    })),
  },
  'ui.tutorial': {
    layers: [
      { p: { wave: 'sine', freq: 0.5, sustain: 0.05, decay: 0.45, seed: 311 } },
      { p: { wave: 'sine', freq: 0.6, sustain: 0.05, decay: 0.5, seed: 312 }, at: 0.14 },
    ],
  },
  'ui.sparkle': {
    layers: scatter(8, 0.4, 321, (i, r) => ({ wave: 'sine', freq: 0.72 + r() * 0.14, vibDepth: 0.2, vibSpeed: 0.8, sustain: 0.03, decay: 0.2, seed: 322 + i }), [0.5, 1]),
  },
} satisfies Record<PresetId, SfxPreset>;

export { PRESET_IDS, type PresetId };

/** Fade length (s) folded from a loop's tail onto its head. */
const LOOP_FOLD = 0.08;

/** Render one preset to mono samples at `sampleRate`, peak 0.9. */
export function renderPreset(preset: SfxPreset, sampleRate = SFXR_RATE): Float32Array {
  const parts = preset.layers.map((l) => ({ at: Math.round((l.at ?? 0) * sampleRate), gain: l.gain ?? 1, data: renderSfxr(l.p, sampleRate, 1) }));
  let len = 0;
  for (const p of parts) len = Math.max(len, p.at + p.data.length);
  if (preset.loop) len = Math.max(Math.round((preset.loopSeconds ?? 1) * sampleRate), 1);
  const fold = preset.loop ? Math.round(LOOP_FOLD * sampleRate) : 0;
  const mix = new Float32Array(len + fold);
  for (const p of parts) {
    for (let i = 0; i < p.data.length; i++) {
      const j = p.at + i;
      if (j >= mix.length) break;
      mix[j] += p.data[i] * p.gain;
    }
  }
  const out = preset.loop ? foldLoop(mix, len, fold) : mix;
  normalise(out, 0.9);
  return out;
}

/** A seamless loop of `len` samples: the `fold` samples past the end are crossfaded onto the start. */
export function foldLoop(src: Float32Array, len: number, fold: number): Float32Array {
  const out = src.slice(0, len);
  for (let i = 0; i < fold && i < len; i++) {
    const k = i / fold;
    out[i] = out[i] * k + (src[len + i] ?? 0) * (1 - k);
  }
  return out;
}
