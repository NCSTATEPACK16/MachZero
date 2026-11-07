# Next-session brief: build MachZero 2.0 (M5 in review; next: §V V1 COMET at its gate, then V2/V3 after approval)

Paste the prompt at the bottom into a fresh Claude Code session (Opus 5.5) opened on
`/Users/johnbradner/Documents/ClaudeWork/MachZero`. Everything above it is the context that prompt relies on.

## Where things stand (2026-11-07: H, §P, §GP and M5 in review; §V V1 COMET is next, stacked on M5)

- **Open PRs, stacked (merge in this order):** #21 → **#22 H Housekeeping** → **#23 §P Powerups** (save v4) → **#24 §GP Grand Prix** (save v5) → **#25 §V spec** (docs, prompt sheet, the user's concept images). Each is built and green locally; the user playtests the previews and merges. If any is still open when you start, stack M5 on the newest open one (#25 at the time of writing) and write "stacked on #N".
- **§V concepts are in:** `assets/reference/ships/<id>/chosen.jpg` for all 6 chassis (one Gemini concept each, resized to ≤ 300 KB; the full-size originals are git-ignored and local only). They are on the brief: three views, no wheels, grounded materials, factory liveries.
- **M5 (PR #26, branch `v2/m5-tiers`, stacked on #24; #25 already merged into `v2/gp-grand-prix`):** tiers, drafting, assists, pilot intro card, the 5 × 4 tier matrix. Read IMPLEMENTATION's "As built (PR #26)" under §M5 before §V or M6. Pending on device: the intro card and DRAFT chip on iPhone/iPad, and a Pilot-tier race to judge pace 0.94.
- Read IMPLEMENTATION's "As built" notes for §H, §P and §GP before M5. Pending on device: the 8BitDo item select (§P) and a pad-only cup (§GP) on iOS.


- **The live site** is https://machzero.netlify.app. Every merge to `main` deploys there, and every PR gets a preview at `https://deploy-preview-<N>--machzero.netlify.app`.
- **The iOS app** (Capacitor 8, `ios/App`, bundle `com.ncstatepack16.machzero`) is on TestFlight. The user tests on an iPhone 18 Pro Max and an iPad Air 11" with an 8BitDo pad in X-input mode.
  - **Every PR must work on both the web and iOS, and end with the iOS build command** (IMPLEMENTATION §0 rule 9).
  - Guide: `docs/IOS_TESTFLIGHT.md`.
  - **Never commit `ios/App/App.xcodeproj/project.pbxproj`**: it carries the user's local build-number bump.
- **Merged into `main`:**
  - M0–M3: #2–#9.
  - **M4a Cryo Station (#13), M4b Jade Ruins (#14).**
  - #15: perf.
  - #16: controller polish.
  - #17: the iOS shell.
  - #18: app icon, pad menus, Rookie pace, damage −50%, **the EMP item**.
  - #19: web icon, plus the specs for M4c, §P and §GP.
  - **#20: M4c Orbital Ring**:
    - the loop-the-loop and low-g jumps;
    - drifting mines (`physics/MineField.ts`, `graphics/MineVisual.ts`) and a debris field;
    - AI hazard avoidance;
    - the Earth/space theme;
    - a heading fix, and ship-to-ship damage applied once per 0.2 s.
  
  M4 is ✅ done. Read IMPLEMENTATION's "As built: M4c" before §P.
- **Flags on `main`:** `profiles`, `garage` and `worlds` are on; `tiers`, `music`, `touch` and `modes` are off. Since #18 the tier comes from the profile (Settings → Race) whatever the `tiers` flag says.
- **Tests:**
  - 352 unit, integration and sim tests in 42 files, about 50 s locally on a loaded machine.
  - 8 Playwright tests (smoke, menus ×3, garage ×2, controller ×2), 8/8 in about 2.8 min.
  - Keep every test file under 60 s.
- **Sizes after M4c:** app 310.7 KB gzip of a 600 KB budget; Rapier 1,615 KB gzip; `public/game` 607.7 KB of 15 MB.

## Next: M5 (spec settled in IMPLEMENTATION §M5; no design session needed)

H, §P and §GP are done (PRs #22–#24). Their original plan follows for reference.

### Done this round (for reference)

1. **H, Housekeeping** (IMPLEMENTATION §H, small): `npm audit fix` without `--force` (vite 8.3.5, vitest 5.0.5, source-map-js 1.2.2), and diagnose and fix the Low-preset haze. Branch `v2/h-housekeeping`.
2. **§P, Powerups:** Shield, Drop Mine, item select, CPU items. IMPLEMENTATION §P. **Read its "Build notes from M4c as built" first.** Three facts from those notes:
   - The mine physics and visual are already shared.
   - The AI must be given the live dropped mines, because it builds its own copy of the track mines.
   - Save v3 becomes v4.
   
   Branch `v2/p-powerups`.
3. **§GP, Grand Prix cups:** IMPLEMENTATION §GP and its build notes. Save v4 becomes v5. It starts `game/modes/`. Branch `v2/gp-grand-prix`.

Stack each branch on the previous PR if that PR is still open (write "stacked on #N").

## What else there is (future sessions; don't start without the user)

- **M5, AI tiers, pilots, drafting** (spec settled in IMPLEMENTATION §M5):
  - Legend in the tier picker; `content/tiers.ts` replacing `AI_PACE`.
  - Drafting; pilot intro cards; `physics/Assists.ts` as logic.
  - The 5 tracks × 4 tiers sim matrix.
  - Ready to build after §GP without a design session.
- **§V, vehicle visual pass** (spec settled in IMPLEMENTATION §V on 2026-11-07; build it after M5):
  - Grounded sci-fi ships and parts, still procedural in `blender/`. A shared trim-sheet atlas (normal and ORM maps), with AO per vertex in `COLOR_0.a`. The livery and decals are unchanged.
  - The player's ship always uses LOD0, cheaper rival materials on Low, the Garage always at High, right-stick orbit in the Garage, rumble only where supported.
  - **V1 COMET is the gate** (the user approves the look and the iPhone/iPad fps), then V2 parts, then V3 the other 5 chassis.
  - It needs the user's Gemini concepts first: `assets/reference/ships/<id>/chosen.jpg` (prompts in `docs/v2/VEHICLE_CONCEPTS.md`). Don't model a chassis without one.
- **M6, audio (#10):** music sequencer, 7 songs, SFX bank. Needs a design session first.
- **M7, touch and comfort (#11):** touch and tilt controls, comfort settings, assist toggles, and the portrait HUD overlap seen on phones. Needs a design session first.
- **M8, modes and polish (#12):** World Tour, Time Trial, ghosts, world map, onboarding, the balance pass, and turning every flag on. Needs a design session first.
- **Smaller ideas worth raising with the user:**
  - more scenery for the existing worlds;
  - the optional separate-WASM Rapier task (IMPLEMENTATION §M0), which would cut about 1.6 MB of base64 from the JS;
  - PR screenshots embedded in PR bodies (none so far).

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
| Bundle | After M4c: app JS 310.7 KB gz, Rapier 1,615 KB gz (base64 WASM), `public/game` 607.7 KB. See IMPLEMENTATION §M0 for the optional separate-WASM task |
| npm audit | 10 dev-only advisories as of 2026-11-02. §H fixes the vite, vitest and source-map ones. The `@capacitor/cli` ones (glob, minimatch, rimraf, uuid, xcode) are accepted: **never** run `npm audit fix --force`, which downgrades the CLI to 4.8.2 |
| Low preset | Washed out on every world (§H item 2); judge visuals at Med or High until it's fixed |
| Assets | `npm run assets` (Blender + glTF Transform) rebuilds `public/game/`. Commit the GLBs; CI only validates them |

## Paste this prompt

```
You are the Principal Engineer building MachZero 2.0, a Three.js + Rapier + Vite anti-gravity racer (F-Zero-like)
in /Users/johnbradner/Documents/ClaudeWork/MachZero. It is live at https://machzero.netlify.app and on TestFlight as an iOS app.

READ FIRST, in this order, before writing any code:
  1. docs/v2/NEXT_SESSION.md: current state and verified environment facts. Trust them; don't rediscover.
  2. docs/v2/SPEC.md: the agreed product spec. Every decision in it is settled; do not re-open it.
  3. docs/v2/IMPLEMENTATION.md: operating rules (§0), v1 code map (§1), target architecture (§2),
     contract changes (§3) and milestones M1 → M8 with "done when" criteria and appendices.
  4. docs/TDD.md: v1 architecture, especially §7 (corkscrew physics invariants you must preserve).

GOAL: build M5 (AI tiers, pilots, drafting; IMPLEMENTATION.md §M5) as one or more PRs, each shippable on its own.
Then build §V V1, the COMET pilot (IMPLEMENTATION.md §V), as its own PR stacked on M5. Model COMET from
assets/reference/ships/comet/chosen.jpg (look at it first). V1 ends at its gate: the user approves the look and
reads the iPhone/iPad fps. Do NOT start V2 or V3 without that approval.
H, §P and §GP are in PRs #22–#24, and the §V spec is in #25 (check which are merged). Read their as-built notes
before coding. M6–M8 need the user first.

HOW TO WORK (agreed with the user; follow exactly):
- Every PR ships to BOTH the Netlify site and the iOS app (IMPLEMENTATION §0 rule 9). Check controller-only play
  and safe areas, and end every PR hand-off with the preview URL plus this iOS build command:
  cd /Users/johnbradner/Documents/ClaudeWork/MachZero && git checkout main && git pull && npm ci && npm run ios:sync && npm run ios:open
  (then in Xcode: Any iOS Device (arm64) → Product → Archive → Distribute App → App Store Connect → Upload).
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
  public/game/ (NOT public/assets/), optimised with gltf-transform (meshopt; materials named by role). Until §V
  ships have no textures; §V V1 adds the shared trim sheet (normal and ORM maps, WebP) as specified in §V.1. Use the Blender MCP (port 9876) only to preview or iterate; if it's not reachable, carry on
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

Start by confirming the open PRs' state (gh pr list) and that main is green. Branch v2/m5-tiers from main, or
from the newest open PR's branch (v2/v-vehicles-spec while #25 is open). Then build M5, then branch
v2/v1-comet from v2/m5-tiers and build §V V1. Never commit ios/App/App.xcodeproj/project.pbxproj (the user's local build
number). No attribution lines in commits or PR bodies.
```
