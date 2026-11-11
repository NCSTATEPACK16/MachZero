/**
 * Mines in physics (Orbital Ring's track mines; the Drop Mine item reuses it in §P). A mine is a trigger sphere,
 * MINE_RADIUS, tested against each ship's hull box every step (an exact sphere-vs-oriented-box test, deterministic,
 * no solver contact: a mine never pushes, it goes off). A ship that touches an armed mine gets the mine hit
 * (ShipController.applyMineHit: a knock sideways, away from the mine, and up; MINE_DAMAGE energy under the normal
 * hazard policy, or no energy and the Rookie slow-down) and `hazard:mine`; the mine re-arms MINE_RESPAWN seconds
 * later in the same place on its drift. Track mines move on the hazard clock (track/features/mine.ts).
 *
 * Dropped mines (the Drop Mine item, §P) follow the track mines in `mines`, in a fixed pool of DROP_MINE_MAX slots
 * (no allocation per drop; a free slot is unarmed, so graphics hides it and the AI and the test skip it). A dropped
 * mine holds still, ignores its dropper for DROP_MINE_GRACE s, and is gone when hit or after DROP_MINE_LIFE s; a
 * drop into a full pool replaces the oldest.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { MineView, ShipId, TrackData, TrackSample } from '../core/contracts';
import { wrap01 } from '../core/math';
import { buildMines, MINE_LIFT, MINE_RADIUS, minePose, type TrackMine } from '../track/features/mine';

/** A mine as physics, graphics and the AI see it this step. */
export type MineState = MineView;

/** What a ship looks like to the mine test. */
export interface MineTarget {
  id: ShipId;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Hull box half-sizes (across, up, along). */
  half: { x: number; y: number; z: number };
}

export interface MineHit {
  mine: MineState;
  /** Unit knock direction across the road, away from the mine. */
  side: THREE.Vector3;
  /** The road's up at the mine. */
  up: THREE.Vector3;
}

export class MineField {
  readonly mines: MineState[] = [];
  private readonly defs: TrackMine[];
  /** Hazard time each mine re-arms at (−∞ = armed). */
  private readonly rearmAt: number[] = [];
  private readonly pose = { d: 0, lateral: 0 };
  private sample: TrackSample | undefined;
  private readonly sideScratch = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly invQuat = new THREE.Quaternion();
  private readonly hit: MineHit = { mine: undefined as unknown as MineState, side: new THREE.Vector3(), up: new THREE.Vector3() };
  /** Index of the first dropped-mine slot (= the number of track mines). */
  readonly dropBase: number;
  /** Hazard time each dropped-mine slot was filled (−∞ = free). */
  private readonly droppedAt: number[] = [];

  constructor(private readonly track: TrackData) {
    this.defs = buildMines(track);
    for (const m of this.defs) {
      this.mines.push({ index: m.index, owner: null, u: 0, lateral: m.lateral, position: new THREE.Vector3(), armed: true });
      this.rearmAt.push(-Infinity);
    }
    this.dropBase = this.mines.length;
    for (let k = 0; k < CONFIG.DROP_MINE_MAX; k++) {
      this.mines.push({ index: this.dropBase + k, owner: null, u: 0, lateral: 0, position: new THREE.Vector3(), armed: false });
      this.droppedAt.push(-Infinity);
    }
    this.update(0);
  }

  /** Re-arm every track mine, clear the dropped ones and pose them for hazard time t (a race reset). */
  reset(t: number): void {
    for (let i = 0; i < this.rearmAt.length; i++) this.rearmAt[i] = -Infinity;
    for (let k = 0; k < this.droppedAt.length; k++) this.droppedAt[k] = -Infinity;
    this.update(t);
  }

  /** Dropped mines on the track now. */
  get droppedCount(): number {
    let n = 0;
    for (const at of this.droppedAt) if (at > -Infinity) n++;
    return n;
  }

  /**
   * Leave a mine at main-loop (u, lateral), or at `position` when given (a ship on a split path), at hazard
   * time t. Returns its index in `mines`.
   */
  drop(owner: ShipId, u: number, lateral: number, t: number, position?: THREE.Vector3): number {
    let k = this.droppedAt.indexOf(-Infinity);
    if (k < 0) {
      k = 0;
      for (let j = 1; j < this.droppedAt.length; j++) if (this.droppedAt[j] < this.droppedAt[k]) k = j;
    }
    this.droppedAt[k] = t;
    const m = this.mines[this.dropBase + k];
    m.owner = owner;
    m.u = wrap01(u);
    m.lateral = lateral;
    if (position) m.position.copy(position);
    else {
      const s = (this.sample = this.track.sampleAt(m.u, this.sample));
      m.position.copy(s.position).addScaledVector(s.right, lateral).addScaledVector(s.up, MINE_LIFT);
    }
    m.armed = true;
    return m.index;
  }

  /** Pose the mines and re-arm the ones whose time has come. */
  update(t: number): void {
    const track = this.track;
    for (let i = 0; i < this.defs.length; i++) {
      const m = this.mines[i];
      minePose(this.defs[i], t, this.pose);
      m.u = wrap01(this.pose.d / track.length);
      m.lateral = this.pose.lateral;
      const s = (this.sample = track.sampleAt(m.u, this.sample));
      m.position.copy(s.position).addScaledVector(s.right, m.lateral).addScaledVector(s.up, MINE_LIFT);
      m.armed = t >= this.rearmAt[i];
    }
    for (let k = 0; k < this.droppedAt.length; k++) {
      if (this.droppedAt[k] > -Infinity && t >= this.droppedAt[k] + CONFIG.DROP_MINE_LIFE) this.droppedAt[k] = -Infinity;
      this.mines[this.dropBase + k].armed = this.droppedAt[k] > -Infinity;
    }
  }

  /**
   * The first armed mine the hull touches, disarming it until t + MINE_RESPAWN, or null. The result is reused:
   * read it before the next call.
   */
  test(ship: MineTarget, t: number): MineHit | null {
    const reach = MINE_RADIUS + Math.hypot(ship.half.x, ship.half.y, ship.half.z);
    for (let i = 0; i < this.mines.length; i++) {
      const m = this.mines[i];
      if (!m.armed || m.position.distanceToSquared(ship.position) > reach * reach) continue;
      const dropped = i >= this.dropBase;
      if (dropped && m.owner === ship.id && t < this.droppedAt[i - this.dropBase] + CONFIG.DROP_MINE_GRACE) continue;
      // Mine centre in hull space, then the distance to the box.
      const p = this.local.copy(m.position).sub(ship.position).applyQuaternion(this.invQuat.copy(ship.quaternion).invert());
      const dx = Math.max(Math.abs(p.x) - ship.half.x, 0);
      const dy = Math.max(Math.abs(p.y) - ship.half.y, 0);
      const dz = Math.max(Math.abs(p.z) - ship.half.z, 0);
      if (dx * dx + dy * dy + dz * dz > MINE_RADIUS * MINE_RADIUS) continue;

      m.armed = false;
      if (dropped) this.droppedAt[i - this.dropBase] = -Infinity;
      else this.rearmAt[i] = t + CONFIG.MINE_RESPAWN;
      const s = (this.sample = this.track.sampleAt(m.u, this.sample));
      const across = this.sideScratch.copy(ship.position).sub(m.position).dot(s.right);
      // Away from the mine; dead centre, towards the middle of the road.
      const sign = Math.abs(across) > 0.05 ? Math.sign(across) : m.lateral > 0 ? -1 : 1;
      this.hit.mine = m;
      this.hit.side.copy(s.right).multiplyScalar(sign);
      this.hit.up.copy(s.up);
      return this.hit;
    }
    return null;
  }
}
