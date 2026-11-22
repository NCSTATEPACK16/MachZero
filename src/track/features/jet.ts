/**
 * Pressure jets (Abyss Line). Each `jets` feature places its vents on a Spine, evenly along [dStart, dEnd], either side
 * of a clear lane centred at lateral `lane` (metres round the tube from its crown): a ship on the lane centre passes
 * every vent with JET_LANE_MARGIN to spare. A vent fires once per `period` seconds on the hazard clock
 * (features/timedField.ts). A bubble stream warns for JET_WARNING seconds (× the hazard policy's telegraphScale) first,
 * and the jet, a column of water JET_RADIUS wide straight out from the tube, lasts JET_TIME seconds. The vents of a
 * field fire at different moments. Vents sit on the curled surface (TrackData.surfacePoint), never on the bottom seam.
 *
 * The hit (a knock round the tube, away from the vent, and energy; or the Rookie knock and slow-down; a Shield blocks
 * it) is in physics/PhysicsSystem and ShipController.applyJet. A ship is hit once per jet.
 */
import type { TrackData } from '../../core/contracts';
import { type TimedPoint, buildTimedPoints, fieldLaneGap, pointActive, pointActiveDuring, pointActiveFor, pointCycle, pointWarning } from './timedField';

/** Radius of a jet's column (m). */
export const JET_RADIUS = 2.2;
/** Seconds the bubble stream warns before the jet fires (× the hazard policy's telegraphScale). */
export const JET_WARNING = 1.5;
/** Seconds a jet fires: a hull that touches the column during them is hit, once. */
export const JET_TIME = 0.8;
/** Energy a jet costs (× the ship's damageTakenScale) and its knock round the tube (m/s, × the ship's pushScale). */
export const JET_DAMAGE = 5;
export const JET_KNOCK = 9;
/** The Rookie knock (m/s, × pushScale): no energy, and the policy's slow-down. */
export const JET_KNOCK_ROOKIE = 5;
/** Clearance (m) between a hull on the lane centre and the nearest column. */
export const JET_LANE_MARGIN = 1.5;
/** Closest a column's edge comes to the bottom seam (m round the tube): ships are eased off the seam there. */
export const JET_SEAM_MARGIN = 1.5;
/** The shortest period a field may have: the Rookie warning (twice as long) must fit between two jets. */
export const JET_MIN_PERIOD = 2 * JET_WARNING + JET_TIME + 0.5;

/** A vent: where it is (on the tube) and when it fires. */
export type BuiltJet = TimedPoint;
type Timeline = Pick<BuiltJet, 'period' | 'phase'>;

const SHAPE = { radius: JET_RADIUS, laneMargin: JET_LANE_MARGIN, railMargin: JET_SEAM_MARGIN };

/** Half-width of the clear lane a field leaves: a hull, the margin and a column's radius. */
export function jetLaneGap(): number {
  return fieldLaneGap(SHAPE);
}

/** Room a vent's centre keeps from the seam (m): its radius and the seam margin. */
export function jetSeamGap(): number {
  return JET_RADIUS + JET_SEAM_MARGIN;
}

export function buildJets(track: Pick<TrackData, 'features' | 'halfWidth' | 'length' | 'sampleAt' | 'surfacePoint'>): BuiltJet[] {
  return buildTimedPoints(track, 'jets', SHAPE);
}

/** Which of the vent's jets time t belongs to (one hit per ship per jet). */
export function jetCycle(j: Timeline, t: number): number {
  return pointCycle(j, t);
}

/** Is the vent firing at time t? The jet is the last JET_TIME seconds of each cycle. */
export function jetActive(j: Timeline, t: number): boolean {
  return pointActive(j, t, JET_TIME);
}

/** How far through its jet the vent is, 0..1 (0 while it is not firing). */
export function jetProgress(j: Timeline, t: number): number {
  return pointActiveFor(j, t, JET_TIME) / JET_TIME;
}

/** Warning 0..1 over the `warning` seconds before the jet (1 while it fires). */
export function jetWarning(j: Timeline, t: number, warning = JET_WARNING): number {
  return pointWarning(j, t, JET_TIME, warning);
}

/** Does the vent fire at any moment of [t0, t1]? (The AI's arrival check.) */
export function jetDuring(j: Timeline, t0: number, t1: number): boolean {
  return pointActiveDuring(j, t0, t1, JET_TIME);
}
