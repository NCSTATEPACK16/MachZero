/**
 * The hazard cue (IMPLEMENTATION §M7c): in colour-blind mode the HUD names the nearest hazard ahead of the player and
 * points to the clear side, so no hazard is told by colour alone. Pure: the spots are built once per track from its
 * features and the same timelines the AI and physics use (the hazard clock), and `hazardCue` is called per frame.
 * No 3D, so no draw calls.
 */
import type { TrackData } from '../core/contracts';
import { gateClosure, gateWarning } from '../track/features/gate';
import { buildGeysers, geyserWarning } from '../track/features/geyser';
import { buildJets, jetWarning } from '../track/features/jet';
import { buildStrikes, strikeWarning } from '../track/features/lightning';

export type HazardKind = 'ice' | 'gate' | 'mine' | 'debris' | 'lightning' | 'geyser' | 'jet';

/** The HUD chip's icon per kind. */
export const HAZARD_ICONS: Readonly<Record<HazardKind, string>> = {
  ice: '❄',
  gate: '▮',
  mine: '✸',
  debris: '◆',
  lightning: '⚡',
  geyser: '♨',
  jet: '➶',
};
export const HAZARD_NAMES: Readonly<Record<HazardKind, string>> = {
  ice: 'ICE',
  gate: 'GATE',
  mine: 'MINES',
  debris: 'DEBRIS',
  lightning: 'LIGHTNING',
  geyser: 'GEYSER',
  jet: 'JET',
};

/** How far ahead the cue looks, in seconds at the current speed. */
export const CUE_HORIZON = 2.5;
/** Within this many metres of the clear lane's centre the arrow goes away (the ship is already clear). */
export const CUE_LANE_DEADBAND = 1.5;
/** The cue still looks this far ahead (m) when the ship is slow. */
const CUE_MIN_REACH = 30;

/** One hazard on the main loop: where it starts and ends (main metres), when it is live, and where the clear road is. */
export interface CueSpot {
  kind: HazardKind;
  d: number;
  dEnd: number;
  /** Warning or active at hazard-clock time t. */
  live(t: number): boolean;
  /** The clear side for a ship at `lateral`: −1 left, 1 right, 0 none (already clear, or no side is clear). */
  clear(lateral: number): -1 | 0 | 1;
}

export interface HazardCueOut {
  kind: HazardKind;
  side: -1 | 0 | 1;
  /** Metres to the hazard's start (0 while inside it). */
  dist: number;
}

const towardLane = (lane: number) => (lateral: number): -1 | 0 | 1 => (Math.abs(lane - lateral) <= CUE_LANE_DEADBAND ? 0 : lane > lateral ? 1 : -1);
const always = (): boolean => true;

/** Every cue spot on the track's main loop (split paths have none: the cue stays quiet there). */
export function buildCueSpots(track: Pick<TrackData, 'features' | 'halfWidth' | 'length' | 'sampleAt' | 'surfacePoint'>): CueSpot[] {
  const spots: CueSpot[] = [];
  const hw = track.halfWidth;
  const room = 3; // metres of road a ship needs beside a hazard
  for (const f of track.features) {
    switch (f.type) {
      case 'ice': {
        const leftFree = f.lateralMin > -hw + room;
        const rightFree = f.lateralMax < hw - room;
        const mid = (f.lateralMin + f.lateralMax) / 2;
        spots.push({
          kind: 'ice',
          d: f.dStart,
          dEnd: f.dEnd,
          live: always,
          clear: (lat) => {
            if (lat < f.lateralMin - 1 || lat > f.lateralMax + 1) return 0;
            if (leftFree && rightFree) return lat < mid ? -1 : 1;
            return leftFree ? -1 : rightFree ? 1 : 0;
          },
        });
        break;
      }
      case 'gate':
        if (f.branch) break;
        spots.push({
          kind: 'gate',
          d: f.d - 1,
          dEnd: f.d + 1,
          live: (t) => gateWarning(f, t) > 0 || gateClosure(f, t) > 0,
          clear: () => (f.span === 'left' ? 1 : f.span === 'right' ? -1 : 0),
        });
        break;
      case 'mines':
      case 'debris':
        spots.push({ kind: f.type === 'mines' ? 'mine' : 'debris', d: f.dStart, dEnd: f.dEnd, live: always, clear: towardLane(f.lane ?? 0) });
        break;
      default:
        break;
    }
  }
  const timed = (kind: 'lightning' | 'geyser' | 'jet', pts: readonly { d: number; lane: number; period: number; phase: number }[], warning: (p: { period: number; phase: number }, t: number) => number) => {
    for (const p of pts) spots.push({ kind, d: p.d - 3, dEnd: p.d + 3, live: (t) => warning(p, t) > 0, clear: towardLane(p.lane) });
  };
  if (track.features.some((f) => f.type === 'lightning')) timed('lightning', buildStrikes(track), strikeWarning);
  if (track.features.some((f) => f.type === 'geysers')) timed('geyser', buildGeysers(track), geyserWarning);
  if (track.features.some((f) => f.type === 'jets')) timed('jet', buildJets(track), jetWarning);
  return spots;
}

/**
 * The nearest spot ahead of (or around) the player within CUE_HORIZON seconds at `speed` that is warning or active now
 * or on arrival, or null. `here` is the player's main-loop metres; `now` the hazard clock.
 */
export function hazardCue(spots: readonly CueSpot[], here: number, lateral: number, speed: number, now: number, length: number): HazardCueOut | null {
  const v = Math.max(speed, 1);
  const reach = Math.max(CUE_MIN_REACH, v * CUE_HORIZON);
  let best: HazardCueOut | null = null;
  for (const s of spots) {
    const span = (((s.dEnd - s.d) % length) + length) % length;
    let dist = (((s.d - here) % length) + length) % length;
    if (dist > length - span) dist = 0; // inside it
    if (dist > reach || (best && dist >= best.dist)) continue;
    if (!s.live(now) && !s.live(now + dist / v)) continue;
    best = { kind: s.kind, side: s.clear(lateral), dist };
  }
  return best;
}
