/**
 * MachZero cross-system contracts.
 *
 * This file is the single source of truth for every data structure passed
 * between the Track, Physics, Graphics and Game domains. It is owned by the
 * orchestrator and is frozen: domain code implements these shapes exactly.
 */
import type * as THREE from 'three';

export type ShipId = 0 | 1 | 2 | 3; // 0 = player

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

export interface TrackData {
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
  /** Nearest point on the centerline. O(window) with hintU, O(N) without. */
  project(pos: THREE.Vector3, hintU?: number): TrackProjection;
  zones: TrackZone[];
  /** 4 slots behind the start line; index = grid position (0 = pole). */
  startGrid: GridSlot[];
  collision: TrackCollisionData;
  /** Surface, rails, neon strips, dash plates, pit, start gate, pylons. */
  visual: THREE.Group;
  corkscrew: { uStart: number; uEnd: number };
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

export type MenuAction = 'pause' | 'confirm' | 'back' | 'mute' | 'restart' | 'up' | 'down';

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
  /** Visual roll in radians; graphics applies it on top of `quaternion`. */
  bank: number;
  grounded: boolean;
  /** 0..CONFIG.ENERGY_MAX */
  energy: number;
  boosting: boolean;
  /** Seconds of boost remaining. */
  boostTimer: number;
  inPit: boolean;
  onDash: boolean;
  /** Cached track projection, refreshed every fixed step. */
  trackU: number;
  lateral: number;
  heightAboveTrack: number;
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
}
