import { Vector3 } from 'three';
import { CONFIG } from '../core/config';
import type {
  AIPersonality,
  ControlInput,
  IAIDriver,
  ShipId,
  ShipState,
  TrackData,
  TrackSample,
  TrackZone,
} from '../core/contracts';
import { neutralControls } from '../core/controls';
import { clamp, damp, inLoopRange, loopDelta, wrap01, wrapAngle } from '../core/math';
import { Rng } from '../core/rng';

/** Per-personality tuning. Everything the drivers differ in lives here. */
interface Profile {
  /** Lateral acceleration budget (m/s²) for v_safe = sqrt(budget / |κ|). */
  latBudget: number;
  /** Fraction of the physical yaw-rate limit the driver is willing to use. */
  yawFactor: number;
  /** Deceleration (m/s²) the driver assumes when planning braking. */
  brakeDecel: number;
  /** Speed excess (m/s) over the planned speed tolerated before braking. */
  overspeedTol: number;
  /** Energy above which a boost may be fired (NaN = re-rolled randomly per boost). */
  boostEnergy: number;
  /** Minimum seconds between boosts. */
  boostCooldown: number;
  /** Energy below which the driver heads for the pit. */
  pitEnergy: number;
  /** Amplitude (m) of the static lane bias. */
  laneBias: number;
  /** Multiplier on the steering look-ahead. */
  lookScale: number;
}

const PROFILES: Record<AIPersonality, Profile> = {
  aggressive: {
    latBudget: 112,
    yawFactor: 0.94,
    brakeDecel: 62,
    overspeedTol: 7,
    boostEnergy: 35,
    boostCooldown: 1.6,
    pitEnergy: 34,
    laneBias: 1.5,
    lookScale: 0.95,
  },
  steady: {
    latBudget: 82,
    yawFactor: 0.78,
    brakeDecel: 40,
    overspeedTol: 2,
    boostEnergy: 55,
    boostCooldown: 3.5,
    pitEnergy: 42,
    laneBias: 1.0,
    lookScale: 1.05,
  },
  erratic: {
    latBudget: 96,
    yawFactor: 0.86,
    brakeDecel: 50,
    overspeedTol: 4,
    boostEnergy: Number.NaN,
    boostCooldown: 2.2,
    pitEnergy: 38,
    laneBias: 0,
    lookScale: 1,
  },
};

// --- geometry / control constants ---
const MIN_LOOKAHEAD = 25;
const SCAN_RANGE = 260; // m scanned for braking
const SCAN_STEP = 12; // m between curvature reads
const LINE_SCAN = 150; // m scanned for the racing line
const CURV_REF = 0.006; // 1/m at which the line goes fully to the inside
const RAIL_MARGIN = 3; // m kept from the rail centreline-side edge
const STEER_KP = 2.2;
const STEER_KD = 0.16;
const STEER_SLEW = 9; // 1/s max change of the steer command
const LATERAL_RATE = 4.5; // 1/s smoothing of the target lateral

const AVOID_AHEAD = 15; // m
const AVOID_BEHIND = 3; // m
const AVOID_LANE = 4.2; // m lateral overlap that triggers avoidance
const AVOID_OFFSET = 4.6; // m beside the rival we aim for
const AVOID_HOLD = 1.2; // s the chosen side is kept

const BOOST_STRAIGHT_CURV = 0.0028; // max |κ| allowed over the boost scan
const BOOST_STRAIGHT_LEN = 200; // m
const BOOST_MAX_STEER = 0.3;

const PIT_APPROACH = 400; // m
const PIT_FULL_ENERGY = 95;
const PIT_SPEED = 58; // m/s inside the pit lane while recharging

export class AIDriver implements IAIDriver {
  readonly shipId: ShipId;

  private readonly ship: ShipState;
  private readonly track: TrackData;
  private readonly profile: Profile;
  private readonly personality: AIPersonality;
  private readonly rivals: readonly ShipState[];
  private readonly rng: Rng;
  private readonly length: number;
  private readonly count: number;
  private readonly pitZone: TrackZone | null;

  private readonly out: ControlInput = neutralControls();
  private readonly sample: TrackSample;
  private readonly fwd = new Vector3();
  private readonly up = new Vector3();
  private readonly toTarget = new Vector3();
  private readonly cross = new Vector3();

  private time = 0;
  private tLat = 0;
  private steer = 0;
  private prevAngle = 0;
  private dAngle = 0;
  private hasPrev = false;

  // static personality flavour
  private readonly laneOffset: number;
  private readonly phaseA: number;
  private readonly phaseB: number;
  private noise = 0;

  // avoidance
  private avoidSide = 0;
  private avoidUntil = 0;

  // boost
  private boostReadyAt = 0;
  private boostEnergy: number;

  // pit
  private pitMode = false;
  private pitWasInside = false;

  // erratic mistakes
  private nextMistake: number;
  private mistakeKind: 'none' | 'lift' | 'rail' = 'none';
  private mistakeUntil = 0;
  private mistakeSide = 1;

  constructor(ship: ShipState, track: TrackData, personality: AIPersonality, rngSeed: number, rivals: readonly ShipState[] = []) {
    this.shipId = ship.def.id;
    this.ship = ship;
    this.track = track;
    this.personality = personality;
    this.profile = PROFILES[personality];
    this.rivals = rivals;
    this.rng = new Rng(rngSeed);
    this.length = track.length;
    this.count = track.samples.length;
    this.pitZone = track.zones.find((z) => z.type === 'pit') ?? null;

    const s0 = track.samples[0];
    this.sample = {
      u: 0,
      distance: 0,
      position: new Vector3().copy(s0.position),
      forward: new Vector3().copy(s0.forward),
      up: new Vector3().copy(s0.up),
      right: new Vector3().copy(s0.right),
      roll: 0,
      curvature: 0,
      halfWidth: s0.halfWidth,
    };

    this.laneOffset = this.rng.range(-1, 1) * this.profile.laneBias;
    this.phaseA = this.rng.range(0, Math.PI * 2);
    this.phaseB = this.rng.range(0, Math.PI * 2);
    this.boostEnergy = this.rollBoostEnergy();
    this.nextMistake = this.rng.range(6, 12);
    this.tLat = ship.lateral;
  }

  update(dt: number): ControlInput {
    const out = this.out;
    const ship = this.ship;
    out.boost = false;
    if (dt <= 0) return out;

    if (ship.status === 'grid' || ship.status === 'retired') {
      out.throttle = 0;
      out.brake = 0;
      out.steer = 0;
      out.airbrakeLeft = 0;
      out.airbrakeRight = 0;
      this.hasPrev = false;
      this.steer = 0;
      return out;
    }

    this.time += dt;
    const p = this.profile;
    const halfWidth = this.track.halfWidth;
    const maxLat = halfWidth - RAIL_MARGIN;

    // --- ship frame ---
    this.fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    const speed = Math.max(ship.speed, 0);
    const u = ship.trackU;

    // --- look-ahead distance & racing line ---
    const look = Math.max(MIN_LOOKAHEAD, (CONFIG.AI_LOOKAHEAD_BASE + speed * CONFIG.AI_LOOKAHEAD_K) * p.lookScale);
    const targetU = u + look / this.length;

    let kMaxLine = 0;
    let kSteerSum = 0;
    let kSteerN = 0;
    let kFarSum = 0;
    let kFarN = 0;
    for (let d = 0; d <= LINE_SCAN + look; d += SCAN_STEP) {
      const k = this.curvatureAt(u, d);
      if (d >= look * 0.4 && d <= look * 1.4) {
        kSteerSum += k;
        kSteerN++;
      }
      if (d >= look && d <= look + 100) {
        kFarSum += k;
        kFarN++;
      }
      const ak = Math.abs(k);
      if (d <= LINE_SCAN && ak > kMaxLine) kMaxLine = ak;
    }
    const kSteer = kSteerN > 0 ? kSteerSum / kSteerN : 0;
    const kFar = kFarN > 0 ? kFarSum / kFarN : 0;
    const inside = clamp(kSteer / CURV_REF, -1, 1);
    const setup = clamp(kFar / CURV_REF, -1, 1);
    let lineLat = maxLat * (0.8 * inside - 0.4 * setup * (1 - Math.abs(inside)));

    // The corkscrew is driven dead centre; the frame there rolls a full turn.
    const cork = this.track.corkscrew;
    const corkPad = 60 / this.length;
    const inCork = inLoopRange(wrap01(targetU), wrap01(cork.uStart - corkPad), wrap01(cork.uEnd + corkPad));
    if (inCork) lineLat *= 0.15;

    // --- personality flavour ---
    let bias = 0;
    if (!inCork) {
      if (this.personality === 'erratic') {
        this.noise += -this.noise * 1.5 * dt + 0.9 * Math.sqrt(dt) * this.rng.gaussian();
        bias = 3.4 * Math.sin(this.time * 0.6 + this.phaseA) + 1.4 * Math.sin(this.time * 1.7 + this.phaseB) + 2 * this.noise;
      } else if (this.personality === 'steady') {
        bias = this.laneOffset + 0.8 * Math.sin(this.time * 0.13 + this.phaseA);
      } else {
        bias = this.laneOffset;
      }
    }
    let desired = lineLat + bias;

    // --- erratic mistakes ---
    let throttleCap = 1;
    if (this.personality === 'erratic') {
      if (this.mistakeKind === 'none' && this.time >= this.nextMistake && !inCork) {
        const roll = this.rng.next();
        if (roll < 0.45) {
          this.mistakeKind = 'lift';
          this.mistakeUntil = this.time + this.rng.range(0.35, 0.9);
        } else if (kMaxLine < 0.002) {
          this.mistakeKind = 'rail';
          this.mistakeUntil = this.time + this.rng.range(0.9, 1.5);
          this.mistakeSide = this.rng.next() < 0.5 ? -1 : 1;
        } else {
          this.nextMistake = this.time + 1.5;
        }
      }
      if (this.mistakeKind !== 'none') {
        if (this.time >= this.mistakeUntil) {
          this.mistakeKind = 'none';
          this.nextMistake = this.time + this.rng.range(6, 15);
        } else if (this.mistakeKind === 'lift') {
          throttleCap = 0.12;
        } else {
          desired = this.mistakeSide * (halfWidth - 1.9);
        }
      }
    }

    // --- rival avoidance / ramming ---
    let ram = false;
    if (this.mistakeKind !== 'rail') {
      let nearest: ShipState | null = null;
      let nearestDm = Infinity;
      for (const r of this.rivals) {
        if (r.def.id === this.shipId || r.status !== 'racing') continue;
        const dm = loopDelta(u, r.trackU) * this.length;
        if (dm < -AVOID_BEHIND || dm > AVOID_AHEAD) continue;
        if (Math.abs(r.lateral - ship.lateral) > AVOID_LANE) continue;
        if (dm < nearestDm) {
          nearestDm = dm;
          nearest = r;
        }
      }
      if (nearest) {
        if (this.personality === 'aggressive' && ship.energy > nearest.energy + 5) {
          desired = nearest.lateral;
          ram = true;
        } else {
          if (this.time >= this.avoidUntil || this.avoidSide === 0) {
            this.avoidSide = maxLat - nearest.lateral > nearest.lateral + maxLat ? 1 : -1;
            this.avoidUntil = this.time + AVOID_HOLD;
          }
          desired = nearest.lateral + this.avoidSide * AVOID_OFFSET;
        }
      } else if (this.time >= this.avoidUntil) {
        this.avoidSide = 0;
      }
    }

    // --- pit ---
    this.updatePit(u, ship);
    let pitSlow = false;
    if (this.pitMode && this.pitZone) {
      desired = (this.pitZone.lateralMin + this.pitZone.lateralMax) * 0.5;
      pitSlow = inLoopRange(u, this.pitZone.uStart, this.pitZone.uEnd) && ship.energy < PIT_FULL_ENERGY - 3;
      ram = false;
    }

    const limit = this.mistakeKind === 'rail' ? halfWidth - 1.6 : maxLat;
    desired = clamp(desired, this.pitMode ? -halfWidth + 1.5 : -limit, this.pitMode ? halfWidth - 1.5 : limit);
    this.tLat = damp(this.tLat, desired, ram ? LATERAL_RATE * 1.6 : LATERAL_RATE, dt);

    // --- steering: PD on the signed angle to the target point, in the ship's plane ---
    const ts = this.track.sampleAt(targetU, this.sample);
    this.toTarget.copy(ts.position).addScaledVector(ts.right, this.tLat).sub(ship.position);
    this.toTarget.addScaledVector(this.up, -this.toTarget.dot(this.up));
    // fwd × target · up is negative when the target lies to the right (fwd = -Z, up = +Y, right = +X)
    this.cross.crossVectors(this.fwd, this.toTarget);
    const angle = Math.atan2(-this.cross.dot(this.up), this.fwd.dot(this.toTarget));

    if (this.hasPrev) {
      const raw = wrapAngle(angle - this.prevAngle) / dt;
      this.dAngle = damp(this.dAngle, clamp(raw, -4, 4), 30, dt);
    } else {
      this.dAngle = 0;
      this.hasPrev = true;
    }
    this.prevAngle = angle;

    const wanted = clamp(STEER_KP * angle + STEER_KD * this.dAngle, -1, 1);
    const maxStep = STEER_SLEW * dt;
    this.steer += clamp(wanted - this.steer, -maxStep, maxStep);
    out.steer = this.steer;

    // --- speed control ---
    let vTarget: number = CONFIG.BOOST_TOP_SPEED;
    for (let d = 0; d <= SCAN_RANGE; d += SCAN_STEP) {
      const ak = Math.abs(this.curvatureAt(u, d));
      if (ak < 1e-5) continue;
      const vSafe = this.safeSpeed(ak);
      const vAllowed = Math.sqrt(vSafe * vSafe + 2 * p.brakeDecel * d);
      if (vAllowed < vTarget) vTarget = vAllowed;
    }
    if (pitSlow) vTarget = Math.min(vTarget, PIT_SPEED);

    const over = speed - vTarget;
    let throttle = over > 0 ? clamp(1 - over / 6, 0, 1) : 1;
    let brake = 0;
    let airL = 0;
    let airR = 0;
    if (over > p.overspeedTol) {
      brake = clamp(0.2 + (over - p.overspeedTol) / 14, 0, 1);
      if (over > p.overspeedTol + 8 && Math.abs(this.steer) > 0.5) {
        const a = clamp(0.35 + over / 45, 0, 1);
        if (this.steer > 0) airR = a;
        else airL = a;
      }
    }
    // Badly misaligned (sliding / spun): shed speed and swing round.
    const absAngle = Math.abs(angle);
    if (absAngle > 0.6) throttle = Math.min(throttle, clamp(1.4 - absAngle, 0.25, 1));
    throttle = Math.min(throttle, throttleCap);
    if (throttleCap < 1) brake = 0;

    out.throttle = throttle;
    out.brake = brake;
    out.airbrakeLeft = airL;
    out.airbrakeRight = airR;

    // --- boost (edge-triggered) ---
    if (this.shouldBoost(kMaxLine, u)) {
      out.boost = true;
      this.boostReadyAt = this.time + p.boostCooldown;
      this.boostEnergy = this.rollBoostEnergy();
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------

  private rollBoostEnergy(): number {
    return Number.isNaN(this.profile.boostEnergy) ? this.rng.range(30, 70) : this.profile.boostEnergy;
  }

  /** Signed curvature `d` metres ahead of u. */
  private curvatureAt(u: number, d: number): number {
    const idx = Math.floor(wrap01(u + d / this.length) * this.count) % this.count;
    return this.track.samples[idx].curvature;
  }

  /** Highest speed at which a curve of curvature |κ| is considered safe. */
  private safeSpeed(absK: number): number {
    const p = this.profile;
    const vBudget = Math.sqrt(p.latBudget / absK);
    // Steering is yaw-rate limited: v·κ ≤ yawFactor·ω(v), ω falling linearly with speed.
    const slope = (CONFIG.STEER_RATE - CONFIG.STEER_RATE_HIGH_SPEED) / CONFIG.TOP_SPEED;
    const vYaw = (p.yawFactor * CONFIG.STEER_RATE) / (absK + p.yawFactor * slope);
    return Math.max(25, Math.min(vBudget, vYaw));
  }

  private shouldBoost(kMaxLine: number, u: number): boolean {
    const ship = this.ship;
    if (!ship.boostUnlocked || ship.boosting || ship.status !== 'racing') return false;
    if (this.pitMode || this.time < this.boostReadyAt) return false;
    if (ship.energy < this.boostEnergy || ship.energy <= CONFIG.BOOST_COST + 6) return false;
    if (Math.abs(this.steer) > BOOST_MAX_STEER) return false;
    if (kMaxLine > BOOST_STRAIGHT_CURV) return false;
    // low curvature must extend the full boost scan distance (LINE_SCAN may be shorter)
    for (let d = LINE_SCAN; d <= BOOST_STRAIGHT_LEN; d += SCAN_STEP) {
      if (Math.abs(this.curvatureAt(u, d)) > BOOST_STRAIGHT_CURV) return false;
    }
    return true;
  }

  private updatePit(u: number, ship: ShipState): void {
    const zone = this.pitZone;
    if (!zone) return;
    const inside = inLoopRange(u, zone.uStart, zone.uEnd);
    const distToStart = wrap01(zone.uStart - u) * this.length;
    if (!this.pitMode) {
      if (ship.energy < this.profile.pitEnergy && (inside || distToStart <= PIT_APPROACH)) {
        this.pitMode = true;
        this.pitWasInside = inside;
      }
      return;
    }
    if (inside) this.pitWasInside = true;
    const passed = this.pitWasInside && !inside;
    const missed = !inside && !this.pitWasInside && distToStart > PIT_APPROACH * 1.5;
    if (ship.energy >= PIT_FULL_ENERGY || passed || missed) {
      this.pitMode = false;
      this.pitWasInside = false;
    }
  }
}
