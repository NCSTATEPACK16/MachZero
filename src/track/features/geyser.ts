/**
 * Lava geysers (Cinder Forge). Each `geysers` feature places its vents evenly along [dStart, dEnd], either side of a
 * clear lane centred at lateral `lane`: a ship on the lane centre passes every vent with GEYSER_LANE_MARGIN to spare.
 * A vent erupts once per `period` seconds on the hazard clock (features/timedField.ts). It glows for GEYSER_WARNING
 * seconds (× the hazard policy's telegraphScale) first, and the eruption, a column of lava GEYSER_RADIUS wide, lasts
 * GEYSER_TIME seconds. The vents of a field erupt at different moments.
 *
 * The hit (a knock up off the road and energy, or the Rookie slow-down; a Shield blocks it) is in
 * physics/PhysicsSystem. A ship is hit once per eruption.
 */
import type { TrackData } from '../../core/contracts';
import { type TimedPoint, buildTimedPoints, fieldLaneGap, pointActive, pointActiveDuring, pointActiveFor, pointCycle, pointWarning } from './timedField';

/** Radius of a vent's lava column (m). */
export const GEYSER_RADIUS = 2.5;
/** Seconds a vent glows before it erupts (× the hazard policy's telegraphScale). */
export const GEYSER_WARNING = 1.5;
/** Seconds an eruption lasts: a hull that touches the column during them is hit, once. */
export const GEYSER_TIME = 1.2;
/** Energy an eruption costs (× the ship's damageTakenScale) and the knock up the road's normal (m/s): the mine's numbers. */
export const GEYSER_DAMAGE = 8;
export const GEYSER_KNOCK_UP = 10;
/** Clearance (m) between a hull on the lane centre and the nearest column. */
export const GEYSER_LANE_MARGIN = 1.5;
/** Closest a column's edge comes to a rail (m). */
const GEYSER_RAIL_MARGIN = 0.5;
/** The shortest period a field may have: the Rookie warning (twice as long) must fit between two eruptions. */
export const GEYSER_MIN_PERIOD = 2 * GEYSER_WARNING + GEYSER_TIME + 0.5;

/** A vent: where it is and when it erupts. */
export type BuiltGeyser = TimedPoint;
type Timeline = Pick<BuiltGeyser, 'period' | 'phase'>;

const SHAPE = { radius: GEYSER_RADIUS, laneMargin: GEYSER_LANE_MARGIN, railMargin: GEYSER_RAIL_MARGIN };

/** Half-width of the clear lane a field leaves: a hull, the margin and a column's radius. */
export function geyserLaneGap(): number {
  return fieldLaneGap(SHAPE);
}

export function buildGeysers(track: Pick<TrackData, 'features' | 'halfWidth' | 'length' | 'sampleAt'>): BuiltGeyser[] {
  return buildTimedPoints(track, 'geysers', SHAPE);
}

/** Which of the vent's eruptions time t belongs to (one hit per ship per eruption). */
export function geyserCycle(g: Timeline, t: number): number {
  return pointCycle(g, t);
}

/** Is the vent erupting at time t? The eruption is the last GEYSER_TIME seconds of each cycle. */
export function geyserActive(g: Timeline, t: number): boolean {
  return pointActive(g, t, GEYSER_TIME);
}

/** How far through its eruption the vent is, 0..1 (0 while it is not erupting). */
export function geyserProgress(g: Timeline, t: number): number {
  return pointActiveFor(g, t, GEYSER_TIME) / GEYSER_TIME;
}

/** Warning glow 0..1 over the `warning` seconds before the eruption (1 while it erupts). */
export function geyserWarning(g: Timeline, t: number, warning = GEYSER_WARNING): number {
  return pointWarning(g, t, GEYSER_TIME, warning);
}

/** Does the vent erupt at any moment of [t0, t1]? (The AI's arrival check.) */
export function geyserDuring(g: Timeline, t0: number, t1: number): boolean {
  return pointActiveDuring(g, t0, t1, GEYSER_TIME);
}
