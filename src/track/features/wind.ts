/**
 * Crosswind zones (Tempest Spire). Inside a zone, while its gust is on, every grounded ship is pushed across the
 * road. The gust runs on the hazard clock (physics seconds since the race reset, never wall-clock), so physics,
 * graphics and the AI agree on it and a race replays the same: in each `period` it blows for `duty · period`
 * seconds, offset by `phase`, building up and dying away over WIND_RAMP seconds. The push also fades in and out
 * over the first and last WIND_EDGE metres of the zone, so a ship that enters mid-gust is not hit by a step.
 *
 * The push itself is applied in physics/ShipController (× the ship's pushScale, the Aero parts' stat).
 */
import type { TrackData, TrackFeature } from '../../core/contracts';
import { smoothstep } from '../../core/math';

type WindFeature = Extract<TrackFeature, { type: 'wind' }>;

/** Seconds a gust takes to build up, and to die away. */
export const WIND_RAMP = 0.5;
/** Metres at each end of a zone over which the push fades in and out. */
export const WIND_EDGE = 20;

export interface BuiltWind {
  index: number;
  /** Main-loop metres. */
  dStart: number;
  dEnd: number;
  /** 1 pushes toward the right rail (positive lateral), −1 toward the left. */
  dir: 1 | -1;
  /** Push at full gust (m/s²), before the ship's pushScale. */
  accel: number;
  period: number;
  phase: number;
  duty: number;
}

export function buildWinds(track: Pick<TrackData, 'features'>): BuiltWind[] {
  const winds: BuiltWind[] = [];
  for (const f of track.features) {
    if (f.type !== 'wind') continue;
    const w = f as WindFeature;
    winds.push({ index: winds.length, dStart: w.dStart, dEnd: w.dEnd, dir: w.dir, accel: w.accel, period: w.period, phase: w.phase, duty: w.duty });
  }
  return winds;
}

/** Gust strength 0..1 at hazard time t. */
export function windGust(w: Pick<BuiltWind, 'period' | 'phase' | 'duty'>, t: number): number {
  const c = (((t + w.phase) % w.period) + w.period) % w.period;
  const on = w.duty * w.period;
  if (c >= on) return 0;
  // A gust that never stops (duty 1) has no ramp: the cycle would otherwise dip to zero once per period.
  if (w.duty >= 1) return 1;
  return smoothstep(0, WIND_RAMP, c) * (1 - smoothstep(on - WIND_RAMP, on, c));
}

/** How much of the zone's push reaches a ship at main-loop metres d: 0 outside, 1 past the edges. */
export function windSpan(w: Pick<BuiltWind, 'dStart' | 'dEnd'>, d: number, length: number): number {
  const rel = (((d - w.dStart) % length) + length) % length;
  const span = w.dEnd - w.dStart;
  if (rel > span) return 0;
  const edge = Math.min(WIND_EDGE, span / 2);
  return Math.min(1, rel / edge, (span - rel) / edge);
}

/** Signed push across the road (m/s², positive toward the right rail) of one zone at metres d and hazard time t. */
export function windAccel(w: BuiltWind, d: number, length: number, t: number): number {
  const span = windSpan(w, d, length);
  return span === 0 ? 0 : w.dir * w.accel * span * windGust(w, t);
}

/** The push of every zone at metres d and hazard time t (zones do not overlap, so at most one contributes). */
export function windAt(winds: readonly BuiltWind[], d: number, length: number, t: number): number {
  let a = 0;
  for (let i = 0; i < winds.length; i++) a += windAccel(winds[i], d, length, t);
  return a;
}
