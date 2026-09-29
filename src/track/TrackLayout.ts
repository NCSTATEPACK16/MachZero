/**
 * Plan-view + elevation layout of the circuit.
 *
 * The control loop is star-shaped: control-point polar angles around a centre are strictly
 * monotonic, so the curve cannot self-intersect in plan view. Two chords of the star are
 * forced to be dead straight (rows of collinear control points):
 *   - chord A: the main straight (start line + pit strip),
 *   - chord B: the straight that hosts the corkscrew.
 * Each chord end is followed by a "turn-in" point placed relative to the chord (ahead along it and
 * offset toward the centre) so the straights blend into corners; 4-6 mid points on the two arcs sit at
 * alternating radii around the star radius (S-bends and sweepers) with per-point elevation.
 * A centripetal closed Catmull-Rom curve is built through the points; the star radius is solved so the
 * lap hits the target length. Sharp spots are opened up by local Laplacian relaxation of the movable
 * control points, then the layout is validated (min radius, elevation band, monotone angle, straights,
 * self-proximity). Rejected candidates are retried with deterministic seeds derived from the input
 * seed and progressively gentler parameters.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import { TAU, clamp } from '../core/math';
import { Rng } from '../core/rng';
import { computeDifferentials, resampleCurve, type Differentials, type ResampledCurve } from './TrackFrames';

/** Control points on the main straight (chord A) and their spacing in metres. */
const CHORD_A_POINTS = 5;
const CHORD_A_SPACING = 190;
/** Control points on the corkscrew straight (chord B) and their spacing in metres. */
const CHORD_B_POINTS = 5;
const CHORD_B_SPACING = 170;
/** Start line sits on control point 2 of chord A (190 m of dead-straight behind, ~250 m ahead). */
const START_POINT = 2;

const MAX_ATTEMPTS = 48;
const MIN_ELEVATION_MARGIN = 0.75;
const CORKSCREW_LENGTH = 260;

export interface StraightInfo {
  /** Distance (m) of the first and last sample of the straight run containing the reference point. */
  startDistance: number;
  endDistance: number;
  length: number;
}

export interface LayoutStats {
  attempts: number;
  controlPoints: number;
  minRadius: number;
  minElevation: number;
  maxElevation: number;
  mainStraight: StraightInfo;
  corkscrewStraight: StraightInfo;
}

export interface TrackLayout {
  points: THREE.Vector3[];
  curve: THREE.CatmullRomCurve3;
  resampled: ResampledCurve;
  differentials: Differentials;
  corkscrew: { uStart: number; uEnd: number };
  stats: LayoutStats;
}

interface LayoutParams {
  dir: 1 | -1;
  target: number;
  /** Radial wiggle amplitude as a fraction of the star radius (fades on retries). */
  amp: number;
  dAf: number;
  dBf: number;
  alphaB: number;
  /** Mid (polar) control points on the arc after chord A / after chord B. */
  n1: number;
  n2: number;
  w1: number[];
  w2: number[];
  /** Unit radial pattern of the mid points (alternating signs => S-bends); scaled by the solved amplitude. */
  pattern: number[];
  yJitter: number[];
  /** Corner turn-in points: after A, before B, after B, before A (metres ahead, metres inward). */
  corners: { a: number; b: number }[];
  phi: [number, number, number];
  elevAmp: number;
  yMid: number;
  requiredRadius: number;
}

interface Assembled {
  points: THREE.Vector3[];
  center: { x: number; z: number };
  chordBFirst: number;
  /** Control point indices that must not move (the two dead-straight chords). */
  fixed: Set<number>;
}

/** Deterministic per-attempt seed derived from the input seed. */
export function deriveSeed(seed: number, attempt: number): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (attempt + 1), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function drawParams(seed: number, attempt: number): LayoutParams {
  const rng = new Rng(deriveSeed(seed, attempt));
  const soften = 1 + 0.03 * attempt;
  const elevScale = attempt < 30 ? 1 : 0.6;
  const totalMid = rng.int(4, 6);
  const n1 = rng.int(2, totalMid - 2);
  const n2 = totalMid - n1;
  const w1: number[] = [];
  const w2: number[] = [];
  for (let i = 0; i <= n1; i++) w1.push(rng.range(0.75, 1.25));
  for (let i = 0; i <= n2; i++) w2.push(rng.range(0.75, 1.25));
  // Alternating signs around the star radius give S-bends; magnitudes vary so features differ in strength.
  const pattern: number[] = [];
  for (const n of [n1, n2]) {
    const flip = rng.next() < 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) pattern.push(flip * (i % 2 === 0 ? 1 : -1) * rng.range(0.55, 1));
  }
  const yJitter: number[] = [];
  for (let i = 0; i < totalMid; i++) yJitter.push(rng.range(-1, 1));
  const corners: { a: number; b: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const a = rng.range(150, 240) * soften;
    corners.push({ a, b: a * Math.tan(rng.range(0.3, 0.6)) });
  }
  return {
    dir: rng.next() < 0.5 ? 1 : -1,
    target: CONFIG.TRACK_TARGET_LENGTH * rng.range(0.95, 1.05),
    amp: clamp(0.26 * Math.pow(0.9, attempt), 0.03, 0.26),
    dAf: rng.range(0.78, 0.92),
    dBf: rng.range(0.74, 0.9),
    alphaB: Math.PI + rng.range(-0.3, 0.3),
    n1,
    n2,
    w1,
    w2,
    pattern,
    yJitter,
    corners,
    phi: [rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)],
    elevAmp: 22 * elevScale,
    yMid: (CONFIG.TRACK_MIN_ELEVATION + CONFIG.TRACK_MAX_ELEVATION) / 2,
    requiredRadius: attempt < 12 ? 90 : attempt < 24 ? 75 : CONFIG.TRACK_MIN_RADIUS * 1.06,
  };
}

/** Polar angle of a plan-view point around the origin, oriented so travel means increasing angle. */
function polarAngle(x: number, z: number, near: number): number {
  let a = -Math.atan2(z, x);
  while (a - near > Math.PI) a -= TAU;
  while (a - near < -Math.PI) a += TAU;
  return a;
}

/** Build the control points for a given star radius. Returns null if the angular layout is degenerate. */
function assemble(p: LayoutParams, radius: number): Assembled | null {
  const dA = p.dAf * radius;
  const dB = p.dBf * radius;
  const yBase = (alpha: number): number =>
    p.yMid +
    p.elevAmp * (0.55 * Math.sin(alpha + p.phi[0]) + 0.3 * Math.sin(2 * alpha + p.phi[1]) + 0.2 * Math.sin(3 * alpha + p.phi[2]));
  const yMin = CONFIG.TRACK_MIN_ELEVATION + 4;
  const yMax = CONFIG.TRACK_MAX_ELEVATION - 4;
  const yA = clamp(yBase(0), yMin, yMax);
  const yB = clamp(yBase(p.alphaB), yMin, yMax);

  const arr: THREE.Vector3[] = [];
  // ---- Chord A: x = dA, travelling toward -Z, start line at z = 0. Inward (toward the centre) = -X. ----
  for (let k = 0; k < CHORD_A_POINTS; k++) {
    arr.push(new THREE.Vector3(dA, yA, -(k - START_POINT) * CHORD_A_SPACING));
  }
  const aFirstZ = START_POINT * CHORD_A_SPACING;
  const aLastZ = -(CHORD_A_POINTS - 1 - START_POINT) * CHORD_A_SPACING;
  // ---- Chord B: line at distance dB from the centre, normal at angle alphaB, travel = increasing angle. ----
  const nx = Math.cos(p.alphaB);
  const nz = -Math.sin(p.alphaB);
  const tx = -Math.sin(p.alphaB);
  const tz = -Math.cos(p.alphaB);
  const halfB = ((CHORD_B_POINTS - 1) / 2) * CHORD_B_SPACING;
  const chordB = (t: number, ahead: number, inward: number, y: number): THREE.Vector3 =>
    new THREE.Vector3(dB * nx + (t + ahead) * tx - inward * nx, y, dB * nz + (t + ahead) * tz - inward * nz);
  const blendY = (chordY: number, x: number, z: number): number =>
    clamp(chordY + (yBase(polarAngle(x, z, 0)) - chordY) * 0.5, yMin, yMax);

  const turnIn = (x: number, z: number, chordY: number): THREE.Vector3 => new THREE.Vector3(x, blendY(chordY, x, z), z);
  const e1 = turnIn(dA - p.corners[0].b, aLastZ - p.corners[0].a, yA);
  const bStart = chordB(-halfB, -p.corners[1].a, p.corners[1].b, yB);
  const x2 = turnIn(bStart.x, bStart.z, yB);
  const bEnd = chordB(halfB, p.corners[2].a, p.corners[2].b, yB);
  const e3 = turnIn(bEnd.x, bEnd.z, yB);
  const x4 = turnIn(dA - p.corners[3].b, aFirstZ + p.corners[3].a, yA);

  const midPoint = (alpha: number, idx: number): THREE.Vector3 => {
    const r = radius * (1 + p.amp * p.pattern[idx]);
    const y = clamp(yBase(alpha) + p.elevAmp * 0.35 * p.yJitter[idx], yMin, yMax);
    return new THREE.Vector3(r * Math.cos(alpha), y, -r * Math.sin(alpha));
  };
  /** Push `from`, `count` polar mid points, then `to`. Returns false when the angular room is too small. */
  const addArc = (from: THREE.Vector3, to: THREE.Vector3, weights: number[], count: number, fOffset: number): boolean => {
    arr.push(from);
    const aFrom = polarAngle(from.x, from.z, 0);
    const span = polarAngle(to.x, to.z, aFrom + 1.2) - aFrom;
    if (span < 0.12 * (count + 1)) return false;
    const sum = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let i = 0; i < count; i++) {
      acc += weights[i];
      arr.push(midPoint(aFrom + (span * acc) / sum, fOffset + i));
    }
    arr.push(to);
    return true;
  };

  if (!addArc(e1, x2, p.w1, p.n1, 0)) return null;
  const chordBFirst = arr.length;
  for (let k = 0; k < CHORD_B_POINTS; k++) arr.push(chordB((k - (CHORD_B_POINTS - 1) / 2) * CHORD_B_SPACING, 0, 0, yB));
  if (!addArc(e3, x4, p.w2, p.n2, p.n1)) return null;

  // Star-shape check on the control loop: polar angle strictly increases around one full turn.
  {
    const first = polarAngle(arr[0].x, arr[0].z, 0);
    let prev = first;
    for (let i = 1; i < arr.length; i++) {
      const a = polarAngle(arr[i].x, arr[i].z, prev + 0.1);
      if (a - prev < 0.02) return null;
      prev = a;
    }
    if (first + TAU - prev < 0.02) return null;
  }

  // Mirror (handedness), translate so the start line is the plan-view origin, rotate array so index 0 = start line.
  const points = arr.map((v) => new THREE.Vector3(p.dir * (v.x - dA), v.y, v.z));
  const rotated = points.slice(START_POINT).concat(points.slice(0, START_POINT));
  const total = arr.length;
  const rot = (idx: number): number => (idx - START_POINT + total) % total;
  const fixed = new Set<number>();
  for (let k = 0; k < CHORD_A_POINTS; k++) fixed.add(rot(k));
  for (let k = 0; k < CHORD_B_POINTS; k++) fixed.add(rot(chordBFirst + k));
  return {
    points: rotated,
    center: { x: -p.dir * dA, z: 0 },
    chordBFirst: rot(chordBFirst),
    fixed,
  };
}

function makeCurve(points: THREE.Vector3[]): THREE.CatmullRomCurve3 {
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  curve.arcLengthDivisions = 8192;
  return curve;
}

function coarseLength(curve: THREE.CatmullRomCurve3, samples: number): number {
  const tmp = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const first = new THREE.Vector3();
  curve.getPoint(0, first);
  prev.copy(first);
  let len = 0;
  for (let i = 1; i <= samples; i++) {
    curve.getPoint(i === samples ? 0 : i / samples, tmp);
    len += tmp.distanceTo(prev);
    prev.copy(tmp);
  }
  return len;
}

/** Bisect the star radius so the lap length matches the target. */
function solveRadius(p: LayoutParams): number {
  let lo = 250;
  let hi = 2600;
  let best = 0.5 * (lo + hi);
  for (let it = 0; it < 26; it++) {
    const mid = 0.5 * (lo + hi);
    const asm = assemble(p, mid);
    const len = asm ? coarseLength(makeCurve(asm.points), 2400) : 0;
    best = mid;
    if (Math.abs(len - p.target) < p.target * 0.0015) break;
    if (len < p.target) lo = mid;
    else hi = mid;
  }
  return best;
}

/** Longest run of samples around `index` with curvature below `threshold`. */
function straightRun(kappa: Float64Array, index: number, ds: number, threshold: number): StraightInfo {
  const n = kappa.length;
  let back = 0;
  while (back < n / 2 && kappa[(((index - back - 1) % n) + n) % n] < threshold) back++;
  let fwd = 0;
  while (fwd < n / 2 && kappa[(index + fwd + 1) % n] < threshold) fwd++;
  const startIndex = index - back;
  return {
    startDistance: startIndex * ds,
    endDistance: (index + fwd) * ds,
    length: (back + fwd + 1) * ds,
  };
}

/** Do two far-apart stretches of the loop come uncomfortably close (rails/decks would overlap)? */
function hasProximityConflict(pos: Float64Array, count: number, ds: number): boolean {
  const minArcGap = Math.ceil(170 / ds);
  const minDist2 = 62 * 62;
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const px = pos[i3];
    const py = pos[i3 + 1];
    const pz = pos[i3 + 2];
    for (let j = i + minArcGap; j < count; j++) {
      const gap = Math.min(j - i, count - (j - i));
      if (gap < minArcGap) continue;
      const j3 = j * 3;
      const dx = pos[j3] - px;
      const dy = pos[j3 + 1] - py;
      const dz = pos[j3 + 2] - pz;
      if (dx * dx + dy * dy + dz * dz < minDist2) return true;
    }
  }
  return false;
}

/** Is the polar angle around `center` strictly monotonic along the lap (star-shaped => no self-intersection)? */
function isStarShaped(pos: Float64Array, count: number, center: { x: number; z: number }): boolean {
  let sign = 0;
  let sum = 0;
  const deltas = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const a0 = Math.atan2(pos[i * 3 + 2] - center.z, pos[i * 3] - center.x);
    const a1 = Math.atan2(pos[j * 3 + 2] - center.z, pos[j * 3] - center.x);
    let d = a1 - a0;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    deltas[i] = d;
    sum += d;
  }
  sign = Math.sign(sum);
  if (sign === 0 || Math.abs(Math.abs(sum) - TAU) > 0.05) return false;
  for (let i = 0; i < count; i++) if (deltas[i] * sign <= 0) return false;
  return true;
}

/** Circular distance between two arc positions on a loop of `length` metres. */
function arcGap(a: number, b: number, length: number): number {
  const d = Math.abs(a - b) % length;
  return Math.min(d, length - d);
}

/**
 * Local repair: while the tightest bend is below `required`, pull the nearest movable control point
 * toward the midpoint of its neighbours (Laplacian relaxation). The straights never move, so the
 * layout keeps its character but sharp spots are opened up. Returns false if it fails to converge.
 */
function relaxSharpSpots(points: THREE.Vector3[], fixed: Set<number>, required: number): boolean {
  const M = points.length;
  const mid = new THREE.Vector3();
  // A coarser resample is plenty to locate and fix sharp spots; the final layout is re-measured at full resolution.
  const count = 1024;
  for (let iter = 0; iter < 80; iter++) {
    const rs = resampleCurve(makeCurve(points), count, 2048);
    const diff = computeDifferentials(rs.pos, count, rs.ds);
    let worst = 0;
    for (let i = 1; i < count; i++) if (diff.kappa[i] > diff.kappa[worst]) worst = i;
    if (1 / Math.max(diff.kappa[worst], 1e-9) >= required) return true;
    const at = worst * rs.ds;
    let target = -1;
    let bestGap = Infinity;
    for (let k = 0; k < M; k++) {
      if (fixed.has(k)) continue;
      const gap = arcGap(rs.arcAtParam(k / M), at, rs.length);
      if (gap < bestGap) {
        bestGap = gap;
        target = k;
      }
    }
    if (target < 0) return false;
    mid.copy(points[(target - 1 + M) % M]).add(points[(target + 1) % M]).multiplyScalar(0.5);
    points[target].lerp(mid, 0.45);
  }
  return false;
}

/**
 * Build a validated layout for `seed`. Failed candidates are repaired locally, then relaxed
 * (weaker wiggles, softer corners, gentler radius requirement) using deterministic seeds derived
 * from the input seed.
 */
export function createLayout(seed: number): TrackLayout {
  const count = CONFIG.TRACK_SAMPLES;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const p = drawParams(seed, attempt);
    const asm = assemble(p, solveRadius(p));
    if (!asm) continue;
    if (!relaxSharpSpots(asm.points, asm.fixed, p.requiredRadius * 1.04)) continue;
    const curve = makeCurve(asm.points);
    const resampled = resampleCurve(curve, count);
    const { length, ds, pos } = resampled;
    if (Math.abs(length - CONFIG.TRACK_TARGET_LENGTH) > CONFIG.TRACK_TARGET_LENGTH * 0.13) continue;

    const differentials = computeDifferentials(pos, count, ds);
    let maxKappa = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      if (differentials.kappa[i] > maxKappa) maxKappa = differentials.kappa[i];
      const y = pos[i * 3 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const minRadius = 1 / Math.max(maxKappa, 1e-9);
    if (minRadius < p.requiredRadius * 0.98) continue;
    if (minY < CONFIG.TRACK_MIN_ELEVATION + MIN_ELEVATION_MARGIN || maxY > CONFIG.TRACK_MAX_ELEVATION - MIN_ELEVATION_MARGIN) continue;
    if (!isStarShaped(pos, count, asm.center)) continue;

    const M = asm.points.length;
    // Corkscrew: centred in the dead-straight part of chord B (control points 1 .. m-2).
    const arcB1 = resampled.arcAtParam((asm.chordBFirst + 1) / M);
    const arcB2 = resampled.arcAtParam((asm.chordBFirst + CHORD_B_POINTS - 2) / M);
    const mid = 0.5 * (arcB1 + arcB2);
    const corkLen = Math.min(CORKSCREW_LENGTH, arcB2 - arcB1 - 40);
    const corkscrew = { uStart: (mid - corkLen / 2) / length, uEnd: (mid + corkLen / 2) / length };
    if (!(corkscrew.uStart > 0.02 && corkscrew.uEnd < 0.98 && corkscrew.uEnd > corkscrew.uStart)) continue;

    const straightThreshold = 1 / 1200;
    const mainStraight = straightRun(differentials.kappa, 0, ds, straightThreshold);
    const corkIndex = Math.round((mid / length) * count) % count;
    const corkscrewStraight = straightRun(differentials.kappa, corkIndex, ds, straightThreshold);
    // Start line needs >= 100 m of straight behind it and the pit ~250 m ahead.
    if (mainStraight.length < 360 || corkscrewStraight.length < 300) continue;
    if (hasProximityConflict(pos, count, ds)) continue;

    return {
      points: asm.points,
      curve,
      resampled,
      differentials,
      corkscrew,
      stats: {
        attempts: attempt + 1,
        controlPoints: M,
        minRadius,
        minElevation: minY,
        maxElevation: maxY,
        mainStraight,
        corkscrewStraight,
      },
    };
  }
  throw new Error(`generateTrack: no valid circuit layout found for seed ${seed}`);
}
