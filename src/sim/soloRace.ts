/**
 * A headless solo race: one ship on an authored track, driven by its AI (IMPLEMENTATION §X3's sidegrade balance,
 * §M8b's dev ghosts and medal sims). By default a Legend autopilot, personality `steady`, seed 12345, normal
 * hazards. With `ghost` it records the run as the Time Trial race does.
 */
import { CONFIG } from '../core/config';
import type { ControlInput, Loadout, PartSlot, PartTier, ShipId, TrackData } from '../core/contracts';
import { EventBus, type GameEvents } from '../core/events';
import { HAZARDS_NORMAL, type HazardPolicy } from '../core/hazards';
import { RIVAL_FITS, buildRaceField, defaultLoadout } from '../content/pilots';
import { TRACK_DEFS } from '../content/tracks';
import { AIDriver, RaceManager } from '../game';
import { GhostCapture } from '../game/ghost/GhostCapture';
import type { GhostData } from '../game/ghost/ghostCodec';
import { PhysicsSystem } from '../physics';
import { trackFromSource } from '../track';

const tracks = new Map<string, TrackData>();
const MAX_SECONDS = 240;

export function soloTrack(trackId: string): TrackData {
  let track = tracks.get(trackId);
  if (!track) {
    track = trackFromSource({ kind: 'authored', def: TRACK_DEFS[trackId] });
    tracks.set(trackId, track);
  }
  return track;
}

/** Every slot at one tier, variant A: a "kit" (stock = 0, Mk II = 1, Mk III = 2, Prototype = 3). */
export function kit(tier: PartTier, chassisId = 'comet'): Loadout {
  const l = defaultLoadout();
  const parts = Object.fromEntries(Object.keys(l.parts).map((s) => [s, tier])) as Record<PartSlot, PartTier>;
  const variants = Object.fromEntries(Object.keys(l.parts).map((s) => [s, 'a'])) as Loadout['variants'];
  return { ...l, chassisId, parts, variants };
}

/** The dev-ghost ship: a COMET with the Legend rivals' parts, variant A. */
export function devLoadout(): Loadout {
  const l = kit(0);
  return { ...l, parts: { ...RIVAL_FITS.legend } };
}

export interface SoloOptions {
  ghost?: boolean;
  hazards?: Readonly<HazardPolicy>;
  seed?: number;
}

export interface SoloResult {
  /** Total time (s), Infinity when the ship did not finish. */
  total: number;
  lapTimes: number[];
  laps: number;
  ghost: GhostData | null;
}

export async function soloRace(trackId: string, loadout: Loadout, opts: SoloOptions = {}): Promise<SoloResult> {
  const track = soloTrack(trackId);
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus, { hazards: opts.hazards ?? HAZARDS_NORMAL });
  const [def] = buildRaceField({ playerName: 'T', playerLoadout: loadout, tier: 'legend' });
  def.tier = 'legend';
  const ship = physics.addShip(def, track.startGrid[def.gridIndex]);
  const driver = new AIDriver(ship, track, 'steady', opts.seed ?? 12345, [ship], { hazardClock: () => physics.hazardTime, liveMines: () => physics.mines });
  const race = new RaceManager(track, [ship], bus, { load: () => null, save: () => undefined });
  const capture = opts.ghost ? new GhostCapture(bus, ship, trackId) : null;
  let total = Infinity;
  const lapTimes: number[] = [];
  bus.on('race:lap', (e) => lapTimes.push(e.lapTime));
  bus.on('race:finish', (e) => {
    total = e.totalTime;
  });
  const controls = new Map<ShipId, ControlInput>();
  race.start();
  for (let t = 0; t < MAX_SECONDS && (total === Infinity || (capture && !capture.result)); t += CONFIG.FIXED_DT) {
    controls.set(0, driver.update(CONFIG.FIXED_DT));
    physics.step(CONFIG.FIXED_DT, controls);
    race.fixedUpdate(CONFIG.FIXED_DT);
    capture?.step();
  }
  physics.dispose();
  capture?.dispose();
  return { total, lapTimes, laps: track.laps, ghost: capture?.result ?? null };
}
