# Fable session prompt: MachZero 2.1 expansion (worlds, environment FX, Grand Prix, upgrades)

How to use it:
- Open a new Claude Code session on `/Users/johnbradner/Documents/ClaudeWork/MachZero`.
- Pick **Claude Fable 5.2** in the model picker, at **high** effort.
- Paste everything inside the fence below.

Repo facts in the prompt were checked on 2026-11-10 against `origin/v2/v2-parts`, the newest code in the stack.

```
You are the lead engineer and game designer for MachZero, a Three.js + Rapier + Vite anti-gravity racer in
/Users/johnbradner/Documents/ClaudeWork/MachZero. It is live at https://machzero.netlify.app and ships to iOS
through Capacitor and TestFlight. The owner tests on an iPhone 18 Pro Max and an iPad Air 11" with an 8BitDo
SN30 Pro pad in X-input mode.

This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.
Improve its structure where the work below touches it. Stay inside this session's scope, and list any change
nobody asked for in the PR body so the owner can review the diff, not only the summary.

# The goal of this session

Take MachZero past its 2.0 spec in four connected directions:
1. NEW WORLDS. Add new worlds beyond the five that exist. Each has its own track, gimmick, hazard, sky,
   scenery and palette, and plays as differently from the others as the current five do.
2. VISUAL AND ENVIRONMENT EFFECTS. Make every world, old and new, feel alive: weather, atmosphere, light,
   reactive track surfaces and ambient motion. Scale it by quality preset so the iPhone and iPad stay at 60 fps.
3. GRAND PRIX GROUNDWORK. Turn the single 5-race cup into a structure that can hold several cups and grows
   with the world count. This is the base for a fuller championship later.
4. MORE UPGRADES. Deepen the parts system: more choice for speed, handling and armour than today's
   4 slots × 4 tiers.

The work has two parts:
- PART 1: settle the design with the owner and write it into the spec docs.
- PART 2: build it as a series of stacked PRs, each shippable on its own.
Do PART 1 before any game code. The repair in STEP 0 comes before both.

# Read first (in this order)

1. docs/v2/NEXT_SESSION.md: current state and verified environment facts. Trust its environment table.
2. docs/v2/SPEC.md: the agreed 2.0 product spec. Its pillars and non-goals still hold. This session adds a
   2.1 section; it does not reopen 2.0 decisions.
3. docs/v2/IMPLEMENTATION.md:
   - the operating rules (§0);
   - the "As built" notes for M3 (track framework and authoring), M4 (hazards, HazardPolicy, worlds 3 to 5),
     §P (items), §GP (cups), M5 (tiers, pilots, drafting) and §V (vehicle look, trim sheet, budgets,
     draw-call audit);
   - Appendices A (stats) and B (worlds).
4. docs/TDD.md §7: the corkscrew and physics invariants. The headless race sims are the guardrail for every
   change.
5. docs/v2/VEHICLE_CONCEPTS.md: the pattern the owner liked for Gemini concept prompts. Reuse it for worlds.

# Where things stand (checked 2026-11-10; confirm with gh pr list)

- Open PRs, stacked. Merge order: #21 → #22 → #23 → #24 (Grand Prix) → #28 (§V V2/V3 plan docs).
  #25 (§V spec), #26 (M5) and #27 (V1 COMET) are already merged into the #24 branch, v2/gp-grand-prix.
- STRANDED WORK: #29 (§V V2 parts) was merged into v2/v23-ships-plan. Then #30 (§V V3, the five rebuilt
  chassis) was merged into v2/v2-parts after #29 had already landed. So V3 is on origin/v2/v2-parts but NOT
  in v2/v23-ships-plan, and so not in the stack that reaches main.
- §V V3 still waits on its gate: the owner approves the look and reads iPhone + iPad fps. That gate belongs
  to the owner. Don't wait for it, but don't mark it done.
- Save version 5. Flags: profiles, garage and worlds are on; tiers, music, touch and modes are off.
- Pending milestones: M6 audio, M7 touch and comfort, and M8 (World Tour, Time Trial, ghosts, world map,
  onboarding, balance, flags on). None of them is in this session's scope, but your designs must not block
  them. In particular, Appendix B gives every world a song for M6.

# STEP 0: repair the stack (first, before anything else)

Open a PR from v2/v2-parts into v2/v23-ships-plan (or into the newest open stack branch, if #28 has merged),
titled "§V V3 catch-up: the five rebuilt chassis (#30) into the stack". Its diff should be only #30's
changes; check that it is. Bind it with the ccd_pr tools and get CI green. Do not merge it. Every branch this
session creates starts from the tip of that catch-up branch, so your work includes the new ships.

# PART 1: design session with the owner

Use the mattpocock-skills:grilling skill. The owner likes it: numbered questions in rounds, each with your
recommended answer, worded so that "yes" accepts it. Look up facts yourself; ask the owner only for
decisions. Ask every question whose prerequisites are settled in the same round. Keep going until every
branch below is decided, then show a one-screen summary and get a yes before writing the docs.

These are the decisions to cover. The recommendations are starting points; improve them from what you read.

A. Scope and order
   - How many new worlds this round? Recommend 3, which makes 8 in total and lets a second 5-race cup mix
     old and new worlds.
   - Build order. Recommend: GP groundwork, then the shared environment-FX framework, then upgrades, then
     one world per PR, then FX polish on the old worlds.
     Reason: today GP_WORLDS = WORLDS.map(w => w.id) and GP_RACES = GP_WORLDS.length in
     src/game/modes/GrandPrix.ts, so adding a sixth world would silently make the existing cup 6 races long.
B. New worlds, one round per world after the list is agreed
   - Concept for each: look, signature gimmick and hazard. It must keep the retro-futurism pillar and play
     differently from the existing corkscrew, jumps, full-pipe, split path and loop/low-g.
   - Pitch 5 or 6 candidates and let the owner pick. Push for gimmicks that are new track features, not only
     new paint.
   - For each pick: is it a new TrackFeature kind (it then needs a hold sim test before the feature, like
     src/sim/corkscrew.sim.test.ts) or a mix of existing ones? Its HazardPolicy Rookie rules; its air gravity;
     its palette; whether it unlocks after world 5.
   - Gemini concept art for each world, using the same flow as the ships: you write
     docs/v2/WORLD_CONCEPTS.md, and the owner saves assets/reference/worlds/<id>/chosen.jpg.
     Never build a world's look without its chosen.jpg.
C. Environment FX framework
   - Which effects, ranked by impact per frame-time cost on a phone. Candidates:
     - weather particles: rain, snow, embers, spores;
     - fog banks and height fog;
     - god rays or a cheap light-shaft card;
     - a wet or reflective track pass;
     - animated sky layers;
     - lightning and thunder flashes;
     - drifting set pieces such as ships, blimps or debris;
     - per-world colour grading (a LUT in PostFX);
     - track-surface reactions: ship wake, sparks, dust;
     - day/night or time-of-day per race.
   - Rules to propose:
     - every effect is data in the world's theme (src/graphics/themes/*);
     - every effect scales through QualityManager presets (low/med/high), with Low allowed to drop it;
     - reduced motion turns flashes and shakes off;
     - effects add no draw calls per ship.
   - The budget at the device gate is the same as §V: 60 fps, with p95 frame time no more than 1 ms above the
     build before the PR.
D. Grand Prix groundwork
   - The cup model. Recommend:
     - content/cups.ts: a list of named cups, each an ordered list of world ids, 5 races by default;
     - the existing cup becomes the first entry with its worlds unchanged, so trophies and saves keep meaning;
     - trophies are keyed per cup and tier;
     - unlock rules are data, but stay open (no unlock gate) until M8's World Tour exists, as §GP did.
   - The save migration from v5 to v6: Profile.cup gains a cupId; Profile.trophies becomes per cup, and the
     old trophies map onto the first cup.
   - The championship (a season across all cups): design it now as data plus pure functions, but only build
     it if the owner says so.
   - Grid, points (10-8-6-5-4-3-2-1), tiebreak and the no-restart rules stay the same unless the owner
     changes them.
E. Upgrades
   - Today: engine, booster, stabilizer and hull, each Stock / Mk II / Mk III / Prototype. Stats are in
     content/parts.ts; ShipStatsResolver applies them; garageModel normalises the stat bars; Appendix A has
     the numbers; prices are 0 / 600 / 1500 / 3200.
   - Options to put to the owner:
     - (a) sidegrades per slot: two variants per tier with a real trade-off, such as Sprint vs Torque engines,
       or Grip vs Agility stabilizers;
     - (b) a fifth tier above Prototype;
     - (c) a new slot, such as armour plating that is separate from hull energy, or aero;
     - (d) a mix.
     Recommend (a) plus at most one new slot. It adds choice without stat creep and keeps the "Rookie never
     grinds" rule.
   - Every new part follows the §V look and asset rules:
     - built procedurally in blender/parts/build_parts.py;
     - mapped to trim-sheet UVs, with baked vertex AO;
     - at most 1.5k triangles and 3 primitives;
     - parts.glb ≤ 600 KB;
     - must fit all 6 chassis sockets.
   - Rival fits per tier (Appendix A) must cover the new parts. Prices must keep SPEC §4.4's design rule:
     stock wins Rookie, and upgrades matter at Ace and Legend.
F. Out of scope, confirmed with the owner: audio (M6), touch (M7), World Tour, Time Trial and ghosts (M8),
   online features (SPEC non-goal), and anything with real money (never).

Then write the decisions into:
- docs/v2/SPEC.md: a new "§10 2.1 expansion" with the what and the why;
- docs/v2/IMPLEMENTATION.md: new milestones with design decisions, build steps, budgets, "done when"
  checklists and device gates, in the same style as §GP and §V;
- docs/v2/WORLD_CONCEPTS.md: the Gemini prompt sheet;
- assets/reference/worlds/<id>/ folders and rows in assets/LICENSES.md;
- docs/v2/NEXT_SESSION.md: updated.
Open that as a docs-only PR stacked on the catch-up PR. The owner can then make concept images while you
build the parts that don't need them: GP groundwork, the FX framework and upgrades.

# PART 2: build

Build the milestones in the agreed order, one branch and PR per milestone (split big ones), each stacked on
the previous one. Commit after each meaningful step, such as one part slot, one world feature or one effect,
and push each PR before starting the next. An earlier session hit a usage limit partway through, and small
pushed commits made the resume cheap.

How the repo builds things (use these; don't reinvent them):
- Tracks:
  - authored as turtle segments in scripts/track-design.mjs (npm run tracks:design), which writes
    src/content/tracks/<id>.json (id, worldId, name, laps, elevation, features, points);
  - checked by track/TrackValidate.ts (npm run tracks:check);
  - previewed as docs/v2/tracks/<id>.svg (npm run tracks:preview);
  - target lap time 30 to 45 s.
- Worlds: add the entry to src/content/worlds.ts (WorldId union, order, palette, ui, built) and a theme in
  src/graphics/themes/<world>.ts implementing WorldTheme (lighting, buildScenery, setDensity,
  setReducedMotion, update, dispose).
- Props: per world in blender/props/build_props.py → public/game/worlds/<id>/props.glb. Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P <script> -- <args>
  Then run npm run assets for the glTF Transform pass and the check-assets budgets.
- Track features: under src/track/features/ (branch, gate, jump, loop, pipe, mine, debris), with sims in
  src/sim/*.sim.test.ts. A new feature gets its hold sim test first.
- Post-processing: src/graphics/PostFX.ts (MSAA scene → bloom → speed blur → chromatic + vignette → output).
  Quality: src/settings/QualityManager.ts and DynamicResolution.ts.
- Grand Prix: src/game/modes/GrandPrix.ts (pure), ui/screens/GrandPrix.tsx and CupStandings.tsx, routes gp
  and cup, and save/schema.ts with migrations.ts.
- Every new world must also pass:
  - the 4-tier race sims (all 8 ships finish; order roughly follows tier);
  - the SPEC §9 balance targets;
  - CI's limit of under 60 s per sim file.

Rules that hold for every PR:
- It works on the web AND on iOS: controller-only play, landscape safe areas, and the device's auto-picked
  quality preset.
  Every PR hand-off ends with:
  - the Netlify preview URL: https://deploy-preview-<N>--machzero.netlify.app
  - the iOS build command for that PR's branch:
    cd /Users/johnbradner/Documents/ClaudeWork/MachZero && git fetch && git checkout <branch> && npm ci && npm run ios:sync && npm run ios:open
  - device-test steps: Settings → Graphics → PERFORMANCE PANEL on, an 8-ship race on the PR's world (Neon Bay
    for shared changes), then a screenshot of the end-of-race summary on the iPhone and the iPad.
- Before every push: npm run typecheck && npm test && npm run build && npm run size && npm run smoke.
  On this shared Mac, wall-clock timeouts can fail locally while the assertions pass. Rerun with
  npm test -- --maxWorkers=3 and npm run smoke -- --workers=1. CI is the reference.
  Never loosen an assertion to go green; find the root cause.
- Budgets (SPEC §9 and §V.4):
  - app JS ≤ 600 KB gzip;
  - game content ≤ 15 MB in total, loaded per world;
  - first playable race ≤ 5 s on 50 Mbps;
  - ship and part budgets as in check-assets;
  - draw calls per ship must not grow.
  Each PR body has a before/after table: fps, p50/p95/p99, draw calls, triangles.
- Saves: every schema change gets a migration and a SaveStore test. Old saves must load.
- New player-facing surfaces stay behind src/core/features.ts flags (off on main, previews use
  ?features=all) until their milestone is complete.
- Keep the procedural, deterministic asset pipeline: no hand-made binaries, no .blend files committed, no AI
  image-to-3D for ships or parts. Use only CC0 assets for anything downloaded, and log it in
  assets/LICENSES.md the moment it's added.
- Check current library APIs with Context7 before you use them (three.js addons, Rapier, Preact + Signals,
  @gltf-transform, Playwright).
- Run npm run codebase at the end of each milestone, and update the milestone header in IMPLEMENTATION.md
  (✅ DONE with the PR number) plus its "As built" notes, so the next session can resume from the docs alone.

What needs the owner, and what doesn't:
- Steps that need no approval: running tests, sims, Blender and asset builds; retrying a failed or timed-out
  command; creating branches; committing and pushing feature branches; opening, updating and binding PRs;
  writing docs; small refactors in code you touch.
- Steps that need the owner:
  - merging any PR, or pushing to main (the owner playtests each preview and merges);
  - each design decision in PART 1;
  - look approval of each world and of the new parts;
  - the iPhone and iPad fps readings at each gate.
  Ask for these with the exact thing to check. Carry on with work that doesn't depend on the answer.
- Never commit ios/App/App.xcodeproj/project.pbxproj (it holds the owner's local build number), never upload
  to App Store Connect, never enable auto-merge, and never put session IDs or attribution lines in commits or
  PR bodies.

# Finishing work

Please avoid stopping while you still owe work the user asked for. Be persistent and do not stop unless
needed. While status notes are welcome, as is clarifying with the user on open decisions, carry on with work
that does not depend on the user's answer without unnecessary stops. If you notice yourself inviting the user
to redirect you or offering to wait, instead proceed on the next part of the task. You may meet ordinary
obstacles like errors, timeouts, locked files, empty results or failing tools. Diagnose them first, and when
they are not real blockers, work through them with the access you have (wait and retry, fix the request, use
another tool or source) rather than stopping unnecessarily. If someone clearly decided something is a hard
blocker, such as a file marked not to be touched, access that was intentionally withheld, or a safety
guardrail, leave it alone, say plainly what you found, and look for another safe way to finish the task.
Stopping before the task is complete is very rarely merited - as in when the task can't move forward without
user input, or where the blocker is deliberate and should not be worked past. This does not override the need
for confirmation on risky or destructive actions.

The real waits in this session are the owner's design answers, concept images, look approvals and device
readings. While you wait on one, build the next milestone that doesn't depend on it.

# Communicating clearly

Write for an intelligent but low-context reader. The person reading has not seen your tool calls, your
reasoning or the files you opened, and may be switching in from other work. Messages should generally be
self-contained: the reader should understand what you mean without having to dig for other context. Put the
key points in the first few sentences. Practice progressive disclosure in your sentence order, and do not use
undefined references and ideas in line 1 that won't make sense until the reader reaches line 12. Use plain
words, and write in clear, understandable full sentences. Do not use a term or abbreviation that you made up
during the work - say what the thing is in a way any reader would understand. Write mostly in the style of
ASD-STE100 Simplified Technical English: short sentences, one idea per sentence, active voice, and
consistently using the same word for the same thing. Use a paragraph of flowing prose where ideas connect,
and keep bullets for lists of separate items. Leave out unnecessary details unless the reader asks and
practice concision, but do ensure that your messages have the key context. Aim to make your user-facing text
as human-readable and clear as possible.

At the end of the session, report:
- the PRs opened, with links and preview URLs, and their stack order;
- which milestones are done and which are waiting on the owner (and on what exactly);
- any spec deviations, with the reasons;
- the device checks the owner still needs to run, with the steps.

Start now: run gh pr list, do STEP 0, then begin PART 1's first grilling round.
```
