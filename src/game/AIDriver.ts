import { Vector3 } from 'three';
import { CONFIG } from '../core/config';
import type {
  AIPersonality,
  AITier,
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
import { TrackRoute } from '../track/TrackRoute';

/**
 * Chance of taking a split path's shortcut on each approach, by tier (SPEC: Rookie never, Pilot ≈ 30%, Ace ≈ 60%,
 * Legend always unless its gate will be closed). PIXEL (erratic) flips a coin; aggressive pilots lean toward it.
 * M5's tier tuning replaces this table.
 */
const SHORTCUT_ODDS: Record<AITier, number> = { rookie: 0, pilot: 0.3, ace: 0.6, legend: 1 };
const SHORTCUT_AGGRESSIVE_LEAN = 0.2;
/** Metres before a fork where the route for that approach is chosen. */
const ROUTE_DECIDE = 300;
/** Metres before a fork over which a driver taking the shortcut moves to its side of the road. */
const FORK_APPROACH = 160;

export function shortcutOdds(tier: AITier, personality: AIPersonality): number {
  const base = SHORTCUT_ODDS[tier];
  if (base === 0 || base === 1) return base;
  if (personality === 'erratic') return 0.5;
  return Math.min(1, base + (personality === 'aggressive' ? SHORTCUT_AGGRESSIVE_LEAN : 0));
}

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
  private readonly pitZone: TrackZone | null;
  /** u ranges (padded) driven near the centreline: corkscrews and jump approaches/gaps. */
  private readonly centreRanges: [number, number][];
  /** Ice patches in metres. */
  private readonly ice: { dStart: number; dEnd: number; lateralMin: number; lateralMax: number }[];
  /** The main loop, and one shortcut route per split path. */
  private readonly mainRoute: TrackRoute;
  private readonly shortcuts: TrackRoute[];
  private readonly odds: number;
  /** The road this driver means to take; R ahead of the ship is measured along it. */
  private route: TrackRoute;
  /** Branch ids whose route has been chosen for the current approach. */
  private readonly decided = new Set<string>();
  /** Route metres of last step's aim point (to carry tLat across a change of road). */
  private prevTargetR = Number.NaN;

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
    this.mainRoute = new TrackRoute(track);
    this.shortcuts = track.branches.map((b) => new TrackRoute(track, b));
    this.route = this.mainRoute;

    this.laneOffset = this.rng.range(-1, 1) * this.profile.laneBias;
    this.phaseA = this.rng.range(0, Math.PI * 2);
    this.phaseB = this.rng.range(0, Math.PI * 2);
    this.boostEnergy = this.rollBoostEnergy();
    this.nextMistake = this.rng.range(6, 12);
    this.tLat = ship.lateral;
    // Before M5 the tier is the race's (rival parts fit); rolls come from a separate stream so adding split paths
    // does not change the AI's other random choices on tracks without them.
    this.odds = shortcutOdds(ship.def.tier ?? 'rookie', personality);
    this.routeRng = new Rng(rngSeed ^ 0x5eed);
  }

  private readonly routeRng: Rng;

  /** The route currently planned (for tests and debugging). */
  get plannedPath(): string | null {
    return this.route.branch?.id ?? null;
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

    // --- ship frame ---
    this.fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    const speed = Math.max(ship.speed, 0);
    const u = ship.trackU;

    // --- route: the road ahead, in route metres (main loop, or through a shortcut) ---
    this.updateRoute(ship);
    const route = this.route;
    const R = route.shipR(ship.path, u, ship.pathS);

    // --- look-ahead distance & racing line ---
    const look = Math.max(MIN_LOOKAHEAD, (CONFIG.AI_LOOKAHEAD_BASE + speed * CONFIG.AI_LOOKAHEAD_K) * p.lookScale);
    const targetR = route.wrap(R + look);
    // Main-loop u at the aim point (null on a split path: no main-loop features there).
    const targetMainU = route.mainUAt(targetR);
    const halfWidth = route.halfWidthAt(targetR);
    const maxLat = halfWidth - RAIL_MARGIN;
    // Carry the target lateral across a change of road (fork / merge) on the route.
    if (!Number.isNaN(this.prevTargetR)) {
      const span = route.wrap(targetR - this.prevTargetR);
      if (span < route.length / 2) this.tLat += route.lateralShift(this.prevTargetR, this.prevTargetR + span);
    }
    this.prevTargetR = targetR;

    let kMaxLine = 0;
    let kSteerSum = 0;
    let kSteerN = 0;
    let kFarSum = 0;
    let kFarN = 0;
    for (let d = 0; d <= LINE_SCAN + look; d += SCAN_STEP) {
      const k = this.curvatureAt(R, d);
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
    const inCork = targetMainU !== null && this.inCentreSection(targetMainU);
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
    // Taking a shortcut: over the last metres before its fork, move to its side of the road.
    if (route.branch && route.pathAt(targetR) === null && route.length - targetR < FORK_APPROACH) desired = route.offset;
    // Inside a pipe the line stays off the top seam (it opens again at the exit).
    const inPipe = (ship.path === null && this.inPipe(u)) || (targetMainU !== null && this.inPipe(targetMainU));
    if (inPipe) desired = clamp(desired, -PIPE_MAX_LAT, PIPE_MAX_LAT);
    // Ice ahead that leaves room beside it: go round it.
    if (ship.path === null) desired = this.avoidIce(u, desired, maxLat);
    const onIce = this.track.surfaceKindAt(u, ship.lateral, ship.path) === 'ice';

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
      let nearestLat = 0;
      for (const r of this.rivals) {
        if (r.def.id === this.shipId || r.status !== 'racing') continue;
        const dm = loopDelta(u, r.trackU) * this.length;
        if (dm < -AVOID_BEHIND || dm > AVOID_AHEAD) continue;
        // Only rivals on the same road (or sharing a deck where a split path overlaps the main road).
        const rLat = this.rivalLateral(r);
        if (Number.isNaN(rLat) || Math.abs(rLat - ship.lateral) > AVOID_LANE) continue;
        if (dm < nearestDm) {
          nearestDm = dm;
          nearest = r;
          nearestLat = rLat;
        }
      }
      if (nearest) {
        if (this.personality === 'aggressive' && ship.energy > nearest.energy + 5) {
          desired = nearestLat;
          ram = true;
        } else {
          if (this.time >= this.avoidUntil || this.avoidSide === 0) {
            // Stay on the side of the rival we're already on (crossing its line grinds both hulls);
            // switch only when that side has no room to the rail.
            const mySide = ship.lateral >= nearestLat ? 1 : -1;
            const room = mySide > 0 ? maxLat - nearestLat : nearestLat + maxLat;
            this.avoidSide = room >= AVOID_OFFSET ? mySide : -mySide;
            this.avoidUntil = this.time + AVOID_HOLD;
          }
          desired = nearestLat + this.avoidSide * AVOID_OFFSET;
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
    route.surfacePoint(targetR, this.tLat, this.targetPoint);
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
      const ak = Math.abs(this.curvatureAt(R, d));
      if (ak < 1e-5) continue;
      // Curves on ice are taken with the grip the driver expects there: brake earlier.
      const vSafe = this.safeSpeed(ak) * (this.iceAt(R, d, this.tLat) ? Math.sqrt(ICE_GRIP_PLAN) : 1);
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
    if (this.shouldBoost(kMaxLine, R, u)) {
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

  /** An ice patch covers lateral `lat` at `d` metres ahead of route metres R. */
  private iceAt(R: number, d: number, lat: number): boolean {
    if (this.ice.length === 0) return false;
    const mu = this.route.mainUAt(R + d);
    if (mu === null) return false;
    const m = mu * this.length;
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

  /** Signed curvature `d` metres ahead of route metres R. */
  private curvatureAt(R: number, d: number): number {
    return this.route.curvatureAt(R + d);
  }

  /**
   * A rival's lateral in this ship's road frame: as is on the same road; through a split path's overlap with the
   * main road (where the decks are shared) converted via the main road; NaN when on different roads.
   */
  private rivalLateral(r: ShipState): number {
    const me = this.ship;
    if (r.path === me.path) return r.lateral;
    const mine = this.mainLateral(me);
    const theirs = this.mainLateral(r);
    if (Number.isNaN(mine) || Number.isNaN(theirs)) return Number.NaN;
    return theirs - (mine - me.lateral);
  }

  /** Lateral on the main road: as is on main; on a split path only over its overlaps with main (else NaN). */
  private mainLateral(s: ShipState): number {
    if (s.path === null) return s.lateral;
    const b = this.track.branches.find((x) => x.id === s.path);
    if (!b || (s.pathS > b.overlapFork && s.pathS < b.length - b.overlapMerge)) return Number.NaN;
    return b.side * (this.track.halfWidth - b.halfWidth) + s.lateral;
  }

  /**
   * Choose the road for each split path once per approach, ROUTE_DECIDE metres before its fork; follow the
   * shortcut while on it; fall back to the main loop when the shortcut was missed.
   */
  private updateRoute(ship: ShipState): void {
    if (this.shortcuts.length === 0) return;
    if (ship.path !== null) {
      const on = this.shortcuts.find((r) => r.branch!.id === ship.path);
      if (on && on !== this.route) this.setRoute(on);
      return;
    }
    const u = ship.trackU;
    for (const sc of this.shortcuts) {
      const b = sc.branch!;
      const toFork = wrap01(b.uFork - u) * this.length;
      const between = inLoopRange(u, b.uFork, b.uMerge);
      if (!between && toFork <= ROUTE_DECIDE) {
        if (!this.decided.has(b.id)) {
          this.decided.add(b.id);
          const take = this.odds >= 1 ? !this.shortcutBlocked(sc) : this.odds > 0 && this.routeRng.next() < this.odds;
          this.setRoute(take ? sc : this.mainRoute);
        }
      } else if (!between) {
        this.decided.delete(b.id);
      }
    }
    if (this.route !== this.mainRoute && Number.isNaN(this.route.shipR(ship.path, u, ship.pathS))) this.setRoute(this.mainRoute);
  }

  private setRoute(r: TrackRoute): void {
    this.route = r;
    this.prevTargetR = Number.NaN;
  }

  /** Will this shortcut be closed when the ship gets there? (Stone gates: see shortcutBlocked in M4b step 5.) */
  private shortcutBlocked(_route: TrackRoute): boolean {
    return false;
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

  private shouldBoost(kMaxLine: number, R: number, u: number): boolean {
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
      if (Math.abs(this.curvatureAt(R, d)) > BOOST_STRAIGHT_CURV) return false;
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
