# MachZero 2.0 — Implementation Guide (for the Opus 5.5 build sessions)

Read [`SPEC.md`](SPEC.md) first (the *what*). This file is the *how*: operating rules, target architecture, interface changes, and milestones **M0 → M8** pinned to v1's real files. v1's architecture and its corkscrew-physics notes are in [`../TDD.md`](../TDD.md) §7. The **2.1 expansion** (SPEC §10: cups, environment effects, upgrades, three new worlds) is section **X**, after §V.

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
9. **Every PR ships to both targets: the Netlify site and the iOS app** (Capacitor, `ios/App`; see [`../IOS_TESTFLIGHT.md`](../IOS_TESTFLIGHT.md)).
   - Check that changes work in the iOS WKWebView: controller-only play (8BitDo in X-input mode), safe areas, no on-screen keyboard popping up, offline assets.
   - Note any iOS-only effects in the PR.
   - **End every PR hand-off** with the deploy-preview URL **and** the iOS build command, so the user can choose to ship it to TestFlight:

     ```
     cd /Users/johnbradner/Documents/ClaudeWork/MachZero && git checkout main && git pull && npm ci && npm run ios:sync && npm run ios:open
     ```

     Then in Xcode: Any iOS Device (arm64) → Product → Archive → Distribute App → App Store Connect → Upload. The version stays 1.0.0 during TestFlight; `ios:sync` raises the build number.

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

## M4 — Cryo Station, Jade Ruins, Orbital Ring + hazards — ✅ DONE: M4a (#13), M4b (#14), M4c (#20)

**Design decisions (grilling session with the user, 2026-10-04 — settled, don't re-open):**

- **Order and PRs:** M4 before M5, as three stacked PRs: **M4a** Cryo Station (adds the hazard framework, `HazardPolicy` and ice), **M4b** Jade Ruins, **M4c** Orbital Ring. M4's world sims use the existing Rookie and Legend fits (as in M3); the 5 tracks × 4 tiers matrix moves to M5.
- **HazardPolicy before tiers:** part of the race setup, default `normal`; `?hazards=rookie` turns the Rookie rules on for QA. M5 sets it from the Rookie tier, and M7's No-KO assist sets it too.
- **World locks:** every built world is selectable in M4. The top-3 unlock rule arrives with M8's World Tour.
- **Full-pipe (Cryo):** a real closed tube, not a rolling ribbon. About 500 m, gently curving, the tube's circumference about the track width (≈ 8–9 m across); entry and exit blend over ≈ 80 m with the road edges curling up into the tube. Inside it, the lateral offset becomes an angle θ around the tube, the hover rays aim at the tube wall, and the corkscrew's magnetic hold keeps the ship on any wall at any speed. The camera rolls with the ship. Ice patches appear inside the pipe and on the main road. The pipe hold test (θ sweep) is written first.
- **Split path (Jade):** a real branch. A second swept section leaves at a fork and rejoins the main loop; each ship's progress maps back to main-loop `u`, so positions, laps, AI and respawns keep working. The shortcut saves ≈ 1.5 s per lap when driven cleanly. It is half-width with rails on one side only. Falling off it respawns you on the shortcut (≈ 3 s lost).
- **AI shortcut choice:** Rookie never, Pilot ≈ 30%, Ace ≈ 60%, Legend always unless a gate is closing; PIXEL (erratic) picks at random and the aggressive pilots lean towards it. Choices come from a fixed seed so the sims are reproducible.
- **Stone gates:** on the main road they slide across **half** the width, alternating sides, so there is always a way through. One gate can close the **whole** shortcut.
- **Loop (Orbital):** built from the centre line, nudged sideways so it doesn't cross itself; the magnetic hold keeps the ship on at **any** speed (no minimum speed). Low-g jumps use `airGravityScale` 0.35.
- **Debris:** solid kinematic obstacles on **every** preset (Low only draws simpler meshes), so the game plays the same on every device and the sims match.

**M4c, Orbital Ring: design decisions (grilling session with the user, 2026-11-01; settled, don't re-open).** These add to the 2026-10-04 decisions above (loop at any speed, low-g 0.35, Lissajous mines, solid debris on every preset).

- **Shape:** one loop-the-loop about 30 m tall, 2 low-gravity jumps, the pit strip and dash plates as usual, a lap of about 38–42 s at Pilot pace.
- **Mine hit** (`hazard:mine`):
  - Normal rules: a sideways and upward knock plus `CONFIG.MINE_DAMAGE` = **8 energy** (about a medium wall hit at the halved damage rates from PR #18).
  - Rookie rules (`HazardPolicy`): no energy loss, velocity × 0.85, as for the stone gates.
  - The mine reappears 6 s later. Mines are sensors on the hazard clock (`PhysicsSystem.hazardTime`), so the sims are deterministic.
- **Layout:** two mine fields of 4–5 mines each and one debris field (a broken satellite section). **There is always a clear lane through** (the stone-gate rule).
- **AI:** steers round mines and debris from the hazard timeline (`hazardClock`). Rookie CPUs keep a wider margin.
- **Shared mine code:** the mine (pose, collider, hit handling, visual) is written so the **Drop Mine** item (§P below) reuses it: the same hit effect and visual, with a different spawn and lifetime.

**As built — M4a, Cryo Station** (read before M4b):

- **Pipe geometry** (`track/features/pipe.ts`): one parameter, `curl` ∈ [0, 1] per frame sample, bends the cross-section onto an arc of curvature `curl·π/W` centred on the centreline. `curl` 1 closes the deck into a tube of circumference 2W (radius ≈ 4.46 m). Arc length is preserved, so `lateral` stays the position around the tube everywhere (±W is the top seam). The `pipe` feature is `{ dStart, dEnd, transition }` (the unused `radius` field was dropped from the contract). Bank fades out with the curl (`buildFrames` takes the curl array).
- **Queries:** `FrameSet.curl`; `TrackQuery.project()` un-curls the point (lateral = arc position, height along the curled normal) and returns `surfaceUp`, the true surface normal, which includes the along-track pitch where the curl changes. New `TrackData.surfacePoint(u, lateral, out, outUp?)`, `pipes` (`uStart/uEnd/uClosedStart/uClosedEnd`), `gripAt(u, lateral)`; `surfaceKindAt` returns `pipe` / `ice`.
- **Mesh and collision:** `SweepFrames.curl` plus `splitByCurl()`. The flat deck and slab stop where the curl starts; the curled stretch is a subdivided frosted-glass deck (`TrackPipeGlass`, transparent, double-sided) with light rings round the closed part; rails sink into the deck as the tube closes and end flush at curl 0.85 (no blunt rail ends). The collision surface uses 40 pieces across inside pipes.
- **Physics** (`ShipController`): hover rays, magnet gravity and the magnetic lock needed no change (gravity always points into the surface). New: `sampleUp` = `surfaceUp`; **pipe magnetism** (`physics/PipeCompensation.ts`) yaws heading and momentum by the extra geodesic curvature of the constant-lateral line caused by the curl *changing*. It is tabulated per track, and is zero inside the closed tube, so bends stay the player's to steer. **Seam guard:** from 60 m before the tube opens, ships within 4.5 m of the top seam are eased down the wall at up to 70 m/s², because the deck splits there and the rails come back.
- **Ice:** `ice` features (lateral band, `grip` 0.3) multiply grounded lateral grip; `ship:ice { active }` on entry and exit. Glossy pulsing decals; Rookie races pulse harder.
- **HazardPolicy** (`core/hazards.ts`): `normal` / `rookie` (telegraph ×2, no damage, hit speed ×0.85). It is in `RaceSetup.hazards`, passed to `PhysicsSystem.create(…, { hazards })` (M4b/M4c consume it) and to the track build (`telegraphScale`). `?hazards=rookie` forces it for QA.
- **AI:** aims at `track.surfacePoint` (the curled wall inside the pipe); lines inside a pipe stay within ±9 m (off the seam); ice in the next 140 m that leaves a lane is steered round with a 2.5 m margin; curves on ice are planned at half the lateral budget; on ice the target lateral moves slowly (steady line).
- **Track:** `cryo-station.json` (3,653 m, ~31 s/lap): a 560 m pipe (80 m transitions) through a 420 m-radius 50° bend, and 3 ice patches (back straight, inside the pipe on the left wall, long straight). `TrackValidate` checks pipes (plan radius ≥ 300 m, transition ≥ 60 m, closed ≥ 150 m); the preview draws pipes and ice.
- **Theme** (`graphics/themes/cryoStation.ts`): aurora night sky (two drifting curtains, stars), moonlit snowfield, a ring of jagged ice peaks; Blender props (`build_cryo_station`, role `ice` added): 3 ice spires, 2 glacier shelves, a CRT control tower, a research dome and neon masts lining the track; 1,408 tris, 46 KB.
- **Tests:** `sim/pipe.hold.sim.test.ts` (5 lines up to 154° up either wall × 70 and 125 m/s, plus a 1¾-turn spiral: height and axis error < 0.6 m, hull aligned, never airborne, no respawn), `sim/cryo-station.sim.test.ts` (Rookie and Legend fits), pipe geometry unit tests, the hazard policy and URL flag.
- **Deviation:** the frosted glass is faked (a transparent standard material) on every preset. Real transmission would add a render pass that the custom MSAA/post chain does not support yet. Revisit with M8 polish if the user wants it.

**As built — M4b, Jade Ruins** (read before M4c):

- **Split path contract** (`core/contracts.ts`): `TrackBranch` (`uFork/uMerge`, `length`, `halfWidth`, `side`, `overlapFork/overlapMerge`, `samples`, `sampleAt(s)`, `surfacePoint(s, lat)`, `progressU(s, lateral?)`, `sAtProgress(u)`, `openEdge`); `TrackData.branches`; `ShipState.path` (null = main loop) and `pathS`; `TrackProjection.path/pathS`; `project(pos, hintU, hintPath)`; `surfaceKindAt`/`gripAt` take the path. The `branch` feature is `{ id, dFork, dMerge, points, halfWidth, side, openFrom?, openTo? }`, the `gate` feature `{ d, branch?, period, phase, closedFraction, span: left|right|full }`.
- **Branch geometry** (`track/features/branch.ts`, `BuiltBranch`): an open centripetal Catmull-Rom from the design points, resampled every ~1.5 m. It starts and ends beside the main centre at `side·(W − w)` with the main heading, so it overlaps that half of the main deck until the centrelines are `W + w + 2·rail` apart (`overlapFork/overlapMerge`, `dSepFork/dSepMerge`). **Over the overlaps the branch lies on the main deck's surface and takes its normal** (the main road is straight there but keeps some smoothed bank from the corners either side, up to ~5° on Jade, which left a 1.1 m step at the shortcut's edge before this), then eases onto its own centreline and bank over 60 m. Race progress is the main projection through the overlaps and linear in between (monotonic), plus a **lateral term** through the overlaps (`progressU(s, lateral)`), so it is continuous for a ship that changes road anywhere across the deck.
- **Projection** (`TrackGenerator.projectWithBranches`): stays on the hinted road while the point is on it (|lateral| ≤ w + 0.5, height −3..12); otherwise main, then any branch it is on; a falling ship keeps its hinted road, so the respawn puts it back on the shortcut (`ShipController` remembers `lastValidPath/S`). Branches have no twist, pipe magnetism, seam guard, dash plates or pit.
- **Mesh and collision** (`TrackMesh`): the main rail on the shortcut's side is cut from the fork to the separation and from the separation to the merge; the branch deck (polygon offset over the main deck), slab, inner rail after separation, outer rail except over the open edge, neon; a crash-barrier **nose** capping the two rail ends at the separation (its back face at the separation, so it never reaches into either road).
- **Authoring** (`scripts/track-design.mjs`): `branches: [{ id, side, halfWidth, segments }]`, with `fork` and `merge` markers on flat main straights. The branch is its own turtle walk from main(fork) + right·side·(W − w), closed onto the merge by two `adjust` straights; its arcs must sum to the main heading change. `gate` and `open` features on main or branch segments. `TrackValidate` checks the main road is straight over both overlaps, the branch radius and elevation, and that once separated the branch keeps a rail's width from every main section (or 12 m of height). Previews draw the branch at its width with the open edge dashed red and the gates; the HUD minimap draws it thinner.
- **AI routes** (`track/TrackRoute.ts`): a route is the main loop, or fork → branch → main round to the fork, in route metres. `shipR(path, u, pathS)` (NaN when the ship missed the shortcut it meant to take), `curvatureAt`, `surfacePoint`, `halfWidthAt`, `pathAt`, `mainUAt` (main-loop features are skipped on a branch) and `lateralShift` across the fork and merge. `AIDriver` scans curvature, aims and sizes its line along its route; moves to the shortcut's side over the last 160 m before the fork; compares rivals on the same road (or sharing a deck in an overlap). **Route choice** once per approach, 300 m before the fork, from a separate rng stream: `shortcutOdds` = Rookie 0, Pilot 0.3, Ace 0.6, Legend 1; PIXEL 0.5; aggressive +0.2 (M5 replaces the table). Every tier skips the shortcut if its gate will be shut on arrival. The tier is the ship's `def.tier` (the race's rival fit), so **with the `tiers` flag off every rival is Rookie and none takes the shortcut on main until M5**.
- **Stone gates** (`track/features/gate.ts`): `buildGates(track)`, `gateClosure(g, t)` (shut for `closedFraction·period`, sliding over 0.6 s at each end), `gateWarning`, `gateBlocksDuring`, `gatePose`. Half gates slide in from out of the temple wall on their side; the shortcut's full gate drops like a portcullis. **Physics**: kinematic slabs in the RAIL group posed each step from `PhysicsSystem.hazardTime` (physics seconds since `resetTime()`, which `RaceSession` calls on every reset); gate colliders are told apart from rails by handle. A hit is a rail-like bounce; under a damaging policy it drains energy like a rail, otherwise no energy loss and velocity × `hitSpeedScale` once per hit (1 s per ship and gate); `hazard:gate { shipId, gate, point }`. **Visual** (`gateVisual.ts`, `TrackData.animateHazards(t)`, `FrameContext.hazardTime`): a doorway (pillars outside the rails, lintel 15 m up), the stone slab and glyph bands that pulse through the warning (1.5 s × `telegraphScale`) and glow solid while shut. **AI**: gates in the next 240 m that will be shut in a ±0.4 s window around arrival push the line to the open half (3 m margin); a shut full gate caps speed to arrive once it has opened. The AI reads the physics clock (`new AIDriver(…, { hazardClock })`).
- **Track:** `jade-ruins.json` (4,873 m, ~41.3 s/lap): the main road swings out round the temple through three half gates (left, right, left on the return straight); the 1,158 m shortcut (half width, 12.8% shorter than the 1,328 m it skips, a 160 m open edge over the ravine, one full gate) saves ≈ 2.0 s at 90 m/s, ≈ 1.4 s at racing pace.
- **Theme** (`graphics/themes/jadeRuins.ts`): misty dusk sky (amber haze, low sun, drifting mist, early stars), jungle floor with a river sheen 80 m below the deck, 420 giant trees (trunks plus crowns of crossed alpha-tested leaf cards, instanced), 34 holographic glyph panels beside the road, 1,800 fireflies (off with reduced motion: `WorldTheme.setReducedMotion`), and Blender props (`build_jade_ruins`): 2 stepped temples, 3 columns (2 ruined), a guardian statue, 2 giant ferns; 1,744 tris, 46 KB. The smaller ruins stand on instanced karst rock pillars rising to just below the deck. Scenery corridor tests include the branch (`trackPlan`).
- **Tests:** `track/__tests__/authored.test.ts` (split path: decks meet, progress monotonic and continuous at any lateral, project keeps and switches road, rails open only where the shortcut leaves and rejoins, nose position), `route.test.ts`, `gate.test.ts`, `sim/branch.hold.sim.test.ts` (shortcut at 70 and 125 m/s, stays on main, off the open edge respawns on the shortcut where it left, time saved, a Legend AI takes it when the gate will be open and skips it when shut, a Rookie never), `sim/hazards.sim.test.ts` (gate hit and policy, open half clear, same race twice gives identical standings), `sim/jade-ruins.sim.test.ts` (Rookie and Legend).
- **Deviations:** gate damage reuses the rail-impact damage (no separate constant); the warning glow is on the slab's glyph bands rather than a separate light.

**As built — M4c, Orbital Ring** (read before §P):

- **Loop geometry** (`track/features/loop.ts`): the authoring tool writes the loop into the control points: `P(t) = P0 + f·(A·t + R·sin θ) + up·R·(1 − cos θ) + r·S·σ((t − e)/(1 − 2e))`, θ = 2π·σ(t), σ = smootherstep, 30 m tall (R = 15), advance A = 40 m, side offset S = 38 m (`LOOP_MIN_SIDE` = 32: both decks plus rails and a 2 m gap), with the side shift eased over the middle 70% only (`LOOP_SIDE_EASE` 0.15) so the climbing and descending legs never cross. The segment is `{ loop: { side, advance?, height? }, y }`; the feature is `{ type: 'loop', dStart, dEnd, sideOffset }`; `TrackData.loops` (u ranges).
- **Frames** (`TrackFrames`): the rotation-minimising frame has a holonomy of 2π·sin(lean) round a side-shifted loop, which would leave the deck rolled after it. Inside a loop the frame is built about the loop's axis (right = entry right less its along-track part, up = right × forward), and the transport re-seeds from it on exit. Bank is zeroed inside loops before smoothing and faded out over 60 m either side (the loop's lateral curvature had leaked ~0.1 rad of bank into the straights).
- **Loop magnetism** (`physics/LoopCompensation.ts`, shared table code in `physics/lineTables.ts`): a constant-lateral line across the twisting, sliding deck is not a geodesic, so heading and momentum yaw at the line's geodesic curvature (as for the corkscrew and the pipe), tabulated per track per loop (samples × 1 m of lateral) **for the line the hull actually flies**, HOVER_HEIGHT above the true deck normal. Measuring it on the deck left a ~2 m error (the 1/(1 − h·κn) stretch and h·dτ/ds yaw of hovering above a concave twisting deck).
- **Heading fix** (`ShipController`): the grounded alignment now rotates `fwd` with the same quaternion as the velocity instead of re-projecting it. The re-projection gave a second-order yaw under combined pitch and twist, a drift proportional to speed. It also reshuffled races slightly (see ship-to-ship damage below).
- **Ship-to-ship damage** (`PhysicsSystem`): now applied once per pair per 0.2 s (the event throttle) instead of every step while two hulls stay pressed together. The per-step damage ground NOVA BLAZE from 15.7 to 0 energy in a 0.6 s side-by-side landing on Sunset Mesa once the heading fix changed that race. A deliberate balance change.
- **Respawn:** `safeRespawnU` inside a loop returns 20 m past its exit.
- **Validator:** loops need |side| ≥ `LOOP_MIN_SIDE`, legs that pass within 4 m in the loop plane must be ≥ `LOOP_MIN_SIDE` apart along the axis, and the road is level and unbanked 20 m either side. The in-loop minimum radius is 8 m (the 45 m track minimum predates the 30 m-tall loop).
- **Mines** (`track/features/mine.ts`, `physics/MineField.ts`): `buildMines(track)` spaces each field's mines evenly along it, placed by golden-ratio spread in the free road either side of the clear lane. The lane's half-width is hull + 1.5 m + mine radius + drift, so a hull on the lane centre clears every mine by 1.5 m at full drift. `minePose(m, t)` is a Lissajous drift on the hazard clock (sideways by `drift`, along by half, 0.9 and 1.4 rad/s). The physics test is an exact sphere (radius 1 m, at hover height) against each hull box every step, not a Rapier sensor: deterministic and allocation-free. A hit runs `ShipController.applyMineHit`: a 10 m/s knock across the road away from the mine plus 6 m/s up the road's normal, and either `CONFIG.MINE_DAMAGE` (8) × damageTakenScale energy or, under the Rookie policy, no energy and velocity × 0.85. Then `hazard:mine { shipId, mine, owner, point }`. The mine re-arms `MINE_RESPAWN` (6 s) later. `PhysicsSystem.mines` (= `MineView[]`, in `FrameContext.mines`) is what graphics, audio and the AI read; `owner` is null for track mines, ready for the Drop Mine.
- **Debris** (`track/features/debris.ts`): 6 pieces of a satellite section, boxes 3–5 m across, 2–2.8 m tall, floating 0.25 m off the deck, drifting ±1.5 m sideways and swaying ±0.25 rad on the hazard clock, all clear of the lane. **Physics:** the stone gates' kinematic-box code is now general (`PhysicsSystem` obstacles: gates, then debris; `ShipController.obstacleContacts`). A hit is a rail-like bounce with rail damage under the normal policy (× 0.85 under Rookie), once per ship and piece per second, and `hazard:debris`.
- **AI** (`AIDriver.avoidHazards`): mines and debris within 2.6 s (≥ 120 m) block a lateral band of hull + margin (1.2 m, Rookie 2.5 m). Hazards reached within 0.6 s block where the timeline puts them over ±0.25 s of arrival; further ones block their whole drift, so the line commits early to one side instead of weaving between moving gaps. `clearOfBands` picks the nearest free lateral. The first mine field was moved 60 m further from the corner before it: Legend ships drifting wide out of that corner at 150+ m/s could not recover in time.
- **Track:** `orbital-ring.json`, 4,934 m, ~41.8 s/lap, elevation 42–76 m, `airGravityScale` 0.35. Pit, a rounded rectangle with two low-gravity jumps (70 m and 80 m), two dash plates, the loop, mine fields of 5 (lane +5 m) and 4 (lane −5 m), and the debris field (lane −4 m).
- **Feedback:** `Effects.mineBlast` (white flash, red embers, sparks, a flat shock ring), a flicker on the hit ship, a camera kick for the player. Audio: a crack-and-boom per blast, and a **proximity beep** that quickens as the player closes on an armed mine ahead (within 70 m). Haptics: heavy for mine and debris hits. Debris hits reuse the ship-hit sparks; their bounce sound is the rail hit.
- **Visuals:** `graphics/MineVisual.ts` (instanced spiked spheres with a spinning red band that pulses faster as the player nears; amber for dropped mines; spent mines hidden, re-armed ones grow back in) and `track/features/debrisVisual.ts` (a foil-wrapped bus, a torn solar wing and a blinking red beacon, posed by `animateHazards`, which now runs every hazard animator).
- **Theme** (`graphics/themes/orbitalRing.ts`): one sky shader for all of space: two-scale starfield, a faint Milky Way band, a white sun, and **the Earth ray-traced in the sky shader** (camera-relative, never clips): fbm oceans, continents and drifting clouds lit by the sun, city lights on the night side, ocean glint, grazing-angle atmosphere haze and the thin blue limb. The station orbits tilted, so the horizon rises above eye level on one side and is seen past the deck from the chase camera. There is no ground. Blender props (`build_orbital_ring`): chrome **station ribs** (27 m hoops square to the road every 180 m on level straights, clear of the loop and jumps, their neon strips alternating dimmed electric blue and red), trusses, solar arrays, habitat modules and comms dishes drifting around the track. 5 props, 38.9 KB. The world's left neon is a pale blue-white (0x9fb4e0): pure white bloomed into a haze over the whole frame.
- **Tests:** `sim/loop.hold.sim.test.ts`, 25 cases:
  - Geometry: 30 m tall, exit beside the entry, level; respawn after the loop.
  - 4 speeds (25–180 m/s) × 5 lines held within 1.5 m round the loop, exit within 1 m.
  - Hands-off lines; **the chase camera stays on the ship's side of the deck with a clear sight line** (≥ 2.4 m clearance measured).
  - `sim/hazards.sim.test.ts`, Orbital Ring:
    - Layout.
    - A mine hit under normal rules (8 energy, a knock, re-arms after 6 s) and under Rookie rules (no energy, × 0.85).
    - The clear lane through every field at 70 and 140 m/s.
    - Debris is solid.
    - The same race twice gives identical standings and mine hits.
  - `sim/orbital-ring.sim.test.ts`, Rookie and Legend: all finish with no respawns, and every ship takes ≥ 6 jumps. Mine hits are ≤ 4 at Rookie (measured 0) and ≤ 8 at Legend (measured 4); debris hits ≤ 2 (measured 0).
- **Deviations:**
  - Mines are an analytic sphere-vs-box test rather than Rapier sensor colliders (same behaviour, deterministic, no solver work).
  - Debris is one mesh on every preset (about 140 triangles a piece, so there is no Low variant).
  - A known residual: a ship left **hands-off** off the centreline leaves the loop about 1.7 m nearer the centre at ±8 m and 140 m/s (proportional to the offset, independent of the step size). Any steering input holds the line within 1.5 m.
  - The left neon colour above.

- **Cryo Station:**
  - Pipe section, aurora sky shader, ice spires, frosted-glass tube material (transmission on High, faked on Low).
  - **Ice patches:** zone `ice`, where lateral grip is multiplied by `grip` (≈ 0.3), with a glossy decal on the surface and `ship:ice`.
- **Jade Ruins:**
  - Split path, jungle canopy (instanced cards), temple props, holographic glyphs, fireflies (particles).
  - **Stone gates:** kinematic Rapier cuboids in the `RAIL` group, animated by a deterministic timeline from **race time**, not wall-clock, so the sims are reproducible. They show a 1.5 s warning glow before closing.
- **Orbital Ring:**
  - Loop plus low-gravity jumps (`airGravityScale ≈ 0.35`), Earth sphere with an atmosphere shader, station ribs, starfield.
  - **Mines:** kinematic sensor balls drifting on deterministic Lissajous paths. On contact: impulse + `CONFIG.MINE_DAMAGE` energy loss + `hazard:mine`. The mine respawns after 6 s.
  - **Debris:** small kinematic obstacles on every preset (simpler meshes on Low).
- **Rookie/No-KO rule:** a `HazardPolicy` from the race setup gives earlier telegraphing (a 2× longer warning glow), no energy damage, and a slowdown only (a velocity scale of 0.85 on hit).
- **AI hazard awareness:** the look-ahead scans upcoming hazards. Ice → brake earlier and hold a straighter line. Gates → wait or accelerate based on the timeline. Mines → lateral avoidance like v1's rival avoidance.

**M4 done when:**
- All 5 worlds pass the sims at the Rookie and Legend fits (the 4-tier matrix is M5's).
- The pipe and loop hold tests pass.
- Hazards are deterministic in the sims.
- Each world is ≤ 2.5 MB and the total is ≤ 15 MB.
- Low preset holds ≥ 30 fps on the Cryo pipe on the iPad smoke test (manual, by the user on the preview).

---

## H — Housekeeping: dependency audit + Low-preset haze — ✅ DONE (PR #22)

Found at the end of M4c (2026-11-02). Branch `v2/h-housekeeping` from `main`.

**As built (PR #22):**
- `npm audit fix`: 10 advisories (8 moderate, 2 high) → 6 moderate, all under `@capacitor/cli` (accepted). vite 8.3.5, vitest 5.1.0 (newest in range, not 5.0.5), source-map-js 1.2.2.
- **Haze cause, measured** (Orbital Ring, same autopilot moment, sky luminance): Med 16, Low 66. Bloom scale, the chromatic pass, pixel-ratio cap, render scale and MSAA each moved it; **fog did not**. Two causes:
  1. UnrealBloom's blur kernels are fixed in texels, so the glow's on-screen spread is inversely proportional to the bloom buffer width. Low's buffer on a phone is ¼ of Med's (1 × 0.75 × 0.5 vs 1.5): every mip two octaves wider.
  2. Low disabled the chromatic pass, which also draws the vignette.
- **Fix:** `graphics/bloomSpread.ts` + `ScaledBloomPass` re-weight the 5 mip levels (via `bloomTintColors`) by the octave shift against Med's width on the same screen; shift 0 (Med, High, any buffer at least Med's width) leaves the bloom untouched. The chromatic pass stays on for every preset; `q.chromatic` now only gates the aberration fetches and the heat shimmer. After: Low 8 / Med 16 / High 13.
- Before/after screenshots: `docs/v2/shots/h/`.

**1. Dependency audit.** On 2026-11-02, `npm ci` reported 10 vulnerabilities (8 moderate, 2 high), all in dev and build tooling. None reach the shipped bundle (three, Rapier, `@capacitor/haptics`).
- **Fix:** run `npm audit fix` (no `--force`). Its dry run updated 16 packages:
  - vite 8.3.1 → 8.3.5 (the two high advisories: dev-server `server.fs` bypasses, cross-origin middleware, launch-editor);
  - vitest and `@vitest/mocker` 5.0.2 → 5.0.5;
  - source-map-js 1.2.1 → 1.2.2;
  - rolldown, postcss and others as transitive bumps.
  
  Commit the `package-lock.json` change (and `package.json` only if the ranges move).
- **Don't fix:** glob, minimatch, rimraf, uuid@7 and xcode, all pulled in by `@capacitor/cli` 8.5.3 and run only by `ios:sync`.
  - `npm audit fix --force` would downgrade the CLI to 4.8.2 and break iOS sync.
  - Leave them until Capacitor updates them, and list them as accepted in the PR body.
- Re-run `npm audit` and paste the before and after summary in the PR.
- Expect the vitest Windows path-traversal advisory (GHSA-xp26-3454-mjgp) may remain. The dry run's report still listed it, and it doesn't apply on macOS.
- **Check:** the full gate (typecheck, test, build, size, smoke), plus `npm run ios:sync` succeeds with the new vite.

**2. Low-preset haze.** At `?quality=low`:
- **Symptom:** every world looks washed out. Orbital Ring's black sky turns lilac with a large white sun glow (phone 375×812), and Jade Ruins is also pale. Med and High look right.
- **Not yet diagnosed.** Suspects, in the Low profile (`settings/QualityManager.ts`):
  - `bloomScale` 0.5: `UnrealBloomPass` at half resolution, so each mip blurs twice as wide on screen;
  - `msaa` 0;
  - `renderScale` 0.75;
  - `fog` ×1.6, which `GraphicsSystem.applyFogDensity` multiplies into the theme fog.
- **Find the cause with evidence:**
  - Change one Low field at a time to its Med value (a temporary debug override, or edit `PROFILES.low` locally).
  - Screenshot Orbital Ring and Jade Ruins at the same race moment (`?world=…&autopilot=1&quality=low`, mobile viewport).
  - Note which field removes the wash.
- **Fix that field's effect, not the symptom.** For example, if it's bloom: keep the half-resolution bloom (the cost saving) but scale the bloom radius and strength so the on-screen spread matches Med.
- The fix must not change Med or High (screenshot both before and after).
- **Done when:**
  - Low on a phone looks like Med but softer: black space on Orbital Ring, no full-frame wash on any world.
  - The `?perf=1` frame time at Low doesn't rise by more than 0.3 ms.
  - The PR body has before and after screenshots of Low for Orbital Ring and Jade Ruins.

---

## P — Powerups: Shield, Drop Mine, item select, CPU items — ✅ DONE (PR #23)

**As built (PR #23)** (read before §GP or M5):
- **Code:** `content/items.ts` (kinds, prices, `itemSlots`, `buyItem(kind)`, `clampBag`, `nextHeldKind`, `CPU_ITEM_COUNT`); `game/ItemSystem.ts` owns everything in play (player selection and use, CPU bags and decisions, shields ticking, CPU EMPs in flight, per-target cooldown). `RaceSession` calls `items.fixed(dt, human)` before `physics.step`, and `items.reset()` on a reset. `RaceSetup.items` is now `PlayerItems { counts(), use(kind) }`.
- **`ShipState.shield`** (seconds; GAME raises and counts down, PHYSICS zeroes it when it blocks a mine). New events: `item:use { shipId, kind }`, `item:warn { from, target }`, `item:shield { shipId, blocked, point }`; `item:fail` gained `kind`.
- **Dropped mines:** `MineField` appends a fixed pool of `DROP_MINE_MAX` slots after the track mines (`dropBase`), so `PhysicsSystem.mines` is never empty now (track mines + 6, unarmed when free). `PhysicsSystem.dropMine(owner)` places on the main loop (u − 6 m, same lateral), or behind the hull in the ship's frame on a split path.
- **AI:** `AIDriverOptions.liveMines` (RaceSession and `sim/worldRace.ts` pass `physics.mines`). Dropped mines are passed **on the side the hull is already on** (the nearest band edge to the *desired* line could cross the mine) with `DROPPED_MARGIN` 2.5 m at every tier: the hull settles ~1.3 m short of its target lateral on a gentle bend (found in `items.sim`; the steering itself is unchanged). Rookies use 0.7× lookahead.
- **CPU decisions** (every 0.25 s after the first 4 s): EMP at the racer ahead 5–70 m away (25%); Shield with a rival ≤ 12 m behind (30%) or against an incoming EMP (Pilot 50%, Ace 80%, Legend 100%); Drop Mine on a straight with a rival 15–60 m behind (35%).
- **Sims:** `runWorldRace` runs CPU items by default (`opts.items: false` turns them off) and reports `itemUses` and `droppedMineHits` separately from track `mineHits`. All five worlds stay green at Rookie (no items) and Legend (items used).
- **Input:** `KeyControl` gained `itemNext` (C); `ControlInput.itemCycle` (±1 per press; d-pad left/right on the pad, not the stick). Save v4.

**Build notes from M4c as built** (read before coding §P):
- **The mine is already shared:**
  - `physics/MineField.ts` does the physics: an exact sphere-vs-hull-box test every step, then `ShipController.applyMineHit(side, up, hazards)`.
  - `MineView.owner` is ready: `null` for track mines.
  - `graphics/MineVisual.ts` already draws owned mines with the amber band.
  - Events and the HUD: `hazard:mine { shipId, mine, owner, point }`. Effects, audio (including the proximity beep) and haptics already react to it.
  - `FrameContext.mines` carries `physics.mines` to graphics.
- **What the Drop Mine needs:**
  - `MineField` grows a dynamic list beside the track mines: `drop(owner, u, lateral, t)`.
    - Fixed pose (no drift) and no re-arm: the mine is removed when hit or at 20 s.
    - The owner is skipped for the first 1.5 s.
    - At most 6; the oldest is removed.
    - Keep the dynamic mines in a preallocated pool (no per-step allocation; `MineVisual` has `MAX_MINES` = 24, enough for 9 track mines plus 6 dropped).
  - Dropped-mine hits use the same `applyMineHit` and emit `hazard:mine` with `owner` set.
  - Spawn about 6 m behind: `u` from the ship's track progress minus 6 m, lateral from `TrackQuery.project`.
- **AI gap:** `AIDriver` builds its *own* copy of the track mines (`this.mines = buildMines(track)`) and predicts them from the timeline. It never sees dropped mines.
  - Give `avoidHazards` the live dropped mines (from `PhysicsSystem.mines` entries with `owner !== null`, through whatever `AIDriver.update` already gets per step) as static bands.
  - Keep the timeline path for track mines, so the sims stay deterministic.
  - Rookie "a little worse": shorter lookahead for dropped mines (e.g. ×0.7).
- **EMP code to generalise:**
  - `RaceSession.fireEmp` (player only today) and `RaceManager.racerAhead`.
  - `content/items.ts` has `ItemBag { emp }`, `empSlots` and `buyEmp`. Rename these to kind-generic (`itemSlots`, `buyItem(kind)`), and keep the slot unlock wins (3, 10).
- **Save:** `SAVE_VERSION` is 3. §P makes it 4: the migration turns `items: { emp }` into `{ emp, shield, mine }`.
  - Follow `save/migrations.ts`.
  - The sanitizer clamps the *total* to the slot count, keeping EMPs first.
- **Seeded randomness:** use `core/rng.ts` (mulberry32) for the CPU item draws and decisions, seeded from the race seed plus the ship index. Never use `Math.random` in the fixed step.
- **Shield and mines:** the shield is checked in `PhysicsSystem.checkMines` before `applyMineHit`, and in the EMP landing.
  - A block emits a new `item:shield { shipId, blocked: 'emp' | 'mine' }`, so graphics (crack and flash), audio and haptics can react.

**Design decisions (grilling session with the user, 2026-11-01; settled, don't re-open).**

**Already shipped** (PR #18; read `src/content/items.ts` and `RaceSession.fireEmp`):
- The **EMP**: 400 credits, bought in Garage → Items, carried over between races. Ⓨ / F fires it at the nearest racer ahead who is still racing (`RaceManager.racerAhead`).
- Its effect: `ShipState.empSlow` (2.5 s at 70% pace) and `empLock` (5 s with no boost, and a running boost is cut). It isn't spent when there's no target.
- Slots: 2, a 3rd at 3 wins, a 4th at 10 (`empSlots`).
- Feedback: `item:emp` / `item:fail` events, the HUD chip, the "BOOST JAMMED" state, VFX (`Effects.empHit`), audio and haptics.

**Scope of this PR:**
- **Two new items** (no repair item; the pit does that job):
  - **Shield** (300 credits):
    - Switched on by the player; lasts until it blocks one hit or for 8 s, whichever comes first.
    - Blocks **EMPs, track mines and dropped mines** only. It doesn't reduce wall or ship-to-ship damage.
    - Visual: a glowing hexagon bubble round the ship with a hum; a crack and flash when it blocks something.
    - HUD: a "🛡 SHIELD" chip state.
  - **Drop Mine** (350 credits):
    - Lands about 6 m behind the ship, at its position across the track, and stays armed for 20 s before fading out.
    - The dropper can't hit it for the first 1.5 s.
    - Hit effect is the same as a track mine (M4c): 8 energy plus a knock, or on Rookie rules no damage and × 0.85.
    - At most 6 dropped mines on the track at once; the oldest disappears.
    - The AI steers round dropped mines like track mines; Rookie CPUs are a little worse at it.
  - **EMP:** stays at 400 credits.
- **Shared slots:** one set of slots (2, then 3 and 4 as above), filled with any mix in Garage → Items.
  - Save change: `Profile.items` becomes counts per kind (`{ emp, shield, mine }`), with a save migration.
  - The sanitizer limits the total to the slot count.
- **Choosing an item:**
  - Controller: in a race, **d-pad left/right** picks the item (the d-pad has no race job today) and **Ⓨ** uses it.
  - Keyboard: **C** cycles and **F** uses (`KeyControl` `itemNext`, alongside `item`).
  - HUD: the item chip shows the selected item and the count of each.
- **Garage only:** no item boxes on the track and no random draws.
- **CPU items:**
  - Rookie: none.
  - Pilot: 1 random item per CPU per race.
  - Ace and Legend: 2 random items each.
  - The draw and the decisions use a seeded random stream, so the sims are reproducible.
  - When they use them:
    - **EMP** at the racer ahead, which can be the player.
    - **Shield** when a rival closes in behind or an EMP warning is on them.
    - **Drop Mine** on a straight with a rival close behind.
- **Fairness when the player is the target:**
  - A CPU EMP shows "⚠ EMP INCOMING" for **0.5 s** before it lands, so a Shield can be raised in time.
  - A CPU can't EMP the same racer twice within **10 s**.
  - The player's own EMP stays instant.
- **No restrictions** on which items go into a Grand Prix beyond the slots; no restocking during a race.

**Tests:**
- **Items:** Shield blocks one EMP or mine and then pops; the Shield expires at 8 s; the Drop Mine's lifetime, 1.5 s grace for its owner and 6-mine limit; selection cycling.
- **Saves:** the migration of per-kind counts.
- **CPU items:** never on Rookie; seeded and reproducible (same race twice gives the same standings); the per-target EMP cooldown.
- **e2e:** buy a Shield and a Drop Mine by pad, pick with the d-pad, use with Ⓨ.

**Done when:**
- All three items work for the player and for CPUs on Pilot and above.
- The sims are green at Rookie and Legend fits with CPU items.
- Garage → Items sells any mix.
- The iOS app is checked with the 8BitDo (d-pad select, Ⓨ use).

---

## GP — Grand Prix cups — ✅ DONE (PR #24)

**As built (PR #24)** (read before M5 or M8):
- **Code:** `game/modes/GrandPrix.ts` is pure: `CupState { tier, results }` (per race, per ship id, the finishing position; 0 = retired), `recordRace(cup, standings, retire?)`, `cupStandings` (points, best finish, last-race points, movement), `cupGridOrder` (null for race 1, then the reverse of the table), `cupBonus`, `cupAward`, `addTrophy`, `sanitizeCup`. M8 adds World Tour and Time Trial beside it.
- **Tiebreak:** points, then best finish, then the last race's finish, then ship id (so the order is total and stable).
- **Grid:** `buildRaceField({ gridOrder })` (index = slot, value = ship id); a malformed order is ignored and the default path is unchanged. `runWorldRace(…, { gridOrder })` too.
- **App:** `cupRace` signal marks the race session as a cup race (part of the session key, so a cup race always builds its own session and HUD). `currentWorld` and the tier come from the cup. `bindStats` pays the normal payout, then `bookCupRace` records the result and, after race 5, pays the bonus (one combined `economy:credits` on the results), awards the trophy, clears `Profile.cup` and keeps the final table in `lastCup` for the standings screen.
- **No restarts:** `HudActions.cup` hides RESTART on the pause screen (MENU becomes **RETIRE**) and turns the results' RACE AGAIN into **CUP STANDINGS**. Keyboard R and Ⓑ on the pause panel do nothing in a cup; Ⓐ or Ⓑ on the results go to the standings. RETIRE books the race with the player at 0 points and the rivals scored in their running order.
- **Screens:** `ui/screens/GrandPrix.tsx` (worlds, trophies, START / CONTINUE / QUIT CUP) and `CupStandings.tsx` (table with movement, NEXT RACE, GARAGE, QUIT CUP with a confirmation; the final table after race 5). Routes `gp` and `cup`; the Garage takes `back: 'cup'`. Main menu: CONTINUE CUP (first and focused) while a cup is in progress, GRAND PRIX after WORLDS otherwise. Trophies show on the pilot card.
- **Flag:** shipped ON (behind `worlds`, like the world select), not behind `modes`, which stays off for M8.
- **Save v5:** `Profile.cup` and `Profile.trophies` (migration 4 → 5 adds `null` and `[]`).
- **Known gap:** closing the app *mid-race* and reopening resumes the cup at that race (the cup is saved between races only). Accepted: counting it as a retire would punish a crash or a phone call.
- **Debug:** `__machzero.simulate(seconds)` steps the race with nobody driving (the player's AI drives), for the e2e.
- **Tests:** `game/modes/__tests__/GrandPrix.test.ts` (9), `sim/grandPrix.sim.test.ts` (five real races, reload mid-cup), the migration in `SaveStore.test.ts`, the grid order in `ShipStatsResolver.test.ts`, and `e2e/grandprix.spec.ts` (pad only: start, race 1, standings, reload, CONTINUE CUP, race 2 on the reverse grid).


**Build notes (where things are, 2026-11-02):**
- **Grid:** `content/pilots.ts` `buildRaceField(opts)` already takes `playerGridIndex` (Rookie defaults to the back). The reverse-standings grid needs an explicit order for *every* ship: add `gridOrder?: ShipId[]` and keep the default path unchanged so the existing sims don't move.
- **Results:** `race:results { standings }` (`core/events.ts`) is handled in `app/App.ts` twice: the perf log near line 490, and the payout and save near line 585. The cup hooks in there.
  - `game/modes/GrandPrix.ts` stays pure: the state machine, points, tiebreak, grid order and payouts.
  - `App` only feeds it standings and saves the result.
- **Restart paths to block during a cup:**
  - keyboard R: `input.consume('restart')` in `App.ts` around line 413;
  - the pause menu's `restartRace` / `onRestart` (`App.ts` around lines 169 and 571);
  - the HUD key legend `ESC M R` (`game/HUD.ts`).
- **Screens:** `ui/screens/` holds MainMenu, WorldSelect, Garage, Settings and ProfileSelect.
  - Add `GrandPrix.tsx` (cup start, trophies) and `CupStandings.tsx`.
  - Route them through `app/routes.ts`.
  - Use the pad focus and spatial navigation from PR #18 (`ui/nav.ts`).
- **Save:** `SAVE_VERSION` is 4 after §P. §GP makes it 5: `Profile.cup` (null or the cup state) and `Profile.trophies`.
- **Flag:** the Grand Prix entry is a finished, complete feature. Ship it on (don't hide it behind `modes`, which stays off for M8's World Tour and Time Trial), and record that in the as-built notes.

**Design decisions (grilling session with the user, 2026-11-01; settled, don't re-open).** These add to SPEC §4.2:
- 5 tracks, points 10‑8‑6‑5‑4‑3‑2‑1, tiebreak on best finish.
- Retiring mid-cup costs that race's points, not the cup.
- Cup bonus: 3000 × the tier multiplier for 1st overall.

- **Unlocked from the start.** World Tour doesn't exist until M8; M8 adds SPEC's "clear World Tour world 5" lock.
- **Track order:** world order (Neon Bay → Sunset Mesa → Cryo Station → Jade Ruins → Orbital Ring).
- **Tier:** the profile's CPU difficulty (Settings → Race, PR #18), fixed for the cup.
- **Saved after every race:** cup progress (races done, points and standings, the tier) is stored in the profile, so the iOS app can be closed between races.
  - The main menu shows **CONTINUE CUP** while a cup is in progress.
  - Save change: `Profile.cup` (with a save migration).
- **No restarts mid-cup.**
  - The pause menu hides RESTART during a cup (keyboard R does nothing either).
  - **QUIT CUP** asks for confirmation, then ends the cup.
  - A destroyed or retired player scores 0 for that race, and the cup goes on.
- **Grid:**
  - Race 1 uses the normal grid for the tier (Rookie puts the player at the back).
  - From race 2, the grid is the **reverse of the cup standings**: the leader starts last. `buildRaceField` takes an explicit grid order.
- **Between races:** a cup standings screen (points table with the movement since the last race; pad and touch friendly). From it you can **open the Garage** to buy items and parts, then go to the next race. Items carry over race to race.
- **Credits:** every race pays its normal payout (× the tier multiplier), plus the cup bonus for 1st overall at the end.
- **Trophies:** one per tier (Rookie, Pilot, Ace, Legend) per profile, for winning the cup. They show on the Grand Prix screen and the pilot card in the menu.
  - Save change: `Profile.trophies`.
- **Code shape:** start M8's `game/modes/` with `GrandPrix` (the cup state machine, points, grid and payouts as pure, tested functions), driving `RaceSession` setup and results. M8 later adds World Tour and Time Trial beside it.

**Tests:**
- **Unit:** points, the tiebreak, the reverse grid, the cup state across 5 races including a retire, the migration, and trophy awarding per tier.
- **App level:** a headless cup run (5 short autopilot races, or results injected through `race:results`) that saves and resumes mid-cup.
- **e2e:** start a cup, finish race 1 by autopilot, see the standings, reload, CONTINUE CUP.

**Done when:**
- A full cup can be played on web and iOS with only the pad.
- Closing and reopening the app between races resumes the cup.
- Trophies and the cup bonus are awarded.

---

## M5 — AI tiers, pilots, drafting — ✅ DONE (PR #26)

**As built (PR #26)** (read before §V or M6; the plan below is kept for reference):
- **Tiers:** `content/tiers.ts` (`TIERS`, `TIER_ORDER`, `TIER_OPTIONS`, `tierDef`) replaces `AI_PACE` and `CONFIG.AI_RUBBER_BAND_*`. `AIDriver.tunedProfile(personality, tier)` scales v1's `PROFILES` (lat budget, yaw, brake, overspeed, look-ahead, boost energy and cooldown, pit energy); Legend is v1 unchanged. Each tier also sets `paceScale`, `rubberBand`, `mistakeRate` (Poisson throttle lifts on their own RNG; the erratic personality keeps its own), `lineInset`, `aggression` (block, yield, ram), `draftSeeking`, `shortcutOdds` (replaces `SHORTCUT_ODDS`), `hazardMargin` and `droppedLookahead`.
- **Deviations from the plan:** Rookie `paceScale` is **0.90**, not 0.75 (the user's iPhone playtest), with no catch-up (band 0.92–1.0). Pilot is **0.94**, not 0.88, so it stays above Rookie; its band is 0.97–1.06. Ace 0.97, Legend 1.0.
- **Drafting:** `physics/Drafting.ts` (30 m, ±12°, ±4 m, ±3 m vertical, 0.6 s build, 0.4 s fade, ≥ 25 m/s, never airborne). `ShipController`: top speed and boost top × (1 + 0.06·draft), thrust × (1 + 0.15·draft), coast drag × (1 − 0.5·draft). `ShipState.drafting`, `ship:draft` with hysteresis (on 0.3, off 0.15). HUD **≋ DRAFT** chip, cyan speed lines, a soft whoosh.
- **AI racecraft:** Ace and Legend look for a draft 15–34 m ahead; aggressive tiers block a rival ≤ 12 m behind, Rookie yields. Only on straights, never in centre sections, the pit, split paths or on the way to a chosen shortcut. Shortcut-bound drivers keep inside the shortcut deck at the fork, and the fork approach scales with speed (1.6 s, ≥ 160 m).
- **Loops (fix found by the matrix):** inside a loop the AI holds its lateral line (`LOOP_STEER_KP/KD`), sees zero curvature and treats the loop as a centre section: `LoopCompensation` carries the hull, and steering at the side-shifted aim point drove Rookie DARTs into the Orbital Ring rail.
- **Assists:** `physics/Assists.ts` `PlayerAssists` (auto-accelerate, steering weight 0 / 0.3 / 0.6, rail push) as tested logic; no settings UI yet (M7). The sims use it for the Rookie balance race.
- **Pilots:** each pilot has a `mark`; `game/pilotPortrait.ts` draws a helmet badge in the livery (SVG) and `rosterOf(field)` feeds the HUD. **Grid intro card** before every menu race: 8 rows in grid order with portrait, ship and catchphrase, ≈ 3 s on the **wall clock** (the fixed loop runs behind real time on slow GPUs), any input skips. Results rows show portraits; a rival winner's catchphrase shows under the table.
- **Picker:** CPU DIFFICULTY (4 tiers + hint) on World Select and in Settings, saved to `Profile.aiTier`. Rookie switches on the Rookie hazard policy. `buildRaceField({ rivalTiers })` builds mixed fields (each rival with its tier's fits).
- **Sims:** `sim/tierMatrix.ts` adds to every per-world file: Pilot and Ace fields, a mixed field (Legend rivals ahead of Rookie rivals on average: P2.0 vs P7.0 on every track), Rookie-assisted from P8 (P1–P2 everywhere) and Pilot balance. "Mid-pack" is defined as P2–P7 and within 1.5 % of the field's median time: the Pilot field finishes as a ~1 s pack, so the exact place is a lottery. `runWorldRace(…, { untilAllFinish })` uses `RaceManager`'s new `resultsDelay = Infinity` so every ship finishes. Jade Ruins Legend sits at `maxLateral` 15.00 (limit < 16): watch it.

**Design decisions (grilling session with the user, 2026-10-04 — settled, don't re-open):**

> **Partly shipped early (PR #18, after the first iPhone test):**
> - **Picker:** Settings → Race → CPU DIFFICULTY (Rookie / Pilot / Ace) saves `Profile.aiTier`, and races use it. New profiles start on Rookie, and save v3 moved existing profiles to Rookie. M5 can move the picker to World Select as planned, or keep it in Settings, and must add Legend.
> - **Pace:** `AI_PACE` in `core/config.ts` gives each tier a base thrust scale and a rubber-band range. Rookie is 0.90 with no catch-up; Pilot, Ace and Legend keep v1's band. M5's `content/tiers.ts` `paceScale` and `rubberBand` should replace `AI_PACE` and keep Rookie no slower than today: the user playtested 0.90 on iPhone and liked it.
> - **CPU items** (EMP, Shield, Drop Mine) arrive with §P before M5.
> - **Damage:** wall, scrape and ship-to-ship damage were halved in PR #18 at the user's request. Balance against those values.

- **One PR**, after M4c, §P and §GP.
- **Tier picker:** a 4-way toggle (Rookie, Pilot, Ace, Legend) on World Select, saved to the profile. New profiles default to Rookie. Rival parts follow the tier, as the field builder already does. Rookie switches on the Rookie `HazardPolicy`.
- **Drafting** applies to every ship. Only the AI's eagerness to look for a draft depends on tier (Ace and Legend hunt for it).
- **Pilot intro card:** before every race; it moves on after ≈ 3 s, and any input skips it.
- **Assists early:** `physics/Assists.ts` (auto-accelerate, steering assist, rail repulsion) lands in M5 as tested logic with no settings UI, so the Rookie balance test can run. M7 adds the toggles plus No-KO and early boost.
- **Sim budget:** one sim file per track, each under 60 s on CI (vitest runs them in parallel). If a file can't stay under 60 s, fall back to Rookie and Legend plus one mixed-field ordering race per track, and record that in the as-built notes.

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

## V — Vehicle visual pass: grounded sci-fi ships and parts — V1 ✅ DONE (PR #27); V2 parts built (PR #29) and V3 chassis built (PR #30), both awaiting the user's look approval and the iPhone + iPad gate (§V.7)

**V1 gate result (2026-11-08):**
- **Look approved** by the user (2026-11-07).
- **Device fps:** the user ran an 8-ship Neon Bay race on the iPhone (the screenshot aspect matches the iPhone 18 Pro Max), with the performance panel on, before and after COMET. The device auto-picked **Med** (render ×1.50, dynamic resolution 100% throughout).

  | Build | fps | p50 / p95 / p99 (ms) | CPU sim / upd / draw (ms) | Draw calls | Triangles | Missed | Hitches (worst) |
  |---|---|---|---|---|---|---|---|
  | Before (the TestFlight build at the time, pre-M5) | 60 | 17.0 / 17.0 / 17.0 | 0.9 / 0.4 / 1.2 | 94 | 122k | 0.1% | 1 (151 ms) |
  | After (`v2/gp-grand-prix` with M5 + COMET) | 60 | 17.0 / 17.0 / 18.0 | 1.2 / 0.5 / 1.0 | 220 | 145k | 0.1% | 1 (105 ms) |

  **p95 unchanged, so V1 passes.** The user approved going ahead ("looks great") **without an iPad reading**: the iPad Air reading moves to V3's gate.
- **Watch item: draw calls rose 94 → 220.** This is not COMET's mesh: every ship LOD has 6 primitives, before and after. The "before" build also lacked §P, §GP and M5, so the rise is from those or from the per-ship trim/lite material split. Frame time didn't move, but V2/V3 must not add to it. See the draw-call rule in §V.7.

**As built — V1 COMET (PR #27)** (read before V2):
- **Model:** `blender/ships/build_ships.py` `build_comet` (GROUNDED chassis; the other 5 still use `build_ship` until V3), from `assets/reference/ships/comet/chosen.jpg`: blue tube fuselage with a painted scheme by position (white spine stripe nose → canopy, white lower chine, dark belly), a dark ram-intake mouth with a louvred tunnel, bubble canopy in a white surround, dark louvred side scoops with cyan strips, short pods at the rear on carbon outrigger pylons (white intake collars, glowing turbine faces, ribbed nozzles), swept white wings outboard of the pods with carbon trailing edges, twin canted tail fins with blue tips. LOD0 5,628 tris, LOD1 1,314. Size 2.74 × 1.03 × 4.53 m (pre-§V 2.56 × 1.04 × 4.52; width +7%, inside ±10%). Sockets moved with the pods (exhausts at the new pod tails; boosters on the pod flanks).
- **Trim sheet:** `blender/textures/build_trim.py`, 8 strips × 128 px (panel, plate, carbon, brushed, vent, ribbed, grip, flat; `common.TRIM_BANDS`). **Deviation:** the strips are numpy height fields (normals from the gradient, AO from a multi-radius cavity term) instead of a Cycles bake of modelled strips: exact, deterministic, ~1 s. Blender writes PNGs; `npm run assets -- trim` ships WebP via sharp: `trim_normal.webp` 105 KB + `trim_orm.webp` 76 KB = 181 KB (budget 400). The neutral `flat` strip sits where UV (0, 0) samples, so meshes without UVs (parts, other chassis) render exactly as before.
- **UVs:** `common.py` helpers take `strip=` (loft: u along the tube, the circumference split into panels that each span the strip; slab: caps u along y / f across x, sides u along the edge; fin, torus, disc likewise). `export_glb(..., texcoords=True)` for GROUNDED ships only.
- **AO:** `common.bake_vertex_ao` (Cycles AO bake to vertex colours, 96 samples, 0.6 m, each LOD alone) into `COLOR_0.a`. Runtime (`ShipAssembly.withVertexAO`): indirect diffuse × AO, indirect specular × mix(1, AO, 0.7), direct diffuse × mix(1, AO, 0.5). Vertex density is enough on COMET; no atlas fallback needed.
- **Materials:** `AssetLoader.loadShips` also loads the trim (flipY off, u repeat, v clamp, anisotropy 4). Role materials get `aoMap`/`roughnessMap`/`metalnessMap` = ORM and `normalMap` (normalScale (s, −s): derivative tangents). `assembleShip(…, { lite })`: rivals on Low drop the normal map and clearcoat (warm-up compiles them since they're in the scene).
- **LOD rule:** your ship is always LOD0 with full materials; rivals High LOD0, Med/Low LOD1, Low lite.
- **Garage:** turntable always LOD0 + full materials; the key light casts a shadow on the plinth (disc now metalness 0.3, roughness 0.5 so it shows). Orbit: right stick (yaw + clamped pitch), LB/RB zoom, mouse drag (x turn, y tilt) and wheel; it settles back to the auto-spin 1.6 s after the last input. `InputManager.orbitInput()`, `GraphicsSystem.orbitPreview`.
- **Rumble:** `game/Rumble.ts` on the player's rail/ship hits, boost, landings ≥ 0.35, EMP, mine, destruction; spaced ≥ 90 ms; `InputManager.rumble` feature-detects `vibrationActuator` (nothing on iOS WKWebView, as expected).
- **Checks:** `check-assets` — ship GLB ≤ 300 KB (COMET 121 KB), trim ≤ 400 KB, ships + parts + trim ≤ 2 MB (632 KB), Khronos `gltf-validator` on every GLB (errors fail), `TEXCOORD_0` on GROUNDED chassis, LOD0 size within ±10% of `HULL_SIZE`.
- **Not done in V1:** nozzle flare on boost and hover-pad glow (§V.2 animation) → V2; parts keep their M2 look → V2.
- **Desktop (High, autopilot, Neon Bay, 25 s, headless Chrome on Metal):** before 60 fps, p95 16.8 ms; after 60 fps, p95 16.8 ms. Device fps pending.

**As built — V2 parts (PR #29, branch `v2/v2-parts`, stacked on #28):**
- **Draw-call audit (§V.7 step 1).** `scripts/perf-desktop.mjs` (serve `dist/`, 8-ship Neon Bay autopilot in headless Chrome on Metal, per preset; `--audit` counts one frame's calls by category by hiding groups and re-rendering, on the grid and mid-race).
  - **The 94 → 220 rise was screenshot timing, not code.** The perf panel's "calls" is one frame's count, and it swings 82–281 within a single race depending on how many ships are on screen. `origin/main` (the old TestFlight code) draws the same 250-call grid frame as M5 + COMET (252: the +2 is §P's mine group).
  - **Ships were 80% of the worst frame:** 204 of 252 calls on the grid (High), with parts at 114 of them. Each part was multi-role, so each ship's 5 part instances cost about 12 draw calls, more than its chassis (6) and effects (4).
  - **Fix:** `assembleShip(…, { merge: true })` for rivals bakes chassis + parts into **one mesh per material role** (≤ 6 calls per rival) once per race (`mergeByMaterial`). It dequantises meshopt attributes through `getX…`, flips the winding of the mirrored left booster, keeps COLOR_0.a (AO) and TEXCOORD_0, and gives part vertices body coordinates that no decal covers. The player's ship and the Garage stay unmerged (`setLivery`, part swaps). A unit test checks every chassis × Stock/Prototype × LOD for ≤ 6 meshes with the same triangles and bounds.
  - **Result (desktop):** grid frame 252 → 161 calls on High/Med and 224 → 141 on Low; race peak 264 → 166; median 114 → 107. p95 unchanged at 16.7–16.8 ms on every preset. Triangles unchanged (135k / 129k / 116k).
- **Parts** (`blender/parts/build_parts.py`): all 16 rebuilt on the COMET look and the tier ladder. Stock is painted plate. Mk II adds cooling fins (vent/ribbed) and a glow line. Mk III is carbon and brushed metal with machined collars. Prototype has an exposed glowing core: a caged core on the engine, a core band on the booster, a twin element on the stabilizer and a crest over a core window on the hull. Trim UVs on every face, AO baked (`bake_vertex_ao`, 64 samples, 0.25 m), **≤ 3 roles each** (the build fails above that). 24–968 triangles; `parts.glb` 166 KB (was 102 KB). Sizes stay at the M2 parts', so they sit on COMET's sockets and the 5 legacy chassis (checked on TITAN in the Garage). There are no `_heavy` class variants: none existed, and the runtime only asks for `<slot>_t<tier>`.
- **Nozzle flare and hover-pad glow (§V.2), 0 extra draw calls.** The flare is one quad per nozzle inside the existing merged flame mesh (`aFlare` attribute; a hot core with a horizontal streak). It bursts when a boost starts (decays over ~0.45 s) and holds at 0.6 × the boost level while boosting. The pads are four hot spots in the hover-pool shader under the hull sides, fore and aft: brightest at the bottom of the bob, fading to 25% by 90 m/s. Both use the livery glow colour and are off for rivals on Low (`ShipModel` option `fxLite`).
- **Checks:** `check-assets`: ≤ 3 primitives, `TEXCOORD_0` and `COLOR_0` on every part; ≤ 6 primitives per chassis LOD. `e2e/garage.spec.ts`: on each of Low, Med and High, cycle every chassis × tier (all four slots at each tier) on the turntable, then start a race (merged rivals), with no console errors. `blender/tools/preview.py --parts` renders the parts sheet (`docs/v2/shots/v2/parts-sheet.jpg`).
- **Tests:** 445 unit/sim tests in 52 files; e2e 13/13. App JS 324.8 KB gzip; `public/game` 944 KB; ship assets (ships + parts + trim) 714 KB of 2 MB.
- **Commit granularity:** the four slots landed in one commit (they share one script and one GLB) instead of one commit per slot.

**As built — V3 chassis (PR #30, branch `v2/v3-chassis`, stacked on #29):**
- **All six chassis are now GROUNDED**, each modelled from its `chosen.jpg` (looked at before modelling), in the order DART → WISP → ARROW → TITAN → BASTION, one commit each. The legacy `build_ship`/`DESIGNS`/`LODS` path is deleted; `ShipModel`'s procedural ship stays as the load-failure fallback. A full `npm run assets -- ships` rebuilds all six byte-identical to the committed GLBs (COMET included).
- **Shared helpers** in `build_ships.py`:
  - `hull_rows` and `comet_loft`: a painted loft whose paint scheme is a function of position.
  - `canopy` (optional facets), `pod` (collar/main paint, turbine or grille intake, ribbed glowing nozzle, power 2 round to 5 square).
  - `beam` (truss struts, grab rails, chine pinlines), `tail_bay`, `hull_nozzle`, `hazard_band`, `mirror_outline`.
  - **Per-chassis sockets:** each config carries pod geometry, the nose/tail/spike z, the COLOR_0 box half-width and optional `hullSock`/`stabSock` (WISP's big canopy covers the default hull-part spot; TITAN's and BASTION's decks sit differently).
- **Per chassis** (LOD0 / LOD1 triangles, LOD0 size x × y × z, GLB):
  - **DART** 4,910 / 1,110, 2.60 × 1.14 × 5.25 m, 115 KB.
    - A needle spike (counts toward length; LOD1 is a 4-sided cone), an exposed lattice truss along the lower mid-fuselage (LOD1: a flat dark slab), and canards.
    - Slim pods with grille intakes and amber rings, dark (livery secondary) swept wings and tall fins with orange tips.
  - **WISP** 5,192 / 1,242, 3.00 × 1.42 × 4.56 m, 118 KB.
    - 48 loft rings on LOD0, a very large canopy, white swooshes edged with a magenta pinline (glow faces in the paint scheme).
    - A dark ram nose and scoops, fat pods with brushed lips, and very tall fins canted 0.5 rad.
  - **ARROW** 3,180 / 842, 2.28 × 1.19 × 5.21 m, 88 KB.
    - An 8-facet loft (power 1.6, every face a flat plate), a long flat pointed nose, and a faceted canopy.
    - A glow pinline beam along the chine over a dark underbody, faceted pods, straight-edged wings, twin canted fins and small pod fins.
  - **TITAN** 3,560 / 920, 2.97 × 1.16 × 4.38 m, 98 KB.
    - A box loft (power 6) of red plates with black inset deck panels, a steel ram with twin intakes, louvred vents and lower armour strakes.
    - Square grille pods, **four nozzles** (two hull, two pod), a small armoured canopy far back on a dark deck, and a triple fin.
  - **BASTION** 4,508 / 1,178, 2.84 × 1.06 × 4.50 m, 112 KB.
    - COMET's layout boxier (power 3.6) and wider, with a silver spine and chine, twin louvred scoops and lime strips.
    - Square pods behind silver collars with a **hazard band of alternating dark/glow quads**, grab rails, canards and a wide canopy.
  - Every LOD has 6 primitives, LOD1 ≤ 1.5k, and hulls are within ±10% of `HULL_SIZE`. `check-assets` now requires TEXCOORD_0 on every chassis.
- **Deviation:** the livery secondary is dark on DART, ARROW and TITAN's factory liveries, so the concepts' dark carbon panels use `livery_secondary`, and a player's livery recolours them. Fixed-dark details (intakes, truss, nozzles) use `dark`.
- **Desktop (same method as V2):** grid frame 161 / 161 / 141 draw calls on High / Med / Low, the same as PR #29. Race median 107 / 107 / 86. p95 16.8 ms on every preset. Ship assets 999 KB of 2 MB; `public/game` 1,229 KB.
- **Tests:** 445 unit/sim tests (52 files) and e2e 13/13, unchanged and green.
- **Screenshots:** `docs/v2/shots/v3/<id>-before-after.jpg` (top: PR #29 build; bottom: V3. Columns: Garage, race chase at Med, at Low) and `<id>-views.jpg`. The "before" race shots carry Prototype parts, as do the after shots.
- **Gate (pending):** the user approves each chassis's look, then reads the perf panel on the iPhone 18 Pro Max **and** the iPad Air: 8-ship Neon Bay, mixed field, 60 fps, p95 ≤ the PR #29 build's + 1 ms. The iPad's "before" reading is taken on the #29 build.

**Design decisions (grilling session with the user, 2026-11-07; settled, don't re-open):**

- **Placement:** after M5, as its own PRs. Each PR ships to Netlify and iOS (§0 rule 9).
- **Look: grounded sci-fi.** Today's silhouettes get mechanical detail: intakes, vents, panel seams, exposed engine parts, armour plates on the heavies. Materials read as real ones: carbon fibre, brushed and anodised metal, slight edge wear, baked AO. The livery still tints the paint. Not photoreal.
- **Concepts are reference only.** The user makes concept images in Gemini from `docs/v2/VEHICLE_CONCEPTS.md`. Every ship and part is still built procedurally in `blender/` scripts, which keeps sockets, livery roles, both LODs and `npm run assets` deterministic. **No AI image-to-3D for ships or parts** (it loses sockets and roles). It may be used for one-off scenery props only.
- **Concept files:** `assets/reference/ships/<id>/` (and `assets/reference/parts/`), JPEG, ≤ 500 KB each, ≤ 4 per chassis. They're committed, never shipped (not under `public/`), and listed in `assets/LICENSES.md`. The user marks the winner `chosen.jpg`, with optional `notes.md` ("nose from image 2"). **Model only from a `chosen.jpg`.**
- **Identity is locked:** each chassis keeps its name, class, blurb, personality and factory livery (`content/ships.ts`). The hull stays within ±10% of today's bounding box per axis (SHIP_LENGTH × SHIP_WIDTH × SHIP_HEIGHT × class scale). Stats, collider, camera, items and sims don't change. §V is visual only; any sim or physics test diff is a bug.
- **Order and gates:**
  1. **V0, docs (this spec, the prompt sheet, `assets/`):** lands before M5 is built, so the user can generate images in parallel.
  2. **V1, COMET pilot:** the default chassis end to end. This PR carries the shared machinery (UVs, trim sheet, AO bake, material changes, LOD rule, Garage High, Garage orbit, rumble, budget checks). **Gate:** user approval of look and fps (below) before V2.
  3. **V2, the 16 bolt-on parts** in one PR (they're shared by every chassis, so new-look parts must follow COMET straight away).
  4. **V3, the other 5 chassis** (one PR, or split light/balanced/heavy if large).

### V.1 Geometry and textures

- **Detail lives in surfaces, not triangle count.** Budgets stay: `<id>_LOD0` ≤ 12k triangles, `<id>_LOD1` ≤ 4k, parts ≤ 1.5k each (LOD0 is ≈ 3.1k today, so there is headroom for real shape detail such as intakes, plates and nozzles).
- **One shared 1024² texture atlas for every ship and part, with surface detail only and no colour:** a **trim sheet** of tiling strips (panel seams, vents, rivet rows, carbon weave, brushed metal, grille, worn edge). Each surface is UV-mapped (`TEXCOORD_0`) onto the strip it needs, so all 22 meshes share the 1024² without each one needing its own texture space.
  - Channels: a normal map, plus one packed texture (glTF ORM: R = detail AO, G = roughness, B = metalness).
  - The trim sheet is **generated in Blender** by a script (`blender/textures/build_trim.py`): high-detail strips baked onto a plane with Cycles. The bake is small (1024², a few minutes at most), and its output PNGs are committed like the GLBs. Nothing is hand-painted.
- **Large-scale AO is baked per vertex into `COLOR_0.a`.** `COLOR_0.rgb` already holds the decal body coordinates, so the decal shader is untouched. That way AO costs no texture space and each ship keeps its own occlusion. If vertex density makes it blotchy, V1 may switch to a per-ship AO region in the atlas instead and record why.
- **Livery is unchanged in behaviour:** `ShipAssembly.makeMaterials` keeps the role materials, the livery tint, the 6 decals and `setLivery()` in place. The trim maps are added as `normalMap` / `roughnessMap` / `aoMap` (or ORM via `onBeforeCompile`) on top of the existing tints. Saved liveries and the livery editor keep working without a save migration.
- **Texture format:** WebP (`EXT_texture_webp`) through glTF Transform. iOS Safari decodes WebP. KTX2 is out for now (`toktx` isn't installed); revisit only if texture memory or decode time shows up in profiles.

### V.2 Rendering rules

- **Your ship always uses LOD0, on every preset.** This replaces the `GraphicsSystem.addShip` rule. Rivals keep today's rule (High LOD0; Med and Low LOD1). Today iOS auto-selects Low, so the player sees the 850-triangle LOD1. LOD0 for close rivals is a later option, only if V1 measures headroom.
- **Low preset:** rivals drop the normal map and clearcoat (keeping AO and roughness). The player keeps full materials. These are separate material instances, so add them to the shader warm-up.
- **Garage is the showroom:** the turntable always renders LOD0 with full materials and shadows at High quality, whatever the race preset (it's a single ship and the race backdrop isn't rendered while the garage is open, §M2 as built).
- **Animation, all in shaders on existing meshes:** engine glow already follows throttle and boost (v1 `ShipModel`). §V adds a nozzle flare on boost (at `socket_exhaust_L/R`) and a hover-pad glow under the hull that pulses with hover bob and speed. **No new moving meshes** beyond today's flaps and bank.

### V.3 Controls

- **Garage orbit:** the right stick turns the turntable (yaw, plus limited pitch), a shoulder button (LB/RB) zooms, and releasing the stick lets it settle back into the auto-spin. Mouse drag and wheel do the same on the web; touch drag can follow in M7. It must not steal the d-pad or left-stick menu navigation.
- **Rumble is a nice-to-have where supported:** `gamepad.vibrationActuator?.playEffect('dual-rumble', …)` on wall hits, item hits, boost start and big landings, feature-detected and silently skipped when null. iOS's WKWebView doesn't reliably expose it (MDN compat lists iOS Safari as unsupported; WebKit's newer work is experimental), so **don't expect rumble on the TestFlight build.** A native Capacitor plugin (GCController haptics) is an M7 option, not §V.

### V.4 Budgets and checks (extend `scripts/check-assets.mjs`)

- Each ship GLB ≤ **300 KB** (was 400). `parts.glb` stays ≤ 600 KB. The trim sheet (all its textures) ≤ 400 KB. **All ship assets together ≤ 2 MB** (ships, parts and the trim textures).
- Run the official glTF validation (`@gltf-transform` `validate`, or `gltf-validator`) on every GLB; errors fail.
- Keep today's checks (node, socket and role names, triangle budgets, nose direction). Add checks for `TEXCOORD_0` on every textured mesh and for each hull's bounds staying within ±10% of the pre-§V values (store them in the test).
- Retune the numbers after V1 is measured on device; record the result in the as-built notes.

### V.5 Done when

**V1 COMET (the gate):**
- [ ] The PR body has before-and-after screenshots of the Garage turntable, the race chase camera at Med, and the Low preset.
- [ ] An 8-ship race on Neon Bay holds 60 fps on the iPhone 18 Pro Max and the iPad Air 11" (the user reads the perf overlay). The 95th-percentile frame time is no more than 1 ms worse than the pre-§V build.
- [ ] Desktop web on High shows no frame-time regression.
- [ ] The look is approved by the user.
- [ ] All sims, unit tests and e2e tests pass unchanged. `check-assets` passes with the new budgets.

**V2 parts / V3 chassis:** the same screenshots and checks per PR. The total asset budget holds. Every chassis × part combination renders on Low, Med and High (extend `e2e/garage.spec.ts` to cycle them).

### V.6 Not adopted from the cross-game asset-pipeline doc (decided, 2026-11-07)

The user's `ASSET_PIPELINE.md` (written for GolfCartSimulator) was reviewed. Adopted: scripted headless export (already the case), glTF Transform optimisation (already), CI validation and budget enforcement, `assets/LICENSES.md`, `assets/reference/`, and AO/normal/roughness for realism instead of triangle count. **Not adopted:** GIS terrain, Git LFS (assets total under 1 MB), a shared `asset-tools` repo (maybe later, if a second game uses the same scripts), Windows-PC offloading (no job is heavy enough), and KTX2 (for now).

### V.7 V2 + V3 build plan: one session, two PRs (agreed 2026-11-08)

The user asked for the rest of the ships "in one big session". One session builds both, as **two stacked PRs**: the parts are shared by every chassis, and each PR gets its own preview to review.
- **PR A, V2:** the 16 parts, plus the V1 leftovers (nozzle flare, hover-pad glow).
- **PR B, V3:** the other 5 chassis.

Commit after each part slot and each chassis, and push PR A before starting V3, so a usage-limit stop loses little. The first M5 session stopped partway through.

**Step 0: setup and baseline**
- Branch `v2/v2-parts` from the newest open stack branch (`v2/gp-grand-prix` while #24 is open), and later `v2/v3-chassis` from `v2/v2-parts`.
- Read "As built — V1 COMET" above. It covers the trim strips (`common.TRIM_BANDS`), the `strip=` UV helpers, `bake_vertex_ao`, `export_glb(texcoords=True)`, `ShipAssembly.withVertexAO`, the lite materials and the `check-assets` checks.
- Record a desktop baseline before changing anything: `?perf=1`, an 8-ship Neon Bay race, High and Med, autopilot, giving fps, p95, draw calls and triangles. Use it for both PRs' before/after tables.

**Step 1: draw-call audit (before modelling)**
- Find where the 94 → 220 rise comes from (§V gate result). Use `renderer.info` per pass, and toggle ships, parts, scenery, items and effects in a dev build.
- **Rule for V2/V3:** ship-related draw calls must not grow.
  - Each chassis LOD keeps at most **6 primitives** (one per role).
  - Each part keeps at most **3**.
- If ships turn out to be a large share, merge each **rival's** parts into its chassis per material role at assembly time (`BufferGeometryUtils.mergeGeometries`, once per race, in `ShipAssembly`). The player's ship and the Garage stay unmerged so `setLivery()` and part previews keep working.
- Record what the audit found in the as-built notes, even if nothing changes.

**Step 2, PR A (V2): parts in COMET's language**
- **No part concepts exist** (`assets/reference/parts/` is empty). Parts follow the approved COMET look and the tier ladder in `VEHICLE_CONCEPTS.md`:
  - **Stock:** plain painted steel and panel strip.
  - **Mk II:** adds cooling fins (vent and ribbed strips).
  - **Mk III:** carbon and brushed, machined collars, more glow.
  - **Prototype:** exposed glowing core, the most glow, still believable.
  - If the user adds part concepts later, they replace this ladder.
- Every part follows these rules:
  - It is UV-mapped to trim strips, has AO baked into `COLOR_0.a`, and has at most 1.5k triangles and 3 primitives.
  - It keeps its node name (`engine_t0..t3`, `booster_t0..t3`, `stabilizer_t0..t3`, `hull_t0..t3`, plus the class variants such as `hull_t2_heavy`).
  - **It must sit right on both COMET's new sockets and the 5 old chassis**, which are still pre-§V during V2.
  - `parts.glb` ≤ 600 KB.
- **V1 leftovers (§V.2 animation, shader only):**
  - **Nozzle flare on boost** at `socket_exhaust_L/R` (an additive cone or sprite, scaled by boost, `toneMapped: false`).
  - **Hover-pad glow** under the hull that pulses with the hover bob and fades with speed.
  - Both reuse the livery glow colour, add no moving meshes, and add at most 2 draw calls per ship. They're off for rivals on Low.
- **Checks:**
  - `check-assets` covers part UVs, per-part primitive and triangle counts, and the total of 2 MB or less.
  - `e2e/garage.spec.ts` cycles every chassis × slot × tier on Low, Med and High with no console errors.
  - `blender/tools/preview.py` produces a parts sheet for the PR body.
- **PR A done when:**
  - The PR has Garage screenshots of all 4 tiers per slot on COMET and on one heavy (TITAN), plus a race shot with boost flare.
  - The desktop before/after table shows no p95 regression, and draw calls are not up.
  - CI is green.
  - The user approves the parts' look on the preview.

**Step 3, PR B (V3): the other 5 chassis, from each `chosen.jpg`**
- Build each as `build_<id>` (GROUNDED, like `build_comet`) in this order, committing after each: **DART → WISP → ARROW → TITAN → BASTION**.
- When all 5 are done, delete the legacy `build_ship`/`DESIGNS` path. Keep v1's procedural `ShipModel` as the load-failure fallback.
- **Every chassis:**
  - LOD0 ≤ 12k triangles (aim 5–7k like COMET).
  - LOD1 ≤ 4k (**aim ≤ 1.5k**, like COMET's 1,314: rivals use LOD1 on Med and Low, so V3 is the first time many new LOD1s are on screen together).
  - 6 primitives per LOD.
  - Hull within ±10% of `HULL_SIZE` per axis.
  - Sockets moved with the pods.
  - Colour stripes are geometry split by role, as on COMET: the trim sheet carries no colour.
- **Per-chassis notes from the concepts:**
  - **DART (light):**
    - An orange tube fuselage behind a **long thin needle spike**.
    - An exposed dark lattice truss along the lower mid-fuselage.
    - Small canards near the nose.
    - Long slim pods on pylons with amber nozzle rings.
    - Dark swept wings and tall swept twin fins.
    - **The spike counts toward length:** shorten the body so the spike keeps its read. LOD1 may reduce the spike to a 4-sided cone and the truss to a flat dark slab.
  - **WISP (light):**
    - A short, wide, rounded fuselage, almost all canopy: a very large bubble canopy.
    - White swoosh panels edged with a magenta pinline.
    - A small dark ram nose.
    - Short fat pods with magenta turbine faces.
    - Small swept wings and very tall, strongly canted fins.
    - Use more loft rings on LOD0 for the curves.
  - **ARROW (balanced):**
    - **Faceted, folded-plate surfaces, not tubes:** build from slabs and folded panels.
    - A long flat pointed nose and a long low canopy.
    - A thin glowing yellow pinline along the chine, over a dark underbody.
    - Slim pods with forward intakes.
    - Straight-edged wings.
    - **Twin canted fins** (the concept overrides the prompt's single centre fin).
  - **TITAN (heavy):**
    - A box-section armoured fuselage with bolted plates (plate strip) and black inset panels.
    - A **worn steel ram nose** (worn-edge strip).
    - Big pods with grille intakes.
    - **Four rear nozzles**: two on the hull, two on the pods.
    - A small armoured canopy set far back, and a triple fin.
    - Mostly flat slabs, so cheap in triangles.
  - **BASTION (heavy):**
    - COMET's layout made boxier and wider: green paint with silver panels and flat armour panels.
    - Lime glow strips.
    - Louvred side scoops.
    - Square-edged pods with large intakes and a **hazard-stripe band**: geometry stripes in the dark and glow roles, not a texture.
    - Grab rails and a wide canopy.
- **PR B done when:**
  - A before/after sheet of all 5 (Garage plus race chase camera at Med and Low) is in the PR body.
  - Sims, unit tests and e2e are unchanged and green, and `check-assets` passes.
  - Total ship assets are ≤ 2 MB, and draw calls are not up versus PR A.
  - **The device gate holds on BOTH devices:** an 8-ship Neon Bay race with a mixed field (every chassis present), at 60 fps, p95 ≤ the PR A build's + 1 ms.
    - On the iPhone, the PR A build is the baseline (its pre-V2 reading was p95 17.0 ms).
    - **The iPad Air needs its own before reading, taken on the PR A build before PR B merges.**
  - The user approves each chassis's look. A rejected chassis can stay on the legacy build for a follow-up PR, recorded in the as-built notes.

**Step 4: hand-off**
- Update this section's header and as-built notes.
- Run `npm run codebase`.
- Put both PRs' preview URLs, the iOS build command and the device-test steps in the final report. Those steps are: Settings → Graphics → PERFORMANCE PANEL, then an 8-ship Neon Bay race, then screenshot the end-of-race summary.

---

## X — 2.1 expansion: cups, environment effects, upgrades, three new worlds (planned 2026-11-10)

SPEC §10 says what and why. This section is the how. **Design decisions (grilling session with the user, 2026-11-10; settled, don't re-open)** are listed per milestone below.

**Milestones, in build order. One branch and one PR each, stacked in this order on the §V V3 catch-up PR (#31):**

| # | Milestone | Branch | Save | Needs from the user |
|---|---|---|---|---|
| X0 | Design docs (this section, SPEC §10, `WORLD_CONCEPTS.md`) | `v2/x-design-docs` | — | — |
| X1 | Cups groundwork | `v2/x1-cups` | v5 → v6 | Device check (pad-only cup) |
| X2 ✅ built (#34) | Environment effects framework | `v2/x2-envfx` | — | Look approval of Neon Bay; device gate (fps) |
| X3 ✅ built (#35) | Upgrades: sidegrades and the Aero slot | `v2/x3-upgrades` | v6 → v7 | Look approval of the new parts; device gate |
| X4 🟡 gameplay half built (PR_X4) | World 6, Tempest Spire | `v2/x4-tempest-spire` | — | **`chosen.jpg`** (the look waits for it); then look approval and the device gate |
| X5 | World 7, Cinder Forge | `v2/x5-cinder-forge` | — | `chosen.jpg`; look approval; device gate |
| X6 | World 8, Abyss Line (and the Storm Cup) | `v2/x6-abyss-line` | — | `chosen.jpg`; look approval; device gate |
| X7 | Effects polish on the five 2.0 worlds | `v2/x7-old-world-fx` | — | Look approval per world; device gate |

**Rules for every X milestone** (in addition to §0):
- **Scope:** audio (M6), touch (M7), World Tour, Time Trial and ghosts (M8) are not touched. Nothing here may block them.
- **Flags:** `src/core/features.ts` gains `expansion` (off on `main`). It hides the new worlds' cards, the Storm Cup and the Aero tab and variant picker until their milestone is complete. Each milestone says below what it turns on.
- **Device gate, the same for every milestone:** on the iPhone 18 Pro Max and the iPad Air 11", at the device's own preset, Settings → Graphics → PERFORMANCE PANEL on, an 8-ship race on the milestone's world (Neon Bay for shared changes), then a screenshot of the end-of-race summary. Pass is 60 fps with p95 no more than 1 ms above the build before the PR.
- **PR body:** a before/after table (fps, p50/p95/p99, draw calls, triangles) from `scripts/perf-desktop.mjs`, the "done when" list ticked or explained, and a list of any change nobody asked for.
- **Sims:** every sim file stays under 60 s on CI. An assertion is never loosened to go green.
- **A world's look is never built without `assets/reference/worlds/<id>/chosen.jpg`.** The track, gimmick, hazard, AI and sims do not need it: they are built first on a placeholder theme (flat sky, the palette's neon, no props). If the image has not arrived when the gameplay half is done, push the PR as a draft with the world still behind `expansion` and start the next milestone.

---

### X1 — Cups groundwork — ✅ BUILT (PR #33; waiting on the user's pad-only cup check on iOS)

**As built (PR #33)** (read before X2 or M8):
- **Code:** `content/cups.ts` (`CUPS`, `CupDef { id, name, tagline, worlds }`, `cupById`, `cupAvailable`, `availableCups`, `DEFAULT_CUP_ID` = `neon`). `game/modes/GrandPrix.ts` no longer reads `WORLDS`: `GP_WORLDS` and `GP_RACES` are gone; `CupState` has `cupId`; `newCup(cupId, tier)`, `cupWorlds`, `cupRaces`. Trophies are `Trophies = Record<cupId, AITier[]>` with `trophiesOf`, `trophyCount`, `addTrophy(trophies, cupId, tier, order)` and `sanitizeTrophies`.
- **Availability:** a cup can be played when every world it names exists in `WORLDS` and is `built`. The Storm Cup is in the data now and stays hidden until `abyss-line` is built (X6). `sanitizeCup` drops a saved cup that is unknown or unavailable.
- **Save v6:** migration 5 → 6 gives a cup in progress `cupId: 'neon'` and turns the trophy list into `{ neon: [...] }` (an empty list becomes `{}`).
- **Championship:** `game/modes/Championship.ts` (`seasonCups`, `seasonStandings`, `seasonFinished`, `seasonChampion`). Pure; nothing saves, pays or shows it.
- **UI:** the Grand Prix screen shows the picked cup (name, tagline, its worlds, its trophies). A row of cup tabs appears only when more than one cup is available, so today the screen has the same layout. The start button reads `START NEON CUP · PILOT`. Standings and the menu's CONTINUE CUP name the cup; the pilot card shows one trophy row per cup won. `App.startCup(cupId = 'neon')`.
- **Tests:** 458 unit and sim tests in 54 files; e2e 13/13. New: the cups-are-data tests (a sixth world changes no cup), trophies per cup, the v5 → v6 migration through `SaveStore`, and `Championship.test.ts`.
- **Deviations from the plan:**
  - No `CupDef.requires` field and no `expansion` flag yet. Every cup is open, and availability already follows the built worlds, so neither has a reader until X3 (flag) and M8 (unlock rules).
  - The cup sim still runs the five real Neon Cup races. The "second cup is honoured" proof is in the unit tests (a cup's length and worlds come from its own definition), not in a second 5-race sim, which would add about 10 s to CI for no new coverage.


**Design decisions:**
- A cup is data: `content/cups.ts` exports `CUPS: readonly CupDef[]`, with `CupDef { id, name, worlds: readonly WorldId[] (5), requires?: … }`.
  - `neon` — **NEON CUP**: `neon-bay`, `sunset-mesa`, `cryo-station`, `jade-ruins`, `orbital-ring`. This is the §GP cup with its worlds unchanged.
  - `storm` — **STORM CUP**: `sunset-mesa`, `tempest-spire`, `jade-ruins`, `cinder-forge`, `abyss-line`.
- A cup is **available** when every one of its worlds is `built` (and, for a cup with a world behind `expansion`, when that flag is on). The Storm Cup therefore appears by itself in X6. Until then the Grand Prix screen shows one cup and looks as it does today.
- Unlock rules are data (`CupDef.requires`), but every cup is open until M8's World Tour exists, as §GP decided.
- Points, grid, tiebreak, retire and no-restart rules do not change. The cup bonus is paid per cup.
- **Trophies are per cup and tier.** Trophies won before save v6 belong to the Neon Cup.
- **Championship:** designed now, built as data and pure functions only. No screen, no save field, no payout. M8 decides those.
  - A season is every available cup, in `CUPS` order, at one tier.
  - Season score = the sum of a racer's cup points. Ties break on cups won, then on the best cup rank, then on ship id (a total, stable order, as in §GP).
  - The winner earns a Champion trophy for that tier (the function returns it; nothing stores it yet).

**Build steps:**
1. `content/cups.ts` with `CUPS`, `cupById`, `availableCups(features)`, and a unit test that every cup has 5 distinct known worlds.
2. `game/modes/GrandPrix.ts`: remove `GP_WORLDS = WORLDS.map(…)` and `GP_RACES`. `CupState` gains `cupId`. `newCup(cupId, tier)`, `cupRaces(cup)`, `cupFinished`, `cupWorld` read the cup's own world list. **This is the fix for the hidden bug: today a sixth world would make the existing cup 6 races long.** Add a regression test that adding a world to `WORLDS` does not change any cup.
3. Trophies: `Profile.trophies` becomes `Record<cupId, AITier[]>`. `addTrophy(trophies, cupId, tier)`, `hasTrophy`.
4. Save v6 (`save/schema.ts`, `migrations.ts`): migration 5 → 6 sets `cup.cupId = 'neon'` on a cup in progress and turns `trophies: AITier[]` into `{ neon: [...] }`. The sanitizer drops a saved cup whose `cupId` is unknown or unavailable (the cup ends; nothing else is lost) and drops unknown cup ids from trophies. `SaveStore` tests: the migration, an old v5 save with a cup in progress, a bad `cupId`.
5. `game/modes/Championship.ts` (pure): `seasonCups`, `seasonStandings(cupResults)`, `seasonChampion`. Unit tests for the sum, each tiebreak and a season with one cup.
6. UI: `ui/screens/GrandPrix.tsx` lists the available cups (one card each: name, the 5 world chips, the trophies per tier). With one cup it keeps today's layout. `CupStandings.tsx` shows the cup's name and "RACE n OF 5". The pilot card shows trophies grouped by cup. Pad focus and spatial navigation as today.
7. `App`: `cupRace`, `currentWorld` and `bookCupRace` read the cup through `cupById(cup.cupId)`.
8. Tests: update `GrandPrix.test.ts`, `grandPrix.sim.test.ts` (five real races of the Neon Cup, reload mid-cup; plus a synthetic second cup made of built worlds, to prove the list is honoured) and `e2e/grandprix.spec.ts`.

**Done when:**
- [ ] The Neon Cup plays exactly as the §GP cup did (same e2e, same sim).
- [ ] A v5 save with a cup in progress and trophies loads as v6 with both kept.
- [ ] Adding a world to `WORLDS` changes no cup (test).
- [ ] The championship functions are tested; nothing in the UI shows them.
- [ ] Web and iOS: a pad-only cup start, race, standings, reload, CONTINUE CUP.

**Device check (no fps gate; nothing renders differently in a race):** on iOS with the 8BitDo, start the Neon Cup, finish race 1, close the app on the standings screen, reopen, CONTINUE CUP.

---

### X2 — Environment effects framework — ✅ BUILT (PR #34; waiting on the user's look approval of Neon Bay and the device gate)

**As built (PR #34)** (read before X4 or X7):
- **Code:**
  - `graphics/envfx/EnvFxSpec.ts`: the data format, `ENVFX_QUALITY` per preset, `resolveEnvFx(spec, level, reducedMotion)`, `planDrawCalls`, `flashTime` (pure, 7 tests).
  - `graphics/envfx/Weather.ts` (one instanced quad mesh in a 90 × 50 × 90 m box round the camera, wrapped in the vertex shader; streaks follow the motion relative to the camera), `FogSheets.ts`, `Shafts.ts`, `SetPieces.ts`, `WetDeck.ts`, and `EnvFx.ts` (the orchestrator; 5 tests on Neon Bay).
  - Colour grade and the lightning flash are uniforms in the final pass (`shaders/chromatic.ts`, `PostFX.setGrade` / `setFlash`). The grade maths is compiled in only when a world has a grade (`GRADE` define, set at world change, before the warm-up).
  - Surface particles: `Effects.setSurface` and `emitSurface` in the shared point pool.
  - `WorldTheme` gained optional `envfx` and `roleMaterial(role)`. `GraphicsSystem` owns one `EnvFx`: `applyTheme` → `setWorld`, `setTrack` → `build`, `update`, and the flash lifts the hemisphere and fill lights.
- **Neon Bay's set** (`themes/neonBay.ts` `envfx`): rain, wet-look deck, sea mist, searchlight shafts, 2 airships (`airship_0` in `build_props.py`; `props.glb` 28 → 36 KB; the other four worlds' GLBs rebuilt byte-identical), far lightning, spray, a cool grade.
- **Checks made:**
  - Every effect sits outside the track corridor: shafts 94 m or more from the centre line, airships 390 m or more.
  - The wet-deck streak colours match their rails (the deck's v coordinate is 0 at the left rail, 1 at the right).
  - The airships were lowered from 240 m to 130 m above the track centre. At 240 m they were above the chase camera's view; at 130 m one is in view for about a third of a lap.
  - Low drops the shafts and the wet deck and draws 1 fog sheet; Med draws half the shafts and 2 sheets. Reduced motion stops the flash and halves the streaks.
  - Sunset Mesa (no `envfx`) is unchanged: an empty effects group, the same 41 shader programs, the same 104 draw calls, an untouched deck material. Shots: `docs/v2/shots/x2/sunset-mesa-before.jpg` and `-after.jpg`.
  - The smoke test now runs one race per preset (High, Med, Low) and fails on a console error or a shader compiled mid-race.
- **Desktop perf** (`scripts/perf-desktop.mjs --quality high,med,low --seconds 25 --audit`, 8-ship Neon Bay):

  | Preset | fps | p50 / p95 / p99 ms | Grid-frame draw calls | Race median draw calls | Triangles |
  |---|---|---|---|---|---|
  | High, before (#33) | 60 | — / 16.8 / — | 161 | 106 | 147k |
  | High, after | 60.0 | 16.7 / 16.8 / 16.8 | 166 (+5) | 112 | 153k |
  | Med, before | 60 | — / 16.8 / — | 161 | 107 | 140k |
  | Med, after | 59.9 | 16.7 / 16.8 / 16.8 | 166 (+5) | 111 | 144k |
  | Low, before | 60 | — / 16.8 / — | 141 | 86 | 126k |
  | Low, after | 59.9 | 16.7 / 16.7 / 16.8 | 145 (+4) | 90 | 128k |

  The effects group costs 5 draw calls (4 on Low) against a budget of 6. Ship draw calls are unchanged (113 on the grid frame at High and Med, 93 at Low).
- **Tests:** 470 unit and sim tests in 56 files; e2e 15/15.
- **Deviations from the plan:**
  - Height fog is drawn as up to 3 drifting sheets in one instanced draw call, not as a height term in every material's fog. A height term would mean patching every lit and custom shader.
  - The Sunset Mesa check is structural (programs, draw calls, materials) plus a pair of shots, not a pixel diff. The sky and speed lines animate on the wall clock, so two runs never match pixel for pixel.
- **Still open:** the user's look approval of Neon Bay's set, and the device gate (iPhone and iPad, 8-ship Neon Bay).


**Design decisions:**
- Effects in priority order (impact per frame-time cost): colour grading; weather particles; height fog and fog banks; animated sky layers and lightning flashes; surface reactions; drifting set pieces; wet-look deck; light-shaft cards.
- Every effect is **data in the world's theme**; it scales by preset (Low may drop it); reduced motion turns off flashes and shakes; **no draw calls per ship**; it never changes gameplay.
- Time of day per race is not built. `EnvFxSpec` is plain data so a later variant can swap it.
- X2 builds the framework and proves each effect on **Neon Bay only** (light rain, wet-look deck, one drifting airship, a colour grade). The other four 2.0 worlds get their sets in X7; the new worlds get theirs in X4–X6.

**Shape of the code:**
- `graphics/envfx/EnvFxSpec.ts`: the data a theme declares.

  ```ts
  export interface EnvFxSpec {
    grade?: { lift: [r, g, b]; gamma: [r, g, b]; gain: [r, g, b]; saturation: number };
    weather?: { kind: 'rain' | 'snow' | 'embers' | 'spores' | 'dust' | 'bubbles' | 'meteors';
                count: number; fall: number; wind: [x, z]; size: number; color: number; streak: number };
    heightFog?: { base: number; falloff: number; color: number; bankScale?: number; bankSpeed?: number };
    lightning?: { rate: number; color: number; flash: number };          // visual only; hazard strikes call flash() too
    surface?: { kind: 'spray' | 'dust' | 'sparks'; color: number };       // behind grounded ships
    setPieces?: { prop: string; count: number; path: 'orbit' | 'line'; radius: number; height: number; speed: number }[];
    wetDeck?: { gloss: number; streak: number };
    shafts?: { count: number; color: number; angle: number; width: number; opacity: number };
  }
  ```
- `WorldTheme` gains `readonly envfx: EnvFxSpec` (empty object = today's behaviour, so the four untouched themes need one line each).
- `graphics/envfx/EnvFx.ts` owns the runtime for the active theme: `setSpec(spec, track, props)`, `setQuality(q)`, `setReducedMotion(on)`, `update(camera, time, dt, ships)`, `flash(strength)`, `dispose()`. `GraphicsSystem.setWorld()` hands it the theme's spec.
- **Colour grading:** uniforms in the existing final pass (`ChromaticPass`, which already draws the vignette on every preset since §H). No new pass, no LUT texture.
- **Weather:** one `THREE.Points` (or one instanced quad mesh for streaks) in a box that follows the camera; positions wrap in the vertex shader from a time uniform, so there is **no per-frame CPU work and one draw call**. Bubbles and embers rise (negative `fall`). The track feature `wind` (X4) can lend its direction to `weather.wind` so the rain slants with the gust.
- **Height fog:** extend `shaders/fog.ts` (`FOG_GLSL`, `FogUniforms`) with a height term and an optional drifting bank term. Every material that already includes `FOG_GLSL` gets it with no extra pass.
- **Lightning flash:** scales the hemisphere and fill light and a sky uniform for ~120 ms. With reduced motion the flash is skipped.
- **Surface reactions:** new emit kinds in the existing `Effects` point pool (`MAX_POINTS` 4096, one draw call already), spawned behind grounded ships above a speed threshold.
- **Set pieces:** instances of a named prop from the world's `props.glb` on a slow path outside the 80 m corridor (`PropInstancer`, one instanced mesh per role).
- **Wet-look deck:** a branch in the deck material (lower roughness, plus a streak term that stretches the rail neon along the view direction). No planar reflection, no extra pass.
- **Light shafts:** a handful of additive, depth-tested cards in one instanced mesh, faded by view angle.

**Quality scaling** (`QualityProfile` gains an `envfx` block; `settings/QualityManager.ts`):

| Effect | Low | Med | High |
|---|---|---|---|
| Colour grading | on | on | on |
| Weather particles (× `weather.count`) | 0.3 | 0.6 | 1 |
| Height fog | on (no bank motion) | on | on |
| Sky layers and lightning flash | on | on | on |
| Surface reactions | player only | all ships, 0.6 | all ships |
| Set pieces | 1 per kind | all | all |
| Wet-look deck | off | on | on |
| Light shafts | off | on (half count) | on |

Reduced motion: no lightning flash, no camera shake from effects, weather streak length halved.

**Budgets:** at most **+6 draw calls per world** for all effects together (weather 1, set pieces ≤ 3, shafts 1, spare 1); 0 per ship. No new render pass. Shader warm-up covers the new materials (no first-rain hitch).

**Build steps** (commit after each): spec and `EnvFx` skeleton with unit tests for quality scaling → colour grading → weather particles → height fog → lightning flash → surface reactions → set pieces → wet-look deck → light shafts → Neon Bay's spec and `perf-desktop` table.

**Done when:**
- [ ] Each of the 8 effects works from data on Neon Bay at Low, Med and High, and respects reduced motion.
- [ ] A theme with `envfx: {}` renders as before (screenshot diff on Sunset Mesa).
- [ ] Draw calls: +6 or fewer on Neon Bay, 0 per ship (`perf-desktop --audit`).
- [ ] Desktop p95 unchanged on every preset.
- [ ] e2e: a race on each preset with no console errors.
- [ ] **Device gate** (8-ship Neon Bay) and the user's look approval of Neon Bay's set.

---

### X3 — Upgrades: sidegrades and the Aero slot — ✅ BUILT (PR #35; waiting on the user's look approval of the new parts and the device gate)

**As built (PR #35)** (read before X4):
- **Data:** `content/parts.ts` holds variant A (`PART_EFFECTS`, the 2.0 numbers, unchanged), variant B (`PART_EFFECTS_B`) and `AERO_EFFECTS`. Helpers: `hasVariants(slot, tier)`, `variantOf`, `partKey` / `parsePartKey` (`'0'`, `'1a'`, `'3b'`), `partName` ("Mk III Sprint"), `PART_VARIANT_NAMES`, `STOCK_VARIANTS`. Stock and Aero have one line of parts: their variant is always `'a'`.
- **Contracts:** `PartSlot` has `'aero'`; `PartVariant = 'a' | 'b'`; `ShipStats` has `draftScale`, `pushScale`, `airSteerScale`, `ramMass` (all 1 on a 2.0 loadout).
- **Physics:** `ShipStatsResolver` picks each slot's table by variant. `ShipController` multiplies the slipstream by `draftScale` and the air steering by `airSteerScale`. `PhysicsSystem` sets the collider density to `mass × ramMass`. **`pushScale` has no reader yet: X4's wind and X6's jets must multiply their push by it.**
- **Final B numbers** (Mk II / Mk III / Prototype; two were tuned by the balance sim, see below): Appendix A.
- **Balance sim:** `sim/partsBalance.sim.test.ts`. A solo Legend autopilot races three laps on each of the five tracks with one part fitted. Each B part is within 1% of its A part (the worst pair is the Prototype booster, 0.82%).
- **Save v7:** `Profile.owned` is `Record<PartSlot, string[]>` of part keys. Migration 6 → 7 maps every owned tier to its A key, adds `aero: ['0']`, `parts.aero = 0` and all-A `variants`. The sanitizer drops a key the slot cannot have and unfits a part that is not owned in that variant.
- **Economy:** `owns`, `buyPart` and `equipPart` take a variant (default `'a'`). The two variants of a tier are bought separately at the same price; an owned part refits for free.
- **Rival fits:** `RIVAL_FITS` gained Aero (Stock, Stock, Mk II, Mk III by tier). `RIVAL_VARIANTS` by personality: aggressive fits Sprint, Burst and Plate; steady fits variant A; erratic fits Sprint and Agility. Rookie rivals stay all Stock.
- **Assets:** `blender/parts/build_parts.py` builds 32 parts (`<slot>_t<tier>`, `<slot>_t<tier>b`, `aero_t0..3`). `parts.glb` is 296 KB of 600 KB; the largest new part has 564 triangles; every part has 3 primitives or fewer. `build_ships.py` adds `socket_aero` on the nose deck of each chassis (ARROW's sits further back, where the deck is wide enough). The six hull meshes are bit-identical to before: every mesh primitive was hashed before and after the rebuild.
- **Rendering:** `ShipAssembly.partNodeName` and the `socket_aero` entry. Rivals still merge every part into one mesh per material.
- **Garage** (behind `expansion`): an AERO tab; in the four 2.0 slots, Stock on its own row and then each tier's A and B parts side by side, each with its stat preview and a one-line trade-off. With `expansion` off the Garage is the 2.0 one.
- **Desktop perf** (`perf-desktop --audit`, 8-ship Neon Bay; before = the X2 build, #34): 60 fps and p95 16.8 ms on High, Med and Low, before and after. Grid-frame draw calls 166 → 170 on High and Med and 145 → 147 on Low: the player's ship gained the Aero part (2 meshes, drawn again in the shadow pass on High and Med). Rival ships did not change. Race median 112 → 114, 111 → 115, 90 → 92.
- **Tests (484 in 57 files; e2e 15/15):** unit tests for the data, resolver, economy, migration and sanitizer; `e2e/garage.spec.ts` buys and fits every chassis × tier × variant plus Aero on Low, Med and High.
- **Deviations from the plan:**
  - `Loadout.variants` is optional and partial (missing means `'a'`), not a required record. Every 2.0 loadout literal, test and sim then stays valid as written.
  - Sprint's top speed is +2 / +4 / +7, not +1 / +2 / +4, and the Prototype Burst costs 11 energy, not 12. With the planned numbers Sprint lapped 1.0–1.4% slower than Velocity and the Prototype Burst 1.4% slower than Longburn.
  - No permanent hash check of the hull meshes in `check-assets`. A pinned hash would fail on every later, intended chassis change. The comparison was run once for this PR.
  - `expansion` stays **off** in this PR. The plan turns it on when X3 is complete, but the user has not approved the look of the new parts yet. Turn it on in the commit that records that approval. Rivals already use the new parts whatever the flag says.
  - The Garage has 8 tabs with `expansion` on; at 1280 px they wrap to two rows.
- **Still open:** the user's look approval of the 16 new parts (`docs/v2/shots/x3/parts-sheet.jpg`), and the device gate.

**Design decisions:**
- **Sidegrades** at Mk II, Mk III and Prototype in the four 2.0 slots. Variant A is the 2.0 part with unchanged numbers; variant B is new. Same price per tier (600 / 1500 / 3200). Each is bought separately; owned parts refit for free; nothing can be sold.

  | Slot | A (2.0 numbers) | B | B's starting numbers (Mk II / Mk III / Prototype); tuned by the sims |
  |---|---|---|---|
  | Engine | Velocity | Sprint | topSpeed +1/+2/+4; thrustAccel +6/+11/+15; weight as A |
  | Booster | Longburn | Burst | boostTopSpeed +8/+15/+22; boostCost 14/13/12; boostTime 1.3/1.35/1.4 |
  | Stabilizer | Grip | Agility | steer ×1.08/1.15/1.22; lateralGrip +0/+0.2/+0.5; topSpeed −0.5/−1/−1.5 |
  | Hull | Cell | Plate | energyMax +3/+7/+10; damageTakenScale ×0.85/0.75/0.65; weight +0.05/+0.09/+0.14; ram mass ×1.1/1.2/1.3 |

- **Balance rule:** for each slot and tier, the mean lap-time difference between A and B over every built track (Legend autopilot, other slots Stock) is ≤ 1%. `sim/parts.sim.test.ts` enforces it. Tune B's numbers, never the assertion.
- **Aero**, a fifth slot, four tiers, no variants, the same prices:

  | Tier | Draft bonus | Push from wind and jets | Steering in the air | topSpeed |
  |---|---|---|---|---|
  | Stock / Mk II / Mk III / Prototype | ×1 / 1.15 / 1.3 / 1.5 | ×1 / 0.9 / 0.8 / 0.7 | ×1 / 1.1 / 1.2 / 1.3 | −0 / −0.3 / −0.6 / −1 |

  The wind and jet term has no effect until X4 and X6; the draft and air terms work on every 2.0 world.
- **Models:** every new part is its own model: 12 variant-B parts and 4 Aero parts (32 in total), built in `blender/parts/build_parts.py` under the §V rules (trim UVs, baked vertex AO, ≤ 1.5k triangles, ≤ 3 primitives, `parts.glb` ≤ 600 KB). B variants must read as different at a glance from their A part (silhouette, not only colour). Node names: `<slot>_t<tier>` stay for A; B is `<slot>_t<tier>b`; Aero is `aero_t0..t3`.
- **Aero socket:** `socket_aero` near the nose of each of the 6 chassis (per-chassis position in `build_ships.py`, like `hullSock`). This re-exports the six ship GLBs; **the hull meshes must come out byte-identical** apart from the added empty. The §V V3 look approval is not affected.
- **Rival fits** (Appendix A): variants by personality; Aero Stock on Rookie and Pilot, Mk II on Ace, Mk III on Legend. Rookie stays all Stock, so SPEC §4.4's rule holds.
- **Save v7.**

**Build steps** (commit after each slot):
1. Contracts: `PartSlot` gains `'aero'`; `PartVariant = 'a' | 'b'`; `Loadout.variants: Record<PartSlot, PartVariant>`; `ShipStats` gains `draftScale`, `pushScale`, `airSteerScale`, `ramMass` (all 1 at Stock, so every 2.0 test passes unchanged: the same proof as M1's stats parity).
2. `content/parts.ts`: effects per slot → variant → tier; `PART_VARIANT_NAMES`; `partKey(slot, tier, variant)`. `physics/ShipStatsResolver.ts` reads them. `physics/Drafting.ts` and `ShipController` consume `draftScale` and `airSteerScale`; ship-to-ship push uses `ramMass`.
3. Save v7: `owned: Record<PartSlot, PartTier[]>` becomes `owned: Record<PartSlot, string[]>` of part keys (`'1a'`, `'2b'`…); migration 6 → 7 maps each owned tier to its A variant, adds `aero: ['0']`, `loadout.parts.aero = 0` and `variants` all `'a'`. Sanitizer and `SaveStore` tests.
4. `content/economy.ts`: `buyPart` and `equipPart` take the variant.
5. Blender: one slot per commit (engine B, booster B, stabilizer B, hull B, aero), then `socket_aero` on the six chassis. `check-assets`: the new node names, the socket, the budgets, and a hash check that the hull meshes did not change.
6. `ShipAssembly`: the Aero part on `socket_aero`; `mergeByMaterial` for rivals already merges every part, so **rival draw calls stay ≤ 6**. The player's ship gains one part (≤ 3 calls) on one ship only.
7. Garage: an AERO tab; in each slot tab a two-way A/B picker per tier with both stat previews; `ui/garageModel.ts` normalises the bars over the new range. Behind `expansion` until this PR is complete, then on.
8. `content/pilots.ts` `RIVAL_FITS`: variants by personality, Aero by tier.
9. Sims: the A/B balance test; the tier matrix on all 5 worlds with the new fits; the SPEC §9 balance targets.
10. `e2e/garage.spec.ts`: cycle every chassis × slot × tier × variant on Low, Med and High.

**Done when:**
- [ ] Every 2.0 physics and sim test passes unchanged with all-A, Stock-Aero loadouts.
- [ ] Each A/B pair is within 1% per lap (sim).
- [ ] A v6 save loads as v7 with every owned and fitted part kept.
- [ ] 32 parts pass `check-assets`; `parts.glb` ≤ 600 KB; ship assets ≤ 2 MB; hull meshes unchanged.
- [ ] Rival draw calls are not up (`perf-desktop --audit`).
- [ ] Rookie-assisted autopilot on Stock still finishes top 3 on every track.
- [ ] **The user approves the look of the new parts** (a parts sheet in the PR body) and the **device gate** passes (8-ship Neon Bay, mixed field).

---

### X4 — World 6: Tempest Spire (crosswinds and lightning) — 🟡 GAMEPLAY HALF BUILT (PR_X4, draft; the look waits for `assets/reference/worlds/tempest-spire/chosen.jpg`)

**As built: the gameplay half (PR_X4)** (read before X5, and before building the look):
- **What is done:** build steps 1–7, the placeholder theme of step 8 and the HUD chip of step 9. **What is left (commit point 5):** the real theme, the props, the effect set, the perf table on the real look and the shots. All of it needs `chosen.jpg`.
- **Wind** (`track/features/wind.ts`): `buildWinds`, `windGust(w, t)` (0..1), `windSpan` (the push fades over the first and last 20 m of a zone), `windAccel`, `windAt`. `PhysicsSystem.applyWind` hands each ship the push at its place every step (`ShipController.setWind`); the controller adds it to the sideways speed of a **grounded** ship, times `pushScale`. Ships on the grid, retired ships and ships on a split path get none. `ship:wind { shipId, active, dir }` fires when a gust starts or stops pushing a ship (above 0.7 m/s²).
- **Wind numbers** (`sim/wind.hold.sim.test.ts`, 15 cases, on a 280 m zone put on Neon Bay's longest plain straight): a steering ship stays within 0.12 m of its line at 70 and 125 m/s on three lines; a hands-off ship drifts 3.5 m at 70 m/s and 2.0 m at 125 m/s and touches no rail; Aero Prototype drifts 1.75 m where Stock drifts 2.48 m; a ship held above the hover rays is not pushed; the same run twice is identical.
- **Lightning** (`track/features/lightning.ts`): `buildStrikes` places `count` points along a field, either side of the clear lane (`lane`, the same helpers as the mine fields). **The bolt is the last 0.2 s of each point's cycle**, so no point strikes at t = 0 without a warning. The points of a field are staggered by the golden ratio. `PhysicsSystem.checkLightning` tests a 3 m sphere at hull height against each hull box while a bolt is down, one hit per ship per strike. Normal: 6 energy × `damageTakenScale` and `empLock` = 3 s. Rookie: velocity × 0.85 only. A Shield takes the strike and drops (`item:shield` with `blocked: 'lightning'`). Event: `hazard:lightning { shipId, strike, point }`.
- **Track** (`content/tracks/tempest-spire.json`, from `scripts/track-design.mjs`): 4,341 m, about 36.8 s at Pilot pace, minimum radius 102 m, elevation 56–75 m. Three wind zones: 290 m on the long bridge pushing right; 320 m through the 420 m-radius sweeper pushing outward; 240 m pushing inward before the chicane. Two lightning fields of 5 points (periods 4.5 s and 5 s, lanes +2 m and −2 m). One 60 m jump, the pit and two dash plates. The design tool takes `{ type: 'wind', from, len | to, dir, period, phase, duty, accel? }` and `{ type: 'lightning', from, to, count, period, phase, lane }`.
- **Validator** (`TrackValidate.ts`, issue codes `wind` and `lightning`): no zone or field on a jump (ramp to landing blend), a pipe, a loop or the start and pit area; wind not within 60 m of a corkscrew; zones do not overlap; a zone is at least 80 m long; gust 0–12 m/s²; the gust is on and off for at least 1.5 s; a field's period is at least 3.7 s (the Rookie warning must fit); a field is never inside a wind zone.
- **AI** (`AIDriver`): it aims upwind by `look · push / (grip · speed)` (the offset that cancels the gust's steady drift, from its own copy of the wind timeline), and `avoidHazards` adds a band for a strike circle only when its bolt lands within 0.45 s of the hull crossing it.
- **World entry:** `WorldDef.expansion` and `worldsFor(features)` (`content/worlds.ts`). The Worlds screen and the Grand Prix cup list read it. `?world=tempest-spire` races the world whatever the flag says. `WorldDef.props: false` stops the app from fetching a `props.glb` that does not exist yet.
- **Placeholder theme** (`graphics/themes/placeholder.ts`): a flat two-colour sky tinted with the world's left rail colour, plain lights, no props, no `envfx`. Registered under `tempest-spire` in `themes/index.ts`. **Replace that one line when the real theme exists, and delete `props: false` from the world entry.**
- **Telegraph visuals** (built with the track, so the warm-up compiles them; 4 draw calls for the whole track): `windVisual.ts` (streamers on both rail tops that stand out across the road in a gust and hang limp between gusts; rows of deck chevrons that light up and run across the road with the gust) and `lightningVisual.ts` (each circle always shows dimly, brightens with a quickening pulse over the warning, goes white under a jagged bolt). Both use the palette's accent (electric yellow).
- **Feedback:** HUD chip `WIND` with an arrow that points the way the gust pushes; toast `⚡ LIGHTNING STRIKE`; the boost indicator already reads `BOOST JAMMED` from `empLock`; a sky flash through `EnvFx.flashNow` (0.7 for the player, 0.25 for a rival; nothing with reduced motion); a heavy haptic tap and pad rumble.
- **Sims** (`sim/tempest-spire.sim.test.ts`, 8 races, about 10 s): Rookie and Legend fits finish with no respawn; the tier matrix passes (Pilot and Ace fields clean; mixed field mean position Legend 2.0, Rookie 7.0; Rookie-assisted autopilot P1 from P8; Pilot autopilot P3, 0.4% off the median); an Ace race replays to the same standings and strikes. The AI takes 0–3 strikes per ship in a race.
- **iOS preview builds:** `VITE_FEATURES=<list>` at build time turns flags on in that build (`core/features.ts` `buildDefaults`). The app has no URL for `?features=`. Netlify does not set it.
- **Tests:** 533 unit and sim tests in 61 files (X3: 484 in 57); e2e 16/16 (one new: a Tempest Spire race past a wind zone and a lightning field, no console error, no shader compiled mid-race). `scripts/perf-desktop.mjs` takes `--world <id>`.
- **Desktop perf on the placeholder theme** (`perf-desktop --audit`, 8 ships; not the gate, which is measured on the real look):

  | World, preset | fps | p50 / p95 / p99 ms | Grid-frame draw calls | Race median draw calls | Triangles |
  |---|---|---|---|---|---|
  | Tempest Spire, High | 60.0 | 16.7 / 16.8 / 16.8 | 152 | 106 | 114k |
  | Tempest Spire, Med | 59.9 | 16.7 / 16.8 / 16.8 | 152 | 106 | 114k |
  | Tempest Spire, Low | 60.0 | 16.7 / 16.8 / 16.8 | 131 | 76 | 108k |
  | Neon Bay, High (shared code; X3 was 170) | 59.9 | 16.7 / 16.7 / 16.8 | 170 | 138 | 141k |
  | Neon Bay, Low (X3 was 147) | 60.0 | 16.7 / 16.7 / 16.8 | 147 | 102 | 118k |

  The track visual is 17 draw calls on Tempest Spire against 9 on Neon Bay: 4 for the wind and lightning telegraphs, the rest for the jump. Ship draw calls did not change.
- **Deviations from the plan:**
  - The lightning flash and the weather slant are wired in `GraphicsSystem.attachBus`, where every other event effect is, not in `RaceSession`. No pass-through methods were needed.
  - **`setWeatherWind(0, 0)` on the end of a gust clears the theme's own base wind.** The placeholder has no weather, so nothing shows it. When the real theme has rain, restore the spec's `weather.wind` at the end of a gust instead.
  - `LightningFeature` has `lane` (as the mine fields do). The plan's type did not list it, and "always leaving a clear lane" needs it.
  - No track-count assertion failed: `assets.test.ts` only changes when the world has props.
  - The hold sim uses a zone on Neon Bay, so it does not depend on the new track.
- **Not asked for, in this PR:** the `VITE_FEATURES` build switch (without it the owner cannot see a flagged world on a device); haptics and rumble on a strike.

**Original plan.** Branch `v2/x4-tempest-spire` from `v2/x3-upgrades` (PR #35). The design decisions and build steps below are settled. The build notes come first: they are facts about the code as it stands after X1–X3 that the steps rely on.

**Build notes from X1–X3 as built (read before step 1):**
- **What exists and is ready to use:**
  - `ShipStats.pushScale` (Aero, X3). **Nothing reads it yet.** The wind force in `ShipController` must multiply by it; step 1's hold test proves it (Aero Prototype drifts less than Stock).
  - `EnvFx.setWeatherWind(x, z)` and `EnvFx.flashNow(strength, color)` (X2). **`GraphicsSystem` does not expose them yet.** Add two pass-through methods there and call them from `RaceSession` on `ship:wind` (the player's ship only) and `hazard:lightning`. `flashNow` already does nothing with reduced motion on.
  - `PhysicsSystem.hazardTime` is the deterministic hazard clock; the gate hazard is the model for a timed hazard (`track/features/gate.ts`, `gateVisual.ts`, the `hazard:gate` event, `HazardPolicy.telegraphScale`, `damage` and `hitSpeedScale` in `core/hazards.ts`).
  - `ShipState.empLock` is the boost jam; `ItemSystem` owns the Shield. A strike must go through the same "is this ship shielded" check as a mine hit.
  - `AIDriver` already takes `{ hazardClock, liveMines }` and has `avoidHazards`. `sim/worldRace.ts` and `sim/tierMatrix.ts` run a world's races: `describeTierMatrix('tempest-spire')` is all step 7 needs beyond the file's own Rookie and Legend races.
  - The rival fits now include B parts and Aero (X3). Tier-matrix results on the new track are therefore measured with those fits.
- **What does not exist yet and X4 must add:**
  - **A way to hide a built world.** Today a world shows as soon as `built` is true, and a cup is available when all its worlds are `built` (`content/cups.ts` `cupAvailable`). Add `WorldDef.expansion?: true` and one helper, `worldsFor(features)`, that drops expansion worlds when the flag is off. `WorldSelect`, `MainMenu` and `availableCups` read the helper. `?world=tempest-spire` keeps working for QA whatever the flag says. The save sanitizer has no feature set: it keeps a saved world that is `built`, which is correct.
  - **A placeholder theme.** `graphics/themes/index.ts` `createTheme` falls back to Neon Bay's theme for an unknown world. Add `themes/placeholder.ts` (flat sky, the world's palette, no props, no `envfx`) and register it under `tempest-spire` until `chosen.jpg` arrives. Do not let the new world fall back to Neon Bay's look.
  - `WorldId` is a closed union and `content/worlds.ts` says "the five worlds": widen both. Tests that pin counts will fail and must be updated with the reason in a comment, as X2 did for the prop count: `src/assets/__tests__/assets.test.ts` (report keys, once the world has props) and any world-count assertion `tsc` or the tests point to.
  - `scripts/perf-desktop.mjs` always races Neon Bay. Add a `--world <id>` argument so the PR's perf table is measured on Tempest Spire.
- **Rules learned the hard way in X2 and X3:**
  - The smoke test fails on any shader compiled after the lights go out. Every new material (streamers, strike circles, bolts) must exist before the warm-up: build them in `setTrack`, hidden, never on first use.
  - `?seed=N` switches the game to a generated Neon Bay track. Do not put it in screenshot or perf URLs.
  - On this Mac run `npm test -- --maxWorkers=3` and `npm run smoke -- --workers=1`. The full gate takes about 12 minutes; run it in the background.
  - Wind on the hazard clock means an identical force in every run. The hold test's "same run twice is identical" case guards that; do not seed anything from `Math.random` or wall time.

**Commit points** (push after each; open the PR as a draft after the fourth):
1. The wind hold sim (failing), then the wind feature until it passes.
2. The lightning feature with its hazard sim cases.
3. Authoring support, `tempest-spire.json`, the validator rules and the SVG preview.
4. AI, the world entry behind `expansion`, the placeholder theme and `sim/tempest-spire.sim.test.ts` with the tier matrix. **This is the gameplay half: open the PR as a draft here.**
5. Only with `assets/reference/worlds/tempest-spire/chosen.jpg` present: the real theme, props, effect set, HUD chip, perf table and shots; then mark the PR ready. Without the image, leave the draft and start X5's gameplay half on a branch stacked on this one.

**Design decisions:**
- **Look:** art-deco towers above a permanent thunderstorm; rain, lightning rods, searchlights. Palette: storm violet / electric yellow / teal. From `assets/reference/worlds/tempest-spire/chosen.jpg`.
- **Gimmick, crosswind zones.** A new `TrackFeature`: `{ type: 'wind'; dStart; dEnd; dir: 1 | -1; accel; period; phase; duty }`.
  - Inside the zone a lateral acceleration acts on every grounded ship, across the road, while the gust is on. The gust runs on the hazard clock (`PhysicsSystem.hazardTime`), ramps over 0.5 s, and is identical in every sim run.
  - Starting numbers: `accel` 7 m/s² × the ship's `pushScale` (Aero), which drifts a hands-off ship about 3 m across a zone. Steering holds the line. Rails catch a ship that does nothing.
  - No wind on jumps, in the pit, or within 60 m of a corkscrew. The validator checks this.
  - **Telegraph:** streamers on the rails that point with the gust, and the rain slants with it (`EnvFx` weather wind). A zone is visible from 150 m.
- **Hazard, lightning.** A new feature: `{ type: 'lightning'; dStart; dEnd; count; period; phase }` places strike points in lanes, always leaving a clear lane (the stone-gate rule).
  - A strike circle (radius 3 m) glows for 1.5 s × `telegraphScale`, then strikes for 0.2 s.
  - **Normal rules:** 6 energy × `damageTakenScale` and a 3 s boost jam (reuses `empLock`). A Shield blocks it.
  - **Rookie rules:** no energy loss, no boost jam, velocity × 0.85.
  - Reduced motion: no full-screen flash; the circle and the bolt mesh still show.
- **AI:** counter-steers the gust from the timeline (feed-forward on the known `accel`); avoids strike circles as it avoids mines (`avoidHazards` bands that exist only during the warning and strike).
- **Other:** `airGravityScale` 1.0; no unlock gate; `expansion` flag until this PR is complete.
- **Track shape:** about 4.3 km, a 36–40 s lap; three crosswind zones (one on a long straight, one through a fast sweeper pushing outward, one pushing inward before a chicane); two lightning fields; one jump between towers (no wind on it); the pit and two dash plates.

**Build steps** (test first):
1. `sim/wind.hold.sim.test.ts`, written before the feature: at 70 and 125 m/s, on 3 lines, a steering ship holds its line within 1.5 m through a zone; a hands-off ship drifts 2–4 m and stays inside the rails; Aero Prototype drifts less than Stock; the same run twice is identical.
2. `track/features/wind.ts` (`buildWinds`, `windAccel(w, t)`), contracts, `ShipController` force, `ship:wind { active, dir }` event.
3. `track/features/lightning.ts`, `physics` strike test (analytic circle vs hull, like the mines), `hazard:lightning`, `HazardPolicy`, Shield. `sim/hazards.sim.test.ts` cases: normal and Rookie rules, clear lane, determinism.
4. Authoring: `scripts/track-design.mjs` segments take `wind` and `lightning`; `TrackValidate` rules; `tempest-spire.json`; SVG preview draws both.
5. AI: gust feed-forward and strike avoidance.
6. `content/worlds.ts` entry (`WorldId` union, order 6, palette, `built: true`, hidden without `expansion`), `Appendix B` row.
7. `sim/tempest-spire.sim.test.ts` with the `tierMatrix` (4 tiers, mixed field, Rookie-assisted, Pilot balance), under 60 s.
8. Placeholder theme, then **(needs `chosen.jpg`)** `graphics/themes/tempestSpire.ts` (storm sky shader with cloud floor and in-cloud lightning, towers, rods, searchlights), `blender/props/build_props.py` `build_tempest_spire`, and its `envfx` (heavy rain, lightning flash, wet-look deck, spray, searchlight shafts, height fog over the cloud floor).
9. HUD: a wind arrow chip while in a zone; a strike warning uses the existing hazard styling. Audio hooks are events only (M6 adds sound).

**Done when:**
- [x] The wind hold test and the hazard tests pass; hazards are deterministic.
- [x] The 4-tier sims pass: all 8 ships finish, order roughly follows tier, the SPEC §9 balance targets hold.
- [x] `tracks:check` passes; the SVG preview is committed; lap 30–45 s.
- [ ] World assets ≤ 2.5 MB; `public/game` ≤ 15 MB; effects within X2's budget. *(Waits for the look: the world has no assets yet.)*
- [ ] **The user approves the look**, and the **device gate** passes on Tempest Spire. *(Waits for `chosen.jpg`.)*

---

### X5 — World 7: Cinder Forge (the Plunge and lava geysers)

**Design decisions:**
- **Look:** a chrome foundry in a volcano crater; lava rivers, smelter towers, ember clouds. Palette: ember orange / cobalt blue / basalt black (the blue keeps it apart from Sunset Mesa). From `assets/reference/worlds/cinder-forge/chosen.jpg`.
- **Gimmick, the Plunge.** A new `TrackFeature`: `{ type: 'plunge'; dStart; dEnd }` over an authored dive of about 55° that drops roughly 90 m, a floor section, and a climb out.
  - The magnetic lock holds ships on the road as everywhere else. **On a Plunge only, gravity also acts along the road:** `g · sin(pitch) · PLUNGE_GRAVITY` is added to the along-track acceleration, and the top-speed cap rises to 1.2 × top speed (1.2 × boost top while boosting). Ships gain speed on the dive and lose it on the climb.
  - The road is unbanked and straight in plan over the dive and the climb; the pitch transitions use a vertical radius ≥ 120 m so the hull never leaves hover range. The frames are built about the pitch axis as for the loop (`TrackFrames`), so there is no roll.
  - Elevation bounds are per world (the validator takes them from the track definition).
  - The chase camera pitches with the road and keeps the horizon in view on the dive (camera test, as for the loop).
- **Hazard, lava geysers.** A new feature: `{ type: 'geysers'; dStart; dEnd; count; period; phase }`: vents in fixed lanes, a clear lane always.
  - A vent glows for 1.5 s × `telegraphScale`, then erupts for 1.2 s (a column of radius 2.5 m).
  - **Normal rules:** a 10 m/s knock up the road normal plus 8 energy × `damageTakenScale` (the mine's numbers). A Shield blocks it.
  - **Rookie rules:** no energy loss, velocity × 0.85.
  - No geysers on the Plunge itself.
- **AI:** treats the Plunge as a centre section (holds its line, no draft seeking); brakes for the corner after the climb from the higher entry speed; avoids vents from the timeline.
- **Other:** `airGravityScale` 1.0; no unlock gate; `expansion` flag.
- **Track shape:** about 4.6 km, a 38–42 s lap; the rim section with two geyser fields; the Plunge; a floor section beside the lava; the climb; one jump over a lava river; the pit and two dash plates.

**Build steps** (test first):
1. `sim/plunge.hold.sim.test.ts`, before the feature: 4 speeds (40–180 m/s) × 5 lines hold within 1.5 m, height error < 0.6 m, never airborne, no respawn; speed gained on the dive and lost on the climb within stated bounds; the cap holds; the camera keeps a clear sight line.
2. `track/features/plunge.ts`, frames, `ShipController` along-road gravity and cap, `safeRespawnU` (a respawn on the dive goes to the floor section).
3. `track/features/geyser.ts`, physics, `hazard:geyser`, policy, Shield, hazard sims.
4. Authoring (`plunge`, `geysers`, per-track elevation bounds), validator, `cinder-forge.json`, preview.
5. AI. 6. World entry and Appendix B. 7. `sim/cinder-forge.sim.test.ts` (tier matrix).
8. Placeholder theme, then **(needs `chosen.jpg`)** `themes/cinderForge.ts`, props, and `envfx` (embers, heat shimmer, a lava-lit height fog, sparks behind ships, drifting crucible gantries, light shafts through smoke).

**Done when:** the same list as X4, with the Plunge hold test in place of the wind test, and the device gate on Cinder Forge.

---

### X6 — World 8: Abyss Line (the Spine and pressure jets), and the Storm Cup

**Design decisions:**
- **Look:** an undersea city of glass domes and brass; kelp, light shafts, bubbles. Palette: aqua / brass gold / coral pink. From `assets/reference/worlds/abyss-line/chosen.jpg`.
- **Gimmick, the Spine.** A new `TrackFeature`: `{ type: 'spine'; dStart; dEnd; transition }`. The deck curls **down** around a tube and ships ride its outside, all the way round.
  - It reuses the full-pipe's `curl` machinery (`track/features/pipe.ts`) with the curl signed: −1 closes the deck around a tube of the same circumference (2W, radius ≈ 4.46 m) below the centreline. `curlPoint`, `uncurlPoint`, `splitByCurl`, `surfacePoint`, `surfaceUp` and `PipeCompensation` must all accept a negative curl. Lateral stays the arc position around the tube; ±W is the bottom seam.
  - No rails on the closed Spine. The magnetic lock holds a ship at any angle and any speed; a ship cannot fall off. The seam guard eases ships away from the bottom seam before the tube opens, as on the pipe.
  - The chase camera rolls with the ship and stays outside the tube (camera test).
  - Collision uses 40 pieces across, as inside the pipe.
- **Hazard, pressure jets.** A new feature: `{ type: 'jets'; dStart; dEnd; count; period; phase }` places vents on the Spine, a clear lane always.
  - A bubble stream warns for 1.5 s × `telegraphScale`, then the jet fires for 0.8 s.
  - **Normal rules:** a 9 m/s knock around the tube (lateral, away from the vent) × `pushScale` plus 5 energy × `damageTakenScale`. A Shield blocks it.
  - **Rookie rules:** no energy loss, a 5 m/s knock, velocity × 0.85.
- **AI:** aims at `surfacePoint` on the Spine (as in the pipe), keeps off the seam, avoids vents from the timeline.
- **Other:** `airGravityScale` 1.0; no unlock gate; `expansion` flag.
- **Track shape:** about 4.4 km, a 36–41 s lap; a 500 m Spine through a gentle bend (plan radius ≥ 300 m, transitions ≥ 80 m) with two jet fields; a glass-tunnel section through the city; a corkscrew-free, jump-free layout so the Spine is the whole show; the pit and two dash plates.
- **Storm Cup:** with world 8 built, the `storm` cup becomes available (X1's rule). This PR adds its e2e and a 5-race cup sim.
- **Flag:** this PR completes the expansion's player-facing surfaces. Whether `expansion` turns on by default here or stays off until X7 is the user's call at this PR's review; the default plan is **on here** (X7 only adds polish to worlds that are already live).

**Build steps** (test first):
1. `sim/spine.hold.sim.test.ts`, before the feature: 5 lines up to 154° round either side × 70 and 125 m/s, plus a full 360° spiral: height and axis error < 0.6 m, hull aligned, never airborne, no respawn; the pipe hold test still passes unchanged.
2. Signed curl through geometry, queries, mesh, collision, `PipeCompensation`; `TrackData.spines`.
3. `track/features/jet.ts`, physics, `hazard:jet`, policy, Shield, hazard sims.
4. Authoring, validator (as for pipes), `abyss-line.json`, preview. 5. AI. 6. World entry and Appendix B.
7. `sim/abyss-line.sim.test.ts` (tier matrix); the Storm Cup sim and e2e.
8. Placeholder theme, then **(needs `chosen.jpg`)** `themes/abyssLine.ts` (water-column sky with a caustic surface far above, kelp, domes), props, and `envfx` (bubbles, a deep-blue grade, height fog as water haze, light shafts from the surface, drifting fish schools as set pieces).

**Done when:** the same list as X4 with the Spine hold test, plus: the Storm Cup plays start to finish by pad on web and iOS; the device gate on Abyss Line.

---

### X7 — Effects polish on the five 2.0 worlds

**Design decisions:** each world gets the set in SPEC §10.3, as `envfx` data plus any theme-specific piece. No gameplay change; any sim diff is a bug.

| World | `envfx` | Theme work |
|---|---|---|
| Neon Bay | (done in X2) rain, wet-look deck, airship | Tune after the device reading |
| Sunset Mesa | dust, shafts (low sun), dust behind ships | Dust devils as set pieces |
| Cryo Station | snow, a cold grade | Ice glitter on the deck (a sparkle term in the wet-look branch); aurora pulses in the sky shader |
| Jade Ruins | mist banks (height fog), spores, canopy shafts | The 1,800 fireflies move into the weather system if that saves a draw call |
| Orbital Ring | meteor streaks, a sun glint | Drifting shuttles as set pieces (new props, ≤ 40 KB) |

**Build steps:** one world per commit, each with a before/after screenshot at Med and Low and a `perf-desktop` row.

**Done when:**
- [ ] Each world's set runs on Low, Med and High within X2's budget (+6 draw calls or fewer per world, 0 per ship).
- [ ] Sims and unit tests are unchanged and green.
- [ ] **The user approves each world's look** on the preview; a rejected world's `envfx` is tuned in a follow-up commit.
- [ ] **Device gate:** an 8-ship race on Jade Ruins (the heaviest scenery) and on Cryo Station (the pipe), on both devices.

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
  - **GrandPrix:** built early in §GP above. M8 adds its unlock (World Tour world 5 cleared at any tier).
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

**2.1 (§X3, as built):** the four rows above are variant A of each slot (Velocity, Longburn, Grip, Cell). Variant B, at Mk II / Mk III / Prototype (Stock is the same part):

| Part | Effect | Weight |
|---|---|---|
| Engine, Sprint | topSpeed +2/+4/+7; thrustAccel +6/+11/+15 | as Velocity |
| Booster, Burst | boostTopSpeed +8/+15/+22; boostCost 14/13/11; boostTime 1.3/1.35/1.4 | 0 |
| Stabilizer, Agility | steer ×1.08/1.15/1.22; lateralGrip +0/+0.2/+0.5; topSpeed −0.5/−1/−1.5 | 0 |
| Hull, Plate | energyMax +3/+7/+10; damageTakenScale ×0.85/0.75/0.65; ram mass ×1.1/1.2/1.3 | +0.05/+0.09/+0.14 |

Aero (Stock / Mk II / Mk III / Prototype): draft bonus ×1/1.15/1.3/1.5; push from wind and jets ×1/0.9/0.8/0.7; steering in the air ×1/1.1/1.2/1.3; topSpeed −0/−0.3/−0.6/−1.

Mean lap times of a solo Legend autopilot over the five tracks (`sim/partsBalance.sim.test.ts`; Stock is 33.07 s):

| Slot | Mk II A / B | Mk III A / B | Prototype A / B |
|---|---|---|---|
| Engine | 32.54 / 32.60 (+0.19%) | 32.23 / 32.35 (+0.37%) | 31.88 / 32.02 (+0.46%) |
| Booster | 32.99 / 33.11 (+0.36%) | 32.97 / 33.05 (+0.22%) | 32.56 / 32.83 (+0.82%) |
| Stabilizer | 33.06 / 33.04 (−0.05%) | 33.07 / 33.04 (−0.09%) | 33.16 / 33.12 (−0.12%) |
| Hull | 33.21 / 33.23 (+0.06%) | 33.23 / 33.27 (+0.10%) | 33.12 / 33.34 (+0.64%) |

Prices: 0 / 600 / 1500 / 3200 credits. Rival fits:

| Tier | Parts fitted |
|---|---|
| Rookie | all Stock |
| Pilot | 2 × Mk II |
| Ace | all Mk II + 2 × Mk III |
| Legend | Mk III, with Prototype engine and booster |

**2.1 rival fits (§X3, as built).** Tiers per slot as above. Variant by personality: aggressive and boost-happy pilots (NOVA BLAZE, REX THUNDER, TURBO TIA) fit Sprint, Burst and Plate; steady, precise and veteran pilots (CAPTAIN ZIGGY, LUNA FROST, OLD SPARKY) fit variant A; PIXEL (erratic) fits Sprint, Longburn, Agility, Cell. Aero: Stock on Rookie and Pilot, Mk II on Ace, Mk III on Legend.

## Appendix B — Worlds at a glance

| World | Palette (neon) | Sky | Song | Gimmick | Hazard | Air gravity |
|---|---|---|---|---|---|---|
| Neon Bay | cyan / magenta | Night, synth sun, grid sea | 118 BPM synthwave (A minor) | Corkscrew | — | 1.0 |
| Sunset Mesa | amber / coral / chrome | Airbrush sunset bands | 124 BPM outrun (D Dorian) | 2 jumps | — | 1.0 |
| Cryo Station | ice blue / white / violet | Aurora night | 110 BPM chiptune-synth (E minor) | Full-pipe | Ice patches | 1.0 |
| Jade Ruins | jade / gold / UV purple | Misty dusk, fireflies | 128 BPM tribal-synth (G Phrygian) | Split path | Stone gates | 1.0 |
| Orbital Ring | white / electric blue / red | Space, Earth below | 96 BPM ambient arpeggio (C Lydian) | Loop + low-g jumps | Mines + debris | 0.35 |
| Tempest Spire (2.1, §X4) | storm violet / electric yellow / teal | Thunderstorm below, rain, lightning | 132 BPM dark synth (F♯ minor) | Crosswind zones | Lightning strikes | 1.0 |
| Cinder Forge (2.1, §X5) | ember orange / cobalt blue / basalt black | Crater glow, ember clouds | 140 BPM industrial synth (C Phrygian) | The Plunge | Lava geysers | 1.0 |
| Abyss Line (2.1, §X6) | aqua / brass gold / coral pink | Undersea, light shafts from the surface | 104 BPM dreamy synth (D Mixolydian) | The Spine | Pressure jets | 1.0 |

## Appendix C — Test matrix added in 2.0

| Test | Where | Gate |
|---|---|---|
| Stats parity (Balanced Stock = v1) | `physics/__tests__` | every v1 physics test unchanged |
| Race sim 5 tracks × 4 tiers × 8 ships | `sim/race.matrix.sim.test.ts` | all finish; respawn rules; tier ordering |
| Gimmick holds: corkscrew, pipe (θ sweep), loop (5 offsets), jumps (clear rate) | `sim/*.hold.sim.test.ts` | height error < 0.6 m; no respawns (jumps: no respawn for non-erratic) |
| Balance: assisted Rookie autopilot vs Rookie AI; Pilot autopilot vs Pilot AI | `sim/balance.sim.test.ts` | top 3; mid-pack |
| Hazard determinism (same seed → same outcome) | `sim/hazards.sim.test.ts` | identical standings |
| Crosswind hold (2.1, §X4) | `sim/wind.hold.sim.test.ts` | line held within 1.5 m; hands-off drift 2–4 m, no rail; Aero drifts less; identical replays |
| Lightning (2.1, §X4) | `sim/hazards.sim.test.ts` | one hit per strike; normal and Rookie rules; Shield; clear lane; identical replays |
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
