# Next-session brief: MachZero (M8d built 2026-11-22: the "MachZero 2.0" release PR; 2.0 is complete in code)

**MachZero 2.0 is built.** M7 and M8 are done; what is left of 2.0 is the owner's QA checklist and the merges. The prompt at the bottom of this file continues the 2.1 expansion (the world looks and X7), and the M8d prompt below is kept for reference. Everything else is the context those prompts rely on.

## M8d built (2026-11-22)

- **M8d is built** as **NCSTATEPACK16/MachZero#49 "MachZero 2.0"** on `v2/m8d-release`. Read IMPLEMENTATION §M8d "As built".
- **#49 missed `main`:** #48 was merged into `main` (2026-11-22), then #49 14 s later into `v2/m8c-season-tutorial`, which had already been merged. So M8d is not on `main`, and the live site still runs M8c with `modes` off. **NCSTATEPACK16/MachZero#50** (head `v2/m8d-release`, base `main`, no new code) carries it there. Until #50 merges, 2.0 is not live.
- **What it did:**
  - the economy guard (`sim/economy.{a,b,c}.sim.test.ts`);
  - the tier matrix and every guard re-run green;
  - **`modes` on** (its own commit, so it can be reverted alone);
  - **the six finished flags removed** (`profiles`, `garage`, `worlds`, `tiers`, `touch`, `modes`) with their dead branches: `FEATURE_NAMES` is `music` and `expansion`;
  - the README, TDD §8 (the 2.0 architecture) and these docs.
- **Found while building:** §M8's measured economy table is one part tier too low (its "Mk II kit" is Mk III, its "Mk III kit" is Prototype). Today's code reproduces its numbers exactly. The bands guard the kits that were measured; see the correction under §M8's table.
- **Waiting on the owner:**
  - **The QA checklist** in IMPLEMENTATION §M8d (both devices): a new Rookie profile by touch through the tutorial, world 1, the unlock, a Mk II part and world 2; a Classic profile by pad through a Pilot race and CONTINUE CUP; Time Trial fps with both ghosts; an old save from the live site (export it first); the comfort settings on the map, the results and a trial; an 8-ship race on each world at 60 fps.
  - **The merge of #50** (M8d to `main`). #48 and #49 are merged.
  - Still open from earlier PRs: the M7–M8c device gates and look checks (the 2.0 QA checklist covers them), the default air-brake style, and tilt's direction on iOS.
- **Device builds now need only `expansion`:** `VITE_FEATURES=expansion npm run ios:sync`. `modes` is ignored, so the old commands still work.
- **Next:** the 2.1 world looks (X4–X6) when their `chosen.jpg` images arrive, or X7; M6 (audio) is still not designed. Use the 2.1 prompt at the bottom of this file. `expansion` stays off until each look is approved.

## M8c built (2026-11-22)

- **#47 merged everything to main** (2026-11-22): #37–#39 (X4–X6 gameplay), M7, M8a (#45) and M8b (#46). #37 shows as merged and #38 is closed; **#39 is still open** and can be closed by hand (its content is on main).
- **M8c is built** as **NCSTATEPACK16/MachZero#48** on `v2/m8c-season-tutorial` (base `main`): the championship season (CHAMPIONSHIP card, season table between cups, champion crowns and bonus) and the first-race tutorial (five prompts over a real race, SKIP, REPLAY TUTORIAL). Behind `modes`. Read IMPLEMENTATION §M8c "As built" before M8d.
- **Waiting on the owner in M8c:**
  - The device check: the iPad by touch and the iPhone by pad, `VITE_FEATURES=modes,expansion`. A new Rookie profile's first race with the tutorial (a first-time player, if one is at hand), then a season from a fixture profile.
  - The look of the championship card, the season table, the crowns and the tutorial prompt. On a phone the prompt covers the back of the ship.
- **M8d stacked on `v2/m8c-season-tutorial`** (built; see above).

## M8b built (2026-11-21)

- **M8b is built** as **NCSTATEPACK16/MachZero#46** on `v2/m8b-time-trial` (base `v2/x6-abyss-line`, which holds M7 and M8a): ghosts (codec, recorder, player, IndexedDB store), Time Trial rules and medals, the 8 baked dev ghosts and `DEV_TIMES` with their guard, the trial race, the ghosts on screen, the trial HUD, the Time Trial screen and the trial results. Behind `modes`. Read IMPLEMENTATION §M8b "As built" before M8c.
- **Waiting on the owner in M8b:** the device gate: fps with two ghosts on Neon Bay and Abyss Line, on both devices, and the best ghost still there after a relaunch.
- **Re-bake the dev ghosts** (`npm run ghosts:bake`) whenever a track or the physics changes. The guard test in `sim/ghostBake.sim.test.ts` fails until you do.
- **#44 and #45 are merged** (2026-11-21): #45 into `v2/m7c-comfort`, then #44 carried M7 and M8a into `v2/x6-abyss-line` (#39's head). So M8b's PR is based on `v2/x6-abyss-line`, and its diff is M8b alone.
- **M8c stacks on `v2/m8b-time-trial`.** Merge order to main: #37 → #38 → #39 → #46 (M8b) → M8c.

## M8a built (2026-11-20)

- **M7's stack was merged into the wrong bases:** #41–#43 were merged a few seconds apart, each into a branch already merged, so none of M7 reached `v2/x6-abyss-line` or main. **NCSTATEPACK16/MachZero#44** (head `v2/m7c-comfort`, base `v2/x6-abyss-line`, no new code) puts all of M7 back in the stack. Merge order to main: #37 → #38 → #39 → #44 → #45 (M8a).
- **M8a is built** on `v2/m8a-world-tour` (base `v2/m7c-comfort`): save v9, World Tour rules, cup unlocks, the world map, booking at the results, the results screen, the sound hooks. Behind `modes`. Read IMPLEMENTATION §M8a "As built" before M8b: it records the decisions made while building (the chain rule, granting with `modes` off, the season sanitizer, `App.events`, `data-nav-<dir>`).
- **Waiting on the owner in M8a:** the look of the map and the results screen; the device check (pad and touch on both devices, with `VITE_FEATURES=modes,expansion`).
- **M8b stacks on `v2/m8a-world-tour`.**

## M7 built (2026-11-19)

- **M7 is built, as three stacked PRs:**
  - **NCSTATEPACK16/MachZero#41 M7a** (`v2/m7a-assists`, base `claude/zen-knuth-uw6y2i` = the M7 + M8 design-docs PR #40);
  - **#42 M7b** (`v2/m7b-touch`, base `v2/m7a-assists`);
  - **#43 M7c** (`v2/m7c-comfort`, base `v2/m7b-touch`).

  `touch` is on in #43. Read IMPLEMENTATION §M7a, §M7b and §M7c "As built" before M8.
- **Waiting on the owner in M7:**
  - the device check of #41;
  - the device gates of #42 and #43;
  - **the default air-brake style** (#42's gate);
  - **tilt's direction and permission on iOS**: not verified on a device or against current WebKit docs (§M7c as built). If tilt steers the wrong way, flip `TiltInput`'s iOS sign.
- **CI:**
  - **The browser smoke job's time limit is now 20 min** (#41). At 10 it was cancelled after every spec had passed, on #39 and #40 as well.
  - **Slow world smokes on a cloud build container:** the Cinder Forge and Abyss Line smokes (and Tempest Spire under load) hit the 2-minute per-test cap on a CPU-only cloud container, on the base branch too. CI and the owner's Mac run them in time.
- **M8a stacked on `v2/m7c-comfort`** (built; see above).


- **M7 (touch, tilt, assists, comfort) and M8 (World Tour, Time Trial and ghosts, the championship, the tutorial, the release) are designed and agreed** (45 decisions, two rounds with the owner). Read SPEC §11 and §12 (what and why) and IMPLEMENTATION §M7 and §M8 (decisions, build steps with tests first, budgets, "done when", device gates). They are written to be built with no further questions.
- **Build order, one stacked PR each:**

  | # | PR | Branch | Save | Flag |
  |---|---|---|---|---|
  | 1 | M7a ✅ #41: the four assists work, the assists screen | `v2/m7a-assists` | v7 → v8 | none |
  | 2 | M7b ✅ #42: touch driving and the touch HUD | `v2/m7b-touch` | — | behind `touch` |
  | 3 | M7c ✅ #43: tilt, menus by touch, comfort, pad remapping | `v2/m7c-comfort` | — | `touch` on |
  | 4 | M8a ✅ #45: World Tour, the world map, the results screen | `v2/m8a-world-tour` | v8 → v9 | behind `modes` |
  | 5 | M8b ✅ #46: Time Trial and ghosts | `v2/m8b-time-trial` | — | behind `modes` |
  | 6 | M8c ✅ #48: the championship season and the tutorial | `v2/m8c-season-tutorial` | — | behind `modes` |
  | 7 | M8d ✅ #49, to main via #50: balance, flags on and removed, the "MachZero 2.0" PR | `v2/m8d-release` | — | `modes` on, six flags removed |

- **The world looks (X4–X6) and X7 fit in whenever their images or approvals arrive.** They block nothing, and M7 and M8 do not wait for them. `expansion` stays off until each world's look is approved (the owner's answer to the open question on #39).
- **Found while designing (IMPLEMENTATION §M7 has the details):** the four assists do nothing in the live game today, although the Rookie preset promises them. M7a repairs that first, with no flag.
- **Waiting on the owner in M7 and M8:** the device gate of each PR; the default air-brake style at the M7b gate; the look of the world map and the results screen (M8a); the merge of every PR.
- **M6 (audio) is still not designed.** M7 and M8 add no sounds: they emit named bus events (IMPLEMENTATION §M8a step 8) for M6 to use.

### Paste this prompt: M8d (done; kept for reference)

```
You are the Principal Engineer building MachZero, a Three.js + Rapier + Vite anti-gravity racer in
/Users/johnbradner/Documents/ClaudeWork/MachZero. It is live at https://machzero.netlify.app and on TestFlight
as an iOS app (Capacitor 8). The owner tests on an iPhone 18 Pro Max and an iPad Air 11" with an 8BitDo pad.

READ FIRST, in this order, before writing any code:
  1. docs/v2/NEXT_SESSION.md: current state, the build order and the environment table. Trust the table.
  2. docs/v2/SPEC.md §12 (and §4): what M8 is and why. Every decision is settled; do not re-open one.
  3. docs/v2/IMPLEMENTATION.md §0 (operating rules), §M7's three "As built" notes (M8 builds on save v8, the
     touch HUD and the comfort tokens), then §M8 (the whole section, M8a's, M8b's and M8c's "As built", then "M8d" closely).
  4. The code M8d changes, as §M8d lists it.

GOAL: build M8d exactly as IMPLEMENTATION §M8d says (the balance pass, `modes` on, the flag clean-up, the
"MachZero 2.0" release PR). One PR on branch v2/m8d-release, stacked on v2/m8c-season-tutorial (the M8c PR, or main
once it is merged). Follow the build steps in order, tests first. Stop at the device gate only for what it needs from
the owner (the full QA checklist on both devices, and the merge), and carry on meanwhile.

HOW TO WORK (agreed with the owner; follow exactly):
- You implement everything yourself, in order. Sub-agents only for read-only lookups.
- Never merge a PR, push to main or enable auto-merge. The owner playtests each preview and merges.
- main is live: everything new stays behind `modes` until M8d turns it on. Every existing test passes unchanged
  unless a step says to update one.
- Before every push: npm run typecheck && npm test && npm run build && npm run size && npm run smoke.
  On this shared Mac use npm test -- --maxWorkers=3 and npm run smoke -- --workers=1. Fix red CI before
  moving on. Never loosen an assertion to go green; find the root cause.
- Confirm current library APIs with Context7 before relying on them. Use jCodemunch for code navigation.
- Local dev server: npm run dev -- --port 5180.
- Never commit ios/App/App.xcodeproj/project.pbxproj. Leave docs/v2/FABLE_PROMPT*.md alone.
- No session IDs or attribution lines in commits or PR bodies. Run npm run codebase at the end of each PR.

AT EACH PR: the body holds what shipped, the "done when" list from IMPLEMENTATION ticked or explained, test
counts and sim summaries, sizes from npm run size, screenshots where visual, any change nobody asked for, and
the device-gate steps. End the hand-off with the preview URL
(https://deploy-preview-<PR#>--machzero.netlify.app, add ?features=modes) and the iOS build command for the
PR's branch: git fetch && git checkout <branch> && npm ci && VITE_FEATURES=modes,expansion npm run ios:sync && npm run ios:open

AT THE END OF THE SESSION: report the PRs opened (links and preview URLs), what each device gate needs from
the owner, any deviation from the spec with its reason, and update IMPLEMENTATION.md (mark each built PR, add
its "As built" notes) and this file so the next session can resume from the docs alone.

Start now: list the open PRs (gh api repos/NCSTATEPACK16/MachZero/pulls), read the files above, then run the
balance measurements M8d's first step names.
```

## Where things stand (2026-11-15, after the X6 gameplay half)

- **Resume here:** X0–X3 are merged into `main` (#36 and #35, 2026-11-11). **X4 Tempest Spire, X5 Cinder Forge and X6 Abyss Line each have their gameplay half built, as draft PRs: #37 (`v2/x4-tempest-spire`, base `main`), #38 (`v2/x5-cinder-forge`, stacked on #37) and #39 (`v2/x6-abyss-line`, stacked on #38).** All three worlds run on the placeholder theme. With Abyss Line built, the Storm Cup plays whenever `expansion` is on. Read IMPLEMENTATION §X4, §X5 and §X6 "As built: the gameplay half" first.
  - **For each world whose `assets/reference/worlds/<id>/chosen.jpg` exists** (`tempest-spire`, `cinder-forge`, `abyss-line`): finish its look on its own branch: the theme in `graphics/themes/`, its builder in `blender/props/build_props.py`, the `envfx` set, the perf table on the real look, the shots; swap the placeholder line in `themes/index.ts`, delete `props: false` from the world entry, then mark the PR ready. Go in stack order (Tempest Spire, then Cinder Forge, then Abyss Line), merging each finished branch into the next one up.
  - **If no image exists:** start X7 (effects on the five 2.0 worlds) on `v2/x7-old-world-fx`, stacked on `v2/x6-abyss-line`. X7 needs no concept image: its looks are approved on the preview.
  - **Open decision for the owner (raised in #39):** turn `expansion` on by default in #39, or keep it off until the three looks are approved.
- **`expansion` is still off.** Turn it on when the user approves the look of X3's parts. A world also needs its own look approved before its card shows on `main`.
- **Device builds of flagged features:** `VITE_FEATURES=expansion npm run ios:sync` (docs/IOS_TESTFLIGHT.md). Without it the app hides Tempest Spire, Cinder Forge, Abyss Line and the Storm Cup.
- **Close by hand:** #24, #28, #31, #32 and #33 are still open, and their content is in `main` through #36.
- **The 2.1 expansion is designed and agreed** (25 decisions, grilling session with the user). Read SPEC §10 (what and why) and IMPLEMENTATION §X (milestones X1–X7, each with decisions, build steps, budgets, "done when" and its device gate).
- **Stack, in merge order:** #21, #22, #23 → #24 (Grand Prix) → #28 (§V V2/V3 plan; holds #29 V2 parts) → **#31 (§V V3 catch-up)** → the X0 design-docs PR → X1 … X7. The user playtests and merges; never merge.
- **#31 exists because #30 (V3, the five rebuilt chassis) was merged into `v2/v2-parts` after #29 had already gone into `v2/v23-ships-plan`.** #31 carries exactly #30's 20 files into the stack. Every 2.1 branch starts from its tip.
- **§V V3's gate is still open and belongs to the user:** look approval of DART, WISP, ARROW, TITAN and BASTION, and the iPhone + iPad readings (steps in #30's body). Don't wait for it and don't mark it done.
- **Build order (one stacked PR each):** X1 cups groundwork (save v6) → X2 environment effects framework → X3 upgrades (save v7) → X4 Tempest Spire → X5 Cinder Forge → X6 Abyss Line + the Storm Cup → X7 effects on the five 2.0 worlds. The milestone table at the top of IMPLEMENTATION §X shows which are done.
- **Waiting on the user:**
  - **World concept images:** `assets/reference/worlds/<id>/chosen.jpg` for `tempest-spire`, `cinder-forge`, `abyss-line`, made in Gemini from `docs/v2/WORLD_CONCEPTS.md`. **Never build a world's look without its `chosen.jpg`.** The track, gimmick, hazard, AI and sims come first on a placeholder theme.
  - Look approvals: the new parts (X3), each new world (X4–X6), each 2.0 world's effects (X2 for Neon Bay, X7 for the rest).
  - The device gate of each milestone (IMPLEMENTATION §X "Rules for every X milestone").
- **Flag:** `expansion` (off on `main`, added in X3) hides the new worlds, the Storm Cup and the Aero tab and variant picker until their milestone is complete.
- **Out of scope for 2.1:** M6 audio, M7 touch, M8 (World Tour, Time Trial, ghosts). Each new world has its song row in Appendix B so M6 is not blocked.

## Earlier state (2026-11-08, end of the V2 + V3 session)


- **§V V2 parts: PR #29** (`v2/v2-parts`, stacked on #28). **§V V3 chassis: PR #30** (`v2/v3-chassis`, stacked on #29). Both are built, with CI green and the as-built notes in IMPLEMENTATION §V.
- **Waiting on the user:**
  - their look approval of the parts (#29) and of each of the 5 chassis (#30);
  - **perf-panel readings on the iPhone 18 Pro Max and the iPad Air**: Settings → Graphics → PERFORMANCE PANEL, an 8-ship Neon Bay race, screenshot the end-of-race summary. The iPad needs a "before" reading on a #29 build and an "after" on #30; the iPhone's baseline is #29.
- **A rejected chassis** goes back for a follow-up commit on `v2/v3-chassis`. The legacy builder is deleted, so a rejected chassis is reworked in its `build_<id>` rather than reverted.
- The draw-call audit settled the "94 → 220" watch item: the panel shows one frame's count, and it varies 82–281 within a race. Rivals now merge their parts per role (grid frame 252 → 161).
- **Next after the gate:** M6 (audio) needs a design session with the user first.

## Earlier state (2026-11-08: V1 COMET passed its gate; V2 + V3 were next)

- **Open PRs, stacked (merge in this order):** #21 → **#22 H Housekeeping** → **#23 §P Powerups** (save v4) → **#24 §GP Grand Prix** (save v5). **#25 (§V spec), #26 (M5) and #27 (V1 COMET) are already merged into `v2/gp-grand-prix`**, so #24 now carries them too. The V2/V3 plan PR is stacked on #24 as well. The user playtests and merges. Stack new work on the newest open branch and write "stacked on #N".
- **The user ships TestFlight builds from `v2/gp-grand-prix`** (M5 + COMET) ahead of `main`; the web catches up when the stack merges.
- **§V concepts are in:** `assets/reference/ships/<id>/chosen.jpg` for all 6 chassis (one Gemini concept each, resized to ≤ 300 KB; the full-size originals are git-ignored and local only). They are on the brief: three views, no wheels, grounded materials, factory liveries.
- **M5 (PR #26, branch `v2/m5-tiers`, stacked on #24; #25 already merged into `v2/gp-grand-prix`):** tiers, drafting, assists, pilot intro card, the 5 × 4 tier matrix. Read IMPLEMENTATION's "As built (PR #26)" under §M5 before §V or M6. Pending on device: the intro card and DRAFT chip on iPhone/iPad, and a Pilot-tier race to judge pace 0.94.
- **§V V1 COMET (PR #27) passed its gate on 2026-11-08:** the look is approved, and the iPhone reads 60 fps with p95 17.0 ms before and after. There is no iPad reading yet; it moves to V3's gate. Watch item: draw calls rose 94 → 220. The table and notes are under IMPLEMENTATION §V "V1 gate result". **Next: V2 + V3, following the plan in IMPLEMENTATION §V.7 exactly.**
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
  - V1 COMET ✅ (gate passed 2026-11-08). **V2 parts + V3 the other 5 chassis are next: one session, two stacked PRs, per §V.7.**
  - It needs the user's Gemini concepts first: `assets/reference/ships/<id>/chosen.jpg` (prompts in `docs/v2/VEHICLE_CONCEPTS.md`). Don't model a chassis without one.
- **M6, audio (#10):** music sequencer, 7 songs, SFX bank. Needs a design session first.
- **M7, touch and comfort (#11):** designed 2026-11-16 (SPEC §11, IMPLEMENTATION §M7). Ready to build: see the top of this file.
- **M8, modes and polish (#12):** designed 2026-11-16 (SPEC §12, IMPLEMENTATION §M8). Ready to build after M7.
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

## Paste this prompt: the 2.1 expansion (world looks and X7)

```
You are the Principal Engineer building MachZero 2.0, a Three.js + Rapier + Vite anti-gravity racer (F-Zero-like)
in /Users/johnbradner/Documents/ClaudeWork/MachZero. It is live at https://machzero.netlify.app and on TestFlight as an iOS app.

READ FIRST, in this order, before writing any code:
  1. docs/v2/NEXT_SESSION.md: current state and verified environment facts. Trust them; don't rediscover.
  2. docs/v2/SPEC.md: the agreed product spec. Every decision in it is settled; do not re-open it.
  3. docs/v2/IMPLEMENTATION.md: operating rules (§0), v1 code map (§1), target architecture (§2),
     contract changes (§3) and milestones M1 → M8 with "done when" criteria and appendices.
  4. docs/TDD.md: v1 architecture, especially §7 (corkscrew physics invariants you must preserve).

GOAL: continue the 2.1 expansion (SPEC §10, IMPLEMENTATION §X). Find the first milestone in §X's table that
is not marked done, read its section and the "As built" notes of the milestones before it, and build it as one
stacked PR. Hold sim tests come before each new track feature. Never build a world's look without
assets/reference/worlds/<id>/chosen.jpg: build the track, gimmick, hazard, AI and sims on a placeholder theme
and move on. Commit after each meaningful step and push each PR before starting the next. Each milestone ends
at its gate: the user approves the look and reads iPhone AND iPad fps. M6 needs the user first (M7 and M8 are done).

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
  ships had no textures; since §V V1 they use the shared trim sheet (normal and ORM maps, WebP), see §V.1 and V1's as-built notes. Use the Blender MCP (port 9876) only to preview or iterate; if it's not reachable, carry on
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

Start by confirming the open PRs' state (gh pr list). Branch from the newest open stack branch (the last X
branch pushed; from main when no X branch is open). Never commit ios/App/App.xcodeproj/project.pbxproj (the user's local build number). No
attribution lines in commits or PR bodies. End every PR hand-off with the preview URL, the iOS build command
for that PR's branch (git fetch && git checkout <branch> && npm ci && npm run ios:sync && npm run ios:open; put
VITE_FEATURES=expansion before npm run ios:sync when the PR's work is behind that flag) and the device-test steps.
```
