# MachZero 2.0 — Implementation Guide (for the Opus 5.5 build sessions)

Read [`SPEC.md`](SPEC.md) first (the *what*). This file is the *how*: operating rules, target architecture, interface changes, and milestones **M0 → M8** pinned to v1's real files. v1's architecture and its corkscrew-physics notes are in [`../TDD.md`](../TDD.md) §7.

---

## 0. Operating rules for every session (read before touching code)

1. **Opus implements everything, sequentially.**
   - No parallel Sonnet builders.
   - Sub-agents only for read-only lookups or an optional second-opinion review of a finished PR.
   - v1 has 115 tests, so no separate audit pass is needed. Refactor a v1 module when a milestone needs it, and keep its tests green or update them deliberately.
2. **Git and PR flow (agreed): PRs straight into `main`.**
   - One branch per milestone, or per sub-phase for big milestones: `v2/m<N>-<slug>` (e.g. `v2/m1-architecture`).
   - Open a PR into `main` with `gh pr create`. The CI must be green. Netlify posts a deploy preview on the PR.
   - **Post the preview URL for the user and stop at that point.** The user playtests and merges. **Never merge, force-push `main` or enable auto-merge yourself.**
   - If the user hasn't merged yet and you continue, stack the next branch on the previous one and note it in the PR body ("stacked on #N"). Rebase once the earlier PR merges.
3. **`main` is live** (Netlify site `machzero`, https://machzero.netlify.app, connected to this repo). Every merge must leave the game complete and playable.
   - Unfinished 2.0 surfaces sit behind `src/core/features.ts` flags, off on `main` builds until their milestone is complete.
   - The URL param `?features=all` (or a list such as `?features=garage,worlds`) enables them in previews.
4. **Commit hygiene.**
   - No session IDs, chat transcripts or `.claude/` content in commits or PR bodies (`.claude/` is git-ignored).
   - Conventional, descriptive messages.
   - Run `npm run codebase` at the end of each milestone so `CODEBASE.md` stays current.
5. **Local gates before every push:**

   ```
   npm run typecheck && npm test && npm run build && npm run size && npm run smoke
   ```

   The headless sims are the physics and AI guardrail: when one fails, **debug the root cause** (see TDD §7 for how the corkscrew bug was found) instead of loosening assertions.
6. **Library docs:** confirm current APIs through Context7 before using them. That covers three.js r186 addons, Rapier 0.21, Preact and Signals, `@gltf-transform`, Playwright and the Web Audio details.
7. **Local dev port:** 5173 is taken on this machine by another project, so use `npm run dev -- --port 5180`. `.claude/launch.json` already points there.
8. **Performance budget is a feature.** Any new effect must declare how it scales across Low, Med and High (§M1.6).

---

## 1. Where v1 stands (map of the code you'll change)

| Area | Files | 2.0 impact |
|---|---|---|
| Contracts | `src/core/contracts.ts`, `events.ts`, `config.ts` | `ShipId` becomes `number`. Per-ship `ShipStats` replace the global physics constants in `CONFIG`. Track features, branches and hazards are added. |
| Boot/loop | `src/main.ts` (single race, built once), `core/loop.ts` | Becomes `src/app/App.ts` with a scene flow; each race is a disposable `RaceSession`. |
| Track | `track/TrackGenerator.ts` (seeded pipeline), `TrackLayout.ts` (random star layout), `TrackFrames.ts` (frames, bank, corkscrew roll), `TrackSweep.ts`, `TrackMesh.ts`, `TrackQuery.ts`, `TrackTextures.ts` | Split into a **layout source** (seeded *or* authored JSON) → shared frames, sweep and collision. Adds jump gaps, pipe cross-sections, a loop and branches. |
| Physics | `physics/ShipController.ts` (≈35 `CONFIG.*` reads + local `TUNING`), `PhysicsSystem.ts`, `InputManager.ts` | Reads `ShipStats`. Adds air sections and gravity scale, pipe handling, drafting, hazards, assists and touch input. |
| Graphics | `GraphicsSystem.ts`, `Environment.ts` (synthwave only), `ShipModel.ts` (procedural ship), `PostFX.ts`, `Effects.ts`, `SpeedLines.ts`, `ChaseCamera.ts` | Adds a `WorldTheme` per world, GLB ships with sockets, quality presets, reduced motion and ghost rendering. |
| Game | `AIDriver.ts` (`PROFILES` per personality), `RaceManager.ts`, `HUD.ts` + `hud.css`, `Minimap.ts`, `AudioSystem.ts` | Adds AI tiers × personalities, 8 ships, modes (Tour/GP/TT), the Preact menus, a music sequencer and an SFX bank. |
| Tests | `src/**/__tests__`, `src/sim/race.sim.test.ts`, `src/sim/corkscrew.sim.test.ts` | Sims become a 5-tracks × 4-tiers matrix plus a per-gimmick hold test. |

**Physics invariants to keep** (all from v1 Phase 3; their tests enforce them):
- The hover damper uses velocity *relative to the surface*.
- A two-sided magnetic lock (`TUNING.MAGNET_LOCK_G`) holds ships down while grounded.
- A grounded hull locks to the ray normal and carries its velocity through the re-alignment rotation.
- Twist compensation yaws the heading at `L·k²·v/(1+L²k²)`.
- `TrackSample.curvature` is measured in the unbanked frame.

---

## 2. Target architecture

```
src/
  app/            App.ts (scene flow), RaceSession.ts (one race: build → run → dispose), routes.ts
  core/           contracts.ts, events.ts, config.ts (global only), features.ts, loop.ts, math.ts, rng.ts, controls.ts
  content/        ships.ts, parts.ts, pilots.ts, worlds.ts, tiers.ts, economy.ts, tracks/*.json, registry.ts
  save/           SaveStore.ts (versioned localStorage), migrations.ts, GhostStore.ts (IndexedDB)
  settings/       Settings.ts (signals), QualityManager.ts (presets + auto-detect)
  assets/         AssetLoader.ts (GLTFLoader + MeshoptDecoder, per-world bundles, progress)
  track/          (v1) + TrackSource.ts (seeded | authored), features/{jump,pipe,loop,branch}.ts, TrackValidate.ts
  physics/        (v1) + ShipStatsResolver.ts, Drafting.ts, Hazards.ts, Assists.ts, TouchInput.ts
  graphics/       (v1) + themes/{neonBay,sunsetMesa,cryoStation,jadeRuins,orbitalRing}.ts, ShipAssembly.ts, Ghosts.ts
  game/           (v1) + modes/{WorldTour,GrandPrix,TimeTrial}.ts, GhostRecorder.ts, Tiers.ts
  audio/          (moved from game) AudioSystem.ts, MusicSequencer.ts, songs/*.ts, SfxBank.ts, sfxPresets.ts
  ui/             Preact screens: Boot, ProfileSelect, MainMenu, WorldMap, Garage, LiveryEditor, TimeTrialSelect,
                  Settings, Pause, Results, CupStandings, components/*, ui.css
  sim/            headless sims (matrix), gimmick hold tests, balance tests
blender/
  lib/            common.py (materials by name, sockets, export helpers)
  ships/          build_ships.py → public/game/ships/*.glb
  parts/          build_parts.py → public/game/parts/parts.glb
  props/          build_props_<world>.py → public/game/worlds/<world>/props.glb
scripts/          gen-codebase.mjs, build-assets.mjs (Blender + gltf-transform), check-assets.mjs, check-size.mjs,
                  bake-ghosts.mjs, track-preview.mjs (SVG top-down previews into docs/v2/tracks/)
public/game/    ships/ parts/ worlds/<id>/ ghosts/<trackId>.json  (committed build outputs)
e2e/              smoke.spec.ts (Playwright)
.github/workflows/ci.yml   netlify.toml   public/manifest.webmanifest   public/icons/*
```

**Dependencies to add:**
- `preact`
- `@preact/signals`
- dev: `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `meshoptimizer`, `fake-indexeddb` (tests)

`@playwright/test` was added in M0.

Three.js ships `MeshoptDecoder` (`three/addons/libs/meshopt_decoder.module.js`). Do **not** add KTX2: ship textures are avoided by design (§M2), and the few world textures are WebP or procedural.

---

## 3. Contract changes (land in M1, extend per milestone)

```ts
// core/contracts.ts (additions/changes; keep v1 names where possible)
export type ShipId = number;                       // was 0|1|2|3 — 8 ships now (0 = player)
export type ShipClass = 'light' | 'balanced' | 'heavy';
export type PartSlot = 'engine' | 'booster' | 'stabilizer' | 'hull';
export type PartTier = 0 | 1 | 2 | 3;              // Stock, Mk II, Mk III, Prototype
export type AITier = 'rookie' | 'pilot' | 'ace' | 'legend';

export interface ShipStats {                        // replaces per-ship reads of CONFIG.* in physics
  topSpeed: number; thrustAccel: number; boostTopSpeed: number; boostAccel: number;
  boostCost: number; boostTime: number; steerRate: number; steerRateHighSpeed: number;
  lateralGrip: number; airbrakeGrip: number; energyMax: number; damageTakenScale: number;
  mass: number;                                     // relative, 1 = v1; used for ship–ship push + accel
}
export interface Loadout { chassisId: string; parts: Record<PartSlot, PartTier>; livery: ShipLivery & { decal: number } }
export interface ShipDefinition {                   // extended
  id: ShipId; name: string; isPlayer: boolean; gridIndex: number;
  pilotId: string; loadout: Loadout; stats: ShipStats;   // stats resolved once by ShipStatsResolver
  personality?: AIPersonality; tier?: AITier;
  livery: ShipLivery;                               // kept for v1 consumers (= loadout.livery)
}
export interface Assists { autoAccelerate: boolean; steering: 0 | 1 | 2; noKO: boolean; earlyBoost: boolean }

// Track features (authored tracks carry them; the seeded generator emits only 'corkscrew', 'dash', 'pit')
export type TrackFeature =
  | { type: 'corkscrew'; dStart: number; dEnd: number; turns?: number }
  | { type: 'jump'; dTakeoff: number; dLanding: number; kick: number }        // open-air gap: no surface, no rails
  | { type: 'pipe'; dStart: number; dEnd: number; radius: number; transition: number }
  | { type: 'loop'; dStart: number; dEnd: number; sideOffset: number }
  | { type: 'branch'; id: string; dFork: number; dMerge: number; points: [number, number, number][]; halfWidth: number }
  | { type: 'dash' | 'pit'; dStart: number; dEnd: number; lateralMin: number; lateralMax: number }
  | { type: 'ice'; dStart: number; dEnd: number; lateralMin: number; lateralMax: number; grip: number }
  | { type: 'gate'; d: number; period: number; phase: number; closedFraction: number }
  | { type: 'mines'; dStart: number; dEnd: number; count: number; drift: number };

export interface TrackDefinition {                   // content/tracks/<id>.json
  id: string; worldId: string; name: string; laps: number;
  points: [number, number, number][];               // closed centripetal Catmull-Rom control points (m)
  halfWidth?: number; bankFactor?: number; maxBank?: number;
  airGravityScale?: number;                         // Orbital Ring < 1
  features: TrackFeature[];
  devTime?: number;                                 // total 3-lap time of the dev ghost (filled by bake-ghosts)
}
// TrackData (v1) gains:
//   id, worldId, laps, features, airGravityScale,
//   branches: TrackBranch[], hazards: HazardDef[],
//   surfaceKindAt(u, lateral): 'road' | 'air' | 'pipe' | 'ice'
// project(pos, hintU, hintBranch?) → TrackProjection + { branch: string | null; kind: SurfaceKind }
// ShipState gains: branch: string | null; drafting: number (0..1); airborne: boolean; lapsDone mirrors stay in RaceManager.
```

**New events:**
- `ship:jump` and `ship:land` `{intensity}`
- `ship:draft` `{active}`
- `hazard:mine` and `hazard:gate` `{point}`
- `ship:ice` `{active}`
- `ui:navigate`, `ui:confirm`, `ui:back`
- `economy:credits` `{delta, total}`
- `progress:unlock` `{worldId}`
- `race:cupStandings`

---

## M0 — v1 wrap-up, CI and deploy plumbing — ✅ DONE (PR `v2/m0-wrapup`)

What M0 delivered, so later milestones can rely on it:

- **`CODEBASE.md`** is generated by `npm run codebase`, which now also includes `.github`, `e2e`, `netlify.toml` and the Playwright config. Regenerate it at the end of every milestone.
- **`netlify.toml`:**
  - build `npm run build` → `dist`, `NODE_VERSION = "24"`
  - `/assets/*` (Vite's hashed bundles) are cached `immutable`
  - `/game/*` is cached 1 h with stale-while-revalidate
  - `/index.html` is `no-cache`
  
  **All 2.0 game content (GLB models, audio, ghosts) goes in `public/game/`**, never `public/assets/`: those files are unhashed and would otherwise be cached forever. Deploy previews on PRs are confirmed working (e.g. `deploy-preview-1--machzero.netlify.app`).
- **`.github/workflows/ci.yml`** runs two required jobs on every PR and on `main`:
  - `verify`: typecheck, `npm test` (unit + headless sims), build, `npm run size`
  - `smoke`: Playwright on Chromium with SwiftShader, run against `vite preview`; the report is uploaded on failure
- **`.nvmrc`** is 24. The scripts `npm run size` and `npm run smoke` exist.
- **Size budgets** (`scripts/check-size.mjs`), per bundle:

  | Bundle | Budget | Size at M0 |
  |---|---|---|
  | App JS (our code + three.js) | ≤ 600 KB gz | 197 KB (game 53 KB, three.js 145 KB) |
  | Rapier chunk | ≤ 1.7 MB gz | 1,615 KB |
  | `public/game/` | ≤ 15 MB | empty |

  `rapier3d-compat` embeds its 3 MB WASM as base64. **Optional M1 task:** load Rapier's WASM as a separate `.wasm` file (non-compat `@dimforge/rapier3d` + `vite-plugin-wasm`, keeping Node/vitest working). That saves about 470 KB gz and allows streaming compilation, which is worth it for phones. Afterwards, lower the Rapier budget to 1.2 MB.
- **Chunks:** `vite.config.ts` splits `rapier` and `three` into their own chunks (`build.rolldownOptions.output.codeSplitting.groups`).
- **`src/core/features.ts`:**
  - flags `profiles`, `garage`, `worlds`, `tiers`, `music`, `touch`, `modes`, all `false` on `main`
  - `?features=all` / `?features=a,b` / `?features=none`
  - `isEnabled(name)`
  - tested in `src/core/__features.test.ts`
  
  Flip a default to `true` in the PR that completes that milestone.

## M1 — Architecture refactor: data-driven content, 8 ships, app flow, saves, settings, quality — ✅ DONE (PRs #3 M1a, #4 M1b, #5 M1c)

**As built** (read this before M2; the plan below is kept for reference):

- **Where things live:** `app/App.ts` (routes, the long-lived renderer, audio, input, save and settings) and `app/RaceSession.ts` (one disposable race). The menus are in `ui/` (Preact) and share `ui/tokens.css` with the HUD. Saves are in `save/` (`schema.ts`, `migrations.ts`, `SaveStore.ts`); settings are in `settings/` (`Settings.ts` signals and `QualityManager.ts`).
- **Flags:** `profiles` is **on** by default from M1c. `?features=none` still gives the v1 start-screen flow on the new core; in that flow nothing is written to the v2 save, so the v1 → 2 migration can still pick up the v1 record later.
- **Difficulty:** races use the **Rookie fit** (stock rivals, player at the back) until M5. `App.raceTier()` switches to the profile's tier when the `tiers` flag is on.
- **v1 record migration:** `machzero.recordLap` becomes the Classic record (`records.classic`) of an active profile named PILOT (Classic preset).
- **Ship LOD row:** not applicable until the M2 GLB ships (the procedural ships have no LODs). **M2 must add a `lod` field to `QualityProfile`.**
- **Quality:**
  - Auto uses the device hint, which is recomputed at each launch.
  - Otherwise a benchmark runs: High is measured, then Med once if High is under 50 fps; a slow Med settles at Low. The result is saved as `settings.detectedQuality`.
  - `?quality=low|med|high` overrides it for QA and isn't saved.
- **Settings UI:**
  - Music volume shows only with the `music` flag (M6).
  - `touchSteer` is stored but has no UI until M7.
  - Comfort colour-blind mode covers the energy bar; M7 extends it to track markers.
- **Not done:** the optional separate-WASM Rapier task. The Rapier budget stays at 1.7 MB.
- **AI fix found by the 8-ship sim:** each AI keeps to its own side of the rival it avoids (`AIDriver`, avoidance block).
- **Input:** `InputManager` ignores key events whose event path contains `[data-ui-root]` or a text field. The menu UI handles its own keyboard focus; gamepad input reaches the UI through `App.navHandler`.


The biggest refactor, done first so every later milestone plugs into it. Split it into 2–3 PRs if large (1a contracts + stats + 8 ships; 1b app flow + saves + settings; 1c quality).

### M1.1 Per-ship stats
- Add `ShipStats` and `content/ships.ts` (chassis → class → base stats), `content/parts.ts` (slot × tier deltas, Appendix A) and `physics/ShipStatsResolver.ts` (`resolveStats(loadout) → ShipStats`, pure and unit-tested).
- `ShipController`: replace every per-ship `CONFIG.*` read (`TOP_SPEED`, `THRUST_ACCEL`, `BOOST_*`, `STEER_RATE*`, `LATERAL_GRIP`, `AIRBRAKE_GRIP`, `ENERGY_MAX`, damage) with `this.stats.*`.
- World constants (hover, magnet and respawn values) stay in `CONFIG`.
- The COMET/Balanced stock stats **equal v1 constants exactly**, so every v1 test must pass unchanged. That is the refactor's proof.
- Ship–ship collisions: collider density ∝ `mass`.
- Energy: replace `CONFIG.ENERGY_MAX` everywhere, including the HUD bar and AI pit logic, with `ship.def.stats.energyMax`.

### M1.2 Eight ships
- `ShipId: number`.
- `SHIP_ROSTER` moves to `content/pilots.ts` and is built from a race setup (player loadout + 7 rival pilots at tier-appropriate parts).
- The track generator builds **8 grid slots**: 4 rows × 2 staggered, 12 m apart. The player starts P8 on Rookie, P5 otherwise.
- Update the HUD standings (8 rows), the minimap dots and the results table.
- Physics performance: 8 ships × 120 Hz × 4 rays. Measure; the v1 budget was 0.19 ms per step for 4 ships.

### M1.3 App flow and RaceSession
- `src/app/App.ts` replaces the body of `main.ts`. It holds a scene state machine: `boot → profileSelect → mainMenu → (worldMap | garage | timeTrialSelect | settings) → loading → race → results → …`.
- `RaceSession` owns track, physics, graphics scene contents, drivers, `RaceManager`, HUD and audio bindings for one race, with a full `dispose()`.
- Keep one `WebGLRenderer` and `GraphicsSystem` for the app's lifetime; add `GraphicsSystem.clearRace()`.
- Rapier world: create and `free()` per race.
- Verify there are no leaks by starting and quitting 10 races in a vitest loop with node-safe systems, and in the browser with `renderer.info.memory`.
- The v1 flags `?autopilot=1`, `?debug=1` and `?seed=N` keep working. `?seed` starts a Bonus Track race directly.

### M1.4 UI shell (Preact + Signals)
- `src/ui/` with the `ProfileSelect`, `MainMenu` and `Settings` screens, plus placeholders gated by feature flags for the rest.
- All menus are fully navigable by keyboard, gamepad (reuse `InputManager.consume` menu actions) and touch.
- Neon style shared with `hud.css` (extract tokens into `ui/tokens.css`).
- The in-race HUD stays as v1 direct DOM.

### M1.5 Saves and settings
- `save/SaveStore.ts`: key `machzero.save`, shape `{ version, profiles[], activeProfileId, settings }`. Ordered migrations `migrations.ts` (`v1 → 2`: import `machzero.recordLap` as `records.classic`).
- Wrap all storage in try/catch; fall back to in-memory with a one-time toast.
- Export/import JSON through a file download and a file input.
- `settings/Settings.ts` holds signals for volumes, reduced motion, colour-blind mode, large text, key bindings, quality preset and touch layout.
- **Tests:** round-trip, each migration, corrupt data → safe defaults, quota errors.

### M1.6 Quality presets

| Setting | Low | Med | High (= v1) |
|---|---|---|---|
| Render scale (× devicePixelRatio, capped) | 0.75 × 1 | 1 × 1.5 | 1 × 2 |
| MSAA scene pass | off | 2× | 4× |
| Bloom resolution | ¼ | ½ | ½ |
| Radial speed blur | off | 6 taps | 10 taps |
| Chromatic aberration | off | on | on |
| Shadows | off | ships only, 512 | ships only, 1024 |
| Scenery density | 35% | 70% | 100% |
| Particles / speed lines | 30% | 60% | 100% |
| Ship model | LOD1 | LOD0 player, LOD1 rivals | LOD0 |
| Draw distance (fog) | shorter | medium | v1 |

- `QualityManager.detect()`: iOS/Android or ≤ 4 cores → start at Low. Otherwise run a 2 s title-screen benchmark: under 50 fps on High steps down, and it repeats once.
- **Reduced motion** is applied on top of any preset.
- `PostFX` and `Effects` expose `setQuality(q)`.

**M1 done when:**
- All v1 tests pass (stats parity).
- A new 8-ship sim finishes on the v1 seed track.
- Profiles persist across reloads.
- Settings apply live.
- The smoke test passes.
- Menus work by keyboard, gamepad and touch.
- Flags keep the unfinished garage and world map hidden on `main`.

---

## M2 — Blender ships, parts, garage, livery editor — ✅ DONE (PRs #6 M2a, #7 M2b)

**As built** (read this before M3; the plan below is kept for reference):

- **Assets:** `npm run assets` runs the scripts in `blender/` and then glTF Transform (dedup, weld, meshopt with quantisation) into `public/game/`. Sizes: ships ≈ 48–50 KB each, `parts.glb` 84 KB, 377 KB in total. LOD0 is ≈ 3.1k triangles, LOD1 ≈ 0.85k.
  - `scripts/check-assets.mjs` runs inside `npm test`.
  - Meshopt quantisation puts the dequantisation scale and offset on the **node transform**. Clone the LOD node with its transform; never reset it.
- **Runtime:**
  - `assets/AssetLoader.ts` loads the GLBs when the `garage` flag is on (it is on by default from M2b). If loading fails, the procedural v1 ships are used.
  - `graphics/ShipAssembly.ts` clones the chassis, bolts the parts to the sockets, and applies livery materials with 6 procedural decals (body coordinates in `COLOR_0`). `setLivery()` recolours in place.
  - `ShipModel` takes an optional assembled ship and keeps v1's motion and effects.
  - **LOD is picked in `GraphicsSystem.addShip` by preset** (High LOD0; Med LOD0 for the player, LOD1 for rivals; Low LOD1). There is no `lod` field on `QualityProfile`.
- **Economy** (`content/economy.ts`): payouts × tier multiplier (every place pays, rounded to 10), plus `settleRace`, `buyPart`, `equipPart` and `selectChassis`. These are pure and unit-tested.
  - Chassis are free.
  - Buying pays, owns and fits the part. Owned parts refit for free. Nothing can be sold.
  - The App pays at `race:results` and emits `economy:credits {delta, total}`; the HUD results screen shows it.
- **Garage** (`ui/screens/Garage.tsx`, route `garage`): tabs SHIP / ENGINE / BOOSTER / STABILIZER / HULL / PAINT.
  - Hovering or focusing an option previews it on the turntable and as ghost stat bars. Stat bars come from `ui/garageModel.ts` (5 bars, normalised over every class × part combination).
  - A confirm dialog (Escape or B cancels) guards purchases. Locked tiers say how many credits are missing.
  - **Turntable:** `graphics/ShipPreview.ts` is drawn by `GraphicsSystem` into the stage element's rectangle with a scissor viewport. **While the garage is open the race backdrop is not rendered** (the garage is a dark studio), which halves the GPU cost.
  - Replaced turntable ships are disposed only after the new one has rendered, so shader programs aren't recompiled on every hover.
- **Livery editor:** 8 curated neon swatches plus a full-saturation hue slider for body, trim and glow; 6 decals; a FACTORY COLOURS reset.
- **Menu fix found by a flaky e2e:** profile changes no longer rebuild the race in the background (that froze the menus for 5.6 s on SwiftShader). Races are built in `startRace`, behind the loading screen, after one paint. The menus e2e asserts that no main-thread task is ≥ 2 s.
- **Tests:** whole-race sim files set `vi.setConfig({ testTimeout: 300_000 })`. These are wall-clock allowances for busy machines; the assertions are unchanged.
- **Deviation:** `worlds` stays **off**. It would only show a "coming soon" placeholder until M3 builds the world map, so M3 turns it on.

### M2.1 Asset pipeline

```
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/ships/build_ships.py -- --out public/game/ships
```

- The pipeline is wrapped by `npm run assets` (`scripts/build-assets.mjs`): it runs each Blender script, then optimises every GLB with gltf-transform (`dedup`, `weld`, `quantize`, `meshopt`) and prints sizes.
- Committed GLBs are the source of truth for the web build. CI does **not** run Blender, but `check-assets.mjs` validates the committed files.

**Blender script conventions** (`blender/lib/common.py`):
- Deterministic: no unseeded randomness. Blender 5.2 LTS. Metric units; 1 BU = 1 m.
- **Nose along Blender +Y**, up +Z. The glTF exporter converts this to Y-up with the nose at −Z, which matches v1's ship frame (forward −Z).
- **No textures.** Materials are named by role, and `ShipAssembly` replaces them at runtime:
  - `livery_primary`, `livery_secondary`: MeshPhysicalMaterial tinted from the livery.
  - `glow`: emissive HDR at the livery glow colour, driven by throttle and boost as in v1's `ShipModel`.
  - `metal`, `glass`, `dark`.
  - Decals are baked as vertex-colour masks: `COLOR_0` channels select the decal pattern.
- **Sockets:** empties named `socket_engine`, `socket_booster_L`, `socket_booster_R`, `socket_stabilizer`, `socket_hull`, `socket_exhaust_L`, `socket_exhaust_R` (effects anchor there), `socket_camera` (optional chase offset).
- **Two LODs per ship:** `<id>_LOD0` ≤ 12k triangles, `<id>_LOD1` ≤ 4k. Parts ≤ 1.5k triangles each, in `parts.glb` named `engine_t0..t3`, `booster_t0..t3`, `stabilizer_t0..t3`, `hull_t0..t3`, with class-specific variants where needed (`hull_t2_heavy`).
- **Size:** the hull fits inside SHIP_LENGTH × SHIP_WIDTH × SHIP_HEIGHT scaled by class (Light 0.9, Heavy 1.12). The physics collider stays a cuboid resized from class dimensions (add them to `content/ships.ts`).

**Blender MCP (optional, for iteration):** the add-on was updated to protocol 11 on 2026-09-29. Start it with Blender → Preferences → Add-ons → enable **MCP for Blender** → *Start MCP Server*. Use `mcp__blender__execute_blender_code` to run the same `blender/` scripts live and `get_viewport_screenshot` to review shapes. Commit only the script changes, never `.blend` binaries.

`scripts/check-assets.mjs` uses `@gltf-transform/core` in Node. It checks:
- the expected node and socket names exist;
- the triangle budgets;
- the material role names;
- the nose direction (the hull's bounding box is longer toward −Z);
- file size ≤ 400 KB per ship and ≤ 600 KB for `parts.glb`.

It runs in `npm test` through a vitest wrapper, so CI enforces it.

### M2.2 Runtime
- `assets/AssetLoader.ts`: GLTFLoader + MeshoptDecoder, promise cache, progress events for the loading screen.
- `graphics/ShipAssembly.ts`: clones a chassis, attaches the part meshes at sockets, applies livery materials and picks the LOD by quality.
- `ShipModel` (v1, procedural) is kept as a **fallback** if loading fails and for headless contexts. Refactor it to accept an assembled `Object3D` while keeping its v1 behaviour: bank, hover bob, flaps from airbrake inputs, glow driven by throttle and boost, flicker and destroyed.
- `Effects` reads exhaust positions from the sockets.

### M2.3 Garage and livery editor (Preact)
- **Garage:** chassis carousel (3D turntable in a dedicated small render using the shared renderer and scissor viewport), 4 slot tabs, tier cards with price and owned/equipped state, stat bars with a before/after ghost bar, a purchase confirm dialog and the credit balance.
- **Livery editor:** 3 colour pickers (curated neon swatches plus a hue slider suitable for kids) and 6 decal patterns, with a live turntable preview.
- Economy rules are in `content/economy.ts` (prices, payouts, tier multipliers). The garage can't sell parts, which keeps things simple for kids.

**M2 done when:**
- All 6 ships and 16 parts render correctly on Low, Med and High.
- Purchases persist.
- Stats change race behaviour: the sims show a Prototype-engine ship's top speed is higher.
- `check-assets` passes.
- Assets fit their budgets.
- The garage and world map are enabled on `main` (flags on).

---

## M3 — Track framework + Neon Bay + Sunset Mesa — ✅ DONE (PR #9)

**As built** (read this before M4; the plan below is kept for reference):

- **Track sources:** `track/TrackSource.ts` (`{ kind: 'seeded' | 'authored' }` → `BuiltLayout`) feeds one `buildTrack` in `TrackGenerator.ts`. `generateTrack({ seed })` is unchanged for the v1 / Bonus Track and produces the identical seed-7331 track. `TrackData` gained `id`, `worldId`, `name`, `laps`, `features`, `jumps`, `airGravityScale`, `surfaceKindAt()` and `safeRespawnU()`; `corkscrew` is now nullable (the first corkscrew).
- **Authoring:** tracks are designed as turtle segments (straights and arcs with end elevations) in `scripts/track-design.mjs` (`npm run tracks:design`), which solves two marked straights so the loop closes exactly and writes `src/content/tracks/<id>.json` (control points + features in metres). Validate with `npm run tracks:check`; `npm run tracks:preview` writes `docs/v2/tracks/<id>.svg` (plan by elevation, gaps dashed, features, elevation profile). `track/TrackValidate.ts` checks radius, clearance, elevation, start straight, feature overlap, straights under corkscrews/jumps (plus a 250 m run-out after each landing) and a 30–45 s lap estimate.
- **Jumps** (`track/features/jump.ts`): the builder adds a quadratic kicker (`kick` m over 60 m) and bends the centerline through the gap along the flight path of a ship at `designSpeed` (default **95 m/s**, so every racing speed flies at or above it), then blends back over 110 m. The displacement is applied to the fine spline samples before arc-length resampling, so frames/project()/AI need no special cases. Gaps snap to frame samples; deck, slab, rails and collision are swept per road section, with end caps, lip lights and accent chevrons on the ramp.
- **Jump physics** (`ShipController`): no hover spring over a gap; air gravity × `airGravityScale`; a jump lasts until the hull is back in hover range (rays that see the deck from metres up must not engage the magnetic lock — that held boosted ships in a slow damped glide); `ship:jump` / `ship:land`; `lastValidU` is never a gap position and respawns near a jump go to the landing side.
- **AI:** corkscrews and jump approaches are driven near the centre; the AI no longer boosts below its pit threshold unless the pit is within reach (a boost-happy Light ship chained boosts to 26 energy and one collision destroyed it).
- **Worlds:** `content/worlds.ts` (5 worlds, palettes, `built`), `content/tracks/` (Neon Bay 4.2 km, Sunset Mesa 4.36 km with 2 jumps). Profiles store `world`; `?world=<id>` overrides it for QA. Menu: **WORLDS** → `ui/screens/WorldSelect.tsx` (mini maps, gimmick, best lap, locked cards for worlds 3–5); RACE goes to the last world. Records are keyed by track id.
- **Themes:** `graphics/themes/` (`WorldTheme` interface; `neonBay.ts` is v1's Environment plus Blender landmarks; `sunsetMesa.ts`). `GraphicsSystem.setWorld()` swaps sky/fog/lights/scenery; `setWorldProps()` takes `public/game/worlds/<id>/props.glb` (loaded by the App; procedural fallback). Track neon colours come from the world palette. Heat shimmer is a PostFX pass on Med/High, off with reduced motion.
- **Props:** `blender/props/build_props.py` (`npm run assets -- props`): baked vertex colours, flat-shaded, roles `sandstone`, `chrome`, `dark`, `neon`, `foliage`. Quantisation can move a prop's mesh to an unnamed child node — always use the subtree's `matrixWorld`. Neon Bay 28 KB, Sunset Mesa 72 KB; `check-assets` validates them.
- **Tests (M3):** authored-track tests, jump hold sim (2 jumps × 4 speeds × 3 lines + a missed jump), corkscrew hold on the v1 seed and Neon Bay, world race sims. **Deviation (user decision):** keep every test fast, so the world sims run the Rookie and Legend fits per world (the v1 seed sims cover Pilot) instead of 4 tiers; the full `npm test` runs in ~14 s locally. Visual checks are left to human playtesting.


### M3.1 Authored tracks
`track/TrackSource.ts` defines `TrackLayoutSource = { kind: 'seeded', seed } | { kind: 'authored', def: TrackDefinition }`. Refactor `generateTrack` into two steps:
1. `layoutFrom(source)`: points → curve → resample → differentials. The seeded source reuses `TrackLayout.createLayout`; the authored source builds a centripetal Catmull-Rom directly from `def.points`.
2. `buildTrack(layout, features)`: frames → sweep → collision → zones → grid. This is the existing v1 pipeline, generalised.

**`TrackValidate.ts`** runs in tests and in `npm run tracks:check`. It checks:
- minimum radius ≥ 60 m (≥ 45 m allowed inside a `loop`);
- 3D clearance ≥ 12 m between non-adjacent sections (overpasses and loops);
- elevation stays within the world's bounds;
- features don't overlap each other or the start and pit areas;
- lap length gives the target lap time.

`scripts/track-preview.mjs` writes an **SVG top-down plus elevation profile** per track to `docs/v2/tracks/` for review.

### M3.2 Gimmick features
- **Corkscrew:** generalise v1's `corkscrewRoll` to `turns` and to any authored range.
- **Jump (air section):**
  - No surface or rails between `dTakeoff` and `dLanding`. The sweep skips those rings and the collision meshes stay open.
  - A ramp `kick` raises the takeoff lip. The centerline continues through the gap as a ballistic-ish arc, so `project()` and the AI still work.
  - Physics when airborne: gravity `−sample.up × MAGNET_G × airGravityScale`. v1's air branch already pulls toward `sample.up`; add the scale.
  - Landing: the spring catches the ship, and `ship:land` fires with intensity from the normal speed.
  - A missed landing falls into the respawn net. That is by design, not a bug.
  - The sims allow one respawn per jump for the **erratic** personality only. Every other ship must clear every jump.
- **Pipe:**
  - The cross-section transitions from ribbon to half-pipe to a full circle of radius `R` (≈ 9 m) over `transition` metres, then back.
  - Inside the pipe there are no rails. `project()` returns `lateral = R·θ` (θ is the angle from the floor, wrapping ±πR) and `height = R − radial distance`, and adds `kind = 'pipe'`.
  - Physics needs little change, because hover rays follow the ray normal and v1's magnet lock plus velocity transport already hold on curved surfaces. Only the respawn lateral check is disabled for `kind = 'pipe'`.
  - Graphics adds interior neon rings. The AI steers to a target θ, and the racing line may climb the walls.
  - **Hold test:** as with v1's corkscrew test, drive the pipe at θ ∈ {0, ±60°, ±120°, 180°}.
- **Loop:**
  - The centerline forms a vertical loop with `sideOffset` so the exit passes beside the entry. RMF frames with bank forced to 0.
  - Validate 3D clearance. The magnet lock holds the ship at speed.
  - Speed-floor safeguard (arcade): inside a loop, forward speed is floored at 55 m/s so a stalled ship can't fall off the top.
  - **Hold test:** 5 lateral offsets, as in `corkscrew.sim.test.ts`.
- **Branch (split path):**
  - A second centerline between `dFork` and `dMerge`, swept and collided like the main track, with a divider wall at the fork.
  - `TrackQuery` gains a branch-aware `project(pos, hintU, hintBranch)`. Branch distance maps linearly onto main-loop `u` over `[dFork, dMerge]`, so `trackU` and race progress stay one-dimensional.
  - `ShipState.branch` is set by physics when the projection prefers the branch.
  - The AI chooses per tier and personality: Rookie always safe; Legend takes the shortcut unless low on energy; erratic 50/50.

### M3.3 World themes (graphics)
- Refactor `Environment.ts` into `graphics/themes/*.ts`. Each theme exposes `WorldTheme { sky, fog, lights, palette, trackPalette (neon strip colours), buildScenery(track, quality), update(camera, t), dispose }`.
- Track neon colours come from the theme; `TrackMesh` takes a palette parameter instead of hard-coded `PALETTE`.
- Scenery combines instanced procedural geometry with Blender prop GLBs (`blender/props/build_props_<world>.py`, ≤ 2.5 MB per world including everything). Everything stays outside the ~80 m track corridor (v1 skyline logic).
- **Neon Bay:** rebuild v1's look on an authored track with the corkscrew, and remaster the skyline with Blender props.
- **Sunset Mesa:** gradient sunset sky with airbrush bands, sandstone mesas (Blender props), chrome pylons, retro billboards (procedural neon text), heat shimmer (Med/High only) and 2 jumps.

**M3 done when:**
- Both worlds are playable via a feature-flagged world select.
- The sims pass on both tracks × 4 tiers, and the jump and corkscrew hold tests pass.
- SVG previews are committed.
- The Bonus Track (seeded) still works.

---

## M4 — Cryo Station, Jade Ruins, Orbital Ring + hazards

- **Cryo Station:**
  - Pipe section, aurora sky shader, ice spires, frosted-glass tube material (transmission on High, faked on Low).
  - **Ice patches:** zone `ice`, where lateral grip is multiplied by `grip` (≈ 0.3), with a glossy decal on the surface and `ship:ice`.
- **Jade Ruins:**
  - Split path, jungle canopy (instanced cards), temple props, holographic glyphs, fireflies (particles).
  - **Stone gates:** kinematic Rapier cuboids in the `RAIL` group, animated by a deterministic timeline from **race time**, not wall-clock, so the sims are reproducible. They show a 1.5 s warning glow before closing.
- **Orbital Ring:**
  - Loop plus low-gravity jumps (`airGravityScale ≈ 0.35`), Earth sphere with an atmosphere shader, station ribs, starfield.
  - **Mines:** kinematic sensor balls drifting on deterministic Lissajous paths. On contact: impulse + `CONFIG.MINE_DAMAGE` energy loss + `hazard:mine`. The mine respawns after 6 s.
  - **Debris:** visual-only on Low; on Med/High, small kinematic obstacles.
- **Rookie/No-KO rule:** a `HazardPolicy` from the race setup gives earlier telegraphing (a 2× longer warning glow), no energy damage, and a slowdown only (a velocity scale of 0.85 on hit).
- **AI hazard awareness:** the look-ahead scans upcoming hazards. Ice → brake earlier and hold a straighter line. Gates → wait or accelerate based on the timeline. Mines → lateral avoidance like v1's rival avoidance.

**M4 done when:**
- All 5 worlds pass the sims × 4 tiers.
- The pipe and loop hold tests pass.
- Hazards are deterministic in the sims.
- Each world is ≤ 2.5 MB and the total is ≤ 15 MB.
- Low preset holds ≥ 30 fps on the Cryo pipe on the iPad smoke test (manual, by the user on the preview).

---

## M5 — AI tiers, pilots, drafting

- `content/tiers.ts` scales v1's `AIDriver` `PROFILES` (latBudget, yawFactor, brakeDecel, overspeedTol, boost policy, pitEnergy, lookScale) per tier. Each tier also adds:
  - `paceScale` (a throttle cap: Rookie 0.75, Pilot 0.88, Ace 0.97, Legend 1.0)
  - `mistakeRate`
  - `lineInset`
  - `rubberBand` (min/max), replacing `CONFIG.AI_RUBBER_BAND_*`
  - `aggression`
  - `draftSeeking`
- Final behaviour is the tier ceiling combined with the personality flavour (§SPEC 5.3).
- **Drafting** (`physics/Drafting.ts`): if a ship is within 30 m directly ahead in a ±12° cone relative to your forward direction and within 4 m laterally, draft builds over 0.6 s to a drag reduction plus an acceleration bonus of up to +6% top speed. It is shown by a HUD icon, a shimmer effect and `ship:draft`.
- **Pilots:** `content/pilots.ts` holds the 7 rivals: name, chassis, livery, personality, a portrait-badge recipe (procedural SVG) and a catchphrase. Show them on a grid intro card before the countdown (skippable) and on the results screen.
- **Sims:** the matrix of 5 tracks × 4 tiers asserts that everyone finishes and that the order roughly follows tier: the mean finishing position of Legend-parts AI is better than Rookie-parts AI in a mixed field.
- **Balance tests:**
  - A Rookie-assisted autopilot (strong steering assist) on stock parts finishes top 3 against Rookie AI.
  - An unassisted Pilot-level autopilot on stock parts finishes mid-pack against Pilot AI.
- Run the sims with fixed seeds, and budget CI time: each race ≈ 1–2 s headless, 20 races + holds ≈ 60 s.

---

## M6 — Audio: music sequencer + expanded SFX

- Move `game/AudioSystem.ts` → `audio/AudioSystem.ts` (keep its bus subscriptions).
- Add a routing graph: master → (music bus, sfx bus, ui bus), with compressor and limiter, and ducking of music under countdown and stingers.
- **`MusicSequencer`:**
  - Pattern-based: tempo, 16-step patterns, song order.
  - Instruments: saw/square/triangle, PWM, noise drums, simple FM bass, with ADSR, filter envelope, delay and chorus sends.
  - Scheduled with the look-ahead scheduler pattern (Web Audio clock, 100 ms horizon), not `setInterval` timing.
  - Songs live in `audio/songs/<world>.ts` as data: 7 songs (5 worlds, menu, results), each 60–90 s looping, each in a distinct mode and tempo (e.g. Neon Bay 118 BPM minor synthwave; Orbital Ring 96 BPM ambient arpeggios).
- **`SfxBank`:** jsfxr-style parameter presets (`sfxPresets.ts`), rendered once through `OfflineAudioContext` into buffers at boot, idle-time and lazily. Presets cover the full SPEC §8 list, plus a per-class engine voice (Light: higher and thinner; Heavy: low, with more sub).
- **CC0 samples:** at most 5 small OGG and M4A files for explosion and impacts under `public/game/audio/` (keep a CREDITS.md). iOS needs M4A/AAC or MP3 as a fallback for OGG.
- **iOS audio unlock:** resume the AudioContext inside the first touchend. Handle the ringer silent switch by documenting it (Web Audio respects it on iOS).
- **Tests:** the sequencer schedules the right note count for a pattern (fake AudioContext), and the SFX presets render non-silent buffers (OfflineAudioContext polyfill, or skip in node).

---

## M7 — Touch, tilt, iPhone/iPad, comfort settings

- **`physics/TouchInput.ts`** implements `IInputManager` and merges with keyboard and gamepad:
  - Left zone: horizontal drag slider, with origin set on touchstart and ±60 px = full lock.
  - Right zone: brake and boost buttons, plus accelerate when not auto-accelerating.
  - Air-brake buttons at the top corners and pause at the top centre.
  - Uses pointer events with `touch-action: none`. Multi-touch safe.
  - Haptics via `navigator.vibrate` where supported (not iOS).
- **Tilt:** `DeviceOrientationEvent.requestPermission()` from a Settings tap (iOS 13+). Steer from gamma, relative to a calibrated neutral angle, with a 3° deadzone and adjustable sensitivity.
- **Layout editor (light):** left-handed swap and button scale (S, M, L).
- **Web app manifest** plus icons (generated at build from an SVG badge), `display: fullscreen`, `orientation: landscape`, and a rotate-device overlay in portrait.
- Safe-area insets (`env(safe-area-inset-*)`) for the notch and home bar.
- **Comfort settings** live from M1, completed here:
  - Reduced motion (PostFX, SpeedLines, ChaseCamera shake and FOV punch off or gentle).
  - Colour-blind palette plus shape cues on the HUD and track markers.
  - Large-text HUD scale.
  - Key remapping UI.
- **Assists** (`physics/Assists.ts`):
  - Auto-accelerate: throttle 1 unless braking.
  - Steering assist: blend the player's steer toward an internal `AIDriver`-style line-following steer (weight light 0.3, strong 0.6), plus a rail repulsion when within 2 m of a rail.
  - No-KO: energy floor 1 and ×0.5 damage.
  - Early boost: `boostUnlocked` from lap 1.
  
  Assists run in the fixed step between input and physics, so they are deterministic and can be tested in the sims.
- **Device QA:** the user tests on a real iPhone and iPad through the PR preview. Add a checklist to the PR body:
  - rotate
  - Add to Home Screen
  - audio unlock
  - 3-lap race on Low at ≥ 30 fps (`?debug=1` overlay)
  - tilt permission

---

## M8 — Progression, modes, ghosts, polish → 2.0 complete

- **Modes** (`game/modes/*`) drive `RaceSession` setup and results handling:
  - **WorldTour:** unlock rules, per-tier trophies, credits.
  - **GrandPrix:** 5 races, points 10‑8‑6‑5‑4‑3‑2‑1, cup standings screen between races, tiebreak on best finish.
  - **TimeTrial:** solo, with ghosts and medals.
- **Ghosts:**
  - `GhostRecorder` samples the pose at 20 Hz (position Float32 ×3 plus quaternion as smallest-three int16), about 20 KB per 3-lap run, and stores it in IndexedDB through `GhostStore`.
  - `Ghosts.ts` renders translucent, unlit, depth-tested ships with a fade near the camera.
  - **Dev ghosts:** `npm run ghosts:bake` runs a headless Legend autopilot on each track, writes `public/game/ghosts/<trackId>.json` and fills `devTime`. Commit the output. Medals are gold ≤ devTime × 1.02, silver ≤ 1.08, bronze ≤ 1.18.
- **World map screen:** the 5 worlds as planets or islands on a retro starmap, showing lock state, trophies per tier and best times.
- **Results:** credit tally animation, unlock fanfare, pilot quotes.
- **Onboarding** for a first-time profile:
  - "New to racing?" → Rookie preset.
  - A 30-second interactive tutorial overlay on the first Neon Bay race (steer, boost, pit, air-brake), which can be skipped.
- **Balance pass:** tune `content/*` against the SPEC §9 targets using the sims, then play every world on Rookie with assists and on Legend without.
- **Flags:** turn every 2.0 feature flag on for `main`, then remove dead flag code.
- Update the README, `docs/TDD.md` (a v2 architecture section) and `CODEBASE.md`. PR titled **"MachZero 2.0"** with a feature summary, screenshots from each world and the full QA checklist.

---

## Appendix A — Stats (Balanced/Stock = v1 `CONFIG` values)

| Stat | Light | Balanced | Heavy |
|---|---|---|---|
| topSpeed (m/s) | 134 | 140 | 146 |
| thrustAccel (m/s²) | 70 | 62 | 54 |
| steerRate / steerRateHighSpeed (rad/s) | 2.1 / 1.45 | 1.9 / 1.25 | 1.7 / 1.1 |
| lateralGrip (1/s) | 8.5 | 7.5 | 6.5 |
| energyMax | 85 | 100 | 120 |
| damageTakenScale | 1.15 | 1.0 | 0.85 |
| mass | 0.8 | 1.0 | 1.3 |
| boostTopSpeed / boostAccel | 184 / 100 | 190 / 95 | 196 / 88 |

Part deltas per tier (Stock / Mk II / Mk III / Prototype). The effective thrust is `thrustAccel / (mass + Σ part weight)`, normalised so Balanced Stock = 62.

| Part | Effect | Weight |
|---|---|---|
| Engine | topSpeed +0/+3/+6/+10; thrustAccel +0/+3/+6/+8 | +0/+0.02/+0.04/+0.07 |
| Booster | boostTopSpeed +0/+5/+10/+15; boostCost 14/13/12/11; boostTime 1.6/1.7/1.8/2.0 | 0 |
| Stabilizer | steer ×1/1.04/1.08/1.12; lateralGrip +0/+0.5/+1/+1.5; topSpeed −0/−0.5/−1/−1.5 | 0 |
| Hull | energyMax +0/+10/+20/+30; damageTakenScale ×1/0.95/0.9/0.85 | +0/+0.03/+0.06/+0.1 |

Prices: 0 / 600 / 1500 / 3200 credits. Rival fits:

| Tier | Parts fitted |
|---|---|
| Rookie | all Stock |
| Pilot | 2 × Mk II |
| Ace | all Mk II + 2 × Mk III |
| Legend | Mk III, with Prototype engine and booster |

## Appendix B — Worlds at a glance

| World | Palette (neon) | Sky | Song | Gimmick | Hazard | Air gravity |
|---|---|---|---|---|---|---|
| Neon Bay | cyan / magenta | Night, synth sun, grid sea | 118 BPM synthwave (A minor) | Corkscrew | — | 1.0 |
| Sunset Mesa | amber / coral / chrome | Airbrush sunset bands | 124 BPM outrun (D Dorian) | 2 jumps | — | 1.0 |
| Cryo Station | ice blue / white / violet | Aurora night | 110 BPM chiptune-synth (E minor) | Full-pipe | Ice patches | 1.0 |
| Jade Ruins | jade / gold / UV purple | Misty dusk, fireflies | 128 BPM tribal-synth (G Phrygian) | Split path | Stone gates | 1.0 |
| Orbital Ring | white / electric blue / red | Space, Earth below | 96 BPM ambient arpeggio (C Lydian) | Loop + low-g jumps | Mines + debris | 0.35 |

## Appendix C — Test matrix added in 2.0

| Test | Where | Gate |
|---|---|---|
| Stats parity (Balanced Stock = v1) | `physics/__tests__` | every v1 physics test unchanged |
| Race sim 5 tracks × 4 tiers × 8 ships | `sim/race.matrix.sim.test.ts` | all finish; respawn rules; tier ordering |
| Gimmick holds: corkscrew, pipe (θ sweep), loop (5 offsets), jumps (clear rate) | `sim/*.hold.sim.test.ts` | height error < 0.6 m; no respawns (jumps: no respawn for non-erratic) |
| Balance: assisted Rookie autopilot vs Rookie AI; Pilot autopilot vs Pilot AI | `sim/balance.sim.test.ts` | top 3; mid-pack |
| Hazard determinism (same seed → same outcome) | `sim/hazards.sim.test.ts` | identical standings |
| Track validation + SVG previews | `track/__tests__`, `npm run tracks:check` | radius, clearance, overlaps |
| Asset checks (sockets, tris, materials, nose, size) | `scripts/check-assets.mjs` via vitest | budgets |
| Save migrations + corrupt data | `save/__tests__` | safe defaults |
| Size budget | `npm run size` | app JS ≤ 600 KB gz; Rapier ≤ 1.7 MB gz; `public/game` ≤ 15 MB |
| Smoke (Playwright, SwiftShader) | `e2e/smoke.spec.ts` | boots, races 10 s, zero console errors |

## Appendix D — Risks and mitigations

| Risk | Mitigation |
|---|---|
| iOS Safari WebGL2 performance, or a HalfFloat MSAA target unsupported | Low preset has no MSAA pass and renders to a UnsignedByte target when HalfFloat isn't renderable (feature-detect `EXT_color_buffer_half_float`) |
| Loop/pipe physics regressions | Hold tests written **before** the feature (TDD), same style as `corkscrew.sim.test.ts` |
| 8 ships × Rapier CCD cost on phones | Measure at M1; if needed, drop to a 60 Hz fixed step on Low with 2 substeps of 120 Hz for player only |
| Asset bloat | `check-size` in CI; per-world lazy bundles; no textures on ships |
| Kid frustration | Rookie preset, No-KO, generous payouts, onboarding, telegraphed hazards; balance test enforces podium on Rookie |
| Save loss across milestones | Versioned migrations with tests from M1; export/import |
| Live-site breakage from PRs | Feature flags; smoke test; user playtests every preview before merge |
