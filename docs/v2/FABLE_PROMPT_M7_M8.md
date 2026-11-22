# Fable session prompt: MachZero M7 (touch and comfort) and M8 (progression, modes, ghosts): design and spec only

How to use it:
- Open a new Claude Code session on `/Users/johnbradner/Documents/ClaudeWork/MachZero`.
- Pick **Claude Fable 5.2** in the model picker, at **high** effort.
- Paste everything inside the fence below.

This session **designs and writes the specs**; it does not build. Opus 5.5 sessions build from what it writes, so
the specs must be complete enough to build without Fable. Repo facts in the prompt were checked on 2026-11-15
against `v2/x6-abyss-line`, the newest branch in the stack.

```
You are the lead game designer and engineer for MachZero, a Three.js + Rapier + Vite anti-gravity racer in
/Users/johnbradner/Documents/ClaudeWork/MachZero. It is live at https://machzero.netlify.app and ships to iOS
through Capacitor 8 and TestFlight. The owner tests on an iPhone 18 Pro Max and an iPad Air 11" with an 8BitDo
SN30 Pro pad in X-input mode. Players are ages 7 to 70 (SPEC §2).

# The goal of this session

Turn the two rough milestone sketches that are left in the plan into full, agreed, buildable specs:
- M7: touch, tilt, iPhone/iPad layout and comfort settings. Today the game is really playable on iOS only with a
  pad. M7 makes it playable with fingers alone.
- M8: progression and modes. World Tour, the economy across 8 worlds, Time Trial and ghosts, the world map,
  results, onboarding, the championship season, a balance pass and turning the flags on. M8 is what makes
  MachZero "2.0 complete".

You will NOT build these. You run a design interview with the owner, then write the decisions into the spec
docs in the same depth and style as IMPLEMENTATION §X1–§X6 (design decisions, build steps with tests first,
budgets, "done when" checklists, device gates). Opus 5.5 sessions will build each milestone later from your
docs alone, so leave nothing for the builder to guess: name the files, the data shapes, the save fields, the
tests and the numbers.

You may run short, throwaway experiments to answer a design question with facts instead of guesses (for
example: measure ghost file size from a headless race, check how many credits the sims earn per race, or
try a tilt curve in the browser). Keep them on a scratch branch, never push them, and say what each one
showed.

# Read first (in this order)

1. docs/v2/NEXT_SESSION.md: current state, the PR stack and the environment facts. Trust its environment table.
2. docs/v2/SPEC.md: the agreed 2.0 spec and §10 (the 2.1 expansion). Pillars and non-goals still hold. §2
   (audience and accessibility), §4 (modes, economy, items, profiles) and §9 (success criteria) are the parts
   M7 and M8 deliver.
3. docs/v2/IMPLEMENTATION.md:
   - §0, the operating rules;
   - the current M7 and M8 sketches (you replace them);
   - the "As built" notes for M5 (tiers, assists, drafting), §GP and X1 (cups, the championship as data),
     X3 (part variants and the Aero slot, save v7), X4–X6 (the three new worlds and their hazards);
   - Appendices A (stats) and B (worlds).
4. The code that already exists for these milestones (read it; don't redesign what works):
   - src/save/schema.ts and migrations.ts: save v7. Settings already hold reducedMotion, colorBlind, largeText
     and touchSteer ('slider' | 'tilt'); a profile holds assists, credits, stats, trophies, its cup.
   - src/physics/Assists.ts: PlayerAssists (auto-accelerate, steering assist at 30% / 60%, rail push), built
     in M5 for the Rookie balance sim, with no settings screen yet.
   - src/content/economy.ts: race payouts × tier multiplier, the cup bonus, MEDAL_CREDITS for Time Trial,
     part prices and the garage rules. src/content/parts.ts: 5 slots × 4 tiers plus the sidegrade variants.
   - src/game/modes/GrandPrix.ts and Championship.ts (a season across cups: data and pure functions only).
   - src/content/worlds.ts and cups.ts (8 worlds; the Neon Cup and the Storm Cup).
   - src/core/features.ts: flags. On main today: profiles, garage, worlds. Off: tiers, music, touch, modes,
     expansion. Check why tiers is still off before you plan the flag clean-up.
   - src/ui/ (Preact + Signals screens, nav.ts for pad and keyboard focus), src/physics/InputManager.ts,
     src/native/haptics.ts, src/game/Rumble.ts.
   - src/sim/: headless race sims (worldRace.ts, tierMatrix.ts, cupSim.ts). They are the guardrail for every
     change and can measure the economy.

# Where things stand (checked 2026-11-15; confirm with gh pr list)

- X0–X3 are merged into main. X4 Tempest Spire, X5 Cinder Forge and X6 Abyss Line each have their gameplay
  half built as draft PRs, stacked: #37 → #38 → #39. Their looks wait for the owner's concept images. X7
  (effects on the five 2.0 worlds) is specced and not started.
- M6 audio is not designed. It is out of scope here, but M8's results screen, fanfares and tutorial will want
  sounds: leave named hooks for M6 rather than designing audio.
- The owner may lose access to Fable soon. Write the docs as soon as each area is agreed, and commit and push
  after each one, so nothing agreed is lost if the session ends early.

# The design interview

Use the mattpocock-skills:grilling skill. The owner likes it: numbered questions in rounds, each with your
recommended answer, worded so that "yes" accepts it. Look up facts yourself; ask the owner only for
decisions. Ask every question whose prerequisites are settled in the same round. Keep going until every
branch below is decided, then show a one-screen summary per milestone and get a yes before writing it.

The recommendations below are starting points. Improve them from what you read and measure.

## M7: touch, tilt and comfort

A. Scope and platforms
   - Touch on the iOS app and on mobile web; the pad and keyboard keep working, and a player can switch device
     mid-race (the HUD's button prompts follow the last device used).
   - iPhone landscape only, iPad landscape only? Recommend landscape only, with a rotate overlay in portrait.
B. Driving by touch
   - The default scheme for a new touch player. Recommend: auto-accelerate on, a horizontal drag slider on the
     left half (origin set where the thumb lands), boost and brake buttons on the right, air-brakes as the
     slider's far ends or as two buttons (decide by trying both in a quick browser experiment).
   - Tilt: from DeviceOrientationEvent with the iOS permission prompt (Capacitor may need a plugin: check with
     Context7), a calibrated neutral angle, a deadzone and a sensitivity setting.
   - **Steering on curled road.** On the pipe (Cryo Station), the Spine (Abyss Line), the loop and the corkscrew
     the chase camera rolls with the ship, so "left on screen" stays "left for the ship". Confirm this holds for
     the slider and for tilt (tilt is measured against gravity, not against the rolled screen: decide what tilt
     means upside down). This is the hardest M7 question; settle it with a test plan.
   - Items (EMP, Shield, Mine and the item select), pause, and the pit by touch.
C. Layout
   - Safe areas (notch, Dynamic Island, home bar), button size (S/M/L), a left-handed swap, and where the HUD
     moves so thumbs don't cover the speed, energy or position. iPhone and iPad layouts differ: say how.
D. Menus by touch
   - Every screen (menus, garage, livery editor, world select, Grand Prix, cup standings, settings) works by
     touch with targets at least 44 pt. Name any screen that needs a touch-specific change.
E. Assists and comfort (most settings exist in the save; M7 gives them screens and complete behaviour)
   - The assists screen: auto-accelerate, steering assist (off / light / strong), No-KO (energy floor and half
     damage), early boost. Which are on by default for a Rookie profile and for a touch player?
   - Reduced motion (what exactly it turns off: camera shake, FOV punch, speed lines, flashes), colour-blind
     palette plus shape cues for the HUD and hazards (the new hazards' telegraphs too), large text and a HUD
     scale, and key remapping for keyboard and pad.
F. Feel and feedback: haptics on touch (Capacitor Haptics already drives hits and boosts), and a touch-specific
   tutorial prompt.
G. Tests and gates
   - The assists run in the fixed step, so sims can drive them: a touch-scheme sim (a scripted slider input)
     that completes 3 laps on every track, including the pipe and the Spine.
   - Playwright with touch emulation for menus and a race.
   - The device gate: a full race by fingers alone on the iPhone and the iPad, and the Storm Cup by touch.
H. Split M7 into PRs that each ship alone (for example: M7a touch driving and HUD layout, M7b menus by touch,
   M7c assists and comfort screens), with the `touch` flag turning on in the last one.

## M8: progression, modes and 2.0 complete

A. World Tour with 8 worlds
   - What a player must do to unlock the next world, and how worlds 6–8 fit (SPEC §10.2 left this to M8).
     Recommend: worlds in order, a world unlocks by finishing the previous world's race in the top 3 at any
     tier, and worlds 6–8 continue the same chain after world 5. Put the alternatives to the owner (for example:
     worlds 6–8 open together once world 5 is cleared).
   - Trophies per world per tier; what "cleared" means; whether Rookie players can see every world without
     grinding (SPEC rule: Rookie never grinds).
   - Existing saves: a v7 profile that has already raced a world keeps it unlocked. Nothing is lost.
B. The economy, measured
   - Use the race sims to measure credits earned per race and per cup at each tier, against the price of a
     full kit (5 slots, 4 tiers, two variants from Mk II up, the Aero slot). Write a sim if needed.
   - Decide the targets: how many races to a full Mk III kit at Pilot, and to Prototype at Ace. Keep SPEC §4.4:
     stock wins Rookie; upgrades matter at Ace and Legend.
   - Rewards for world unlocks, trophies, cups and the championship season. Anything with real money: never.
C. Time Trial and ghosts
   - A ghost is a pose recording (position and rotation at 20 Hz, as the sketch says), not an input replay, so
     it does not depend on the physics being bit-identical on the iPhone and the desktop. Confirm, and measure
     the size of a 3-lap ghost.
   - Storage (IndexedDB through a GhostStore), the player's best ghost per track, and dev ghosts: a headless
     Legend autopilot run per track, baked into public/game/ghosts/<trackId>.json by `npm run ghosts:bake`,
     for all 8 tracks.
   - Medal times from the dev time (gold ≤ ×1.02, silver ≤ ×1.08, bronze ≤ ×1.18?) and MEDAL_CREDITS.
   - Ghost rendering: translucent, unlit, no extra draw calls per frame beyond one per ghost.
D. The championship season (Championship.ts exists as data)
   - Its screen, its rewards, and when it unlocks. Or decide it waits for 2.2.
E. Screens
   - The world map (8 worlds on a retro starmap: lock state, trophies, best times), the results screen (credit
     tally, unlock fanfare, pilot quotes), and the main menu once World Tour exists.
F. Onboarding
   - "New to racing?" → the Rookie preset and the touch or pad default from M7.
   - A skippable 30-second tutorial on the first Neon Bay race: steer, boost, pit, air-brake, items.
G. The save migration v7 → v8: every new field, its default, and the SaveStore test.
H. The balance pass: the SPEC §9 targets on 8 tracks × 4 tiers. Name the sims and the numbers that must hold.
I. 2.0 complete
   - Which flags turn on and in which PR, and the dead flag code to remove.
   - The `expansion` flag and the three new worlds: they turn on when their looks are approved (X4–X6). Say
     how M8 handles a world whose look is still on the placeholder theme.
   - The release order: the stacked PRs #37–#39, X7, M7 and M8, and the device gates that must pass first.
J. Split M8 into PRs that each ship alone (for example: M8a save v8, World Tour and economy; M8b Time Trial and
   ghosts; M8c world map, results and onboarding; M8d balance, flags on, release), stacked in build order.

## Out of scope, confirmed with the owner

M6 audio (leave named hooks), online features (a SPEC non-goal), anything with real money (never), new worlds
or track features, and the world looks (they wait for the owner's concept images).

# Writing the specs

For each milestone, once the owner says yes to its summary:
- docs/v2/SPEC.md: update §2 and §4 where the decisions change them, or add a section for each milestone with
  the what and the why.
- docs/v2/IMPLEMENTATION.md: replace the M7 and M8 sketches with full milestones in the style of §X1–§X6:
  - design decisions (settled; "don't re-open");
  - build steps, tests first, naming files, data shapes, save fields and functions;
  - budgets (app JS ≤ 600 KB gzip, 60 fps at the device gate, p95 no more than 1 ms above the build before);
  - a "done when" checklist and the device gate for each PR;
  - what needs the owner (approvals, device readings) and what does not.
- docs/v2/NEXT_SESSION.md: the build order for M7 and M8 next to X7 and the world looks, and a ready-to-paste
  prompt for the Opus 5.5 session that builds the first M7 PR.

Commit after each milestone's docs and push. Open one docs-only PR stacked on v2/x6-abyss-line (or the newest
open stack branch), titled "M7 + M8 design docs", with the decisions summarised in its body. Bind it with the
ccd_pr tools. Do not merge it.

# Rules

- Never merge a PR, push to main, enable auto-merge, or upload to App Store Connect.
- Never commit ios/App/App.xcodeproj/project.pbxproj (it holds the owner's local build number). Leave
  docs/v2/FABLE_PROMPT.md and this file alone (they are the owner's prompts).
- No session IDs or attribution lines in commits or PR bodies.
- Check current library APIs with Context7 before you rely on them (Capacitor plugins, DeviceOrientationEvent
  on iOS, IndexedDB wrappers, Preact + Signals, Playwright touch emulation).
- Use jCodemunch for code navigation.
- On this shared Mac run `npm test -- --maxWorkers=3` and `npm run smoke -- --workers=1` for any experiment.
- Never loosen an assertion to make a test pass.

# Finishing work

Please avoid stopping while you still owe work the owner asked for. The real waits in this session are the
owner's design answers. While you wait on one area, write up an area that is already agreed. Diagnose
ordinary obstacles (errors, timeouts, empty results) and work through them rather than stopping. If something
is deliberately off-limits, leave it alone and say so.

# Communicating clearly

Write for an intelligent but low-context reader who has not seen your tool calls. Put the key points first.
Use plain words and short sentences, one idea per sentence, active voice, and the same word for the same
thing (in the style of ASD-STE100 Simplified Technical English). Do not use terms you made up during the work.
Use prose where ideas connect and bullets for lists of separate items.

At the end of the session, report:
- the docs PR, with its link and what it covers;
- every decision the owner made, in one short list per milestone;
- anything left undecided, and why;
- the first build session to run, with the prompt from NEXT_SESSION.md.

Start now: run gh pr list, read the files above, then begin the first grilling round on M7.
```
