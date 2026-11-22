# MachZero

[![CI](https://github.com/NCSTATEPACK16/MachZero/actions/workflows/ci.yml/badge.svg)](https://github.com/NCSTATEPACK16/MachZero/actions/workflows/ci.yml)

**Play it:** https://machzero.netlify.app (also on TestFlight as an iOS app)

MachZero is a single-player anti-gravity racer in the spirit of F-Zero X/GX, built with **Three.js**, **Rapier** and **Vite**. It runs in a desktop browser, on an iPad or iPhone by touch, and with a game controller. Version 2.0 turns the v1 tech demo into a full game:

- **Five worlds** (Neon Bay, Sunset Mesa, Cryo Station, Jade Ruins, Orbital Ring), each with an authored track, a gimmick (corkscrew, jumps, full-pipe, split path, loop in low gravity) and its own hazards. Three more worlds (Tempest Spire, Cinder Forge, Abyss Line) are built and wait behind the `expansion` flag for their looks.
- **Eight ships** from five chassis, with parts in five slots (engine, booster, stabilizer, hull, aero) bought with race credits, and a livery editor.
- **Seven CPU rivals** with names, portraits and driving styles, at four difficulties (Rookie, Pilot, Ace, Legend), with drafting and items (Shield, Drop Mine, EMP).
- **Assists** for new players (auto-accelerate, steering help, no knock-outs, early boost) and comfort settings (HUD size up to EXTRA LARGE, reduced motion, a colour-blind mode).
- Hover physics against the track normals, magnetic track gravity, and F-Zero energy: hits drain it, boost spends it, the pit strip refills it, and at zero you explode.
- Procedural Web Audio, selective bloom, motion blur and speed lines, scaled across Low, Medium and High presets.

## Modes

- **World Tour** is the main path. Each world opens when you finish in the top 3 on the one before it, and a first clear pays a bonus. The world map shows your trophies per difficulty. A new player's first race runs a short tutorial over the real race (steer, boost, air-brake, pit, item), with SKIP and Settings → Race → REPLAY TUTORIAL.
- **Grand Prix:** five-race cups with points, a reverse grid after race 1, no restarts, a trophy per difficulty and a cup bonus. A cup opens when its last world is cleared on the World Tour. With two cups visible, the **Championship** runs every cup in a season, with a season table between cups and a Champion crown per difficulty.
- **Time Trial:** solo against the clock, your best ghost and the developers' ghost, for bronze, silver and gold medals.

Saves stay on the device (several pilot profiles, export and import in Settings → Saves). There is no account, no online play and no real money.

## Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Steer | A D / ← → | Left stick | Slide your left thumb (or TILT, Settings → Controls) |
| Accelerate | W / ↑ | RT / Ⓐ | Automatic (or the ACCELERATE button with auto-accelerate off) |
| Brake | S / ↓ | LT / Ⓑ | BRAKE |
| Air-brake left / right | Q / E | LB / RB | Push the slider to the edge (or the ◂AIR / AIR▸ buttons) |
| Boost (costs energy) | Space / Shift | Ⓧ | BOOST |
| Use item | F | Ⓨ | ITEM |
| Next item | C | D-pad ◀ ▶ | The chip beside ITEM |
| Pause | Esc / P | START | II at the top |
| Restart race (outside a cup) | R | — | Pause → RESTART |
| Mute | M | — | Settings → Sound |

Menus work with the arrow keys and Enter / Esc, the d-pad with Ⓐ / Ⓑ, or by tapping. Keyboard keys and pad buttons can be rebound in Settings → Controls.

## Requirements

- Node.js 20+ (developed on Node 26)
- A WebGL2-capable browser

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check and production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests plus the headless race simulations (real tracks, Rapier and AI) |
| `npm run typecheck` | TypeScript strict check |
| `npm run size` | Bundle size budgets (after `npm run build`) |
| `npm run smoke` | Playwright browser tests against the production build |
| `npm run codebase` | Regenerate `CODEBASE.md` (every source file in one document) |
| `npm run ios:sync` / `npm run ios:open` | Build and open the iOS app (Capacitor; see [`docs/IOS_TESTFLIGHT.md`](docs/IOS_TESTFLIGHT.md)) |
| `npm run ghosts:bake` | Re-record the developers' Time Trial ghosts after a track or physics change |

## URL flags

- `?autopilot=1`: the AI drives your ship, straight into a race (demos, soak tests, the smoke test)
- `?debug=1`: FPS, draw-call and physics overlay
- `?seed=N`: race the v1 procedural circuit generated from seed N
- `?quality=low|med|high`: pin a graphics preset
- `?features=all` (or `?features=expansion`): turn on the surfaces still in progress: `expansion` (the three new worlds, the Storm Cup, part variants and the Aero tab) and `music`. An iOS build takes the same list as `VITE_FEATURES=expansion npm run ios:sync`.

## Architecture

See [`docs/TDD.md`](docs/TDD.md) (§8 covers the 2.0 architecture). MachZero 2.0 is specified in [`docs/v2/SPEC.md`](docs/v2/SPEC.md), with the milestone-by-milestone build guide in [`docs/v2/IMPLEMENTATION.md`](docs/v2/IMPLEMENTATION.md).

```
src/core/      contracts, config, event bus, fixed-step loop, feature flags
src/content/   data: ships, parts, pilots, tiers, worlds, tracks, cups, economy
src/track/     authored and procedural tracks, sweep, colliders, queries, gimmicks and hazards
src/physics/   Rapier world, hover ship controller, input (keyboard, pad, touch, tilt), assists
src/graphics/  renderer, world themes, ships, camera, post-FX, particles, ghosts
src/game/      AI drivers, race manager, items, HUD, touch controls, tutorial, modes (World Tour, Grand Prix,
               Championship, Time Trial), ghost recorder
src/save/      save schema v9, migrations from v1, the store
src/app/       the App shell (routes, race sessions, booking results on the save)
src/ui/        Preact menu screens
src/native/    the iOS app's haptics and platform hooks
src/sim/       headless race simulations (balance, economy, tiers, gimmicks, hazards)
```

Physics runs at a fixed 120 Hz, and rendering interpolates between physics steps. Rapier collision groups keep the ships off the road surface's solver: the surface is only ever hit by hover raycasts, while the ships collide physically with the rails and with each other.

## Contributing / CI

Every pull request runs typecheck, unit tests, the headless race simulations, a production build, size budgets and the Playwright browser tests. Netlify posts a deploy preview on each PR, and merging to `main` deploys https://machzero.netlify.app.
