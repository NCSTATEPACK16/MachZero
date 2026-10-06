# Next-session brief — build MachZero 2.0 (milestones M4 → M8; M0–M3 done)

Paste the prompt at the bottom into a fresh Claude Code session (Opus 5.5) opened on
`/Users/johnbradner/Documents/ClaudeWork/MachZero`. Everything above it is the context that prompt relies on.

## Where things stand (2026-10-05, M4a in review, M4b started)

- **The live site is 2.0 through M3** at https://machzero.netlify.app.
  - Netlify site `machzero` is connected to `NCSTATEPACK16/MachZero`. Each merge to `main` deploys, and each PR gets a deploy preview at `https://deploy-preview-<N>--machzero.netlify.app`.
  - `main` has profiles, menus, settings, quality presets, Blender ships, the garage, the livery editor, Neon Bay and Sunset Mesa, and world select.
- **The 2.0 design is agreed and merged:**
  - `docs/v2/SPEC.md` (what and why)
  - `docs/v2/IMPLEMENTATION.md` (how, milestone by milestone, pinned to v1's files)

  Every design decision in them was settled in a design interview with the user. **Do not re-open them.** Ask the user only when something genuinely isn't covered.
- **Done and merged into `main`** (merge commits, in order). Each milestone in IMPLEMENTATION.md has **as-built notes**; read M1's and M2's before coding.
  - **M0:** PR #2. CI (`verify` + `smoke`), Netlify, size budgets, Playwright, feature flags, `CODEBASE.md`.
  - **M1:** PRs #3, #4, #5. Per-ship stats, 6 chassis, 8-ship field, App + RaceSession, saves, settings, Preact menus, quality presets.
  - **M2:** PRs #6, #7. The Blender asset pipeline, GLB ships and parts, economy and credits, the garage with a turntable, and the livery editor.
- **Flags on `main`:** `profiles`, `garage` and `worlds` are on. `tiers`, `music`, `touch` and `modes` are off.
- **Tests:**
  - 188 unit/integration tests. They include the 3-lap headless race sims (v1 4-ship; 8-ship at rookie, pilot and legend fits), the corkscrew hold test, the parts sim (Prototype engine beats stock), the asset validator, economy, garage stat bars, save migrations and the RaceSession lifecycle.
  - 6 Playwright tests:
    - smoke;
    - menus by keyboard, gamepad and touch (asserts no main-thread task ≥ 2 s);
    - garage buy, fit, paint, persist and race;
    - turntable and race-rebuild GPU-memory leak checks.
  - Read `docs/TDD.md` §7 before touching `physics/ShipController.ts`: it records four hard-won physics invariants.
- **M3:** PR #9 (one PR for the whole milestone, at the user's request). Authored tracks, jumps, Neon Bay + Sunset Mesa, world themes and props, world select; turns `worlds` on. Read M3's as-built notes in IMPLEMENTATION.md.
- **Test-time rule (user, 2026-10-03):** keep every test under 60 s and the suite fast; leave visual checks to human playtesting (no screenshot loops). The full `npm test` runs in ~14 s locally. The in-app browser preview rendering the game saturates this Mac's CPU — stop it before timing tests.
- **Design decisions for M4 and M5 (grilling session, 2026-10-04):** recorded at the top of IMPLEMENTATION.md §M4 and §M5. They are settled; don't re-open them. In short: M4 is three stacked PRs (M4a Cryo Station with the hazard framework, M4b Jade Ruins, M4c Orbital Ring), then M5 is one PR. The pipe is a real tube, the split path is a real branch, the loop holds at any speed, and debris is solid on every preset.
- **M4a, Cryo Station:** PR [#13](https://github.com/NCSTATEPACK16/MachZero/pull/13) (`v2/m4a-cryo-station`), CI green, **waiting for the user's playtest and merge**. It adds the full-pipe, ice patches, `HazardPolicy` (`?hazards=rookie`), AI ice/pipe awareness, the Cryo theme and props, and builds the world. Its as-built notes are in IMPLEMENTATION.md §M4. Preview: https://deploy-preview-13--machzero.netlify.app/?features=all
- **M4b, Jade Ruins: started, NOT shippable yet.** Branch `v2/m4b-jade-ruins`, stacked on M4a, with one WIP commit. See **"M4b handoff"** below for exactly what exists and what's left.
- **Then M4c** (Orbital Ring), **then M5** (one PR). Their decisions are in IMPLEMENTATION.md §M4/§M5.
- **Local machine load:** during the last session this Mac sat at load average 20–37 from other apps. Wall-clock asserts (track generation < 1.5 s, `project()` timing) and the Playwright specs timed out locally, yet passed alone and on CI. Check `uptime` before trusting a local failure; CI is the reference.
- **Logged for later sessions:** M6 audio ([#10](https://github.com/NCSTATEPACK16/MachZero/issues/10)), M7 touch/comfort ([#11](https://github.com/NCSTATEPACK16/MachZero/issues/11)) and M8 progression/modes ([#12](https://github.com/NCSTATEPACK16/MachZero/issues/12)). Each issue lists its scope, done-when criteria and the design gaps to resolve in a grilling session before building (M6 song content, M8 tutorial script and world map look).
- **How to add a world:** author tracks with `npm run tracks:design` (segments in `scripts/track-design.mjs`), add a theme in `graphics/themes/`, and add props in `blender/props/build_props.py`.

## M4b handoff (split path + stone gates + Jade Ruins), state at 2026-10-05

**Already on `v2/m4b-jade-ruins`** (typechecks; the 110 existing track/physics/core tests pass; nothing uses a branch yet, so it has **no test of its own yet**):

- **Contracts** (`core/contracts.ts`):
  - `TrackBranch` interface;
  - `TrackData.branches`;
  - `ShipState.path` (null = main loop, else a branch id);
  - `TrackProjection.path` / `pathS`;
  - `project(pos, hintU, hintPath)`;
  - `surfaceKindAt(u, lat, path?)` and `gripAt(u, lat, path?)`;
  - the `branch` feature gained `side` and `openFrom`/`openTo` (outer edge without a rail);
  - the `gate` feature is now `{ d, branch?, period, phase, closedFraction, span: 'left'|'right'|'full' }`.
- **`track/features/branch.ts` (`BuiltBranch`):**
  - open Catmull-Rom centreline resampled every ~1.5 m;
  - world-up frames banked by curvature, with the bank faded to flat over the overlaps;
  - `overlapFork`/`overlapMerge`: branch metres until the centrelines are `branchSeparation()` = W + w + 2·railThickness apart;
  - `dSepFork`/`dSepMerge` on the main loop;
  - `progressU(s)`, which projects onto main through the overlaps and is linear in between (monotonic), and its inverse `sAtProgress(u)`;
  - `project(p, hintS)`, `sampleAt`, `surfacePoint`.
- **`TrackGenerator`:**
  - builds the branches;
  - `projectWithBranches()` stays on the hinted road while it is still valid (|lateral| ≤ w + 0.5, height −3..12), otherwise picks main, then any valid branch, and keeps the hinted road while falling;
  - `surfaceKindAt`/`gripAt` return road/1 on a branch.
- **`TrackSweep`:** `splitRings()` and `cutByDistance()` (open a main rail over a distance range).
- **`TrackMesh`:**
  - main left and right rails and their neon are cut separately where a branch leaves (dFork→dSepFork) and rejoins (dSepMerge→dMerge) on its side;
  - the branch deck (asphalt with polygon offset, drawn over the main deck in the overlaps), slab, rails and neon;
  - inner rail only after separation; outer rail except over the open edge;
  - a crash-barrier **nose** box (visual + collision) where the roads separate at the fork;
  - branch collision surface and rails.
- **`ShipController`:**
  - projects with `s.path`;
  - remembers `lastValidPath`/`lastValidS` and **respawns on the branch** where the ship left it;
  - no twist, pipe compensation, seam guard or dash/pit zones while on a branch.

**Left to do for M4b, in order (test-first where it is physics):**

1. **Jade Ruins layout** in `scripts/track-design.mjs`: add `branch` support. The branch is its own turtle segment list, starting at main(dFork) + right·side·(W − w) with the main heading and ending the same way at the merge. Close its position with two `adjust` straights and its heading by the arc sum.
   - Fork and merge must be on main straights; validate this in `TrackValidate`, along with branch radius and clearance.
   - The shortcut is half width (w = 7), saves ≈ 1.5 s per lap (about 8% shorter than the main section it skips), and has an open outer edge with a drop.
   - Main has 2–3 half-width stone gates; the shortcut has 1 full gate.
   - Register it in `content/tracks/index.ts`. Draw the branch in `TrackPreview` and the HUD `Minimap`.
2. **Unit tests** (`track/__tests__/authored.test.ts`):
   - the fork and merge decks meet the main deck;
   - `progressU` is monotonic and continuous across a road change;
   - `project` keeps and switches path correctly at the fork, mid-branch and the merge;
   - main rails open only in the cut ranges;
   - a nose exists.
3. **Branch hold sim** (`sim/branch.hold.sim.test.ts`, like pipe/jump):
   - a ship takes the shortcut and rejoins at 70 / 125 m/s with no respawn;
   - one stays on main past the fork;
   - one driven off the open edge respawns ON the shortcut;
   - the race progress order is sane.
4. **`TrackRoute`** (`track/TrackRoute.ts`): the AI's road ahead in metres, either main, or main → branch → main. It provides `curvatureAt`, `surfacePoint`, `sampleAt`, `halfWidthAt` and `pathAt`, and maps a ship's (path, u, pathS) to route metres. Switch `AIDriver` to it:
   - curvature scans and the aim point go through the route;
   - `maxLat` uses the route's half-width;
   - rival avoidance only considers rivals on the same road;
   - re-plan to main if the ship is on main past the separation.
   - **Route choice** (decided): Rookie never, Pilot ≈30%, Ace ≈60%, Legend always unless the shortcut gate will be closed on arrival. PIXEL picks at random; the aggressive pilots lean toward the shortcut. Seed from the AI rng and roll once per lap, ~300 m before the fork. Before M5's tiers exist, approximate the tier with the parts fit (`buildRaceField` tier) and keep the table in one place for M5 to replace.
   - Also make `RaceManager.updateWrongWay` and `ChaseCamera.clampToTrack` use the ship's path (`track.project(p, u, ship.path)`).
5. **Stone gates** (`track/features/gate.ts` + `physics`): kinematic Rapier cuboids in the RAIL group, driven by a deterministic timeline from **physics time since the race reset**, not wall-clock.
   - Add `PhysicsSystem.resetTime()`, called from `RaceSession`'s reset.
   - Half-width slabs slide in from alternating sides on main; full-width on the shortcut.
   - A warning glow shows 1.5 s before closing, ×2 under the Rookie `HazardPolicy`.
   - On hit: rail-like bounce plus damage, or with `policy.damage === false` no energy loss and velocity ×0.85 once per hit.
   - Emit `hazard:gate`.
   - AI: predict the gate state at arrival; take the open half; skip the shortcut if its gate will be closed.
   - Test with `sim/hazards.sim.test.ts`: the same seed gives identical standings (run twice).
6. **Theme and props:** `graphics/themes/jadeRuins.ts`, with a misty dusk sky, jungle canopy (instanced cards), holographic glyphs and fireflies (particles, off with reduced motion). Add `build_jade_ruins` to `blender/props/build_props.py` (temple pyramids, ruined columns, statues, giant ferns), add its entry to `scripts/check-assets.mjs` `WORLD_PROPS`, and run `npm run assets -- props`.
7. **Finish:**
   - `jade-ruins` sim (Rookie + Legend);
   - set `built: true` in `content/worlds.ts`, then update the SaveStore and assets tests (they name the first unbuilt world and the prop count);
   - write M4b as-built notes in IMPLEMENTATION.md §M4;
   - `npm run tracks:preview`, `npm run codebase`;
   - the full pre-push gate;
   - PR "M4b: Jade Ruins", stacked on #13 if it's still open (say so in the body).

**Watch out:**
- **Gate collider handles:** the PhysicsSystem contact handling must tell gate colliders apart from rails, by handle, to apply the hazard policy.
- **Overlap z-fighting:** the branch deck lies coplanar on the main deck in the overlaps. Polygon offset handles the visual; the hover rays may hit either surface, and both are at the same height because the main road must be straight and unbanked there.

## Environment facts (already verified; don't rediscover)

| Thing | Fact |
|---|---|
| Node / npm | Local Node 26.4, npm 11.17; CI and Netlify use Node 24 (`.nvmrc`) |
| Dev server | Port **5173 is taken** by another project. Use `npm run dev -- --port 5180`; `.claude/launch.json` (git-ignored, local) is already set up for the browser preview on 5180 |
| GitHub | `gh` is logged in as `NCSTATEPACK16`; the remote is `origin` |
| Netlify CLI | Logged in (team NCSTATEPACK16). The folder is not `netlify link`ed and doesn't need to be; previews come from the GitHub integration |
| Blender (headless) | `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P <script.py> -- <args>` works (5.2.0 LTS; a GLB export was verified) |
| Blender MCP | Add-on v1.7 / protocol 11, on port 9876. The user must have Blender open with **Start MCP Server** clicked (N panel → MCP tab). The first call after a Blender restart can fail with "broken pipe"; retry once. Treat it as an optional preview tool: canonical assets come from the headless scripts in `blender/` |
| Playwright | `@playwright/test` installed; Chromium downloaded locally. `npm run smoke` runs every spec in `e2e/` against `vite preview` on port 4173 (SwiftShader). CI runs it in about 2 min. The browser pane's `requestAnimationFrame` stops while the pane is hidden, so drive timing-sensitive UI checks through Playwright |
| Shared machine | Other projects (a Puppeteer Chrome, other Vite servers, other Claude sessions) often load this Mac's 6 cores. Wall-clock timeouts then fail locally while the assertions pass. Rerun with `npm test -- --maxWorkers=3` and `npm run smoke -- --workers=1`; CI (dedicated runners) is the reference. Don't kill other projects' processes |
| Bundle | After M2: app JS 254 KB gz, Rapier 1,615 KB gz (base64 WASM), `public/game` 377 KB. See IMPLEMENTATION §M0 for the optional separate-WASM task |
| Assets | `npm run assets` (Blender + glTF Transform) rebuilds `public/game/`. Commit the GLBs; CI only validates them |

## Paste this prompt

```
You are the Principal Engineer building MachZero 2.0, a Three.js + Rapier + Vite anti-gravity racer (F-Zero-like)
in /Users/johnbradner/Documents/ClaudeWork/MachZero. v1 is live at https://machzero.netlify.app.

READ FIRST, in this order, before writing any code:
  1. docs/v2/NEXT_SESSION.md: current state and verified environment facts. Trust them; don't rediscover.
  2. docs/v2/SPEC.md: the agreed product spec. Every decision in it is settled; do not re-open it.
  3. docs/v2/IMPLEMENTATION.md: operating rules (§0), v1 code map (§1), target architecture (§2),
     contract changes (§3) and milestones M1 → M8 with "done when" criteria and appendices.
  4. docs/TDD.md: v1 architecture, especially §7 (corkscrew physics invariants you must preserve).

GOAL: finish M4 (M4b Jade Ruins from its WIP branch, then M4c Orbital Ring), then M5, in order, as far as this session
allows, each shippable on its own. M0–M3 are merged; M4a is PR #13; M6–M8 are logged as issues #10–#12 and need a design
session first. Follow the "M4b handoff" section of NEXT_SESSION.md step by step.

HOW TO WORK (agreed with the user; follow exactly):
- You (Opus) implement everything yourself, sequentially. No parallel Sonnet builders. Sub-agents only for
  read-only lookups or an optional second-opinion review of a finished PR.
- One branch per milestone (split big ones such as M1 into sub-PRs): v2/m<N>-<slug>. Open a PR into main with
  gh pr create, bind it with the ccd_pr tools, and give the user the Netlify deploy-preview URL
  (https://deploy-preview-<PR#>--machzero.netlify.app). NEVER merge, never push to main, never enable
  auto-merge: the user playtests each preview and merges. If the previous PR is still open, stack the next
  branch on it and write "stacked on #N" in the PR body.
- main is live: every merge must leave the game complete and playable. Unfinished 2.0 surfaces stay behind
  src/core/features.ts flags (off on main; previews use ?features=all). Flip a flag's default to true
  only in the PR that completes that milestone.
- Before every push, run: npm run typecheck && npm test && npm run build && npm run size && npm run smoke.
  CI runs the same checks. Fix red CI before moving on.
- Test-first for physics and gimmicks: write the hold/sim test (like src/sim/corkscrew.sim.test.ts) before the
  feature. When a sim fails, find the root cause with evidence (instrument, trace), as documented in TDD §7.
  Never loosen an assertion to go green.
- M1's stats refactor must be behaviour-neutral: Balanced/Stock stats equal v1 CONFIG, so every v1 test
  passes unchanged.
- Assets: Blender 5.2 headless Python scripts in blender/ are the source of truth. Output goes to
  public/game/ (NOT public/assets/), optimised with gltf-transform (meshopt, no textures on ships; materials
  named by role). Use the Blender MCP (port 9876) only to preview or iterate; if it's not reachable, carry on
  headless.
- Confirm current library APIs with Context7 before using them (three.js r186 addons, Rapier 0.21,
  Preact + Signals, @gltf-transform, Playwright, Web Audio).
- Commit hygiene: descriptive messages; no session IDs, transcripts or .claude/ content in commits or PR
  bodies. Run npm run codebase at the end of each milestone so CODEBASE.md stays current.
- Local dev server: npm run dev -- --port 5180 (5173 is used by another project). Use the built-in browser
  preview to eyeball each milestone at desktop and phone sizes before opening the PR.
- Ask the user only for decisions the spec doesn't cover, or for real-device checks (iPhone/iPad) in M7.
  Otherwise work autonomously.

AT EACH PR: in the PR body, include what shipped, the "done when" checklist from IMPLEMENTATION.md with each
item ticked or explained, the test counts and sim summaries, bundle sizes from npm run size, screenshots
where visual, and a manual QA checklist for the user's preview playtest.

AT THE END OF THE SESSION: report the PRs opened (links plus preview URLs), which milestones are complete,
what remains, and any spec deviations with the reasons. Update IMPLEMENTATION.md's milestone headers
(mark ✅ DONE with the PR number) so the next session can resume from the docs alone.

Start by confirming the open PRs' state (gh pr list) and that main is green. If #13 was merged, rebase v2/m4b-jade-ruins
onto main; otherwise keep it stacked on #13. Then continue M4b from step 1 of the handoff.
```
