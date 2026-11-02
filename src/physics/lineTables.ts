/**
 * Shared by the track-magnetism tables (PipeCompensation, LoopCompensation): per-track tables of the geodesic
 * curvature of constant-lateral lines, sampled at the track's sample spacing × 1 m of lateral, looked up bilinearly.
 */
import type * as THREE from 'three';
import { clamp, wrap01 } from '../core/math';

export interface LineTable {
  /** First sample index of the table (track sample spacing). */
  i0: number;
  rows: number;
  /** Laterals −W..W in 1 m steps. */
  cols: number;
  /** rows × cols, 1/m, positive = the line curves left. */
  k: Float32Array;
}

/** Bilinear lookup in the first table covering u; 0 outside every table. */
export function lookupLineTables(tables: readonly LineTable[], n: number, halfWidth: number, u: number, lateral: number): number {
  const uw = wrap01(u);
  for (const tab of tables) {
    const f = uw * n - tab.i0;
    const ff = ((f % n) + n) % n;
    if (ff > tab.rows - 1) continue;
    const r0 = Math.floor(ff);
    const r1 = Math.min(r0 + 1, tab.rows - 1);
    const tr = ff - r0;
    const c = clamp(lateral + halfWidth, 0, tab.cols - 1);
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

/** Geodesic curvature at pts[1] of the polyline pts (surface normal nrm); positive = curving left. */
export function geodesic(pts: THREE.Vector3[], nrm: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3): number {
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
