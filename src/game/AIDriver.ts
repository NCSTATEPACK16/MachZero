import { Vector3 } from 'three';
import { CONFIG } from '../core/config';
import type {
  AIPersonality,
  ControlInput,
  IAIDriver,
  ShipId,
  ShipState,
  TrackData,
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

const ICE_LOOKAHEAD = 140; // m of track scanned for ice patches to steer around
const ICE_MARGIN = 2.5; // m kept from a patch's edge when going round it
const ICE_GRIP_PLAN = 0.5; // lateral budget multiplier the driver assumes for curves on ice
const ICE_LATERAL_RATE = 1.5; // 1/s target-lateral smoothing on ice (hold a straight line)
const PIPE_MAX_LAT = 9; // m: lines inside a pipe stay well off the top seam

const PIT_APPROACH = 400; // m
const JUMP_APPROACH = 160; // m before a jump lip where the line straightens toward the centre
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
  /** u ranges (padded) driven near the centreline: corkscrews and jump approaches/gaps. */
  private readonly centreRanges: [number, number][];
  /** Ice patches in metres. */
  private readonly ice: { dStart: number; dEnd: number; lateralMin: number; lateralMax: number }[];

  private readonly out: ControlInput = neutralControls();
  private readonly fwd = new Vector3();
  private readonly up = new Vector3();
  private readonly toTarget = new Vector3();
  private readonly targetPoint = new Vector3();
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
    const L = track.length;
    const corks = track.features.flatMap((f) => (f.type === 'corkscrew' ? [[f.dStart / L, f.dEnd / L] as [number, number]] : []));
    if (corks.length === 0 && track.corkscrew) corks.push([track.corkscrew.uStart, track.corkscrew.uEnd]);
    const pad = 60 / L;
    this.centreRanges = [
      ...corks.map(([a, b]): [number, number] => [wrap01(a - pad), wrap01(b + pad)]),
      ...track.jumps.map((j): [number, number] => [wrap01((j.dTakeoff - JUMP_APPROACH) / L), wrap01((j.dLanding + 30) / L)]),
    ];

    this.ice = track.features.flatMap((f) => (f.type === 'ice' ? [f] : []));


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

    // Corkscrews and jumps are driven near the centre: the frame rolls a full turn / the rails end.
    const inCork = this.inCentreSection(wrap01(targetU));
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
    // Inside a pipe the line stays off the top seam (it opens again at the exit).
    const inPipe = this.inPipe(u) || this.inPipe(wrap01(targetU));
    if (inPipe) desired = clamp(desired, -PIPE_MAX_LAT, PIPE_MAX_LAT);
    // Ice ahead that leaves room beside it: go round it.
    desired = this.avoidIce(u, desired, maxLat);
    const onIce = this.track.surfaceKindAt(u, ship.lateral) === 'ice';

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
            // Stay on the side of the rival we're already on (crossing its line grinds both hulls);
            // switch only when that side has no room to the rail.
            const mySide = ship.lateral >= nearest.lateral ? 1 : -1;
            const room = mySide > 0 ? maxLat - nearest.lateral : nearest.lateral + maxLat;
            this.avoidSide = room >= AVOID_OFFSET ? mySide : -mySide;
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
      pitSlow = inLoopRange(u, this.pitZone.uStart, this.pitZone.uEnd) && this.energyPct < PIT_FULL_ENERGY - 3;
      ram = false;
    }

    const limit = this.mistakeKind === 'rail' ? halfWidth - 1.6 : maxLat;
    desired = clamp(desired, this.pitMode ? -halfWidth + 1.5 : -limit, this.pitMode ? halfWidth - 1.5 : limit);
    this.tLat = damp(this.tLat, desired, onIce ? ICE_LATERAL_RATE : ram ? LATERAL_RATE * 1.6 : LATERAL_RATE, dt);

    // --- steering: PD on the signed angle to the target point, in the ship's plane ---
    // The aim point lies on the driving surface (inside a pipe that is on the curled tube wall).
    this.track.surfacePoint(targetU, this.tLat, this.targetPoint);
    this.toTarget.copy(this.targetPoint).sub(ship.position);
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
    let vTarget: number = this.ship.def.stats.boostTopSpeed;
    for (let d = 0; d <= SCAN_RANGE; d += SCAN_STEP) {
      const ak = Math.abs(this.curvatureAt(u, d));
      if (ak < 1e-5) continue;
      // Curves on ice are taken with the grip the driver expects there: brake earlier.
      const vSafe = this.safeSpeed(ak) * (this.iceAt(u, d, this.tLat) ? Math.sqrt(ICE_GRIP_PLAN) : 1);
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

  private inPipe(u: number): boolean {
    for (const p of this.track.pipes) if (inLoopRange(u, p.uStart, p.uEnd)) return true;
    return false;
  }

  /** An ice patch covers lateral `lat` at `d` metres ahead of u. */
  private iceAt(u: number, d: number, lat: number): boolean {
    if (this.ice.length === 0) return false;
    const m = wrap01(u + d / this.length) * this.length;
    for (const z of this.ice) if (m >= z.dStart && m <= z.dEnd && lat >= z.lateralMin - 1 && lat <= z.lateralMax + 1) return true;
    return false;
  }

  /** Move `desired` off any ice patch in the next ICE_LOOKAHEAD metres that leaves a lane beside it. */
  private avoidIce(u: number, desired: number, maxLat: number): number {
    if (this.ice.length === 0) return desired;
    const here = wrap01(u) * this.length;
    for (const z of this.ice) {
      const ahead = (((z.dStart - here) % this.length) + this.length) % this.length;
      const inside = here >= z.dStart && here <= z.dEnd;
      if (!inside && ahead > ICE_LOOKAHEAD) continue;
      const lo = z.lateralMin - ICE_MARGIN;
      const hi = z.lateralMax + ICE_MARGIN;
      if (desired <= lo || desired >= hi) continue;
      const roomLeft = lo >= -maxLat;
      const roomRight = hi <= maxLat;
      if (!roomLeft && !roomRight) continue;
      if (roomLeft && (!roomRight || desired - lo < hi - desired)) return lo;
      return hi;
    }
    return desired;
  }

  private inCentreSection(u: number): boolean {
    for (const [a, b] of this.centreRanges) if (inLoopRange(u, a, b)) return true;
    return false;
  }

  private rollBoostEnergy(): number {
    return Number.isNaN(this.profile.boostEnergy) ? this.rng.range(30, 70) : this.profile.boostEnergy;
  }

  /** Signed curvature `d` metres ahead of u. */
  private curvatureAt(u: number, d: number): number {
    const idx = Math.floor(wrap01(u + d / this.length) * this.count) % this.count;
    return this.track.samples[idx].curvature;
  }

  /** Energy as a percentage of this ship's max (thresholds are tuned on v1's 0..100 scale). */
  private get energyPct(): number {
    return (this.ship.energy / this.ship.def.stats.energyMax) * 100;
  }

  /** Highest speed at which a curve of curvature |κ| is considered safe. */
  private safeSpeed(absK: number): number {
    const p = this.profile;
    const vBudget = Math.sqrt(p.latBudget / absK);
    // Steering is yaw-rate limited: v·κ ≤ yawFactor·ω(v), ω falling linearly with speed.
    const st = this.ship.def.stats;
    const slope = (st.steerRate - st.steerRateHighSpeed) / st.topSpeed;
    const vYaw = (p.yawFactor * st.steerRate) / (absK + p.yawFactor * slope);
    return Math.max(25, Math.min(vBudget, vYaw));
  }

  private shouldBoost(kMaxLine: number, u: number): boolean {
    const ship = this.ship;
    if (!ship.boostUnlocked || ship.boosting || ship.status !== 'racing') return false;
    if (this.pitMode || this.time < this.boostReadyAt) return false;
    if (this.energyPct < this.boostEnergy || ship.energy <= ship.def.stats.boostCost + 6) return false;
    // Keep a reserve: never boost below the pit threshold unless the pit is close enough to reach.
    const after = ((ship.energy - ship.def.stats.boostCost) / ship.def.stats.energyMax) * 100;
    if (after < this.profile.pitEnergy && !this.pitWithinReach(u)) return false;
    if (Math.abs(this.steer) > BOOST_MAX_STEER) return false;
    if (kMaxLine > BOOST_STRAIGHT_CURV) return false;
    // low curvature must extend the full boost scan distance (LINE_SCAN may be shorter)
    for (let d = LINE_SCAN; d <= BOOST_STRAIGHT_LEN; d += SCAN_STEP) {
      if (Math.abs(this.curvatureAt(u, d)) > BOOST_STRAIGHT_CURV) return false;
    }
    return true;
  }

  /** The pit strip starts within PIT_APPROACH metres ahead (or we're on it). */
  private pitWithinReach(u: number): boolean {
    const zone = this.pitZone;
    if (!zone) return true;
    return inLoopRange(u, zone.uStart, zone.uEnd) || wrap01(zone.uStart - u) * this.length <= PIT_APPROACH;
  }

  private updatePit(u: number, ship: ShipState): void {
    const zone = this.pitZone;
    if (!zone) return;
    const inside = inLoopRange(u, zone.uStart, zone.uEnd);
    const distToStart = wrap01(zone.uStart - u) * this.length;
    const energyPct = (ship.energy / ship.def.stats.energyMax) * 100;
    if (!this.pitMode) {
      if (energyPct < this.profile.pitEnergy && (inside || distToStart <= PIT_APPROACH)) {
        this.pitMode = true;
        this.pitWasInside = inside;
      }
      return;
    }
    if (inside) this.pitWasInside = true;
    const passed = this.pitWasInside && !inside;
    const missed = !inside && !this.pitWasInside && distToStart > PIT_APPROACH * 1.5;
    if (energyPct >= PIT_FULL_ENERGY || passed || missed) {
      this.pitMode = false;
      this.pitWasInside = false;
    }
  }
}
