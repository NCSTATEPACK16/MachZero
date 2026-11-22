/**
 * Records the player's ship as a ghost (IMPLEMENTATION §M8b): `sample` is called every fixed step from GO and
 * keeps every 6th (20 Hz), so sample k is the pose at race time k / 20 s. The stored rotation is the one the
 * ship is drawn with (the body rotation with its visual bank). The buffers grow in blocks: nothing is allocated
 * per sample. `finish` quantises into a `GhostData`.
 */
import type { Quaternion, Vector3 } from 'three';
import { CONFIG } from '../../core/config';
import { GHOST_HZ, GHOST_VERSION, packPos, packQuat, type GhostData } from './ghostCodec';

/** What the recorder reads from a ship (ShipState has all three). */
export interface GhostPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  /** Visual roll (rad): drawn as quaternion × axisAngle(+Z, −bank). */
  readonly bank: number;
}

/** Fixed steps per sample. */
export const GHOST_STRIDE = Math.round(1 / CONFIG.FIXED_DT / GHOST_HZ);
const BLOCK = 1024;

export class GhostRecorder {
  /** 7 per sample: x, y, z, qx, qy, qz, qw. */
  private data = new Float64Array(7 * BLOCK);
  private n = 0;
  private step = 0;

  /** Forget everything and record from the next `sample` (call at GO). */
  start(): void {
    this.n = 0;
    this.step = 0;
  }

  get count(): number {
    return this.n;
  }

  /** Call once per fixed step while the ship races; every GHOST_STRIDE-th call is kept, the first included. */
  sample(ship: GhostPose): void {
    const keep = this.step % GHOST_STRIDE === 0;
    this.step++;
    if (!keep) return;
    if (7 * (this.n + 1) > this.data.length) {
      const grown = new Float64Array(this.data.length + 7 * BLOCK);
      grown.set(this.data);
      this.data = grown;
    }
    const d = this.data;
    const o = 7 * this.n++;
    const p = ship.position;
    const q = ship.quaternion;
    d[o] = p.x;
    d[o + 1] = p.y;
    d[o + 2] = p.z;
    // q × (0, 0, sin(−bank/2), cos(−bank/2)), written out (no temporary quaternion).
    const s = Math.sin(-ship.bank / 2);
    const c = Math.cos(-ship.bank / 2);
    d[o + 3] = q.x * c + q.y * s;
    d[o + 4] = q.y * c - q.x * s;
    d[o + 5] = q.z * c + q.w * s;
    d[o + 6] = q.w * c - q.z * s;
  }

  /** The recording so far as a ghost. The recorder keeps its samples (call `start` to begin again). */
  finish(totalTime: number, lapTimes: readonly number[], trackId: string, chassisId: string): GhostData {
    const n = this.n;
    const d = this.data;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 3; a++) {
        const v = d[7 * i + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
    if (n === 0) min.fill(0), max.fill(0);
    const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const pos = new Int16Array(3 * n);
    const quat = new Int16Array(3 * n);
    const largest = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const o = 7 * i;
      for (let a = 0; a < 3; a++) pos[3 * i + a] = packPos(d[o + a], min[a], size[a]);
      largest[i] = packQuat(d[o + 3], d[o + 4], d[o + 5], d[o + 6], quat, 3 * i);
    }
    return { version: GHOST_VERSION, trackId, chassisId, totalTime, lapTimes: [...lapTimes], count: n, min, size, pos, quat, largest };
  }
}
