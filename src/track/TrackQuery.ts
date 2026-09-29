/**
 * Fast interpolation / projection queries over the sampled track.
 *
 * `sampleAt` linearly interpolates the frames between samples and re-orthonormalises them.
 * `project` finds the nearest sample (windowed around a hint, or a full scan), then refines
 * u with a few Newton steps on the *interpolated* frames so the result is the exact inverse of
 * `sampleAt` (the point lies in the plane through c(u) normal to forward(u)).
 *
 * All per-call working state lives in scratch fields; only the returned objects are allocated.
 */
import * as THREE from 'three';
import type { TrackProjection, TrackSample } from '../core/contracts';
import { wrapAngle } from '../core/math';
import type { FrameSet } from './TrackFrames';

const HINT_WINDOW = 64;
const SUSPICIOUS_DISTANCE = 40;

export class TrackQuery {
  private readonly count: number;
  private readonly length: number;
  private readonly halfWidth: number;
  private readonly pos: Float64Array;
  private readonly tan: Float64Array;
  private readonly up: Float64Array;
  private readonly roll: Float64Array;
  private readonly curv: Float64Array;

  // Scratch: result of the most recent evaluate().
  private u = 0;
  private px = 0;
  private py = 0;
  private pz = 0;
  private fx = 0;
  private fy = 0;
  private fz = 0;
  private ux = 0;
  private uy = 0;
  private uz = 0;
  private rx = 0;
  private ry = 0;
  private rz = 0;
  private rollV = 0;
  private curvV = 0;
  private bestD2 = 0;

  constructor(frames: FrameSet, halfWidth: number) {
    this.count = frames.count;
    this.length = frames.length;
    this.halfWidth = halfWidth;
    this.pos = frames.pos;
    this.tan = frames.tan;
    this.up = frames.up;
    this.roll = frames.roll;
    this.curv = frames.curvature;
  }

  /** Interpolate the frame at loop parameter u (wraps) into the scratch fields. */
  private evaluate(uIn: number): void {
    const n = this.count;
    const uw = uIn - Math.floor(uIn);
    const f = uw * n;
    let i0 = Math.floor(f);
    if (i0 >= n) i0 = n - 1;
    const t = f - i0;
    const i1 = i0 + 1 === n ? 0 : i0 + 1;
    const a = i0 * 3;
    const b = i1 * 3;
    const s = 1 - t;
    const pos = this.pos;
    const tan = this.tan;
    const up = this.up;
    this.u = uw;
    this.px = pos[a] * s + pos[b] * t;
    this.py = pos[a + 1] * s + pos[b + 1] * t;
    this.pz = pos[a + 2] * s + pos[b + 2] * t;

    let fx = tan[a] * s + tan[b] * t;
    let fy = tan[a + 1] * s + tan[b + 1] * t;
    let fz = tan[a + 2] * s + tan[b + 2] * t;
    const fl = 1 / Math.sqrt(fx * fx + fy * fy + fz * fz);
    fx *= fl;
    fy *= fl;
    fz *= fl;

    let ux = up[a] * s + up[b] * t;
    let uy = up[a + 1] * s + up[b + 1] * t;
    let uz = up[a + 2] * s + up[b + 2] * t;
    // Gram-Schmidt against forward, then normalise.
    const d = fx * ux + fy * uy + fz * uz;
    ux -= d * fx;
    uy -= d * fy;
    uz -= d * fz;
    const ul = 1 / Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux *= ul;
    uy *= ul;
    uz *= ul;

    this.fx = fx;
    this.fy = fy;
    this.fz = fz;
    this.ux = ux;
    this.uy = uy;
    this.uz = uz;
    // right = forward × up
    this.rx = fy * uz - fz * uy;
    this.ry = fz * ux - fx * uz;
    this.rz = fx * uy - fy * ux;

    const r0 = this.roll[i0];
    this.rollV = r0 + wrapAngle(this.roll[i1] - r0) * t;
    this.curvV = this.curv[i0] * s + this.curv[i1] * t;
  }

  private makeSample(): TrackSample {
    return {
      u: this.u,
      distance: this.u * this.length,
      position: new THREE.Vector3(this.px, this.py, this.pz),
      forward: new THREE.Vector3(this.fx, this.fy, this.fz),
      up: new THREE.Vector3(this.ux, this.uy, this.uz),
      right: new THREE.Vector3(this.rx, this.ry, this.rz),
      roll: this.rollV,
      curvature: this.curvV,
      halfWidth: this.halfWidth,
    };
  }

  /** Interpolated sample at u (wraps). Writes into `out` when given, otherwise allocates. */
  sampleAt(u: number, out?: TrackSample): TrackSample {
    this.evaluate(u);
    if (!out) return this.makeSample();
    out.u = this.u;
    out.distance = this.u * this.length;
    out.position.set(this.px, this.py, this.pz);
    out.forward.set(this.fx, this.fy, this.fz);
    out.up.set(this.ux, this.uy, this.uz);
    out.right.set(this.rx, this.ry, this.rz);
    out.roll = this.rollV;
    out.curvature = this.curvV;
    out.halfWidth = this.halfWidth;
    return out;
  }

  /** Index of the sample nearest to (x,y,z) among indices [from, from+span) modulo count; squared distance goes to `bestD2`. */
  private nearest(x: number, y: number, z: number, from: number, span: number): number {
    const n = this.count;
    const pos = this.pos;
    let best = -1;
    let bestD2 = Infinity;
    let i = ((from % n) + n) % n;
    for (let k = 0; k < span; k++) {
      const i3 = i * 3;
      const dx = pos[i3] - x;
      const dy = pos[i3 + 1] - y;
      const dz = pos[i3 + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
      i = i + 1 === n ? 0 : i + 1;
    }
    this.bestD2 = bestD2;
    return best;
  }

  /**
   * Nearest point on the centerline frame field. With `hintU` only a +-64 sample window is
   * scanned (falling back to a full scan when the best hit is suspiciously far); without it
   * the whole loop is scanned.
   */
  project(p: THREE.Vector3, hintU?: number): TrackProjection {
    const n = this.count;
    let hit: number;
    if (hintU !== undefined && Number.isFinite(hintU)) {
      const centre = Math.round((hintU - Math.floor(hintU)) * n);
      hit = this.nearest(p.x, p.y, p.z, centre - HINT_WINDOW, HINT_WINDOW * 2 + 1);
      if (this.bestD2 > SUSPICIOUS_DISTANCE * SUSPICIOUS_DISTANCE) hit = this.nearest(p.x, p.y, p.z, 0, n);
    } else {
      hit = this.nearest(p.x, p.y, p.z, 0, n);
    }

    // Newton refinement of u on the interpolated frames.
    let u = hit / n;
    for (let iter = 0; iter < 4; iter++) {
      this.evaluate(u);
      const along = (p.x - this.px) * this.fx + (p.y - this.py) * this.fy + (p.z - this.pz) * this.fz;
      u += along / this.length;
      if (Math.abs(along) < 1e-5) break;
    }
    this.evaluate(u);
    const dx = p.x - this.px;
    const dy = p.y - this.py;
    const dz = p.z - this.pz;
    return {
      u: this.u,
      distance: this.u * this.length,
      lateral: dx * this.rx + dy * this.ry + dz * this.rz,
      height: dx * this.ux + dy * this.uy + dz * this.uz,
      sample: this.makeSample(),
    };
  }
}
