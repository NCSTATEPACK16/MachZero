/**
 * The Plunge (Cinder Forge): a steep dive into the crater, a floor section and a climb out.
 *
 * The magnetic lock holds a ship on the road here as it does everywhere else. On a Plunge only, gravity also acts
 * along the road: a ship heading downhill gains speed and a ship heading uphill loses it. The top-speed cap is
 * higher for the whole feature, so the speed won on the dive lasts across the floor and is spent on the climb.
 *
 * A climb never stalls a ship: the pull fades out below PLUNGE_STALL_SPEED, so a ship that restarts on the climb
 * (after a rail hit or a respawn) drives out of it and never rolls back.
 */
import type { TrackData, TrackFeature } from '../../core/contracts';
import { clamp01, inLoopRange, wrap01 } from '../../core/math';

export type PlungeFeature = Extract<TrackFeature, { type: 'plunge' }>;

/** Share of the magnet gravity (CONFIG.MAGNET_G) that acts along the road on a Plunge. */
export const PLUNGE_GRAVITY = 1;
/** The top-speed cap on a Plunge, as a multiple of the ship's top speed (and of its boost top speed while boosting). */
export const PLUNGE_SPEED_CAP = 1.2;
/** Uphill, the pull is full above this forward speed (m/s) and fades to nothing at half of it. */
export const PLUNGE_STALL_SPEED = 60;
/** A ship lost on the dive comes back this far (m) past the foot of the dive, on the floor. */
export const PLUNGE_RESPAWN_AFTER = 20;
/** Steepest pitch a Plunge may have (degrees) and the tightest vertical radius (m): the validator's limits. */
export const PLUNGE_MAX_PITCH = 57;
export const PLUNGE_MIN_RADIUS = 115;

export interface BuiltPlunge {
  uStart: number;
  uEnd: number;
  dStart: number;
  dEnd: number;
}

export function buildPlunges(track: Pick<TrackData, 'features' | 'length'>): BuiltPlunge[] {
  return track.features.flatMap((f) =>
    f.type === 'plunge' ? [{ uStart: wrap01(f.dStart / track.length), uEnd: wrap01(f.dEnd / track.length), dStart: f.dStart, dEnd: f.dEnd }] : [],
  );
}

/**
 * Metres along the lap of the foot of a Plunge's dive: the first place past its steepest point where the road is
 * level again. `forwardY(d)` is the world-up component of the road's direction at `d` metres.
 */
export function plungeDiveFoot(p: Pick<BuiltPlunge, 'dStart' | 'dEnd'>, forwardY: (d: number) => number): number {
  let steepest = p.dStart;
  let low = 0;
  // The dive is the first slope: stop looking once the road has levelled out after it.
  for (let d = p.dStart; d <= p.dEnd; d += 1) {
    const y = forwardY(d);
    if (y < low) [low, steepest] = [y, d];
    else if (low < -0.2 && y > -0.02) break;
  }
  let d = steepest;
  while (d < p.dEnd && forwardY(d) < -0.02) d += 1;
  return d;
}

export function inPlunge(plunges: readonly BuiltPlunge[], u: number): boolean {
  for (const p of plunges) if (inLoopRange(u, p.uStart, p.uEnd)) return true;
  return false;
}

/**
 * Acceleration along the ship's heading (m/s²) from gravity on a Plunge. `forwardY` is the world-up component of
 * the ship's unit heading (negative when it points downhill), `forwardSpeed` its speed along that heading.
 */
export function plungeAccel(magnetG: number, forwardY: number, forwardSpeed: number): number {
  const a = -magnetG * PLUNGE_GRAVITY * forwardY;
  if (a >= 0) return a;
  return a * clamp01((forwardSpeed - PLUNGE_STALL_SPEED / 2) / (PLUNGE_STALL_SPEED / 2));
}
