/**
 * Sidegrade balance (IMPLEMENTATION §X3). For each of the four 2.0 slots and each tier above Stock, variant B
 * must lap within 1% of variant A: the mean over every built track of a solo Legend autopilot's lap time, with
 * the other slots on Stock. If this fails, tune B's numbers in content/parts.ts. Do not change the 1%.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../core/config';
import type { ControlInput, Loadout, PartSlot, PartTier, PartVariant, ShipId, TrackData } from '../core/contracts';
import { EventBus, type GameEvents } from '../core/events';
import { VARIANT_SLOTS, partName } from '../content/parts';
import { buildRaceField, defaultLoadout } from '../content/pilots';
import { TRACK_DEFS } from '../content/tracks';
import { AIDriver, RaceManager } from '../game';
import { PhysicsSystem } from '../physics';
import { trackFromSource } from '../track';

const TRACK_IDS = Object.keys(TRACK_DEFS);
const tracks = new Map<string, TrackData>();
/** The largest allowed difference between a pair's mean lap times. */
const MAX_DIFF = 0.01;

/** Mean lap time (s) of a solo three-lap race, or Infinity if the ship did not finish. */
async function meanLap(trackId: string, loadout: Loadout): Promise<number> {
  let track = tracks.get(trackId);
  if (!track) {
    track = trackFromSource({ kind: 'authored', def: TRACK_DEFS[trackId] });
    tracks.set(trackId, track);
  }
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus);
  const [def] = buildRaceField({ playerName: 'T', playerLoadout: loadout, tier: 'legend' });
  def.tier = 'legend';
  const ship = physics.addShip(def, track.startGrid[def.gridIndex]);
  const driver = new AIDriver(ship, track, 'steady', 12345, [ship], { hazardClock: () => physics.hazardTime, liveMines: () => physics.mines });
  const race = new RaceManager(track, [ship], bus, { load: () => null, save: () => undefined });
  let total = Infinity;
  bus.on('race:finish', (e) => {
    total = e.totalTime;
  });
  const controls = new Map<ShipId, ControlInput>();
  race.start();
  for (let t = 0; t < 240 && total === Infinity; t += CONFIG.FIXED_DT) {
    controls.set(0, driver.update(CONFIG.FIXED_DT));
    physics.step(CONFIG.FIXED_DT, controls);
    race.fixedUpdate(CONFIG.FIXED_DT);
  }
  physics.dispose();
  return total / track.laps;
}

function fit(slot: PartSlot, tier: PartTier, variant: PartVariant): Loadout {
  const l = defaultLoadout();
  return { ...l, parts: { ...l.parts, [slot]: tier }, variants: { ...l.variants, [slot]: variant } };
}

describe('sidegrades: each B part laps within 1% of its A part', () => {
  it.each(VARIANT_SLOTS)('%s', async (slot) => {
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const stock = mean(await Promise.all(TRACK_IDS.map((id) => meanLap(id, defaultLoadout()))));
    // Every tier is measured before anything is asserted, so one run shows the whole slot.
    const rows: { tier: PartTier; a: number; b: number; diff: number }[] = [];
    for (const tier of [1, 2, 3] as const) {
      const laps = { a: [] as number[], b: [] as number[] };
      for (const trackId of TRACK_IDS) {
        for (const v of ['a', 'b'] as const) laps[v].push(await meanLap(trackId, fit(slot, tier, v)));
      }
      const a = mean(laps.a);
      const b = mean(laps.b);
      rows.push({ tier, a, b, diff: (b - a) / a });
      console.log(
        `${slot} (stock ${stock.toFixed(2)} s) ${partName(slot, tier, 'a')} ${a.toFixed(2)} s vs ${partName(slot, tier, 'b')} ${b.toFixed(2)} s: ${(((b - a) / a) * 100).toFixed(2)}%  per track ${TRACK_IDS.map((id, i) => `${id} ${laps.a[i].toFixed(2)}/${laps.b[i].toFixed(2)}`).join(', ')}`,
      );
    }
    for (const r of rows) {
      expect(Number.isFinite(r.a) && Number.isFinite(r.b), `${slot} tier ${r.tier}: both variants finish every track`).toBe(true);
      expect(Math.abs(r.diff), `${slot} tier ${r.tier}: B is ${(r.diff * 100).toFixed(2)}% from A`).toBeLessThanOrEqual(MAX_DIFF);
    }
  });
});
