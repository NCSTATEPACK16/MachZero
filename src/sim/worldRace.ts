/**
 * Shared headless 8-ship race on an authored world track (used by the per-world sim files, so they run in
 * parallel workers). Returns what the assertions need; no expectations here.
 */
import { CONFIG } from '../core/config';
import { ROOKIE_ASSISTS } from '../save/schema';
import { PlayerAssists } from '../physics/Assists';
import { TIERS } from '../content/tiers';
import type { AITier, ControlInput, RacerStanding, ShipId, ShipState, TrackData } from '../core/contracts';
import { EventBus, type GameEvents } from '../core/events';
import { HAZARDS_NORMAL, type HazardPolicy } from '../core/hazards';
import { buildRaceField, defaultLoadout } from '../content/pilots';
import { TRACK_DEFS } from '../content/tracks';
import { AIDriver, RaceManager } from '../game';
import { ItemSystem } from '../game/ItemSystem';
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
  /** Times each ship drove onto an ice patch. */
  ice: Map<ShipId, number>;
  destroyed: ShipId[];
  /** Stone-gate hits per ship. */
  gateHits: Map<ShipId, number>;
  /** Track mines set off, and debris hits, per ship. */
  mineHits: Map<ShipId, number>;
  /** Dropped mines (the Drop Mine item) set off, per ship. */
  droppedMineHits: Map<ShipId, number>;
  /** CPU items used, by kind: EMPs fired (warned), shields raised, mines dropped; and hits blocked by shields. */
  itemUses: { emp: number; shield: number; mine: number; blocked: number; empHits: number };
  debrisHits: Map<ShipId, number>;
  /** Lightning strikes taken, per ship (Tempest Spire). */
  lightningHits: Map<ShipId, number>;
  /** Times each ship drove onto a split path. */
  shortcuts: Map<ShipId, number>;
  /** Finishing order with total times (null = did not finish). */
  standings: { id: ShipId; totalTime: number | null }[];
  /** The race's final standings as `race:results` carried them. */
  results: RacerStanding[];
  playerLaps: number;
  maxLateral: number;
  stepMs: number;
  table: string;
}

const tracks = new Map<string, TrackData>();

export interface WorldRaceOptions {
  hazards?: Readonly<HazardPolicy>;
  /** CPU items in play (default true: none on Rookie, by SPEC §4.4a); the player (AI-driven) carries none. */
  items?: boolean;
  gridOrder?: readonly ShipId[];
  /** Per rival, its own tier and fits (a mixed field). */
  rivalTiers?: readonly AITier[];
  /** The player stand-in: the tier its autopilot drives at (default the race's), its thrust scale (default the
   *  race tier's pace: it races at its rivals' pace), and the Rookie preset's assists on top of its steering. */
  player?: { tier?: AITier; pace?: number; assisted?: boolean };
  /** Keep racing after the player finishes until every ship is home (else the results come RESULTS_DELAY later). */
  untilAllFinish?: boolean;
}

export async function runWorldRace(trackId: string, tier: AITier, opts: WorldRaceOptions = {}): Promise<WorldRaceResult> {
  let track = tracks.get(trackId);
  if (!track) {
    track = trackFromSource({ kind: 'authored', def: TRACK_DEFS[trackId] });
    tracks.set(trackId, track);
  }
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus, { hazards: opts.hazards ?? HAZARDS_NORMAL });
  const field = buildRaceField({ playerName: 'AUTO', playerLoadout: defaultLoadout(), tier, ...(opts.gridOrder ? { gridOrder: opts.gridOrder } : {}), ...(opts.rivalTiers ? { rivalTiers: opts.rivalTiers } : {}) });
  if (opts.player?.tier) field[0].tier = opts.player.tier;
  const playerPace = opts.player?.pace ?? TIERS[tier].paceScale;
  const assists = opts.player?.assisted ? new PlayerAssists(track) : null;
  const ships = field.map((d) => physics.addShip(d, track.startGrid[d.gridIndex]));
  const drivers = ships.map((s) => new AIDriver(s, track, s.def.personality ?? 'steady', track.seed * 31 + s.def.id * 7919, ships, { hazardClock: () => physics.hazardTime, liveMines: () => physics.mines }));
  const race = new RaceManager(track, ships, bus, undefined, opts.untilAllFinish ? Infinity : undefined);
  const items = opts.items === false ? null : new ItemSystem({ ships, player: ships[0], race, bus, physics, track }, track.seed);
  const itemUses = { emp: 0, shield: 0, mine: 0, blocked: 0, empHits: 0 };
  bus.on('item:warn', () => itemUses.emp++);
  bus.on('item:use', (e) => itemUses[e.kind]++);
  bus.on('item:shield', () => itemUses.blocked++);
  bus.on('item:emp', () => itemUses.empHits++);

  const respawns = new Map<ShipId, number>();
  const jumps = new Map<ShipId, number>();
  const ice = new Map<ShipId, number>();
  const destroyed: ShipId[] = [];
  const gateHits = new Map<ShipId, number>();
  const shortcuts = new Map<ShipId, number>();
  const lastPath = new Map<ShipId, string | null>();
  bus.on('hazard:gate', ({ shipId }) => gateHits.set(shipId, (gateHits.get(shipId) ?? 0) + 1));
  const mineHits = new Map<ShipId, number>();
  const debrisHits = new Map<ShipId, number>();
  const droppedMineHits = new Map<ShipId, number>();
  bus.on('hazard:mine', ({ shipId, owner }) => {
    const m = owner === null ? mineHits : droppedMineHits;
    m.set(shipId, (m.get(shipId) ?? 0) + 1);
  });
  bus.on('hazard:debris', ({ shipId }) => debrisHits.set(shipId, (debrisHits.get(shipId) ?? 0) + 1));
  const lightningHits = new Map<ShipId, number>();
  bus.on('hazard:lightning', ({ shipId }) => lightningHits.set(shipId, (lightningHits.get(shipId) ?? 0) + 1));
  let playerLaps = 0;
  bus.on('ship:respawn', ({ shipId }) => respawns.set(shipId, (respawns.get(shipId) ?? 0) + 1));
  bus.on('ship:jump', ({ shipId }) => jumps.set(shipId, (jumps.get(shipId) ?? 0) + 1));
  bus.on('ship:ice', ({ shipId, active }) => {
    if (active) ice.set(shipId, (ice.get(shipId) ?? 0) + 1);
  });
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
  while (t < MAX_SIM_SECONDS && race.state !== 'results') {
    for (const d of drivers) controls.set(d.shipId, d.update(dt));
    if (assists) controls.set(0, assists.apply(ships[0], controls.get(0)!, ROOKIE_ASSISTS));
    ships[0].thrustScale = playerPace;
    items?.fixed(dt, null);
    const t0 = performance.now();
    physics.step(dt, controls);
    stepMs += performance.now() - t0;
    steps++;
    race.fixedUpdate(dt);
    t += dt;
    for (const s of ships) {
      if (s.status === 'racing' && !s.airborne) maxLateral = Math.max(maxLateral, Math.abs(s.lateral));
      const prev = lastPath.get(s.def.id) ?? null;
      if (s.path !== null && prev === null) shortcuts.set(s.def.id, (shortcuts.get(s.def.id) ?? 0) + 1);
      lastPath.set(s.def.id, s.path);
    }
  }
  const snap = race.snapshot();
  const table = snap.standings
    .map((r) => {
      const ship = ships.find((s) => s.def.id === r.id)!;
      return `${r.position}. ${r.name.padEnd(14)} ${(ship.def.personality ?? '-').padEnd(10)} ${r.status} laps=${r.lap} t=${r.totalTime?.toFixed(2)} jumps=${jumps.get(r.id) ?? 0} ice=${ice.get(r.id) ?? 0} gates=${gateHits.get(r.id) ?? 0} mines=${mineHits.get(r.id) ?? 0}+${droppedMineHits.get(r.id) ?? 0} debris=${debrisHits.get(r.id) ?? 0} lightning=${lightningHits.get(r.id) ?? 0} shortcuts=${shortcuts.get(r.id) ?? 0} respawns=${respawns.get(r.id) ?? 0}`;
    })
    .join('\n') + `\nitems: emp=${itemUses.emp} (hit ${itemUses.empHits}) shield=${itemUses.shield} mine=${itemUses.mine} blocked=${itemUses.blocked}`;
  physics.dispose();
  return {
    track,
    ships,
    finished: ships.every((s) => s.status === 'finished'),
    simTime: t,
    respawns,
    jumps,
    ice,
    destroyed,
    gateHits,
    mineHits,
    droppedMineHits,
    itemUses,
    debrisHits,
    lightningHits,
    shortcuts,
    standings: snap.standings.map((r) => ({ id: r.id, totalTime: r.totalTime ?? null })),
    results: snap.standings.map((r) => ({ ...r })),
    playerLaps,
    maxLateral,
    stepMs: stepMs / Math.max(1, steps),
    table,
  };
}
