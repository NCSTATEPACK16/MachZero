/**
 * Headless integration test: real track + real Rapier physics + real AI + real race logic.
 * Four AI-driven ships (the player on autopilot) must finish a full race without leaving the track.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG, SHIP_ROSTER } from '../core/config';
import type { ControlInput, ShipId, ShipState } from '../core/contracts';
import { EventBus, type GameEvents } from '../core/events';
import { inLoopRange } from '../core/math';
import { AIDriver, RaceManager } from '../game';
import { PhysicsSystem } from '../physics';
import { generateTrack } from '../track';

const SEEDS = [CONFIG.TRACK_SEED, 1234];
const MAX_SIM_SECONDS = 360;

describe.each(SEEDS)('full race simulation (seed %i)', (seed) => {
  it('all four ships finish every lap, stay on the track and traverse the corkscrew', async () => {
    const bus = new EventBus<GameEvents>();
    const track = generateTrack({ seed });
    const physics = await PhysicsSystem.create(track, bus);
    const ships: ShipState[] = SHIP_ROSTER.map((d) => physics.addShip(d, track.startGrid[d.gridIndex]));
    const drivers = ships.map(
      (s) => new AIDriver(s, track, s.def.personality ?? 'steady', seed * 31 + s.def.id * 7919, ships),
    );
    const race = new RaceManager(track, ships, bus);

    const respawns = new Map<ShipId, number>();
    const destroyed: ShipId[] = [];
    const laps = new Map<ShipId, number[]>();
    bus.on('ship:respawn', ({ shipId }) => respawns.set(shipId, (respawns.get(shipId) ?? 0) + 1));
    bus.on('ship:destroyed', ({ shipId }) => destroyed.push(shipId));
    bus.on('race:lap', ({ shipId, lapTime }) => laps.set(shipId, [...(laps.get(shipId) ?? []), lapTime]));

    const corkscrewHits = new Map<ShipId, number>();
    let maxLateral = 0;
    let maxSpeed = 0;
    const controls = new Map<ShipId, ControlInput>();

    race.start();
    const dt = CONFIG.FIXED_DT;
    let t = 0;
    while (t < MAX_SIM_SECONDS && race.state !== 'results') {
      for (const d of drivers) controls.set(d.shipId, d.update(dt));
      physics.step(dt, controls);
      race.fixedUpdate(dt);
      t += dt;
      for (const s of ships) {
        expect(Number.isFinite(s.position.x + s.position.y + s.position.z)).toBe(true);
        if (s.status !== 'racing') continue;
        maxLateral = Math.max(maxLateral, Math.abs(s.lateral));
        maxSpeed = Math.max(maxSpeed, s.speed);
        if (inLoopRange(s.trackU, track.corkscrew.uStart, track.corkscrew.uEnd)) {
          corkscrewHits.set(s.def.id, (corkscrewHits.get(s.def.id) ?? 0) + 1);
        }
      }
    }

    const snap = race.snapshot();
    const summary = snap.standings
      .map((r) => `${r.position}. ${r.name} ${r.status} laps=${r.lap} t=${r.totalTime?.toFixed(2)} best=${r.bestLap?.toFixed(2)}`)
      .join('\n');
    console.log(
      `seed ${seed}: len=${track.length.toFixed(0)}m simT=${t.toFixed(1)}s maxSpeed=${maxSpeed.toFixed(1)} ` +
        `maxLateral=${maxLateral.toFixed(2)} respawns=${JSON.stringify([...respawns])} destroyed=${JSON.stringify(destroyed)}\n${summary}`,
    );

    expect(race.state).toBe('results');
    for (const s of ships) {
      expect(s.status, `${s.def.name} status`).toBe('finished');
      expect(laps.get(s.def.id)?.length, `${s.def.name} laps`).toBe(CONFIG.TOTAL_LAPS);
      expect(respawns.get(s.def.id) ?? 0, `${s.def.name} respawns`).toBeLessThanOrEqual(1);
      expect(corkscrewHits.get(s.def.id) ?? 0, `${s.def.name} corkscrew`).toBeGreaterThan(0);
    }
    expect(destroyed).toEqual([]);
    expect(maxLateral).toBeLessThan(track.halfWidth + 1);
    expect(maxSpeed).toBeGreaterThan(CONFIG.TOP_SPEED * 0.8);

    physics.dispose();
  });
});
