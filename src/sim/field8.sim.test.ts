/**
 * 2.0 field: 8 ships (6 chassis across 3 weight classes, tier-fitted parts) on the v1 seed track.
 * Everyone must finish all laps without leaving the track, exploding or respawning more than once.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../core/config';
import type { AITier, ControlInput, ShipId, ShipState } from '../core/contracts';
import { EventBus, type GameEvents } from '../core/events';
import { buildRaceField, defaultLoadout } from '../content/pilots';
import { AIDriver, RaceManager } from '../game';
import { PhysicsSystem } from '../physics';
import { generateTrack } from '../track';


const TIERS: AITier[] = ['rookie', 'pilot', 'legend'];
const MAX_SIM_SECONDS = 360;

describe.each(TIERS)('8-ship race simulation (%s fits, v1 seed)', (tier) => {
  it('all eight ships finish every lap and stay on the track', async () => {
    const seed = CONFIG.TRACK_SEED;
    const bus = new EventBus<GameEvents>();
    const track = generateTrack({ seed });
    const physics = await PhysicsSystem.create(track, bus);
    const field = buildRaceField({ playerName: 'AUTO', playerLoadout: defaultLoadout(), tier });
    const ships: ShipState[] = field.map((d) => physics.addShip(d, track.startGrid[d.gridIndex]));
    const drivers = ships.map((s) => new AIDriver(s, track, s.def.personality ?? 'steady', seed * 31 + s.def.id * 7919, ships));
    const race = new RaceManager(track, ships, bus);

    const respawns = new Map<ShipId, number>();
    const destroyed: ShipId[] = [];
    const laps = new Map<ShipId, number>();
    bus.on('ship:respawn', ({ shipId }) => respawns.set(shipId, (respawns.get(shipId) ?? 0) + 1));
    bus.on('ship:destroyed', ({ shipId }) => destroyed.push(shipId));
    bus.on('race:lap', ({ shipId }) => laps.set(shipId, (laps.get(shipId) ?? 0) + 1));

    let maxLateral = 0;
    let stepMs = 0;
    let steps = 0;
    const controls = new Map<ShipId, ControlInput>();
    race.start();
    const dt = CONFIG.FIXED_DT;
    let t = 0;
    while (t < MAX_SIM_SECONDS && race.state !== 'results') {
      for (const d of drivers) controls.set(d.shipId, d.update(dt));
      const t0 = performance.now();
      physics.step(dt, controls);
      stepMs += performance.now() - t0;
      steps++;
      race.fixedUpdate(dt);
      t += dt;
      for (const s of ships) {
        expect(Number.isFinite(s.position.x + s.position.y + s.position.z)).toBe(true);
        if (s.status === 'racing') maxLateral = Math.max(maxLateral, Math.abs(s.lateral));
      }
    }

    const snap = race.snapshot();
    console.log(
      `${tier}: simT=${t.toFixed(1)}s physics=${(stepMs / steps).toFixed(3)}ms/step maxLateral=${maxLateral.toFixed(2)} ` +
        `respawns=${JSON.stringify([...respawns])} destroyed=${JSON.stringify(destroyed)}\n` +
        snap.standings
          .map((r) => `${r.position}. ${r.name.padEnd(14)} ${r.status} laps=${r.lap} t=${r.totalTime?.toFixed(2)}`)
          .join('\n'),
    );

    expect(race.state).toBe('results');
    expect(snap.standings).toHaveLength(8);
    for (const s of ships) {
      expect(s.status, `${s.def.name} status`).toBe('finished');
      expect(respawns.get(s.def.id) ?? 0, `${s.def.name} respawns`).toBeLessThanOrEqual(1);
    }
    // The player (race decider) completes every lap for real; rivals may still be finishing when results show.
    expect(laps.get(0)).toBe(CONFIG.TOTAL_LAPS);
    expect(destroyed).toEqual([]);
    expect(maxLateral).toBeLessThan(track.halfWidth + 1);

    physics.dispose();
  });
});
