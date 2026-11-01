# Next-session brief — build MachZero 2.0 (next: M4c Orbital Ring → §P Powerups → §GP Grand Prix)

Paste the prompt at the bottom into a fresh Claude Code session (Opus 5.5) opened on
`/Users/johnbradner/Documents/ClaudeWork/MachZero`. Everything above it is the context that prompt relies on.

## Where things stand (2026-11-01: M0–M4b, perf, controller and the iOS app merged; next is M4c → §P → §GP)

- **The live site** is https://machzero.netlify.app. Every merge to `main` deploys there, and every PR gets a preview at `https://deploy-preview-<N>--machzero.netlify.app`.
- **The iOS app** (Capacitor 8, `ios/App`, bundle `com.ncstatepack16.machzero`) is on TestFlight.
  - The user tested on an iPhone 18 Pro Max (also an iPad Air 11") with an 8BitDo pad in X-input mode, and was happy with it ("looks great", steady 60 fps).
  - **Every PR must work on both the web and iOS, and end with the iOS build command** (IMPLEMENTATION §0 rule 9). Guide: `docs/IOS_TESTFLIGHT.md`.
- **Merged into `main`:**
  - M0–M3: #2–#9.
  - **M4a Cryo Station (#13), M4b Jade Ruins (#14).**
  - **#15:** 60 fps work. Shader warm-up, dynamic resolution, the `?perf=1` / Settings perf panel.
  - **#16:** controller polish. Pad prompts, pause on disconnect, pad-driven pause and results panels, random callsigns.
  - **#17:** the iOS shell. Controller-first native setup, haptics, icon, splash.
  - **#18:**
    - the Mach 0 app icon;
    - visible pad focus ring and spatial d-pad/stick menu navigation with hold-to-repeat;
    - Rookie CPUs at 90% pace with no catch-up, and a CPU difficulty picker;
    - wall and ship damage halved;
    - **the EMP item**.
- **Open:** **#19**, the website Mach 0 favicon, touch icon and manifest, plus these spec updates.
- **Flags on `main`:** `profiles`, `garage` and `worlds` are on; `tiers`, `music`, `touch` and `modes` are off. Note: since #18 the tier comes from the profile whatever the `tiers` flag says.
- **Tests:** 312 unit and integration tests, including every race sim (about 21 s locally), and 8 Playwright tests (smoke, menus ×3, garage ×2, controller ×2). Keep every test under 60 s.

## Next (specs settled 2026-11-01; build in this order, one PR each)

1. **M4c, Orbital Ring:** IMPLEMENTATION §M4, "M4c, Orbital Ring: design decisions", plus the 2026-10-04 decisions above it.
   - Branch `v2/m4c-orbital-ring` from `main`.
   - Test-first: a loop hold sim like `sim/pipe.hold.sim.test.ts`, the Orbital world sims, and a mine/debris determinism check in `sim/hazards.sim.test.ts`.
   - Model mines and debris on the stone gates (`track/features/gate.ts`: timeline and pose shared by physics, visuals via `animateHazards`, and the AI via `hazardClock`).
   - Write the mine so the Drop Mine item can reuse it.
2. **§P, Powerups:** Shield, Drop Mine, item select, CPU items. IMPLEMENTATION §P.
3. **§GP, Grand Prix cups:** IMPLEMENTATION §GP. It starts `game/modes/`.

**Left for future sessions (don't start without the user):** the rest of M5 (per-tier AI tuning, drafting, pilot intro cards, Legend in the picker), M6 audio (#10), M7 touch and comfort (#11), and the rest of M8 (World Tour, Time Trial, ghosts, polish; #12). Also more scenery for the existing worlds. M6, M7 and M8 need a design session first.

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
in /Users/johnbradner/Documents/ClaudeWork/MachZero. It is live at https://machzero.netlify.app and on TestFlight as an iOS app.

READ FIRST, in this order, before writing any code:
  1. docs/v2/NEXT_SESSION.md: current state and verified environment facts. Trust them; don't rediscover.
  2. docs/v2/SPEC.md: the agreed product spec. Every decision in it is settled; do not re-open it.
  3. docs/v2/IMPLEMENTATION.md: operating rules (§0), v1 code map (§1), target architecture (§2),
     contract changes (§3) and milestones M1 → M8 with "done when" criteria and appendices.
  4. docs/TDD.md: v1 architecture, especially §7 (corkscrew physics invariants you must preserve).

GOAL: build M4c Orbital Ring, then §P Powerups, then §GP Grand Prix cups (IMPLEMENTATION.md), in order, as far as this
session allows, each its own PR and shippable on its own. Everything up to #18 is merged. The rest of M5, and M6–M8,
are for future sessions and need the user first.

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

Start by confirming the open PRs' state (gh pr list) and that main is green. Branch M4c from main (rebase
onto #19 is not needed; it only touches the website icons and docs). Then build M4c, then §P, then §GP.
```
