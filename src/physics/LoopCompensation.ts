/**
 * Track magnetism for loop-the-loops (the loop's version of the corkscrew twist compensation and PipeCompensation).
 *
 * A loop's deck is square to the loop's axis (track/features/loop.ts), so it twists relative to the rotation-minimising
 * frame and slides sideways by the loop's side offset. A line of constant lateral offset across it is therefore not a
 * geodesic: a hull left to itself keeps its place along the axis and runs into the rail as the deck shifts under it.
 * The surface carries the ship along its line instead: heading and momentum yaw at the line's geodesic curvature, so
 * a ship holds whatever line it entered on, and the player steers only to change it.
 *
 * The curvature is that of the line the hull actually flies: HOVER_HEIGHT above the real deck (the ruled surface swept
 * by the frames) along its true normal, which tilts away from the frame's up off the centreline where the deck
 * twists. Measuring it on the deck itself left ships ~2 m off line by the exit: hovering h above a deck that curves up
 * towards the hull (normal curvature κn, up to 1/10 m over the top) and twists (rate τ) the hull covers 1/(1 − h·κn)
 * metres of deck line per metre and must also yaw by h·dτ/ds, which over the loop's ~100° of twist adds up. It is
 * tabulated per track over each loop (track samples × 1 m of lateral) and interpolated bilinearly.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { TrackData } from '../core/contracts';
import { wrap01 } from '../core/math';
import { geodesic, lookupLineTables, type LineTable } from './lineTables';

interface LoopTables {
  tables: LineTable[];
  n: number;
  halfWidth: number;
}

const cache = new WeakMap<TrackData, LoopTables>();

/** Geodesic curvature (1/m, positive = curves left) of the constant-lateral line through (u, lateral) in a loop. */
export function loopLineCurvature(track: TrackData, u: number, lateral: number): number {
  if (track.loops.length === 0) return 0;
  const t = tablesFor(track);
  return lookupLineTables(t.tables, t.n, t.halfWidth, u, lateral);
}

function tablesFor(track: TrackData): LoopTables {
  let t = cache.get(track);
  if (t) return t;
  const smp = track.samples;
  const n = smp.length;
  const W = track.halfWidth;
  const cols = Math.round(2 * W) + 1;
  const tables: LineTable[] = [];
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const q = [0, 1, 2, 3, 4].map(() => new THREE.Vector3());
  const nrm = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (const loop of track.loops) {
    // Two samples of margin either side: the lines are straight there, so the rows read 0.
    const i0 = Math.floor(loop.uStart * n) - 2;
    const rows = Math.ceil(wrap01(loop.uEnd - loop.uStart) * n) + 5;
    const k = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      const i = (((i0 + r) % n) + n) % n;
      for (let c = 0; c < cols; c++) {
        const lat = c - W;
        // Deck points of the line at rows i−2..i+2, then the hover points above i−1..i+1 along the true normals.
        for (let j = 0; j < 5; j++) {
          const sj = smp[(i + j - 2 + n) % n];
          q[j].copy(sj.position).addScaledVector(sj.right, lat);
        }
        for (let j = 0; j < 3; j++) {
          deckNormal(smp[(i + j - 1 + n) % n].right, q[j], q[j + 2], nrm);
          p[j].copy(q[j + 1]).addScaledVector(nrm, CONFIG.HOVER_HEIGHT);
        }
        deckNormal(smp[i].right, q[1], q[3], nrm);
        k[r * cols + c] = geodesic(p, nrm, a, b, side);
      }
    }
    tables.push({ i0: ((i0 % n) + n) % n, rows, cols, k });
  }
  t = { tables, n, halfWidth: W };
  cache.set(track, t);
  return t;
}

const alongScratch = new THREE.Vector3();

/** True deck normal where the line runs from `before` to `after` across a deck whose cross-section runs along `right`. */
function deckNormal(right: THREE.Vector3, before: THREE.Vector3, after: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.crossVectors(right, alongScratch.subVectors(after, before)).normalize();
}
