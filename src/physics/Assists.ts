/**
 * Player assists (SPEC §2), as logic on the player's controls: auto-accelerate, a steering assist that blends the
 * player's steering toward a safe line, and a gentle push off the rails. M5 lands it with no settings UI so the
 * Rookie balance sim can drive with it; M7 adds the toggles, No-KO and early boost.
 *
 * The assist never takes full control: at `steering: 2` (strong) at most ASSIST.WEIGHT[2] = 60% of the steer
 * command is the assist's, the rest stays the player's.
 */
import * as THREE from 'three';
import type { Assists, ControlInput, ShipState, TrackData } from '../core/contracts';
import { clamp, wrap01 } from '../core/math';

export const ASSIST = {
  /** Share of the steer command the assist owns, by steering level (off, light, strong). */
  WEIGHT: [0, 0.3, 0.6] as const,
  /** Look-ahead (m) of the assist's aim point: BASE + K × speed. */
  LOOK_BASE: 18,
  LOOK_K: 0.45,
  /** The assist aims inside the rails by this much (m). */
  RAIL_MARGIN: 4,
  /** Within this many metres of a rail the assist also pushes away from it, up to RAIL_PUSH of a full steer. */
  RAIL_ZONE: 4,
  RAIL_PUSH: 1,
  /** Proportional gain from heading error (rad) to steer. */
  STEER_KP: 2.2,
  /** Auto-accelerate lets go of the throttle while the brake is held past this. */
  BRAKE_RELEASE: 0.05,
} as const;

export class PlayerAssists {
  private readonly out: ControlInput = { throttle: 0, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false };
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly cross = new THREE.Vector3();

  constructor(private readonly track: TrackData) {}

  /** The player's input with the assists applied (a reused object). Leaves `input` untouched. */
  apply(ship: ShipState, input: ControlInput, assists: Readonly<Assists>): ControlInput {
    const out = this.out;
    out.throttle = input.throttle;
    out.brake = input.brake;
    out.steer = input.steer;
    out.airbrakeLeft = input.airbrakeLeft;
    out.airbrakeRight = input.airbrakeRight;
    out.boost = input.boost;
    if (ship.status !== 'racing') return out;

    if (assists.autoAccelerate) out.throttle = input.brake > ASSIST.BRAKE_RELEASE ? input.throttle : 1;

    const w = ASSIST.WEIGHT[assists.steering] ?? 0;
    if (w > 0 && !ship.airborne) out.steer = clamp((1 - w) * input.steer + w * this.assistSteer(ship), -1, 1);
    return out;
  }

  /** Steer toward a point ahead at the ship's own lateral, kept inside the rails, plus a push off a near rail. */
  assistSteer(ship: ShipState): number {
    const branch = ship.path ? this.track.branches.find((b) => b.id === ship.path) : undefined;
    const halfWidth = branch ? branch.halfWidth : this.track.halfWidth;
    const inner = Math.max(0, halfWidth - ASSIST.RAIL_MARGIN);
    const lat = ship.lateral;

    // Rail push: + steers right (away from the left rail at negative lateral).
    const edge = Math.abs(lat) - (halfWidth - ASSIST.RAIL_ZONE);
    const push = edge > 0 ? -Math.sign(lat) * Math.min(1, edge / ASSIST.RAIL_ZONE) * ASSIST.RAIL_PUSH : 0;

    // On a split path there is no main-loop point ahead to aim at: the rail push alone.
    if (branch) return clamp(push, -1, 1);

    const look = ASSIST.LOOK_BASE + Math.max(0, ship.speed) * ASSIST.LOOK_K;
    const u = wrap01(ship.trackU + look / this.track.length);
    this.track.surfacePoint(u, clamp(lat, -inner, inner), this.aim);
    this.fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    this.aim.sub(ship.position);
    this.aim.addScaledVector(this.up, -this.aim.dot(this.up));
    // fwd × aim · up < 0 when the aim lies to the right (steer > 0 turns right).
    this.cross.crossVectors(this.fwd, this.aim);
    const angle = Math.atan2(-this.cross.dot(this.up), this.fwd.dot(this.aim));
    return clamp(ASSIST.STEER_KP * angle + push, -1, 1);
  }
}
