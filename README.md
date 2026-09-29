# MachZero

[![CI](https://github.com/NCSTATEPACK16/MachZero/actions/workflows/ci.yml/badge.svg)](https://github.com/NCSTATEPACK16/MachZero/actions/workflows/ci.yml)

**Play it:** https://machzero.netlify.app

A single-player anti-gravity racer in the spirit of F-Zero X/GX, built with **Three.js**, **Rapier** and **Vite**.
Every mesh, texture, shader and sound is generated at runtime, so there are no asset files to download.

- A procedurally generated neon circuit (seeded Catmull-Rom spline), with banked sweepers and a full 360° corkscrew
- Hover physics: downward raycasts against the track normals, magnetic track gravity, momentum without wheels
- Energy works like F-Zero: collisions drain it, boost spends it (from lap 2), the pit strip recharges it, and at zero you explode
- Three AI rivals, each with its own driving style (aggressive, steady, erratic), steering by looking ahead along the spline
- Post-processing: selective bloom, speed-scaled radial motion blur, chromatic aberration, speed-line particles
- Procedural Web Audio engine and effect sounds, a responsive HUD with a minimap, and pause and results screens

## Requirements

- Node.js 20+ (developed on Node 26)
- A WebGL2-capable desktop browser

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
| `npm test` | Unit tests plus a headless full-race simulation (real track, Rapier and AI) |
| `npm run typecheck` | TypeScript strict check |
| `npm run size` | Bundle size budgets (after `npm run build`) |
| `npm run smoke` | Playwright browser smoke test against the production build (`npx playwright install chromium` once) |
| `npm run codebase` | Regenerate `CODEBASE.md` (every source file in one document) |

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Accelerate | W / ↑ | RT / A |
| Brake | S / ↓ | LT / B |
| Steer | A D / ← → | Left stick |
| Air-brake left / right (slide) | Q / E | LB / RB |
| Boost (lap 2+, costs energy) | Space / Shift | X / Y |
| Pause | Esc / P | Start |
| Confirm | Enter | A |
| Restart race | R | — |
| Mute | M | — |

## URL flags

- `?autopilot=1`: the AI drives your ship (handy for demos and soak tests)
- `?debug=1`: FPS, draw-call and physics overlay
- `?seed=N`: generate a different circuit
- `?features=all` (or `?features=garage,worlds`): enable in-progress 2.0 features (off on the live site until each milestone ships)

## Architecture

See [`docs/TDD.md`](docs/TDD.md). MachZero 2.0 is specified in [`docs/v2/SPEC.md`](docs/v2/SPEC.md), with the milestone-by-milestone build guide in [`docs/v2/IMPLEMENTATION.md`](docs/v2/IMPLEMENTATION.md). The v1 layout, in short:

```
src/core/      contracts, config, event bus, fixed-step loop   (shared, frozen interfaces)
src/track/     spline generation, custom sweep, colliders, queries
src/physics/   Rapier world, hover ship controller, input
src/graphics/  renderer, environment, ships, camera, post-FX, particles
src/game/      AI drivers, race state machine, HUD, audio
src/main.ts    wiring + game loop
```

Physics runs at a fixed 120 Hz, and rendering interpolates between physics steps.
The track generator passes world-space triangle meshes (`TrackCollisionData`) to Rapier.
Rapier collision groups keep the ships off the road surface's solver: the surface is only ever hit by hover raycasts, while the ships collide physically with the rails and with each other.

## Contributing / CI

Every pull request runs typecheck, unit tests, headless race simulations, a production build, size budgets and a Playwright smoke test. Netlify posts a deploy preview on each PR, and merging to `main` deploys https://machzero.netlify.app.
