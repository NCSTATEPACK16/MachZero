import { CONFIG, SHIP_ROSTER, readUrlFlags } from './core/config';
import type { ControlInput, FrameContext, ShipId, ShipState } from './core/contracts';
import { neutralControls } from './core/controls';
import { EventBus, type GameEvents } from './core/events';
import { GameLoop } from './core/loop';
import { generateTrack } from './track';
import { InputManager, PhysicsSystem } from './physics';
import { GraphicsSystem } from './graphics';
import { AIDriver, AudioSystem, HUD, RaceManager } from './game';

async function boot(): Promise<void> {
  const flags = readUrlFlags();
  const appEl = document.getElementById('app')!;
  const hudEl = document.getElementById('hud')!;
  const bootEl = document.getElementById('boot')!;

  const bus = new EventBus<GameEvents>();
  const track = generateTrack({ seed: flags.seed ?? CONFIG.TRACK_SEED });

  const physics = await PhysicsSystem.create(track, bus);
  const input = new InputManager(window);
  const graphics = new GraphicsSystem(appEl, bus);
  graphics.setTrack(track);

  const ships: ShipState[] = SHIP_ROSTER.map((def) => physics.addShip(def, track.startGrid[def.gridIndex]));
  for (const ship of ships) graphics.addShip(ship);
  const player = ships.find((s) => s.def.isPlayer)!;

  // Every ship gets a driver. The player's one steers only in ?autopilot mode or after crossing the finish line.
  const drivers = new Map<ShipId, AIDriver>();
  for (const ship of ships) {
    const personality = ship.def.personality ?? 'steady';
    drivers.set(ship.def.id, new AIDriver(ship, track, personality, track.seed * 31 + ship.def.id * 7919, ships));
  }
  const playerDriven = () => !flags.autopilot && player.status !== 'finished';

  const race = new RaceManager(track, ships, bus);
  const audio = new AudioSystem(bus);

  const resetShips = () => {
    for (const ship of ships) physics.resetShip(ship.def.id, track.startGrid[ship.def.gridIndex]);
  };
  const startRace = () => {
    if (race.state === 'results') {
      resetShips();
      race.reset();
    }
    if (race.state === 'title') race.start();
  };
  const restartRace = () => {
    resetShips();
    race.reset();
    race.start();
  };
  const togglePause = () => {
    if (race.state === 'racing' || race.state === 'countdown') race.pause(true);
    else if (race.state === 'paused') race.pause(false);
  };

  const hud = new HUD(hudEl, bus, track, {
    onStart: startRace,
    onRestart: restartRace,
    onResume: () => race.pause(false),
    onToggleMute: () => audio.setMuted(!audio.muted),
  });

  const controls = new Map<ShipId, ControlInput>();
  for (const ship of ships) controls.set(ship.def.id, neutralControls());

  const loop = new GameLoop({
    fixed(dt) {
      input.update();
      if (input.consume('mute')) audio.setMuted(!audio.muted);
      if (input.consume('pause')) togglePause();
      if (input.consume('restart') && race.state !== 'title') restartRace();
      if (input.consume('confirm')) {
        if (race.state === 'title' || race.state === 'results') startRace();
        else if (race.state === 'paused') race.pause(false);
      }
      if (race.state === 'paused') return;

      for (const ship of ships) {
        const human = ship === player && playerDriven();
        controls.set(ship.def.id, human ? input.sample() : drivers.get(ship.def.id)!.update(dt));
      }
      physics.step(dt, controls);
      race.fixedUpdate(dt);
    },
    frame(dt, alpha, time) {
      const ctx: FrameContext = { dt, alpha, time, ships, player, track, race: race.snapshot() };
      graphics.update(ctx);
      hud.update(ctx.race, dt);
      audio.update(ctx);
      graphics.render();
    },
  });

  const onResize = () => graphics.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', onResize);
  onResize();

  if (flags.debug || flags.autopilot) {
    (window as unknown as Record<string, unknown>).__machzero = { track, physics, race, ships, bus, startRace, restartRace };
  }

  loop.start();
  bootEl.style.opacity = '0';
  setTimeout(() => bootEl.remove(), 450);
  if (flags.autopilot) setTimeout(startRace, 600);
}

boot().catch((err: unknown) => {
  console.error(err);
  const bootEl = document.getElementById('boot');
  if (bootEl) {
    bootEl.classList.add('error');
    bootEl.textContent = `MACHZERO FAILED TO START\n\n${err instanceof Error ? err.stack ?? err.message : String(err)}`;
  }
});
