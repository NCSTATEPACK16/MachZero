/**
 * Magnetic mines (Orbital Ring). Each `mines` feature scatters its mines evenly along [dStart, dEnd], either side of
 * a clear lane centred at lateral `lane`: a ship on the lane centre passes every mine with MINE_LANE_MARGIN to spare
 * at the widest point of its drift. A mine hovers at hull height and drifts on a small Lissajous figure (sideways by
 * `drift`, along the road by half that) on the hazard clock (physics seconds since the race reset, never wall-clock),
 * so physics, graphics and the AI agree on where it is and a race replays the same.
 *
 * The hit itself (the knock, energy or Rookie slow-down, re-arming) is physics/MineField.ts, which the Drop Mine
 * item (§P) reuses with its own spawn and lifetime.
 */
import { CONFIG } from '../../core/config';
import type { TrackData, TrackFeature } from '../../core/contracts';

type MinesFeature = Extract<TrackFeature, { type: 'mines' }>;

/** Trigger radius of a mine (m): it goes off when this sphere touches a hull. */
export const MINE_RADIUS = 1;
/** Height of a mine's centre above the deck: the hull's hover height, so it meets the ship side-on. */
export const MINE_LIFT = CONFIG.HOVER_HEIGHT;
/** Clearance (m) between a hull on the lane centre and a mine at the widest point of its drift. */
export const MINE_LANE_MARGIN = 1.5;
/** Closest a mine's drift comes to the rail (m). */
const MINE_RAIL_MARGIN = 1.5;
/** Lissajous rates (rad/s): sideways, and along the road. */
const MINE_RATE_SIDE = 0.9;
const MINE_RATE_ALONG = 1.4;

export interface TrackMine {
  index: number;
  /** Main-loop metres at the centre of its drift. */
  d: number;
  /** Lateral at the centre of its drift (m). */
  lateral: number;
  /** Sideways and along-road drift amplitudes (m). */
  driftSide: number;
  driftAlong: number;
  phase: number;
}

/** Half-width of the clear lane a mine field must leave: a hull plus the margin plus a mine at full drift. */
export function mineLaneGap(drift: number): number {
  return CONFIG.SHIP_WIDTH / 2 + MINE_LANE_MARGIN + MINE_RADIUS + drift;
}

/**
 * The free lateral intervals of a field: the road either side of the lane, inset so neither a drifting hazard nor
 * the lane is touched. `inset` keeps it off the rails, `gap` is the lane's half-width. Empty intervals are dropped.
 */
export function laneIntervals(halfWidth: number, lane: number, gap: number, inset: number): [number, number][] {
  const out: [number, number][] = [];
  const lo = -halfWidth + inset;
  const hi = halfWidth - inset;
  if (lane - gap > lo) out.push([lo, Math.min(hi, lane - gap)]);
  if (lane + gap < hi) out.push([Math.max(lo, lane + gap), hi]);
  return out;
}

/** Lateral for the k-th of `count` hazards spread over the intervals (golden-ratio spacing, deterministic). */
export function spreadLateral(intervals: readonly [number, number][], k: number): number {
  const total = intervals.reduce((a, [lo, hi]) => a + (hi - lo), 0);
  let x = ((k * 0.618034 + 0.31) % 1) * total;
  for (const [lo, hi] of intervals) {
    if (x <= hi - lo) return lo + x;
    x -= hi - lo;
  }
  return intervals[intervals.length - 1][1];
}

export function buildMines(track: Pick<TrackData, 'features' | 'halfWidth'>): TrackMine[] {
  const mines: TrackMine[] = [];
  for (const f of track.features) {
    if (f.type !== 'mines') continue;
    const field = f as MinesFeature;
    const lane = field.lane ?? 0;
    const intervals = laneIntervals(track.halfWidth, lane, mineLaneGap(field.drift), MINE_RAIL_MARGIN + MINE_RADIUS + field.drift);
    if (intervals.length === 0) throw new Error(`mine field at ${field.dStart} m leaves no room beside its lane`);
    const span = field.dEnd - field.dStart;
    for (let k = 0; k < field.count; k++) {
      mines.push({
        index: mines.length,
        d: field.dStart + ((k + 0.5) / field.count) * span,
        lateral: spreadLateral(intervals, k),
        driftSide: field.drift,
        driftAlong: field.drift / 2,
        phase: mines.length * 2.399,
      });
    }
  }
  return mines;
}

/** Where a track mine is at hazard time t: main-loop metres and lateral. */
export function minePose(m: TrackMine, t: number, out: { d: number; lateral: number }): { d: number; lateral: number } {
  out.lateral = m.lateral + m.driftSide * Math.sin(MINE_RATE_SIDE * t + m.phase);
  out.d = m.d + m.driftAlong * Math.sin(MINE_RATE_ALONG * t + 1.7 * m.phase);
  return out;
}
