# Next-session brief — build MachZero 2.0 (milestones M4 → M8; M0–M3 done)

Paste the prompt at the bottom into a fresh Claude Code session (Opus 5.5) opened on
`/Users/johnbradner/Documents/ClaudeWork/MachZero`. Everything above it is the context that prompt relies on.

## Where things stand (2026-10-05, M4a and M4b in review, M4c next)

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
- **M4b, Jade Ruins:** PR [#14](https://github.com/NCSTATEPACK16/MachZero/pull/14) (`v2/m4b-jade-ruins`), stacked on #13, **waiting for the user's playtest and merge**. It adds the split path (branch, routes, lateral-aware progress), the stone gates (`hazard:gate`, `PhysicsSystem.hazardTime/resetTime`, `TrackData.animateHazards`, `FrameContext.hazardTime`), AI routes and gate awareness (`track/TrackRoute.ts`, `AIDriver` `hazardClock`), the Jade theme and props, and builds the world. Its as-built notes are in IMPLEMENTATION.md §M4; read them before M4c (mines and debris reuse the gate pattern: kinematic bodies on the hazard clock, told apart by collider handle, policy-aware hits). Preview: https://deploy-preview-14--machzero.netlify.app/?features=all&world=jade-ruins
- **Then M4c** (Orbital Ring), **then M5** (one PR). Their decisions are in IMPLEMENTATION.md §M4/§M5.
- **Local machine load:** during the last session this Mac sat at load average 20–37 from other apps. Wall-clock asserts (track generation < 1.5 s, `project()` timing) and the Playwright specs timed out locally, yet passed alone and on CI. Check `uptime` before trusting a local failure; CI is the reference.
- **Logged for later sessions:** M6 audio ([#10](https://github.com/NCSTATEPACK16/MachZero/issues/10)), M7 touch/comfort ([#11](https://github.com/NCSTATEPACK16/MachZero/issues/11)) and M8 progression/modes ([#12](https://github.com/NCSTATEPACK16/MachZero/issues/12)). Each issue lists its scope, done-when criteria and the design gaps to resolve in a grilling session before building (M6 song content, M8 tutorial script and world map look).
- **How to add a world:** author tracks with `npm run tracks:design` (segments in `scripts/track-design.mjs`), add a theme in `graphics/themes/`, and add props in `blender/props/build_props.py`.

## M4c next (Orbital Ring)

Branch `v2/m4c-orbital-ring` off `v2/m4b-jade-ruins` (stack on #14 if it is still open). Scope and decisions: IMPLEMENTATION.md §M4 (loop that holds at any speed, low-g jumps with `airGravityScale` 0.35, mines on Lissajous paths, solid debris on every preset, Earth/atmosphere/station theme). Test-first: a loop hold sim like `sim/pipe.hold.sim.test.ts`, then the Orbital world sims and a mines/debris determinism check in `sim/hazards.sim.test.ts`. Model mines and debris on the gates: `track/features/<hazard>.ts` timeline + pose shared by physics, visuals (`animateHazards`) and the AI (`hazardClock`).

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

GOAL: finish M4 (M4c Orbital Ring), then M5, in order, as far as this session allows, each shippable on its own.
M0–M3 are merged; M4a is PR #13 and M4b is PR #14; M6–M8 are logged as issues #10–#12 and need a design session first.

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

Start by confirming the open PRs' state (gh pr list) and that main is green. If #13/#14 were merged, branch M4c from main;
otherwise stack it on v2/m4b-jade-ruins. Then build M4c (see "M4c next"), then M5.
```
