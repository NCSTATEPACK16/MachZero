/**
 * Plays a ghost back (IMPLEMENTATION §M8b): `pose(t)` is the pose at race time `t`, linear between samples for
 * the position and normalised-linear for the rotation. The samples are unpacked once, up front.
 */
import type { Quaternion, Vector3 } from 'three';
import { GHOST_HZ, unpackPos, unpackQuat, type GhostData } from './ghostCodec';

export class GhostPlayer {
  /** 7 per sample: x, y, z, qx, qy, qz, qw. */
  private readonly d: Float32Array;
  readonly count: number;
  /** Seconds from the first sample to the last. */
  readonly duration: number;

  constructor(readonly ghost: GhostData) {
    const n = ghost.count;
    this.count = n;
    this.duration = n > 0 ? (n - 1) / GHOST_HZ : 0;
    const d = new Float32Array(7 * n);
    const q = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const o = 7 * i;
      for (let a = 0; a < 3; a++) d[o + a] = unpackPos(ghost.pos[3 * i + a], ghost.min[a], ghost.size[a]);
      unpackQuat(ghost.quat, 3 * i, ghost.largest[i], q, 0);
      // Keep neighbouring samples in the same hemisphere so the interpolation takes the short way round.
      if (i > 0 && q[0] * d[o - 4] + q[1] * d[o - 3] + q[2] * d[o - 2] + q[3] * d[o - 1] < 0) for (let k = 0; k < 4; k++) q[k] = -q[k];
      d[o + 3] = q[0];
      d[o + 4] = q[1];
      d[o + 5] = q[2];
      d[o + 6] = q[3];
    }
    this.d = d;
  }

  /** The pose at race time `t` into `outPos` / `outQuat`; false (outputs untouched) before 0 or after the end. */
  pose(t: number, outPos: Vector3, outQuat: Quaternion): boolean {
    if (this.count === 0 || !(t >= 0) || t > this.duration + 1e-9) return false;
    const f = Math.min(t * GHOST_HZ, this.count - 1);
    const i = Math.min(Math.floor(f), this.count - 2 < 0 ? 0 : this.count - 2);
    const k = this.count === 1 ? 0 : f - i;
    const d = this.d;
    const a = 7 * i;
    const b = this.count === 1 ? a : a + 7;
    outPos.set(d[a] + (d[b] - d[a]) * k, d[a + 1] + (d[b + 1] - d[a + 1]) * k, d[a + 2] + (d[b + 2] - d[a + 2]) * k);
    outQuat.set(d[a + 3] + (d[b + 3] - d[a + 3]) * k, d[a + 4] + (d[b + 4] - d[a + 4]) * k, d[a + 5] + (d[b + 5] - d[a + 5]) * k, d[a + 6] + (d[b + 6] - d[a + 6]) * k).normalize();
    return true;
  }
}
