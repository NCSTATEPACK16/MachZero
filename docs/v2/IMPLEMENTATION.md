# MachZero 2.0 — Implementation Guide (for the Opus 5.5 build sessions)

Read [`SPEC.md`](SPEC.md) first (the *what*). This file is the *how*: operating rules, target architecture, interface changes, and milestones **M0 → M8** pinned to v1's real files. **M7 and M8 were designed on 2026-11-16** (SPEC §11 and §12) and are full build plans, in the style of §X. v1's architecture and its corkscrew-physics notes are in [`../TDD.md`](../TDD.md) §7. The **2.1 expansion** (SPEC §10: cups, environment effects, upgrades, three new worlds) is section **X**, after §V.

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

     Then in Xcode: Any iOS Device (arm64) → Product → Archive → Distribute App → App Store Connect → Upload. The version is `package.json`'s (1.1.0 since MachZero 2.0; raise it in a release's PR); `ios:sync` writes it into the Xcode project and raises the build number.

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
  audio/          (moved from game; §M6) AudioEngine.ts, RaceSounds.ts, MenuSounds.ts, SfxBank.ts, VoicePool.ts, duck.ts,
                  soundTable.ts, BufferCache.ts, MusicDirector.ts, MusicPlayer.ts, sfx/{v1Sounds,sfxr,presets}.ts,
                  dsp/*.ts (the synthesiser), songs/*.ts, render/{audio.worker,RenderClient}.ts
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
| X4 🟡 gameplay half built (PR #37) | World 6, Tempest Spire | `v2/x4-tempest-spire` | — | **`chosen.jpg`** (the look waits for it); then look approval and the device gate |
| X5 🟡 gameplay half built (PR #38) | World 7, Cinder Forge | `v2/x5-cinder-forge` | — | **`chosen.jpg`** (the look waits for it); then look approval and the device gate |
| X6 🟡 gameplay half built (PR #39) | World 8, Abyss Line (and the Storm Cup) | `v2/x6-abyss-line` | — | `chosen.jpg`; look approval; device gate |
| X7 ✅ built (#52) | Effects polish on the five 2.0 worlds | `v2/x7-old-world-fx` | — | Look approval per world; device gate |

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

### X4 — World 6: Tempest Spire (crosswinds and lightning) — 🟡 GAMEPLAY HALF BUILT (PR #37, draft; the look waits for `assets/reference/worlds/tempest-spire/chosen.jpg`)

**As built: the gameplay half (PR #37)** (read before X5, and before building the look):
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

### X5 — World 7: Cinder Forge (the Plunge and lava geysers) — 🟡 GAMEPLAY HALF BUILT (PR #38, draft, stacked on #37; the look waits for `assets/reference/worlds/cinder-forge/chosen.jpg`)

**As built: the gameplay half (PR #38)** (read before X6, and before building the look):
- **What is done:** build steps 1–7 and the placeholder theme of step 8. **What is left:** the real theme, the props, the effect set, the perf table on the real look and the shots. All of it needs `chosen.jpg`.
- **The Plunge** (`track/features/plunge.ts`): `buildPlunges`, `inPlunge`, `plungeAccel`, `plungeDiveFoot`, `plungeClimbFoot`. In `ShipController.simulate`, a grounded ship on the main road inside a Plunge gets `−MAGNET_G · PLUNGE_GRAVITY · forward.y` along its heading (`forward.y` is the world-up part of the ship's own heading, so a ship that points downhill speeds up and one that points uphill slows down). The speed limit there is `PLUNGE_SPEED_CAP` (1.2) × top speed, or × boost top speed while boosting, for the whole feature: the dive, the floor and the climb.
  - **A climb never stalls a ship.** Uphill the pull is full above 60 m/s and fades to nothing at 30 m/s (`PLUNGE_STALL_SPEED`). A ship stopped on the climb does not roll back, and it drives out from rest.
  - **Respawn:** `safeRespawnU` sends a ship lost on the dive to 20 m past the foot of the dive. On the floor and the climb a ship comes back where it was.
- **Plunge numbers** (`sim/plunge.hold.sim.test.ts`, 30 cases): at 40, 90, 140 and 180 m/s on five lines a ship holds its line within 1.3 m (0.03 m down the dive hands-off), height error at most 0.06 m, never airborne, no rail hit, no respawn. A ship that enters at top speed (140 m/s) reaches 169 m/s at the foot of the dive, crosses the floor at 167 m/s and leaves the climb at 138 m/s. A coasting ship goes from 33 to 80 m/s on the dive. A boosting ship reaches 202 m/s (cap 228). From rest at the foot of the climb a ship leaves at 107 m/s. The chase camera stays 3.4 m or more above the deck with the ship on screen. The same run twice is identical.
- **Ramp segments in the authoring tool** (`scripts/track-design.mjs`): `{ ramp: { pitch, radius, plunge?: 'in' | 'out' }, y }` is a plan-straight segment from the elevation before it to `y`: a bend, a straight slope and a bend back to the level. Each bend's curvature is a trapezoid (it builds up and fades over `RAMP_EASE` = 10 m), and control points are 6 m apart. The `'in'` ramp starts the `plunge` feature and the `'out'` ramp ends it. A ramp's metres are road metres, not plan metres.
- **Geysers** (`track/features/geyser.ts`): the same field and timeline as lightning, with other numbers: radius 2.5 m, 1.5 s warning (× `telegraphScale`), 1.2 s eruption at the end of each cycle, one hit per ship per eruption. `PhysicsSystem.checkGeysers` → `ShipController.applyGeyser`: 8 energy × `damageTakenScale` and a 10 m/s knock up the road's normal; Rookie rules: velocity × 0.85 only, no knock. A Shield takes it (`item:shield` with `blocked: 'geyser'`). Event: `hazard:geyser { shipId, geyser, point }`.
  - **`track/features/timedField.ts` is new and shared.** Lightning and geysers both build their points and read their timeline through it (`buildTimedPoints`, `pointActive`, `pointWarning`, `pointActiveDuring`, `pointCycle`). `lightning.ts` keeps its exports. `PhysicsSystem.hitTimedPoint` is the one hit test for both. X6's pressure jets can use the same module.
  - **The magnetic lock holds the knock to a bump.** At 120 m/s a hit lifts the hull from 1.2 m to 1.5 m and it settles in half a second (`hazards.sim.test.ts`). The cost of a geyser is the energy, the camera kick and the line change, not a flight.
- **Track** (`content/tracks/cinder-forge.json`): 4,571 m, about 34.5 s a lap at Pilot pace in the race sims (the validator's flat-road estimate is 38.7 s), minimum radius 105 m, elevation 38–154 m. The rim is level at 150 m: an S-bend, two geyser fields of 5 vents (periods 5 s and 5.5 s, clear lanes at −2 m), the Plunge (112 m down at 54.9°, a 260 m floor straight, a 260 m-radius sweeper, a 160 m straight, the climb), a 130 m-radius corner, one 60 m jump, the pit and two dash plates (none on the Plunge).
- **Validator** (`TrackValidate.ts`, issue codes `plunge` and `geyser`): a Plunge is straight in plan and unbanked wherever it slopes, no steeper than 57°, with a vertical radius of at least 115 m, level at both ends, with no other feature, dash plate, wind zone or hazard field on it. **Outside a Plunge, a jump or a loop the road may not be steeper than 12°** (gravity along the road exists only on a Plunge). A geyser field follows the lightning rules, and is never on a Plunge, in a wind zone or over a lightning field; its period is at least 4.7 s.
- **AI** (`AIDriver`): the Plunge's two slopes (not its floor) are centre sections, as the corkscrew and the loop are: no slipstream hunting, no tier mistakes, a line near the centre. `avoidHazards` adds a band for a vent only when it erupts within 0.6 s of the hull crossing it. The corner after the climb needed no change: the climb takes the dive's speed back, so the ship arrives at its normal speed.
- **World entry:** `cinder-forge`, order 7, `expansion: true`, `props: false`, the placeholder theme (`themes/index.ts`). Palette: ember orange and cobalt blue rails, molten yellow for the vents. **Replace the placeholder line and delete `props: false` when the real theme exists.** The Storm Cup still waits for Abyss Line.
- **Telegraph visuals** (`geyserVisual.ts`, built with the track, 2 draw calls for the whole track): each vent is a dim ring that brightens with a quickening pulse over the warning; the eruption is a 16 m column that shoots up, holds and falls.
- **Feedback:** toast `🌋 LAVA GEYSER` (`🛡 GEYSER BLOCKED` with a Shield), the mine's burst effect at the hull, a camera kick, a heavy haptic tap, pad rumble, and the mine's sound until M6.
- **Sims** (`sim/cinder-forge.sim.test.ts`, 8 races, about 10 s): Rookie and Legend fits finish with no respawn; the tier matrix passes (Pilot and Ace fields clean; mixed field mean position Legend 2.0, Rookie 6.7; Rookie-assisted autopilot on the podium from P8; Pilot autopilot P4, 0.01 s off the median); an Ace race replays to the same standings and hits. A field of 8 takes 1 geyser hit in a Rookie race and 5 to 8 in the others (240 vent passes).
- **Tests:** 594 unit and sim tests in 64 files (X4: 533 in 61); e2e 17/17 (one new: a Cinder Forge race past both geyser fields and down the dive, no console error, no shader compiled mid-race).
- **Desktop perf on the placeholder theme** (`perf-desktop --audit`, 8 ships, 15 s; not the gate, which is measured on the real look):

  | World, preset | fps | p50 / p95 / p99 ms | Grid-frame draw calls | Race median draw calls | Triangles |
  |---|---|---|---|---|---|
  | Cinder Forge, High | 59.9 | 16.7 / 16.7 / 16.8 | 148 | 121 | 115k |
  | Cinder Forge, Med | 60.0 | 16.7 / 16.7 / 16.8 | 148 | 122 | 115k |
  | Cinder Forge, Low | 60.0 | 16.7 / 16.7 / 16.8 | 127 | 88 | 109k |
  | Neon Bay, High (shared code; #37 was 170) | 59.9 | 16.7 / 16.7 / 16.8 | 170 | 138 | 141k |
  | Neon Bay, Low (#37 was 147) | 60.0 | 16.7 / 16.8 / 16.8 | 147 | 101 | 118k |

  The geyser vents and columns are 2 draw calls for the whole track. Ship draw calls did not change.
- **X4's smoke test was passing on the grid.** It waited for "more than 1,900 m", and on the grid, just behind the line, the distance already reads about 4,300 m. Both world smoke tests now wait for a window (`d > 1900 && d < 3000`), so they race through their hazards. Tempest Spire's still passes.
- **Deviations from the plan:**
  - **The dive is 112 m at 54.9° on a vertical radius of 119 m.** The plan said about 55°, roughly 90 m and a radius of at least 120 m. Those three do not fit together: two 120 m bends to 55° already drop 102 m, and the bends must ease in and out or the spline through the control points overshoots (a plain arc–arc profile measured 94–110 m). The pitch was kept, the drop grew, and the validator's limit is 115 m. The hull's height error on the Plunge is 0.06 m, so the hold has a wide margin.
  - **The frames needed no pitch-axis rule.** The dive and the climb are straight in plan, so the rotation-minimising frame has no roll there (the hold sim checks `right.y` < 0.01). `TrackFrames` is unchanged.
  - **The speed cap covers the floor too,** so the speed won on the dive lasts until the climb. The plan did not say where the cap ends.
  - **The Rookie geyser hit has no knock** (slow-down only, as for lightning). The plan gave the Rookie rule as "no energy loss, velocity × 0.85".
  - Per-track elevation bounds already existed (`TrackDefinition.elevation`), so step 4 had nothing to add there.
  - The clear lanes are at −2 m, on the line ships hold out of the corner before each field. With lanes at +3 m and −3 m a Legend field took 13 hits in a race, most of them by ships that had to cross the road right after the corner.
- **Not asked for, in this PR:** `features/timedField.ts` (the lightning code moved into it so geysers did not copy it); the 12° slope rule in the validator; the toast, haptics, rumble and sound on a geyser hit.

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

**Done when** (the same list as X4, with the Plunge hold test in place of the wind test):
- [x] The Plunge hold test and the hazard tests pass; hazards are deterministic.
- [x] The 4-tier sims pass: all 8 ships finish, order roughly follows tier, the SPEC §9 balance targets hold.
- [x] `tracks:check` passes; the SVG preview is committed; lap 30–45 s.
- [ ] World assets ≤ 2.5 MB; `public/game` ≤ 15 MB; effects within X2's budget. *(Waits for the look: the world has no assets yet.)*
- [ ] **The user approves the look**, and the **device gate** passes on Cinder Forge. *(Waits for `chosen.jpg`.)*

---

### X6 — World 8: Abyss Line (the Spine and pressure jets), and the Storm Cup — 🟡 GAMEPLAY HALF BUILT (PR #39, draft, stacked on #38; the look waits for `assets/reference/worlds/abyss-line/chosen.jpg`)

**As built: the gameplay half (PR #39)** (read before X7, and before building the look):
- **What is done:** build steps 1–7 and the placeholder theme of step 8. **What is left:** the real theme, the props, the effect set, the perf table on the real look and the shots. All of it needs `chosen.jpg`. **The `expansion` flag is still off:** whether it turns on here is the owner's call at review (the plan's default was "on here"; see the PR).
- **The Spine** is the pipe's curl with a sign (`track/features/pipe.ts`): `curlSamples(count, ds, pipes, spines)` writes `up − down`, so a spine is −1 on its closed stretch. `isFlatCurl` and the magnitude of the curl drive `TrackQuery`, `TrackSweep` and `TrackFrames`; `uncurlPoint` takes the curl's sign, so `project` inverts `surfacePoint` on the outside of the tube. Lateral is the arc position round the tube (0 = the crown, ±W = the bottom seam); the tube's radius is `PIPE_RADIUS` (W/π ≈ 4.46 m) below the centreline. `TrackData.spines` holds the extents (`uStart`, `uEnd`, `uClosedStart`, `uClosedEnd`); `surfaceKindAt` reports `'spine'`.
  - **Shared with the pipe, unchanged in behaviour:** the magnetic lock, `PipeCompensation` (it iterates pipes and spines; its clamp is now −1..1), the seam guard (`ShipController.seamGuard`: the same ease off the seam before the tube opens), collision 40 pieces across, rails that end at |curl| ≥ 0.85, the AI's ±9 m line limit (`PIPE_MAX_LAT`). Pylons skip each spine ±20 m.
  - **Layout rule found by the hold sim:** a spine must leave its bend before the tube opens. Opening right at the bend's end, a ship holding 154° round the side came out of the bend still heading out and met the rails rising at the seam. The validator's spine rule: both transitions, plus `SPINE_STRAIGHT_CLOSED` (50 m) of closed tube beside each, on a straight.
- **Spine numbers** (`sim/spine.hold.sim.test.ts`, 12 cases): on five lines (±12, ±7 and 0 m round the tube, up to 154° either side) at 70 and 125 m/s, the height error and the distance from the tube axis are within 0.16 m, the hull stays aligned to the surface (dot ≥ 0.986), never airborne, no respawn, and a ship leaves at the speed it came in (118–125 m/s at 125). A spiral drives 46.5 m round the outside (more than a full turn). The chase camera stays 4.2 m or more outside the tube, rolls with the ship (dot ≥ 0.93) and keeps it on screen. The pipe hold test passes unchanged.
- **Pressure jets** (`track/features/jet.ts`): `timedField` (shared with lightning and geysers) with a `jets` type. Vents are placed on the curled surface (`buildJets` needs `TrackData.surfacePoint`; `TimedPoint` gains `lane`), radius 2.2 m, 1.5 s warning (× `telegraphScale`), 0.8 s jet, one hit per ship per jet, never within 1.5 m of the bottom seam, a clear lane of 1.5 m margin beside the hull. `PhysicsSystem.checkJets` → `ShipController.applyJet`: the knock is round the tube (forward × the surface normal at the hull), away from the vent (toward the lane for a hull right on it), 9 m/s × `pushScale`, plus 5 energy × `damageTakenScale`; Rookie rules: velocity × 0.85, then a 5 m/s knock, no energy. A Shield takes it (`item:shield` with `blocked: 'jet'`). Event: `hazard:jet { shipId, jet, point }`.
  - **The knock moves a ship, it does not fling it.** At 120 m/s the full 9 m/s arrives round the tube, and lateral grip bleeds it off in about a tenth of a second: 0.5 s on, the hit ship is 0.81 m further toward the lane than the same pass with the vent idle, at a height error of 0.15 m (`hazards.sim.test.ts`, which compares against that control run). The cost of a jet is the energy, the camera kick and the line change. If the owner wants a bigger shove, raise `JET_KNOCK`.
- **Track** (`content/tracks/abyss-line.json`): 4,807 m, about 35.7 s a lap at Pilot pace in the race sims (the validator's estimate is 40.7 s), minimum radius 146 m, elevation 40–54 m. The pit straight, a 300 m sweeper, an S-bend, the Spine (690 m: 90 m closing on a straight, 510 m closed through a 400 m-radius 50° bend, 90 m opening on a straight) with two jet fields of 4 vents (periods 5 s and 5.5 s, clear lanes at +3 m and −3 m), a hairpin, the glass-tunnel S-bend on the back straight, two sweepers back to the line, the pit and two dash plates. No jump, no corkscrew.
- **Validator** (`TrackValidate.ts`, issue codes `spine` and `jets`): a spine follows the pipe rules (transitions, closed length, a plan radius of at least 300 m), plus the straight rule above, and the bottom of its tube stays above the world's lowest elevation. A jet field lies on the closed stretch of a spine, has a period of at least `JET_MIN_PERIOD` (the Rookie warning must fit between two jets), leaves room beside its lane and off the seam, and overlaps no other hazard field or wind zone.
- **AI** (`AIDriver`): the pipe's `inPipe` covers spines (lines within ±9 m). `avoidHazards` adds a band for a vent only when it fires within 0.5 s of the hull crossing it; inside a spine the way round stays within ±9 m.
- **World entry:** `abyss-line`, order 8, `expansion: true`, `props: false`, the placeholder theme. **Replace the placeholder line and delete `props: false` when the real theme exists.** With Abyss Line built, the **Storm Cup** is available whenever the flag is on (X1's rule, unchanged).
- **Telegraph visuals** (`jetVisual.ts`, built with the track, 3 draw calls for the whole track): each vent is a dim ring on the tube that brightens with a quickening pulse over the warning while a bubble stream rises from it; the jet is an 11 m column of white water straight out of the tube that shoots out, holds and collapses.
- **Feedback:** toast `🫧 PRESSURE JET` (`🛡 JET BLOCKED` with a Shield), the mine's burst at the hull, a camera kick (a little smaller than a geyser's), a heavy haptic tap, pad rumble, and the mine's sound until M6.
- **Sims:**
  - `sim/abyss-line.sim.test.ts` (8 races): Rookie and Legend fits finish with no respawn; the tier matrix passes (Pilot and Ace fields clean; mixed field mean position Legend 2.0, Rookie 7.0; Rookie-assisted autopilot on the podium from P8; Pilot autopilot P2, 0.7% off the median); an Ace race replays to the same standings and hits. A field of 8 takes 4 jet hits in a Rookie race and none in a Legend race (192 vent passes).
  - `sim/stormCup.sim.test.ts`: the whole Storm Cup headless, with a reload mid-cup (the whole-cup sim moved into `sim/cupSim.ts`, shared with the Neon Cup's `grandPrix.sim.test.ts`).
- **Tests:** 630 unit and sim tests in 68 files (X5: 594 in 64). e2e: two new, the Storm Cup by pad (pick its tab, five races in order to the final standings) and an Abyss Line race round the Spine and past both jet fields with no console error and no shader compiled mid-race.
- **Desktop perf on the placeholder theme** (`perf-desktop --audit`, 8 ships, 15 s; not the gate, which is measured on the real look):

  | World, preset | fps | p50 / p95 / p99 ms | Grid-frame draw calls | Race median draw calls | Triangles |
  |---|---|---|---|---|---|
  | Abyss Line, High | 59.4 | 16.7 / 16.7 / 16.8 | 150 | 120 | 146k |
  | Abyss Line, Med | 59.8 | 16.7 / 16.8 / 16.8 | 150 | 116 | 146k |
  | Abyss Line, Low | 59.9 | 16.7 / 16.7 / 16.8 | 129 | 87 | 140k |
  | Neon Bay, High (shared code; #38 was 170) | 59.9 | 16.7 / 16.8 / 16.8 | 170 | 138 | 141k |
  | Neon Bay, Low (#38 was 147) | 60.0 | 16.7 / 16.8 / 16.8 | 147 | 102 | 118k |

  The jet vents, streams and columns are 3 draw calls for the whole track. Ship draw calls did not change.
- **Deviations from the plan:**
  - **The Spine is 690 m (510 m closed), not 500 m,** so the closed tube runs onto a straight before it opens (the layout rule above).
  - **The glass tunnel is an S-bend on the back straight,** not a covered section (that is the look's job). Without it the back straight was 735 m: with the Spine's gentle bend that made one long boost zone, and the Pilot field spread by boost timing alone (the Pilot autopilot finished 1.7% off the median, against the 1.5% target). With it the lap is 4,807 m (the plan said about 4.4 km; the lap time is inside 36–41 s).
  - **The Rookie jet hit keeps a 5 m/s knock,** as the plan says (unlike the geyser's and lightning's Rookie hits, which only slow the ship).
  - **The clear lanes are at ±3 m,** so each field has vents on both sides of its lane (at ±4 m or ±6 m one side had no room off the seam).
- **Not asked for, in this PR:** the whole-cup sim moved into `sim/cupSim.ts`; the toast, haptics, rumble and sound on a jet hit.

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

### X7 — Effects polish on the five 2.0 worlds — ✅ BUILT (PR #52, base `main`; waiting on the owner's look approval per world and the device gate)

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

**As built (branch `v2/x7-old-world-fx`, base `main`):**
- **The sets** (each world's `envfx` in `graphics/themes/<world>.ts`):

  | World | Effects | Draw calls added (High / Med / Low) |
  |---|---|---|
  | Sunset Mesa | blowing dust (weather `dust`, 1,400, wind 9 m/s), low-sun shafts (10), dust behind the ships, a warm grade, 3 dust devils on the desert floor | 3 / 3 / 2 |
  | Cryo Station | snowfall (2,200, drifting, short streaks at speed), a cold grade, ice glitter on the deck, aurora pulses | 1 / 1 / 1 |
  | Jade Ruins | mist banks on the canopy (3 sheets), rising spores (1,600), canopy shafts (12, low amber sun), a greener grade | 3 / 3 / 2 |
  | Orbital Ring | micro-meteor streaks (260), 3 shuttles, a sun glint, a crisp cool grade | 4 / 4 / 4 |

  Every world is within the +6 budget on every preset, counting each set piece's meshes from its `props.glb` (`graphics/envfx/__tests__/worldSets.test.ts`). No draw calls per ship.
- **New props** (`blender/props/build_props.py`):
  - **`dustdevil_0`** (Sunset Mesa, 240 tris): a leaning, twisted funnel in a new role, **`dust`**, which the theme draws see-through. `props.glb` 71.6 → 78.0 KB.
  - **`shuttle_0`** (Orbital Ring, 96 tris; chrome, dark and neon roles). `props.glb` 38.9 → 44.3 KB.
  - `check-assets.mjs` knows both props and the `dust` role.
- **Framework additions:**
  - `SetPieceSpec.spin` (rad/s about the prop's own axis) and `bob` (default 12 m, as before; 0 keeps a dust devil on the ground).
  - `WetDeckSpec.glitter` and `glitterColor`. The deck is split into half-metre cells; about one in 30 holds a crystal that lights when the view lines up with its random facet, so the glints come and go as the ship moves. The glitter compiles under its own program key (`mz-wetdeck-glitter`), so Neon Bay's wet deck is unchanged.
  - Sunset Mesa and Orbital Ring gained `roleMaterial`, so their set pieces use the theme's prop materials.
- **Theme work in the sky shaders:**
  - **Cryo Station's aurora** breathes (±20% over 14 s), and a brighter surge runs along the curtains about every 30 s.
  - **Orbital Ring's sun glint:** a six-pointed star and a thin horizontal streak round the sun, breathing slowly.
  - Both are gentle and never flash, so reduced motion keeps them. If they should stop with reduced motion, that is one uniform each.
- **Decisions made while building:**
  - **Jade Ruins' fireflies stay their own points.** The world's one weather slot is the spores', so moving the fireflies into it would not save a draw call.
  - **Jade Ruins' mist lies on the canopy beside the road (top sheet at 41 m, just under the road's mean height of 45 m).** Next to the road the canopy crowns top out a few metres under the deck, so a sheet below the road's lowest point (38 m) was buried in them. Where the road dips under 41 m the mist drifts over the deck. That is visual only, and the sheets fade as the camera comes level with them.
  - **Set pieces orbit the track's centre at radii checked against the track** (the test keeps each prop, at its scale, outside the 80 m corridor): dust devils at 1,050 m (scale 1.5); shuttles at 1,150 m, 35–85 m above the track's mean height. That keeps the shuttles above the track's highest point, which is 29 m above the mean.
- **The Blender used here** was the `bpy` 5.2.0 module (PyPI), run through a small stand-in for the Blender binary (`BLENDER=<wrapper> npm run assets -- props`). Rebuilt unchanged, all five `props.glb` files came out byte-identical to the committed ones before the new props were added.
- **Checks:**
  - Unit tests: `worldSets.test.ts` (each world's set as the design names it; the budget from `props.glb` on every preset; set pieces clear of the corridor; the dust devils on the ground; the mist height; the shuttles above the road; the glitter compiled in).
  - Sims and gameplay tests unchanged (the effects are visual only).
  - Shots: `docs/v2/shots/x7/<world>-{med,low}-{before,after}.jpg`, at the same moment of the race (10 s in).
- **Perf:** draw calls were measured here, on a CPU-only container. **Frame times need the owner's Mac** (`npm run build && node scripts/perf-desktop.mjs --world <id> --quality high,med,low --seconds 25 --audit`) **and the device gate.**

---

## M6 — Audio: music, sound effects, ambience, the mix — 📐 DESIGNED (2026-11-24; ready to build)

SPEC §8 says what and why. This section is the how. **Design decisions (design interview with the owner, 2026-11-24, 35 questions in two rounds and a summary; settled, don't re-open)** are listed below, first for the whole milestone, then per PR. M6 gives MachZero its soundtrack (8 world songs, a menu theme, a results theme, 8 stingers), the sounds v1 never had (menus, the shop, the results, the road, the 2.1 hazards), an engine voice per class, ambience, and a mix that is safe for children.

**Four PRs, in build order, each stacked on the one before (M6a on `main`, or on the M6 design-docs branch while that PR is open):**

| # | PR | Branch | Save | Flag | Needs from the owner |
|---|---|---|---|---|---|
| M6a | The audio graph and mixer, the move to `src/audio/`, the SFX bank, the event-to-sound table, the menu, shop, results and hazard sounds, SOUND TEST (effects only) | `v2/m6a-audio-graph` | — (`settings.mono` through the sanitizer) | behind `music` | The baseline fps readings; listening to the new effects; the ringer switch, AirPods, background and resume |
| M6b | The synthesiser (`audio/dsp/`), the render Worker, the music player and director, songs in SOUND TEST, the menu theme, Neon Bay and Orbital Ring | `v2/m6b-music-engine` | — | behind `music` | **The style approval** of the three songs (blocks M6c); render times and fps on both devices |
| M6c | The other six world songs, the results theme, the 8 stingers | `v2/m6c-songs` | — | behind `music` | The listening approval of each song and stinger |
| M6d | Engine voices, rival engines, ambience, the crowd, the echo, positional sound, the mix pass; `music` on, then the flag and the v1 graph removed | `v2/m6d-mix-release` | — | `music` → on; removed | The full device gate; the approval of the sound set as a whole; the merge |

**Release order (agreed):** M6a → M6b → (owner's style approval) → M6c → M6d. **The style approval in M6b comes before a note of the other six songs is written.** The world looks (X4–X6) are independent of M6: the 2.1 worlds' songs are written regardless, and they play whenever `expansion` shows those worlds.

**Facts checked on 2026-11-24 (`main` at `23285af` plus the M6 prompt commit):**
- **The code M6 starts from:**
  - `src/game/AudioSystem.ts` (651 lines): a master gain → one `DynamicsCompressor` (threshold −16, knee 18, ratio 5, attack 4 ms, release 200 ms) → destination; one sfx gain under the master; persistent voices (engine: 3 oscillators through a low-pass; a boost saw; wind, scrape and the pit hum); one-shots through `tone()` and `noise()`, at most 28 at once (`MAX_ONE_SHOTS`); a 2 s white-noise buffer; `HEARING_RANGE` 60 m with `nearness()` = (1 − d/60)² × 0.85; parameters refreshed at 40 Hz (`UPDATE_INTERVAL`); the mine proximity beep within 70 m ahead.
  - The App owns one `AudioSystem` (`App.ts:146`). Each `RaceSession` calls `audio.attach(bus)` in `attachView` and `audio.detach()` in `dispose`, and `audio.update(ctx)` at the end of `frame()`. `App.applySettings` calls `setVolumes(master, sfx)` and `setMuted`.
  - **The race bus's handlers run inside `PhysicsSystem.step`** (physics emits synchronously), so v1 builds one-shot nodes from inside the fixed step. M6a moves that out (rule F below).
  - **The menu backdrop is a real race** in `title` state (`App.ensureSession`), on the world the profile has selected. The engine and wind are silent in `title` (`live` is false).
  - `MenuEvents` on `App.events` (M8a): `results:tally`, `results:total`, `results:unlock`, `results:trophy`, `results:medal`, `results:champion`, `ui:locked`, `tutorial:step`, `tutorial:done`. Nothing plays them.
  - Race events with no sound: `ship:jump`, `ship:land`, `ship:ice`, `ship:wind`, `ship:respawn`, `hazard:gate`, `hazard:debris`, `hazard:lightning`. `hazard:geyser` and `hazard:jet` play the mine's sound.
  - **The hazard timelines are pure functions** of the track and the hazard clock: `buildStrikes`/`strikeWarning` (`track/features/lightning.ts`), `buildGeysers`/`geyserWarning`, `buildJets`/`jetWarning`, `gateWarning` (`track/features/gate.ts`); `game/HazardCue.ts` already uses them per frame. The warning time is scaled by `HazardPolicy.telegraphScale` (1, or 2 in Rookie races); `FrameContext` does not carry it yet.
  - `TrackData.pipes` and `TrackData.spines` give the pipe and Spine extents in u (`uClosedStart..uClosedEnd`).
  - **The HUD's "⚠ EMP INCOMING"** (`HUD.ts:370`) is shown from `ItemSystem.playerView().incoming`, but `playerView()` returns null when the player carries no items, so the warning hides. The EMP alarm is then the only cue on the web. M6a fixes this (a warning must never be told by sound alone).
  - Settings save `masterVolume` 0.8, `musicVolume` 0.7, `sfxVolume` 1, `muted`; `sanitizeSettings` fills a missing field with its default, so a new field needs no save version.
  - The ships face −Z; +X is the ship's right (`ChaseCamera`). A ship's class comes from `chassisById(def.loadout.chassisId).class` (`content/ships.ts`); a ship with no loadout (the v1 roster) is Balanced.
  - `CONFIG.RESULTS_DELAY` is 3 s (finish → results). `CONFIG.EMP_WARN_TIME` is 0.5 s. `CONFIG.TOTAL_LAPS` is 3.
- **Experiments (headless Chromium 153 on a 2.1 GHz cloud Xeon, 4 cores; throwaway code, not committed).** The owner's devices were not available to the design session, so every device number is a gate in the PRs below.

  | Approach (a dense Neon Bay arrangement, ~100 s of audio, 48 kHz) | Audio-thread CPU | Main thread | Memory | Load |
  |---|---|---|---|---|
  | Live notes from native Web Audio nodes, created 100 ms ahead (the look-ahead scheduler) | 6.8% of a core (9.0% with a 1.2 s convolver reverb) | 0.9 ms on a busy step (p95 1.4 ms); 4.6 ms per full bar | small | none |
  | The same, every note created up front in one context | 105–127% | — | — | — |
  | The same, nodes not disconnected when a note ends | 10.8% (16–26% with reverb) | — | — | — |
  | Each distinct bar of each track pre-rendered once (22 buffers), then scheduled | 4.1% | ~0 | 14.9 MB mono | 1.05 s |
  | **Pure-JS synthesis** (polyBLEP oscillators, a TPT state-variable filter, per 128-sample block) | **1.0% for 16 voices** (0.55% for 8, 2.1% for 32) | **0** (off the main thread) | — | — |
  | **Playing one looping AudioBuffer** | **0.12%** | 0 | 31.8 MB per 90 s stereo at 44.1 kHz | — |

  - Per layer, native nodes: pads (3 notes × 3 oscillators) 2.8%, lead 1.9%, arpeggio 1.6%, drums 1.3%, bass 1.2%; the bus with a compressor and a delay loop 0.6%.
  - **jsfxr-style presets:** 20 random presets (13.3 s of audio) render in 215–257 ms of plain JS with sfxr's 8× oversampling, or 37–69 ms as Web Audio graphs in `OfflineAudioContext`. None was silent.
  - **Positional cost, 8 engine voices for 30 s:** no panner 1.7%; `StereoPannerNode` 2.4%; `PannerNode` equal-power 10.2%; `PannerNode` HRTF 11.4%.
  - **Main-thread stalls** against a 100 ms look-ahead scheduler (a stall every 600 ms, 25 steps): 0 late notes up to a 50 ms stall; 2 at 90 ms; 4 at 150 ms; 5 at 250 ms.
  - **iOS facts (web search; Context7 was not available in the design session):** Web Audio on iOS follows the ringer switch by default: the default `navigator.audioSession.type` (`auto`) behaves as `ambient`, which obeys the switch and mixes with other apps' audio. `playback` ignores the switch. `navigator.audioSession` exists from Safari 16.4 and is still experimental; WebKit bugs report differences between iOS versions for the `transient` types ([MDN](https://developer.mozilla.org/docs/Web/API/AudioSession/type), [WebKit 237322](https://bugs.webkit.org/show_bug.cgi?id=237322), [WebKit 264473](https://bugs.webkit.org/show_bug.cgi?id=264473)). AudioWorklet exists in WebKit since iOS 14.5, but there are open reports of glitches on iOS ([WebKit 226240](https://bugs.webkit.org/show_bug.cgi?id=226240), [Apple forum 768347](https://developer.apple.com/forums/thread/768347)) and of `addModule` not rejecting when a module throws ([WebKit 250485](https://bugs.webkit.org/show_bug.cgi?id=250485)). **Re-check each of these with Context7 at the start of M6a** and note any difference in the PR.
  - **A style sketch** (16 bars of Neon Bay in native nodes, 35 s) was sent to the owner as an M4A. The owner accepted the style family (decision 8).
- **Correction made while writing (2026-11-24):** round 1 called the loop "48–64 bars (60–80 s)". At these tempos 48–64 bars last 82–160 s, which breaks the memory budget the owner accepted. **The seconds are the decision:** each loop lasts 60–80 s, which is 24–40 bars depending on the tempo (the song table).

**Design decisions for the whole milestone (settled, don't re-open):**

- **A. The engine (decisions 1, 2).**
  - **The music is rendered, not played live.** A synthesiser written in plain TypeScript (`src/audio/dsp/`, no Web Audio nodes) renders each song in a Web Worker into Float32Arrays: an intro, a seamless loop and a mono lift layer. The main thread turns them into `AudioBuffer`s and plays them with `AudioBufferSourceNode`s. The same code renders in Node, so the unit tests hear real output.
  - **Not adopted:** live notes from native nodes (the main-thread spikes alone break the frame budget); a look-ahead scheduler (no notes are scheduled live at all); AudioWorklet (the iOS glitch reports). AudioWorklet stays a possible later change: the DSP is host-independent, so a worklet host would reuse it unchanged.
  - **The new effects (jsfxr-style presets), the ambience loops and the crowd** render in the same Worker.
  - **v1's sounds stay procedural** (oscillators and noise built per sound), moved into the SFX bank with the same parameters.
  - **A race never waits for audio.** Nothing awaits audio before the first frame or before a race starts. A song that is not ready starts when it is, with a fade.
  - **When the Worker or a render fails**, the music stays silent and the effects still play (presets then render on the main thread in slices of one preset, see M6a). There is one `console.warn` per failure, never a `console.error` (the smoke tests fail on errors).
- **B. The graph (decision 3).** §M6.1 has the diagram and the levels. Four buses under the master: **music** (songs and stingers), **sfx** (race sounds), **ui** (menu sounds), **ambience** (world loops and the crowd). On the master: a compressor, a limiter and a soft clipper with a ceiling of −3 dBFS. **Three sliders:** MASTER → master; MUSIC → music; EFFECTS → sfx, ui and ambience together.
- **C. Ducking (decisions 4, 5, 11).** Only the songs are ducked (not the stingers). The deepest active duck wins; ducks do not add up.

  | Source | Music level | Attack | Release | Held |
  |---|---|---|---|---|
  | Countdown | −8 dB | 50 ms | 600 ms | from `race:countdown` 3 until 0.6 s after 0 (GO) |
  | A stinger | −10 dB | 30 ms | 400 ms | the stinger's length |
  | A warning sound (priority 0, §M6.2) | −4 dB | 20 ms | 300 ms | the warning's length (a telegraph: while it sounds) |
  | Pause | −12 dB **and** a low-pass at 1,200 Hz | 150 ms | 300 ms | while the race is paused |

  - **The music never covers information:** the music bus has a fixed trim of −6 dB against the effects, and a peaking filter of −4 dB at 1,500 Hz (Q 1) where the warning beeps sit (1.2–1.8 kHz).
- **D. Pause (decision 5).** Race sounds (engine, boost, wind, scrape, hum, rival engines, ambience, telegraphs) fade to silence in 80 ms. One-shots already playing finish. The song keeps playing, muffled (C). Menu sounds keep working. **[changed]** SPEC §8 said "the music pauses with the game".
- **E. Scene changes (decision 6).** Every level change is a gain ramp (`setTargetAtTime` or a linear ramp), never a jump, so nothing clicks. Each voice has exactly one owner (the music player, `RaceSounds` or `MenuSounds`), so nothing plays twice.

  | Moment | Music | Race sounds |
  |---|---|---|
  | Boot, first menu | The menu theme fades in over 1.5 s once it is rendered and the context is unlocked | — |
  | A world is selected (the backdrop session is built) | The world's song renders in the background | silent (`title`) |
  | RACE pressed (the loading screen) | The menu theme fades out over 1.0 s | — |
  | The grid card, or the countdown when there is no card | The world song's intro starts (fade-in 0.3 s), then its loop | live from the countdown, as v1 |
  | The player starts the final lap | The lift layer fades in over one bar, from the next bar line | v1's final-lap fanfare |
  | The player finishes | v1's finish fanfare plays at once (an effect, as today); the song fades out over 1.5 s | the engine winds down as v1 |
  | The results screen opens (or the HUD results panel) | The result's stinger, then the results theme fades in (0.5 s) when the stinger ends | detached at the session's dispose |
  | Results → RACE AGAIN, or a restart from pause | The results theme (or the song) fades out over 0.5 s; the world song restarts from its intro at the grid | reset, as v1 |
  | Results or pause → the menus | A 1.0 s crossfade to the menu theme | fade 80 ms |
  | The cup standings | The results theme keeps playing | — |
  | App or tab hidden | The race pauses; the context suspends | — |
  | Back | The context resumes and the master rises from silence over 0.5 s; the game stays on the pause menu | — |

- **F. The loop and the physics step.** **Audio never builds or schedules a node from inside the physics step, and the game loop never waits on audio.** `RaceSounds` handlers only push `{ sound, shipId, intensity, point }` onto a queue (at most 64 entries; on overflow the lowest priority is dropped). `RaceSounds.update(ctx)` drains the queue once per rendered frame, after physics. A sound can therefore start up to one frame (≤ 16.7 ms) later than in v1; that is the only accepted difference from v1.
- **G. Positional sound (decision 7).** With `music` on: a sound from another ship goes through a `StereoPannerNode` with `pan = clamp(dot(ship.position − player.position, playerRight) / 30, −0.8, 0.8)`, where `playerRight` is the player's +X axis (`(1,0,0).applyQuaternion(player.quaternion)`). Its gain keeps v1's `nearness()`. No `PannerNode` (4× the cost). Two pooled rival engine voices (§M6d). **MONO** (§M6.1) overrides every pan.
- **H. Priorities (decision 16).** §M6.2 gives each sound one of four priorities: **0 critical** (warnings, the countdown: never dropped), **1** the player's own physical sounds, **2** other ships' sounds, **3** decoration. The pool keeps 28 one-shot voices. A new sound takes a free voice; when none is free, it takes the oldest voice of the lowest priority below its own; when there is none, it is dropped. Priority 0 may take any voice except another priority 0.
- **I. Platforms (decisions 20–23).**
  - **The ringer switch is respected.** Before the context is created: `if ('audioSession' in navigator) navigator.audioSession.type = 'ambient'` (in a try/catch). No Capacitor plugin. The ambient type also lets the player's own music app keep playing.
  - **App or tab hidden:** the race pauses (`RaceSession.pause(true)` when its state is `racing` or `countdown`; new) and the context suspends (as v1). Visible again: `resume()`, then the master ramps from 0 to its level over 0.5 s. If the context is still not `running` after `resume()` (iOS can leave it `interrupted`), the first-input unlock listeners are added again.
  - **Bluetooth:** no latency correction.
  - **The unlock:** v1's listeners (`pointerdown`, `keydown`, `touchstart`) plus `touchend`; the context is created on the first one and resumed on every later one until it runs.
  - **The pad:** menu sounds come from the UI layer's own events, so the pad, the keyboard and touch sound the same.
- **J. Accessibility (decision 24).** Every warning sound has a visual or haptic twin (§M6.6). Defaults unchanged (master 0.8, music 0.7, effects 1). **MONO** in Settings → Sound (`settings.mono`, default false). **Loudness:** songs and stingers are normalised in the render to −14 LUFS (integrated, BS.1770 K-weighting) with peaks ≤ −1 dBFS; the mix at the default sliders measures −18 ± 2 LUFS over a race (the M6d meter); the master limiter's ceiling is −3 dBFS.
- **K. The flag.** Everything new is behind `music` until M6d. **With `music` off the live game sounds as it does today:** the same graph (master → v1 compressor → destination), the same sounds with the same parameters, and the same events; a golden test (M6a step 1) proves it. The only difference is decision F (up to one frame later). With `music` off: no new buses, no ducking, no limiter, no panning, no new sounds, no `audioSession`, no pause on hidden, no Worker.

**Rules for every M6 PR** (in addition to §0):
- **Budgets** (§M6.5). App JS ≤ 600 KB gzip in total, and M6 adds **≤ 25 KB gzip** counting the Worker chunk. `public/game` does not grow (no audio files). Device gates: 60 fps at the device's own preset, with p95 no more than 1 ms above the baseline read in M6a.
- **Tests first.** The DSP, the song data, the event-to-sound table, the voice pool, the ducking, the buffer cache and the music director are pure and tested in Node. Web Audio itself is tested through `audio/__tests__/fakeAudio.ts` (M6a step 1) and the Playwright specs. Never loosen an assertion.
- **Every PR's hand-off** lists what the owner listens to, with the preview URL (`?features=music`, plus `&expansion` for the 2.1 worlds; SOUND TEST is `?features=music&jukebox=1`) and the iOS command `VITE_FEATURES=music,expansion npm run ios:sync`. Listen on the iPhone with the ringer switch on sound.
- **Library facts** (Web Audio, Workers in WKWebView, `navigator.audioSession`, Playwright's audio handling): confirm with Context7 before relying on them, and record what was checked in the PR.
- **No sound is the only carrier of information.** A new warning sound ships with its twin in the same PR.
- **The headless sims are untouched** (no audio in `src/sim`).

---

### M6.1 The audio graph

```
                       ┌ songs (intro, loop, lift) → duck gain → pause low-pass → EQ dip 1.5 kHz ┐
 music bus ────────────┤                                                                           ├→ music trim (−6 dB) ┐
 (MUSIC slider)        └ stingers ─────────────────────────────────────────────────────────────────┘                     │
 sfx bus (EFFECTS) ─── one-shot pool (28) · engine · boost · wind · scrape · hum · rival engines (2) · telegraphs          ├→ master (MASTER × mute)
     └→ echo send (delay 90 ms, feedback 0.35, low-pass 2.5 kHz) → sfx bus                                                 │     → compressor → limiter
 ui bus (EFFECTS) ──── menu sounds                                                                                         │     → soft clip (−3 dBFS)
 ambience bus (EFFECTS × speed fade) ── world loop · crowd loop                                                            ┘     → mono node (MONO) → destination
```

- **Master compressor** (glue): threshold −16 dB, knee 18, ratio 5, attack 4 ms, release 200 ms (v1's values).
- **Limiter:** a second `DynamicsCompressorNode`: threshold −4 dB, knee 0, ratio 20, attack 1 ms, release 100 ms.
- **Soft clip:** a `WaveShaperNode` with a 2,048-point tanh curve scaled so that the output never exceeds 0.708 (−3 dBFS), `oversample: '2x'`. It is the guaranteed ceiling; the limiter keeps it from working hard.
- **Mono node:** a `GainNode` with `channelCount: 1`, `channelCountMode: 'explicit'`, `channelInterpretation: 'speakers'`, inserted between the soft clip and the destination only while MONO is on (the destination spreads the mono signal to both speakers). MONO also sets every `StereoPannerNode` to 0.
- **Base levels:** master = `MASTER × 0.8` (v1's `MASTER_LEVEL`) or 0 when muted; music = `MUSIC × 0.5` (the −6 dB trim); sfx = `EFFECTS`; ui = `EFFECTS × 0.7`; ambience = `EFFECTS × 0.35 × speedFade` (§M6d).
- **Slider changes** ramp with a 20 ms time constant (as v1).
- **Nodes:** the graph's fixed nodes are counted by `AudioEngine.nodeCount` with every voice's nodes (§M6.5).
- **With `music` off** the graph is v1's exactly: master (`MASTER × 0.8`) → compressor → destination, and sfx under the master.

### M6.2 The event-to-sound table

The table is data (`src/audio/soundTable.ts`, M6a). **Who:** `player` = only when the event's ship is the player; `near` = the player or any ship within 60 m (v1's `nearness()`, panned per G). **Prio:** H. **Since:** `v1` rules play with the flag off and on; `M6` rules only with `music` on, and an `M6` rule for an event replaces the `v1` rule for it. **Bus:** all race sounds are on `sfx`; menu sounds on `ui`; stingers on `music`.

**Race events (`GameEvents`, `RaceSounds`):**

| Event | Sound id | Who | Prio | Since | What it sounds like |
|---|---|---|---|---|---|
| `race:countdown` 3, 2, 1 | `countdown.beep` | player | 0 | v1 | v1: 330 Hz square + 165 Hz sine, 0.28 s |
| `race:countdown` 0 | `countdown.go` | player | 0 | v1 | v1: three-tone GO chord |
| `race:lap` (not the final lap) | `lap.chime` | player | 1 | v1 | v1 chime; the record flourish when `isRecord` |
| `race:lap` (the final lap begins) | `lap.final` | player | 1 | v1 | v1 fanfare; the music's lift starts (E) |
| `race:finish` | `finish.fanfare` | player | 1 | v1 | v1: the win variant for position 1 |
| `ship:boost` | `boost` | near | 1/2 | v1 | v1 noise sweep + rising saw |
| `ship:dash` | `dash` | near | 1/2 | v1 | v1 |
| `ship:draft` (active) | `draft.whoosh` | player | 3 | v1 | v1 band-pass whoosh |
| `ship:railHit` | `hit.rail` | near | 1/2 | v1 | v1 scrape level and impact thud (> 0.35, 0.15 s apart per ship) |
| `ship:shipHit` | `hit.ship` | near | 1/2 | v1 | v1 |
| `ship:pit` (active) | `pit.enter` | player | 1 | v1 | v1 two-tone; the hum is a continuous voice |
| `ship:lowEnergy` (and every 1.1 s below the threshold) | `alarm.energy` | player | 0 | v1 | v1 three 1,200 Hz pips |
| `ship:destroyed` | `ko` | near | 1/2 | v1 | v1 explosion |
| `ship:respawn` | `respawn` | player | 1 | M6 | a rising shimmer, 0.6 s (preset) |
| `ship:jump` | `jump.launch` | near | 1/2 | M6 | an air whoosh up, level × intensity (preset) |
| `ship:land` (intensity ≥ 0.15) | `jump.land` | near | 1/2 | M6 | a low thump with a short metal ring, level × intensity (preset) |
| `ship:ice` (active / inactive) | `ice.crackle` (continuous) | player | — | M6 | a crackling loop while the player is on ice, fade 80 ms in and 200 ms out |
| `ship:wind` (active) | `wind.gust` | player | 1 | M6 | a 1.2 s whoosh panned to `dir` (pan ±0.6) |
| `hazard:gate` | `gate.hit` | near | 1/2 | M6 | a stone crunch (preset) |
| `hazard:debris` | `debris.hit` | near | 1/2 | M6 | a metal clang (preset) |
| `hazard:mine` | `mine.blast` | near | 1/2 | v1 | v1 crack and boom |
| `hazard:lightning` | `lightning.hit` | near | 1/2 | M6 | an electric zap and crackle on the ship (preset) |
| `hazard:geyser` | `geyser.hit` | near | 1/2 | M6 (v1: `mine.blast`) | a scalding hiss and a thud (preset) |
| `hazard:jet` | `jet.hit` | near | 1/2 | M6 (v1: `mine.blast`) | a water blast and a knock (preset) |
| `item:use` shield / mine | `shield.up` / `mine.drop` | near | 1/2 | v1 | v1 |
| `item:emp` | `emp.fire` (at the firer), `emp.hit` (at the target) | near | 1/2 | v1 | v1 |
| `item:shield` | `shield.block` | near | 1/2 | v1 | v1 glassy crack |
| `item:warn` (target = player) | `alarm.emp` | player | 0 | v1 | v1 three fast pips |
| `item:fail` | `item.fail` | player | 1 | v1 | v1 buzz |
| `race:state` → `paused` / back | — | — | — | M6 | race sounds fade (D); the music muffles (C) |

**Sounds from the hazard timelines (no event; `RaceSounds.update` reads the built timelines at the hazard clock, like `HazardCue`):**

| Sound id | When | Who | Prio | What it sounds like |
|---|---|---|---|---|
| `mine.beep` | v1: the nearest armed mine within 70 m ahead; faster as it closes | player | 0 | v1 1,760 Hz pip |
| `gate.rumble` | a stone gate within 80 m ahead starts its closing warning (`gateWarning` > 0 after being 0) | player | 0 | a low stone grind, 1.2 s, panned to the gate's side |
| `lightning.charge` | the nearest strike point within 80 m ahead is in its warning (`strikeWarning` > 0, warning × `telegraphScale`) | player | 0 | a crackle that rises in pitch and level with the warning value (continuous voice) |
| `lightning.bolt` | any strike point within 120 m starts its strike | near (by distance) | 1 | a thunder crack, 1.5 s |
| `geyser.rumble` | the nearest vent within 80 m ahead is in its warning | player | 0 | a rising rumble (continuous voice) |
| `geyser.erupt` | a vent within 100 m starts its eruption | near | 1 | a roar, 1.2 s |
| `jet.hiss` | the nearest vent within 80 m ahead is in its warning | player | 0 | a building hiss (continuous voice) |
| `jet.fire` | a vent within 100 m fires | near | 1 | a whoomp, 0.8 s |

"Ahead" is `dot(point − player.position, player.velocity) > 0`, as v1's mine beep. The three telegraph voices are continuous voices (not in the pool) whose level and pitch follow the warning value 0..1 and stop at 0.

**Menu events (`MenuEvents` on `App.events` and the UI layer's events, `MenuSounds`, bus `ui` unless noted):**

| Event | Sound id | Prio | Since | What it sounds like |
|---|---|---|---|---|
| UI `move` (focus moved by `ui/nav.ts`) | `ui.move` | 3 | M6 | a soft short tick |
| UI `confirm` (a button clicked, by any input) | `ui.confirm` | 3 | M6 | a bright two-step blip |
| UI `back` (a `[data-back]` button) | `ui.back` | 3 | M6 | the confirm blip, falling |
| UI `slider` (a range input changed; at most every 60 ms) | `ui.slider` | 3 | M6 | a tick whose pitch follows the value |
| UI `tab` (a `[role="tab"]` clicked) | `ui.tab` | 3 | M6 | a paper-like swish |
| `ui:locked` | `ui.locked` | 3 | M6 | a dull double thunk |
| `shop:buy` (new) | `ui.buy` | 1 | M6 | a coin chime and a register ding |
| `shop:equip` (new) | `ui.equip` | 1 | M6 | a mechanical clunk-click |
| `shop:deny` (new) | `ui.deny` | 1 | M6 | a low soft buzz |
| `results:open` (new) | the result's stinger (§M6.3) on `music` | — | M6 | win / podium / finish / record / medal |
| `results:tally` | `ui.tally` | 1 | M6 | a tick, a little higher per line |
| `results:total` | `ui.coin` | 1 | M6 | a coin-shower chime |
| `results:unlock` | stinger `unlock` (queued) | — | M6 | |
| `results:trophy` | stinger `trophy` (queued; once per results screen) | — | M6 | |
| `results:medal` | stinger `medal-<medal>` (queued; replaces the finish stinger in a trial) | — | M6 | |
| `results:champion` | stinger `champion` (queued; first in the queue) | — | M6 | |
| `tutorial:step` | `ui.tutorial` | 1 | M6 | a soft two-note chime |
| `tutorial:done` | `ui.sparkle` | 1 | M6 | a short sparkle |

- **The stinger queue:** at most two stingers per results screen. The first is the one `results:open` picks; one more from unlock > trophy > medal, in that order (champion always goes first and pushes the position stinger out). A queued stinger starts 0.2 s after the one before ends. The results theme starts when the queue is empty.
- **UI sounds are rate-limited:** at most one UI sound per 40 ms; a confirm inside 40 ms of a move replaces it.
- **The touch race buttons** (boost, brake, item, steer) make no UI sound: their action has its own sound, and they already have the haptic tick.

### M6.3 The song table

Bars: 16 steps of 16th notes, 4/4. Length = bars × 240 / BPM. Every world song: an intro played once, then a loop; the lift layer runs with the loop and is heard only on the final lap. Instruments are ids from the shared set (§M6b, `dsp/instruments.ts`).

| Song id | Tempo, key | Intro + loop (bars → s) | Style; tracks and instruments | Final-lap lift (mono layer) |
|---|---|---|---|---|
| `neon-bay` | 118, A minor | 4 + 32 → 8.1 + 65.1 | Synthwave, as the sketch. Pads `saw-pad`; 16th arpeggio `square-arp`; octave 8th bass `saw-bass`; lead `saw-lead` with vibrato; drums `kick`, `snare-big` (long reverb), `hat`, `hat-open`. i–VI–III–VII (Am–F–C–G); sections A B A′ C (8 bars each) | A `pulse-lead` counter-melody an octave up; open hats on the off-beats |
| `sunset-mesa` | 124, D Dorian | 4 + 40 → 7.7 + 77.4 | Outrun. A driving 16th `saw-bass` that ducks on the kick; `pulse-lead`; `snare-gated`; brass-like `stab`; `hat`, `kick`. Dm–G–Am–C (the Dorian major IV) | Off-beat `stab` chords; a `ride` |
| `cryo-station` | 110, E minor | 4 + 32 → 8.7 + 69.8 | Chiptune-synth. `pulse-chip` leads (12.5% and 25% width); `tri-bass`; crushed noise drums (`kick-chip`, `snare-chip`, `hat-chip`); 32nd-note chip arpeggios on `pulse-chip`; `bell` sparkles on a long delay | A `pulse-chip` harmony a third above the lead; 16th `hat-chip` |
| `jade-ruins` | 128, G Phrygian | 8 + 40 → 15.0 + 75.0 | Tribal-synth. `tom-lo`/`tom-mid`/`tom-hi` pattern; `shaker`; `fm-bass`; a `pluck` ostinato that leans on the flat second (A♭); `breath-pad`; a `saw-lead` melody in the Phrygian mode | Double-time toms; a high `pluck` line |
| `orbital-ring` | 96, C Lydian | 4 + 32 → 10.0 + 80.0 | Ambient arpeggio. `kick-soft`; `rim`; no snare; slow `saw-pad` swells; a `bell` arpeggio on a long dotted delay; `sine-sub`; the Lydian ♯4 (F♯) in the arpeggio | A half-time `snare`; the `bell` arpeggio an octave up |
| `tempest-spire` | 132, F♯ minor | 4 + 40 → 7.3 + 72.7 | Dark synth. A driven 16th `saw-bass`; minor `stab`s; `clap`; thunder toms (`tom-lo` with a long reverb); a gliding `saw-lead` (portamento 60 ms) | A tremolo `saw-pad`; a `crash` at each 8-bar phrase |
| `cinder-forge` | 140, C Phrygian | 8 + 40 → 13.7 + 68.6 | Industrial synth. Driven `fm-bass`; metallic hits (`metal`); `anvil`; four-on-the-floor `kick`; a driven `saw-lead` | 16th `metal` ticks; the bass doubled an octave down |
| `abyss-line` | 104, D Mixolydian | 4 + 32 → 9.2 + 73.8 | Dreamy synth. Chorused `fm-epiano`; warm `saw-pad`; `sine-sub` and `tri-bass`; soft drums (`kick-soft`, `rim`, `shaker`); `blip` bubbles (sine with a pitch drop); a breathy `flute` lead | A `blip` arpeggio; a `shaker` |
| `menu` | 108, F major | 2 + 32 → 4.4 + 71.1 | Relaxed synthwave. It states **the MachZero motif** (below) in its first 4 loop bars. `saw-pad`, `fm-epiano`, `saw-bass`, `kick-soft`, `snare`, `hat`, `saw-lead` | none |
| `results` | 112, C major | 0 + 16 → 0 + 34.3 | Upbeat and bright; the motif in the lead. `square-arp`, `saw-pad`, `saw-bass`, `kick`, `clap`, `hat`, `pulse-lead` | none |

**The MachZero motif:** five notes, scale degrees 1 – 5 – 6 – 5 – 8, rhythm quarter, eighth, eighth, quarter, half (one 4/4 bar plus a held note). In F major: F4 C5 D5 C5 F5; in C major: C5 G5 A5 G5 C6.

**Stingers** (no loop; stereo; C major, so they lead into the results theme):

| Stinger id | Length | What it is |
|---|---|---|
| `win` | 3.0 s | The full motif on `saw-lead` and `pulse-lead` in octaves, a drum fill, a held C major chord with a `crash` |
| `podium` | 2.5 s | The motif on `pulse-lead`, lighter drums, a held chord |
| `finish` | 2.0 s | **Warm, never sad:** the motif slower on `fm-epiano`, ending on a bright C major add-9 chord. Plays for 4th place or lower, a KO, or a trial with no medal |
| `record` | 1.2 s | A quick rising run, then the motif's last two notes (G5 C6) on `bell`. A trial with a new best time and no new medal |
| `unlock` | 1.5 s | A rising `bell` arpeggio over two octaves and a shimmer |
| `trophy` | 1.2 s | The motif's first three notes on `bell`, a held chord |
| `medal-bronze` / `medal-silver` / `medal-gold` | 1.2 s each | The same figure starting on C5, E5 and G5, so the gold sounds highest |
| `champion` | 4.0 s | The full motif with a drum build, a key lift to D major for the last bar, and a long chord |

**Which stinger `results:open` picks** (`pickStinger(result: RaceResult)`, pure): a race: position 1 → `win`; 2–3 → `podium`; otherwise (or not finished) → `finish`. A trial: a medal reached that is better than the previous one → `medal-<medal>`, else a new best → `record`, else `finish`.

**What "good enough" means for a song** (the composer checks this before asking the owner; the owner's ear decides):
- The loop has a lead melody a child could hum: in at least half of its bars, within a range of 1.5 octaves, built from 2–4 bar phrases that repeat with variation.
- Two contrasting sections at least (A and B), and the loop's last bar leads back into its first.
- The world's feel in the first 8 bars (tempo, mode, its signature instrument).
- The drums leave space for the effects: no `crash` or `snare-big` more often than once per 2 bars.
- It passes the validator and the loudness test (M6b step 3).

### M6.4 The song data format

Songs are small TypeScript data files, one per song (`src/audio/songs/<id>.ts`), imported only by the Worker chunk.

```ts
// src/audio/songs/format.ts
export type SongId = 'neon-bay' | 'sunset-mesa' | 'cryo-station' | 'jade-ruins' | 'orbital-ring' | 'tempest-spire' | 'cinder-forge' | 'abyss-line' | 'menu' | 'results';
export type StingerId = 'win' | 'podium' | 'finish' | 'record' | 'unlock' | 'trophy' | 'medal-bronze' | 'medal-silver' | 'medal-gold' | 'champion';

export interface TrackDef {
  /** An instrument id from dsp/instruments.ts, with optional overrides of its parameters. */
  instrument: InstrumentId;
  params?: Partial<InstrumentParams>;
  gain: number;            // 0..1, linear
  pan?: number;            // −1..1 (the lift layer ignores it: mono)
  delay?: number;          // send 0..1
  reverb?: number;         // send 0..1
  /** Duck this track's gain on every hit of the named drum track (a sidechain pump): depth 0..1, release in s. */
  pump?: { by: string; depth: number; release: number };
  /** Rendered into the mono lift layer instead of the main mix. */
  lift?: boolean;
}

/**
 * A step string: one token per 16th note, separated by spaces; 16 tokens per bar; a pattern's tracks all have
 * the same number of bars. Tokens:
 *   .        rest (a held note keeps sounding through a rest only if followed by '-')
 *   -        hold: the previous note is still held through this step
 *   A3  C#4  a note (sharps only, C0..B8), velocity 0.8
 *   A3!      the same note accented (velocity 1)
 *   A3+C4+E4 a chord (at most 4 notes)
 *   x  X     a drum hit / an accented drum hit (drum instruments only)
 * Example (one bar): 'A3 - - - C4 - E4 . A4! . . . E4 - . .'
 */
export type StepString = string;

export interface SongDef {
  id: SongId | StingerId;
  title: string;           // shown in SOUND TEST, e.g. 'NEON BAY — "GRID RUNNER"'
  bpm: number;             // 80..160
  key: string;             // for people only, e.g. 'A minor'
  swing?: number;          // 0..0.3: the off-beat 16ths are delayed by swing × one step
  tracks: Record<string, TrackDef>;
  patterns: Record<string, Partial<Record<string, StepString>>>; // pattern name → track name → steps; a missing track rests
  intro: readonly string[]; // pattern names, played once (a stinger has only an intro)
  loop: readonly string[];  // pattern names, looped; [] for a stinger
  fx: {
    delay: { beats: number; feedback: number; tone: number }; // beats: 0.75 = a dotted 8th; tone: low-pass Hz
    reverb: { size: number; damp: number };                    // 0..1 each
  };
}
```

- **The validator** (`validateSong(def): string[]`, empty when valid) checks: every token parses; every note is inside its instrument's range (`InstrumentDef.range`, MIDI); drum tracks use only `x`, `X`, `.` and `-`; every pattern name in `intro` and `loop` exists; every track named in a pattern exists in `tracks`; within a pattern all tracks have the same number of bars; `bpm` in 80–160; a world song's loop lasts 60–80 s and its intro ≤ 8 bars; `results` loops 16 bars; a stinger lasts its table length ± 0.25 s; at most 24 voices sound at once (counted from each note's start to the end of its release); the song has at least one `lift: true` track when it is a world song and none otherwise.
- **The registry** `src/audio/songs/index.ts` maps each id to its def (Worker side). A small catalogue `src/audio/songs/catalog.ts` (`{ id, title, bpm, key, kind: 'world' | 'menu' | 'results' | 'stinger', worldId? }[]`, no notes) is the only song data in the main chunk.

### M6.5 Budgets

| What | Budget | How it is checked |
|---|---|---|
| Frame time | 60 fps at the device's preset; p95 ≤ baseline + 1 ms (Jade Ruins and Orbital Ring, 8 ships, every sound and the music on) | Device gates (M6b, M6d), the perf overlay (`?perf=1`) |
| Main-thread audio work | ≤ 0.3 ms p95 per frame (`RaceSounds.update` + queue drain + `MusicPlayer.tick`) | The perf overlay's new `audio` line; an e2e asserts p95 ≤ 1 ms on CI (SwiftShader) |
| Audio-thread work | ≤ 3% of one core on the devices | Proxy: `e2e/audio.perf.spec.ts` renders 30 s of the race graph (the song loop, the engine, 2 rival engines, ambience, crowd, 12 one-shots per s) in an `OfflineAudioContext` and reports the ratio in the PR; it fails above 10% on CI (that only catches a blow-up). On the devices: no crackle and the fps gate |
| Audio nodes alive | ≤ 150 | `AudioEngine.nodeCount` (every node created by audio code is counted and uncounted at `disconnect`); e2e reads it from `__machzero.audio()` in a race with every sound |
| Audio buffers held | ≤ 100 MB | `BufferCache` byte budget with LRU eviction (§M6b); e2e plays every song in SOUND TEST and reads the peak |
| Render time per song | ≤ 3 s on the iPhone and the iPad (in the Worker); ≤ 10 s on CI | SOUND TEST shows each render's time; a Node test renders every song and reports the time |
| SFX presets, ambience and crowd | ≤ 400 ms of Worker time on the devices; ≤ 3 MB for the presets; ambience and crowd mono, ≤ 12 s each | SOUND TEST shows it; Node test |
| Boot | Nothing new before the first frame: the Worker is created after the first rendered frame; the context still waits for the first input | Code review; a unit test that `new AudioEngine()` creates no Worker and no context |
| App JS | ≤ 25 KB gzip added by M6 in total, the Worker chunk included | `npm run size` (extend `check-size.mjs` to count the Worker chunk in app JS) |
| `public/game` | + 0 | `npm run size` |
| One-shot voices | 28 (v1) | The pool's test |

**Memory per song** (44.1 kHz, Float32): a loop of 80 s in stereo is 28.2 MB, its mono lift 14.1 MB, an intro of 15 s 5.3 MB. The cache holds at most: the playing song, the song being prepared, the results theme and the queued stingers while results are near, and the menu theme; anything else is evicted.

### M6.6 Warnings and their twins

| Warning sound | Visual twin | Haptic twin |
|---|---|---|
| `countdown.beep`, `countdown.go` | The 3-2-1-GO numbers | — |
| `alarm.emp` | "⚠ EMP INCOMING" on the HUD (**fixed in M6a**: shown even when the player carries no items) | iOS heavy tap (exists) |
| `alarm.energy` | The energy bar's low-energy flash (exists, `HUD.ts`) | — |
| `mine.beep` | The mine on the road; the hazard cue in colour-blind mode | — |
| `gate.rumble` | The gate closing; the hazard cue | — |
| `lightning.charge` | The glowing circle on the deck (X4); the hazard cue | — |
| `geyser.rumble` | The vent's glow (X5); the hazard cue | — |
| `jet.hiss` | The bubble stream (X6); the hazard cue | — |
| `item.fail` | The item chip (empty) | — |

---

### M6a — The audio graph and mixer, the SFX bank, the event-to-sound table, the menu and hazard sounds

**Design decisions:**
- **`src/audio/` replaces `src/game/AudioSystem.ts`.** The public surface the App and `RaceSession` use stays: `attach(bus)`, `detach()`, `update(ctx)`, `setVolumes(...)`, `muted`, `setMuted()`, `dispose()`. `game/index.ts` re-exports from `audio/` until every import has moved, then the re-export goes.
- **The files:**

  | File | What |
  |---|---|
  | `audio/AudioEngine.ts` | The context's life (create on first input, `audioSession`, unlock, suspend and resume with the 0.5 s fade, hidden → pause callback), the graph (§M6.1, or v1's graph with `music` off), the levels, mute, MONO, `nodeCount`, the duck (applied to the music bus from M6b). Owned by the App for the page's lifetime |
  | `audio/duck.ts` | Pure: `duckTarget(active: readonly DuckSource[]): { db: number; lowpassHz: number | null }` and the attack and release per source (§C) |
  | `audio/VoicePool.ts` | Pure allocation: `claim(priority, now): { slot } | { steal: slot } | null`, `release(slot)`; 28 slots |
  | `audio/soundTable.ts` | §M6.2 as data: `SOUND_RULES: readonly SoundRule[]` and `TIMELINE_SOUNDS` |
  | `audio/sfx/v1Sounds.ts` | v1's sound recipes moved verbatim: `tone()` and `noise()` calls per sound id, as functions `(out: SfxOut, g: number, …) => void` |
  | `audio/sfx/sfxr.ts` | Pure: `renderSfxr(p: SfxrParams, sampleRate: number): Float32Array` (jsfxr's synthesis with 8× oversampling: square, saw, sine, noise; attack, sustain, punch, decay; frequency slide and its delta; vibrato; duty sweep; low-pass with resonance and sweep; high-pass and sweep; arpeggio; repeat) |
  | `audio/sfx/presets.ts` | The M6 sounds as `SfxrParams` (or a small layered recipe of several sfxr layers), by sound id |
  | `audio/SfxBank.ts` | `play(id, opts: { gain, pan?, priority, bus })`: a v1 recipe or a rendered preset buffer; holds the preset buffers |
  | `audio/RaceSounds.ts` | Subscribes to one race's bus (the queue of decision F), the continuous voices (v1's engine, boost, wind, scrape, hum; the ice crackle; the three telegraphs), `update(ctx)` |
  | `audio/MenuSounds.ts` | Subscribes to `App.events` and the UI layer's sound events |
  | `audio/render/audio.worker.ts` | The Worker: renders the preset batch (M6b extends it to songs, stingers and ambience) |
  | `audio/render/RenderClient.ts` | Main-thread side of the Worker: `request(kind, ids): Promise<Rendered>`; the main-thread fallback |
  | `ui/uiSounds.ts` | Dispatches the UI sound events from the DOM (step 7) |
  | `ui/screens/SoundTest.tsx` | SOUND TEST (effects only in M6a) |

- **The Worker** is created with `new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' })` (Vite's pattern; it becomes its own chunk), after the first rendered frame, only with `music` on. It renders every preset once (44.1 kHz, mono) and posts the Float32Arrays back as transferables. **Fallback:** if `new Worker` throws, `error` fires, or there is no answer within 10 s, `RenderClient` renders the presets on the main thread, one preset per `setTimeout(0)` slice (each ≤ 20 ms on a phone), and warns once. A preset that is not rendered yet plays nothing.
- **New `MenuEvents`:** `'shop:buy': { slot: PartSlot | 'item' }`, `'shop:equip': { slot: PartSlot }`, `'shop:deny': Record<string, never>`, `'results:open': { mode: 'tour' | 'cup' | 'trial'; position: number | null; medal: Medal | null; previousMedal: Medal | null; best: boolean }`. `App.buyPart` emits `shop:buy` on `'bought'` and `shop:deny` on `'short'`; `App.buyItem` the same on `'bought'` / `'short'`; `App.equipPart` emits `shop:equip` on success. The results screen (and the HUD results panel) emits `results:open` when it appears.
- **`FrameContext.telegraphScale: number`** (new, from `RaceSession`'s `setup.hazards.telegraphScale`, 1 when absent).
- **The EMP warning fix:** `ItemSystem` gains `incomingAtPlayer(): number` (seconds until the nearest CPU EMP lands on the player, 0 when none), and `HUD.setItems` takes it apart from the item view, so the warning shows even when `playerView()` is null.
- **With `music` off** M6a changes nothing audible (K); the golden test proves it.

**Build steps (tests first):**
1. **The fake context and the golden test** (before any code moves).
   - `src/audio/__tests__/fakeAudio.ts`: a `FakeAudioContext` with the subset audio code uses (`createGain`, `createOscillator`, `createBiquadFilter`, `createBufferSource`, `createBuffer`, `createDynamicsCompressor`, `createStereoPanner`, `createDelay`, `createWaveShaper`, `destination`, `currentTime` (settable), `state`, `resume`, `suspend`, `close`). Every node gets an id; the fake records every `create*`, `connect`, `disconnect`, property set, `AudioParam` call (with value and time), `start` and `stop` into a log. `onended` can be fired by the test.
   - `src/audio/__tests__/v1Golden.test.ts`: a scripted race against v1's `AudioSystem` (a minimal `window` stub provides `AudioContext = FakeAudioContext` and captures the unlock handler; `Math.random` is a seeded LCG): unlock; 40 `update()` frames with set speeds, throttle, boost, the pit, low energy and two armed mines; then every v1 event once (countdown 3–0, boost, dash, draft, rail hits at 0.2 and 0.8, a ship hit, an EMP, a mine, a geyser, a jet, shield up, mine drop, a shield block, a warn, a fail, the pit, low energy, a KO, a lap, the final lap, a winning finish), each followed by one `update()`; then `detach()`. Record the log to `v1-golden.json` (`UPDATE_GOLDEN=1`) **on today's code**, and commit it.
   - The same test then runs against the new `AudioEngine` + `RaceSounds` with `music` off and expects the same log. It must pass at every later step.
2. **Pure parts, tests first:**
   - `duck.test.ts`: each source alone gives its row of §C; countdown and pause together give −12 dB and the low-pass (the deepest wins); none gives 0 dB and no low-pass.
   - `VoicePool.test.ts`: 28 claims succeed; the 29th at priority 1 steals the oldest priority-3 voice; with all 28 at priority 0 a priority-0 claim fails; a release frees the slot; ties steal the oldest.
   - `soundTable.test.ts`: every `GameEvents` key and every `MenuEvents` key is either in the table or in the explicit `SILENT_EVENTS` list (`race:state`, `race:results`, `economy:credits`, `audio:mute`), so a new event cannot be forgotten; every sound id in the table exists in `v1Sounds` or `presets`; every priority-0 sound has a row in §M6.6's twin table (`WARNING_TWINS` in the same file).
   - `sfxr.test.ts`: every preset renders a non-silent buffer (peak > 0.05), peak ≤ 1, its length matches its envelope, and no NaN; the same params give the same samples (the noise is seeded); the whole batch renders in ≤ 2 s in Node (it reports the time).
3. **`AudioEngine`** with the graph of §M6.1 and v1's graph for `music` off (tests against the fake: the node chain, the levels per slider, mute, MONO inserts and removes the mono node and zeroes the pans, a slider change ramps with τ = 20 ms, `nodeCount` rises and falls). The platform rules of I: `audioSession` set before the context with `music` on; hidden → the pause callback (the App passes `() => session.pause(true)` when racing or counting down) and `suspend`; visible → `resume` and the 0.5 s master ramp; still not running → the unlock listeners return.
4. **The move:** `RaceSounds` and `SfxBank` take v1's code (the golden test stays green); `App` and `RaceSession` import from `audio/`; `game/AudioSystem.ts` is deleted, `game/index.ts` re-exports nothing audio. The queue of decision F lands here.
5. **The new race sounds** (behind `music`): the M6 rows of §M6.2, the timeline sounds (tests with a fake track and clock: a strike point 60 m ahead in its warning starts `lightning.charge`; behind the player, nothing; at 90 m, nothing; the voice follows the warning value; `telegraphScale` 2 doubles the warning window), the panning of G for one-shots (a ship 15 m to the right gives pan 0.5; MONO gives 0), the priorities.
6. **Presets:** write the M6 sounds in `presets.ts`; the Worker and `RenderClient` with the fallback (a unit test with a fake Worker that never answers falls back after 10 s of fake time; one that throws falls back at once).
7. **Menu sounds:**
   - `ui/nav.ts`'s `move()` dispatches `new CustomEvent('mz-ui-sound', { bubbles: true, detail: { kind: 'move' } })` on the newly focused element when focus changes.
   - `ui/uiSounds.ts` (`bindUiSounds(root: HTMLElement, emit: (kind: UiSoundKind) => void): () => void`), bound by the App on `els.ui` and `els.hud`: `mz-ui-sound` → its kind; a `click` on a `button` → `back` if it is `[data-back]` or inside one, `tab` if `[role="tab"]`, else `confirm`; `input` on `input[type=range]` → `slider` (60 ms apart); elements inside `.mz-touch` (the race buttons) are ignored. The rate limit of §M6.2.
   - `MenuSounds` plays them, plus the menu events, `shop:*`, the results ticks and the tutorial chimes. The stingers of `results:open` and the queue arrive in M6c (M6a's `results:open` plays nothing yet).
   - Tests: `uiSounds.test.ts` with a small DOM stub (or happy-dom if already a dependency; otherwise the stub style of `nav.test.ts`): a click on a `[data-back]` gives `back`; a move gives `move`; a slider dragged through 10 values in 100 ms gives at most 2 sounds.
8. **The EMP warning fix** (not behind the flag: it is a HUD fix): `ItemSystem.incomingAtPlayer()`, `HUD.setItems(view, incoming)`; tests in `ItemSystem.test.ts` and `HUD.test.ts` (no bag, a CPU EMP in flight → the warning shows; it hides when it lands).
9. **Settings:** `settings.mono` (default false) in `schema.ts` and `sanitizeSettings` (a test: a v9 save without `mono` loads with false); Settings → Sound gains MONO (behind `music`) and SOUND TEST (behind `music`).
10. **SOUND TEST** (`ui/screens/SoundTest.tsx`, route `{ name: 'soundtest' }`, back → Settings): sections RACE, HAZARDS, MENUS (every sound id of §M6.2 with its name and a PLAY button), and the preset render time and size. `?jukebox=1` (read in `readUrlFlags`) opens it as soon as a profile is active; before the context runs it shows "TAP TO START SOUND". Pad, keyboard and touch (the 44-point rule).
11. **The debug hook:** `__machzero.audio()` returns `{ state, nodes, voices, bufferBytes, presetsMs, played: string[] }` (`played`: the last 64 sound ids, for the e2e).
12. **e2e:**
    - `e2e/audio.spec.ts` (`?features=music&debug=1`, Playwright clicks once to unlock): menus by keyboard play `ui.move` and `ui.confirm` (read from `played`); a purchase with too few credits plays `ui.deny`; an autopilot race on Tempest Spire (`?features=music,expansion`) plays `lightning.charge` and `lightning.bolt`; no console errors and no `pageerror`; `nodes` stays ≤ 150.
    - The existing specs run unchanged (they run with `music` off).
    - `e2e/settings.spec.ts` (or the existing settings test): MONO and the three sliders persist across a reload.

**Done when:**
- [ ] The golden test passes: with `music` off the graph and every sound are v1's.
- [ ] Every event is in the table or in `SILENT_EVENTS`; every sound id exists; every warning has its twin.
- [ ] With `?features=music`: every sound in §M6.2 plays in SOUND TEST and in a race; geysers and jets have their own sounds; the three telegraphs follow the warnings; Rookie races telegraph twice as long.
- [ ] The EMP warning shows with no items.
- [ ] The Worker renders the presets after the first frame, with the fallback tested; nothing waits on it.
- [ ] Ducking is not wired yet (no music); the duck table is tested.
- [ ] App JS ≤ +8 KB gzip for this PR.

**Device check (the owner, both devices, `VITE_FEATURES=music,expansion`):**
- **First, the baseline:** on the build before M6 (today's `main`), read the perf overlay's frame time p95 in an 8-ship race on Jade Ruins and on Orbital Ring, on each device, and post the four numbers on the PR. Every later gate compares with them.
- Listen to the new effects in SOUND TEST and in races on Tempest Spire, Cinder Forge and Abyss Line; say which (if any) to rework.
- The ringer switch on silent: no sound. On sound: sound.
- AirPods: sound follows them; disconnecting them mid-race does not stop the sound.
- Background the app mid-race and come back: the race is on the pause menu, and the sound fades in.
- Menus by pad and by touch make the same sounds.

**As built (2026-11-24, branch `v2/m6a-audio-graph`, PR #@@PR@@)** (read before M6b):
- **Where things are.** `src/audio/`:
  - `AudioSystem.ts` is the App's one audio object, a facade not in the file table above. It keeps v1's surface (`attach`, `detach`, `update`, `setVolumes(master, effects, music)`, `muted`, `setMuted`, `dispose`) and adds `setMono`, `onHidden`, `bindMenus`, `uiSound`, `test` (SOUND TEST), `startRendering` and `debug`. `App.audio` is public, for SOUND TEST.
  - Beneath it: `AudioEngine` (the context and the graph), `SfxBank`, `RaceSounds`, `MenuSounds` and `render/RenderClient` with `render/audio.worker.ts`.
  - `game/AudioSystem.ts` is deleted and `game/index.ts` exports nothing audio.
- **The golden log** (`audio/__tests__/v1-golden.json`, about 2,270 lines) was recorded on v1's code in the first commit, before anything moved.
  - The script: 40 frames, every v1 event, a burst past the 28-voice cap, levels, mute, hide and show.
  - It plays against `new AudioSystem({ modern: false })` (`goldenSubjects.ts`); v1's class was a second subject until step 4 deleted it.
  - It has never been re-recorded.
- **Decision F as built.** `RaceSounds` queues `{ type, e, prio }` per event and drains the queue at the top of `update`, before v1's own checks, so with `music` off the Web Audio calls come in v1's order. A test proves that an emit builds no node.
- **Presets.**
  - `sfx/presetMeta.ts` holds the ids and playback levels, the only preset data the page carries. `sfx/presets.ts` holds the recipes, which only the Worker and the main-thread fallback (a lazy chunk, `import('../sfx/presets')`) load. A test checks that both files name the same presets.
  - There are 30 presets, rendered at 44.1 kHz in 355 ms in Node and about 350 ms in the Worker in headless Chromium, 2.86 MB in all (under the 3 MB budget only after the envelopes were cut to §M6.2's lengths: the first pass was 3.63 MB).
  - The four continuous voices (`ice.crackle` and the three telegraphs) are loops folded with an 80 ms crossfade.
- **Telegraphs.** They are on/off-flagged voices (an `AudioParam.value` read never reaches 0 after `setTargetAtTime`), and each start records its id in `played`.
- **Menu sounds.**
  - `ui/uiSounds.ts` ignores `.mz-touch-layer` (the doc said `.mz-touch`; that class is set on `<html>` after a touch).
  - "A confirm inside 40 ms of a move replaces it" is built as: the confirm (or back, or tab) still plays, and the move tick (about 20 ms) is not cut.
  - `results:open` is emitted by the results screen on mount, and by the App for the HUD results panel (the no-menu flows).
- **The EMP warning.** `ItemSystem.incomingAtPlayer()`; `HUD.setItems(view, incoming = view?.incoming ?? 0)`, so older callers still work.
- **FrameContext.telegraphScale** is required, since only `RaceSession` and the golden test build a `FrameContext`.
- **SOUND TEST:**
  - It is route `{ name: 'soundtest', back }` (`App.openSoundTest` / `closeSoundTest`), and lists `SOUND_GROUPS` (`soundTable.ts`), which a test holds to every sound in the table.
  - `?jukebox=1` (`UrlFlags.jukebox`) opens it once a profile is active.
  - MONO and the SOUND TEST button sit in Settings → Sound, behind `music`.
- **Not built here.** The perf overlay's `audio` line (§M6.5) is not among M6a's steps; it goes to M6b, where `MusicPlayer.tick` joins the measured work.
- **API facts** (Context7 was not available in this session either; web search):
  - `StereoPannerNode` is in Safari from 14.1 (iOS 14.5); `channelCountMode` and `WaveShaperNode.oversample` from Safari 6–7.
  - The default `audioSession` type behaves as `ambient` on iOS, so the explicit `ambient` changes nothing by default and keeps the ringer switch obeyed if the default changes.
  - A WebKit report says WKWebView loads no *service* workers from a custom URL scheme (`capacitor://`). Whether dedicated module workers are affected is not documented, so the iOS device check reads `presetsBy` in SOUND TEST ("background" or "main thread"); either way the sounds play.
- **Size:** app JS @@SIZE@@.

---

### M6b — The synthesiser, the render Worker, the music player, and the first three songs (style approval)

**Design decisions:**
- **The DSP** (`src/audio/dsp/`, pure TypeScript, no DOM, no Web Audio): all processing in blocks of 128 samples at 44.1 kHz, Float32. Noise comes from a seeded generator (the song id is the seed), so a render is deterministic.

  | File | What |
  |---|---|
  | `dsp/osc.ts` | polyBLEP saw and pulse (width 0.05–0.95, PWM by an LFO), triangle (integrated pulse), sine, white and pink noise |
  | `dsp/filter.ts` | TPT state-variable filter (low-pass, band-pass, high-pass; cutoff and resonance per block, smoothed) |
  | `dsp/env.ts` | ADSR with linear attack and exponential decay and release; a pitch envelope |
  | `dsp/fm.ts` | two-operator FM (ratio, index with its own envelope) |
  | `dsp/drums.ts` | kick (sine with a pitch drop and a click), snares (noise + body tone), clap (3 noise bursts + a tail), hats (6 square partials + high-pass, as the 808), toms, rim, shaker, ride and crash (FM metal + noise), `metal` and `anvil` (inharmonic FM), the `-chip` variants (a bit crusher on the drum) |
  | `dsp/effects.ts` | a stereo tempo-synced delay with feedback and a low-pass in the loop; a reverb (4 parallel combs and 2 all-passes per channel, Freeverb-style, with size and damping); chorus (two modulated short delays); drive (tanh with a gain); bit crush (bits and a sample-hold rate); the sidechain pump |
  | `dsp/instruments.ts` | `INSTRUMENTS: Record<InstrumentId, InstrumentDef>`: each instrument's voice recipe, its parameters (`InstrumentParams`) and its MIDI `range`. Ids: `saw-pad`, `saw-lead`, `pulse-lead`, `square-arp`, `saw-bass`, `fm-bass`, `tri-bass`, `pulse-chip`, `bell`, `fm-epiano`, `pluck`, `stab`, `breath-pad`, `flute`, `sine-sub`, `blip`, and the drums `kick`, `kick-soft`, `kick-chip`, `snare`, `snare-big`, `snare-gated`, `snare-chip`, `clap`, `hat`, `hat-open`, `hat-chip`, `ride`, `crash`, `rim`, `shaker`, `tom-lo`, `tom-mid`, `tom-hi`, `metal`, `anvil` |
  | `dsp/sequence.ts` | Parses step strings into note events (`{ time, midi, velocity, length, track }`), applies swing, counts voices |
  | `dsp/render.ts` | `renderSong(def: SongDef): RenderedSong` |
  | `dsp/loudness.ts` | BS.1770 integrated loudness (K-weighting, 400 ms blocks, the −70 LUFS absolute and −10 LU relative gates) and the true-peak estimate (4× oversampled) |

- **`renderSong`** returns `{ intro: [L, R] | null, loop: [L, R], lift: Float32Array | null, bpm, introBars, loopBars, renderMs }`:
  - It renders the intro, then the loop, then 4 s more of the loop's tails (notes still ringing, delay and reverb). The tail past the loop's end is **added onto the loop's start**, so the loop is seamless (the delay and reverb are linear, and every non-linear step — drive, crush — is inside a voice, so this is exact).
  - The intro's own tail runs into the loop's first seconds (the loop buffer starts right after the intro at playback).
  - `lift: true` tracks go to a separate mono accumulator with their own delay and reverb sends (mono), folded the same way.
  - Normalisation: one gain for intro, loop and lift together, so that the loop measures −14 LUFS and no sample exceeds −1 dBFS (if the peak limits it, the loudness may end lower; the test allows −14 ± 1 LUFS).
  - A stinger renders only its intro plus a 2 s tail, normalised the same way.
- **The Worker** (`audio/render/audio.worker.ts`, M6a's Worker grown): requests `{ id, kind: 'song' | 'stinger' | 'presets' | 'ambience', ids }`; answers with transferable Float32Arrays, or `{ id, ok: false, error }`. One request at a time; a newer song request for the same purpose cancels a queued one.
- **`BufferCache`** (`audio/BufferCache.ts`, pure bookkeeping plus `AudioBuffer` creation): entries by id with their bytes; `pin(id)` and `unpin(id)`; `put` evicts the least recently used unpinned entries until the total fits 100 MB.
- **`MusicDirector`** (`audio/MusicDirector.ts`, pure): input `{ route: Route['name']; worldId: WorldId | null; race: RaceState | null; intro: boolean; playerLap: number; playerFinished: boolean; resultsOpen: boolean; paused: boolean }` → output `{ song: SongId | null; fromIntro: boolean; lift: boolean; muffle: boolean; fadeOut: number; fadeIn: number }`. Its tests are the rows of §E's table.
- **`MusicPlayer`** (`audio/MusicPlayer.ts`): applies the director's output.
  - `play(song)`: the intro source starts at `t0 = ac.currentTime + 0.05` and the loop source (`loop = true`) and the lift source (gain 0) both start exactly at `t0 + introSeconds`, so they stay sample-locked (same length).
  - `setLift(true)`: the next bar line is `tLoop + ceil((now − tLoop) / bar) × bar`; the lift's gain ramps from 0 to 1 linearly over one bar from there.
  - Crossfade: the old song's gain ramps to 0 over `fadeOut`, then its sources stop and disconnect; the new one rises over `fadeIn`.
  - The duck and the pause muffle (§C) act on the song gain and the music low-pass.
  - A song not yet in the cache: request it; play when it lands, if still wanted.
  - **Prefetch:** when the backdrop session's world changes, prepare that world's song; at the player's final lap, prepare `results` and the stingers that `pickStinger` may need (all ten are small: render them together, 21 s of audio); when the results screen closes toward the menus, prepare `menu` if it was evicted.
- **SOUND TEST** gains SONGS (each with PLAY, STOP, LIFT on or off, JUMP TO LOOP; it shows the tempo, key, length, render time, MB and the loudness measured live) and STINGERS (PLAY). Playing a song from SOUND TEST stops the menu theme; leaving SOUND TEST gives it back.
- **The first three songs:** `menu`, `neon-bay`, `orbital-ring` (§M6.3). Their PR body asks the owner for **the style approval**: the sound of the instruments, the mix, and the songs. M6c starts only after it.

**Build steps (tests first):**
1. **DSP unit tests** (`audio/dsp/__tests__/`): a 440 Hz saw has its fundamental at 440 Hz (zero crossings over 1 s, ±1 Hz) and less aliasing than a naive saw (energy above 15 kHz at least 20 dB lower for a 3 kHz saw); the SVF low-pass at 1 kHz passes 100 Hz within 0.5 dB and cuts 10 kHz by more than 30 dB; an ADSR reaches its sustain level and ends at 0 after its release; the delay repeats an impulse at the beat time with the feedback ratio; the reverb's tail decays below −60 dB within 3 s at size 0.5; a drum hit is non-silent and ends within its length; every instrument renders its range's lowest and highest notes without NaN or a peak above 1.
2. **Sequence tests:** a one-bar string with 4 notes gives 4 events at the right times at 120 BPM (step 0.125 s); `-` extends a note's length; a chord gives 3 events; swing 0.2 moves only the odd 16ths, by 0.2 steps; an accent gives velocity 1; a bad token is an error naming the pattern, track and step.
3. **Song tests** (`audio/songs/__tests__/songs.test.ts`, every song and stinger in the registry): `validateSong` returns no errors; `renderSong` gives non-silent audio; the loop measures −14 ± 1 LUFS and peaks ≤ −1 dBFS; **the loop is seamless** (render the loop twice in a row as one buffer; the folded loop equals the second pass within 1e-4); the lift is silent outside lift tracks and non-silent on world songs; two renders give identical samples; each render's time is printed, and each is ≤ 10 s on CI.
4. **`BufferCache` tests:** put 3 songs of 40 MB → the oldest unpinned is evicted; a pinned entry is never evicted; the total never exceeds 100 MB after a put.
5. **`MusicDirector` tests:** one per row of §E (menu → menu theme; race with the grid card → the world song from its intro; final lap → lift; finish → fade out 1.5 s; results open → song null until the stingers end, then `results`; pause → muffle; back to menus → `menu` with a 1.0 s crossfade; a restart → the world song from its intro).
6. **`MusicPlayer` against the fake context:** the three sources start at the right times; `setLift` starts its ramp on the next bar line; a crossfade ramps both gains and stops the old sources after the fade; the duck values reach the song gain.
7. **The App wiring:** an `effect()` over the route, the session state, the profile's world and the results screen feeds the director; `RaceSounds` forwards the player's lap and finish to it; the music bus is used only with `music` on.
8. **The three songs**, composed to §M6.3 and the "good enough" rules, each passing step 3.
9. **SOUND TEST's SONGS and STINGERS sections** (stingers empty until M6c except as placeholders).
10. **e2e** (`e2e/audio.spec.ts` grows; `?features=music&debug=1`): the menu theme starts after the first click (`__machzero.audio().song === 'menu'`); a race on Neon Bay switches to `neon-bay`, and the final lap sets `lift` (autopilot); SOUND TEST plays each of the three songs; `bufferBytes` ≤ 100 MB throughout; no console errors.
11. **`e2e/audio.perf.spec.ts`:** the offline proxy of §M6.5, with the result printed.

**Done when:**
- [ ] The three songs render, pass every song test, and play in SOUND TEST and in the game, with the lift on the final lap.
- [ ] Every scene change of §E behaves as its row (director tests and e2e), with no click (no gain jump in the fake's log).
- [ ] Render times printed on CI; memory ≤ 100 MB.
- [ ] App JS ≤ +12 KB gzip for this PR (the songs are in the Worker chunk, which counts).

**Device check (both devices, `VITE_FEATURES=music`):**
- The render time of each of the three songs, as SOUND TEST shows it: ≤ 3 s.
- Frame time p95 in an 8-ship race on Neon Bay and on Orbital Ring with the music: ≤ baseline + 1 ms.
- No crackle during a race, in the menus or in SOUND TEST.
- **The style approval:** listen to `menu`, `neon-bay` and `orbital-ring` in SOUND TEST (with and without the lift) and in a race. Tick each line of the PR's checklist, or write REWORK and what to change. A rejected song is reworked in a follow-up commit on the same PR; a rejected *style* (the instruments or the mix) is reworked before M6c.

---

### M6c — The other six world songs, the results theme and the stingers

**Design decisions:**
- **The songs:** `sunset-mesa`, `cryo-station`, `jade-ruins`, `tempest-spire`, `cinder-forge`, `abyss-line`, and `results` (§M6.3), in the style the owner approved in M6b, with any change the approval asked for applied to every song.
- **The stingers** (§M6.3) and `pickStinger`; the stinger queue of §M6.2 in `MenuSounds`; the stinger duck (§C).
- **The 2.1 worlds' songs play only when `expansion` shows those worlds**; SOUND TEST lists all ten songs regardless.

**Build steps (tests first):**
1. `pickStinger` tests (every case of §M6.3) and stinger-queue tests (a win with an unlock and a trophy → `win`, then `unlock`; a champion → `champion` first; a trial with a gold medal → `medal-gold`; a trial with a new best and no new medal → `record`).
2. The six world songs and `results`, each passing the song tests (M6b step 3).
3. The ten stingers, each passing the song tests (stinger length ± 0.25 s).
4. The results flow: `results:open` plays the stinger; the queue; the results theme after the queue (director and e2e).
5. e2e: an autopilot World Tour race to the results with `?features=music` plays a stinger, then `results`; SOUND TEST plays all ten songs and ten stingers with `bufferBytes` ≤ 100 MB.

**Done when:**
- [ ] All ten songs and ten stingers pass the song tests and play in SOUND TEST.
- [ ] Every results screen (Tour, cup, trial, the season's end) plays the right stinger, then the results theme.
- [ ] App JS ≤ +4 KB gzip for this PR.

**Owner:** listen to each song (and its lift) and each stinger on the iPhone; tick each line of the PR's checklist or write REWORK. Render times of the six new songs on both devices, from SOUND TEST (≤ 3 s each).

---

### M6d — Engine voices, rival engines, ambience, the crowd, the echo, the mix pass; `music` on

**Design decisions:**
- **Engine voices per class** (the player's engine; v1's voice is Balanced, exactly):

  | Class | Pitch | Layers | Filter | Other |
  |---|---|---|---|---|
  | Light | v1's frequency × 1.335 (+5 semitones) | two saws (0 and +14 cents); no sub square | v1's cutoff × 1.15; Q 5 | — |
  | Balanced | v1 | v1 (saw 0.5, saw +14 c 0.4, square −1 octave 0.32) | v1 (Q 3.5) | — |
  | Heavy | v1's frequency × 0.794 (−4 semitones) | v1's two saws, the sub square at 0.55 | v1's cutoff × 0.9; Q 3 | a `WaveShaper` drive (tanh, gain 2) after the filter |

  Boost keeps v1's octave saw on every class. The Aero slot changes no sound.
- **Rival engines:** two pooled voices (each: a saw, a square −1 octave, a low-pass, a gain, a `StereoPannerNode`) for the two nearest rivals within 60 m (not ghosts). Pitch from the rival's speed and class as above; gain `nearness() × 0.6`; pan per G; a Doppler shift of `1 + clamp(closingSpeed / 340, −0.06, 0.06)`. When the nearest pair changes, the voice that changes ship fades out in 150 ms and in again on the new ship.
- **Ambience** (rendered in the Worker when the world is selected; mono, 8–12 s, seamless by the same fold as the songs; the M6b synthesiser):

  | World | Ambience |
  |---|---|
  | Neon Bay | A low city hum and slow sea waves (filtered noise swells, 8 s) |
  | Sunset Mesa | Desert wind (band-passed noise sweeping slowly) |
  | Cryo Station | The station's hum (60 Hz and harmonics) and an icy whistle |
  | Jade Ruins | Insects (amplitude-modulated noise bands) and sparse bird chirps |
  | Orbital Ring | A very low drone and soft radio blips |
  | Tempest Spire | Rain (high-passed noise) and distant thunder rolls |
  | Cinder Forge | A lava rumble (noise low-passed at 150 Hz), crackles, far metal clanks |
  | Abyss Line | Underwater (noise low-passed at 400 Hz), slow swells, bubbles |

  - Level: the ambience bus × `speedFade`, which is 1 up to 100 km/h (27.8 m/s) and falls linearly in dB to −12 dB at `CONFIG.TOP_SPEED`; time constant 0.3 s. Off in the menus (`title`) and while paused; on from the countdown.
- **The crowd:** a mono loop (many band-passed noise voices with slow random swells), gain by the player's distance along the track to the start line: 1 within 30 m, falling to 0 at 150 m. A cheer (+6 dB over 1 s, back over 2 s) at GO and when the player finishes.
- **The echo:** while the player is inside a closed pipe or Spine stretch (`track.pipes` / `track.spines`, `uClosedStart..uClosedEnd`), the echo send (§M6.1) rises to 0.35 over 0.2 s; it falls over 0.4 s on the way out. The player's engine and the one-shots feed it.
- **The mix pass:** the levels of every sound against the music at the default sliders, on both devices' speakers and on AirPods; the loudness meter (below) reads −18 ± 2 LUFS over a race on Neon Bay at the default sliders.
- **The loudness meter:** with `?perf=1` the perf overlay shows short-term loudness (3 s) and the race's integrated loudness, from a tap on the master (a high-shelf of +4 dB at 1.5 kHz and a high-pass at 38 Hz approximate the K-weighting; an `AnalyserNode` gives the RMS). It is created only with the perf overlay.
- **`music` turns on in its own commit**, so it can be reverted alone. **A second commit removes the flag** (`FEATURE_NAMES` becomes `expansion`; an old link with `music` still loads) **and v1's graph path**; the golden test is then deleted (its job is done), and the SOUND TEST and MONO settings lose their flag checks. SOUND TEST stays in the game.

**Build steps (tests first):**
1. Engine voice tests against the fake (each class's frequencies and layers at a set speed; Balanced's log equals v1's).
2. Rival voice tests: the two nearest within 60 m get the voices; a ghost never does; the hand-over fades; pan and Doppler values.
3. Ambience tests: each world's loop renders non-silent, ≤ 12 s, seamless; `speedFade` at 0, 27.8 m/s and top speed gives 0, 0 and −12 dB.
4. Crowd and echo tests (distance gains; the echo send inside a pipe stretch of a fake track).
5. The mix pass (levels in `audio/mixLevels.ts`, one table, so later tuning is one file).
6. `music` on; then the flag and the v1 path removed; `npm run codebase`; README and TDD §8 audio notes updated.
7. e2e: an 8-ship autopilot race on Jade Ruins and one on Orbital Ring with every sound: `nodes` ≤ 150; the `audio` line's p95 ≤ 1 ms on CI; no console errors.

**Done when:**
- [ ] The three engine voices and the rival voices play; ambience on all 8 worlds; the crowd; the echo.
- [ ] The full SPEC §8.7 list holds.
- [ ] `music` is on, then removed as a flag; every existing test passes.
- [ ] App JS: M6 in total ≤ +25 KB gzip; `public/game` + 0.

**The device gate (both devices, `VITE_FEATURES=expansion`):**
- **fps:** an 8-ship race on Jade Ruins and on Orbital Ring at the device's preset, with the music and every sound: 60 fps, p95 ≤ the M6a baseline + 1 ms.
- **The ringer switch**, **AirPods**, **background and resume**, as in M6a.
- **A race by pad only** and **a race by touch only**: every menu sound, the race sounds, the results stinger.
- **The listening approval of the sound set as a whole:** the engine voices (a race in each class), the ambience of each world, the crowd, the echo, and the mix of music and effects on the speakers and on AirPods. Say what to change; a change is a follow-up commit before the merge.
- **The merge.**

---

## M7 — Touch, tilt, assists and comfort — ✅ DONE (PRs #41 M7a, #42 M7b, #43 M7c; shipped in MachZero 2.0, M8d)

SPEC §11 says what and why. This section is the how. **Design decisions (design interview with the owner, 2026-11-16; settled, don't re-open)** are listed per PR below. M7 makes MachZero playable with fingers alone on the iPhone and the iPad, and makes the four player assists real.

**Three PRs, in build order, each stacked on the one before (the first on the newest open stack branch):**

| # | PR | Branch | Save | Flag | Needs from the owner |
|---|---|---|---|---|---|
| M7a ✅ built (#41) | The four assists work, and the assists screen | `v2/m7a-assists` | v7 → v8 | none (it repairs a promise the live game already makes) | Device check with the pad |
| M7b ✅ built (#42) | Touch driving and the touch HUD | `v2/m7b-touch` | — | behind `touch` | Device gate (fps); **the owner picks the default air-brake style** |
| M7c ✅ built | Tilt, menus by touch, comfort settings, pad remapping; `touch` turns on | `v2/m7c-comfort` | — | `touch` → on | Device gate: tilt on the pipe and the Spine, the Storm Cup by touch, menus by touch |

**Facts checked on 2026-11-16 (`v2/x6-abyss-line`), so the builder does not rediscover them:**
- **The assists do nothing in the live game.** `physics/Assists.ts` (`PlayerAssists`) is used only by `sim/worldRace.ts`. `App` and `RaceSession` never apply it. `Assists.noKO` and `Assists.earlyBoost` exist in the save and have no code. The "I'M NEW TO RACING GAMES" preset (`ProfileSelect.tsx`) promises all four.
- **No touch input exists.** `InputManager` reads the keyboard and one gamepad. `InputDevice` is `'keyboard' | 'pad'`. The menus are plain buttons, so taps already work there. The Garage turntable already orbits on a pointer drag (`Garage.tsx`), and zooms only on the wheel.
- **The HUD sits where thumbs go.** At 956 × 440 (iPhone landscape) and 1180 × 820 (iPad landscape) the power bar (`.mz-energy`) and the boost panel (`.mz-boost`) are bottom-left, and the speed dial (`.mz-speed`) is bottom-right. Position is top-left, the lap box top-centre, the minimap and best times top-right.
- **Landscape is already locked** in `ios/App/App/Info.plist` (iPhone and iPad) and set in `public/site.webmanifest` (`"display": "fullscreen"`, `"orientation": "landscape"`). The web has no rotate overlay.
- **Comfort today:** `GraphicsSystem.setComfort({ reducedMotion })` already turns off motion blur, camera shake, colour fringing, speed lines, the draft shimmer, fog motion and lightning flashes, halves weather streaks, and calms the field of view. `colorBlind` only changes the energy bar (`html.mz-cb`). `largeText` sets `html.mz-large-text`. The keyboard remap screen exists (Settings → Controls). `settings.touchSteer` is saved and read by nothing.
- **The flags `tiers` and `touch` have no reader.** M7b adds the first reader of `touch`. (`tiers` is removed in M8.)
- **Steering is relative to the ship.** `ControlInput.steer` turns the ship about its own up axis, and `ChaseCamera` rolls with the ship's smoothed up. "Right on the screen" is therefore "right for the ship" on the corkscrew, in the pipe, on the loop and on the Spine.

**Rules for every M7 PR** (in addition to §0):
- Pad and keyboard play must not change. Every existing test passes unchanged, except where a step below says to update one.
- Everything a player feels in a race (assists, the slider curve, the tilt curve) is a pure function called in the fixed step, so the sims can drive it and a replay is identical.
- **Budgets:** app JS ≤ 600 KB gzip. Touch controls are DOM elements: they add **no draw calls** and no per-frame allocation. Device gate: 60 fps, with p95 no more than 1 ms above the build before the PR.
- Every sim file stays under 60 s on CI. An assertion is never loosened to go green.
- Sizes in this section are **CSS points (`px` in CSS)**. They are not scaled with the screen: a button is the same physical size on the iPhone and the iPad.
- Sounds: M7 adds no audio. Where a step names a **sound hook**, emit the bus event and leave the sound to M6.

---

### M7a — The four assists work, and the assists screen — ✅ BUILT (PR #41, `v2/m7a-assists`; waiting on the owner's device check)

**Design decisions:**
- **All four assists become real** for the human player: auto-accelerate, steering assist (off / light 30% / strong 60%), No-KO, boost from lap 1. The numbers in `physics/Assists.ts` (`ASSIST`) do not change.
- **Presets** are unchanged: Rookie = all four on (`ROOKIE_ASSISTS`), Classic = none (`NO_ASSISTS`).
- **Assists can change at any time**, from the pause menu too, and during a cup. A change takes effect on the next fixed step, with one exception: the hazard rules (below) are fixed at the start of a race.
- **Assists never cost anything.** They do not reduce credits, block trophies or (in M8) block medals.
- **No-KO:**
  - Energy lost to damage is halved, and damage never takes energy below 1. The ship cannot be destroyed by damage.
  - "Damage" is: rail hits and scrapes, ship-to-ship hits, mines, debris, gates, lightning, geysers and jets. Spending energy on a boost is not damage and is unchanged.
  - **No-KO also selects the Rookie hazard rules** (`HAZARDS_ROOKIE`: twice the warning, no energy loss, a hit only slows the ship), as SPEC §6 says. The rules are chosen when the race is built. Turning No-KO on or off mid-race changes the damage rule at once and the hazard rules from the next race.
- **Boost from lap 1:** the player's boost is unlocked when the lights go out. Rivals are unchanged (lap 2).
- **Auto-accelerate:** throttle is 1 unless the brake is held (as `PlayerAssists.apply` does today). M7b adds a second source for it (the touch setting); M7a builds the place where the two are combined.
- **Where the screen lives:** Settings gets an **ASSISTS** tab (per profile; hidden when no profile is active). It is reachable from the pause menu through the existing SETTINGS button.
- **Not behind a flag.** The preset text on the live site already promises these assists. The owner playtests the preview before merging, as for every PR.

**Save v8 (this PR carries every M7 field, so M7b and M7c need no migration):**

```ts
// save/schema.ts
export const SAVE_VERSION = 8;
export type HudSize = 'normal' | 'large' | 'xl';
export type AirbrakeStyle = 'slider' | 'buttons';
export type Step3 = 0 | 1 | 2; // low / medium / high
export type PadControl = 'throttle' | 'brake' | 'airLeft' | 'airRight' | 'boost' | 'item' | 'itemPrev' | 'itemNext';
export type PadBindings = Record<PadControl, number[]>; // standard-mapping button indices 0–15, 1 or 2 per control

export interface TouchSettings {
  steer: TouchSteer;            // 'slider' | 'tilt'; default 'slider' (moved from settings.touchSteer)
  autoAccelerate: boolean;      // default true
  sensitivity: Step3;           // slider; default 1
  airbrake: AirbrakeStyle;      // default 'slider' (the owner may change the default at the M7b gate)
  buttonSize: 's' | 'm' | 'l';  // default 'm'
  leftHanded: boolean;          // default false
  tiltSensitivity: Step3;       // default 1
  tiltNeutral: number;          // degrees, −20..20; default 0
  hintSeen: boolean;            // default false; the first-race touch hint was shown
}

export interface SettingsData {
  // …unchanged fields…
  hudSize: HudSize;             // replaces largeText
  haptics: boolean;             // default true
  touch: TouchSettings;         // replaces touchSteer
  padBindings: PadBindings;     // default DEFAULT_PAD_BINDINGS
}
```

- `DEFAULT_PAD_BINDINGS` is today's layout: `throttle: [7, 0]` (RT, Ⓐ), `brake: [6, 1]` (LT, Ⓑ), `airLeft: [4]`, `airRight: [5]`, `boost: [2]` (Ⓧ), `item: [3]` (Ⓨ), `itemPrev: [14]`, `itemNext: [15]`.
- **Migration 7 → 8** (`save/migrations.ts`): `hudSize = largeText ? 'large' : 'normal'`; `touch = { ...defaults, steer: touchSteer }`; `haptics = true`; `padBindings = DEFAULT_PAD_BINDINGS`; delete `largeText` and `touchSteer`. Profiles do not change.
- `sanitizeSettings` gets `sanitizeTouch` and `sanitizePadBindings` (indices 0–15, at most 2 per control, no index on two controls, a control left empty takes its default).
- `Settings` (`settings/Settings.ts`) gains the signals `hudSize`, `haptics`, `touch` and `padBindings`, and loses `largeText` and `touchSteer`. `App.applySettings` sets `html.mz-hud-large` / `html.mz-hud-xl` from `hudSize`; until M7c restyles them, both classes carry today's `mz-large-text` rules, so nothing looks different in M7a.

**Build steps (tests first):**
1. **Save v8.** Write the `SaveStore` tests first: a v7 save with `largeText: true` and `touchSteer: 'tilt'` loads as v8 with `hudSize: 'large'` and `touch.steer: 'tilt'`; a v7 save with neither loads with the defaults; bad `touch` and `padBindings` values fall back to the defaults; an export from v8 imports unchanged. Then the schema, the migration and the `Settings` signals.
2. **The effective assists, as one pure function** in `physics/Assists.ts`:

   ```ts
   export function effectiveAssists(profile: Readonly<Assists>, device: InputDevice, touch: Readonly<TouchSettings>): Assists
   ```

   It returns the profile's assists, with `autoAccelerate` also true when `device === 'touch' && touch.autoAccelerate`. In M7a `InputDevice` has no `'touch'` yet: add the member to the type now (`'keyboard' | 'pad' | 'touch'`), with nothing producing it. Unit tests cover the four combinations.
3. **Steering assist and auto-accelerate in the race.** `RaceSetup` gains `assists?: Assists` (default `NO_ASSISTS`). `RaceSession` builds one `PlayerAssists(track)` and gains `setAssists(a: Assists)`. In `RaceSession.fixed`, when the player is `driven`, the player's controls are `assists.apply(player, human, current)`; `items.fixed` still gets the raw `human` input. `App` calls `session.setAssists(effectiveAssists(…))` when a race is built, when the profile's assists change and when the input device changes.
4. **No-KO in physics.** Write `sim/assists.sim.test.ts` first (step 7). Then:
   - `ShipState` gains `noKO: boolean` (default false; `PhysicsSystem.addShip` sets it false). `RaceSession.setAssists` sets `player.noKO`.
   - In `ShipController`, every damage call site goes through one new method `takeDamage(amount)`: rail (`RAIL_DAMAGE_PER_MS`), lightning (`STRIKE_DAMAGE`), geyser (`GEYSER_DAMAGE`), jet (`JET_DAMAGE`), mine (`MINE_DAMAGE`), ship-to-ship (`SHIP_DAMAGE_PER_MS`), and any gate or debris site found by searching for `drainEnergy(`. With `noKO`, `takeDamage` halves the amount and leaves `energy ≥ 1`. Without it, it behaves exactly as `drainEnergy` does today. Boost spending keeps calling `drainEnergy`.
   - `App` (`hazardPolicy(…)` near `App.ts:663`): the Rookie hazard rules apply when the tier is Rookie **or the profile's `assists.noKO` is on**. `?hazards=` still overrides.
5. **Boost from lap 1.** `ShipState` gains `earlyBoost: boolean` (default false), set by `RaceSession.setAssists`. `RaceManager` sets `boostUnlocked = ship.earlyBoost` where it resets a racer (near line 300) and sets it true at GO for a ship with `earlyBoost`; the lap-2 unlock (near line 394) is unchanged. The HUD hides "BOOST UNLOCKS LAP 2" when the boost is unlocked (it already reads `boostUnlocked`).
6. **The ASSISTS tab** (`ui/screens/SettingsScreen.tsx`, a new `Assists` component; `App.setAssists(patch)` updates the active profile inside a save update and calls `session.setAssists`):
   - `AUTO-ACCELERATE` toggle. Hint: "The ship accelerates by itself. Hold the brake to slow down."
   - `STEERING HELP` segmented: OFF / LIGHT / STRONG. Hint: "Guides you along the road and away from the rails. You stay in control."
   - `NO KNOCK-OUTS` toggle. Hint: "Half damage, and you can't explode. Hazards warn earlier and only slow you down (from the next race)."
   - `BOOST FROM LAP 1` toggle.
   - Two chips: `ROOKIE PRESET` and `CLASSIC PRESET`.
   - Every control has an icon as well as text (SPEC §2: icon-first). Pad and keyboard focus work as on the other tabs.
7. **Sims and tests:**
   - `sim/assists.sim.test.ts` (new): (a) No-KO: a ship held against a rail at full throttle for 20 s is never destroyed and its energy stays ≥ 1; the same run without No-KO destroys it. (b) No-KO: one mine hit costs half the energy of the same hit without it. (c) Boost from lap 1: a boost request on lap 1 starts a boost with `earlyBoost`, and does not without it. (d) Auto-accelerate: with zero throttle input the ship completes a lap of Neon Bay. (e) Two runs with the same seed and assists are identical.
   - `sim/worldRace.ts`: the assisted player stand-in now goes through the same `RaceSession`-independent path as before, but with `noKO` and `earlyBoost` set from `ROOKIE_ASSISTS`. The Rookie balance test in `tierMatrix.ts` (top 3 from P8 on every track) must still pass, on all 8 tracks.
   - `RaceSession` test: with `assists` set, the player's controls are assisted and the raw input reaches `items.fixed`.
   - e2e (`e2e/assists.spec.ts`): create a Rookie profile, open Settings → ASSISTS, see four controls on; set CLASSIC PRESET, see them off; reload, still off.

**Done when:**
- [ ] A new "I'm new to racing games" profile cannot be knocked out, boosts on lap 1, accelerates by itself and is guided along the road, in a real race in the browser.
- [ ] A Classic profile plays exactly as before (every existing sim and e2e test passes unchanged).
- [ ] The ASSISTS tab works with pad, keyboard and mouse, from the menu and from the pause menu, and its changes survive a reload.
- [ ] A v7 save loads as v8 with nothing lost (test).
- [ ] The Rookie balance sims pass on all 8 tracks with No-KO and boost from lap 1 in play.

**Device check (no fps gate; nothing renders differently):** on the iPhone with the 8BitDo, a Rookie-preset profile races Orbital Ring: drive into mines and rails on purpose, never explode, boost on lap 1. Then pause → SETTINGS → ASSISTS → CLASSIC PRESET, resume, and the next rail hit drains energy as before.

**As built (2026-11-19, PR #41):**
- **Save v8** (`save/schema.ts`, `save/migrations.ts` step 7): every M7 field is in, as specified. `defaultTouch()`, `DEFAULT_PAD_BINDINGS`, `PAD_CONTROLS`, `clonePadBindings`, `sanitizeTouch` and `sanitizePadBindings` are exported. A pad control whose buttons are all taken and whose defaults are taken too makes the whole binding set fall back to the defaults (it cannot be left empty). `Settings` has `hudSize`, `haptics`, `touch` (with `setTouch(patch)`) and `padBindings`.
- **`effectiveAssists`** is in `physics/Assists.ts`. `InputDevice` has `'touch'`, which nothing produces yet.
- **`RaceSession`** builds one `PlayerAssists` and has `setAssists(a)` and `activeAssists`. `App` passes `assists` in the setup and keeps them current with one signal effect (profile assists, input device, touch settings), and again when a session finishes building. `App.setAssists(patch)` updates the active profile.
- **No-KO:** `ShipController.takeDamage(amount)` is the one damage path: rail impacts and scrapes (the stone gates and debris are rail contacts), lightning, geysers, jets, mines and ship-to-ship. With `noKO` it takes half and stops at 1 energy (`NO_KO_SCALE`, `NO_KO_FLOOR`). The boost still calls `drainEnergy`. The Rookie hazard rules apply when the tier is Rookie or the profile's No-KO is on. They are fixed when a race is built. A RESTART of the same race keeps them; the next race from the menu picks up the change, because the hazard mode is in the session key.
- **Boost from lap 1:** `RaceManager` sets `boostUnlocked = earlyBoost` on the grid and unlocks it at GO. The HUD's "BOOST UNLOCKS LAP 2" goes away by itself. Turning the assist on mid-race unlocks the boost at once. Turning it off mid-race leaves an unlocked boost unlocked until the next start.
- **The ASSISTS tab** sits between RACE and SOUND and is hidden with no profile. `Toggle` and `Segmented` (`ui/components.tsx`) take an optional `icon` (and `Segmented` a `hint`). Each assist row has an icon. The tab's footnote says assists never cost credits or trophies. Screenshots: `docs/v2/shots/m7a/assists-desk.jpg`, `assists-phone.jpg` (956 × 440).
- **Sims and tests:** `sim/assists.sim.test.ts` has (a) to (e) and also checks that a boost still costs full energy under No-KO. For (a), the ship starts worn down to 12 energy, because a fresh ship loses only about 50 energy in 20 s of slamming rail to rail and would survive with or without No-KO. Without No-KO the run destroys it; with No-KO it bottoms out at 1 and finishes. In `sim/worldRace.ts` the assisted stand-in has No-KO and boost from lap 1. The Rookie balance test passes on all 8 tracks. There are new tests for the save, `effectiveAssists`, early boost in `RaceManager`, and assisted controls in `RaceSession` (the items still get the raw input object), plus `e2e/assists.spec.ts`, which also changes the assists from the pause menu mid-race.
- **Changes nobody asked for:**
  - `ShipState.noKO` and `earlyBoost` are optional (absent = off), so the ship literals in existing tests did not change.
  - The Comfort tab's LARGE TEXT switch writes `hudSize` ('large' / 'normal') until M7c replaces it with HUD SIZE. `e2e/menus.spec.ts` and two unit tests now read `hudSize` and `mz-hud-large`, as the v8 migration requires.
  - BOOST FROM LAP 1 has a hint: "Your boost is ready when the lights go out, not on lap 2."

---

### M7b — Touch driving and the touch HUD — ✅ BUILT (PR #42, `v2/m7b-touch`; waiting on the owner's device gate and the air-brake default)

**Design decisions:**
- **Platforms:** the iOS app and mobile web. Android is best effort with no gate. Pad and keyboard keep working. The player can change device in the middle of a race: the device that produced input last owns the prompts and the layout.
- **Landscape only.** The app is already locked. The web shows a rotate overlay in portrait on a touch device, and pauses a running race.
- **Default scheme:** auto-accelerate on (the per-device `touch.autoAccelerate`, whatever the profile says); a floating steering slider on the left half; BOOST and BRAKE under the right thumb; the item button above BOOST; pause at the top.
- **The slider:** the origin is the point where the thumb lands. Full lock is 80 / 60 / 44 points of travel for sensitivity low / medium / high. The response is curved (finer near the centre): `steer = sign(x) · |x|^1.5`, with `x` the travel divided by the full-lock travel, clamped to ±1.
- **Air-brakes: both styles are built**, chosen by `touch.airbrake`:
  - `'slider'` (the default): pushing the thumb past full lock applies that side's air-brake. It starts 12 points past full lock and reaches full strength 20 points later.
  - `'buttons'`: two air-brake buttons above the right-thumb cluster. The slider then stops at full lock.
  - **The owner picks the final default at the device gate.** The other style stays as a setting.
- **With auto-accelerate off** an ACCELERATE button appears in the right-thumb cluster.
- **Items:** tapping the item button uses the selected item. A small chip beside it switches to the next item. The pit needs no button (driving onto the strip recharges).
- **The touch HUD:** power and speed move to one compact strip at the bottom centre, between the thumbs. The items panel is hidden (the item button shows the item and its count). Position, the lap box, the minimap and the best times stay where they are.
- **Sizes** are in points and do not grow with the screen. `touch.buttonSize` scales the controls: S × 0.85, M × 1, L × 1.2. `touch.leftHanded` mirrors the whole layout.
- **Haptics:** a light tick on every touch-button press, in the iOS app. (The on/off setting arrives in M7c; the field exists from M7a and is honoured here.)
- **A first-race hint:** the first race started by touch shows the zones with labels for 4 s, or until the first touch. It is shown once (`touch.hintSeen`).
- **Behind `touch`.** Without the flag a touch does nothing in a race, as today.

**Layout (M size; all distances are from the safe-area edge, `env(safe-area-inset-*)`):**

| Control | Size | Place (right-handed) |
|---|---|---|
| Steering zone | the left 45% of the screen, from 25% below the top to the bottom | The slider's ring (96 across) and thumb dot (56) are drawn where the thumb lands |
| BOOST | 88 round | right 24, bottom 24 |
| BRAKE | 64 round | left of BOOST with a 16 gap, bottom 16 |
| ACCELERATE (auto-accelerate off) | 72 round | above BRAKE with a 12 gap |
| ITEM | 56 round | above BOOST with a 12 gap |
| Item switch chip | 44 round | left of ITEM with an 8 gap |
| Air-brake L and R (`'buttons'` style) | 56 round each | a row above ITEM, 12 apart |
| PAUSE | 44 square | top edge, directly right of the lap box |
| Power and speed strip | 320 × 48 on a screen under 500 points tall; 420 × 60 otherwise | bottom centre, bottom 12 |

- The strip holds: the power bar (with its number and the RECHARGING tag), the speed as a number with KM/H (no dial), and the boost state (a padlock while locked; "BOOST" lit while boosting).
- The DRAFT and WIND chips and the EMP warning move to just above the strip.
- On the iPad the layout is the same. The controls sit in the bottom corners at the same point sizes, and the strip uses its larger size.
- Left-handed: BOOST, BRAKE, ACCELERATE, ITEM and the air-brake buttons go to the left corner, and the steering zone to the right 45%.

**Build steps (tests first):**
1. **The slider as a pure function** (`physics/touchSteer.ts`, new), with unit tests written first:

   ```ts
   export const SLIDER_LOCK = [80, 60, 44] as const;      // points of travel to full lock, by sensitivity
   export const AIRBRAKE_START = 12, AIRBRAKE_RAMP = 20;   // points past full lock
   export interface SliderOut { steer: number; airbrakeLeft: number; airbrakeRight: number }
   export function sliderControls(dx: number, sensitivity: Step3, airbrake: AirbrakeStyle, out: SliderOut): SliderOut
   ```

   Tests: zero at the origin; ±1 at full lock for each sensitivity; the 1.5 curve at half travel (0.354); odd symmetry; no air-brake inside full lock; the ramp from 12 to 32 points past it; no air-brake at all with `'buttons'`.
2. **`physics/TouchInput.ts`** (new): the state of the touch controls, with no DOM layout knowledge.
   - Methods called by the controls: `steerStart(pointerId, x)`, `steerMove(pointerId, x)`, `steerEnd(pointerId)`, `press(control, down)` for `'boost' | 'brake' | 'throttle' | 'airLeft' | 'airRight' | 'item' | 'itemNext' | 'pause'`, and `releaseAll()`.
   - `read(out)` returns steer, throttle, brake, both air-brakes, and the boost, fire and item-cycle latches (cleared on read), using `sliderControls`.
   - Unit tests: two pointers at once (steer and boost); a second pointer in the steering zone is ignored; `pointercancel` and `releaseAll` leave everything neutral; a boost press latches exactly once.
3. **`InputManager` merges touch.** It takes an optional `TouchInput`. `sample()`: steer is the largest magnitude of keyboard, pad and touch; the other values are the maximum; the latches are OR-ed. `consume('pause')` also reads the touch pause press. `InputDevice` `'touch'` is set on any `pointerdown` with `pointerType === 'touch'` (a capture listener on `window`), and `App.setInputDevice` toggles `html.mz-touch` beside `html.mz-pad`. The blur handler calls `releaseAll()`. Tests: the device changes keyboard → touch → pad → touch, and the merge rules.
4. **`game/TouchControls.ts`** (new): builds the controls as DOM inside the HUD root (`.mz-touch-layer`) and forwards pointer events to `TouchInput`.
   - Pointer events with `setPointerCapture`; `touch-action: none`, `user-select: none` and `-webkit-touch-callout: none` on the layer; `contextmenu` is prevented.
   - The layer has `pointer-events: none`; only the zone and the buttons take events, so HUD panels and the pause panel still receive taps.
   - Shown only when `features.touch` is on, the device is `'touch'` and the race is in countdown or racing. It hides (and calls `releaseAll()`) on pause, results and the intro card.
   - It reads `touch.buttonSize`, `touch.leftHanded`, `touch.airbrake` and the effective auto-accelerate through signals, and updates without a rebuild of the race.
   - The slider ring and dot move with a CSS `transform` only (no layout work per frame).
   - `RaceView` gains `touch?: TouchInput`; `HUD` creates `TouchControls` when it is given.
5. **The touch HUD** (`game/hud.css`, `game/HUD.ts`): under `html.mz-touch`, `.mz-energy`, `.mz-boost` and `.mz-speed` are replaced by the strip (`.mz-strip`, built once in `HUD.ts` and fed by the same `update` values, hidden without `mz-touch`); `.mz-items` is hidden; the chips and the EMP warning move above the strip. The HUD's prompts gain a third span, `.mz-k-touch`, beside `.mz-k-kb` and `.mz-k-pad`; a prompt with no touch form is hidden under `mz-touch`.
6. **Haptic tick:** `native/haptics.ts` gains `tapUi()` (a light impact, under the existing 60 ms gap rule, nothing in a browser, nothing when `settings.haptics` is off). `TouchControls` calls it on each button press.
7. **The rotate overlay** (`index.html` and `ui/ui.css`): a fixed panel "ROTATE YOUR DEVICE" with an icon, shown by `@media (orientation: portrait) and (pointer: coarse)`, only on the web (`!isNativeApp()`), only with `features.touch`. `App` pauses a running race when the media query starts to match.
8. **The first-race hint:** an overlay inside `.mz-touch-layer` that labels STEER, BOOST, BRAKE and the item button, for 4 s of wall-clock time or until the first touch; then `touch.hintSeen = true`.
9. **The touch-scheme sim** (`sim/touchScheme.sim.test.ts`, new; written before step 4 is wired). A `ScriptedThumbs` driver stands in for a person's two thumbs:
   - It asks the track's `AIDriver` (Pilot tier) for the steer it wants, then moves a virtual left thumb toward the slider position that gives that steer, at no more than 600 points per second, in whole points. The steer the ship gets is `sliderControls(…)` of that thumb.
   - The right thumb does **one** thing per step: brake when the AI brakes, else boost when the AI boosts, else nothing. Throttle comes from auto-accelerate. Air-brakes come only from the slider's overdrive (`'slider'` style).
   - Asserts, on **all 8 tracks** (so the corkscrew, the pipe, the loop, the Plunge and the Spine are covered): 3 laps finished, no respawn, no destruction, `maxLateral` inside the track's limit, and a total time within 12% of the same Pilot `AIDriver` driving directly. Two runs are identical.
   - A second case per track with the Rookie preset (strong steering help, No-KO): 3 laps, no respawn.
   - If the file cannot stay under 60 s, split it into two files of 4 tracks each.
10. **Playwright touch project** (`playwright.config.ts`: a second project, `touch`, with `hasTouch: true`, `isMobile: true`, viewport 956 × 440, running only `e2e/touch.spec.ts` with `?features=touch`):
    - Tap through profile creation and the main menu to a race, with taps only.
    - In the race, a touch drag in the steering zone gives the player a positive then a negative steer (`window.__machzero` gains `input: { device, steer }` in debug builds); a tap on BOOST after the unlock starts a boost; a tap on PAUSE pauses and RESUME resumes.
    - A keyboard key during the race hides the touch layer and shows the keyboard prompts; a touch brings it back.
    - No console errors.

**Done when:**
- [ ] With `?features=touch`, a full race can be driven in a browser's touch emulation with no keyboard: steer, brake, boost, use and switch items, pause, resume, finish.
- [ ] Both air-brake styles work and are switchable in a race from the pause menu (the setting's control arrives in M7c; until then `?airbrake=buttons` selects it for QA).
- [ ] No HUD value is under a control at 956 × 440, 844 × 390 (a small iPhone) and 1180 × 820, right- and left-handed, at sizes S, M and L (screenshots in the PR body).
- [ ] The touch-scheme sim passes on all 8 tracks; pad and keyboard tests pass unchanged.
- [ ] Without the flag nothing changes on the live site.
- [ ] Budgets hold: app JS, zero added draw calls, and the desktop perf table in the PR body.

**Device gate (build with `VITE_FEATURES=touch,expansion npm run ios:sync`):** on the iPhone 18 Pro Max and the iPad Air, with no pad connected:
1. A full 8-ship race on Neon Bay by fingers alone, with the performance panel on: 60 fps, p95 no more than 1 ms above the build before.
2. A race on Cryo Station (the pipe) with each air-brake style. **The owner says which style is the default.**
3. Left-handed and size L once on each device: nothing is cut off by the notch, the Dynamic Island or the home bar.
4. Connect the pad mid-race: the touch controls go away and the pad drives. Touch the screen: they come back.

**As built (2026-11-19, PR #42):**
- **Pure parts, as specified:**
  - `physics/touchSteer.ts` (`sliderControls`, `SLIDER_LOCK`, `AIRBRAKE_START`, `AIRBRAKE_RAMP`, `SLIDER_CURVE`).
  - `physics/TouchInput.ts`. It also has `steerOrigin` / `steerTravel` for drawing, `isHeld`, `consumePause`, an `onActivity` callback (InputManager's device switch), and `externalSteer` for M7c's tilt.
- **`InputManager(window, touch?)`** merges touch as specified. The touch PAUSE becomes a `pause` menu press in `update()`, so it ages like START. A touch `pointerdown` (capture, on `window`) or any touch-control press makes `'touch'` the device. Blur and dispose call `releaseAll()`.
- **`game/TouchControls.ts`:**
  - `TouchRig` is one per App: the input, the live layout config, `haptic`, `onHintSeen`. `TouchControls` belongs to each race's HUD and is built inside `.mz-race`, so every distance is from the safe-area edge.
  - Layout comes from the `TOUCH_LAYOUT` table × `BUTTON_SCALE`. Left-handed mirrors it, with the left air-brake still on the left.
  - CSS shows the layer only under `html.mz-touch` while counting down or racing. The HUD calls `release()` on pause, results and the intro card.
- **Touch HUD:** `.mz-strip` holds the power bar with its number and RECHARGING tag, the speed number with KM/H, and the boost state (🔒 while locked or jammed, lit while boosting). It replaces the power, boost and speed panels and the items panel under `html.mz-touch`. DRAFT, WIND and the EMP warning move above the strip. Prompts take an optional touch form (`.mz-k-touch`); one without it is hidden on touch. The intro card says "TAP TO SKIP" and a tap on it skips it (`HudActions.onSkipIntro`).
- **Haptics:** `tapUi()` and `setHapticsEnabled()` in `native/haptics.ts`. The `haptics` setting already stops `bindHaptics` and `tapUi` (Rumble is M7c).
- **Rotate overlay:** `.mz-rotate` in `index.html`, shown in portrait on a coarse pointer when `App` has set `html.mz-rotate-ok` (web + `touch`). Turning to portrait pauses a running race.
- **QA:** `?airbrake=buttons|slider` (`UrlFlags.airbrake`) until M7c's setting. `__machzero.input = { device, steer }` in debug builds.
- **Sims:** `sim/touchScheme.ts` (`ScriptedThumbs`, `thumbRace`, solo races) runs in two files of 4 tracks each, about 14 s in all.
  - Thumbs vs the Pilot AI driving directly: −0.2% to +1.2% on all 8 tracks.
  - No respawn on any track, Rookie preset too. Runs replay identically.
- **e2e:** a `touch` Playwright project (956 × 440, `hasTouch`, `isMobile`) runs only `e2e/touch.spec.ts`, and the `chromium` project ignores it. Drags use CDP `Input.dispatchTouchEvent`.
- **Changes nobody asked for:**
  - **The layout table overlaps itself.** ACCELERATE "above BRAKE" overlaps the next-item chip "left of ITEM". So ACCELERATE keeps its 12-point gap above BRAKE but moves left to clear the chip (`side` 156).
  - **Air-brake pair moved.** Above ITEM, the pair reached the minimap and the best times on an 844 × 390 phone at size L. It now sits above the BRAKE column (or above ACCELERATE when that shows), left of the chip, 12 apart.
  - **Smaller minimap on short screens.** On a touch screen under 500 points tall the minimap is 10.5 em instead of 12.5 em, so the best times clear ITEM at size L. Both panels keep their places.
  - **PAUSE size.** PAUSE stays 44 × 44 at every button size, so it never drops under 44 points.
  - **Hint labels.** The first-race hint's BOOST and BRAKE labels sit across their buttons.
- **Screenshots:** `docs/v2/shots/m7b/` at 956 × 440, 844 × 390 and 1180 × 820, right- and left-handed, sizes S, M and L, both air-brake styles, with and without ACCELERATE, plus the first-race hint.

---

### M7c — Tilt, menus by touch, comfort settings, pad remapping; `touch` turns on — ✅ BUILT (branch `v2/m7c-comfort`; waiting on the owner's device gate)

**Design decisions:**
- **Tilt** is an option (`touch.steer: 'tilt'`). Steering is the device's **roll about the axis that points out of the screen**, like turning a wheel, measured against real gravity.
  - A 3° deadzone. Full lock at 35° / 25° / 18° for sensitivity low / medium / high. Linear between them. The value is smoothed at 20 per second.
  - A **CALIBRATE** button sets the neutral angle to the way the device is held now (kept within ±20°).
  - **Tilt reads real gravity only.** The game's camera roll never enters it. On the corkscrew, in the pipe and on the Spine, tilting the device right steers the ship right on the screen, exactly as the slider does.
  - When the screen lies nearly flat (gravity in the screen's plane under 3 m/s²) the roll cannot be read: the steer eases to zero and a chip says "HOLD THE DEVICE UPRIGHT".
  - With tilt the left thumb is free: the left corner shows the two air-brake buttons (72 round each). The right-thumb cluster is unchanged.
  - **Permission** is asked from a tap (Settings → Controls → TILT). If motion data does not arrive at the start of a race, the grid intro card shows an "ENABLE TILT" button; if the player skips it, that race uses the slider.
- **Menus by touch:** every target is at least 44 × 44 points. The Garage turntable zooms with a pinch. Lists scroll with a drag. The keyboard and pad hint rows are hidden on touch. No screen needs a different structure.
- **Reduced motion** keeps everything it does today and adds: no hit flashes and no screen-wide flashes in the HUD or the menus, and no menu transitions. **The camera still rolls with the ship** (it is the steering reference). A new save starts with reduced motion on when the device asks for it (`prefers-reduced-motion: reduce`).
- **Colour-blind mode** is one blue-and-orange palette plus shapes, so that nothing is told by colour alone:
  - a hazard cue with an icon and an arrow to the clear side for every hazard (ice, gates, mines, debris, lightning, geysers, jets);
  - shapes on the minimap (the player a triangle, the leader a diamond, the others circles);
  - a marker on low power (it exists), a padlock on the locked boost (it exists).
- **HUD size** replaces LARGE TEXT: NORMAL / LARGE / EXTRA LARGE scale the HUD and the menus by 1 / 1.15 / 1.3. Touch controls keep their own size setting.
- **Pad remapping** uses the same screen as the keyboard, for the eight driving controls in `PadControl`. Steering stays on the left stick. The menu buttons stay fixed (Ⓐ confirm, Ⓑ back, START pause).
- **HAPTICS** on/off (Settings → Controls), for the iOS app's haptics and the pad's rumble.
- **`touch` turns on** in this PR.

**Build steps (tests first):**
1. **Tilt as a pure function** (`physics/tilt.ts`, new), unit tests first:

   ```ts
   export const TILT_LOCK_DEG = [35, 25, 18] as const;
   export const TILT_DEADZONE_DEG = 3, TILT_MIN_GRAVITY = 3; // m/s² in the screen's plane
   /** Roll in degrees (positive = turned clockwise as the player sees it), or null when the screen is too flat. */
   export function deviceRoll(gx: number, gy: number, screenAngle: 0 | 90 | 180 | 270): number | null
   export function tiltSteer(rollDeg: number, neutralDeg: number, sensitivity: Step3): number // −1..1, positive = right
   ```

   Tests: a level device in each landscape orientation gives 0; a clockwise turn gives a positive steer in **both** landscape orientations; the deadzone; full lock at each sensitivity; the neutral offset; `null` under 3 m/s².
2. **`physics/TiltInput.ts`** (new): listens to `devicemotion`, reads `accelerationIncludingGravity` and `screen.orientation.angle`, and gives `TouchInput` a smoothed steer.
   - `requestTiltPermission(): Promise<'granted' | 'denied' | 'unsupported'>` calls `DeviceMotionEvent.requestPermission()` where it exists (iOS 13 and later; it must run inside a tap) and resolves `'granted'` where no permission is needed.
   - **Check before relying on it** (Context7 and the device): the sign of `accelerationIncludingGravity` differs between iOS and Android, and the WKWebView asks for permission again after each app launch. Normalise the sign per platform in one place, with a comment, and prove the direction at the device gate. If the web API does not deliver events in the Capacitor shell, add `@capacitor/motion` and note it in the PR; if iOS needs `NSMotionUsageDescription` in `Info.plist`, add it ("MachZero uses motion to steer when tilt steering is on.").
   - `TouchInput.read` uses the tilt steer in place of the slider when `touch.steer === 'tilt'` and tilt data is fresh (an event in the last 0.5 s); otherwise the slider is used and stays on screen.
   - `TouchControls` in tilt mode: no steering zone; the two air-brake buttons in the left corner; the "HOLD THE DEVICE UPRIGHT" chip.
3. **Settings → Controls on touch** (`SettingsScreen.tsx`): a TOUCH section first on a touch device: STEERING (SLIDER / TILT; choosing TILT asks for permission and falls back to SLIDER with a message when it is denied), SENSITIVITY (LOW / MEDIUM / HIGH, for the active mode), CALIBRATE TILT, AUTO-ACCELERATE, AIR-BRAKES (PUSH PAST FULL LOCK / BUTTONS), BUTTON SIZE (S / M / L), LEFT-HANDED, HAPTICS. The keyboard section shows when a keyboard has been used; the pad section when a pad is connected. Remove the `?airbrake=` QA parameter from M7b.
4. **Pad remapping:** `InputManager.setPadBindings(b)` replaces the fixed `PAD.*` reads for the eight driving controls (the menu edges and the garage orbit keep their fixed buttons). `Settings.bindPad(control, slot, index)` follows `bindKey`'s rules (a button moves from its old control; no control is left empty). The Controls tab lists the pad controls with "press a button" capture, and a RESET button for each device. Tests: the defaults reproduce today's behaviour exactly (the existing controller tests pass unchanged); a swap; a reset.
5. **Menus by touch** (`ui/ui.css`, the screens):
   - Raise any target under 44 × 44 (tabs, chips, badge and colour swatches, the profile delete button, segmented controls, sliders' thumbs).
   - `touch-action: pan-y` and momentum scrolling on the scrolling containers; no rubber-band on the page itself.
   - Hide `.mzu-hints` and focus rings under `html.mz-touch`; `data-autofocus` still sets focus for a later pad.
   - Garage: a two-pointer pinch on the turntable zooms (`app.orbitShipPreview(0, 0, dz)`); a one-pointer drag orbits as today.
   - The profile name field: the on-screen keyboard must not leave the form hidden; scroll the field into view on focus.
   - e2e (`e2e/touch.spec.ts`, more cases): on every screen (profiles, create, menu, worlds, Grand Prix, cup standings, garage and its tabs, livery, settings and its tabs, pause, results) at 956 × 440, every visible `button`, `[role=tab]`, `[role=radio]` and `input` is at least 44 × 44; a garage purchase and a livery change by taps only.
6. **Comfort:**
   - Reduced motion: under `html.mz-reduced-motion`, HUD and menu animations that flash or sweep are off (`animation: none`, `transition: none` on the listed classes; list them in the PR). `App` sets `reducedMotion` from `matchMedia('(prefers-reduced-motion: reduce)')` only when it creates the very first save.
   - Colour-blind: move the HUD's meaning-bearing colours to tokens in `ui/tokens.css` and `game/hud.css` (`--mz-good`, `--mz-warn`, `--mz-bad`, `--mz-rival`, `--mz-player`) with blue-and-orange values under `html.mz-cb`. `game/Minimap.ts` draws the shapes above in every mode.
   - **The hazard cue** (`game/HazardCue.ts`, new, pure; a HUD chip `.mz-hazard`): each frame, find the nearest hazard ahead of the player on its path within 2.5 s at the current speed that is warning or active; give its kind (an icon) and the clear side (an arrow left or right, or none). It reads the same hazard timelines the AI uses (`hazardClock`, the track's features, `physics.mines`). Shown in colour-blind mode. Unit tests per hazard kind with a fixed clock. No 3D change, so no draw calls.
   - HUD size: `--mz-hud-scale` and `--mz-ui-scale` (1 / 1.15 / 1.3) from `html.mz-hud-large` and `html.mz-hud-xl`; replace the `mz-large-text` rules. The Comfort tab shows HUD SIZE as a segmented control. Check every screen at EXTRA LARGE at 956 × 440: nothing is cut off (screenshots in the PR).
   - HAPTICS off stops `bindHaptics`, `tapUi` and `Rumble`.
7. **Turn the flag on:** `FEATURE_DEFAULTS.touch = true`. Update `e2e` so the touch project runs without `?features=touch`.
8. **Docs:** SPEC §3's touch layout already points to §11. Update `docs/IOS_TESTFLIGHT.md` with the tilt permission note, mark M7 done in this file with the PR numbers, run `npm run codebase`.

**Done when:**
- [ ] Tilt steers the right way in both landscape orientations, calibrates, and falls back to the slider when permission is missing (unit tests, and the device gate for the direction).
- [ ] Every screen passes the 44-point test; a garage purchase, a livery change and a cup start work by taps only.
- [ ] Reduced motion, colour-blind mode (with the hazard cue), HUD size and haptics each do what the decisions say; the Comfort tab's hints say so in plain words.
- [ ] The pad's default bindings behave exactly as before; a remap survives a reload.
- [ ] `touch` is on by default; the smoke, controller and touch e2e projects are green.
- [ ] Budgets hold (app JS ≤ 600 KB gzip; zero added draw calls).

**Device gate (`VITE_FEATURES=expansion npm run ios:sync`), iPhone 18 Pro Max and iPad Air, no pad:**
1. **Tilt on curled road:** Cryo Station (the pipe) and Abyss Line (the Spine) by tilt. Tilting right always steers right on the screen, also upside down. Calibrate once while leaning back.
2. **The Storm Cup by touch** (slider), start to final standings: 60 fps, p95 no more than 1 ms above the build before.
3. **Menus by touch only:** create a profile, buy and fit a part, change the livery, start a cup, close and reopen the app, CONTINUE CUP.
4. Reduced motion, colour-blind mode and EXTRA LARGE once each in a race: readable, nothing cut off.

**As built (2026-11-19, branch `v2/m7c-comfort`):**
- **Tilt:** `physics/tilt.ts` (`deviceRoll`, `tiltSteer`, `calibratedNeutral`) and `physics/TiltInput.ts` (`requestTiltPermission`, `isIOS`, smoothing at 20/s, fresh for 0.5 s).
  - **Angles:** `screen.orientation.angle` is the content's counter-clockwise rotation (90 = the device's top to the left).
  - **iOS sign:** iOS readings are negated in one place (`TiltInput`'s `sign`), because WebKit reports the gravity acceleration and the spec reports its reaction.
  - **Not verified:** **neither the iOS sign nor whether WKWebView needs anything beyond `DeviceMotionEvent.requestPermission()` was checked against current docs or a device** (no docs tool in this session). The device gate's tilt step settles both. `@capacitor/motion` and `NSMotionUsageDescription` were not added; `docs/IOS_TESTFLIGHT.md` says what to do if iOS needs them.
  - **Each fixed step** in a race, `App.stepTilt` hands the smoothed steer to `TouchInput.externalSteer` while tilt is chosen and fresh, and sets `TouchRig.tiltActive` / `tiltFlat`.
  - **Tilt mode in `TouchControls`:** no steering zone; the two air-brakes (72) sit in the steering thumb's corner; the "⟲ HOLD THE DEVICE UPRIGHT" chip shows when the screen lies flat.
  - **Grid card:** it shows ENABLE TILT (`HudActions.tilt`) while tilt is chosen and no motion data arrives.
  - **App methods:** `App.enableTilt()` (falls back to the slider with a toast) and `App.calibrateTilt()`.
- **Controls tab:**
  - **TOUCH section first** on a touch screen (a coarse pointer, or touch as the device): steering, sensitivity of the active mode, CALIBRATE TILT, auto-accelerate, air-brakes, button size, left-handed.
  - **HAPTICS** always shows.
  - **KEYBOARD section** once a key was used, or on a fine pointer (`App.keyboardSeen`).
  - **GAMEPAD section** while a pad is connected (`App.padConnected`), with "press a button" capture and RESET BUTTONS. During capture `App.capturePadButton()` pauses menu navigation, so Ⓐ can be captured too.
  - **`?airbrake=` is gone.**
- **Pad remapping:** `InputManager.setPadBindings()` drives the eight controls through `padBindings`. Throttle and brake keep the trigger's analog travel; the rest are pressed or not. The menu edges (Ⓐ, Ⓑ, START, d-pad navigation) and the garage orbit keep their fixed buttons. `InputManager.padButtonsDown()` serves the capture. `Settings.bindPad` / `resetPadBindings` follow `bindKey`'s rules and refuse START (`PAD_START`, it always pauses).
- **Menus by touch** (`ui/ui.css`):
  - **44-point minimum:** under `html.mz-touch` or `html.mz-coarse` (set at boot on a coarse pointer), every `#ui` button, tab, radio and input, and the HUD's `.mz-btn` / `.mz-chip`, is at least 44 × 44. Tab rows keep their labels' width and wrap.
  - **Scrolling:** `touch-action: pan-y` and momentum scrolling on `.mzu-body` / `.mzu-garage-body`; no page overscroll.
  - **Hidden on touch:** hint rows and focus rings under `mz-touch`.
  - **Garage pinch:** two pointers zoom (`pinchZoom` in `ui/garageModel.ts`, ln-ratio × 1.5 wheel steps).
  - **Name field:** scrolls into view 0.3 s after focus.
- **Comfort:**
  - **Reduced motion:** every animation and transition in the HUD, the menus and the rotate overlay is off under `html.mz-reduced-motion` (one rule in `ui/tokens.css`, not a class list). The countdown digits and toasts then simply appear and go.
  - **First save:** reduced motion starts on when `prefers-reduced-motion: reduce` matches (`SaveStore.firstLaunch`).
  - **Colour-blind:** the `--mz-good/warn/bad/player/rival` tokens; every lime, amber and red in `game/hud.css` uses them.
  - **Minimap shapes** in every mode: the player a triangle along its heading, the leader a diamond, the others circles. In colour-blind mode the player is blue and the rivals orange.
  - **Hazard cue:** `game/HazardCue.ts`, pure. It has one spot per ice patch, main-loop gate, mine field and debris field, and one per lightning, geyser and jet point, all on the same timelines. The `.mz-hazard` chip sits under the position, clear of the toasts. It shows in colour-blind mode only, never on a split path, and adds no draw calls.
  - **HUD size:** `--u` × `--mz-hud-scale` (1 / 1.15 / 1.3). The Comfort tab's HUD SIZE replaces LARGE TEXT.
  - **HAPTICS off** also stops `Rumble` (`Rumble.enabled`).
- **`touch` is on by default.** The touch e2e runs without `?features=`.
- **Tests:**
  - unit tests for `tilt`, `TiltInput`, `HazardCue` (one per hazard kind on its real track), pad remapping in `InputManager` and `Settings`, `pinchZoom`, `Rumble` with haptics off, and `SaveStore.firstLaunch`;
  - the touch e2e gains "every menu target is at least 44 × 44" (create, menu, profiles, worlds, Grand Prix, every settings tab, every garage tab, plus a garage purchase and a paint change by taps) and "race screens by touch" (a cup started by taps, pause and results panels at 44 points).
- **Changes nobody asked for:**
  - **Updated tests:** `__features.test.ts`'s list of shipped flags gains `touch`, and `e2e/menus.spec.ts` picks HUD SIZE LARGE instead of the LARGE TEXT switch.
  - **Hazard chip placement:** the chip sits under the position, not in the centre, because the race's toasts use the centre.
- **Screenshots:** `docs/v2/shots/m7c/` has every screen at EXTRA LARGE (956 × 440) and colour-blind mode on Orbital Ring with the hazard cue and the minimap shapes.

**What needs the owner in M7:** the three device gates above, and the default air-brake style (M7b). Everything else is built without questions.

---

## M8 — Progression, modes, ghosts → 2.0 complete — ✅ DONE (designed 2026-11-16; M8a built 2026-11-20; M8b 2026-11-21; M8c and M8d 2026-11-22)

SPEC §12 says what and why. This section is the how. **Design decisions (design interview with the owner, 2026-11-16; settled, don't re-open)** are listed per PR below. M8 gives the game its main path (World Tour), Time Trial with ghosts, the championship season, a first-race tutorial, and the release called "MachZero 2.0".

**Four PRs, in build order, each stacked on the one before (M8a on the last M7 PR, or on `main` once M7 is merged):**

| # | PR | Branch | Save | Flag | Needs from the owner |
|---|---|---|---|---|---|
| M8a ✅ | World Tour, the world map, the results screen | `v2/m8a-world-tour` | v8 → v9 | behind `modes` | Look approval of the map and the results screen; device check |
| M8b ✅ | Time Trial and ghosts | `v2/m8b-time-trial` | — | behind `modes` | Device gate (fps with two ghosts) |
| M8c ✅ | The championship season and the tutorial | `v2/m8c-season-tutorial` | — | behind `modes` | Device check; a child or a new player tries the tutorial if one is at hand |
| M8d ✅ | Balance pass, flags on, flag clean-up, the "MachZero 2.0" release PR | `v2/m8d-release` | — | `modes` → on; six flags removed | The full QA checklist on both devices; the merge |

**Release order (agreed):** M7a → M7b → M7c → M8a → M8b → M8c → M8d. The world looks (X4–X6) and X7 are built whenever their images or approvals arrive. They block nothing, and M8 does not wait for them.

**Facts checked on 2026-11-16 (`v2/x6-abyss-line`):**
- **Save versions:** M7a takes v8. M8a takes **v9**.
- **Today every world and every cup is open.** `WorldSelect.tsx` shows `worldsFor(features)`; `CupDef` has no `requires` field. `Profile.records[trackId].bestLap` is the only per-world progress a v7 or v8 save holds.
- **The results panel is part of the HUD** (`game/HUD.ts`, plain DOM), not a menu screen. `App.bindStats` pays a race on `race:results` through `settleRace` and emits `economy:credits`.
- **`game/modes/Championship.ts` is pure and unused** (`seasonCups`, `seasonStandings`, `seasonFinished`, `seasonChampion`).
- **`MEDAL_CREDITS`** (300 / 600 / 1,000) is in `content/economy.ts` and unused. `MENU_PLACEHOLDERS` (`app/routes.ts`) holds the TIME TRIAL "coming soon" card behind `modes`.
- **A solo race works already:** `sim/partsBalance.sim.test.ts` runs `RaceManager` with one ship.
- **Flags:** nothing reads `tiers` or (before M7b) `touch`. `profiles`, `garage` and `worlds` are on and have readers in `App.ts`, `MainMenu.tsx` and `routes.ts`. `modes` only shows the placeholder card.
- **Measured race lengths:** a 3-lap race lasts 81 s (Cryo Station) to 116 s (Orbital Ring).
- **Measured credits per race** (headless, 8 tracks, an autopilot at the tier's own skill standing in for the player):

  | Tier | Stock | Mk II kit | Mk III kit |
  |---|---|---|---|
  | Rookie (Rookie preset) | 940 (P1–P2) | | |
  | Pilot | 800–860 (P2–P4) | 890 | |
  | Ace | 290–360 (P4–P8) | 710 | 970 |
  | Legend | 270 (P7–P8) | 320 | 600 |

  **Correction (M8d, 2026-11-22):** the two kit columns are one tier too low. They were measured with `PartTier` 2 and 3, which are Mk III and Prototype (`TIER_NAMES`). M8d measured the same numbers on this design commit and on today's code: Ace 359 (Mk II), 706 (Mk III), 970 (Prototype); Legend 321 (Mk III), 604 (Prototype); Pilot 858 (Mk II). The design decisions still hold with the right labels (a player saving for the Prototype kit races Ace on a Mk III kit). §M8d "As built" has the details.

- **Kit prices:** one part in each of the 5 slots costs 3,000 (Mk II), 7,500 (Mk III), 16,000 (Prototype). Every part and variant costs 47,700.
- **Measured solo times** (a Legend autopilot alone on the track, COMET, 3 laps, seconds). "Dev" is the dev-ghost ship: `RIVAL_FITS.legend`, variant A.

  | Track | Dev | Stock | Mk II kit | Mk III kit | Prototype kit |
  |---|---|---|---|---|---|
  | neon-bay | 91.79 | 95.52 (×1.041) | 94.55 (×1.030) | 92.97 (×1.013) | 91.35 (×0.995) |
  | sunset-mesa | 92.11 | 97.06 (×1.054) | 95.80 (×1.040) | 93.92 (×1.020) | 91.88 (×0.997) |
  | cryo-station | 77.38 | 80.74 (×1.043) | 79.88 (×1.032) | 78.43 (×1.013) | 77.25 (×0.998) |
  | jade-ruins | 103.89 | 110.08 (×1.060) | 109.18 (×1.051) | 105.11 (×1.012) | 104.60 (×1.007) |
  | orbital-ring | 109.06 | 112.57 (×1.032) | 112.01 (×1.027) | 110.78 (×1.016) | 108.87 (×0.998) |
  | tempest-spire | 93.58 | 97.71 (×1.044) | 96.36 (×1.030) | 94.65 (×1.011) | 93.87 (×1.003) |
  | cinder-forge | 98.19 | 103.23 (×1.051) | 101.70 (×1.036) | 99.55 (×1.014) | 97.99 (×0.998) |
  | abyss-line | 101.29 | 105.80 (×1.045) | 104.24 (×1.029) | 102.54 (×1.012) | 100.61 (×0.993) |

**Rules for every M8 PR** (in addition to §0):
- **`main` stays as it is until M8d.** With `modes` off the menu, the world select and the open cups are unchanged. The save migration runs for everyone, and nothing reads the new fields while the flag is off.
- **No real money, no online features** (SPEC non-goals).
- **Sounds:** M8 adds none. Each step that wants a sound names a **sound hook**: emit the bus event and leave the sound to M6. The hooks are listed in M8a step 8.
- **Budgets:** app JS ≤ 600 KB gzip; `public/game` ≤ 15 MB. The world map and every new screen are DOM and SVG: no draw calls. A ghost is one draw call. Device gates: 60 fps, with p95 no more than 1 ms above the build before the PR.
- Every sim file stays under 60 s on CI. An assertion is never loosened to go green.
- Every new screen works with pad, keyboard and touch (targets of at least 44 points, M7c's test).
- **The `expansion` flag stays off** until each new world's look is approved (the owner's decision on #39). Every rule below is written for "the worlds the player can see" (`worldsFor(features)`), so 2.0 can ship with 5 worlds and grows to 8 with no further change.

---

### M8a — World Tour, the world map, the results screen (save v9) — ✅ BUILT (PR #45, `v2/m8a-world-tour`; waiting on the owner's look approval and device check)

**Design decisions:**
- **World Tour is the world map.** The main menu becomes, in order: CONTINUE CUP (when a cup is running), **WORLD TOUR**, GRAND PRIX, TIME TRIAL, GARAGE, SETTINGS. RACE and WORLDS go away. There is no separate single-race mode.
- **The unlock chain:** the visible worlds unlock in tour order. World 1 is always open. **A top-3 finish at any tier clears a world and opens the next one.** Worlds 6–8 continue the same chain after world 5.
- **Trophies:** a top-3 finish at a tier earns that world's trophy for that tier **and every lower tier**. "Cleared" means the world has at least one trophy.
- **Rookie never grinds:** the Rookie-preset stand-in finishes P1–P2 on every track in the sims, so 8 races clear the Tour.
- **Old saves:** a migrated profile keeps every world up to the last one it has a lap record on (a "granted" world: open, with no trophy yet). Cup trophies are untouched.
- **Cups:** the Neon Cup opens when Orbital Ring is cleared; the Storm Cup when Abyss Line is cleared. A profile that already holds a trophy of a cup keeps that cup open.
- **Rewards:** race payouts and the tier multiplier are unchanged. **The first clear of a world pays 1,000 credits, once per world** (no tier multiplier). The cup bonus stays 3,000 × the tier multiplier.
- **The world map** shows the visible worlds as planets on a starmap, joined by a path in tour order. Each planet shows its lock, its four tier trophies, the best lap and the best medal. Picking a world opens its card: the tier picker, RACE, and TIME TRIAL (from M8b).
- **A locked world** shows its name and gimmick and the line "Finish top 3 on <previous world> to unlock".
- **The old v1 track** and the bonus tracks stay reachable only by `?seed=N`. No menu entry.
- **The results screen** is a menu screen: a credit tally line by line, then any unlock or trophy, then the winner's quote. Buttons: NEXT WORLD (when one was just unlocked), RACE AGAIN, GARAGE, WORLD MAP.

**Save v9 (this PR carries every M8 field, so M8b and M8c need no migration):**

```ts
// save/schema.ts
export const SAVE_VERSION = 9;
export type Medal = 'bronze' | 'silver' | 'gold';

export interface TrackRecord {
  bestLap?: number;
  /** Time Trial: best 3-lap total (s) and the best medal reached. */
  trialTime?: number;
  medal?: Medal;
}

export interface TourState {
  /** Worlds opened by the 8 → 9 migration (raced before World Tour existed). */
  granted: WorldId[];
  /** World Tour trophies: tiers at which the world was finished in the top 3 (lower tiers filled in), in tier order. */
  trophies: Partial<Record<WorldId, AITier[]>>;
}

export interface SeasonState {
  tier: AITier;
  /** The season's finished cups, in order. The cup in progress is Profile.cup. */
  done: CupState[];
}

export interface Profile {
  // …unchanged fields…
  tour: TourState;             // default { granted: [], trophies: {} }
  season: SeasonState | null;  // default null (M8c)
  champion: AITier[];          // Champion trophies, in tier order; default [] (M8c)
  tutorialDone: boolean;       // default false for a new profile (M8c)
}

export interface SettingsData {
  // …unchanged fields…
  ghosts: { best: boolean; dev: boolean }; // default both true (M8b)
}
```

- **Migration 8 → 9** (`save/migrations.ts`), per profile:
  - `tour.granted` = every world whose `order` is ≤ the highest `order` among the worlds with `records[trackId].bestLap`; empty when there is no such record. (World 1 needs no grant.)
  - `tour.trophies = {}`, `season = null`, `champion = []`.
  - `tutorialDone = stats.races > 0`.
  - `settings.ghosts = { best: true, dev: true }`.
- **Sanitizers:** unknown world ids and tiers are dropped; trophies are sorted in `AI_TIERS` order with no duplicates; `season` is dropped when its tier is unknown or a `done` cup fails `sanitizeCup`; `medal` must be one of the three; `trialTime` must be a positive finite number.

**Build steps (tests first):**
1. **Save v9.** `SaveStore` tests first: a v8 profile with lap records on worlds 1, 2 and 4 loads with `granted` = worlds 1–4; a profile with no records loads with `granted: []`; trophies and credits are untouched; bad `tour`, `season` and `medal` values fall back to the defaults; an export from v9 imports unchanged. Then the schema, the migration and `createProfile`.
2. **`game/modes/WorldTour.ts`** (new, pure), unit tests first:

   ```ts
   export const FIRST_CLEAR_BONUS = 1000;
   export const CLEAR_POSITION = 3;
   export function tourWorlds(features: { expansion: boolean }): readonly WorldDef[];           // worldsFor, in order
   export function worldCleared(tour: Readonly<TourState>, id: WorldId): boolean;
   export function worldUnlocked(tour: Readonly<TourState>, id: WorldId, worlds: readonly WorldDef[]): boolean;
   export function tourTrophies(tour: Readonly<TourState>, id: WorldId): readonly AITier[];
   export interface TourResult { tour: TourState; firstClear: boolean; newTrophies: AITier[]; unlocked: WorldId | null; bonus: number }
   export function bookTourRace(tour: Readonly<TourState>, id: WorldId, tier: AITier, me: RacerStanding | undefined, worlds: readonly WorldDef[]): TourResult;
   ```

   - `worldUnlocked`: the first visible world; or a granted world; or the visible world before it is cleared.
   - `bookTourRace`: a clear needs `me.status === 'finished'` and `me.position ≤ 3`. It adds the tier and every lower tier. `firstClear` is true when the world had no trophy. `unlocked` is the next visible world when this race opened it (it was locked before), else null. `bonus` is 1,000 on a first clear, else 0.
   - Tests: 4th place changes nothing; a destroyed ship in 3rd changes nothing; an Ace clear gives Rookie, Pilot and Ace; a second clear pays no bonus; a granted world that is cleared later still pays its bonus once; the chain with 5 and with 8 visible worlds; a world hidden by the flag neither blocks nor unlocks anything.
3. **Cup unlocks** (`content/cups.ts`): `CupDef` gains `requires: WorldId` (`neon` → `orbital-ring`, `storm` → `abyss-line`). `cupUnlocked(cup, profile)` is true when `requires` is cleared **or** the profile holds any trophy of that cup. `ui/screens/GrandPrix.tsx` shows a locked cup as a card with a padlock and "Clear <world> to unlock"; `App.startCup` refuses a locked cup. With `modes` off every cup is open, as today. Tests for each case.
4. **The world map** (`ui/screens/WorldMap.tsx`, new; route `{ name: 'tour' }`):
   - One SVG, `viewBox="0 0 1000 480"`, over the menu backdrop. Planet centres, in tour order: (90,330) (230,170) (380,300) (520,130) (650,310) (770,150) (870,300) (940,110). A hidden world's planet is not drawn; the path ends at the last visible world.
   - A planet is a circle filled with the world's `ui.from → ui.to` gradient, with its order number. Radius 34; the picked planet 42 with a ring. A locked planet is grey with a padlock. The path is a dashed polyline, bright up to the last unlocked world.
   - Under each unlocked planet: four trophy pips (filled for a held tier, in the tier's colour **and** with the tier's initial, so colour alone tells nothing) and a medal dot once M8b lands.
   - The world card (a side panel on a wide screen, a bottom sheet under 500 points tall): name, tagline, gimmick chip, the mini map (move `miniMap` from `WorldSelect.tsx` to `ui/miniMap.ts`), best lap, trophies, the `TierPicker`, and RACE. For a locked world: the padlock line and no RACE.
   - Navigation: left and right move along the chain; confirm opens the card; in the card up and down move between the tier picker and RACE; back closes the card, then returns to the menu. Taps do the same. The planet of `profile.world` has focus on entry.
   - With `modes` on, `MainMenu.tsx` shows WORLD TOUR (sub-line: `<cleared> OF <visible> WORLDS CLEARED`) in place of RACE and WORLDS, and `App.openWorlds` opens the map. `WorldSelect.tsx` stays for `modes` off and is deleted in M8d.
   - `App.selectWorld` refuses a locked world.
5. **Booking a Tour race** (`App.bindStats`): on `race:results`, for a race that is not a cup race, a Time Trial or a `?seed` race, call `bookTourRace` inside the same save update as `settleRace`, and add `bonus` to the credits. Build an `app.lastResult` signal (step 6) from the outcome. A cup race books the cup as today and **also** books the Tour (a top 3 in a cup race clears that world).
6. **The results screen** (`ui/screens/Results.tsx`, new; route `{ name: 'results' }`):

   ```ts
   export interface TallyLine { label: string; amount: number }
   export interface RaceResult {
     mode: 'tour' | 'cup' | 'trial';
     worldId: WorldId; tier: AITier;
     standings: RacerStanding[]; playerId: ShipId;
     tally: TallyLine[];            // e.g. "2ND PLACE" 750, "PILOT ×1.3" 230, "FIRST CLEAR" 1000, "CUP BONUS" 3900
     credits: number;               // the profile's credits after the tally
     unlocked: WorldId | null; newTrophies: AITier[];
     medal?: { reached: Medal | null; previous: Medal | null; time: number; best: boolean }; // M8b
     quote: { pilot: string; text: string } | null; // the winner's catchphrase when a rival won
   }
   ```

   - Layout: the standings table (as the HUD panel has it: position, portrait, name, time) on the left; on the right the tally lines appearing one after another (0.35 s apart), a credit counter that runs up to the total, then the unlock card ("TEMPEST SPIRE UNLOCKED" with the planet) and trophy pips, then the quote.
   - Any input shows everything at once. With reduced motion everything is shown at once from the start.
   - Buttons: NEXT WORLD (only when `unlocked` is set; it selects that world and opens its card), RACE AGAIN, GARAGE, WORLD MAP. In a cup race the buttons are STANDINGS only, as today's rule says.
   - `HUD` gains the option `results: false`: with menus on, the HUD does not build its own results panel, and `App` moves to the `results` route when `race:results` arrives (after the existing results delay). The no-menu flows (`?autopilot=1`, `?seed=N`) keep the HUD panel.
   - `App.fixed`'s results handling (confirm, back, restart) moves to the screen's buttons.
7. **Tests:**
   - `sim/worldTour.sim.test.ts` (new): the Rookie-preset stand-in (`runWorldRace(…, { player: { tier: 'rookie', pace: 1, assisted: true } })`, Rookie hazards) races the 8 worlds in order and `bookTourRace` after each: after 8 races all 8 worlds are cleared and 8 first-clear bonuses were paid. It may reuse the per-world balance races' results through a shared helper so no race is run twice in one file.
   - e2e (`e2e/worldtour.spec.ts`, `?features=modes`): a new profile sees world 1 open and world 2 locked; a save fixture with world 1 cleared shows world 2 open; the card's RACE starts a race; an autopilot race to the end shows the results screen with a tally; a v8 fixture with records on three worlds shows three worlds open.
8. **Sound hooks** (add to `core/events.ts`; `AudioSystem` ignores them until M6): `results:tally { amount }` (each line), `results:total { credits }`, `results:unlock { worldId }`, `results:trophy { tier }`, `results:medal { medal }`, `results:champion { tier }`, `ui:locked {}` (a tap on a locked world or cup), `tutorial:step { step }`, `tutorial:done {}`.

**Done when:**
- [x] With `?features=modes`: a new profile clears Neon Bay with a top 3, sees the tally with FIRST CLEAR 1,000 and the unlock card, and NEXT WORLD opens Sunset Mesa's card (`e2e/worldtour.spec.ts`).
- [x] 4th place pays its credits and unlocks nothing (`WorldTour.test.ts`; the tally pays the position line regardless).
- [x] An Ace top 3 shows the Rookie, Pilot and Ace pips (`WorldTour.test.ts`; the results screen draws `newTrophies` as pips).
- [x] A v8 save loads as v9: the worlds it raced are open, and its cup trophies keep their cups open (unit and e2e).
- [x] The Neon Cup is locked for a new profile and opens when Orbital Ring is cleared (unit and e2e).
- [x] With `modes` off nothing changes on the live site (the existing e2e tests pass; two existing unit tests changed only for the new version number and the new `requires` field, see below).
- [x] Map, card and results work with pad, keyboard and touch; the 44-point test covers them (`touch.spec.ts`).

**Device check:** on the iPhone and the iPad (`VITE_FEATURES=modes,expansion`), by pad and by touch: the map with 8 worlds, a locked world's message, a race from the card, the results screen, NEXT WORLD. **The owner approves the look of the map and the results screen.** No fps gate: nothing in a race renders differently.


**As built (branch `v2/m8a-world-tour`)** (read before M8b):
- **Files:** `game/modes/WorldTour.ts` (the rules), `game/modes/raceResult.ts` (`RaceResult`, `raceTally`, `winnerQuote`), `ui/screens/WorldMap.tsx`, `ui/screens/Results.tsx`, `ui/miniMap.ts` (moved out of `WorldSelect.tsx`); `App` gains `events` (the menu bus), `lastResult`, `resultsScreen`, `openTourCard`/`takeTourCard`, `raceAgain`, `leaveResults`, `resultsNextWorld`, `resultsStandings`. Routes `tour` and `results`.
- **Save v9** carries every M8 field (`tour`, `season`, `champion`, `tutorialDone`, `records[].trialTime`/`medal`, `settings.ghosts`), as designed.
- **Decisions made while building (none re-opens a design decision):**
  - **Progress further along the chain opens every world before it.** `worldUnlocked` is true for the first world, a granted world, the world after a cleared one, *and* any world before a cleared or granted one. So the open worlds are always a run from world 1, whatever order the save got its progress in.
  - **With `modes` off a race books nothing on the Tour and pays no bonus** (the live economy is unchanged), **but a world raced is added to `tour.granted`**, as the 8 → 9 migration does. A player who races new worlds before M8d turns `modes` on keeps them open.
  - **A season's finished cups needed their own sanitizer path:** `sanitizeCup` drops a finished cup (a cup is settled at its last race), so the spec's "a `done` cup fails `sanitizeCup`" would have dropped every season. `sanitizeCup(v, tiers, finished = true)` accepts a cup only when every race is recorded.
  - **The sound hooks are a separate `MenuEvents` map** on `App.events` (the race's `GameBus` lives only as long as a race), so `GameEvents` and its test fixtures are untouched.
  - **The map's planets are HTML buttons laid over the SVG** (an SVG element has no `click()` for pad confirm). Left and right follow the chain through a new, generic `data-nav-<dir>="<selector>"` attribute in `ui/nav.ts` (the nearest-element rule skipped world 2 from world 1 on the zig-zag).
  - **The world card makes the map `inert`** while it is open, on both layouts; on a screen under 500 points tall it is a bottom sheet inside the map's box (the screen panel's transform makes `position: fixed` unusable).
  - **The results screen's "any input" listeners are registered in a layout effect**, so even an input in the screen's first frame is taken by the tally (the e2e probes it with a mount observer). A pad action reaches it through a cancelable `mz-nav` window event the UI root sends first.
  - **`resultsScreen`** is `menus && modes && worlds && no ?seed`: `?autopilot=1` and `?seed=N` keep the HUD panel, as designed.
- **Existing tests changed:** `SaveStore.test.ts` (two v7 → v8 tests now expect `SAVE_VERSION`, since a v7 save migrates on to v9), `Championship.test.ts` (its `CupDef` fixtures gain `requires`), `nav.test.ts` (the fake element gains `getAttribute` for the new attribute; plus a test for it). No assertion was loosened.
- **Measured:** the World Tour sim (`sim/worldTour.sim.test.ts`, two legs, ~26 s locally): the Rookie-preset stand-in finishes P1 on six worlds and P2 on Cryo Station and Cinder Forge; eight clears, eight bonuses. App JS 362.3 KB gzip (+5.1 KB).
- **Owner:** the look of the map and the results screen; the device check above.

---

### M8b — Time Trial and ghosts — ✅ BUILT (PR #46, `v2/m8b-time-trial`, base `v2/x6-abyss-line` (#39's head, which holds M7 and M8a since #44 and #45 merged); waiting on the owner's device gate)

**Design decisions:**
- **Time Trial:** solo, 3 laps, on any track whose world is unlocked, with the player's own ship and parts. No rivals, no items. RESTART at any time.
- **Assists are allowed and medals still count.** Hazards follow the same rule as in a race (the Rookie rules with No-KO on, else normal).
- **A ghost is a pose recording** (position and rotation at 20 Hz), not an input replay. It does not depend on the physics giving the same result on the iPhone and the desktop.
- **Storage:** one best ghost per track per profile, in IndexedDB. A profile export does **not** include ghosts; best times and medals are in the export.
- **Dev ghosts** are baked for all 8 tracks from a solo Legend autopilot on a COMET with the Legend rival parts (`RIVAL_FITS.legend`, variant A), and committed.
- **Medals** are measured against the dev ghost's total time, the same for every ship and kit, and count whatever tier the profile is set to:

  | Medal | Total time | Who reaches it (from the table at the top of §M8) |
  |---|---|---|
  | Gold | ≤ dev × 1.02 | Near-Prototype parts and clean driving (a perfect Mk III lap just makes it) |
  | Silver | ≤ dev × 1.06 | About Mk II to Mk III parts (a perfect stock run just makes it) |
  | Bronze | ≤ dev × 1.12 | Stock parts, with 6% or more in hand over a perfect stock run |

  This replaces the first sketch's 1.02 / 1.08 / 1.18: the measured gap between stock and Prototype is only 5%, so the old silver and bronze would have asked for nothing.
- **Each medal pays once per track:** 300 / 600 / 1,000 (`MEDAL_CREDITS`). A run pays every medal it newly reaches (gold on a first run pays 1,900).
- **Both ghosts show by default**, each with an on/off toggle (`settings.ghosts`).
- **A ghost is translucent and unlit, one draw call**, and fades out near the camera.

**Ghost format (`game/ghost/ghostCodec.ts`):**

```ts
export const GHOST_HZ = 20;      // one sample every 6 fixed steps (FIXED_DT = 1/120 s)
export const GHOST_VERSION = 1;
export interface GhostData {
  version: 1; trackId: string; chassisId: string;
  totalTime: number; lapTimes: number[];
  count: number;
  min: [number, number, number]; size: [number, number, number]; // the samples' bounding box (m)
  pos: Int16Array;   // 3 per sample: (p − min) / size, scaled to −32767..32767
  quat: Int16Array;  // 3 per sample: the three smallest components × √2, scaled to ±32767
  largest: Uint8Array; // 1 per sample: the index of the dropped (largest) component, made positive
}
export function encodeGhost(g: GhostData): ArrayBuffer;   // a small JSON header (length-prefixed) + the three arrays
export function decodeGhost(buf: ArrayBuffer): GhostData | null; // null on a bad or unknown version
```

- 13 bytes per sample: an 81–116 s run is **21–30 KB**. (The first sketch said 20 KB at 18 bytes per sample; that would be 29–42 KB.) Eight dev ghosts are about 210 KB of `public/game`.
- Position error is under 2 cm on a track 1.3 km across.

**Build steps (tests first):**
1. **Codec and recorder** (`game/ghost/ghostCodec.ts`, `game/ghost/GhostRecorder.ts`, `game/ghost/GhostPlayer.ts`; unit tests first):
   - `GhostRecorder`: `start()`, `sample(ship)` called every fixed step (it keeps every 6th), `finish(totalTime, lapTimes): GhostData`. It grows its arrays in blocks; no allocation per sample.
   - `GhostPlayer(ghost)`: `pose(t, outPos, outQuat): boolean` gives the pose at race time `t` (linear for position, normalised linear for rotation); false after the ghost's end.
   - Tests: encode → decode is exact; a recorded circle plays back within 2 cm and 0.5°; a truncated buffer decodes to null; the size of a 100 s recording is under 30 KB.
2. **`save/GhostStore.ts`** (new): `get(profileId, trackId): Promise<GhostData | null>`, `put(profileId, trackId, ghost)`, `deleteProfile(profileId)`. Database `machzero-ghosts`, version 1, object store `best`, key `<profileId>:<trackId>`, value the encoded `ArrayBuffer`. Plain IndexedDB, no library. When IndexedDB is missing or fails, an in-memory map is used and nothing throws. `App.deleteProfile` calls `deleteProfile`. Tests with the dev dependency `fake-indexeddb` (dev only; it never reaches the bundle): put → get, the better ghost replaces the old one, a profile's ghosts are deleted, the fallback.
3. **`game/modes/TimeTrial.ts`** (new, pure), unit tests first:

   ```ts
   export const MEDAL_FACTORS = { gold: 1.02, silver: 1.06, bronze: 1.12 } as const;
   export function medalTimes(devTime: number): Record<Medal, number>;
   export function medalFor(total: number, devTime: number): Medal | null;
   /** Credits for the medals reached now and not held before. */
   export function medalPayout(previous: Medal | null, reached: Medal | null): number;
   export function bookTrial(rec: Readonly<TrackRecord>, total: number, devTime: number): { record: TrackRecord; pay: number; best: boolean; reached: Medal | null };
   ```

4. **Dev ghosts and times:**
   - `npm run ghosts:bake` runs `BAKE_GHOSTS=1 vitest run src/sim/ghostBake.sim.test.ts`. For each track in `TRACK_DEFS` it runs the solo dev race (COMET, `RIVAL_FITS.legend`, variant A, tier `legend`, personality `steady`, seed 12345, normal hazards; the harness in `sim/partsBalance.sim.test.ts` is the model: move it to `sim/soloRace.ts`), records the ghost, and writes `public/game/ghosts/<trackId>.bin` and the generated file `src/content/devTimes.ts` (`export const DEV_TIMES: Readonly<Record<string, number>>`). Commit both.
   - Without `BAKE_GHOSTS` the same file is a guard: for each track, a fresh solo dev run is within 0.5% of `DEV_TIMES[trackId]`, and the committed `.bin` decodes with the same `totalTime`. A failure means "the track or the physics changed: run `npm run ghosts:bake`".
   - The times in the table at the top of §M8 are what the bake should give today.
   - `scripts/check-size.mjs` already counts `public/game`.
5. **The Time Trial race** (`App`, `RaceSession`):
   - `RaceSetup` gains `trial?: { ghosts: { kind: 'best' | 'dev'; data: GhostData }[] }`. In a trial the field is the player alone (`buildRaceField` with `rivals: 0`, a new option), `items` is undefined, and the grid slot is pole.
   - `RaceSession` owns a `GhostRecorder` in a trial, samples the player in `fixed`, and on the player's finish hands the `GhostData` to `App`. It gives the ghost poses for the frame to the graphics through `FrameContext.ghosts` (a reused array of `{ kind, position, quaternion, visible }`).
   - `App.startTrial(worldId)`: loads the two ghosts (the best from `GhostStore`, the dev ghost by `fetch` of `ghosts/<trackId>.bin`, cached), honours `settings.ghosts`, builds the race. A missing ghost is simply not shown.
   - On `race:results` in a trial: `bookTrial`, pay the medals, save the ghost when `best`, and show the results screen with `mode: 'trial'` (the tally lines are the medals paid; the standings table is replaced by lap times, the total, the three medal times and the gap to the best).
   - RESTART is offered on the pause panel and on the results (RACE AGAIN). The grid intro card is skipped in a trial.
6. **`graphics/GhostShips.ts`** (new): for each ghost, one mesh: the chassis' merged hull geometry (the path rivals use on Low: one geometry per ship) with a single `MeshBasicMaterial` (`transparent`, `opacity 0.35`, `depthWrite: false`, fog on). Colour: the best ghost cyan `#19f0ff`, the dev ghost gold `#ffc23a`; in colour-blind mode blue and orange, and the dev ghost also carries a small "DEV" tag sprite drawn in the HUD layer (DOM, no draw call). Opacity falls to 0 between 12 m and 4 m from the camera. No parts, no trail, no shadow, no bloom contribution beyond the material's own. **One draw call per ghost**; none when a ghost is off or past its end.
7. **HUD in a trial** (`game/HUD.ts`): no position, no items, no rival list on the minimap (ghosts show as hollow markers). The lap box adds TARGET: the next medal's total time and its icon. At each lap line a split shows the gap to the best ghost (`−0.42` green or blue, `+0.42` red or orange, with ▲ / ▼ so colour is not the only cue) for 3 s.
8. **The Time Trial screen** (`ui/screens/TimeTrial.tsx`; route `{ name: 'trial' }`; the menu's TIME TRIAL entry and the world card's TIME TRIAL button open it): one row per visible world: name, mini map, your best time, your medal, the three medal times. A locked world's row shows the padlock line. Two toggles: MY BEST GHOST, DEV GHOST. Remove the placeholder from `MENU_PLACEHOLDERS`. The world map's medal dot reads `records[trackId].medal`.
9. **Tests:**
   - `sim/medals.sim.test.ts` (new), using `sim/soloRace.ts` on all 8 tracks: a stock run is ≤ dev × 1.07 (bronze has 5% in hand); a stock run is > dev × 1.02 (gold is not free); a Prototype-kit run is ≤ dev × 1.01 (gold has 1% in hand); a Mk II-kit run is ≤ dev × 1.06 (silver is reachable). If a track fails, tune that track or the parts with the owner; do not move the factors per track.
   - e2e (`e2e/timetrial.spec.ts`, `?features=modes`): open TIME TRIAL, start Neon Bay on autopilot, finish, see a time and a medal state; start again and see `window.__machzero.ghosts()` report two ghosts with the best one present; reload and the best time is still there.

**Done when:**
- [x] A Time Trial run records a ghost; the next run shows it and the dev ghost; each toggle hides its ghost (`e2e/timetrial.spec.ts`; `RaceSession.test.ts`).
- [x] A better time replaces the ghost; a worse one does not (`GhostStore.test.ts`; `bookTrial` in `TimeTrial.test.ts`).
- [x] Medals are paid once each, and the results screen shows which were paid (the tally has one line per medal paid; `TimeTrial.test.ts`, the e2e).
- [x] The 8 dev ghosts and `devTimes.ts` are committed, and the guard test passes (`sim/ghostBake.sim.test.ts`).
- [x] The medal sims pass on all 8 tracks (`sim/medals.sim.test.ts`).
- [x] A ghost adds one draw call: at most one each, none off screen (the perf table in the PR body; `GhostShips.test.ts`).
- [x] Deleting a profile deletes its ghosts (`GhostStore.test.ts`; `App.deleteProfile`). An exported save imports on a clean browser with times and medals and no ghosts, without an error (`SaveStore.test.ts`).

**Device gate (`VITE_FEATURES=modes,expansion`), iPhone and iPad:** a Time Trial on Neon Bay and on Abyss Line with both ghosts on and the performance panel on: 60 fps, p95 no more than 1 ms above an 8-ship race on the build before. Close the app, reopen it, and the best ghost is still there.


**As built (branch `v2/m8b-time-trial`)** (read before M8c):
- **Files:**
  - `game/ghost/`: `ghostCodec.ts`, `GhostRecorder.ts`, `GhostPlayer.ts`, `GhostCapture.ts` (records one ship's run from the race bus; the Time Trial race and the bake both use it), `devGhosts.ts` (fetch and cache).
  - `save/GhostStore.ts`; `game/modes/TimeTrial.ts` (adds `nextMedal`, `medalTally`, `MEDAL_NAMES`); `graphics/GhostShips.ts`; `ui/screens/TimeTrial.tsx`.
  - Sims: `sim/soloRace.ts` (the harness, with `kit()` and `devLoadout()`), `sim/ghostBake.sim.test.ts`, `sim/medals.sim.test.ts`.
  - Content: `content/devTimes.ts`, `public/game/ghosts/*.bin`.
- **Plumbing:**
  - `buildRaceField` takes `rivals`.
  - `RaceManager` gains `time`: seconds since GO, still running after the player finishes, so the ghosts carry on.
  - `RaceSetup.trial = { ghosts, hud }`; `FrameContext.ghosts` (`GhostFrame`); `GraphicsSystem.setGhosts`, `ghostTag` and `setColorBlind`.
  - `HUD` takes `trial` (`TrialHud`); `Minimap.update` takes the ghosts.
  - `App`: `startTrial`, `openTimeTrial`; route `trial`. `MENU_PLACEHOLDERS` is empty.
- **Decisions made while building (none re-opens a design decision):**
  - **A ghost stores the rotation the ship is drawn with** (the body rotation with its visual bank), so a ghost leans into turns as the ship did.
  - **`GhostStore.put` keeps a ghost only when it is faster than the one held**, so the store itself guarantees "a worse run does not replace the ghost". The next trial waits for the last write, so RACE AGAIN always races the ghost just set.
  - **The best ghost is read even when MY BEST GHOST is off**: the splits are measured against it. The toggles are read when a trial starts.
  - **Trial hazards:** the Rookie rules with No-KO on, else normal, whatever the profile's tier (the design's parenthetical). The tier only sets the autopilot's skill.
  - **A trial pays only medals.** It does not count as a race in `stats`, pays no race credits and books nothing on the World Tour. Its laps still set the track's best lap record.
  - **TARGET** is the next medal above the one held; with gold held it shows the best total. The split is `▲ −0.42` (ahead) or `▼ +0.42` (behind), beside the lap box (the toasts use the space under it; in a trial they sit a row lower, under the taller lap box).
  - **The ghosts show during the countdown at their start pose** and play by race time. Ghost opacity fades by distance to the camera (12 m to 4 m); `MeshBasicMaterial`, fog on, `depthWrite` off, `renderOrder` 2.
  - **Ghost geometry:** the chassis' LOD1 hull with stock parts, merged into one position-only geometry, scaled by its class. Without ship assets it is a wedge.
  - **The DEV tag** is projected by `GhostShips` and drawn by the HUD (DOM): no draw call.
  - **Navigation:**
    - Pause → MENU in a trial, and the results' Ⓑ, go back to the Time Trial screen.
    - Trial results show the laps, the total, the gap to the best and the three medal times. The buttons are RACE AGAIN, TIME TRIAL and GARAGE.
    - The world card gains a TIME TRIAL button, and the map's planets show the medal held.
- **Existing tests changed:** `partsBalance.sim.test.ts` now uses `sim/soloRace.ts`; its assertions are unchanged. No assertion was loosened.
- **Measured:**
  - **Dev times:** 77.38 s (Cryo Station) to 109.06 s (Orbital Ring), the table at the top of §M8 to the hundredth.
  - **Ghost files:** 20–28 KB each, 212 KB for all 8.
  - **Medal sims:** stock ×1.032–1.060, Mk II ×1.027–1.051, Prototype ×0.993–1.007.
  - **Draw calls** (SwiftShader, Neon Bay, 9 s in):

    | Quality | 8-ship race | Trial with ghosts off | Trial with two ghosts |
    |---|---|---|---|
    | Low | 128 | 77 | 78 |
    | High | 173 | 96 | 97 |

    In both samples one ghost was off screen and culled.
  - **App JS:** 369.3 KB gzip (+7.0 KB).
- **Owner:** the device gate below.


---

### M8c — The championship season and the tutorial — ✅ BUILT (PR #48, `v2/m8c-season-tutorial`, base `main`; waiting on the owner's device check)

**Design decisions (championship):**
- **A season is every available cup, in `CUPS` order, at one tier.** With two cups that is 10 races.
- **It opens when the profile holds a trophy of every available cup, at any tier, and at least two cups are available.** With only the Neon Cup visible there is no championship entry.
- It sits on the GRAND PRIX screen as a third card, **CHAMPIONSHIP**.
- **Inside a season each cup plays exactly as a cup does** (points, grid order, retire rule, no restarts, the cup trophy and the cup bonus). After a cup's final standings comes the season table, then the next cup.
- **Scoring** is `Championship.ts` as built: the sum of cup points; ties break on cups won, then the best cup rank, then ship id.
- **Reward:** the player who ends the season in 1st gets the **Champion trophy** for that tier and **5,000 × the tier multiplier** credits, once per tier. A later win at a tier already held pays nothing more.
- **One thing at a time:** while a season runs, the menu shows CONTINUE SEASON, and a single cup cannot be started. A season can be abandoned (QUIT SEASON, with a confirm); nothing already paid is taken back.

**Design decisions (tutorial):**
- It runs **once per profile, on the first World Tour race, for a profile created with the Rookie preset.** A Classic profile gets a one-line note on its first race: "Tutorial: Settings → Race".
- **Prompts appear over the real race**; the race is never paused. Each prompt clears when the player does the action. There is a SKIP button, and the pause panel has SKIP TUTORIAL.
- The steps: **steer, boost, air-brake, pit, item.** Prompts show the last-used device's control (key, pad button or touch zone), with an icon as well as text.
- **So that the item step has an item, a profile's first tutorial race starts with one free Shield** if the profile holds no item.
- It can be replayed: Settings → Race → REPLAY TUTORIAL (it runs on the next World Tour race).

**Build steps (tests first):**
1. **Season state** (`game/modes/Championship.ts`, additions; unit tests first):

   ```ts
   export const CHAMPION_BONUS = 5000;
   export function seasonUnlocked(trophies: Readonly<Trophies>, cups?: readonly CupDef[]): boolean;
   export function newSeason(tier: AITier): SeasonState;
   export function seasonCup(season: Readonly<SeasonState>, cups?: readonly CupDef[]): CupDef | null; // the cup to play now
   export function bookSeasonCup(season: Readonly<SeasonState>, finished: CupState): SeasonState;
   export function championBonus(tier: AITier, held: readonly AITier[]): number; // 0 when the tier is held
   ```

   Tests: unlock needs every available cup and at least two; cups come in `CUPS` order; a cup at another tier is refused; the bonus is paid once per tier; the existing standings and tiebreak tests stay.
2. **App flow:** `App.startSeason(tier)` sets `profile.season` and starts the first cup through the existing cup code (`profile.cup = newCup(cupId, tier)`). When a cup finishes while `profile.season` is set: book the cup as today, then `bookSeasonCup`; if the season is finished, compute `seasonChampion`; if it is the player, add the Champion trophy and the bonus, emit `results:champion`; clear `season`. `App.quitSeason()` clears `season` and `cup`. `sanitizeProfile` drops a `season` whose current cup is missing or at another tier.
3. **Screens:** `GrandPrix.tsx` gains the CHAMPIONSHIP card (locked with "Win every cup to unlock", or the tier picker and START; or CONTINUE SEASON). `CupStandings.tsx` shows "SEASON · CUP n OF m" when a season runs, and after a cup's final standings a **season table** view (rank, portrait, name, points, cups won) with NEXT CUP or, at the end, the champion card. `MainMenu.tsx` reads CONTINUE SEASON. The pilot card shows Champion trophies (a crown per tier, with the tier's initial).
4. **`sim/season.sim.test.ts`** (new): a whole season at Pilot from the shared cup sim (`sim/cupSim.ts`): 10 races, a reload in the middle of the second cup, the season table equals `seasonStandings` of the two cups, and the champion is paid once. If the file cannot stay under 60 s, drive the second cup from recorded standings of `stormCup.sim.test.ts` rather than racing it again.
5. **`game/Tutorial.ts`** (new, pure state machine; unit tests first):

   ```ts
   export type TutorialStep = 'steer' | 'boost' | 'airbrake' | 'pit' | 'item';
   export interface TutorialView { step: TutorialStep | null; done: boolean }
   export class Tutorial {
     constructor(track: TrackData, opts: { hasItem: boolean });
     /** Call every fixed step with the player's state and raw input. */
     update(dt: number, ship: ShipState, input: ControlInput, race: { state: string; lap: number }): TutorialView;
     skip(): void;
   }
   ```

   | Step | Shown when | Cleared when | Gives up after |
   |---|---|---|---|
   | steer | the lights go out | \|steer\| > 0.3 for 1 s in total | 12 s |
   | boost | the boost is unlocked and the road ahead is straight for 2 s | `ship.boosting` | 2 showings of 8 s |
   | airbrake | 1.5 s before a bend the track marks as sharp (use the AI's curvature look-ahead) | an air-brake input > 0.5 for 0.3 s | 2 showings of 6 s |
   | pit | energy < 70%, or lap 2 starts, and the pit strip is within 300 m | the ship is on the pit strip | 2 showings of 8 s |
   | item | 3 s after the steps before it are done, on a straight, when `hasItem` | the item is used | 10 s |

   One prompt at a time, in this order; a step that gives up is marked done. The tutorial is done when every step is done or the race ends. Tests drive each row with a scripted ship.
6. **Wiring:** `RaceSession` owns a `Tutorial` when `RaceSetup.tutorial` is set (`App` sets it for a Tour race of a profile with `tutorialDone === false` that was created with the Rookie preset, or after REPLAY TUTORIAL). The HUD draws the prompt (`.mz-tutorial`: an icon, a short line, the control in the device's form, and SKIP), above the bottom strip and clear of the touch controls. On done or skip `App` sets `tutorialDone = true`. `Profile` needs to know its preset for the Classic note: use `assists` at creation (all four on = Rookie); no new field. The free Shield is added to `profile.items` when the tutorial race is built and the bag is empty.
7. **Tests:** e2e (`e2e/tutorial.spec.ts`, `?features=modes`): a new Rookie profile's first Tour race shows the steer prompt; SKIP removes it and a reload does not show it again; REPLAY TUTORIAL brings it back; a Classic profile sees the note and no prompt. `e2e/grandprix.spec.ts`: the CHAMPIONSHIP card is locked for a new profile and open for a fixture with both cup trophies.

**Done when:**
- [x] A season runs both cups in order with the season table between them, survives a reload at any point, and pays the Champion trophy and bonus once. Covered by `sim/season.sim.test.ts` (reload mid cup 2), `cupBooking.test.ts`, and the championship e2e in `e2e/grandprix.spec.ts` (between cups and the end).
- [x] With one cup visible there is no CHAMPIONSHIP card (the e2e, with `modes` and no `expansion`).
- [x] A new Rookie profile gets the five prompts in a real race, each clearing on the action; SKIP and REPLAY work. Covered by `Tutorial.test.ts` (each row of the table), `RaceSession.test.ts`, and `e2e/tutorial.spec.ts`.
- [x] Prompts show the right control for keyboard, pad and touch, and never cover the power, speed or a touch control. The labels come from the live bindings. `touch.spec.ts` checks the prompt's box against every touch button, the strip, the power and the speed. The prompt does cover the back of the ship on a phone; see "As built".
- [x] `modes` off: nothing changes on the live site. Every M8c entry point checks `modes`, and the existing Grand Prix and Storm Cup e2e (`modes` off) pass unchanged.

**Device check:** on the iPad by touch and on the iPhone by pad (`VITE_FEATURES=modes,expansion`): a new Rookie profile's first race with the tutorial. If a child or a first-time player is at hand, let them play it without help and note where they stop. Then start a season from a fixture profile and play one race.


**As built (branch `v2/m8c-season-tutorial`)** (read before M8d):
- **Files:**
  - `game/modes/Championship.ts` (additions: `CHAMPION_BONUS`, `seasonUnlocked`, `newSeason`, `seasonCup`, `bookSeasonCup`, `championBonus`).
  - `game/modes/cupBooking.ts` (new): `bookCupRaceOn`, booking a cup race on a profile: the cup award; in a season the next cup, or the champion. App and the season sim share it.
  - `game/Tutorial.ts` (new), `core/controlNames.ts` (`keyName` and `PAD_BUTTON_NAMES`, moved so the HUD can use them), `sim/season.sim.test.ts`, `e2e/tutorial.spec.ts`.
- **Plumbing:**
  - `App`: `startSeason`, `nextSeasonCup`, `quitSeason`, `seasonCups`, `seasonOpen`, `seasonBreak`, `lastSeason`, `replayTutorial`. `bookCupRace` now returns `{ cup, champion }`.
  - `raceTally` adds CHAMPION BONUS.
  - `RaceSetup.tutorial = { hasItem, hud, onDone }`; `HudActions.onSkipTutorial`; `HUD.setTutorial`.
  - The debug hook gains `tutorial()`.
- **Decisions made while building (none re-opens a design decision):**
  - **While a season runs, `profile.cup` always holds its current cup.** When a season cup ends, the next cup's race 1 is queued at once, so a reload at any point resumes the season. The sanitizer drops a season whose cup is missing, at another tier, or already played (this updated two M8a v9 fixtures, which now carry the season's cup).
  - **Between cups:** the finished cup's final standings, then SEASON TABLE, then NEXT CUP (the next cup's standings before its race 1). At the end, SEASON TABLE leads to the champion card, or the winner's name when a rival won.
  - **While a cup or a season runs, the menu shows CONTINUE CUP or CONTINUE SEASON in place of GRAND PRIX**, as a cup always did. QUIT SEASON replaces QUIT CUP inside a season.
  - **The CHAMPIONSHIP card is a third tab** on the Grand Prix screen, shown with `modes` when two or more cups are visible. It holds the profile's tier picker (the season runs at the profile's CPU difficulty) and START, or CONTINUE SEASON and QUIT SEASON. A single cup in progress blocks it ("FINISH OR QUIT THE … FIRST").
  - **Champion trophies are crowns** (one per tier with its initial, lit when held), on the card, the champion card and the pilot card.
  - **Which profile gets the tutorial:** all four assists on stands for the Rookie preset (no new field). REPLAY TUTORIAL sets `tutorialDone = false` plus an in-memory flag, so a Classic profile replays it too. A reload before that race drops the flag, and a Classic profile then gets the one-line note again.
  - **Tutorial thresholds, measured on the 8 tracks:**
    - **Sharp bend:** |κ| ≥ 0.006 1/m. Every track has 4–12 such bends; the largest |κ| anywhere is 0.019.
    - **Straight:** |κ| < 0.003 1/m over the next 2 s (at least 80 m).
    - **Pit:** the pit strip is 30–250 m past the line on every track, so "lap 2 starts" is the approach to the line at the end of lap 1.
  - **The tutorial's steps clear on the action even before their prompt shows** (an early boost clears BOOST). A showing that runs out is followed by a 3 s gap.
  - **The prompt** sits bottom centre between the power and speed panels. On touch it sits above the strip, no wider than 280 points, clear of every touch button. On a phone that covers the back of the ship; it is left there for the owner's look check.
  - **The prompt's control comes from the live bindings:**
    - keyboard: the first bound key;
    - pad: the first bound button;
    - touch: SLIDE LEFT THUMB, or TILT, and for the air-brake either SLIDER TO THE EDGE or ◂AIR / AIR▸, by the air-brake style.
- **Existing tests changed:** `SaveStore.test.ts` (two v9 season fixtures now carry their current cup, plus assertions for the new drop rule). No assertion was loosened.
- **CI:** the browser smoke job's time limit is now 30 min (was 20). M8c's first run was cancelled at 20 with every finished spec passing: the M8 specs had grown the suite past it. No test changed.
- **Measured:** the season sim (10 real races at Pilot, a reload in cup 2) takes 31 s locally; in it a rival (REX THUNDER) won the season, so the sim checks the no-bonus path, and `cupBooking.test.ts` checks the player's win and the once-per-tier rule.
- **Owner:** the device check below, and the look of the championship card, the season table, the crowns and the tutorial prompt (shots in `docs/v2/shots/m8c/`).


---

### M8d — Balance pass, flags on, the "MachZero 2.0" release — ✅ BUILT (PR #49, `v2/m8d-release`; #49 was merged into the already-merged M8c branch, so PR #50 carries it to `main`; waiting on the owner's QA checklist and the merge of #50)

**Design decisions:**
- **Prices and payouts stay as they are.** The measurements at the top of §M8 already meet the targets:
  - a first Mk II part (600) after 1 Rookie race (the stand-in earns 750–1,000);
  - a full Mk III kit (7,500) after about 10 Pilot races (800–860 a race on stock);
  - a full Prototype kit (16,000) after about 25 more Ace races (710 a race on a Mk III kit, 970 on Prototype; cups, first clears and medals shorten it). *(Corrected in M8d: the design said Mk II and Mk III; see the correction under §M8's table.)*
- **SPEC §4.4 holds:** stock wins on Rookie and is mid-pack on Pilot; on Ace and Legend a stock ship finishes near the back, so upgrades matter there.
- **Flags:** `modes` turns on. Then the flags `profiles`, `garage`, `worlds`, `tiers`, `touch` and `modes` are **removed** with their dead branches. `music` (M6) and `expansion` (the world looks) stay.
- **A world without an approved look stays hidden.** 2.0 ships with the worlds visible on that day.

**Build steps:**
1. **`sim/economy.sim.test.ts`** (new; the numbers are bands around today's measurements, so a later change to payouts, pace or parts that breaks the economy fails here):
   - Rookie preset, stock, Neon Bay: the first race pays ≥ 600.
   - Pilot, stock, the mean over the visible-in-`expansion` 8 tracks: 650–1,000 credits a race.
   - Ace, Mk II kit: 550–900. Ace, Mk III kit: 750–1,150. *(As built: these bands sit on the Mk III and Prototype kits, the kits they were measured on; see "As built".)*
   - Ace, stock: ≤ 450. Legend, stock: ≤ 400.
   - It uses `runWorldRace` with a new option `player.loadout` (replacing the fixed `defaultLoadout()`); 5 cases × 8 races is about 90 s of sim, so split it into two files.
2. **The §9 matrix on 8 tracks × 4 tiers:** every per-world sim file already runs `describeTierMatrix`. Confirm all 8 are green with M7's assists in play, and record the table (finishing positions of the two balance stand-ins per track) in the PR body. If a target fails, tune `content/tiers.ts` or the track, never the assertion.
3. **The other guards, all green:** `sim/medals.sim.test.ts` (M8b), `sim/worldTour.sim.test.ts` (M8a), `sim/season.sim.test.ts` (M8c), `sim/touchScheme.sim.test.ts` (M7b), `sim/partsBalance.sim.test.ts` (X3).
4. **Play pass (the builder, in the browser, then the owner on the devices):** every visible world on the Rookie preset with touch emulation and on Legend with no assists. Write what was changed, if anything, in the as-built notes.
5. **Flags:** set `FEATURE_DEFAULTS.modes = true` in one commit (so it can be reverted alone). In the next commit reduce `FEATURE_NAMES` to `['music', 'expansion']` and delete: every `features.profiles` / `garage` / `worlds` / `modes` / `touch` branch (`App.ts`, `MainMenu.tsx`, `routes.ts`, `TouchControls`), `MENU_PLACEHOLDERS`, the `soon` route and its screen, `ui/screens/WorldSelect.tsx`, and the v1 title screen inside the HUD if only the no-profile flow used it (`?autopilot=1` and `?seed=N` must still start a race directly: the smoke test depends on it). `?features=all` keeps working for the two flags left; unknown names are ignored as today. Update `__features.test.ts` and every e2e URL that names a removed flag.
6. **Docs:** README (what the game is now, the modes, the controls for keyboard, pad and touch); `docs/TDD.md` gains a v2 architecture section (the app shell, saves and migrations, modes, ghosts, input devices); mark M7 and M8 done in this file; update `NEXT_SESSION.md`; `npm run codebase`.
7. **The release PR**, titled **"MachZero 2.0"**: a feature summary, a screenshot of each visible world, the map, the results screen, a Time Trial with ghosts, the touch layout on iPhone and iPad sizes; the sim tables; the sizes from `npm run size`; and the QA checklist below.

**Done when (SPEC §9 and §12):**
- [x] Every visible world is playable in World Tour, Grand Prix and Time Trial with keyboard, pad and touch. The e2e drive each mode by keyboard, pad and touch on Neon Bay (and the Storm Cup's five worlds by pad); the scripted play pass raced all five visible worlds by touch on the Rookie preset and with no assists on Legend, with no console error. The owner's QA checklist is the check on the devices.
- [x] All sims are green: the 8 × 4 matrix, the balance targets, economy, medals, World Tour, season, touch scheme.
- [x] `FEATURE_NAMES` is `music` and `expansion` only, and no dead flag branch remains (`grep -rn "features\.\(profiles\|garage\|worlds\|tiers\|touch\|modes\)" src` finds nothing).
- [x] Saves from v1 to v8 load as v9 with nothing lost (the migration tests), and a save the live site wrote with `modes` off keeps its worlds, cups and garage under the World Tour (`game/modes/__tests__/release.test.ts`).
- [x] Sizes: app JS ≤ 600 KB gzip, Rapier ≤ 1.7 MB gzip, `public/game` ≤ 15 MB. No console errors in the smoke test.

**Device gate (the owner; the full QA checklist), iPhone 18 Pro Max and iPad Air:**
1. A new Rookie profile by touch: tutorial, clear Neon Bay, the unlock, buy a Mk II part, clear world 2.
2. A Classic profile by pad: a Pilot race, the Neon Cup's first race, close and reopen, CONTINUE CUP.
3. Time Trial with both ghosts: 60 fps, p95 no more than 1 ms above the M8c build.
4. An old save from the live site (export it before updating) imports with its worlds open and its trophies kept.
5. Reduced motion, colour-blind mode and EXTRA LARGE once each on the map, the results and a Time Trial.
6. An 8-ship race on each visible world at the device's own preset: 60 fps.

**What needs the owner in M8:** the look of the map and the results screen (M8a), the device gates above, and the merge of the release PR. Everything else is built without questions.

**As built (branch `v2/m8d-release`)**:
- **The economy table in §M8 was one part tier too low.** Its "Mk II kit" column was measured with `PartTier` 2 (Mk III) and its "Mk III kit" column with `PartTier` 3 (Prototype). The design commit and today's code give the same numbers:

  | Ace | Stock | Mk II kit | Mk III kit | Prototype kit |
  |---|---|---|---|---|
  | credits a race (mean of 8 tracks) | 286 | 359 | 706 | 970 |

  So step 1's bands guard the kits they were measured on: **Ace on a Mk III kit 550–900, on a Prototype kit 750–1,150**. A guard was added for a true Mk II kit (250–600, measured 359): on Ace it is not yet enough against rivals on Mk III engines and boosters. Prices and payouts are unchanged; the design's progression holds with the right labels (Mk III kit after about 10 Pilot races, then Ace on Mk III at 706 a race toward the 16,000 Prototype kit).
- **Economy sims:** `sim/economy.cases.ts` with three files (`economy.a`: the Rookie first race, Pilot and Legend stock; `economy.b`: Ace stock and Mk II; `economy.c`: Ace Mk III and Prototype), so each stays under a minute (about 40 s for the three, in parallel). The stand-in is an autopilot at the tier's skill and full thrust (pace 1, as the balance tests), from its usual grid slot. `runWorldRace` takes `player.loadout`.
- **Measured (this branch):**
  - Rookie first race on Neon Bay: P1, 1,000.
  - Pilot stock: mean 800 (P2–P4).
  - Legend stock: 271 (P7–P8).
  - Ace stock: 286. Mk II: 359. Mk III: 706. Prototype: 970.
- **The tier matrix (8 tracks × 4 tiers) and every guard are green with no change to a tier or a track.** The balance stand-ins: Rookie-assisted from P8 finished P1 on six tracks and P2 on Cryo Station and Cinder Forge; Pilot unassisted finished P2–P4, within 1.5% of the median everywhere.
- **Flags:** `modes` turned on in its own commit; the next commit removed the six flags. Deleted: `ui/screens/WorldSelect.tsx` (its `TierPicker` moved to `ui/screens/TierPicker.tsx`), the `worlds` and `soon` routes, `ComingSoon`, `MENU_PLACEHOLDERS`, `App.openSoon`, the modes-off grant path in `App.bindStats`, `cupUnlocked`'s `modes` argument, the CSS of the world-select cards. The touch rig and tilt are always built. The menu with no profile (not reachable from the normal flow) still offers RACE.
- **The HUD's v1 title screen stays:** `?autopilot=1` (the smoke test) still starts its race from it. `?seed=N` goes straight into a race as before.
- **Found and fixed:** a Classic profile's "Tutorial: Settings → Race" note was shown when the world was picked, so on a slow build it could run out over the loading screen. It now shows once the race is on screen (the tutorial e2e caught it under load).
- **e2e:** every URL that named a removed flag is updated. The specs that raced from RACE now go WORLD TOUR → Neon Bay → RACE; the world-select pad test is now the map's (`controller.spec.ts`); the Grand Prix specs and the touch cup test open their cups with a World Tour fixture and leave the results screen with STANDINGS. No assertion was loosened. Added `game/modes/__tests__/release.test.ts` (a live-site save under the World Tour).
- **Play pass (scripted in the browser):** a new Rookie profile on an iPhone-sized touch screen raced the five visible worlds from the map on the player's AI: the tutorial ran on the first race only, each race was P1 with its first clear (2,000 credits) and opened the next world. A Classic profile on Legend with every assist off finished P8 on all five (260 credits each), as SPEC §4.4 wants for a stock ship there. No console error. Nothing was tuned. The hands-on pass is the owner's QA checklist.
- **Sizes:** app JS 373.5 KB gzip (M8c: 374.4), Rapier 1,605.7 KB, `public/game` 1.6 MB.
- **Docs:** README (2.0, the modes, controls for keyboard, pad and touch), `docs/TDD.md` §8 (the 2.0 architecture), M7 and M8 marked done, NEXT_SESSION.
- **Shots:** `docs/v2/shots/m8d/`.

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
| Audio: v1 golden, sound table, pool, duck, DSP, songs (valid, −14 LUFS, seamless, deterministic) (§M6) | `audio/**/__tests__` | v1 unchanged with `music` off; every event mapped; every song valid |
| Audio e2e and the offline CPU proxy (§M6) | `e2e/audio.spec.ts`, `e2e/audio.perf.spec.ts` | sounds played by id; nodes ≤ 150; buffers ≤ 100 MB; no console errors |

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
