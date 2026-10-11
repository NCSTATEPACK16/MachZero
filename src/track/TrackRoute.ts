/**
 * The road a driver means to take, as one loop measured in route metres R: either the main loop, or the main
 * loop with a split path's branch in place of the stretch it skips. The AI scans curvature, aims and sizes its
 * line along the route, so a shortcut is driven like any other piece of road.
 *
 * A shortcut route is measured from its fork: R ∈ [0, branch length) is on the branch (R = branch metres), and
 * R ∈ [branch length, route length) is the main loop from the merge round to the fork. A main route is the main
 * loop with R = main metres from the start line.
 *
 * Laterals are relative to the road at R. Where the route changes road (fork and merge) the branch centre lies
 * `side · (W − w)` to the side of the main centre, so a lateral carried across that point shifts by that much
 * (see `lateralShift`).
 */
import type * as THREE from 'three';
import type { TrackBranch, TrackData, TrackSample } from '../core/contracts';
import { inLoopRange, wrap01 } from '../core/math';

export interface RoutePoint {
  /** null on the main loop, else the branch id. */
  path: string | null;
  /** Main metres (on main) or branch metres (on the branch). */
  m: number;
}

export class TrackRoute {
  readonly length: number;
  readonly branch: TrackBranch | null;
  private readonly L: number;
  private readonly dFork: number;
  private readonly dMerge: number;
  /** Main metres (unwrapped from dFork) where the roads separate. */
  private readonly dSepFork: number;
  private readonly dSepMerge: number;
  /** Lateral of the branch centre on the main road at the fork and merge. */
  readonly offset: number;

  constructor(
    private readonly track: TrackData,
    branch: TrackBranch | null = null,
  ) {
    this.L = track.length;
    this.branch = branch;
    this.scratchSample = track.sampleAt(0);
    if (!branch) {
      this.length = this.L;
      this.dFork = this.dMerge = this.dSepFork = this.dSepMerge = 0;
      this.offset = 0;
      return;
    }
    const L = this.L;
    this.dFork = branch.uFork * L;
    const unwrap = (u: number): number => {
      let d = u * L;
      while (d < this.dFork - 1) d += L;
      return d;
    };
    this.dMerge = unwrap(branch.uMerge);
    this.dSepFork = unwrap(branch.progressU(branch.overlapFork));
    this.dSepMerge = unwrap(branch.progressU(branch.length - branch.overlapMerge));
    this.length = L - (this.dMerge - this.dFork) + branch.length;
    this.offset = branch.side * (track.halfWidth - branch.halfWidth);
  }

  wrap(R: number): number {
    return ((R % this.length) + this.length) % this.length;
  }

  /** The road and its metres at route metres R. */
  locate(R: number, out: RoutePoint = { path: null, m: 0 }): RoutePoint {
    const r = this.wrap(R);
    const b = this.branch;
    if (!b) {
      out.path = null;
      out.m = r;
    } else if (r < b.length) {
      out.path = b.id;
      out.m = r;
    } else {
      out.path = null;
      out.m = (((this.dMerge + r - b.length) % this.L) + this.L) % this.L;
    }
    return out;
  }

  /** null when R is on the branch, else the main-loop u there (for main-loop features: ice, pipes, pit...). */
  mainUAt(R: number): number | null {
    const p = this.locate(R, this.scratchPoint);
    return p.path ? null : p.m / this.L;
  }

  /** Race progress (main-loop u) at R. */
  progressAt(R: number): number {
    const p = this.locate(R, this.scratchPoint);
    return p.path ? this.branch!.progressU(p.m) : p.m / this.L;
  }

  pathAt(R: number): string | null {
    return this.locate(R, this.scratchPoint).path;
  }

  sampleAt(R: number, out?: TrackSample): TrackSample {
    const p = this.locate(R, this.scratchPoint);
    return p.path ? this.branch!.sampleAt(p.m, out) : this.track.sampleAt(p.m / this.L, out);
  }

  curvatureAt(R: number): number {
    const p = this.locate(R, this.scratchPoint);
    if (p.path) return this.branch!.sampleAt(p.m, this.scratchSample).curvature;
    const n = this.track.samples.length;
    return this.track.samples[Math.floor(wrap01(p.m / this.L) * n) % n].curvature;
  }

  halfWidthAt(R: number): number {
    return this.locate(R, this.scratchPoint).path ? this.branch!.halfWidth : this.track.halfWidth;
  }

  surfacePoint(R: number, lateral: number, out: THREE.Vector3, outUp?: THREE.Vector3): THREE.Vector3 {
    const p = this.locate(R, this.scratchPoint);
    return p.path ? this.branch!.surfacePoint(p.m, lateral, out, outUp) : this.track.surfacePoint(p.m / this.L, lateral, out, outUp);
  }

  /**
   * Route metres of a ship on `path` at race progress u (`pathS` metres along a branch), or NaN when it is off
   * this route (on the main road past the separation of a shortcut it meant to take).
   */
  shipR(path: string | null, u: number, pathS = 0): number {
    const b = this.branch;
    if (!b) return wrap01(u) * this.L;
    if (path === b.id) return pathS;
    if (path !== null) return Number.NaN;
    const L = this.L;
    // Main metres from the fork, in [0, L).
    const x = (((wrap01(u) * L - this.dFork) % L) + L) % L;
    // On the main deck over the fork overlap: the matching point of the branch.
    if (x <= this.dSepFork - this.dFork) return b.sAtProgress(u);
    // Past the separation, on the stretch the shortcut skips: off the route.
    if (x < this.dSepMerge - this.dFork) return Number.NaN;
    // On the main deck over the merge overlap, or after the merge.
    const y = x - (this.dMerge - this.dFork);
    return y < 0 ? b.sAtProgress(u) : this.wrap(b.length + y);
  }

  /**
   * What to add to a lateral defined at route metres R0 to express the same point at R1 (R1 ahead of R0, less
   * than half the route): −offset across the fork onto the branch, +offset across the merge back onto main.
   */
  lateralShift(R0: number, R1: number): number {
    const b = this.branch;
    if (!b) return 0;
    const a = this.wrap(R0);
    const span = R1 - R0;
    let shift = 0;
    // Crossing R = 0 (the fork) going forward.
    if (span > 0 && a + span >= this.length) shift -= this.offset;
    // Crossing R = branch length (the merge).
    if (span > 0 && a < b.length && a + span >= b.length) shift += this.offset;
    return shift;
  }

  /** Is main-loop u inside the stretch this shortcut route skips (between the separations)? */
  skips(u: number): boolean {
    if (!this.branch) return false;
    return inLoopRange(wrap01(u), wrap01(this.dSepFork / this.L), wrap01(this.dSepMerge / this.L));
  }

  private readonly scratchPoint: RoutePoint = { path: null, m: 0 };
  private scratchSample!: TrackSample;
}
