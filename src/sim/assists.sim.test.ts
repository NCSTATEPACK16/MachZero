/**
 * The four player assists in real races (IMPLEMENTATION §M7a): No-KO against the rails and a mine, boost from lap 1,
 * auto-accelerate round a lap of Neon Bay with no throttle input, and replay determinism with the assists on. The
 * races go through RaceSession, the same path the App drives, so what passes here is what the player gets.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CONFIG, SHIP_ROSTER } from '../core/config';
import type { Assists, ControlInput, GridSlot, ShipId, TrackData } from '../core/contracts';
import { clamp, wrap01 } from '../core/math';
import { EventBus, type GameEvents } from '../core/events';
import { HAZARDS_NORMAL } from '../core/hazards';
import { buildRaceField, defaultLoadout } from '../content/pilots';
import { TRACK_DEFS } from '../content/tracks';
import { RaceSession } from '../app/RaceSession';
import { AIDriver } from '../game/AIDriver';
import { PhysicsSystem } from '../physics';
import { NO_KO_FLOOR } from '../physics/ShipController';
import { NO_ASSISTS, ROOKIE_ASSISTS } from '../save/schema';
import { trackFromSource } from '../track';

vi.setConfig({ testTimeout: 60_000 });

const dt = CONFIG.FIXED_DT;
const neutral = (c: Partial<ControlInput> = {}): ControlInput => ({ throttle: 0, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false, ...c });

function session(assists: Readonly<Assists>, trackId = 'neon-bay'): Promise<RaceSession> {
  return RaceSession.create({
    source: { kind: 'authored', def: TRACK_DEFS[trackId] },
    worldId: trackId,
    trackKey: trackId,
    field: buildRaceField({ playerName: 'T', playerLoadout: defaultLoadout(), tier: 'rookie' }),
    autopilot: false,
    assists,
    records: { load: () => null, save: () => undefined },
  });
}

/** Step `s` with `input(raceTime)` until `seconds` of racing have passed (the countdown is not counted). */
function race(s: RaceSession, seconds: number, input: (t: number) => ControlInput, stop?: () => boolean): void {
  let t = 0;
  for (let i = 0; i < (seconds + 10) / dt && t < seconds; i++) {
    s.fixed(dt, input(t));
    if (s.state === 'racing') t += dt;
    if (stop?.()) return;
  }
}

describe('No-KO (IMPLEMENTATION §M7a)', () => {
  /**
   * Full throttle, slamming rail to rail every 1.5 s for 20 s on Neon Bay. A fresh ship loses about 50 energy that
   * way, so the ship starts worn down to 12 energy: without No-KO the rails destroy it; with No-KO (half damage) they drive it
   * down to the floor of 1 and no further.
   */
  async function railRun(noKO: boolean) {
    const s = await session({ ...NO_ASSISTS, noKO });
    const destroyed: ShipId[] = [];
    s.bus.on('ship:destroyed', ({ shipId }) => destroyed.push(shipId));
    let minEnergy = Infinity;
    let worn = false;
    s.start();
    race(s, 20, (t) => {
      if (s.state === 'racing' && !worn) {
        s.player.energy = 12;
        worn = true;
      }
      if (worn) minEnergy = Math.min(minEnergy, s.player.energy);
      return neutral({ throttle: 1, steer: Math.floor(t / 1.5) % 2 ? 1 : -1 });
    });
    const out = { destroyed: destroyed.includes(s.player.def.id), status: s.player.status, minEnergy, energy: s.player.energy };
    s.dispose();
    return out;
  }

  it('a ship held against the rails at full throttle for 20 s is never destroyed, and keeps at least 1 energy', async () => {
    const off = await railRun(false);
    const on = await railRun(true);
    console.log(`rails: without No-KO destroyed=${off.destroyed} status=${off.status}; with No-KO min energy=${on.minEnergy.toFixed(2)} status=${on.status}`);
    expect(off.destroyed).toBe(true);
    expect(off.status).toBe('retired');
    expect(on.destroyed).toBe(false);
    expect(on.status).toBe('racing');
    expect(on.minEnergy).toBeGreaterThanOrEqual(NO_KO_FLOOR);
    expect(on.minEnergy).toBeLessThan(NO_KO_FLOOR + 2); // the rails did drive it down to the floor
  });

  /** Orbital Ring's first mine field: fly into its first mine at 60 m/s under the normal hazard rules. */
  async function mineRun(noKO: boolean): Promise<{ hits: number; energyLost: number }> {
    const orbital: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['orbital-ring'] });
    const L = orbital.length;
    const f = orbital.features.find((x) => x.type === 'mines')!;
    const bus = new EventBus<GameEvents>();
    const physics = await PhysicsSystem.create(orbital, bus, { hazards: HAZARDS_NORMAL });
    const ship = physics.addShip(SHIP_ROSTER[0], orbital.startGrid[0]);
    ship.noKO = noKO;
    const u = wrap01((f.dStart - 80) / L);
    const smp = orbital.sampleAt(u);
    const slot: GridSlot = { u, lateral: 0, position: smp.position.clone().addScaledVector(smp.up, CONFIG.HOVER_HEIGHT), quaternion: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(smp.right, smp.up, smp.forward.clone().negate())) };
    physics.resetTime();
    physics.resetShip(0, slot);
    ship.status = 'racing';
    ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(60);
    let hits = 0;
    bus.on('hazard:mine', () => hits++);
    const controls = new Map<ShipId, ControlInput>();
    const e0 = ship.energy;
    let prevLat = ship.lateral;
    for (let i = 0; i < 6 / dt && hits === 0; i++) {
      const m = physics.mines[0];
      const latVel = (ship.lateral - prevLat) / dt;
      prevLat = ship.lateral;
      controls.set(0, neutral({ throttle: clamp(0.5 - (ship.forwardSpeed - 60) / 4, 0, 1), steer: clamp(0.15 * (m.lateral - ship.lateral) - 0.06 * latVel, -1, 1) }));
      physics.step(dt, controls);
    }
    const energyLost = e0 - ship.energy;
    physics.dispose();
    return { hits, energyLost };
  }

  it('one mine hit costs half the energy of the same hit without it', async () => {
    const off = await mineRun(false);
    const on = await mineRun(true);
    console.log(`mine: energy lost without No-KO ${off.energyLost.toFixed(2)}, with ${on.energyLost.toFixed(2)}`);
    expect(off.hits).toBe(1);
    expect(on.hits).toBe(1);
    expect(off.energyLost).toBeCloseTo(CONFIG.MINE_DAMAGE * SHIP_ROSTER[0].stats.damageTakenScale, 1);
    expect(on.energyLost).toBeCloseTo(off.energyLost / 2, 1);
  });

  it('boosting still costs the full boost energy (a boost is not damage)', async () => {
    const s = await session({ ...NO_ASSISTS, noKO: true, earlyBoost: true });
    s.start();
    let before = 0;
    race(s, 3, () => neutral({ throttle: 1 }));
    before = s.player.energy;
    s.fixed(dt, neutral({ throttle: 1, boost: true }));
    expect(s.player.boosting).toBe(true);
    expect(before - s.player.energy).toBeCloseTo(s.player.def.stats.boostCost, 5);
    s.dispose();
  });
});

describe('boost from lap 1', () => {
  async function boostOnLap1(earlyBoost: boolean): Promise<{ boosted: boolean; lap: number }> {
    const s = await session({ ...NO_ASSISTS, earlyBoost });
    let boosted = false;
    s.bus.on('ship:boost', ({ shipId }) => (boosted ||= shipId === s.player.def.id));
    s.start();
    race(s, 4, (t) => neutral({ throttle: 1, boost: t > 2 && Math.floor(t * 10) % 2 === 0 }));
    const out = { boosted, lap: s.race.snapshot().lap };
    s.dispose();
    return out;
  }

  it('a boost request on lap 1 starts a boost with boost-from-lap-1, and does not without it', async () => {
    const on = await boostOnLap1(true);
    const off = await boostOnLap1(false);
    expect(on.lap).toBe(1);
    expect(off.lap).toBe(1);
    expect(on.boosted).toBe(true);
    expect(off.boosted).toBe(false);
  });
});

describe('auto-accelerate', () => {
  /** Neon Bay with the AI's steering and brake but never any throttle input; the assists given do the rest. */
  async function lapWithoutThrottle(assists: Readonly<Assists>) {
    const s = await session(assists);
    const ai = new AIDriver(s.player, s.track, 'steady', 12345, s.ships);
    let laps = 0;
    let respawns = 0;
    s.bus.on('race:lap', ({ shipId }) => (laps += shipId === s.player.def.id ? 1 : 0));
    s.bus.on('ship:respawn', ({ shipId }) => (respawns += shipId === s.player.def.id ? 1 : 0));
    s.start();
    race(s, 90, () => {
      const c = ai.update(dt);
      return neutral({ steer: c.steer, brake: c.brake, airbrakeLeft: c.airbrakeLeft, airbrakeRight: c.airbrakeRight });
    }, () => laps >= 1);
    const out = { laps, respawns, raceTime: s.race.snapshot().raceTime, u: s.player.trackU, x: s.player.position.x, z: s.player.position.z, energy: s.player.energy };
    s.dispose();
    return out;
  }

  it('with zero throttle input the ship completes a lap of Neon Bay', async () => {
    const r = await lapWithoutThrottle({ ...NO_ASSISTS, autoAccelerate: true });
    console.log(`auto-accelerate: lap 1 in ${r.raceTime.toFixed(2)} s, respawns ${r.respawns}`);
    expect(r.laps).toBe(1);
    expect(r.respawns).toBe(0);
    // Without it the ship never gets going.
    const none = await session(NO_ASSISTS);
    none.start();
    race(none, 5, () => neutral());
    expect(none.player.forwardSpeed).toBeLessThan(1);
    none.dispose();
  });

  it('two runs with the same seed and the Rookie assists are identical', async () => {
    const a = await lapWithoutThrottle(ROOKIE_ASSISTS);
    const b = await lapWithoutThrottle(ROOKIE_ASSISTS);
    expect(a.laps).toBe(1);
    expect(b).toEqual(a);
  });
});

