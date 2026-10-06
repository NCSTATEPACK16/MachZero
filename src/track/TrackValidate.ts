/**
 * Checks for authored tracks (IMPLEMENTATION §M3.1), run by the tests and `npm run tracks:check`:
 *   - minimum radius of curvature (plan and vertical);
 *   - 3D clearance between sections that pass over or near each other;
 *   - centerline elevation within the world's bounds;
 *   - features on straights, clear of each other and of the start and pit;
 *   - lap length in the band that gives a 30–45 s lap at Pilot pace;
 *   - split paths: fork and merge overlaps on main straights, branch radius and elevation, and the branch clear
 *     of the main road once the two have separated.
 */
import { CONFIG } from '../core/config';
import type { TrackData, TrackFeature } from '../core/contracts';
import { RAMP_LENGTH, LANDING_BLEND } from './features/jump';
import { branchSeparation } from './features/branch';

export interface TrackIssue {
  code: 'radius' | 'clearance' | 'elevation' | 'feature-overlap' | 'feature-straight' | 'start' | 'length' | 'pipe' | 'branch';
  message: string;
}

export interface TrackReport {
  id: string;
  length: number;
  minRadius: number;
  minClearance: number;
  elevation: [number, number];
  /** Estimated lap time (s) at Pilot pace. */
  lapEstimate: number;
  issues: TrackIssue[];
}

export const VALIDATION = {
  MIN_RADIUS: CONFIG.TRACK_MIN_RADIUS,
  MIN_RADIUS_LOOP: 45,
  /** Sections whose decks pass within this plan distance must be separated vertically by MIN_CLEARANCE. */
  OVERLAP_PLAN: 2 * (CONFIG.TRACK_HALF_WIDTH + CONFIG.RAIL_THICKNESS) + 6,
  MIN_CLEARANCE: 12,
  /** Sections closer than this along the lap are neighbours, not crossings. */
  NEIGHBOUR_ARC: 250,
  /** Average Pilot pace used for the lap-time estimate (m/s). */
  PILOT_PACE: 118,
  LAP_TIME: [30, 45] as [number, number],
  /** Plan curvature below which a stretch counts as straight (1/m). */
  STRAIGHT_K: 1 / 900,
  /** Start straight: metres behind (grid) and ahead (pit) of the line that must be straight. */
  START_BEHIND: 110,
  START_AHEAD: 260,
  /** Straight run needed after a jump's landing edge (a boosted ship can fly ~200 m past the gap). */
  JUMP_RUNOUT: 250,
  /** Pipes bend gently (plan radius) and close/open over at least this many metres. */
  PIPE_MIN_RADIUS: 300,
  PIPE_MIN_TRANSITION: 60,
  /** A pipe's closed stretch must be at least this long. */
  PIPE_MIN_CLOSED: 150,
  /** Tolerance (m) on the rail-to-rail separation a branch keeps from the main road once separated. */
  BRANCH_SEPARATION_SLACK: 0.5,
} as const;

/** [start, end] metres a feature occupies, including its approach/exit (jump ramp and landing blend). */
function featureSpan(f: TrackFeature): [number, number] | null {
  switch (f.type) {
    case 'corkscrew':
    case 'pipe':
    case 'loop':
      return [f.dStart, f.dEnd];
    case 'jump':
      return [f.dTakeoff - RAMP_LENGTH, f.dLanding + LANDING_BLEND];
    default:
      return null;
  }
}

function circularOverlap(a: [number, number], b: [number, number], L: number): boolean {
  const norm = (x: number) => ((x % L) + L) % L;
  const inside = (x: number, r: [number, number]) => {
    const s = norm(r[0]);
    const e = norm(r[1]);
    const v = norm(x);
    return s <= e ? v >= s && v <= e : v >= s || v <= e;
  };
  return inside(a[0], b) || inside(a[1], b) || inside(b[0], a) || inside(b[1], a);
}

export function validateTrack(track: TrackData, elevation: [number, number] = [CONFIG.TRACK_MIN_ELEVATION, CONFIG.TRACK_MAX_ELEVATION]): TrackReport {
  const issues: TrackIssue[] = [];
  const n = track.samples.length;
  const L = track.length;
  const ds = L / n;
  const loops = track.features.filter((f) => f.type === 'loop').map((f) => featureSpan(f)!);

  // ---- curvature (full 3D, from the sampled tangents) ----
  let minRadius = Infinity;
  for (let i = 0; i < n; i++) {
    const a = track.samples[(i + 1) % n].forward;
    const b = track.samples[(i - 1 + n) % n].forward;
    const k = a.distanceTo(b) / (2 * ds);
    const r = 1 / Math.max(k, 1e-9);
    const d = i * ds;
    const inLoop = loops.some((s) => circularOverlap([d, d], s, L));
    const limit = inLoop ? VALIDATION.MIN_RADIUS_LOOP : VALIDATION.MIN_RADIUS;
    if (!inLoop) minRadius = Math.min(minRadius, r);
    if (r < limit) {
      issues.push({ code: 'radius', message: `radius ${r.toFixed(0)} m < ${limit} m at ${d.toFixed(0)} m` });
      i += Math.ceil(30 / ds); // one report per tight spot
    }
  }

  // ---- elevation ----
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of track.samples) {
    lo = Math.min(lo, s.position.y);
    hi = Math.max(hi, s.position.y);
  }
  if (lo < elevation[0] || hi > elevation[1]) {
    issues.push({ code: 'elevation', message: `elevation ${lo.toFixed(1)}..${hi.toFixed(1)} m outside ${elevation[0]}..${elevation[1]} m` });
  }

  // ---- clearance between non-neighbouring sections ----
  let minClearance = Infinity;
  const stride = 2;
  const neighbour = Math.ceil(VALIDATION.NEIGHBOUR_ARC / ds);
  for (let i = 0; i < n; i += stride) {
    const p = track.samples[i].position;
    for (let j = i + neighbour; j < n; j += stride) {
      if (n - (j - i) < neighbour) continue;
      const q = track.samples[j].position;
      const plan = Math.hypot(p.x - q.x, p.z - q.z);
      const dist = p.distanceTo(q);
      if (plan < VALIDATION.OVERLAP_PLAN) {
        const vertical = Math.abs(p.y - q.y);
        minClearance = Math.min(minClearance, vertical);
        if (vertical < VALIDATION.MIN_CLEARANCE) {
          issues.push({ code: 'clearance', message: `sections at ${(i * ds).toFixed(0)} m and ${(j * ds).toFixed(0)} m overlap (${vertical.toFixed(1)} m apart vertically)` });
          return { id: track.id, length: L, minRadius, minClearance, elevation: [lo, hi], lapEstimate: L / VALIDATION.PILOT_PACE, issues };
        }
      } else {
        minClearance = Math.min(minClearance, dist);
      }
    }
  }

  // ---- start straight ----
  const straightAt = (d: number): boolean => Math.abs(track.sampleAt((((d % L) + L) % L) / L).curvature) < VALIDATION.STRAIGHT_K;
  for (let d = -VALIDATION.START_BEHIND; d <= VALIDATION.START_AHEAD; d += 5) {
    if (!straightAt(d)) {
      issues.push({ code: 'start', message: `the start straight bends at ${d} m from the line` });
      break;
    }
  }

  // ---- features ----
  const spans = track.features.map((f) => ({ f, span: featureSpan(f) })).filter((x): x is { f: TrackFeature; span: [number, number] } => x.span !== null);
  const startZone: [number, number] = [-VALIDATION.START_BEHIND, VALIDATION.START_AHEAD];
  for (let a = 0; a < spans.length; a++) {
    const A = spans[a];
    if (circularOverlap(A.span, startZone, L)) {
      issues.push({ code: 'feature-overlap', message: `${A.f.type} at ${A.span[0].toFixed(0)} m overlaps the start / pit area` });
    }
    for (let b = a + 1; b < spans.length; b++) {
      if (circularOverlap(A.span, spans[b].span, L)) {
        issues.push({ code: 'feature-overlap', message: `${A.f.type} at ${A.span[0].toFixed(0)} m overlaps ${spans[b].f.type} at ${spans[b].span[0].toFixed(0)} m` });
      }
    }
    if (A.f.type === 'corkscrew' || A.f.type === 'jump') {
      const end = A.f.type === 'jump' ? Math.max(A.span[1], A.f.dLanding + VALIDATION.JUMP_RUNOUT) : A.span[1];
      for (let d = A.span[0]; d <= end; d += 5) {
        if (!straightAt(d)) {
          issues.push({ code: 'feature-straight', message: `${A.f.type} at ${A.span[0].toFixed(0)} m is not on a straight (bends at ${d.toFixed(0)} m)` });
          break;
        }
      }
    }
  }
  for (const f of track.features) {
    if (f.type !== 'pipe') continue;
    if (f.transition < VALIDATION.PIPE_MIN_TRANSITION) issues.push({ code: 'pipe', message: `pipe at ${f.dStart.toFixed(0)} m closes over ${f.transition} m < ${VALIDATION.PIPE_MIN_TRANSITION} m` });
    if (f.dEnd - f.dStart - 2 * f.transition < VALIDATION.PIPE_MIN_CLOSED) issues.push({ code: 'pipe', message: `pipe at ${f.dStart.toFixed(0)} m is closed for less than ${VALIDATION.PIPE_MIN_CLOSED} m` });
    for (let d = f.dStart; d <= f.dEnd; d += 5) {
      const k = Math.abs(track.sampleAt((((d % L) + L) % L) / L).curvature);
      if (k > 1 / VALIDATION.PIPE_MIN_RADIUS) {
        issues.push({ code: 'pipe', message: `pipe at ${f.dStart.toFixed(0)} m bends tighter than ${VALIDATION.PIPE_MIN_RADIUS} m at ${d.toFixed(0)} m` });
        break;
      }
    }
  }
  for (const f of track.features) {
    if (f.type !== 'dash') continue;
    for (const s of spans) {
      if (circularOverlap([f.dStart, f.dEnd], s.span, L)) issues.push({ code: 'feature-overlap', message: `dash plate at ${f.dStart.toFixed(0)} m sits on the ${s.f.type}` });
    }
  }

  // ---- split paths ----
  for (const b of track.branches) {
    const dFork = b.uFork * L;
    const dMerge = b.uMerge * L;
    // The roads share a deck until they separate, so the main road must be straight (and unbanked) there.
    for (const [from, to, end] of [[dFork, dFork + b.overlapFork, 'fork'], [dMerge - b.overlapMerge, dMerge, 'merge']] as const) {
      for (let d = from; d <= to; d += 5) {
        if (!straightAt(d)) {
          issues.push({ code: 'branch', message: `${b.id}: the main road bends at ${d.toFixed(0)} m, inside the ${end} overlap` });
          break;
        }
      }
    }
    const m = b.samples.length;
    const bds = b.length / (m - 1);
    const sep = branchSeparation(b.halfWidth) - VALIDATION.BRANCH_SEPARATION_SLACK;
    for (let i = 0; i < m; i++) {
      const s = b.samples[i];
      const k = b.samples[Math.min(m - 1, i + 1)].forward.distanceTo(b.samples[Math.max(0, i - 1)].forward) / (2 * bds);
      if (1 / Math.max(k, 1e-9) < VALIDATION.MIN_RADIUS) {
        issues.push({ code: 'branch', message: `${b.id}: radius ${(1 / k).toFixed(0)} m < ${VALIDATION.MIN_RADIUS} m at ${(i * bds).toFixed(0)} m` });
        break;
      }
      lo = Math.min(lo, s.position.y);
      hi = Math.max(hi, s.position.y);
    }
    // Once separated, the branch must stay a rail's width clear of every main section, or pass well over/under it.
    let clash = false;
    for (let i = 0; i < m && !clash; i += 2) {
      const sb = i * bds;
      if (sb < b.overlapFork || sb > b.length - b.overlapMerge) continue;
      const p = b.samples[i].position;
      for (let j = 0; j < n; j += stride) {
        const q = track.samples[j].position;
        if (Math.hypot(p.x - q.x, p.z - q.z) < sep && Math.abs(p.y - q.y) < VALIDATION.MIN_CLEARANCE) {
          issues.push({ code: 'branch', message: `${b.id} at ${sb.toFixed(0)} m runs into the main road at ${(j * ds).toFixed(0)} m` });
          clash = true;
          break;
        }
      }
    }
  }
  if (track.branches.length && (lo < elevation[0] || hi > elevation[1])) {
    if (!issues.some((i) => i.code === 'elevation')) issues.push({ code: 'elevation', message: `a branch leaves the elevation band ${elevation[0]}..${elevation[1]} m` });
  }

  // ---- lap length ----
  const lapEstimate = L / VALIDATION.PILOT_PACE;
  if (lapEstimate < VALIDATION.LAP_TIME[0] || lapEstimate > VALIDATION.LAP_TIME[1]) {
    issues.push({ code: 'length', message: `lap ${L.toFixed(0)} m ≈ ${lapEstimate.toFixed(1)} s at Pilot pace, outside ${VALIDATION.LAP_TIME.join('–')} s` });
  }

  return { id: track.id, length: L, minRadius, minClearance, elevation: [lo, hi], lapEstimate, issues };
}
