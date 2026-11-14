/**
 * Timed hazard fields: the part lightning fields (Tempest Spire) and geyser fields (Cinder Forge) share.
 *
 * A field places its points evenly along [dStart, dEnd], either side of a clear lane centred at lateral `lane`.
 * Each point goes off once per `period` seconds on the hazard clock (physics seconds since the race reset, never
 * wall-clock), so physics, graphics and the AI agree on it and a race replays the same. A point warns for some
 * seconds, then is active for `active` seconds: **the active time is the end of each cycle**, so no point goes off
 * at t = 0 without a warning. The points of a field go off at different moments.
 */
import * as THREE from 'three';
import { CONFIG } from '../../core/config';
import type { TrackData } from '../../core/contracts';
import { clamp01 } from '../../core/math';
import { laneIntervals, spreadLateral } from './mine';

export interface TimedPoint {
  index: number;
  /** Main-loop metres, u and lateral of the point's centre. */
  d: number;
  u: number;
  lateral: number;
  period: number;
  /** This point's own offset on the hazard clock (the field's phase plus its stagger). */
  phase: number;
  /** The centre on the deck, the road's up there, and the centre at hull height (the hit test). */
  position: THREE.Vector3;
  up: THREE.Vector3;
  center: THREE.Vector3;
}

type Timeline = Pick<TimedPoint, 'period' | 'phase'>;

export interface TimedFieldShape {
  /** Radius of a point's circle on the deck (m). */
  radius: number;
  /** Clearance (m) between a hull on the lane centre and the nearest circle. */
  laneMargin: number;
  /** Closest a circle's edge comes to a rail (m). */
  railMargin: number;
}

/** Half-width of the clear lane a field leaves: a hull, the margin and a circle's radius. */
export function fieldLaneGap(shape: TimedFieldShape): number {
  return CONFIG.SHIP_WIDTH / 2 + shape.laneMargin + shape.radius;
}

export function buildTimedPoints(
  track: Pick<TrackData, 'features' | 'halfWidth' | 'length' | 'sampleAt'>,
  type: 'lightning' | 'geysers',
  shape: TimedFieldShape,
): TimedPoint[] {
  const points: TimedPoint[] = [];
  for (const f of track.features) {
    if (f.type !== type) continue;
    const intervals = laneIntervals(track.halfWidth, f.lane ?? 0, fieldLaneGap(shape), shape.railMargin + shape.radius);
    if (intervals.length === 0) throw new Error(`${type} field at ${f.dStart} m leaves no room beside its lane`);
    const span = f.dEnd - f.dStart;
    for (let k = 0; k < f.count; k++) {
      const d = f.dStart + ((k + 0.5) / f.count) * span;
      const u = (((d / track.length) % 1) + 1) % 1;
      const lateral = spreadLateral(intervals, k);
      const s = track.sampleAt(u);
      const position = s.position.clone().addScaledVector(s.right, lateral);
      points.push({
        index: points.length,
        d,
        u,
        lateral,
        period: f.period,
        // Golden-ratio stagger: neighbours never go off together, and the pattern does not repeat along the field.
        phase: f.phase + ((k * 0.618034) % 1) * f.period,
        position,
        up: s.up.clone(),
        center: position.clone().addScaledVector(s.up, CONFIG.HOVER_HEIGHT),
      });
    }
  }
  return points;
}

/** Seconds into the point's current cycle. */
function cycleTime(p: Timeline, t: number): number {
  return (((t + p.phase) % p.period) + p.period) % p.period;
}

/** Which of the point's cycles time t belongs to (one hit per ship per cycle). */
export function pointCycle(p: Timeline, t: number): number {
  return Math.floor((t + p.phase) / p.period);
}

/** Is the point active at time t? (`active` = seconds it is active for, at the end of each cycle.) */
export function pointActive(p: Timeline, t: number, active: number): boolean {
  return cycleTime(p, t) >= p.period - active;
}

/** Seconds the point has been active for at time t (0 while it is not). */
export function pointActiveFor(p: Timeline, t: number, active: number): number {
  return Math.max(0, cycleTime(p, t) - (p.period - active));
}

/** Warning glow 0..1 over the `warning` seconds before the point goes off (1 while it is active). */
export function pointWarning(p: Timeline, t: number, active: number, warning: number): number {
  const toGo = p.period - active - cycleTime(p, t);
  if (toGo <= 0) return 1;
  return toGo <= warning ? clamp01(1 - toGo / warning) : 0;
}

/** Is the point active at any moment of [t0, t1]? (The AI's arrival check.) */
export function pointActiveDuring(p: Timeline, t0: number, t1: number, active: number): boolean {
  if (t1 - t0 >= p.period - active) return true;
  // Active at t0, or this cycle's active time starts before t1.
  return cycleTime(p, t0) + (t1 - t0) >= p.period - active;
}
