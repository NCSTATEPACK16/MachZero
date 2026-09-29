import type { ShipDefinition } from './contracts';

/**
 * Global tunables. Units: metres, seconds, radians, m/s, m/s².
 * Domain agents read these; only the orchestrator edits this file.
 */
export const CONFIG = {
  // --- simulation ---
  FIXED_DT: 1 / 120,
  MAX_SUBSTEPS: 5,
  MAX_FRAME_DT: 0.1,

  // --- race ---
  TRACK_SEED: 7331,
  TOTAL_LAPS: 3,
  COUNTDOWN_STEP: 1.0, // seconds per 3-2-1-GO tick
  RESULTS_DELAY: 3.0, // seconds after player finishes before results screen
  RECORD_STORAGE_KEY: 'machzero.recordLap',

  // --- track ---
  TRACK_SAMPLES: 2048,
  TRACK_HALF_WIDTH: 14,
  RAIL_HEIGHT: 2.5,
  RAIL_THICKNESS: 1.0,
  TRACK_MIN_RADIUS: 60,
  TRACK_TARGET_LENGTH: 4500,
  TRACK_MAX_ELEVATION: 60,
  TRACK_MIN_ELEVATION: 25, // centerline never dips below this (corkscrew clearance)
  GROUND_Y: -40, // world ground plane (scenery, pylon feet)
  MAX_BANK: (60 * Math.PI) / 180,
  BANK_FACTOR: 55, // radians of roll per (1/m) of curvature, before clamp
  PIT_LATERAL_MIN: -13, // pit strip hugs the left edge of the main straight
  PIT_LATERAL_MAX: -7,

  // --- ship dimensions ---
  SHIP_LENGTH: 4.5,
  SHIP_WIDTH: 2.6,
  SHIP_HEIGHT: 0.9,
  HOVER_HEIGHT: 1.2,

  // --- hover / gravity ---
  HOVER_RAY_LENGTH: 10,
  HOVER_STIFFNESS: 220, // spring (1/s²) toward HOVER_HEIGHT
  HOVER_DAMPING: 22, // spring damping (1/s)
  MAGNET_G: 40, // m/s² toward the track surface
  UP_ALIGN_RATE: 14, // 1/s slerp rate of ship up toward surface normal
  RESPAWN_HEIGHT: -4,
  RESPAWN_LATERAL_MARGIN: 6,
  RESPAWN_GRACE: 0.5,

  // --- propulsion ---
  THRUST_ACCEL: 62, // m/s² at zero speed
  TOP_SPEED: 140,
  BOOST_TOP_SPEED: 190,
  BOOST_ACCEL: 95,
  BRAKE_DECEL: 70,
  COAST_DRAG: 0.12, // linear drag (1/s) with no throttle
  LATERAL_GRIP: 7.5, // 1/s decay of sideways velocity (anti-slip thrusters)
  AIRBRAKE_GRIP: 2.2, // lateral grip while air-braking (slides)
  AIRBRAKE_DRAG: 0.9, // 1/s extra longitudinal drag per full air-brake
  STEER_RATE: 1.9, // rad/s max yaw rate at mid speed
  STEER_RATE_HIGH_SPEED: 1.25, // rad/s at top speed
  AIRBRAKE_YAW: 1.3, // rad/s extra yaw from one air-brake
  MAX_VISUAL_BANK: 0.75, // rad
  BANK_RATE: 8,

  // --- energy ---
  ENERGY_MAX: 100,
  BOOST_COST: 14,
  BOOST_TIME: 1.6,
  PIT_RECHARGE_RATE: 30, // energy per second
  RAIL_DAMAGE_PER_MS: 0.22, // energy per m/s of impact normal speed
  SHIP_DAMAGE_PER_MS: 0.15,
  LOW_ENERGY_THRESHOLD: 25,
  DASH_IMPULSE: 45, // m/s added along forward
  RAIL_RESTITUTION: 0.35,

  // --- AI ---
  AI_LOOKAHEAD_BASE: 22,
  AI_LOOKAHEAD_K: 0.55, // metres of look-ahead per m/s
  AI_RUBBER_BAND_MIN: 0.97,
  AI_RUBBER_BAND_MAX: 1.06,

  // --- camera / presentation ---
  CAMERA_DISTANCE: 9.5,
  CAMERA_HEIGHT: 3.2,
  FOV_MIN: 70,
  FOV_MAX: 95,
  SPEED_DISPLAY_SCALE: 7.9, // m/s → displayed km/h
  BLOOM_STRENGTH: 1.1,
  BLOOM_RADIUS: 0.55,
  BLOOM_THRESHOLD: 0.8,
} as const;

/** Rapier collision groups: membership in the high 16 bits, filter in the low 16. */
export const GROUP_SURFACE = 1 << 0;
export const GROUP_RAIL = 1 << 1;
export const GROUP_SHIP = 1 << 2;
/** Pseudo-group carried by scene queries (raycasts) so they can hit the contact-less surface. */
export const GROUP_QUERY = 1 << 3;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** Collider group presets (see TDD §3 "Track → Physics collision handoff"). */
export const COLLISION = {
  /** Track surface: only ever hit by queries — never generates contacts. */
  SURFACE: groups(GROUP_SURFACE, GROUP_QUERY),
  RAIL: groups(GROUP_RAIL, GROUP_SHIP | GROUP_QUERY),
  SHIP: groups(GROUP_SHIP, GROUP_RAIL | GROUP_SHIP),
  /** Filter for hover raycasts: hits the surface only. */
  HOVER_RAY: groups(GROUP_QUERY, GROUP_SURFACE),
  /** Filter for wall probes (AI/debug): hits rails only. */
  RAIL_RAY: groups(GROUP_QUERY, GROUP_RAIL),
} as const;

/** Neon palette (linear-ish hex; multiply emissive intensity > 1 for bloom). */
export const PALETTE = {
  cyan: 0x19f0ff,
  magenta: 0xff2bd6,
  violet: 0x8a4dff,
  amber: 0xffb319,
  lime: 0x7dff3a,
  red: 0xff3344,
  white: 0xf4f7ff,
  asphalt: 0x14161f,
  night: 0x05030f,
  horizon: 0x2a0a4a,
} as const;

/** Race roster. Player is id 0 and starts at the back of the grid. */
export const SHIP_ROSTER: readonly ShipDefinition[] = [
  { id: 0, name: 'BLUE COMET', isPlayer: true, gridIndex: 3, livery: { primary: 0x1f6bff, secondary: 0xe8eeff, glow: 0x19f0ff } },
  { id: 1, name: 'CRIMSON FANG', isPlayer: false, personality: 'aggressive', gridIndex: 0, livery: { primary: 0xd81b2a, secondary: 0x1a1a1a, glow: 0xff5a2b } },
  { id: 2, name: 'GOLDEN ARROW', isPlayer: false, personality: 'steady', gridIndex: 1, livery: { primary: 0xf2b705, secondary: 0x2b2b35, glow: 0xffe066 } },
  { id: 3, name: 'VIOLET WISP', isPlayer: false, personality: 'erratic', gridIndex: 2, livery: { primary: 0x8a2be2, secondary: 0x00e5a8, glow: 0xff2bd6 } },
];

/** URL flags: ?autopilot=1 ?debug=1 ?seed=N */
export interface UrlFlags {
  autopilot: boolean;
  debug: boolean;
  seed: number | null;
}

export function readUrlFlags(search: string = typeof location !== 'undefined' ? location.search : ''): UrlFlags {
  const p = new URLSearchParams(search);
  const seedRaw = p.get('seed');
  const seed = seedRaw !== null && seedRaw !== '' && Number.isFinite(Number(seedRaw)) ? Number(seedRaw) : null;
  return { autopilot: p.get('autopilot') === '1', debug: p.get('debug') === '1', seed };
}
