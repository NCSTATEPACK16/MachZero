/**
 * Lightning fields (Tempest Spire). Each `lightning` feature places its strike points evenly along [dStart, dEnd],
 * either side of a clear lane centred at lateral `lane`: a ship on the lane centre passes every strike circle with
 * STRIKE_LANE_MARGIN to spare. A point strikes once per `period` seconds on the hazard clock (physics seconds since
 * the race reset, never wall-clock), so physics, graphics and the AI agree on it and a race replays the same. Its
 * circle on the deck glows for STRIKE_WARNING seconds (× the hazard policy's telegraphScale) before the bolt, and
 * the bolt lasts STRIKE_TIME seconds. The points of a field strike at different moments.
 *
 * The hit (energy and a boost jam, or the Rookie slow-down; a Shield blocks it) is in physics/PhysicsSystem.
 */
import type { TrackData } from '../../core/contracts';
import { type TimedPoint, buildTimedPoints, fieldLaneGap, pointActive, pointActiveDuring, pointCycle, pointWarning } from './timedField';

/** Radius of a strike circle on the deck (m). */
export const STRIKE_RADIUS = 3;
/** Seconds the circle glows before the bolt (× the hazard policy's telegraphScale). */
export const STRIKE_WARNING = 1.5;
/** Seconds a bolt lasts: a hull inside the circle during them is hit. */
export const STRIKE_TIME = 0.2;
/** Energy a strike costs (× the ship's damageTakenScale), and seconds it jams the boost for. */
export const STRIKE_DAMAGE = 6;
export const STRIKE_JAM = 3;
/** Clearance (m) between a hull on the lane centre and the nearest strike circle. */
export const STRIKE_LANE_MARGIN = 1.5;
/** Closest a strike circle's edge comes to a rail (m). */
const STRIKE_RAIL_MARGIN = 0.5;
/** The shortest period a field may have: the Rookie warning (twice as long) must fit between two bolts. */
export const STRIKE_MIN_PERIOD = 2 * STRIKE_WARNING + STRIKE_TIME + 0.5;

/** A strike point: where it is and when it strikes (features/timedField.ts). */
export type BuiltStrike = TimedPoint;

const SHAPE = { radius: STRIKE_RADIUS, laneMargin: STRIKE_LANE_MARGIN, railMargin: STRIKE_RAIL_MARGIN };

/** Half-width of the clear lane a field leaves: a hull, the margin and a circle's radius. */
export function strikeLaneGap(): number {
  return fieldLaneGap(SHAPE);
}

export function buildStrikes(track: Pick<TrackData, 'features' | 'halfWidth' | 'length' | 'sampleAt'>): BuiltStrike[] {
  return buildTimedPoints(track, 'lightning', SHAPE);
}

/** Which of the point's strikes time t belongs to (one hit per ship per strike). */
export function strikeCycle(s: Pick<BuiltStrike, 'period' | 'phase'>, t: number): number {
  return pointCycle(s, t);
}

/** Is the bolt down at time t? The bolt is the last STRIKE_TIME seconds of each cycle, so no point strikes at t = 0. */
export function strikeActive(s: Pick<BuiltStrike, 'period' | 'phase'>, t: number): boolean {
  return pointActive(s, t, STRIKE_TIME);
}

/** Warning glow 0..1 over the `warning` seconds before the bolt (1 while it is down). */
export function strikeWarning(s: Pick<BuiltStrike, 'period' | 'phase'>, t: number, warning = STRIKE_WARNING): number {
  return pointWarning(s, t, STRIKE_TIME, warning);
}

/** Is the bolt down at any moment of [t0, t1]? (The AI's arrival check.) */
export function strikesDuring(s: Pick<BuiltStrike, 'period' | 'phase'>, t0: number, t1: number): boolean {
  return pointActiveDuring(s, t0, t1, STRIKE_TIME);
}
