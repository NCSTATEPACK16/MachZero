/**
 * Shared headless 8-ship race on an authored world track (used by the per-world sim files, so they run in
 * parallel workers). Returns what the assertions need; no expectations here.
 */
import { CONFIG } from '../core/config';
import type { AITier, ControlInput, ShipId, ShipState, TrackData } from '../core/contracts';
import { EventBus, type GameEvents } from '../core/events';
import { buildRaceField, defaultLoadout } from '../content/pilots';
import { TRACK_DEFS } from '../content/tracks';
import { AIDriver, RaceManager } from '../game';
import { PhysicsSystem } from '../physics';
import { trackFromSource } from '../track';

const MAX_SIM_SECONDS = 360;

export interface WorldRaceResult {
  track: TrackData;
  ships: ShipState[];
  finished: boolean;
  simTime: number;
  respawns: Map<ShipId, number>;
  jumps: Map<ShipId, number>;
  destroyed: ShipId[];
  playerLaps: number;
  maxLateral: number;
  stepMs: number;
  table: string;
}

const tracks = new Map<string, TrackData>();

export async function runWorldRace(trackId: string, tier: AITier): Promise<WorldRaceResult> {
  let track = tracks.get(trackId);
  if (!track) {
    track = trackFromSource({ kind: 'authored', def: TRACK_DEFS[trackId] });
    tracks.set(trackId, track);
  }
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus);
  const field = buildRaceField({ playerName: 'AUTO', playerLoadout: defaultLoadout(), tier });
  const ships = field.map((d) => physics.addShip(d, track.startGrid[d.gridIndex]));
  const drivers = ships.map((s) => new AIDriver(s, track, s.def.personality ?? 'steady', track.seed * 31 + s.def.id * 7919, ships));
  const race = new RaceManager(track, ships, bus);

  const respawns = new Map<ShipId, number>();
  const jumps = new Map<ShipId, number>();
  const destroyed: ShipId[] = [];
  let playerLaps = 0;
  bus.on('ship:respawn', ({ shipId }) => respawns.set(shipId, (respawns.get(shipId) ?? 0) + 1));
  bus.on('ship:jump', ({ shipId }) => jumps.set(shipId, (jumps.get(shipId) ?? 0) + 1));
  bus.on('ship:destroyed', ({ shipId }) => destroyed.push(shipId));
  bus.on('race:lap', ({ shipId }) => {
    if (shipId === 0) playerLaps++;
  });

  const controls = new Map<ShipId, ControlInput>();
  const dt = CONFIG.FIXED_DT;
  let t = 0;
  let maxLateral = 0;
  let stepMs = 0;
  let steps = 0;
  race.start();
  // Run until every ship is done (not just the player) so rivals' jumps and laps are all exercised.
  while (t < MAX_SIM_SECONDS && ships.some((s) => s.status === 'racing' || s.status === 'grid')) {
    for (const d of drivers) controls.set(d.shipId, d.update(dt));
    const t0 = performance.now();
    physics.step(dt, controls);
    stepMs += performance.now() - t0;
    steps++;
    race.fixedUpdate(dt);
    t += dt;
    for (const s of ships) if (s.status === 'racing' && !s.airborne) maxLateral = Math.max(maxLateral, Math.abs(s.lateral));
  }
  const snap = race.snapshot();
  const table = snap.standings
    .map((r) => {
      const ship = ships.find((s) => s.def.id === r.id)!;
      return `${r.position}. ${r.name.padEnd(14)} ${(ship.def.personality ?? '-').padEnd(10)} ${r.status} laps=${r.lap} t=${r.totalTime?.toFixed(2)} jumps=${jumps.get(r.id) ?? 0} respawns=${respawns.get(r.id) ?? 0}`;
    })
    .join('\n');
  physics.dispose();
  return {
    track,
    ships,
    finished: ships.every((s) => s.status === 'finished'),
    simTime: t,
    respawns,
    jumps,
    destroyed,
    playerLaps,
    maxLateral,
    stepMs: stepMs / Math.max(1, steps),
    table,
  };
}
