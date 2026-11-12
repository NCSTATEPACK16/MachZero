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
import * as THREE from 'three';
import { CONFIG } from '../../core/config';
import type { TrackData, TrackFeature } from '../../core/contracts';
import { clamp01 } from '../../core/math';
import { laneIntervals, spreadLateral } from './mine';

type LightningFeature = Extract<TrackFeature, { type: 'lightning' }>;

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

export interface BuiltStrike {
  index: number;
  /** Main-loop metres, u and lateral of the circle's centre. */
  d: number;
  u: number;
  lateral: number;
  period: number;
  /** This point's own offset on the hazard clock (the field's phase plus its stagger). */
  phase: number;
  /** The circle's centre on the deck, the road's up there, and the centre at hull height (the hit test). */
  position: THREE.Vector3;
  up: THREE.Vector3;
  center: THREE.Vector3;
}

/** Half-width of the clear lane a field leaves: a hull, the margin and a circle's radius. */
export function strikeLaneGap(): number {
  return CONFIG.SHIP_WIDTH / 2 + STRIKE_LANE_MARGIN + STRIKE_RADIUS;
}

export function buildStrikes(track: Pick<TrackData, 'features' | 'halfWidth' | 'length' | 'sampleAt'>): BuiltStrike[] {
  const strikes: BuiltStrike[] = [];
  for (const f of track.features) {
    if (f.type !== 'lightning') continue;
    const field = f as LightningFeature;
    const intervals = laneIntervals(track.halfWidth, field.lane ?? 0, strikeLaneGap(), STRIKE_RAIL_MARGIN + STRIKE_RADIUS);
    if (intervals.length === 0) throw new Error(`lightning field at ${field.dStart} m leaves no room beside its lane`);
    const span = field.dEnd - field.dStart;
    for (let k = 0; k < field.count; k++) {
      const d = field.dStart + ((k + 0.5) / field.count) * span;
      const u = (((d / track.length) % 1) + 1) % 1;
      const lateral = spreadLateral(intervals, k);
      const s = track.sampleAt(u);
      const position = s.position.clone().addScaledVector(s.right, lateral);
      strikes.push({
        index: strikes.length,
        d,
        u,
        lateral,
        period: field.period,
        // Golden-ratio stagger: neighbours never strike together, and the pattern does not repeat along the field.
        phase: field.phase + ((k * 0.618034) % 1) * field.period,
        position,
        up: s.up.clone(),
        center: position.clone().addScaledVector(s.up, CONFIG.HOVER_HEIGHT),
      });
    }
  }
  return strikes;
}

/** Seconds into the point's current cycle: the bolt is the first STRIKE_TIME seconds of each. */
function cycleTime(s: Pick<BuiltStrike, 'period' | 'phase'>, t: number): number {
  return (((t + s.phase) % s.period) + s.period) % s.period;
}

/** Which of the point's strikes time t belongs to (one hit per ship per strike). */
export function strikeCycle(s: Pick<BuiltStrike, 'period' | 'phase'>, t: number): number {
  return Math.floor((t + s.phase) / s.period);
}

/** Is the bolt down at time t? */
export function strikeActive(s: Pick<BuiltStrike, 'period' | 'phase'>, t: number): boolean {
  return cycleTime(s, t) < STRIKE_TIME;
}

/** Warning glow 0..1 over the `warning` seconds before the bolt (1 while it is down). */
export function strikeWarning(s: Pick<BuiltStrike, 'period' | 'phase'>, t: number, warning = STRIKE_WARNING): number {
  const c = cycleTime(s, t);
  if (c < STRIKE_TIME) return 1;
  const toStrike = s.period - c;
  return toStrike <= warning ? clamp01(1 - toStrike / warning) : 0;
}

/** Is the bolt down at any moment of [t0, t1]? (The AI's arrival check.) */
export function strikesDuring(s: Pick<BuiltStrike, 'period' | 'phase'>, t0: number, t1: number): boolean {
  if (t1 - t0 >= s.period) return true;
  const c0 = cycleTime(s, t0);
  // Down at t0, or the next bolt starts before t1.
  return c0 < STRIKE_TIME || c0 + (t1 - t0) >= s.period;
}
