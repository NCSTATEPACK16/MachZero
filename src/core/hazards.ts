/**
 * How track hazards treat the ships in a race (SPEC §6, IMPLEMENTATION §M4). It comes from the race setup:
 * `normal` by default, `rookie` for Rookie-tier races (M5) or the No-KO assist (M7), and `?hazards=rookie`
 * turns it on for QA.
 *
 * Rookie: hazards are telegraphed earlier (twice the warning glow, stronger pulse), never drain energy, and a hit
 * only slows the ship down.
 */
export type HazardMode = 'normal' | 'rookie';

export interface HazardPolicy {
  mode: HazardMode;
  /** Multiplier on hazard warning time and pulse strength. */
  telegraphScale: number;
  /** Hazard hits drain energy. */
  damage: boolean;
  /** Velocity multiplier applied to a ship hit by a hazard when `damage` is off. */
  hitSpeedScale: number;
}

export const HAZARDS_NORMAL: Readonly<HazardPolicy> = Object.freeze({ mode: 'normal', telegraphScale: 1, damage: true, hitSpeedScale: 1 });
export const HAZARDS_ROOKIE: Readonly<HazardPolicy> = Object.freeze({ mode: 'rookie', telegraphScale: 2, damage: false, hitSpeedScale: 0.85 });

export function hazardPolicy(mode: HazardMode): Readonly<HazardPolicy> {
  return mode === 'rookie' ? HAZARDS_ROOKIE : HAZARDS_NORMAL;
}
