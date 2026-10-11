/**
 * Track magnetism for pipes (the pipe's version of ShipController's corkscrew twist compensation).
 *
 * Where the deck curls into a tube, a line of constant lateral offset L is not straight on the surface: as the
 * cross-section bends, the line's geodesic curvature changes, and without help the hull is flung outward into
 * the rails (or across the seam at the top of the tube). The surface carries the ship along its line instead.
 *
 * Only the part caused by the curl *changing* is compensated: the geodesic curvature of the constant-L line on the
 * curling deck minus that of the same line with the curl frozen at its local value. Inside the closed tube that is
 * zero, so bends stay the player's to steer (from the ceiling a right-hander looks like a left-hander, as it should),
 * and frame roll stays with the twist compensation.
 *
 * Values are tabulated per track (track samples × 1 m of lateral) and interpolated bilinearly.
 */
import * as THREE from 'three';
import type { TrackData } from '../core/contracts';
import { clamp, inLoopRange, wrap01 } from '../core/math';
import { curlPoint, type CurledPoint } from '../track/features/pipe';

interface Table {
  /** First sample index of the table (track sample spacing). */
  i0: number;
  rows: number;
  /** Laterals −W..W in 1 m steps. */
  cols: number;
  /** rows × cols, 1/m, positive = the line curves left. */
  k: Float32Array;
}

interface PipeTables {
  tables: Table[];
  n: number;
  halfWidth: number;
}

const cache = new WeakMap<TrackData, PipeTables>();

/** Extra geodesic curvature (1/m, positive = curves left) of the constant-lateral line through (u, lateral). */
export function pipeLineCurvature(track: TrackData, u: number, lateral: number): number {
  if (track.pipes.length === 0) return 0;
  const t = tablesFor(track);
  const uw = wrap01(u);
  for (const tab of t.tables) {
    const f = uw * t.n - tab.i0;
    const ff = ((f % t.n) + t.n) % t.n;
    if (ff > tab.rows - 1) continue;
    const r0 = Math.floor(ff);
    const r1 = Math.min(r0 + 1, tab.rows - 1);
    const tr = ff - r0;
    const c = clamp(lateral + t.halfWidth, 0, tab.cols - 1);
    const c0 = Math.floor(c);
    const c1 = Math.min(c0 + 1, tab.cols - 1);
    const tc = c - c0;
    const k = tab.k;
    const a = k[r0 * tab.cols + c0] * (1 - tc) + k[r0 * tab.cols + c1] * tc;
    const b = k[r1 * tab.cols + c0] * (1 - tc) + k[r1 * tab.cols + c1] * tc;
    return a * (1 - tr) + b * tr;
  }
  return 0;
}

function tablesFor(track: TrackData): PipeTables {
  let t = cache.get(track);
  if (t) return t;
  const n = track.samples.length;
  const W = track.halfWidth;
  const cols = Math.round(2 * W) + 1;
  const tables: Table[] = [];
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const q = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const nCurl = new THREE.Vector3();
  const nFrozen = new THREE.Vector3();
  const bent: CurledPoint = { x: 0, y: 0, phi: 0 };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (const pipe of track.pipes) {
    const i0 = Math.floor(pipe.uStart * n) - 2;
    const rows = Math.ceil(wrap01(pipe.uEnd - pipe.uStart) * n) + 5;
    const k = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      const ui = (i0 + r) / n;
      for (let c = 0; c < cols; c++) {
        const lat = c - W;
        if (!inLoopRange(wrap01(ui), wrap01(pipe.uStart - 2 / n), wrap01(pipe.uEnd + 2 / n))) continue;
        track.surfacePoint(ui, lat, p[1], nCurl);
        // Curl at this row, recovered from the surface point's height above the floor (no curl getter on TrackData).
        const mid = track.sampleAt(wrap01(ui));
        const curl = curlFromPoint(p[1], mid, lat, W);
        for (let j = 0; j < 3; j++) {
          const uj = wrap01(ui + (j - 1) / n);
          if (j !== 1) track.surfacePoint(uj, lat, p[j]);
          const s = j === 1 ? mid : track.sampleAt(uj);
          const q2 = curlPoint(lat, 0, curl, bent);
          q[j].copy(s.position).addScaledVector(s.right, q2.x).addScaledVector(s.up, q2.y);
          if (j === 1) nFrozen.copy(s.up).multiplyScalar(Math.cos(q2.phi)).addScaledVector(s.right, -Math.sin(q2.phi));
        }
        k[r * cols + c] = geodesic(p, nCurl, a, b, side) - geodesic(q, nFrozen, a, b, side);
      }
    }
    tables.push({ i0: ((i0 % n) + n) % n, rows, cols, k });
  }
  t = { tables, n, halfWidth: W };
  cache.set(track, t);
  return t;
}

/** The curl that puts lateral `lat` at point `pt` (inverse of curlPoint along the cross-section angle). */
function curlFromPoint(pt: THREE.Vector3, s: { position: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 }, lat: number, W: number): number {
  if (Math.abs(lat) < 1e-6) return 0;
  const dx = pt.clone().sub(s.position);
  const x = dx.dot(s.right);
  const y = dx.dot(s.up);
  // The deck point at lateral lat is (sin φ, 1 − cos φ)/κ with φ = κ·lat, so tan(φ/2) = y / x.
  const phi = 2 * Math.atan2(y, x * Math.sign(lat)) * Math.sign(lat);
  return clamp((phi / lat) * (W / Math.PI), 0, 1);
}

/** Geodesic curvature at pts[1] of the polyline pts (surface normal nrm); positive = curving left. */
function geodesic(pts: THREE.Vector3[], nrm: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3): number {
  a.subVectors(pts[1], pts[0]);
  b.subVectors(pts[2], pts[1]);
  const la = a.length();
  const lb = b.length();
  if (la < 1e-9 || lb < 1e-9) return 0;
  a.divideScalar(la);
  b.divideScalar(lb);
  // left = up × forward (right = forward × up)
  side.crossVectors(nrm, a).normalize();
  return b.sub(a).dot(side) / ((la + lb) / 2);
}
