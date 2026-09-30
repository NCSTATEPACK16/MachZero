# Next-session brief — build MachZero 2.0 (milestones M2 → M8; M0–M1 done)

Paste the prompt at the bottom into a fresh Claude Code session (Opus 5.5) opened on
`/Users/johnbradner/Documents/ClaudeWork/MachZero`. Everything above it is the context that prompt relies on.

## Where things stand (2026-09-29, end of the M1 session)

- **v1 is live** at https://machzero.netlify.app. Netlify site `machzero` is connected to `NCSTATEPACK16/MachZero`: each merge to `main` deploys, and each PR gets a deploy preview at `https://deploy-preview-<N>--machzero.netlify.app`.
- **The 2.0 design is agreed and merged:**
  - `docs/v2/SPEC.md` (what and why)
  - `docs/v2/IMPLEMENTATION.md` (how, milestone by milestone, pinned to v1's files)
  
  Every design decision in them was settled in a design interview with the user. **Do not re-open them.** Ask the user only when something genuinely isn't covered.
- **M0 is done:** PR #2 (`v2/m0-wrapup`). It adds CI (GitHub Actions: `verify` + `smoke`), `netlify.toml`, size budgets, the Playwright smoke test, feature flags (`src/core/features.ts`), `CODEBASE.md` and the README.
- **M1 is done** as three stacked PRs (IMPLEMENTATION §M1 has the as-built notes; read them first):
  - #3 `v2/m1-stats-ships`: per-ship stats, 6 chassis, parts, 8-ship field.
  - #4 `v2/m1-app-shell`: App + RaceSession, saves, settings, Preact menus.
  - #M1C_PR `v2/m1-quality`: quality presets and auto-detect. This PR also flips `profiles` on.
  
  Stack order: #2 ← #3 ← #4 ← #M1C_PR. If any are still open when you start, stack M2 on `v2/m1-quality` and say so in the PR body. Rebase after merges.
- **Tests:**
  - 170 unit/integration tests. They include the full 3-lap headless race sims (v1 4-ship, 8-ship at rookie/pilot/legend fits), a corkscrew hold test, save migrations and a RaceSession lifecycle test (10 races, no leaks).
  - 4 Playwright tests: smoke; menus by keyboard, gamepad and touch; 10 race rebuilds with no GPU-memory growth.
  - Read `docs/TDD.md` §7 before touching `physics/ShipController.ts`: it records four hard-won physics invariants.
- **Next:** M2 (Blender ships, parts, garage, livery editor), behind the `garage` flag.

## Environment facts (already verified; don't rediscover)

| Thing | Fact |
|---|---|
| Node / npm | Local Node 26.4, npm 11.17; CI and Netlify use Node 24 (`.nvmrc`) |
| Dev server | Port **5173 is taken** by another project. Use `npm run dev -- --port 5180`; `.claude/launch.json` (git-ignored, local) is already set up for the browser preview on 5180 |
| GitHub | `gh` is logged in as `NCSTATEPACK16`; the remote is `origin` |
| Netlify CLI | Logged in (team NCSTATEPACK16). The folder is not `netlify link`ed and doesn't need to be; previews come from the GitHub integration |
| Blender (headless) | `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P <script.py> -- <args>` works (5.2.0 LTS; a GLB export was verified) |
| Blender MCP | Add-on v1.7 / protocol 11, on port 9876. The user must have Blender open with **Start MCP Server** clicked (N panel → MCP tab). The first call after a Blender restart can fail with "broken pipe"; retry once. Treat it as an optional preview tool: canonical assets come from the headless scripts in `blender/` |
| Playwright | `@playwright/test` installed; Chromium downloaded locally. `npm run smoke` runs every spec in `e2e/` against `vite preview` on port 4173 (about 3 min; SwiftShader). The browser pane's `requestAnimationFrame` stops while the pane is hidden, so drive timing-sensitive UI checks through Playwright |
| Bundle | After M1: app JS 220 KB gz (game plus Preact UI 75 KB, three.js 145 KB) + Rapier 1,615 KB gz (base64 WASM). See IMPLEMENTATION §M0 for the optional separate-WASM task |

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

GOAL: implement milestones M2 → M8 in order (M0 and M1 are done), as far as this session allows, each shippable on its own.

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

Start by confirming the open PRs' state (gh pr list), then begin M2.
```
