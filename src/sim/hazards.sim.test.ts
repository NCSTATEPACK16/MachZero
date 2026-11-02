/**
 * Integration: Jade Ruins' stone gates with real physics. A ship that drives into a shut half gate bounces off it
 * (a `hazard:gate` hit) and, under the normal hazard policy, loses energy; under the Rookie policy it keeps its
 * energy and is slowed by the policy's hit scale instead. A ship on the open half drives past. The gates run on
 * physics time since the race reset, so the same race replays to the same standings.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CONFIG, SHIP_ROSTER } from '../core/config';
import type { ControlInput, GridSlot, ShipId, TrackData } from '../core/contracts';
import { clamp, wrap01 } from '../core/math';
import { EventBus, type GameEvents } from '../core/events';
import { HAZARDS_NORMAL, HAZARDS_ROOKIE, type HazardPolicy } from '../core/hazards';
import { TRACK_DEFS } from '../content/tracks';
import { PhysicsSystem } from '../physics';
import { trackFromSource } from '../track';
import { gateClosure } from '../track/features/gate';
import { runWorldRace } from './worldRace';

vi.setConfig({ testTimeout: 60_000 });

const track: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['jade-ruins'] });
const L = track.length;

function slotAt(u: number, lateral: number): GridSlot {
  const s = track.sampleAt(u);
  const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
  const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
  return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
}

interface GateRun {
  hits: number;
  /** Hits within a second of the first (contact flicker must count once). */
  hitsFirstSecond: number;
  energyLost: number;
  speedBefore: number;
  speedAfter: number;
  passed: boolean;
  /** Gate closure at the first hit. */
  closureAtArrival: number;
}

/** Drive straight at `lateral` from 40 m before the first left-half main gate, which shuts from t = 0. */
async function driveAtGate(lateral: number, hazards: Readonly<HazardPolicy>): Promise<GateRun> {
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus, { hazards });
  const gate = physics.gates.find((g) => g.branch === null && g.span === 'left')!;
  const ship = physics.addShip(SHIP_ROSTER[0], track.startGrid[0]);
  physics.resetTime();
  physics.resetShip(0, slotAt(wrap01((gate.d - 40) / L), lateral));
  ship.status = 'racing';
  const speed = 50;
  ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(speed);
  let hits = 0;
  bus.on('hazard:gate', () => hits++);
  const controls = new Map<ShipId, ControlInput>();
  let firstHit = Infinity;
  const run: GateRun = { hits: 0, hitsFirstSecond: 0, energyLost: 0, speedBefore: 0, speedAfter: 0, passed: false, closureAtArrival: NaN };
  const e0 = ship.energy;
  let prevLat = ship.lateral;
  for (let i = 0; i < 120 * 3; i++) {
    const latVel = (ship.lateral - prevLat) / CONFIG.FIXED_DT;
    prevLat = ship.lateral;
    const over = ship.forwardSpeed - speed;
    controls.set(0, { throttle: clamp(0.5 - over / 4, 0, 1), brake: 0, steer: clamp(0.15 * (lateral - ship.lateral) - 0.06 * latVel, -1, 1), airbrakeLeft: 0, airbrakeRight: 0, boost: false });
    const before = ship.speed;
    const hitsBefore = hits;
    physics.step(CONFIG.FIXED_DT, controls);
    const d = ship.trackU * L;
    if (hits > hitsBefore && physics.hazardTime - firstHit < 1) run.hitsFirstSecond++;
    if (hits > hitsBefore && run.speedBefore === 0) {
      firstHit = physics.hazardTime;
      run.hitsFirstSecond = 1;
      run.closureAtArrival = gateClosure(gate, physics.hazardTime);
      run.speedBefore = before;
      run.speedAfter = ship.speed;
    }
    if (d > gate.d + 30) {
      run.passed = true;
      break;
    }
  }
  run.hits = hits;
  run.energyLost = e0 - ship.energy;
  physics.dispose();
  return run;
}

describe('Jade Ruins stone gates', () => {
  it('a shut half gate stops a ship on its half: a hit, energy lost (normal policy)', async () => {
    const r = await driveAtGate(-7, HAZARDS_NORMAL);
    console.log(`gate normal: closure=${r.closureAtArrival.toFixed(2)} hits=${r.hits} energyLost=${r.energyLost.toFixed(1)} v ${r.speedBefore.toFixed(0)}→${r.speedAfter.toFixed(0)} passed=${r.passed}`);
    expect(r.closureAtArrival).toBe(1);
    expect(r.hitsFirstSecond).toBe(1);
    expect(r.energyLost).toBeGreaterThan(0);
  });

  it('under the Rookie policy a hit costs no energy and slows the ship by the hit scale', async () => {
    const r = await driveAtGate(-7, HAZARDS_ROOKIE);
    console.log(`gate rookie: hits=${r.hits} energyLost=${r.energyLost.toFixed(1)} v ${r.speedBefore.toFixed(0)}→${r.speedAfter.toFixed(0)}`);
    expect(r.hitsFirstSecond).toBe(1);
    expect(r.energyLost).toBe(0);
    expect(r.speedAfter).toBeLessThanOrEqual(r.speedBefore * HAZARDS_ROOKIE.hitSpeedScale + 1e-6);
  });

  it('the open half is clear: a ship on it drives past without a hit', async () => {
    const r = await driveAtGate(7, HAZARDS_NORMAL);
    expect(r.hits).toBe(0);
    expect(r.passed).toBe(true);
    expect(r.energyLost).toBe(0);
  });

  it('replays the same race to the same standings (gates on physics time since the reset)', async () => {
    const a = await runWorldRace('jade-ruins', 'ace');
    const b = await runWorldRace('jade-ruins', 'ace');
    console.log(`jade-ruins ace (determinism)\n${a.table}`);
    expect(a.finished).toBe(true);
    expect(b.standings).toEqual(a.standings);
    expect([...b.gateHits]).toEqual([...a.gateHits]);
    expect([...b.shortcuts]).toEqual([...a.shortcuts]);
  });
});

/**
 * Orbital Ring's magnetic mines and debris. A ship that flies into a mine sets it off: a knock sideways and up, and
 * MINE_DAMAGE energy under the normal policy, or no energy and the Rookie slow-down; the mine comes back 6 s later.
 * Debris is solid: a ship that drives into it bounces off (`hazard:debris`). Every field leaves a clear lane, and
 * the mines and debris run on physics time since the reset, so a race replays to the same standings and hits.
 */
describe('Orbital Ring mines and debris', () => {
  const orbital: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['orbital-ring'] });
  const OL = orbital.length;
  const fields = orbital.features.filter((f) => f.type === 'mines' || f.type === 'debris');

  function orbitalSlot(u: number, lateral: number): GridSlot {
    const s = orbital.sampleAt(u);
    const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
    const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
    return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
  }

  interface HazardRun {
    mineHits: number;
    debrisHits: number;
    energyLost: number;
    speedBefore: number;
    speedAfter: number;
    /** Sideways speed (m/s, relative to the road) just after the first mine hit. */
    knock: number;
    mineArmedAfter: boolean[];
    passedD: number;
  }

  /**
   * Drive from `from` metres to `to` at `speed`, steering for `line(d, physics)` (a lateral). Stops at `to` or after
   * `maxSeconds`. Records mine and debris hits.
   */
  async function drive(
    from: number,
    to: number,
    speed: number,
    line: (d: number, physics: PhysicsSystem) => number,
    hazards: Readonly<HazardPolicy>,
    opts: { maxSeconds?: number; afterHit?: number } = {},
  ): Promise<HazardRun> {
    const bus = new EventBus<GameEvents>();
    const physics = await PhysicsSystem.create(orbital, bus, { hazards });
    const ship = physics.addShip(SHIP_ROSTER[0], orbital.startGrid[0]);
    physics.resetTime();
    physics.resetShip(0, orbitalSlot(wrap01(from / OL), line(from, physics)));
    ship.status = 'racing';
    ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(speed);
    const run: HazardRun = { mineHits: 0, debrisHits: 0, energyLost: 0, speedBefore: 0, speedAfter: 0, knock: 0, mineArmedAfter: [], passedD: 0 };
    let hitStep = -1;
    bus.on('hazard:mine', () => run.mineHits++);
    bus.on('hazard:debris', () => run.debrisHits++);
    const controls = new Map<ShipId, ControlInput>();
    const e0 = ship.energy;
    let prevLat = ship.lateral;
    const steps = Math.round((opts.maxSeconds ?? 6) * 120);
    for (let i = 0; i < steps; i++) {
      const d = ship.trackU * OL;
      const latVel = (ship.lateral - prevLat) / CONFIG.FIXED_DT;
      prevLat = ship.lateral;
      const over = ship.forwardSpeed - speed;
      controls.set(0, { throttle: clamp(0.5 - over / 4, 0, 1), brake: 0, steer: clamp(0.15 * (line(d, physics) - ship.lateral) - 0.06 * latVel, -1, 1), airbrakeLeft: 0, airbrakeRight: 0, boost: false });
      const before = ship.forwardSpeed;
      const hitsBefore = run.mineHits;
      physics.step(CONFIG.FIXED_DT, controls);
      if (run.mineHits > hitsBefore && hitStep < 0) {
        hitStep = i;
        run.speedBefore = before;
        run.speedAfter = ship.forwardSpeed;
      }
      // The knock moves the hull on the step after the hit.
      if (hitStep >= 0 && i === hitStep + 1) run.knock = Math.abs((ship.lateral - prevLat) / CONFIG.FIXED_DT);
      if (hitStep >= 0 && i - hitStep === Math.round((opts.afterHit ?? 0) * 120)) run.mineArmedAfter = physics.mines.map((m) => m.armed);
      run.passedD = wrap01(ship.trackU - from / OL) * OL;
      if (run.passedD > to - from && run.passedD < OL / 2) break;
    }
    run.energyLost = e0 - ship.energy;
    physics.dispose();
    return run;
  }

  /** Steer at a track mine (it drifts, so re-aim every step) until it goes off, then for the field's clear lane. */
  const atMine = (index: number, lane: number) => (_d: number, physics: PhysicsSystem): number => {
    const m = physics.mines[index];
    return m.armed ? m.lateral : lane;
  };

  it('has two mine fields of 4–5 mines and one debris field', () => {
    const mines = orbital.features.filter((f) => f.type === 'mines');
    const debris = orbital.features.filter((f) => f.type === 'debris');
    expect(mines.length).toBe(2);
    for (const f of mines) if (f.type === 'mines') expect(f.count === 4 || f.count === 5).toBe(true);
    expect(debris.length).toBe(1);
  });

  it('a mine hit knocks the ship and costs MINE_DAMAGE energy (normal); the mine is back 6 s later', async () => {
    const f = fields.find((x) => x.type === 'mines')!;
    const lane = f.lane ?? 0;
    const r = await drive(f.dStart - 80, f.dEnd + 20, 60, atMine(0, lane), HAZARDS_NORMAL, { afterHit: 0.5 });
    console.log(`mine normal: hits=${r.mineHits} energyLost=${r.energyLost.toFixed(1)} knock=${r.knock.toFixed(1)} v ${r.speedBefore.toFixed(0)}→${r.speedAfter.toFixed(0)}`);
    expect(r.mineHits).toBe(1);
    expect(r.energyLost).toBeCloseTo(CONFIG.MINE_DAMAGE * SHIP_ROSTER[0].stats.damageTakenScale, 1);
    expect(r.knock).toBeGreaterThan(4);
    expect(r.mineArmedAfter[0]).toBe(false);
    // Keep driving (past the field) until 6 s after the hit.
    const later = await drive(f.dStart - 80, f.dEnd + 600, 60, atMine(0, lane), HAZARDS_NORMAL, { maxSeconds: 12, afterHit: CONFIG.MINE_RESPAWN + 0.1 });
    expect(later.mineArmedAfter[0]).toBe(true);
  });

  it('under the Rookie policy a mine costs no energy and slows the ship by the hit scale', async () => {
    const f = fields.find((x) => x.type === 'mines')!;
    const r = await drive(f.dStart - 80, f.dEnd + 20, 60, atMine(0, f.lane ?? 0), HAZARDS_ROOKIE);
    console.log(`mine rookie: hits=${r.mineHits} energyLost=${r.energyLost.toFixed(1)} v ${r.speedBefore.toFixed(0)}→${r.speedAfter.toFixed(0)}`);
    expect(r.mineHits).toBe(1);
    expect(r.energyLost).toBe(0);
    expect(r.speedAfter).toBeLessThanOrEqual(r.speedBefore * HAZARDS_ROOKIE.hitSpeedScale + 0.5);
  });

  it.each([70, 140])('the clear lane through every field is clear at %i m/s', async (speed) => {
    for (const f of fields) {
      if (f.type !== 'mines' && f.type !== 'debris') continue;
      const r = await drive(f.dStart - 60, f.dEnd + 20, speed, () => f.lane ?? 0, HAZARDS_NORMAL);
      expect(r.mineHits + r.debrisHits, `${f.type} at ${f.dStart.toFixed(0)} m`).toBe(0);
      expect(r.energyLost).toBe(0);
    }
  });

  it('debris is solid: a ship driving into it bounces off', async () => {
    const f = fields.find((x) => x.type === 'debris')!;
    const r = await drive(f.dStart - 60, f.dEnd + 20, 50, (_d, physics) => physics.debrisLateral(0), HAZARDS_NORMAL);
    console.log(`debris: hits=${r.debrisHits} energyLost=${r.energyLost.toFixed(1)}`);
    expect(r.debrisHits).toBeGreaterThan(0);
    expect(r.energyLost).toBeGreaterThan(0);
  });

  it('replays the same race to the same standings and hazard hits (mines and debris on physics time)', async () => {
    const a = await runWorldRace('orbital-ring', 'legend');
    const b = await runWorldRace('orbital-ring', 'legend');
    console.log(`orbital-ring legend (determinism)\n${a.table}`);
    expect(a.finished).toBe(true);
    expect(b.standings).toEqual(a.standings);
    expect([...b.mineHits]).toEqual([...a.mineHits]);
  });
});
