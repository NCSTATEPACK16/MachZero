# MachZero — Technical Design Document

## Context
Build a polished, single-player F-Zero-style anti-gravity racer ("MachZero") in Three.js + Vite, fully procedural (no external assets), in an empty directory (`/Users/johnbradner/Documents/ClaudeWork/MachZero`, Node 26.4 / npm 11.17). Work is split across 4 parallel Sonnet sub-agents with strict file ownership; the orchestrator (me) owns contracts, wiring, review, integration, and verification. Output is pushed to `https://github.com/NCSTATEPACK16/MachZero` (user-created) on `main` at the end of every phase.

### Decisions settled via grilling
| # | Decision |
|---|---|
| Q1 | TypeScript strict; `tsc --noEmit` is the merge gate |
| Q2 | Rapier (`@dimforge/rapier3d-compat`, WASM inlined) — zero world gravity, per-ship track-normal "magnet" gravity |
| Q3 | F-Zero X-style track: elevation, banking ≤60°, one 360° corkscrew |
| Q4 | Full energy loop: energy = health, collisions drain, boost costs energy (unlocked lap 2), pit strip recharges, 0 = explode/retire |
| Q5 | Closed rails everywhere; rail hits bounce + drain; auto-respawn safety net |
| Q6 | Keyboard + Gamepad (W/↑ thrust, S/↓ brake, A/D/←/→ steer, Q/E air-brakes, Space/Shift boost, Esc pause, M mute, R restart) |
| Q7 | Custom speed-scaled radial blur pass + chromatic aberration on boost (no velocity buffer) |
| Q8 | Procedural WebAudio (engine pitch by speed, boost, rail scrape, countdown, explosion) |
| Q9 | 1 seeded track, 3 laps; Title → Countdown → Race → Results → Restart; 3 AI personalities + mild rubber-banding; best lap in localStorage |
| Q10 | Orchestrator scaffolds project + contracts + compiling stubs first; agents write only in their own dirs in the same tree |
| Q11 | Files on disk canonical; final report = TDD + tree + commands; generated `CODEBASE.md` with every file verbatim |
| Q12 | `git init` locally; push to `main` at every phase. **Never commit** `.claude/`, plan files, transcripts, session IDs; commit messages carry no session/chat metadata |

---

## 1. Stack & conventions
- **Deps:** `three`, `@dimforge/rapier3d-compat`; dev: `typescript`, `vite`, `vitest`, `@types/three`. `package.json` is orchestrator-owned; agents may not add deps.
- **Scripts:** `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `test` (`vitest run`), `typecheck`, `codebase` (`node scripts/gen-codebase.mjs`).
- **Ground/elevation:** centerline elevation in `[TRACK_MIN_ELEVATION 25, TRACK_MAX_ELEVATION 60]` m; world ground plane at `GROUND_Y = −40`.
- **Units/axes:** 1 unit = 1 m, world Y-up, right-handed. **Ship local frame: forward = −Z, up = +Y, right = +X.** Track frame: `right = forward × up`. `lateral` > 0 = right of centerline.
- **Scale:** track half-width 14 m, rail height 2.5 m, lap ≈ 4–5 km, ship ≈ 4.5 m long, hover height 1.2 m, top speed ≈ 140 m/s, boost ≈ 190 m/s. HUD speed = `speed * SPEED_DISPLAY_SCALE` (≈ 7.9 → ~1100 km/h).
- **Loop:** fixed physics step **120 Hz** (accumulator, max 5 substeps), render on rAF with interpolation `alpha`. Physics/AI/race logic run in the fixed step; graphics/HUD/audio per frame.
- **Rendering:** WebGL2, `ACESFilmicToneMapping`, SRGB output. Bloom is "selective by intensity": neon materials use emissive HDR colors (>1) and `UnrealBloomPass` threshold ≈ 0.8.
- **URL flags:** `?autopilot=1` (player driven by AIDriver — used for verification), `?debug=1` (FPS/physics overlay), `?seed=N` (track seed override).

## 2. File structure (ownership in brackets)
```
MachZero/
  index.html  package.json  tsconfig.json  vite.config.ts  .gitignore  README.md  CODEBASE.md   [ORCH]
  docs/TDD.md                                                                   [ORCH]
  scripts/gen-codebase.mjs                                                      [ORCH]
  src/
    main.ts                    bootstrap + wiring + game loop                   [ORCH]
    core/                                                                       [ORCH, frozen after Phase 1]
      contracts.ts             all cross-system types & system interfaces
      config.ts                tunables, palette, collision groups, roster
      events.ts                typed EventBus<GameEvents>
      rng.ts                   mulberry32 seeded RNG
      loop.ts                  fixed-step loop w/ interpolation
      math.ts                  shared small helpers (clamp, damp, wrap01, lerpAngle)
    physics/   [AGENT 1]  index.ts, PhysicsSystem.ts, ShipController.ts, InputManager.ts, __tests__/
    track/     [AGENT 2]  index.ts, TrackGenerator.ts, TrackFrames.ts, TrackSweep.ts, TrackMesh.ts,
                          TrackQuery.ts, TrackTextures.ts, __tests__/
    graphics/  [AGENT 3]  index.ts, GraphicsSystem.ts, PostFX.ts, shaders/speedBlur.ts,
                          shaders/chromatic.ts, SpeedLines.ts, ShipModel.ts, ChaseCamera.ts,
                          Environment.ts, Effects.ts (boost flame, sparks, explosion)
    game/      [AGENT 4]  index.ts, AIDriver.ts, RaceManager.ts, HUD.ts, hud.css, Minimap.ts,
                          AudioSystem.ts, __tests__/
    sim/                  headless integration sim test                         [ORCH, Phase 3]
```
Rule: an agent writes **only** inside its directory. Anything it needs from another domain goes through `core/contracts.ts` types. Contract change requests are reported back to the orchestrator, never self-applied.

## 3. Core data contracts (`src/core/contracts.ts`)
```ts
import type * as THREE from 'three';
export type ShipId = 0 | 1 | 2 | 3;               // 0 = player

// ---------- Track → Physics / AI / Graphics / Game ----------
export interface TrackSample {
  u: number;              // arc-length param [0,1)
  distance: number;       // metres from start line
  position: THREE.Vector3;// centerline, on driving surface
  forward: THREE.Vector3; // unit tangent
  up: THREE.Vector3;      // unit surface normal (includes bank + corkscrew roll)
  right: THREE.Vector3;   // forward × up
  roll: number;           // radians, total roll vs rotation-minimising frame
  curvature: number;      // signed, 1/m (+ = turning right)
  halfWidth: number;
}
export interface TrackProjection {
  u: number; distance: number;
  lateral: number;        // signed metres along sample.right
  height: number;         // metres along sample.up above surface
  sample: TrackSample;    // interpolated frame at u
}
export interface TriMesh { vertices: Float32Array; indices: Uint32Array; } // world space, xyz triples
export interface TrackCollisionData {
  surface: TriMesh;       // drivable top surface — hover raycast target only (GROUP_SURFACE)
  rails: TriMesh;         // closed wall solids both sides (GROUP_RAIL)
}
export type TrackZoneType = 'pit' | 'dash' | 'startLine';
export interface TrackZone { type: TrackZoneType; uStart: number; uEnd: number; lateralMin: number; lateralMax: number; }
export interface GridSlot { u: number; lateral: number; position: THREE.Vector3; quaternion: THREE.Quaternion; }
export interface TrackData {
  seed: number; length: number; halfWidth: number; railHeight: number;
  curve: THREE.CatmullRomCurve3;          // closed, centripetal
  samples: TrackSample[];                 // TRACK_SAMPLES (2048) uniform by arc length
  sampleAt(u: number, out?: TrackSample): TrackSample;          // interpolated, wraps
  project(pos: THREE.Vector3, hintU?: number): TrackProjection; // O(window) with hint, O(N) without
  zones: TrackZone[];
  startGrid: GridSlot[];                  // 4 slots, index = grid position (0 = pole)
  collision: TrackCollisionData;
  visual: THREE.Group;                    // surface, rails, neon strips, dash plates, pit, start gate, pylons
  corkscrew: { uStart: number; uEnd: number };
}

// ---------- Input / AI → Physics ----------
export interface ControlInput {
  throttle: number; brake: number; steer: number;        // 0..1, 0..1, -1..1 (+ = right)
  airbrakeLeft: number; airbrakeRight: number;           // 0..1
  boost: boolean;                                        // edge-triggered request
}
export type MenuAction = 'pause' | 'confirm' | 'back' | 'mute' | 'restart' | 'up' | 'down';

// ---------- Ship state (single source of truth, shared by reference) ----------
export type ShipStatus = 'grid' | 'racing' | 'finished' | 'retired';
export interface ShipLivery { primary: number; secondary: number; glow: number; }
export type AIPersonality = 'aggressive' | 'steady' | 'erratic';
export interface ShipDefinition { id: ShipId; name: string; isPlayer: boolean; livery: ShipLivery; personality?: AIPersonality; gridIndex: number; }
export interface ShipState {
  readonly def: ShipDefinition;
  // --- written by PHYSICS only ---
  position: THREE.Vector3; quaternion: THREE.Quaternion;       // body pose (track-aligned heading, no visual bank)
  prevPosition: THREE.Vector3; prevQuaternion: THREE.Quaternion;// pose at previous fixed step (for interpolation)
  velocity: THREE.Vector3; speed: number; forwardSpeed: number;
  bank: number;           // visual roll (rad), graphics applies on top of quaternion
  grounded: boolean;
  energy: number;         // 0..ENERGY_MAX
  boosting: boolean; boostTimer: number;
  inPit: boolean; onDash: boolean;
  trackU: number; lateral: number; heightAboveTrack: number;   // cached projection each step
  lastControls: ControlInput;
  // --- written by GAME only ---
  status: ShipStatus;
  boostUnlocked: boolean;
  thrustScale: number;    // rubber-band multiplier, default 1
}

// ---------- Race → HUD / Graphics / Audio ----------
export type RaceState = 'title' | 'countdown' | 'racing' | 'paused' | 'results';
export interface RacerStanding { id: ShipId; name: string; position: number; lap: number; progress: number; totalTime: number | null; bestLap: number | null; status: ShipStatus; }
export interface RaceSnapshot {
  state: RaceState; countdown: number;        // 3,2,1,0(GO), -1 none
  raceTime: number; lap: number; totalLaps: number;
  lapTimes: number[]; currentLapTime: number; bestLap: number | null; recordLap: number | null;
  standings: RacerStanding[];                 // sorted by position
  player: ShipState; wrongWay: boolean;
}

// ---------- Per-frame context for render-side systems ----------
export interface FrameContext { dt: number; alpha: number; time: number; ships: ShipState[]; player: ShipState; track: TrackData; race: RaceSnapshot; }

// ---------- System interfaces (concrete classes must implement these exactly) ----------
export interface IPhysicsSystem {
  addShip(def: ShipDefinition, slot: GridSlot): ShipState;
  step(dt: number, controls: ReadonlyMap<ShipId, ControlInput>): void;
  resetShip(id: ShipId, slot: GridSlot): void;          // teleport, zero velocity, energy full
  readonly ships: ShipState[];
  dispose(): void;
}
export interface IInputManager { sample(): ControlInput; consume(action: MenuAction): boolean; update(): void; dispose(): void; }
export interface IGraphicsSystem { setTrack(track: TrackData): void; addShip(ship: ShipState): void; update(ctx: FrameContext): void; render(): void; resize(w: number, h: number): void; dispose(): void; }
export interface IAIDriver { readonly shipId: ShipId; update(dt: number): ControlInput; }
export interface IRaceManager { fixedUpdate(dt: number): void; snapshot(): RaceSnapshot; start(): void; pause(p: boolean): void; reset(): void; readonly state: RaceState; }
export interface IHUD { update(snap: RaceSnapshot, dt: number): void; }
export interface IAudioSystem { update(ctx: FrameContext): void; setMuted(m: boolean): void; readonly muted: boolean; }
```

### Factory exports (each agent's `index.ts` must export exactly these)
```ts
// physics/index.ts
export class PhysicsSystem implements IPhysicsSystem { static create(track: TrackData, bus: GameBus): Promise<PhysicsSystem>; }
export class InputManager implements IInputManager { constructor(target: Window); }
// track/index.ts
export function generateTrack(opts: { seed: number }): TrackData;
// graphics/index.ts
export class GraphicsSystem implements IGraphicsSystem { constructor(container: HTMLElement, bus: GameBus); }
// game/index.ts
export class AIDriver implements IAIDriver { constructor(ship: ShipState, track: TrackData, personality: AIPersonality, rngSeed: number, rivals?: readonly ShipState[]); }
export class RaceManager implements IRaceManager { constructor(track: TrackData, ships: ShipState[], bus: GameBus); }
export class HUD implements IHUD { constructor(root: HTMLElement, bus: GameBus, track: TrackData, actions: HudActions); }
export class AudioSystem implements IAudioSystem { constructor(bus: GameBus); }
export interface HudActions { onStart(): void; onRestart(): void; onResume(): void; onToggleMute(): void; }
```

### Event bus (`core/events.ts`) — `GameBus = EventBus<GameEvents>`
```ts
export interface GameEvents {
  'race:state':     { state: RaceState; prev: RaceState };
  'race:countdown': { value: 3 | 2 | 1 | 0 };
  'race:lap':       { shipId: ShipId; lap: number; lapTime: number; isBest: boolean; isRecord: boolean };
  'race:finish':    { shipId: ShipId; position: number; totalTime: number };
  'race:results':   { standings: RacerStanding[] };
  'ship:railHit':   { shipId: ShipId; point: THREE.Vector3; normal: THREE.Vector3; intensity: number }; // 0..1
  'ship:shipHit':   { a: ShipId; b: ShipId; point: THREE.Vector3; intensity: number };
  'ship:boost':     { shipId: ShipId };
  'ship:dash':      { shipId: ShipId };
  'ship:pit':       { shipId: ShipId; active: boolean };
  'ship:lowEnergy': { shipId: ShipId };
  'ship:destroyed': { shipId: ShipId; position: THREE.Vector3 };
  'ship:respawn':   { shipId: ShipId };
}
```
Emitters: physics → `ship:railHit|shipHit|boost|dash|pit|lowEnergy|respawn`; game → `race:*`, `ship:destroyed`. Graphics/HUD/Audio only subscribe.

### Track → Physics collision handoff (the key interface)
1. `generateTrack()` builds world-space `TriMesh` arrays for `surface` and `rails` from the same swept frames as the visual mesh.
2. `PhysicsSystem.create()` does `RAPIER.init()`, creates a world with gravity `(0,0,0)`, then one **fixed** body with two `ColliderDesc.trimesh(vertices, indices)`:
   - surface collider: `COLLISION.SURFACE` = `groups(GROUP_SURFACE, GROUP_QUERY)` — no body carries `GROUP_QUERY`, so it **never generates contacts**; it exists only for hover raycasts.
   - rail collider: `COLLISION.RAIL` = `groups(GROUP_RAIL, GROUP_SHIP | GROUP_QUERY)`, `ActiveEvents.COLLISION_EVENTS | CONTACT_FORCE_EVENTS`.
3. Ship colliders: cuboid, `COLLISION.SHIP` = `groups(GROUP_SHIP, GROUP_RAIL | GROUP_SHIP)`, CCD enabled, rotations locked (orientation set manually each step).
4. Hover rays: `world.castRayAndGetNormal(ray, HOVER_RAY_LENGTH, true, undefined, COLLISION.HOVER_RAY)` where `HOVER_RAY = groups(GROUP_QUERY, GROUP_SURFACE)`.

Rapier's pairwise rule is `((a >> 16) & b) != 0 && ((b >> 16) & a) != 0` — **both** directions must match, which is why queries carry their own `GROUP_QUERY` membership bit (a surface filter of `0` would make it invisible to raycasts). Groups live in `src/core/config.ts` (`GROUP_SURFACE=1<<0, GROUP_RAIL=1<<1, GROUP_SHIP=1<<2, GROUP_QUERY=1<<3`, `groups(membership, filter)`), and `src/core/__core.test.ts` asserts the matrix.

### Ownership of mutable state
`ShipState` is created by Physics and shared by reference. Physics writes pose/kinematics/energy/zones; Game writes `status`, `boostUnlocked`, `thrustScale`. Graphics/HUD/Audio are read-only. Physics ignores controls when `status !== 'racing'` (holds ships on grid, coasts finished ships, freezes retired ships).

## 4. Domain specs (agent briefs)

### Agent 1 — Physics & Controls (`src/physics/`)
- `PhysicsSystem`: Rapier world, colliders as above, event queue drain → energy drain + events; per-ship `ShipController`.
- Hover: 4 corner raycasts along −shipUp (max 10 m) against `GROUP_SURFACE` using `castRayAndGetNormal`; averaged hit normal → target up, slerp body up toward it (fast when grounded). Spring-damper along up to `HOVER_HEIGHT`; **magnet gravity** `−up × MAGNET_G` (≈ 40 m/s²) when grounded, falls back to `−track.project().sample.up` when airborne (so the corkscrew and inverted sections hold).
- Propulsion: thrust along forward projected onto surface plane; quadratic drag sets top speed; **no wheel friction** — lateral velocity damped by `LATERAL_GRIP` (anti-slip thrusters), reduced by air-brakes; air-brake adds yaw torque + drag on that side (sharp slides). Yaw rate from steer scaled by speed curve. Momentum preserved over crests.
- Banking: `bank` = damped `steer × MAX_VISUAL_BANK × speedFactor ± airbrake roll`. Convention: **bank > 0 = right side dips**; graphics renders `quaternion * axisAngle(+Z, −bank)`.
- Boost: if `boostUnlocked && energy > BOOST_COST` on edge → `boosting` for `BOOST_TIME`, extra thrust + top speed, `energy −= BOOST_COST`. Dash zone → impulse + `ship:dash`. Pit zone → `energy += PIT_RATE × dt` (capped), `ship:pit`.
- Rail/ship collision: energy drain ∝ impact normal speed; reflect/bleed velocity; rail scrape continuous events (intensity).
- Safety respawn: if `heightAboveTrack < −4` or `|lateral| > halfWidth + 6` for > 0.5 s → reset to centerline at last valid u, `ship:respawn`.
- `InputManager`: keyboard (keydown/keyup map) + Gamepad API (left stick/triggers/bumpers/A), dead-zones, smoothed steer ramp; `consume()` edge-triggered menu actions.
- Tests: controller math (spring converges to hover height on a flat trimesh in headless Rapier).

### Agent 2 — Track Generation (`src/track/`)
- Seeded (`core/rng.ts`) star-shaped control-point loop (angle monotonic → no plan-view self-intersection), 16–20 points, radius noise, elevation noise (0–60 m), a guaranteed long **main straight** (start line, pit strip) and a long straight-ish segment hosting the **corkscrew**. Closed centripetal `CatmullRomCurve3`; validate min curvature radius ≥ 60 m (smooth/retry deterministically).
- Frames: rotation-minimising (parallel-transport) frames with closure twist distributed around the loop; roll = clamp(curvature × BANK_FACTOR, ±60°) smoothed + corkscrew term `2π·smootherstep` over `corkscrew.uStart..uEnd`.
- Geometry: a custom `THREE.Shape` cross-section **swept with our own frames** (custom sweep in `TrackSweep.ts`; `ExtrudeGeometry` Frenet frames can't bank/twist). Surface (with CanvasTexture: grid, lane lines, chevrons, start checker), rails (wall shape both sides), emissive neon strips atop rails (HDR cyan/magenta), dash plates (animated emissive), pit strip (distinct colour), start gate arch, support pylons down to ground. Merge per material to keep draw calls low.
- Collision `TriMesh`es from the same sweep (surface at lower lateral resolution, rails as closed solids ~1 m thick).
- `TrackQuery.ts`: `sampleAt` interpolation, `project` via windowed search around `hintU` then segment refinement.
- Start grid: 4 slots behind start line, 2 staggered columns.
- Tests: determinism by seed, frame orthonormality/continuity (no flips, loop closure), project() round-trip accuracy.

### Agent 3 — Graphics & VFX (`src/graphics/`)
- `GraphicsSystem`: renderer (antialias off when composer MSAA via `WebGLRenderTarget samples: 4`), scene fog, hemisphere + directional light, PMREM env from a procedural `RoomEnvironment`-style scene for glossy reflections.
- `Environment`: procedural gradient/star sky shader dome, neon synth-grid ground plane, instanced procedural skyline towers with emissive windows, distant mountains.
- `ShipModel`: procedural ship mesh per livery (hull from extruded shapes, canopy, fins, engine nozzles with emissive glow), faces −Z; applies interpolated pose + `bank`; hover shimmer.
- `ChaseCamera`: damped follow in track-up frame (camera.up = smoothed ship up — survives the corkscrew), look-ahead, FOV 70→95 with speed, boost shake, countdown intro orbit, results orbit.
- `PostFX`: `EffectComposer` → `RenderPass` → `UnrealBloomPass` → `SpeedBlurPass` (radial, strength ∝ speed/topSpeed, centred on projected look-ahead point) → `ChromaticAberrationPass` (boost/impacts) + vignette → `OutputPass`.
- `SpeedLines`: velocity-scaled particle streaks (instanced/`LineSegments` in camera space), count/length/opacity ∝ speed, boost tint.
- `Effects`: boost flame, rail sparks (from `ship:railHit`), dash flash, explosion (`ship:destroyed`), pit energy shimmer.
- `?debug=1`: FPS/draw-call overlay.

### Agent 4 — AI & Game Logic (`src/game/`)
- `AIDriver`: look-ahead point at `u + (LOOKAHEAD_BASE + speed × LOOKAHEAD_K)/length` with target lateral (racing line = inside of upcoming curvature, personality bias, overtaking avoidance of nearby ships); steer via PD on signed angle in track plane; throttle/brake/airbrake from upcoming curvature vs speed; boost on straights when energy > threshold; returns to pit when energy low. Personalities: aggressive (late braking, rams, boosts often), steady (clean line), erratic (noise, mistakes). Deterministic RNG per driver.
- `RaceManager`: state machine `title → countdown(3,2,1,GO) → racing ⇄ paused → results`; lap counting via `trackU` wrap with half-lap checkpoint (anti-cheat/wrong-way); positions by `lap + u`; lap/total/best times; `boostUnlocked` from lap 2; retire at energy 0 (`ship:destroyed`); rubber-band `thrustScale` (0.97–1.06) for AI only; results when player finishes/retires (+ AI times estimated from pace); record lap in `localStorage` (try/catch).
- `HUD` (DOM + `hud.css`): title screen, countdown, speedometer (km/h, animated), energy bar (flashing when low, pit recharge glow), boost-ready indicator, lap x/3 + lap times, position (big "1st"), minimap (canvas, track outline + ship dots), wrong-way warning, pause and results screens with buttons calling `HudActions`. Neon styling, responsive.
- `AudioSystem`: WebAudio graph created on first user gesture; engine (detuned saw oscillators + filter, pitch ∝ speed), boost whoosh (noise burst), rail scrape (filtered noise ∝ intensity), countdown beeps, lap chime, explosion, master mute.
- Tests: lap counting / wrap / wrong-way; standings sort; AI steering sign on a synthetic track.

## 5. `main.ts` wiring (orchestrator, written in Phase 1)
```
bus = new EventBus<GameEvents>()
track = generateTrack({ seed: urlSeed ?? CONFIG.TRACK_SEED })
physics = await PhysicsSystem.create(track, bus); input = new InputManager(window)
graphics = new GraphicsSystem(container, bus); graphics.setTrack(track)
ships = SHIP_ROSTER.map(d => physics.addShip(d, track.startGrid[d.gridIndex])); ships.forEach(graphics.addShip)
drivers = AI ships (+ player if ?autopilot) → new AIDriver(ship, track, personality, seed+id)
race = new RaceManager(track, ships, bus); hud = new HUD(root, bus, track, actions); audio = new AudioSystem(bus)
loop.fixed(dt):  input.update(); handle menu actions; if race.state==='racing'|'countdown': controls = player?input.sample():… ; physics.step(dt, controls); race.fixedUpdate(dt)
loop.frame(dt, alpha): ctx = {…, race: race.snapshot()}; graphics.update(ctx); hud.update(ctx.race, dt); audio.update(ctx); graphics.render()
```
Player starts from grid slot 3 (back of grid).

## 6. Execution plan

### Phase 1 — Scaffold & contracts (orchestrator)
1. `git init -b main`; `.gitignore` (`node_modules/ dist/ .claude/ .DS_Store *.log .vite/`); `git remote add origin https://github.com/NCSTATEPACK16/MachZero.git`.
2. Write `package.json`, `tsconfig.json` (strict, `moduleResolution: bundler`), `vite.config.ts`, `index.html`; `npm install three @dimforge/rapier3d-compat` + dev deps. Confirm current Rapier/Three APIs via Context7 before writing contracts that touch them.
3. Write `docs/TDD.md` (this document's §1–5), `src/core/*`, `src/main.ts`, and **compiling stubs** for every export in each agent dir (correct signatures, no-op bodies) so `npm run typecheck` passes from day one.
4. Verify `npm run typecheck && npm run build`; commit "Phase 1: architecture, contracts, scaffold"; `git push -u origin main` (if the remote does not exist yet, keep committing locally and push once it does).

### Phase 2 — Parallel delegation (4 × Sonnet `general-purpose` agents, background, one message)
Each prompt contains: TDD path, its exclusive directory, forbidden paths (`src/core`, `src/main.ts`, `package.json`, other agents' dirs), exact exports to implement, domain spec (§4), acceptance criteria (`npm run typecheck` clean, own vitest tests pass, no `TODO`/placeholder code, no external assets/network), instruction to use Context7 for three/Rapier API checks, and to report any contract change needed instead of making it. On completion: typecheck + test + build; commit per domain; push.

### Phase 3 — Review, integrate, verify, deliver (orchestrator)
1. Contract review of each domain against §3 (signatures, ownership rules, event usage); run `/code-review`-style pass; fix integration issues directly.
2. Add `src/sim/race.sim.test.ts`: headless Rapier + track + 4 AIDrivers run ≥1 lap — asserts every ship completes a lap, never triggers respawn more than once, stays within rails, corkscrew traversed.
3. Browser play-test (built-in browser via `.claude/launch.json` → `npm run dev`, launch file not committed): title renders, countdown, `?autopilot=1&debug=1` completes 3 laps, no console errors, FPS ≥ 60 on desktop, screenshots at start line / corkscrew / boost; manual keyboard spot-check. Tune feel constants in `config.ts`.
4. `README.md` (controls, commands), `npm run codebase` → `CODEBASE.md`; final commit "Phase 3: integration, review, polish"; push.
5. Final report: implementation plan, file tree, CLI commands, pointer to `CODEBASE.md` (sent via SendUserFile).

## Verification (end-to-end)
```
npm install
npm run typecheck
npm test            # unit tests + headless race sim
npm run build
npm run dev         # open http://localhost:5173 (and ?autopilot=1&debug=1)
```
Pass criteria: all green; autopilot race completes 3 laps with all 4 ships, results screen shows; zero console errors; stable 60 fps; GitHub `main` contains only project output (no `.claude/`, plans, transcripts, session IDs).
