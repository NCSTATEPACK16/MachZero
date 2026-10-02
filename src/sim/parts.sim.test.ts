/**
 * Parts change race behaviour (M2 "done when"): the same autopilot on the v1 seed track, stock COMET vs a
 * COMET with the Prototype engine. The upgraded ship must reach a higher top speed and lap faster.
 */
import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../core/config';
import type { ControlInput, Loadout, ShipId } from '../core/contracts';
import { EventBus, type GameEvents } from '../core/events';
import { buildRaceField, defaultLoadout } from '../content/pilots';
import { AIDriver, RaceManager } from '../game';
import { PhysicsSystem } from '../physics';
import { generateTrack } from '../track';

// Whole races in Rapier: tens of seconds alone, far more on a busy machine. The 60 s default is not a
// budget for these; correctness is asserted below.
vi.setConfig({ testTimeout: 300_000 });

async function run(loadout: Loadout): Promise<{ maxSpeed: number; lap1: number }> {
  const bus = new EventBus<GameEvents>();
  const track = generateTrack({ seed: CONFIG.TRACK_SEED });
  const physics = await PhysicsSystem.create(track, bus);
  // Solo: only the player (id 0), so traffic can't decide the comparison.
  const [def] = buildRaceField({ playerName: 'T', playerLoadout: loadout, tier: 'rookie' });
  const ship = physics.addShip(def, track.startGrid[def.gridIndex]);
  const driver = new AIDriver(ship, track, 'steady', 12345, [ship]);
  const race = new RaceManager(track, [ship], bus, { load: () => null, save: () => undefined });
  let lap1 = Infinity;
  bus.on('race:lap', (e) => {
    if (e.lap === 1) lap1 = e.lapTime;
  });
  const controls = new Map<ShipId, ControlInput>();
  race.start();
  let maxSpeed = 0;
  let lastPush = -Infinity; // dash plates and boosts push past top speed; measure clean running only
  for (let t = 0; t < 60 && lap1 === Infinity; t += CONFIG.FIXED_DT) {
    controls.set(0, driver.update(CONFIG.FIXED_DT));
    physics.step(CONFIG.FIXED_DT, controls);
    race.fixedUpdate(CONFIG.FIXED_DT);
    if (ship.onDash || ship.boosting) lastPush = t;
    if (t - lastPush > 3) maxSpeed = Math.max(maxSpeed, ship.forwardSpeed);
  }
  physics.dispose();
  return { maxSpeed, lap1 };
}

describe('parts change race behaviour', () => {
  it('a Prototype engine raises top speed and lap pace over stock', async () => {
    const stock = await run(defaultLoadout());
    const proto = await run({ ...defaultLoadout(), parts: { engine: 3, booster: 0, stabilizer: 0, hull: 0 } });
    console.log(`stock: vmax=${stock.maxSpeed.toFixed(1)} lap1=${stock.lap1.toFixed(2)} | prototype engine: vmax=${proto.maxSpeed.toFixed(1)} lap1=${proto.lap1.toFixed(2)}`);
    expect(Number.isFinite(stock.lap1) && Number.isFinite(proto.lap1)).toBe(true);
    expect(proto.maxSpeed).toBeGreaterThan(stock.maxSpeed + 3);
    expect(proto.lap1).toBeLessThan(stock.lap1);
  });
});
