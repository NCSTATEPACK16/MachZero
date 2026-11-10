/**
 * Environment effects as data (SPEC §10.3, IMPLEMENTATION §X2). A world's theme declares an `EnvFxSpec`;
 * `resolveEnvFx` turns it into what one quality preset actually draws. Effects never change how the game
 * plays: wind, lightning strikes and the like are track features, and the effects only show them.
 *
 * Pure and Node-safe (no three.js), so the scaling rules are unit-tested.
 */
import type { QualityLevel } from '../../settings/QualityManager';

export type Rgb = readonly [number, number, number];

export type WeatherKind = 'rain' | 'snow' | 'embers' | 'spores' | 'dust' | 'bubbles' | 'meteors';

/** Colour grading in linear light, before tone mapping: out = pow(max(in * gain + lift, 0), 1 / gamma), then saturation. */
export interface GradeSpec {
  lift: Rgb;
  gamma: Rgb;
  gain: Rgb;
  /** 1 = unchanged, 0 = greyscale. */
  saturation: number;
}

/** Particles in a box that follows the camera: one draw call, animated in the vertex shader. */
export interface WeatherSpec {
  kind: WeatherKind;
  /** Particles at High. */
  count: number;
  /** Fall speed in m/s (negative rises: embers, bubbles). */
  fall: number;
  /** Horizontal drift in m/s (x, z). */
  wind: readonly [number, number];
  /** Particle width in metres. */
  size: number;
  color: number;
  /** Streak length in seconds of travel (0 = round sprite). Streaks follow the motion relative to the camera. */
  streak: number;
  /** 0..1 */
  opacity: number;
  /** Side to side wander in metres (snow, spores, bubbles). */
  sway?: number;
}

/** Low-lying mist: drifting sheets at a world height, one draw call. */
export interface HeightFogSpec {
  /** World height of the top sheet (m). */
  base: number;
  /** Vertical distance over which the fog thins (m); also the spacing of the sheets. */
  falloff: number;
  color: number;
  /** 0..1 */
  density: number;
  /** Size of the drifting banks (m). */
  bankScale?: number;
  /** Bank drift in m/s. */
  bankSpeed?: number;
}

/** Ambient sky flashes. Visual only: a hazard's own strike calls `EnvFx.flash` as well. */
export interface LightningSpec {
  /** Flashes per minute. */
  rate: number;
  color: number;
  /** Peak brightness added to the frame (0..1). */
  flash: number;
}

/** Particles kicked up behind grounded ships (drawn by the shared effect pool: no extra draw call). */
export interface SurfaceSpec {
  kind: 'spray' | 'dust' | 'sparks';
  color: number;
}

/** A prop from the world's props.glb drifting on a slow path outside the track corridor. */
export interface SetPieceSpec {
  /** Top-level node name in props.glb. */
  prop: string;
  count: number;
  /** 'orbit' circles the track's centre; 'line' crosses over it and wraps. */
  path: 'orbit' | 'line';
  /** Orbit radius or half the line length (m). */
  radius: number;
  /** Height above the track's mean height (m). */
  height: number;
  /** m/s along the path. */
  speed: number;
  scale?: number;
}

/** A glossier deck with the rail neon stretched along it. Not a real reflection. */
export interface WetDeckSpec {
  /** 0..1: how far the deck's roughness drops. */
  gloss: number;
  /** 0..1: strength of the neon streaks. */
  streak: number;
}

/** Additive light-shaft cards beside the track (cheap god rays), one draw call. */
export interface ShaftsSpec {
  count: number;
  color: number;
  /** Lean from vertical, in radians, toward the sun direction. */
  angle: number;
  width: number;
  height: number;
  /** 0..1 */
  opacity: number;
}

export interface EnvFxSpec {
  grade?: GradeSpec;
  weather?: WeatherSpec;
  heightFog?: HeightFogSpec;
  lightning?: LightningSpec;
  surface?: SurfaceSpec;
  setPieces?: readonly SetPieceSpec[];
  wetDeck?: WetDeckSpec;
  shafts?: ShaftsSpec;
}

/** No effects: the world renders exactly as it did before §X2. */
export const NO_ENVFX: EnvFxSpec = Object.freeze({});

export const GRADE_IDENTITY: GradeSpec = Object.freeze({ lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1 });

/** How each preset scales the effects (IMPLEMENTATION §X2 "Quality scaling"). */
export interface EnvFxQuality {
  /** Fraction of `weather.count`. */
  weather: number;
  /** Fog banks drift (Low draws them still). */
  fogMotion: boolean;
  /** Fog sheets drawn. */
  fogSheets: 1 | 2 | 3;
  /** Which ships kick up spray or dust. */
  surface: 'player' | 'all';
  /** Fraction of the surface particles. */
  surfaceRate: number;
  /** Most set pieces per kind (Infinity = all). */
  setPiecesPerKind: number;
  wetDeck: boolean;
  /** Fraction of `shafts.count` (0 = off). */
  shafts: number;
}

export const ENVFX_QUALITY: Readonly<Record<QualityLevel, EnvFxQuality>> = {
  low: { weather: 0.3, fogMotion: false, fogSheets: 1, surface: 'player', surfaceRate: 0.5, setPiecesPerKind: 1, wetDeck: false, shafts: 0 },
  med: { weather: 0.6, fogMotion: true, fogSheets: 2, surface: 'all', surfaceRate: 0.6, setPiecesPerKind: Infinity, wetDeck: true, shafts: 0.5 },
  high: { weather: 1, fogMotion: true, fogSheets: 3, surface: 'all', surfaceRate: 1, setPiecesPerKind: Infinity, wetDeck: true, shafts: 1 },
};

/** Draw calls the effects may add per world, all together (IMPLEMENTATION §X2 "Budgets"). 0 per ship. */
export const ENVFX_MAX_DRAW_CALLS = 6;

/** What one preset draws for a spec. */
export interface EnvFxPlan {
  grade: GradeSpec | null;
  weather: (WeatherSpec & { drawn: number }) | null;
  heightFog: (HeightFogSpec & { sheets: number; moving: boolean }) | null;
  /** Null with reduced motion: no flashes. */
  lightning: LightningSpec | null;
  surface: (SurfaceSpec & { ships: 'player' | 'all'; rate: number }) | null;
  setPieces: SetPieceSpec[];
  wetDeck: WetDeckSpec | null;
  shafts: (ShaftsSpec & { drawn: number }) | null;
}

export function resolveEnvFx(spec: EnvFxSpec, level: QualityLevel, reducedMotion: boolean): EnvFxPlan {
  const q = ENVFX_QUALITY[level];
  const w = spec.weather;
  const drawn = w ? Math.round(w.count * q.weather) : 0;
  const shaftCount = spec.shafts ? Math.round(spec.shafts.count * q.shafts) : 0;
  return {
    grade: spec.grade ?? null,
    // Reduced motion: shorter streaks (less rushing past the camera), the same weather otherwise.
    weather: w && drawn > 0 ? { ...w, streak: reducedMotion ? w.streak * 0.5 : w.streak, drawn } : null,
    heightFog: spec.heightFog ? { ...spec.heightFog, sheets: q.fogSheets, moving: q.fogMotion && !reducedMotion } : null,
    lightning: spec.lightning && !reducedMotion ? spec.lightning : null,
    surface: spec.surface ? { ...spec.surface, ships: q.surface, rate: q.surfaceRate } : null,
    setPieces: (spec.setPieces ?? []).map((s) => ({ ...s, count: Math.min(s.count, q.setPiecesPerKind) })).filter((s) => s.count > 0),
    wetDeck: spec.wetDeck && q.wetDeck ? spec.wetDeck : null,
    shafts: spec.shafts && shaftCount > 0 ? { ...spec.shafts, drawn: shaftCount } : null,
  };
}

/**
 * Most draw calls a plan can add: weather 1, fog 1, shafts 1, and one per set-piece mesh (`meshesPerProp`
 * role meshes each). Grading, lightning, surface particles and the wet-look deck add none.
 */
export function planDrawCalls(plan: EnvFxPlan, meshesPerProp = 1): number {
  return (plan.weather ? 1 : 0) + (plan.heightFog ? 1 : 0) + (plan.shafts ? 1 : 0) + plan.setPieces.length * meshesPerProp;
}

/** Deterministic flash times: the n-th ambient flash of a world, in seconds (same on every run and device). */
export function flashTime(rate: number, n: number): number {
  if (!(rate > 0)) return Infinity;
  const gap = 60 / rate;
  // A fixed jitter of up to ±40% of the gap, from the flash index.
  const j = Math.sin(n * 12.9898) * 43758.5453;
  return (n + 0.5 + ((j - Math.floor(j)) - 0.5) * 0.8) * gap;
}
