/**
 * Jump geometry (open-air gaps).
 *
 * The authored centerline should run straight (in plan) and evenly graded through a jump; the builder then
 * adds a vertical profile on top of it:
 *   - ramp: over RAMP_LENGTH before the lip the deck rises `kick` metres (quadratic, so the steepest pitch,
 *     2·kick / RAMP_LENGTH, is at the lip: a kicker);
 *   - gap: the centerline follows the flight path of a ship leaving the lip at `designSpeed` under air
 *     gravity (MAGNET_G × airGravityScale). Air gravity pulls along -sample.up, i.e. normal to this arc, so a
 *     ship at the design speed stays at hover height above it; faster ships fly a little high, slower ones a
 *     little low. The landing deck starts on the arc, so a ship slightly low is caught by the hover rays;
 *   - landing: a cubic blend from the arc's height and slope back to the authored grade.
 * The displacement is applied to the fine spline samples before arc-length resampling, so the result is an
 * ordinary uniformly-sampled centerline: frames, project() and the AI need no special cases.
 */
import { CONFIG } from '../../core/config';
import type { CurveDisplacement } from '../TrackFrames';

export const RAMP_LENGTH = 60;
export const LANDING_BLEND = 110;
export const DEFAULT_DESIGN_SPEED = 95;

export interface JumpSpec {
  dTakeoff: number;
  dLanding: number;
  kick: number;
  designSpeed?: number;
}

/** Vertical offset (m) the jump adds to the authored centerline at distance d (same units as the spec). */
export function jumpOffset(j: JumpSpec, d: number, airGravityScale: number): number {
  const g = CONFIG.MAGNET_G * airGravityScale;
  const v = j.designSpeed ?? DEFAULT_DESIGN_SPEED;
  const s0 = (2 * j.kick) / RAMP_LENGTH;
  const x0 = j.dTakeoff - RAMP_LENGTH;
  if (d <= x0) return 0;
  if (d <= j.dTakeoff) {
    const t = (d - x0) / RAMP_LENGTH;
    return j.kick * t * t;
  }
  const flight = (x: number): number => j.kick + s0 * x - 0.5 * g * (x / v) * (x / v);
  if (d <= j.dLanding) return flight(d - j.dTakeoff);
  const end = j.dLanding + LANDING_BLEND;
  if (d >= end) return 0;
  const gap = j.dLanding - j.dTakeoff;
  const yL = flight(gap);
  const mL = s0 - (g * gap) / (v * v);
  const t = (d - j.dLanding) / LANDING_BLEND;
  const h00 = 2 * t * t * t - 3 * t * t + 1;
  const h10 = t * t * t - 2 * t * t + t;
  return h00 * yL + h10 * LANDING_BLEND * mL;
}

/** Displacement for resampleCurve: raises every fine sample by the summed jump offsets. */
export function jumpDisplacement(jumps: readonly JumpSpec[], airGravityScale: number): CurveDisplacement {
  return (fp, cum, fine) => {
    for (let k = 0; k < fine; k++) {
      let dy = 0;
      for (const j of jumps) dy += jumpOffset(j, cum[k], airGravityScale);
      fp[k * 3 + 1] += dy;
    }
  };
}
