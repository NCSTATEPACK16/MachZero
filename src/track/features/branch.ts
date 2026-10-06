/**
 * Split paths (Jade Ruins). A branch is an open road from a fork on the main loop to a merge further on. It
 * starts and ends beside the main centreline, offset to one side by (W_main − W_branch), heading the same way,
 * so for its first and last metres it overlaps that half of the main deck: a ship takes the shortcut by keeping
 * to that side, and rejoins by driving on. The overlap ends where the roads have separated far enough for both
 * rails to stand between them (main right rail and branch inner rail side by side), marked by a crash-barrier
 * nose.
 *
 * Frames are built like the main loop's (world-up projected, banked by curvature) but open-ended, and the bank
 * fades out over the overlaps so the two decks are coplanar where they touch. Race progress on the branch is
 * the main loop's u: projected onto the main centreline through the overlaps (where the roads run side by side)
 * and linear in between, so it is monotonic and continuous when a ship changes road.
 */
import * as THREE from 'three';
import { CONFIG } from '../../core/config';
import type { TrackBranch, TrackFeature, TrackSample } from '../../core/contracts';
import { clamp, smoothstep, wrap01 } from '../../core/math';
import type { TrackQuery } from '../TrackQuery';

type BranchFeature = Extract<TrackFeature, { type: 'branch' }>;

/** Target spacing (m) of branch frames. */
const BRANCH_DS = 1.5;
/** Extra metres over which the bank fades in after an overlap. */
const BANK_FADE = 60;

/** Lateral distance between the main and branch centrelines at which both rails fit between the decks. */
export function branchSeparation(halfWidth: number): number {
  return CONFIG.TRACK_HALF_WIDTH + halfWidth + 2 * CONFIG.RAIL_THICKNESS;
}

export interface BranchProjection {
  s: number;
  lateral: number;
  height: number;
  sample: TrackSample;
  /** Inside the branch's length (not past either end). */
  within: boolean;
}

/** A built branch: the contract plus what the track builder, mesh and physics need. */
export class BuiltBranch implements TrackBranch {
  readonly id: string;
  readonly uFork: number;
  readonly uMerge: number;
  readonly length: number;
  readonly halfWidth: number;
  readonly side: 1 | -1;
  readonly overlapFork: number;
  readonly overlapMerge: number;
  readonly samples: TrackSample[];
  readonly openEdge: TrackBranch['openEdge'];
  /** Main-loop distance (m, unwrapped from dFork) where the roads separate at the fork / merge. */
  readonly dSepFork: number;
  readonly dSepMerge: number;
  readonly dFork: number;
  readonly dMerge: number;

  readonly count: number;
  readonly ds: number;
  readonly pos: Float64Array;
  readonly tan: Float64Array;
  readonly up: Float64Array;
  readonly right: Float64Array;
  readonly curvature: Float64Array;
  /** Race progress (unwrapped main u) per sample. */
  private readonly prog: Float64Array;
  private readonly mainLength: number;

  constructor(def: BranchFeature, main: TrackQuery, mainLength: number) {
    this.id = def.id;
    this.halfWidth = def.halfWidth;
    this.side = def.side;
    this.mainLength = mainLength;
    this.dFork = def.dFork;
    this.dMerge = def.dMerge > def.dFork ? def.dMerge : def.dMerge + mainLength;
    this.uFork = wrap01(def.dFork / mainLength);
    this.uMerge = wrap01(def.dMerge / mainLength);

    // ---- centreline, uniform by arc length ----
    const curve = new THREE.CatmullRomCurve3(
      def.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      false,
      'centripetal',
    );
    const fine = 4096;
    const fp = curve.getSpacedPoints(fine);
    const cum = new Float64Array(fine + 1);
    for (let i = 1; i <= fine; i++) cum[i] = cum[i - 1] + fp[i].distanceTo(fp[i - 1]);
    const length = cum[fine];
    this.length = length;
    const count = Math.max(8, Math.ceil(length / BRANCH_DS) + 1);
    this.count = count;
    const ds = length / (count - 1);
    this.ds = ds;
    const pos = new Float64Array(count * 3);
    for (let i = 0, j = 0; i < count; i++) {
      const d = i * ds;
      while (j < fine - 1 && cum[j + 1] < d) j++;
      const t = clamp((d - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]), 0, 1);
      pos[i * 3] = fp[j].x + (fp[j + 1].x - fp[j].x) * t;
      pos[i * 3 + 1] = fp[j].y + (fp[j + 1].y - fp[j].y) * t;
      pos[i * 3 + 2] = fp[j].z + (fp[j + 1].z - fp[j].z) * t;
    }
    this.pos = pos;

    // ---- tangents (central differences, one-sided at the ends) ----
    const tan = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(count - 1, i + 1);
      let x = pos[b * 3] - pos[a * 3];
      let y = pos[b * 3 + 1] - pos[a * 3 + 1];
      let z = pos[b * 3 + 2] - pos[a * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      x /= l;
      y /= l;
      z /= l;
      tan[i * 3] = x;
      tan[i * 3 + 1] = y;
      tan[i * 3 + 2] = z;
    }
    this.tan = tan;

    // ---- overlap with the main deck: where the centrelines are closer than the separation ----
    const sep = branchSeparation(def.halfWidth);
    const p = new THREE.Vector3();
    const mainLat = new Float64Array(count);
    const mainU = new Float64Array(count);
    let hint = this.uFork;
    for (let i = 0; i < count; i++) {
      p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      const pr = main.project(p, hint);
      hint = pr.u;
      mainLat[i] = pr.lateral * def.side;
      mainU[i] = pr.u;
    }
    let iSepF = 0;
    while (iSepF < count - 1 && mainLat[iSepF] < sep) iSepF++;
    let iSepM = count - 1;
    while (iSepM > 0 && mainLat[iSepM] < sep) iSepM--;
    if (iSepM <= iSepF) throw new Error(`branch ${def.id}: never separates from the main road`);
    this.overlapFork = iSepF * ds;
    this.overlapMerge = (count - 1 - iSepM) * ds;
    const unwrap = (u: number): number => {
      let d = u * mainLength;
      while (d < this.dFork - mainLength / 2) d += mainLength;
      while (d > this.dFork + mainLength / 2) d -= mainLength;
      return d;
    };
    this.dSepFork = unwrap(mainU[iSepF]);
    this.dSepMerge = unwrap(mainU[iSepM]);
    if (this.dSepMerge < this.dSepFork) this.dSepMerge += mainLength;

    // ---- race progress: projected through the overlaps, linear between, monotonic ----
    const prog = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      let d: number;
      if (i <= iSepF) d = unwrap(mainU[i]);
      else if (i >= iSepM) {
        d = unwrap(mainU[i]);
        if (d < this.dSepFork) d += mainLength;
      } else d = this.dSepFork + ((this.dSepMerge - this.dSepFork) * (i - iSepF)) / (iSepM - iSepF);
      prog[i] = i > 0 ? Math.max(prog[i - 1], d) : d;
    }
    this.prog = prog;

    // ---- banked frames, flat over the overlaps ----
    const up = new Float64Array(count * 3);
    const right = new Float64Array(count * 3);
    const curvature = new Float64Array(count);
    const rawBank = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Unbanked up: world up projected off the tangent.
      const ty = tan[i3 + 1];
      let ux = -ty * tan[i3];
      let uy = 1 - ty * ty;
      let uz = -ty * tan[i3 + 2];
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      up[i3] = ux;
      up[i3 + 1] = uy;
      up[i3 + 2] = uz;
      // right0 = tan × up0; curvature = dT/ds · right0.
      const rx = tan[i3 + 1] * uz - tan[i3 + 2] * uy;
      const ry = tan[i3 + 2] * ux - tan[i3] * uz;
      const rz = tan[i3] * uy - tan[i3 + 1] * ux;
      const a = Math.max(0, i - 1);
      const b = Math.min(count - 1, i + 1);
      const span = (b - a) * ds || 1;
      const k = ((tan[b * 3] - tan[a * 3]) * rx + (tan[b * 3 + 1] - tan[a * 3 + 1]) * ry + (tan[b * 3 + 2] - tan[a * 3 + 2]) * rz) / span;
      curvature[i] = k;
      rawBank[i] = clamp(k * CONFIG.BANK_FACTOR, -CONFIG.MAX_BANK, CONFIG.MAX_BANK);
    }
    const bank = smoothClamped(rawBank, 45 / ds);
    const sFork = this.overlapFork;
    const sMerge = length - this.overlapMerge;
    for (let i = 0; i < count; i++) {
      const s = i * ds;
      const fade = smoothstep(sFork, sFork + BANK_FADE, s) * (1 - smoothstep(sMerge - BANK_FADE, sMerge, s));
      const ang = bank[i] * fade;
      const i3 = i * 3;
      const ax = tan[i3];
      const ay = tan[i3 + 1];
      const az = tan[i3 + 2];
      const vx = up[i3];
      const vy = up[i3 + 1];
      const vz = up[i3 + 2];
      // Rodrigues: rotate up about the tangent by +ang (leans toward +right, as on the main loop).
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const cx = ay * vz - az * vy;
      const cy = az * vx - ax * vz;
      const cz = ax * vy - ay * vx;
      const nx = vx * c + cx * sn;
      const ny = vy * c + cy * sn;
      const nz = vz * c + cz * sn;
      up[i3] = nx;
      up[i3 + 1] = ny;
      up[i3 + 2] = nz;
      right[i3] = ay * nz - az * ny;
      right[i3 + 1] = az * nx - ax * nz;
      right[i3 + 2] = ax * ny - ay * nx;
    }
    this.up = up;
    this.right = right;
    this.curvature = curvature;

    this.samples = [];
    for (let i = 0; i < count; i++) this.samples.push(this.sampleAt(i * ds));
    this.openEdge =
      def.openFrom !== undefined && def.openTo !== undefined ? { side: def.side, sFrom: def.openFrom, sTo: def.openTo } : null;
  }

  private index(s: number): { i0: number; i1: number; t: number } {
    const f = clamp(s / this.ds, 0, this.count - 1);
    const i0 = Math.min(Math.floor(f), this.count - 2);
    return { i0, i1: i0 + 1, t: f - i0 };
  }

  sampleAt(s: number, out?: TrackSample): TrackSample {
    const { i0, i1, t } = this.index(s);
    const o =
      out ??
      ({
        u: 0,
        distance: 0,
        position: new THREE.Vector3(),
        forward: new THREE.Vector3(),
        up: new THREE.Vector3(),
        right: new THREE.Vector3(),
        roll: 0,
        curvature: 0,
        halfWidth: this.halfWidth,
      } as TrackSample);
    const a = i0 * 3;
    const b = i1 * 3;
    const lerp = (arr: Float64Array, k: number): number => arr[a + k] + (arr[b + k] - arr[a + k]) * t;
    o.position.set(lerp(this.pos, 0), lerp(this.pos, 1), lerp(this.pos, 2));
    o.forward.set(lerp(this.tan, 0), lerp(this.tan, 1), lerp(this.tan, 2)).normalize();
    o.up.set(lerp(this.up, 0), lerp(this.up, 1), lerp(this.up, 2));
    o.up.addScaledVector(o.forward, -o.up.dot(o.forward)).normalize();
    o.right.crossVectors(o.forward, o.up);
    const sc = clamp(s, 0, this.length);
    o.u = sc / this.length;
    o.distance = sc;
    o.roll = 0;
    o.curvature = this.curvature[i0] + (this.curvature[i1] - this.curvature[i0]) * t;
    o.halfWidth = this.halfWidth;
    return o;
  }

  surfacePoint(s: number, lateral: number, out: THREE.Vector3, outUp?: THREE.Vector3): THREE.Vector3 {
    const smp = this.sampleAt(s, this.scratch);
    if (outUp) outUp.copy(smp.up);
    return out.copy(smp.position).addScaledVector(smp.right, lateral);
  }

  progressU(s: number): number {
    const { i0, i1, t } = this.index(s);
    const d = this.prog[i0] + (this.prog[i1] - this.prog[i0]) * t;
    return wrap01(d / this.mainLength);
  }

  /** Branch metres whose race progress is (about) main-loop u: inverse of progressU, clamped to the branch. */
  sAtProgress(u: number): number {
    let d = u * this.mainLength;
    while (d < this.prog[0] - this.mainLength / 2) d += this.mainLength;
    while (d > this.prog[0] + this.mainLength / 2) d -= this.mainLength;
    if (d <= this.prog[0]) return 0;
    if (d >= this.prog[this.count - 1]) return this.length;
    let lo = 0;
    let hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.prog[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = this.prog[hi] - this.prog[lo];
    const t = span > 1e-9 ? (d - this.prog[lo]) / span : 0;
    return (lo + t) * this.ds;
  }

  /** Nearest point on the branch centreline, near `hintS` when given. */
  project(p: THREE.Vector3, hintS?: number): BranchProjection {
    const n = this.count;
    const pos = this.pos;
    let from = 0;
    let to = n - 1;
    if (hintS !== undefined && Number.isFinite(hintS)) {
      const c = Math.round(clamp(hintS / this.ds, 0, n - 1));
      from = Math.max(0, c - 60);
      to = Math.min(n - 1, c + 60);
    }
    let best = from;
    let bestD2 = Infinity;
    for (let i = from; i <= to; i++) {
      const dx = pos[i * 3] - p.x;
      const dy = pos[i * 3 + 1] - p.y;
      const dz = pos[i * 3 + 2] - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    let s = best * this.ds;
    const smp = this.scratch;
    for (let iter = 0; iter < 4; iter++) {
      this.sampleAt(s, smp);
      const along = (p.x - smp.position.x) * smp.forward.x + (p.y - smp.position.y) * smp.forward.y + (p.z - smp.position.z) * smp.forward.z;
      s += along;
      if (Math.abs(along) < 1e-4) break;
    }
    const within = s >= 0 && s <= this.length;
    const sample = this.sampleAt(s);
    const dx = p.x - sample.position.x;
    const dy = p.y - sample.position.y;
    const dz = p.z - sample.position.z;
    return {
      s: clamp(s, 0, this.length),
      lateral: dx * sample.right.x + dy * sample.right.y + dz * sample.right.z,
      height: dx * sample.up.x + dy * sample.up.y + dz * sample.up.z,
      sample,
      within,
    };
  }

  private readonly scratch: TrackSample = {
    u: 0,
    distance: 0,
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    up: new THREE.Vector3(),
    right: new THREE.Vector3(),
    roll: 0,
    curvature: 0,
    halfWidth: 0,
  };
}

/** Gaussian smoothing of an open series (the ends are held, not wrapped). */
function smoothClamped(values: Float64Array, sigma: number): Float64Array {
  const n = values.length;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      acc += values[j] * w;
      wsum += w;
    }
    out[i] = acc / wsum;
  }
  return out;
}
