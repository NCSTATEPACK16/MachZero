/**
 * Drafting (slipstream, SPEC §7, IMPLEMENTATION §M5). A ship with another racer within DRAFT.RANGE metres directly
 * ahead — inside a ±DRAFT.CONE cone around its own forward direction and within DRAFT.LANE metres to either side —
 * builds `ShipState.drafting` from 0 to 1 over DRAFT.BUILD seconds; out of the wake it fades over DRAFT.FADE.
 * ShipController turns it into a higher top speed (up to +DRAFT.TOP_BONUS), more thrust and less coast drag.
 *
 * Every ship drafts the same way; only the AI's eagerness to look for a draft depends on its tier.
 */
import * as THREE from 'three';
import type { ShipId, ShipState } from '../core/contracts';
import type { GameBus } from '../core/events';

export const DRAFT = {
  /** Metres ahead within which a ship gives a draft. */
  RANGE: 30,
  /** Half-angle (rad) of the cone around the follower's forward direction. */
  CONE: (12 * Math.PI) / 180,
  /** Metres to either side of the follower's forward line. */
  LANE: 4,
  /** Metres above or below the follower's deck (pipes and loops put rivals overhead). */
  VERTICAL: 3,
  /** Seconds for the draft to build from 0 to 1, and to fade back. */
  BUILD: 0.6,
  FADE: 0.4,
  /** Below this speed (m/s) there is no wake to ride. */
  MIN_SPEED: 25,
  /** Full draft: top speed (and boost top speed) × (1 + TOP_BONUS). */
  TOP_BONUS: 0.06,
  /** Full draft: thrust × (1 + ACCEL_BONUS). */
  ACCEL_BONUS: 0.15,
  /** Full draft: coast drag × (1 − DRAG_CUT). */
  DRAG_CUT: 0.5,
  /** `ship:draft` hysteresis: active from ON, inactive again below OFF. */
  ON: 0.3,
  OFF: 0.15,
} as const;

const fwd = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const rel = new THREE.Vector3();
const tanCone = Math.tan(DRAFT.CONE);

/** Is `leader` in `ship`'s slipstream window (geometry only)? */
export function inDraftWindow(ship: ShipState, leader: ShipState): boolean {
  fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
  rel.subVectors(leader.position, ship.position);
  const ahead = rel.dot(fwd);
  if (ahead <= 0 || ahead > DRAFT.RANGE) return false;
  up.set(0, 1, 0).applyQuaternion(ship.quaternion);
  if (Math.abs(rel.dot(up)) > DRAFT.VERTICAL) return false;
  right.crossVectors(fwd, up);
  const side = Math.abs(rel.dot(right));
  return side <= DRAFT.LANE && side <= ahead * tanCone;
}

/** Can this ship draft (or give a draft) right now? */
function racing(s: ShipState): boolean {
  return s.status === 'racing' && !s.airborne;
}

export class Drafting {
  private readonly active = new Set<ShipId>();

  constructor(private readonly bus: GameBus | null = null) {}

  /** Advance every ship's `drafting` by dt and emit `ship:draft` on the hysteresis edges. */
  update(ships: readonly ShipState[], dt: number): void {
    for (const s of ships) {
      let target = 0;
      if (racing(s) && s.forwardSpeed >= DRAFT.MIN_SPEED) {
        for (const o of ships) {
          if (o !== s && racing(o) && inDraftWindow(s, o)) {
            target = 1;
            break;
          }
        }
      }
      const rate = target > s.drafting ? dt / DRAFT.BUILD : dt / DRAFT.FADE;
      s.drafting = target > s.drafting ? Math.min(target, s.drafting + rate) : Math.max(target, s.drafting - rate);
      const id = s.def.id;
      const was = this.active.has(id);
      if (!was && s.drafting >= DRAFT.ON) {
        this.active.add(id);
        this.bus?.emit('ship:draft', { shipId: id, active: true });
      } else if (was && s.drafting < DRAFT.OFF) {
        this.active.delete(id);
        this.bus?.emit('ship:draft', { shipId: id, active: false });
      }
    }
  }

  /** A ship reset to the grid (or respawned) leaves any draft at once. */
  clear(ship: ShipState): void {
    ship.drafting = 0;
    if (this.active.delete(ship.def.id)) this.bus?.emit('ship:draft', { shipId: ship.def.id, active: false });
  }
}
