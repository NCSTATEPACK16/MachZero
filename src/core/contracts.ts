/**
 * MachZero cross-system contracts.
 *
 * This file is the single source of truth for every data structure passed
 * between the Track, Physics, Graphics and Game domains. It is owned by the
 * orchestrator and is frozen: domain code implements these shapes exactly.
 */
import type * as THREE from 'three';

/** Racer id, 0 = player. A race has up to 8 ships (ids 0..7). */
export type ShipId = number;

// ---------------------------------------------------------------------------
// Ships, parts and stats (2.0)
// ---------------------------------------------------------------------------

export type ShipClass = 'light' | 'balanced' | 'heavy';
export type PartSlot = 'engine' | 'booster' | 'stabilizer' | 'hull';
/** 0 = Stock, 1 = Mk II, 2 = Mk III, 3 = Prototype. */
export type PartTier = 0 | 1 | 2 | 3;
export type AITier = 'rookie' | 'pilot' | 'ace' | 'legend';

/** Per-ship handling, resolved once from a loadout (physics/ShipStatsResolver). Balanced Stock = v1 CONFIG. */
export interface ShipStats {
  /** m/s */
  topSpeed: number;
  /** m/s² at zero speed (already scaled by mass / (mass + part weight)). */
  thrustAccel: number;
  boostTopSpeed: number;
  boostAccel: number;
  /** Energy spent per boost. */
  boostCost: number;
  /** Seconds per boost. */
  boostTime: number;
  /** rad/s yaw rate at mid speed / at top speed. */
  steerRate: number;
  steerRateHighSpeed: number;
  /** 1/s decay of sideways velocity; while air-braking. */
  lateralGrip: number;
  airbrakeGrip: number;
  energyMax: number;
  /** Multiplies all collision damage. */
  damageTakenScale: number;
  /** Relative mass (1 = v1): collider density for ship–ship pushes. */
  mass: number;
}

/** Player assists (per profile). Stored from M1; physics applies them from M7. */
export interface Assists {
  autoAccelerate: boolean;
  /** 0 off, 1 light, 2 strong. */
  steering: 0 | 1 | 2;
  noKO: boolean;
  earlyBoost: boolean;
}

export interface Loadout {
  chassisId: string;
  parts: Record<PartSlot, PartTier>;
  livery: ShipLivery & { decal: number };
}

// ---------------------------------------------------------------------------
// Track → Physics / AI / Graphics / Game
// ---------------------------------------------------------------------------

export interface TrackSample {
  /** Arc-length parameter in [0, 1). */
  u: number;
  /** Metres from the start line along the centerline. */
  distance: number;
  /** Centerline point on the driving surface. */
  position: THREE.Vector3;
  /** Unit tangent (direction of travel). */
  forward: THREE.Vector3;
  /** Unit surface normal (includes banking and corkscrew roll). */
  up: THREE.Vector3;
  /** forward × up (points to the driver's right). */
  right: THREE.Vector3;
  /** Total roll (radians) relative to the rotation-minimising frame. */
  roll: number;
  /** Signed curvature in 1/m; positive = turning right. */
  curvature: number;
  /** Drivable half-width in metres (rail inner face to centerline). */
  halfWidth: number;
}

export interface TrackProjection {
  u: number;
  distance: number;
  /** Signed metres along sample.right. */
  lateral: number;
  /** Metres along sample.up above the driving surface. */
  height: number;
  /** Interpolated frame at u. */
  sample: TrackSample;
  /**
   * Unit normal of the driving surface at (u, lateral), pointing into the drivable side. Differs from sample.up
   * where the road curls into a pipe; absent means sample.up.
   */
  surfaceUp?: THREE.Vector3;
  /**
   * The road the point is on: null for the main loop, a branch id on a split path. On a branch, `u` and
   * `distance` are race progress mapped onto the main loop, `pathS` is metres along the branch, and lateral,
   * height and `sample` are relative to the branch.
   */
  path: string | null;
  pathS?: number;
}

/**
 * A split path (Jade Ruins): an alternative road that leaves the main loop at a fork and rejoins it at a merge.
 * It starts and ends beside the main centreline (offset `side · (halfWidth_main − halfWidth)`), overlapping the
 * main deck until the roads have separated.
 */
export interface TrackBranch {
  id: string;
  /** Main-loop u of the fork and merge. */
  uFork: number;
  uMerge: number;
  /** Branch length (m). */
  length: number;
  halfWidth: number;
  /** +1: the branch leaves on the main road's right; −1: on its left. */
  side: 1 | -1;
  /** Metres along the branch over which it still overlaps the main deck at the fork / merge end. */
  overlapFork: number;
  overlapMerge: number;
  /** Frames every ~ds metres along the branch (u = s / length). */
  samples: TrackSample[];
  /** Frame at s metres along the branch (clamped). */
  sampleAt(s: number, out?: TrackSample): TrackSample;
  surfacePoint(s: number, lateral: number, out: THREE.Vector3, outUp?: THREE.Vector3): THREE.Vector3;
  /**
   * Race progress (main-loop u) of a ship s metres along the branch: monotonic from uFork to uMerge. Through the
   * overlaps `lateral` adds its along-main share, so progress is the same on either road there.
   */
  progressU(s: number, lateral?: number): number;
  /** Branch metres whose (centreline) race progress is main-loop u: the inverse of progressU, clamped. */
  sAtProgress(u: number): number;
  /** Lateral edges that have no rail (open drop): between these s values the side `openSide` is open. */
  openEdge: { side: 1 | -1; sFrom: number; sTo: number } | null;
}

/** World-space triangle mesh: xyz vertex triples + triangle indices. */
export interface TriMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface TrackCollisionData {
  /** Drivable top surface — hover raycast target only (GROUP_SURFACE). */
  surface: TriMesh;
  /** Closed wall solids on both sides (GROUP_RAIL). */
  rails: TriMesh;
}

export type TrackZoneType = 'pit' | 'dash' | 'startLine';

export interface TrackZone {
  type: TrackZoneType;
  /** Zone start/end in u. uEnd may be < uStart when the zone wraps past the start line. */
  uStart: number;
  uEnd: number;
  lateralMin: number;
  lateralMax: number;
}

export interface GridSlot {
  u: number;
  lateral: number;
  /** Hover position (already raised HOVER_HEIGHT above the surface). */
  position: THREE.Vector3;
  /** Ship orientation: local -Z = track forward, local +Y = track up. */
  quaternion: THREE.Quaternion;
}

// ---------------------------------------------------------------------------
// Authored tracks (2.0): control points + features
// ---------------------------------------------------------------------------

/**
 * Track features in metres along the lap. The seeded generator emits only a corkscrew, dash plates and the pit.
 * A `jump` is an open-air gap: no surface and no rails between dTakeoff and dLanding. The builder raises a
 * ramp of `kick` metres over the RAMP_LENGTH before the lip, and bends the centerline through the gap along
 * the flight path of a ship at `designSpeed` (m/s), so project() and the AI keep working in the air.
 * A `pipe` curls the road's cross-section up into a closed tube (circumference = the road width, so `lateral`
 * becomes the arc position around the tube): it closes over `transition` metres after dStart and opens over the
 * last `transition` metres before dEnd. Rails end where the tube closes.
 * An `ice` patch multiplies the lateral grip of ships over it by `grip`.
 */
export type TrackFeature =
  | { type: 'corkscrew'; dStart: number; dEnd: number; turns?: number }
  | { type: 'jump'; dTakeoff: number; dLanding: number; kick: number; designSpeed?: number }
  | { type: 'pipe'; dStart: number; dEnd: number; transition: number }
  | { type: 'loop'; dStart: number; dEnd: number; sideOffset: number }
  | {
      type: 'branch';
      id: string;
      dFork: number;
      dMerge: number;
      /** Open centripetal Catmull-Rom control points from the fork to the merge (m). */
      points: [number, number, number][];
      halfWidth: number;
      side: 1 | -1;
      /** Branch metres (from the fork) over which its outer edge has no rail. */
      openFrom?: number;
      openTo?: number;
    }
  | { type: 'dash' | 'pit'; dStart: number; dEnd: number; lateralMin: number; lateralMax: number }
  | { type: 'ice'; dStart: number; dEnd: number; lateralMin: number; lateralMax: number; grip: number }
  | {
      type: 'gate';
      /** Metres along the main loop, or along `branch` when set. */
      d: number;
      branch?: string;
      /** Timeline (s): closed for `closedFraction` of each `period`, offset by `phase`. */
      period: number;
      phase: number;
      closedFraction: number;
      /** Which part of the road the slab closes: the left or right half, or the full width (a shortcut gate). */
      span: 'left' | 'right' | 'full';
    }
  | { type: 'mines'; dStart: number; dEnd: number; count: number; drift: number };

/** content/tracks/<id>.json */
export interface TrackDefinition {
  id: string;
  worldId: string;
  name: string;
  laps: number;
  /** Closed centripetal Catmull-Rom control points (m). points[0] is the start line, on the main straight. */
  points: [number, number, number][];
  bankFactor?: number;
  maxBank?: number;
  /** Gravity multiplier while airborne (Orbital Ring < 1). */
  airGravityScale?: number;
  /** Lowest / highest allowed centerline elevation (validation). */
  elevation?: [number, number];
  features: TrackFeature[];
  /** Total 3-lap time of the dev ghost (filled by bake-ghosts). */
  devTime?: number;
}

export type SurfaceKind = 'road' | 'air' | 'pipe' | 'ice';

/** A jump gap resolved onto the built track. */
export interface TrackJump {
  /** Lip and landing edge in u (the open-air span is (uTakeoff, uLanding)). */
  uTakeoff: number;
  uLanding: number;
  dTakeoff: number;
  dLanding: number;
}

export interface TrackData {
  /** 'bonus-<seed>' for seeded tracks, the definition id for authored ones. */
  id: string;
  worldId: string;
  name: string;
  laps: number;
  /** RNG seed (seeded tracks: the layout seed; authored: a hash of the id). */
  seed: number;
  /** Lap length in metres. */
  length: number;
  halfWidth: number;
  railHeight: number;
  /** Closed centripetal Catmull-Rom centerline. */
  curve: THREE.CatmullRomCurve3;
  /** CONFIG.TRACK_SAMPLES samples, uniform by arc length. */
  samples: TrackSample[];
  /** Interpolated sample at u (wraps). Writes into `out` when provided. */
  sampleAt(u: number, out?: TrackSample): TrackSample;
  /**
   * Nearest point on the road. O(window) with hintU, O(N) without. With split paths, `hintPath` (the road the
   * ship was on) keeps the projection on that road while the point is still on it.
   */
  project(pos: THREE.Vector3, hintU?: number, hintPath?: string | null): TrackProjection;
  /**
   * The point on the driving surface at (u, lateral), plus its surface normal when `outUp` is given. On a flat
   * deck this is position + right·lateral; inside a pipe it follows the curled cross-section.
   */
  surfacePoint(u: number, lateral: number, out: THREE.Vector3, outUp?: THREE.Vector3): THREE.Vector3;
  zones: TrackZone[];
  /** 8 slots behind the start line (4 rows × 2 staggered); index = grid position (0 = pole). */
  startGrid: GridSlot[];
  collision: TrackCollisionData;
  /** Surface, rails, neon strips, dash plates, pit, start gate, pylons. */
  visual: THREE.Group;
  /** Pose moving hazards (stone gates) in `visual` for physics time t since the race reset; absent without any. */
  animateHazards?: (t: number) => void;
  /** The (first) corkscrew, or null when the track has none. */
  corkscrew: { uStart: number; uEnd: number } | null;
  features: TrackFeature[];
  jumps: TrackJump[];
  /** Split paths (empty on most tracks). */
  branches: TrackBranch[];
  /**
   * Pipe extents in u: the whole curl (uStart..uEnd, transitions included) and the stretch where the tube is
   * fully closed (uClosedStart..uClosedEnd).
   */
  pipes: { uStart: number; uEnd: number; uClosedStart: number; uClosedEnd: number }[];
  /** Gravity multiplier while airborne. */
  airGravityScale: number;
  /** What a ship at (u, lateral) is driving on (on a branch: pass its id; u is then ignored for main features). */
  surfaceKindAt(u: number, lateral: number, path?: string | null): SurfaceKind;
  /** Lateral-grip multiplier of the surface at (u, lateral): an ice patch's `grip`, otherwise 1. */
  gripAt(u: number, lateral: number, path?: string | null): number;
  /**
   * Where a ship whose last valid position was u is put back: u itself, except near or inside a jump, where it
   * is the landing side (respawning before the ramp at low speed would only miss the jump again).
   */
  safeRespawnU(u: number): number;
}

// ---------------------------------------------------------------------------
// Input / AI → Physics
// ---------------------------------------------------------------------------

export interface ControlInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1..1, positive = right */
  steer: number;
  /** 0..1 */
  airbrakeLeft: number;
  /** 0..1 */
  airbrakeRight: number;
  /** Edge-triggered boost request (true for one sample per press). */
  boost: boolean;
}

export type MenuAction = 'pause' | 'confirm' | 'back' | 'mute' | 'restart' | 'up' | 'down' | 'left' | 'right';

/** Rebindable keyboard driving controls. */
export type KeyControl = 'throttle' | 'brake' | 'left' | 'right' | 'airLeft' | 'airRight' | 'boost';
/** KeyboardEvent.code values per control (first = primary). */
export type KeyBindings = Record<KeyControl, string[]>;

// ---------------------------------------------------------------------------
// Ship state — single source of truth, shared by reference
// ---------------------------------------------------------------------------

export type ShipStatus = 'grid' | 'racing' | 'finished' | 'retired';

export interface ShipLivery {
  primary: number;
  secondary: number;
  glow: number;
}

export type AIPersonality = 'aggressive' | 'steady' | 'erratic';

export interface ShipDefinition {
  id: ShipId;
  name: string;
  isPlayer: boolean;
  livery: ShipLivery;
  personality?: AIPersonality;
  gridIndex: number;
  /** Resolved handling for this race (Balanced Stock = v1). */
  stats: ShipStats;
  /** Chassis, parts and full livery; absent for the v1 classic roster. */
  loadout?: Loadout;
  pilotId?: string;
  tier?: AITier;
}

export interface ShipState {
  readonly def: ShipDefinition;

  // --- written by PHYSICS only ---
  /** Body pose: track-aligned heading, no visual bank. */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Pose at the previous fixed step (for render interpolation). */
  prevPosition: THREE.Vector3;
  prevQuaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  /** |velocity| in m/s. */
  speed: number;
  /** velocity · forward in m/s. */
  forwardSpeed: number;
  /**
   * Visual roll in radians. bank > 0 = right side dips (leaning into a right turn).
   * Graphics renders: visualQuat = quaternion * axisAngle(+Z, -bank).
   */
  bank: number;
  grounded: boolean;
  /** 0..def.stats.energyMax */
  energy: number;
  boosting: boolean;
  /** Seconds of boost remaining. */
  boostTimer: number;
  inPit: boolean;
  onDash: boolean;
  /** Cached track projection, refreshed every fixed step. */
  trackU: number;
  /** null on the main loop, or the id of the split path the ship is on (lateral is then relative to it). */
  path: string | null;
  /** Metres along that split path (0 on the main loop). */
  pathS: number;
  lateral: number;
  heightAboveTrack: number;
  /** In the air over a jump gap (no surface under the hover rays). */
  airborne: boolean;
  lastControls: ControlInput;

  // --- written by GAME only ---
  status: ShipStatus;
  boostUnlocked: boolean;
  /** Rubber-band thrust multiplier, default 1. */
  thrustScale: number;
}

// ---------------------------------------------------------------------------
// Race → HUD / Graphics / Audio
// ---------------------------------------------------------------------------

export type RaceState = 'title' | 'countdown' | 'racing' | 'paused' | 'results';

export interface RacerStanding {
  id: ShipId;
  name: string;
  /** 1-based race position. */
  position: number;
  /** Completed laps. */
  lap: number;
  /** Completed laps + current u (monotonic race progress). */
  progress: number;
  totalTime: number | null;
  bestLap: number | null;
  status: ShipStatus;
}

export interface RaceSnapshot {
  state: RaceState;
  /** 3, 2, 1, 0 (= GO), or -1 when no countdown is showing. */
  countdown: number;
  raceTime: number;
  /** Player's current lap, 1-based (clamped to totalLaps). */
  lap: number;
  totalLaps: number;
  /** Player's completed lap times in seconds. */
  lapTimes: number[];
  currentLapTime: number;
  /** Player's best lap this race. */
  bestLap: number | null;
  /** All-time best lap from localStorage. */
  recordLap: number | null;
  /** Sorted by position. */
  standings: RacerStanding[];
  player: ShipState;
  /** Every ship (same shared references as FrameContext.ships) — read-only, e.g. for the minimap. */
  ships: readonly ShipState[];
  wrongWay: boolean;
}

// ---------------------------------------------------------------------------
// Per-frame context for render-side systems
// ---------------------------------------------------------------------------

export interface FrameContext {
  /** Real frame delta in seconds (clamped). */
  dt: number;
  /** Interpolation factor between prev and current physics pose, 0..1. */
  alpha: number;
  /** Seconds since boot. */
  time: number;
  /** Physics seconds since the race reset (the stone gates' timeline). */
  hazardTime: number;
  ships: ShipState[];
  player: ShipState;
  track: TrackData;
  race: RaceSnapshot;
}

// ---------------------------------------------------------------------------
// System interfaces — concrete classes implement these exactly
// ---------------------------------------------------------------------------

export interface IPhysicsSystem {
  addShip(def: ShipDefinition, slot: GridSlot): ShipState;
  step(dt: number, controls: ReadonlyMap<ShipId, ControlInput>): void;
  /** Teleport to slot, zero velocity, full energy, clear boost. */
  resetShip(id: ShipId, slot: GridSlot): void;
  readonly ships: ShipState[];
  dispose(): void;
}

export interface IInputManager {
  /** Current driving controls (boost is edge-triggered). */
  sample(): ControlInput;
  /** True once per press of the given menu action. */
  consume(action: MenuAction): boolean;
  /** Poll gamepads; call once per fixed step before sample()/consume(). */
  update(): void;
  dispose(): void;
}

export interface IGraphicsSystem {
  setTrack(track: TrackData): void;
  addShip(ship: ShipState): void;
  update(ctx: FrameContext): void;
  render(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/** Constructed as new AIDriver(ship, track, personality, rngSeed, rivals, { hazardClock }). */
export interface IAIDriver {
  readonly shipId: ShipId;
  update(dt: number): ControlInput;
}

export interface IRaceManager {
  fixedUpdate(dt: number): void;
  snapshot(): RaceSnapshot;
  /** title/results → countdown. */
  start(): void;
  pause(paused: boolean): void;
  /** Back to 'title' with all race bookkeeping cleared (physics reset is done by main). */
  reset(): void;
  readonly state: RaceState;
}

export interface IHUD {
  update(snap: RaceSnapshot, dt: number): void;
}

export interface IAudioSystem {
  update(ctx: FrameContext): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}

export interface HudActions {
  onStart(): void;
  onRestart(): void;
  onResume(): void;
  onToggleMute(): void;
  /** Present when the app has menus: adds MENU to the pause and results screens. */
  onMenu?(): void;
  /** Present with the menu UI: adds SETTINGS to the pause screen. */
  onSettings?(): void;
}
