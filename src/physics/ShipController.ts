import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { COLLISION, CONFIG } from '../core/config';
import type { ControlInput, GridSlot, ShipState, ShipStats, TrackData } from '../core/contracts';
import { copyControls, neutralControls } from '../core/controls';
import type { GameBus } from '../core/events';
import { clamp, clamp01, damp, inLoopRange, wrapAngle } from '../core/math';
import { pipeLineCurvature } from './PipeCompensation';

/**
 * Physics-only tuning that is not part of the shared CONFIG. Everything the
 * design brief exposes as a global tunable (thrust, grip, hover, damage ...)
 * still comes from CONFIG; these are implementation constants of the model.
 */
export const TUNING = {
  /** Hover rays start this far above the body centre, along ship up. */
  RAY_LIFT: 1.0,
  /** Corner ray offsets: +-RAY_WIDTH_FRACTION * width/2 sideways, +-RAY_LENGTH_FRACTION * length fore/aft. */
  RAY_WIDTH_FRACTION: 0.8,
  RAY_LENGTH_FRACTION: 0.35,
  /** Upward push never exceeds this many times MAGNET_G. */
  REPULSOR_MAX_G: 9,
  /**
   * Extra pull toward the surface (beyond MAGNET_G) while the hover rays see it, as a multiple of MAGNET_G.
   * Makes the repulsor two-sided — the "magnetic lock" that keeps ships glued to the far side of a
   * corkscrew, where the surface accelerates away from the hull faster than MAGNET_G alone can follow.
   */
  MAGNET_LOCK_G: 3,
  /** Extra stiffening as the hull compresses below HOVER_HEIGHT. */
  REPULSOR_COMPRESSION: 3,
  /** Height band above HOVER_HEIGHT over which spring damping fades out. */
  DAMPING_FADE_TOP: 0.8,
  DAMPING_FADE_LENGTH: 0.5,
  /** Clamp on the finite-difference surface-relative hover speed (m/s): rejects ray-set discontinuities. */
  MAX_REL_HOVER_SPEED: 60,
  /** Slerp-rate multiplier for aligning to the track while no ray hits. */
  AIR_ALIGN_FACTOR: 0.35,
  /** Thrust / grip / steering authority while airborne. */
  AIR_THRUST_FACTOR: 0.25,
  AIR_GRIP_FACTOR: 0.3,
  AIR_STEER_FACTOR: 0.35,
  /** Decay rate (1/s) of forward speed above the current limit (after boost / dash). */
  OVERSPEED_RATE: 1.4,
  /** Fraction of removed sideways speed that is turned into forward speed. */
  GRIP_SPEED_TRANSFER: 0.85,
  AIRBRAKE_SPEED_TRANSFER: 0.3,
  /** Forward speed at which steering reaches full authority (m/s). */
  STEER_FULL_AUTHORITY_SPEED: 12,
  /** Extra visual roll (rad) from a fully-pressed air-brake. */
  AIRBRAKE_BANK: 0.35,
  /** Boost accel taper exponent. */
  BOOST_TAPER_POWER: 4,
  /** Hard sanity clamp on speed (m/s). */
  MAX_SPEED: 320,
  /** Ship-forward speed multiplier on respawn. */
  RESPAWN_SPEED_FACTOR: 0.3,
  /** Zones only affect ships hovering within this height of the surface. */
  ZONE_MAX_HEIGHT: 6,
  // --- collision response ---
  /** Minimum closing speed (m/s) to count as an impact. */
  IMPACT_MIN_SPEED: 0.8,
  /** Fraction of tangential speed lost per m/s of wall impact speed (capped). */
  WALL_BLEED_PER_MS: 0.012,
  WALL_BLEED_MAX: 0.35,
  /** Continuous tangential drag (1/s) while grinding along a wall. */
  WALL_SCRAPE_DRAG: 0.9,
  /** Energy per second per m/s of tangential speed while scraping. */
  WALL_SCRAPE_DAMAGE: 0.012,
  /** Yaw kick (rad) per m/s of impact speed and its cap. */
  WALL_YAW_KICK_PER_MS: 0.006,
  WALL_YAW_KICK_MAX: 0.3,
  /** Yaw assist (rad/s) pointing the nose away from a wall it is grinding on. */
  WALL_YAW_ASSIST: 1.8,
  /** Minimum seconds between rail-hit events per ship (scrapes). */
  RAIL_EVENT_INTERVAL: 1 / 15,
  /** Impact speed (m/s) that always emits an event regardless of throttling. */
  RAIL_EVENT_FORCE_SPEED: 8,
  /** Impact speed (m/s) mapping to intensity 1. */
  RAIL_INTENSITY_SPEED: 40,
  SHIP_INTENSITY_SPEED: 30,
  /** Contact points deeper than this distance count as touching. */
  CONTACT_MAX_DIST: 0.15,
  // --- pipes ---
  /** Lateral acceleration (m/s²) easing a ship off the top seam while a pipe opens (the deck splits there). */
  SEAM_GUARD_ACCEL: 70,
  /** Metres from the seam (|lateral| = halfWidth) over which the guard fades in. */
  SEAM_GUARD_BAND: 4.5,
  /** The guard starts this far (m) before the tube begins to open. */
  SEAM_GUARD_LEAD: 60,
  // --- jumps ---
  /** Speed into the surface (m/s) at touchdown that maps to ship:land intensity 1. */
  LAND_INTENSITY_SPEED: 20,
} as const;

const NEUTRAL: Readonly<ControlInput> = Object.freeze(neutralControls());

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** True while the ship participates in racing rules (damage, zones, respawn). */
function isActiveStatus(status: ShipState['status']): boolean {
  return status === 'racing' || status === 'finished';
}

/**
 * Per-ship simulation: hover spring, magnet gravity, propulsion, boost, zones,
 * energy and safety respawn. Owns the Rapier body/collider of one ship and the
 * ShipState it writes (physics fields only).
 */
export class ShipController {
  readonly state: ShipState;
  readonly body: RigidBody;
  readonly collider: Collider;

  /** Set by the PhysicsSystem from collision events. */
  railContact = false;

  // Orientation frame (unit, mutually orthogonal: right = fwd × up).
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fwd = new THREE.Vector3(0, 0, -1);
  private readonly right = new THREE.Vector3(1, 0, 0);

  /** Velocity handed to Rapier this step (before contacts resolve). */
  private readonly preVel = new THREE.Vector3();
  /** Local track frame from the latest projection (copied: the track may reuse its sample object). */
  private readonly sampleUp = new THREE.Vector3(0, 1, 0);
  private readonly sampleFwd = new THREE.Vector3(0, 0, -1);
  private readonly sampleRight = new THREE.Vector3(1, 0, 0);
  /** Track twist rate d(roll)/ds (rad/m) at the ship's projection. */
  private twistRate = 0;
  private sampleHalfWidth: number;
  private hasProjection = false;

  // Hover ray results of the current step.
  private rayHits = 0;
  private rayHeight = Infinity;
  private readonly rayNormal = new THREE.Vector3(0, 1, 0);
  /** Spring height of the previous step (NaN when the spring was inactive): used to damp velocity relative to the surface. */
  private prevSpringHeight = NaN;

  // Scratch (no per-step allocation).
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpN = new THREE.Vector3();
  private readonly tmpY = new THREE.Vector3();
  private readonly tmpZ = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly prevUp = new THREE.Vector3();
  private readonly alignRot = new THREE.Quaternion();
  private readonly rapierVec: Vec3Like = { x: 0, y: 0, z: 0 };
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  // Ray corner offsets in (right, forward) fractions.
  private static readonly CORNERS: ReadonlyArray<readonly [number, number]> = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];

  // Boost / energy bookkeeping.
  private boostArmed = false;
  private prevBoostInput = false;
  private lowEnergyFired = false;

  // Jumps: true from leaving a lip until the hover rays find the landing deck.
  private jumping = false;
  /** Lateral-grip multiplier of the surface under the ship (ice patches < 1). */
  private surfaceGrip = 1;
  private onIce = false;

  // Safety respawn.
  private invalidTime = 0;
  private lastValidU: number;
  /** Road of the last valid position (null = main loop) and metres along it when on a branch. */
  private lastValidPath: string | null = null;
  private lastValidS = 0;

  // Event throttling.
  private lastRailEventTime = -Infinity;

  private colliderEnabled = true;

  /** Per-ship handling (Balanced Stock = v1 CONFIG). */
  private get stats(): ShipStats {
    return this.state.def.stats;
  }

  /** Low-energy warning level: CONFIG.LOW_ENERGY_THRESHOLD percent of this ship's max. */
  private get lowEnergyLevel(): number {
    return (CONFIG.LOW_ENERGY_THRESHOLD / 100) * this.stats.energyMax;
  }

  constructor(
    private readonly world: World,
    private readonly track: TrackData,
    private readonly bus: GameBus,
    state: ShipState,
    body: RigidBody,
    collider: Collider,
  ) {
    this.state = state;
    this.body = body;
    this.collider = collider;
    this.sampleHalfWidth = track.halfWidth;
    this.lastValidU = state.trackU;
    this.frameFromQuaternion(state.quaternion);
    this.refreshProjection();
  }

  // -------------------------------------------------------------------------
  // Public API used by PhysicsSystem
  // -------------------------------------------------------------------------

  /** Copy current pose into the previous-pose fields. Must run before anything else in a step. */
  beginStep(): void {
    const s = this.state;
    s.prevPosition.copy(s.position);
    s.prevQuaternion.copy(s.quaternion);
  }

  /** Compute this step's velocity/orientation and push them into the rigid body. */
  simulate(dt: number, controls: ControlInput | undefined): void {
    const s = this.state;
    this.syncColliderWithStatus();

    if (s.status === 'retired') {
      copyControls(NEUTRAL, s.lastControls);
      s.velocity.set(0, 0, 0);
      s.speed = 0;
      s.forwardSpeed = 0;
      s.boosting = false;
      s.boostTimer = 0;
      s.bank = damp(s.bank, 0, CONFIG.BANK_RATE, dt);
      this.preVel.set(0, 0, 0);
      this.body.setLinvel(this.zeroVec(), true);
      return;
    }

    const c = controls ?? NEUTRAL;
    copyControls(c, s.lastControls);

    const racing = s.status === 'racing';
    const finished = s.status === 'finished';
    const onGrid = s.status === 'grid';

    // --- boost bookkeeping ---
    this.updateBoost(c, racing, dt);
    const boosting = s.boosting;

    // --- hover rays ---
    this.castHoverRays();
    // Over a jump gap there is nothing to hover on: no spring from the projection, just air gravity.
    const overAir = this.hasProjection && this.track.surfaceKindAt(s.trackU, s.lateral, s.path) === 'air';
    this.updateJump(this.rayHits > 0, overAir);
    // A jump lasts until the hull is back in hover range: rays that already see the landing deck from metres
    // up must not switch on the magnetic lock (it would hold the ship in a slow, damped glide down).
    const grounded = this.rayHits > 0 && !this.jumping;
    s.grounded = grounded;

    // Height above the surface used by the spring: rays when available,
    // otherwise the cached projection (keeps the spring alive after a hard landing).
    let hoverHeight = this.rayHeight;
    let springActive = grounded;
    if (!grounded && !overAir && this.hasProjection && s.heightAboveTrack < CONFIG.HOVER_HEIGHT + TUNING.DAMPING_FADE_TOP) {
      hoverHeight = s.heightAboveTrack;
      springActive = true;
    }

    // --- align body up ---
    const up = this.up;
    const sampleUp = this.sampleUp;
    this.prevUp.copy(up);
    if (grounded) {
      // Grounded: lock the hull exactly to the measured surface normal. Any lag lets lateral grip
      // misread the correct surface-tangent motion (e.g. the helix through the corkscrew) as slip.
      up.copy(this.rayNormal).normalize();
      // Magnetic lock: momentum follows the surface. Rotate the velocity through the same rotation
      // as the hull so bends in the surface (crests, dips, banks, the corkscrew twist) redirect speed
      // instead of converting it into a sideways fling off the track.
      this.alignRot.setFromUnitVectors(this.prevUp, up);
      s.velocity.applyQuaternion(this.alignRot);
    } else {
      this.alignUp(sampleUp, CONFIG.UP_ALIGN_RATE * TUNING.AIR_ALIGN_FACTOR, dt);
    }
    this.orthonormalizeHeading();

    if (grounded && this.hasProjection && this.twistRate !== 0) {
      // Twist compensation (arcade track magnetism). On a twisting ribbon (the corkscrew) a line of
      // constant lateral offset L is not straight on the surface: it has geodesic curvature
      // L·k²/(1 + L²k²) toward the centerline (k = twist rate, rad/m). The surface carries the ship
      // round that curve — heading and momentum yaw together — so it holds its line through the roll
      // instead of being flung into the outer rail.
      const k2 = this.twistRate * this.twistRate;
      const L = s.lateral;
      const fwdSpeed = s.velocity.dot(this.fwd);
      const angle = ((L * k2 * fwdSpeed) / (1 + L * L * k2)) * dt;
      this.yaw(angle);
      this.alignRot.setFromAxisAngle(up, angle);
      s.velocity.applyQuaternion(this.alignRot);
      this.right.crossVectors(this.fwd, up);
    }

    if (grounded && this.hasProjection && this.track.pipes.length > 0 && s.path === null) {
      // Pipe magnetism: where the deck curls, the surface carries the ship along its constant-lateral line
      // (see PipeCompensation), the pipe counterpart of the twist compensation above.
      const k = pipeLineCurvature(this.track, s.trackU, s.lateral);
      if (k !== 0) {
        const angle = k * s.velocity.dot(this.fwd) * dt;
        this.yaw(angle);
        this.alignRot.setFromAxisAngle(up, angle);
        s.velocity.applyQuaternion(this.alignRot);
        this.right.crossVectors(this.fwd, up);
      }
    }

    // --- decompose current velocity in the surface plane ---
    const v = s.velocity;
    let vUp = v.dot(up);
    const planar = this.tmpA.copy(v).addScaledVector(up, -vUp);
    let f = planar.dot(this.fwd);
    let lat = planar.dot(this.right);

    const authority = grounded ? 1 : TUNING.AIR_THRUST_FACTOR;

    if (onGrid) {
      f = 0;
      lat = 0;
    } else {
      // --- steering (yaw about ship up; right turn = negative rotation) ---
      const speedFrac = clamp01(Math.abs(f) / (this.stats.topSpeed * s.thrustScale));
      const steerRate = this.stats.steerRate + (this.stats.steerRateHighSpeed - this.stats.steerRate) * speedFrac;
      const lowSpeed = clamp01(Math.abs(f) / TUNING.STEER_FULL_AUTHORITY_SPEED);
      const steerIn = clamp(c.steer, -1, 1);
      const airbrakeYaw = (clamp01(c.airbrakeRight) - clamp01(c.airbrakeLeft)) * CONFIG.AIRBRAKE_YAW;
      const yawRate = (steerIn * steerRate + airbrakeYaw) * lowSpeed * (grounded ? 1 : TUNING.AIR_STEER_FACTOR);
      this.yaw(-yawRate * dt);

      // Re-express velocity in the rotated frame (velocity itself does not rotate: momentum).
      this.right.crossVectors(this.fwd, up);
      f = planar.dot(this.fwd);
      lat = planar.dot(this.right);

      // --- propulsion ---
      const rawThrottle = clamp01(c.throttle);
      const throttle = finished ? Math.min(rawThrottle, 0.6) : rawThrottle;
      const brake = clamp01(c.brake);
      const topSpeed = this.stats.topSpeed * s.thrustScale;
      const boostTop = this.stats.boostTopSpeed * s.thrustScale;
      const limit = boosting ? boostTop : topSpeed;
      const fPos = Math.max(f, 0);

      if (boosting) {
        const x = Math.min(fPos / boostTop, 1.5);
        const taper = 1 - Math.pow(x, TUNING.BOOST_TAPER_POWER);
        if (taper > 0) f += this.stats.boostAccel * s.thrustScale * taper * authority * dt;
      } else if (throttle > 0.02) {
        const cap = topSpeed * (0.4 + 0.6 * throttle);
        if (fPos < cap) {
          const x = fPos / cap;
          f += this.stats.thrustAccel * s.thrustScale * throttle * (1 - x * x) * authority * dt;
        }
      }

      // Speed above the current limit (after boost / dash) bleeds off smoothly.
      if (f > limit) f -= (f - limit) * (1 - Math.exp(-TUNING.OVERSPEED_RATE * dt));

      // Coast drag with no throttle and no boost.
      if (throttle <= 0.02 && !boosting) {
        const k = Math.exp(-CONFIG.COAST_DRAG * dt);
        f *= k;
      }

      // Air-brakes: extra longitudinal drag and looser sideways grip (power-slides).
      const abL = clamp01(c.airbrakeLeft);
      const abR = clamp01(c.airbrakeRight);
      const abMax = Math.max(abL, abR);
      if (abL + abR > 0) f *= Math.exp(-CONFIG.AIRBRAKE_DRAG * (abL + abR) * dt);

      // Lateral grip: anti-slip thrusters remove sideways speed and convert most of it
      // into forward speed (momentum is redirected, not destroyed).
      const grip =
        (this.stats.lateralGrip + (this.stats.airbrakeGrip - this.stats.lateralGrip) * abMax) *
        (grounded ? this.surfaceGrip : TUNING.AIR_GRIP_FACTOR);
      const latNew = lat * Math.exp(-grip * dt);
      const transfer = TUNING.GRIP_SPEED_TRANSFER + (TUNING.AIRBRAKE_SPEED_TRANSFER - TUNING.GRIP_SPEED_TRANSFER) * abMax;
      const keep = Math.sqrt(Math.max(0, f * f + lat * lat - latNew * latNew));
      f = f + (Math.sign(f || 1) * keep - f) * transfer;
      lat = latNew;

      // Seam guard: as a pipe opens, the deck splits along the top (lateral ±halfWidth) and the rails come back
      // there. A ship on the seam would fall through the slot, so the opening tube slides it down the wall.
      const guard = this.seamGuard();
      if (guard !== 0) lat += guard * TUNING.SEAM_GUARD_ACCEL * dt;

      // Brake: reduces the planar speed toward zero, never reverses.
      if (brake > 0) {
        const planarSpeed = Math.hypot(f, lat);
        if (planarSpeed > 1e-6) {
          const scale = Math.max(0, planarSpeed - CONFIG.BRAKE_DECEL * brake * dt) / planarSpeed;
          f *= scale;
          lat *= scale;
        }
      }
    }

    // --- vertical: hover spring + magnet gravity ---
    if (springActive) {
      const H = CONFIG.HOVER_HEIGHT;
      const G = CONFIG.MAGNET_G;
      const d = H - hoverHeight;
      let repulse = G + CONFIG.HOVER_STIFFNESS * d * (1 + TUNING.REPULSOR_COMPRESSION * Math.max(0, d / H));
      repulse = clamp(repulse, grounded ? -G * TUNING.MAGNET_LOCK_G : 0, G * TUNING.REPULSOR_MAX_G);
      const fade = grounded ? 1 : clamp01((H + TUNING.DAMPING_FADE_TOP - hoverHeight) / TUNING.DAMPING_FADE_LENGTH);
      // Damp the velocity RELATIVE to the surface (d height / dt), not the absolute vUp: on a twisting
      // section the surface at lateral offset L moves along its own normal at L·ω, and damping absolute
      // velocity would drag the ship metres below its hover height (and through the deck in the corkscrew).
      const relVel = Number.isFinite(this.prevSpringHeight)
        ? clamp((hoverHeight - this.prevSpringHeight) / dt, -TUNING.MAX_REL_HOVER_SPEED, TUNING.MAX_REL_HOVER_SPEED)
        : vUp;
      this.prevSpringHeight = hoverHeight;
      const accel = repulse - G - CONFIG.HOVER_DAMPING * relVel * fade;
      vUp += accel * dt;
    } else {
      this.prevSpringHeight = NaN;
    }

    // --- recompose velocity ---
    v.copy(this.fwd).multiplyScalar(f).addScaledVector(this.right, lat).addScaledVector(up, vUp);
    if (!springActive) {
      // Airborne: magnet gravity toward the nearest track surface (scaled on low-gravity worlds).
      v.addScaledVector(sampleUp, -CONFIG.MAGNET_G * this.track.airGravityScale * dt);
    }
    const speedSq = v.lengthSq();
    if (!(speedSq < TUNING.MAX_SPEED * TUNING.MAX_SPEED)) {
      if (Number.isFinite(speedSq)) v.multiplyScalar(TUNING.MAX_SPEED / Math.sqrt(speedSq));
      else v.set(0, 0, 0);
    }

    // --- bank (visual roll) ---
    const bankSpeed = clamp01(Math.hypot(f, lat) / (this.stats.topSpeed * 0.4));
    let bankTarget = 0;
    if (!onGrid) {
      bankTarget =
        clamp(c.steer, -1, 1) * CONFIG.MAX_VISUAL_BANK * bankSpeed +
        (clamp01(c.airbrakeRight) - clamp01(c.airbrakeLeft)) * TUNING.AIRBRAKE_BANK * (0.4 + 0.6 * bankSpeed);
    }
    s.bank = damp(s.bank, bankTarget, CONFIG.BANK_RATE, dt);

    // --- push into Rapier ---
    this.right.crossVectors(this.fwd, up);
    this.buildQuaternion(s.quaternion);
    this.preVel.copy(v);
    this.body.setLinvel(v, true);
    this.body.setRotation(s.quaternion, true);
  }

  /** After world.step: adopt the solver's translation and velocity. */
  readback(): void {
    const s = this.state;
    if (s.status === 'retired') {
      return;
    }
    const t = this.body.translation(this.rapierVec);
    s.position.set(t.x, t.y, t.z);
    const lv = this.body.linvel(this.rapierVec);
    s.velocity.set(lv.x, lv.y, lv.z);
    this.updateSpeeds();
  }

  /**
   * Resolve a contact between this ship and a rail wall. `n` is the wall normal
   * pointing from the wall toward the ship; `point` is the deepest contact point.
   */
  applyWallContact(n: THREE.Vector3, point: Vec3Like, dt: number, now: number): void {
    const s = this.state;
    if (s.status === 'retired') return;
    const v = s.velocity;
    const damageActive = isActiveStatus(s.status);

    const closing = -this.preVel.dot(n);
    const vnPost = v.dot(n);
    const impact = closing > TUNING.IMPACT_MIN_SPEED;

    let bounce = 0;
    if (impact) {
      // Reflect with restitution: the solver already removed the normal component.
      const target = CONFIG.RAIL_RESTITUTION * closing;
      if (vnPost < target) v.addScaledVector(n, target - vnPost);
      bounce = closing;
      if (damageActive) this.drainEnergy(CONFIG.RAIL_DAMAGE_PER_MS * this.stats.damageTakenScale * closing);
    }

    // Tangential handling (bleed on impact, drag while scraping).
    const vn = v.dot(n);
    const tangent = this.tmpB.copy(v).addScaledVector(n, -vn);
    let tangentSpeed = tangent.length();
    if (tangentSpeed > 1e-6) {
      let keep = Math.exp(-TUNING.WALL_SCRAPE_DRAG * dt);
      if (impact) keep *= 1 - clamp(TUNING.WALL_BLEED_PER_MS * closing, 0, TUNING.WALL_BLEED_MAX);
      v.addScaledVector(tangent, keep - 1);
      tangentSpeed *= keep;
      if (damageActive) this.drainEnergy(TUNING.WALL_SCRAPE_DAMAGE * tangentSpeed * dt);
    }

    // Steer the nose off the wall (glance instead of grinding head-on).
    const fwdIntoWall = this.fwd.dot(n);
    if (fwdIntoWall < 0) {
      let angle = TUNING.WALL_YAW_ASSIST * dt * clamp01(-fwdIntoWall * 4);
      if (impact) angle += clamp(TUNING.WALL_YAW_KICK_PER_MS * closing, 0, TUNING.WALL_YAW_KICK_MAX);
      const sign = this.tmpN.crossVectors(this.up, this.fwd).dot(n) > 0 ? 1 : -1;
      this.yaw(sign * angle);
      this.right.crossVectors(this.fwd, this.up);
    }

    this.body.setLinvel(v, true);
    this.updateSpeeds();

    // Event (throttled).
    const intensity = clamp01(
      Math.max(bounce / TUNING.RAIL_INTENSITY_SPEED, 0.08 + 0.3 * clamp01(tangentSpeed / CONFIG.TOP_SPEED)),
    );
    if (now - this.lastRailEventTime >= TUNING.RAIL_EVENT_INTERVAL || bounce > TUNING.RAIL_EVENT_FORCE_SPEED) {
      this.lastRailEventTime = now;
      this.bus.emit('ship:railHit', {
        shipId: s.def.id,
        point: new THREE.Vector3(point.x, point.y, point.z),
        normal: n.clone(),
        intensity,
      });
    }
  }

  /** Apply damage from a ship-ship collision. */
  applyShipDamage(closingSpeed: number): void {
    if (!isActiveStatus(this.state.status)) return;
    this.drainEnergy(CONFIG.SHIP_DAMAGE_PER_MS * this.stats.damageTakenScale * closingSpeed);
  }

  /** Preserved pre-solver velocity for impact computations. */
  get preSolveVelocity(): THREE.Vector3 {
    return this.preVel;
  }

  get isColliderEnabled(): boolean {
    return this.colliderEnabled;
  }

  /** Track projection, zones, energy events and the safety respawn. Runs last in a step. */
  finishStep(dt: number): void {
    const s = this.state;
    if (s.status === 'retired') {
      this.refreshProjection();
      return;
    }

    if (!this.isFinite()) {
      this.respawn(true);
      return;
    }

    this.refreshProjection();
    this.updateZones(dt);
    this.updateSurface();

    // Safety respawn.
    if (s.status !== 'grid') {
      const halfWidth = this.sampleHalfWidth;
      const invalid =
        s.heightAboveTrack < CONFIG.RESPAWN_HEIGHT || Math.abs(s.lateral) > halfWidth + CONFIG.RESPAWN_LATERAL_MARGIN;
      if (invalid) {
        this.invalidTime += dt;
        if (this.invalidTime > CONFIG.RESPAWN_GRACE) this.respawn(false);
      } else {
        this.invalidTime = 0;
        // Never remember a spot over a jump gap: there is nothing there to put the ship back on.
        if (this.track.surfaceKindAt(s.trackU, s.lateral, s.path) !== 'air') {
          this.lastValidU = s.trackU;
          this.lastValidPath = s.path;
          this.lastValidS = s.pathS;
        }
      }
    }
  }

  /** Teleport to a grid slot: zero velocity, full energy, cleared flags. */
  reset(slot: GridSlot): void {
    const s = this.state;
    this.colliderEnabled = true;
    this.collider.setEnabled(true);
    this.railContact = false;

    s.position.copy(slot.position);
    s.quaternion.copy(slot.quaternion);
    s.prevPosition.copy(slot.position);
    s.prevQuaternion.copy(slot.quaternion);
    s.velocity.set(0, 0, 0);
    s.speed = 0;
    s.forwardSpeed = 0;
    s.bank = 0;
    s.grounded = true;
    s.energy = this.stats.energyMax;
    s.boosting = false;
    s.boostTimer = 0;
    s.onDash = false;
    s.airborne = false;
    this.jumping = false;
    this.surfaceGrip = 1;
    this.onIce = false;
    if (s.inPit) {
      s.inPit = false;
      this.bus.emit('ship:pit', { shipId: s.def.id, active: false });
    }
    copyControls(NEUTRAL, s.lastControls);

    this.boostArmed = false;
    this.lowEnergyFired = false;
    this.invalidTime = 0;
    this.lastRailEventTime = -Infinity;
    this.preVel.set(0, 0, 0);

    this.frameFromQuaternion(slot.quaternion);
    this.body.setTranslation(slot.position, true);
    this.body.setRotation(slot.quaternion, true);
    this.body.setLinvel(this.zeroVec(), true);

    this.hasProjection = false;
    this.lastValidU = slot.u;
    this.lastValidPath = null;
    s.trackU = slot.u;
    s.path = null;
    s.pathS = 0;
    this.refreshProjection();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private zeroVec(): Vec3Like {
    const r = this.rapierVec;
    r.x = 0;
    r.y = 0;
    r.z = 0;
    return r;
  }

  private syncColliderWithStatus(): void {
    const retired = this.state.status === 'retired';
    if (retired && this.colliderEnabled) {
      this.colliderEnabled = false;
      this.collider.setEnabled(false);
      this.railContact = false;
    } else if (!retired && !this.colliderEnabled) {
      this.colliderEnabled = true;
      this.collider.setEnabled(true);
    }
  }

  private updateSpeeds(): void {
    const s = this.state;
    s.speed = s.velocity.length();
    s.forwardSpeed = s.velocity.dot(this.fwd);
  }

  private isFinite(): boolean {
    const p = this.state.position;
    const v = this.state.velocity;
    return Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z);
  }

  /** Boost edge handling (timer, energy cost). Emits ship:boost. */
  private updateBoost(c: ControlInput, racing: boolean, dt: number): void {
    const s = this.state;
    if (s.boosting) {
      s.boostTimer -= dt;
      if (s.boostTimer <= 0) {
        s.boosting = false;
        s.boostTimer = 0;
      }
    }
    if (c.boost) {
      if (!this.prevBoostInput) this.boostArmed = true;
    } else {
      this.boostArmed = false;
    }
    this.prevBoostInput = c.boost;

    if (this.boostArmed && racing && s.boostUnlocked && !s.boosting && s.energy > this.stats.boostCost) {
      this.boostArmed = false;
      s.boosting = true;
      s.boostTimer = this.stats.boostTime;
      this.drainEnergy(this.stats.boostCost);
      this.bus.emit('ship:boost', { shipId: s.def.id });
    }
  }

  /**
   * Jump bookkeeping: leaving the surface over a gap starts a jump (ship:jump); the hover rays finding a deck
   * again ends it (ship:land, intensity from the speed into the surface before the hull re-aligns).
   */
  private updateJump(rayHit: boolean, overAir: boolean): void {
    const s = this.state;
    if (!this.jumping) {
      if (!rayHit && overAir) {
        this.jumping = true;
        s.airborne = true;
        this.bus.emit('ship:jump', { shipId: s.def.id, intensity: clamp01(s.speed / this.stats.boostTopSpeed) });
      }
      return;
    }
    if (!rayHit || this.rayHeight > CONFIG.HOVER_HEIGHT + TUNING.DAMPING_FADE_TOP) return;
    this.jumping = false;
    s.airborne = false;
    const into = -s.velocity.dot(this.rayNormal);
    this.bus.emit('ship:land', { shipId: s.def.id, intensity: clamp01(into / TUNING.LAND_INTENSITY_SPEED) });
  }

  /** Four corner rays along -up against the surface only. Results land in ray* fields. */
  private castHoverRays(): void {
    const s = this.state;
    const up = this.up;
    const ray = this.ray;
    const ox = (CONFIG.SHIP_WIDTH / 2) * TUNING.RAY_WIDTH_FRACTION;
    const oz = CONFIG.SHIP_LENGTH * TUNING.RAY_LENGTH_FRACTION;
    this.right.crossVectors(this.fwd, up);

    ray.dir.x = -up.x;
    ray.dir.y = -up.y;
    ray.dir.z = -up.z;

    let hits = 0;
    let heightSum = 0;
    const normal = this.rayNormal.set(0, 0, 0);
    const n = this.tmpN;
    for (let i = 0; i < 4; i++) {
      const corner = ShipController.CORNERS[i];
      const sx = corner[0] * ox;
      const sz = corner[1] * oz;
      ray.origin.x = s.position.x + this.right.x * sx + this.fwd.x * sz + up.x * TUNING.RAY_LIFT;
      ray.origin.y = s.position.y + this.right.y * sx + this.fwd.y * sz + up.y * TUNING.RAY_LIFT;
      ray.origin.z = s.position.z + this.right.z * sx + this.fwd.z * sz + up.z * TUNING.RAY_LIFT;
      const hit = this.world.castRayAndGetNormal(ray, CONFIG.HOVER_RAY_LENGTH, true, undefined, COLLISION.HOVER_RAY);
      if (hit === null) continue;
      hits++;
      heightSum += hit.timeOfImpact - TUNING.RAY_LIFT;
      n.set(hit.normal.x, hit.normal.y, hit.normal.z);
      if (n.dot(up) < 0) n.negate();
      normal.add(n);
    }
    this.rayHits = hits;
    if (hits > 0) {
      this.rayHeight = heightSum / hits;
      if (normal.lengthSq() < 1e-8) normal.copy(up);
      else normal.normalize();
    } else {
      this.rayHeight = Infinity;
    }
  }

  /** Nlerp the body up vector toward `target` at exponential `rate` (1/s). */
  private alignUp(target: THREE.Vector3, rate: number, dt: number): void {
    const k = 1 - Math.exp(-rate * dt);
    this.up.lerp(target, k);
    if (this.up.lengthSq() < 1e-8) this.up.copy(target);
    this.up.normalize();
  }

  /** Re-project the heading onto the plane orthogonal to up and rebuild right. */
  private orthonormalizeHeading(): void {
    const up = this.up;
    const fwd = this.fwd;
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-6) {
      fwd.copy(this.sampleFwd);
      fwd.addScaledVector(up, -fwd.dot(up));
      if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
    }
    fwd.normalize();
    this.right.crossVectors(fwd, up);
  }

  /** Rotate the heading about ship up by `angle` radians (positive = counter-clockwise from above = left). */
  private yaw(angle: number): void {
    if (angle === 0) return;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    this.tmpY.crossVectors(this.up, this.fwd);
    this.fwd.multiplyScalar(c).addScaledVector(this.tmpY, sn).normalize();
  }

  /** Orientation quaternion for the current (right, up, -forward) basis. */
  private buildQuaternion(out: THREE.Quaternion): void {
    this.tmpZ.copy(this.fwd).negate();
    this.basis.makeBasis(this.right, this.up, this.tmpZ);
    out.setFromRotationMatrix(this.basis);
  }

  private frameFromQuaternion(q: THREE.Quaternion): void {
    this.up.set(0, 1, 0).applyQuaternion(q);
    this.fwd.set(0, 0, -1).applyQuaternion(q);
    this.right.crossVectors(this.fwd, this.up);
  }

  /** Refresh the cached track projection (u, lateral, height) and the local track frame. */
  private refreshProjection(): void {
    const s = this.state;
    const p = this.track.project(s.position, s.trackU, s.path);
    s.trackU = p.u;
    s.path = p.path;
    s.pathS = p.pathS ?? 0;
    s.lateral = p.lateral;
    s.heightAboveTrack = p.height;
    // Inside a pipe the surface normal turns with the curled deck (toward the tube's axis).
    this.sampleUp.copy(p.surfaceUp ?? p.sample.up);
    this.sampleFwd.copy(p.sample.forward);
    this.sampleRight.copy(p.sample.right);
    this.sampleHalfWidth = p.sample.halfWidth;
    const rates = twistRates(this.track);
    // Branches never twist (no corkscrews on split paths).
    this.twistRate = p.path ? 0 : rates[Math.round(p.u * rates.length) % rates.length];
    this.hasProjection = true;
  }

  /** Dash plates and pit strip. */
  private updateZones(dt: number): void {
    const s = this.state;
    let dash = false;
    let pit = false;
    // Dash plates and the pit are on the main loop only.
    if (isActiveStatus(s.status) && s.heightAboveTrack < TUNING.ZONE_MAX_HEIGHT && s.path === null) {
      const zones = this.track.zones;
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        if (z.type !== 'dash' && z.type !== 'pit') continue;
        if (s.lateral < z.lateralMin || s.lateral > z.lateralMax) continue;
        if (!inLoopRange(s.trackU, z.uStart, z.uEnd)) continue;
        if (z.type === 'dash') dash = true;
        else pit = true;
      }
    }

    if (dash && !s.onDash) {
      s.velocity.addScaledVector(this.fwd, CONFIG.DASH_IMPULSE);
      this.body.setLinvel(s.velocity, true);
      this.updateSpeeds();
      this.bus.emit('ship:dash', { shipId: s.def.id });
    }
    s.onDash = dash;

    if (pit && s.energy < this.stats.energyMax) {
      s.energy = Math.min(this.stats.energyMax, s.energy + CONFIG.PIT_RECHARGE_RATE * dt);
    }
    if (pit !== s.inPit) {
      s.inPit = pit;
      this.bus.emit('ship:pit', { shipId: s.def.id, active: pit });
    }
    if (s.energy >= this.lowEnergyLevel) this.lowEnergyFired = false;
  }

  /** −1 / +1 (push toward lower / higher lateral, scaled 0..1) near the top seam of an opening pipe, else 0. */
  private seamGuard(): number {
    const pipes = this.track.pipes;
    const s = this.state;
    if (pipes.length === 0 || !this.hasProjection || s.path !== null) return 0;
    const lead = TUNING.SEAM_GUARD_LEAD / this.track.length;
    for (const p of pipes) {
      if (!inLoopRange(s.trackU, p.uClosedEnd - lead, p.uEnd)) continue;
      const w = this.sampleHalfWidth;
      const k = clamp01((Math.abs(s.lateral) - (w - TUNING.SEAM_GUARD_BAND)) / TUNING.SEAM_GUARD_BAND);
      return -Math.sign(s.lateral) * k;
    }
    return 0;
  }

  /** Surface grip under the hull (ice patches) and the ship:ice edge events. */
  private updateSurface(): void {
    const s = this.state;
    const near = s.heightAboveTrack < TUNING.ZONE_MAX_HEIGHT && !this.jumping;
    this.surfaceGrip = near ? this.track.gripAt(s.trackU, s.lateral, s.path) : 1;
    const ice = near && this.surfaceGrip < 1 && isActiveStatus(s.status);
    if (ice !== this.onIce) {
      this.onIce = ice;
      this.bus.emit('ship:ice', { shipId: s.def.id, active: ice });
    }
  }

  /** Teleport onto the centerline at the last valid u, facing forward, at a fraction of the old speed. */
  private respawn(nonFinite: boolean): void {
    const s = this.state;
    // A ship that came off a split path goes back onto it, where it left the deck.
    const branch = this.lastValidPath ? this.track.branches.find((b) => b.id === this.lastValidPath) : undefined;
    // Near a jump the ship comes back on the landing side (a slow restart before the ramp would miss again).
    if (!branch) this.lastValidU = this.track.safeRespawnU(this.lastValidU);
    const smp = branch ? branch.sampleAt(this.lastValidS) : this.track.sampleAt(this.lastValidU);
    const oldForward = nonFinite || !Number.isFinite(s.forwardSpeed) ? 0 : Math.max(s.forwardSpeed, 0);

    this.up.copy(smp.up);
    this.fwd.copy(smp.forward);
    this.orthonormalizeHeading();
    this.buildQuaternion(s.quaternion);

    s.position.copy(smp.position).addScaledVector(this.up, CONFIG.HOVER_HEIGHT);
    s.prevPosition.copy(s.position);
    s.prevQuaternion.copy(s.quaternion);
    s.velocity.copy(this.fwd).multiplyScalar(oldForward * TUNING.RESPAWN_SPEED_FACTOR);
    s.bank = 0;
    s.grounded = true;
    s.onDash = false;
    s.airborne = false;
    this.jumping = false;
    this.preVel.copy(s.velocity);
    this.railContact = false;
    this.invalidTime = 0;

    this.body.setTranslation(s.position, true);
    this.body.setRotation(s.quaternion, true);
    this.body.setLinvel(s.velocity, true);
    this.updateSpeeds();

    s.trackU = branch ? branch.progressU(this.lastValidS) : this.lastValidU;
    s.path = branch ? branch.id : null;
    this.refreshProjection();
    this.bus.emit('ship:respawn', { shipId: s.def.id });
  }

  /** Reduce energy (never below 0) and emit ship:lowEnergy once when crossing the threshold. */
  private drainEnergy(amount: number): void {
    if (!(amount > 0)) return;
    const s = this.state;
    s.energy = Math.max(0, s.energy - amount);
    if (!this.lowEnergyFired && s.energy < this.lowEnergyLevel) {
      this.lowEnergyFired = true;
      this.bus.emit('ship:lowEnergy', { shipId: s.def.id });
    }
  }
}

const twistCache = new WeakMap<TrackData, Float32Array>();

/** Per-sample twist rate d(roll)/ds in rad/m (central difference, wrap-safe), cached per track. */
function twistRates(track: TrackData): Float32Array {
  let rates = twistCache.get(track);
  if (rates) return rates;
  const smp = track.samples;
  const n = smp.length;
  rates = new Float32Array(n);
  const ds = track.length / n;
  for (let i = 0; i < n; i++) {
    const a = smp[(i - 1 + n) % n].roll;
    const b = smp[(i + 1) % n].roll;
    rates[i] = wrapAngle(b - a) / (2 * ds);
  }
  twistCache.set(track, rates);
  return rates;
}
