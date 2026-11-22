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
import { GEYSER_DAMAGE, GEYSER_KNOCK_UP, GEYSER_LANE_MARGIN, GEYSER_RADIUS, GEYSER_TIME, GEYSER_WARNING, buildGeysers as buildGeysersOf, geyserActive, geyserProgress, geyserWarning } from '../track/features/geyser';
import { JET_DAMAGE, JET_KNOCK, JET_KNOCK_ROOKIE, JET_LANE_MARGIN, JET_RADIUS, JET_TIME, JET_WARNING, buildJets as buildJetsOf, jetActive, jetProgress, jetSeamGap, jetWarning } from '../track/features/jet';
import { STRIKE_DAMAGE, STRIKE_JAM, STRIKE_LANE_MARGIN, STRIKE_RADIUS, STRIKE_TIME, STRIKE_WARNING, buildStrikes as buildStrikesOf, strikeActive, strikeWarning } from '../track/features/lightning';
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

/**
 * Tempest Spire's lightning fields. A strike point's circle glows, then the bolt lands for STRIKE_TIME seconds: a hull
 * inside the circle then takes one hit per strike. Normal policy: STRIKE_DAMAGE energy and a boost jam; Rookie
 * policy: no energy lost, no jam, the slow-down. A raised Shield takes the strike instead. Every field leaves a
 * clear lane, and the strikes run on physics time since the reset.
 */
describe('Tempest Spire lightning', () => {
  const spire: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['tempest-spire'] });
  const fields = spire.features.filter((f) => f.type === 'lightning');

  function spireSlot(u: number, lateral: number): GridSlot {
    const s = spire.sampleAt(u);
    const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
    const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
    return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
  }

  interface StrikeRun {
    hits: number;
    blocked: number;
    energyLost: number;
    /** Boost jam right after the first hit (s), and the speed just before and after it. */
    jam: number;
    speedBefore: number;
    speedAfter: number;
    /** Hazard time of each hit. */
    times: number[];
  }

  /** Hold a ship at `speed` on (u, lateral) of strike point `index` (or `at`) for `seconds`, counting the strikes it takes. */
  async function wait(index: number, hazards: Readonly<HazardPolicy>, seconds: number, opts: { lateral?: number; shield?: boolean; speed?: number } = {}): Promise<StrikeRun> {
    const bus = new EventBus<GameEvents>();
    const physics = await PhysicsSystem.create(spire, bus, { hazards });
    const k = physics.strikes[index];
    const ship = physics.addShip(SHIP_ROSTER[0], spire.startGrid[0]);
    physics.resetTime();
    const slot = spireSlot(k.u, opts.lateral ?? k.lateral);
    physics.resetShip(0, slot);
    ship.status = 'racing';
    if (opts.shield) ship.shield = 99;
    const run: StrikeRun = { hits: 0, blocked: 0, energyLost: 0, jam: 0, speedBefore: 0, speedAfter: 0, times: [] };
    bus.on('hazard:lightning', () => {
      run.hits++;
      run.times.push(physics.hazardTime);
    });
    bus.on('item:shield', (e) => {
      if (e.blocked === 'lightning') run.blocked++;
    });
    const e0 = ship.energy;
    const controls = new Map<ShipId, ControlInput>();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(slot.quaternion);
    for (let i = 0; i < 120 * seconds; i++) {
      // Put the hull back on the point every step: it then sits in the circle whenever the bolt lands.
      physics.bodyOf(0)!.setTranslation(slot.position, true);
      ship.position.copy(slot.position);
      const hitsBefore = run.hits;
      if (opts.speed) ship.velocity.copy(fwd).multiplyScalar(opts.speed);
      controls.set(0, { throttle: 0, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
      const before = opts.speed ?? 0;
      physics.step(CONFIG.FIXED_DT, controls);
      if (run.hits > hitsBefore && run.hits === 1) {
        run.jam = ship.empLock;
        run.speedBefore = before;
        run.speedAfter = ship.speed;
      }
    }
    run.energyLost = e0 - ship.energy;
    physics.dispose();
    return run;
  }

  it('has two fields; every strike circle leaves the clear lane and the rails alone', () => {
    expect(fields.length).toBe(2);
    const strikes = buildStrikesOf(spire);
    expect(strikes.length).toBe(10);
    for (const f of fields) {
      if (f.type !== 'lightning') continue;
      const mine = strikes.filter((k) => k.d >= f.dStart && k.d <= f.dEnd);
      expect(mine.length).toBe(f.count);
      for (const k of mine) {
        expect(Math.abs(k.lateral - (f.lane ?? 0)) - STRIKE_RADIUS - CONFIG.SHIP_WIDTH / 2).toBeGreaterThanOrEqual(STRIKE_LANE_MARGIN - 1e-6);
        expect(Math.abs(k.lateral) + STRIKE_RADIUS).toBeLessThan(spire.halfWidth);
      }
      // Circles on both sides of the lane: the lane is a gap, not an empty half of the road.
      expect(mine.some((k) => k.lateral < (f.lane ?? 0))).toBe(true);
      expect(mine.some((k) => k.lateral > (f.lane ?? 0))).toBe(true);
    }
  });

  it('the circle warns before the bolt, twice as early in Rookie races, and the bolt time does not change', () => {
    const k = buildStrikesOf(spire)[0];
    let first = 0;
    while (!strikeActive(k, first)) first += 1 / 120;
    // Past the first bolt, find the next one.
    let t = first + STRIKE_TIME + 0.05;
    while (!strikeActive(k, t)) t += 1 / 120;
    expect(t - first).toBeCloseTo(k.period, 1);
    expect(strikeWarning(k, t - STRIKE_WARNING - 0.1)).toBe(0);
    expect(strikeWarning(k, t - STRIKE_WARNING / 2)).toBeCloseTo(0.5, 1);
    expect(strikeWarning(k, t - STRIKE_WARNING - 0.1, 2 * STRIKE_WARNING)).toBeGreaterThan(0);
    expect(strikeWarning(k, t + STRIKE_TIME / 2)).toBe(1);
  });

  it('a hull in the circle takes one hit per strike: energy and a boost jam (normal policy)', async () => {
    const period = (fields[0] as { period: number }).period;
    const r = await wait(0, HAZARDS_NORMAL, 2 * period + 0.5);
    console.log(`lightning normal: hits=${r.hits} at ${r.times.map((t) => t.toFixed(2)).join(', ')} s energyLost=${r.energyLost.toFixed(1)} jam=${r.jam.toFixed(2)} s`);
    expect(r.hits).toBe(2);
    expect(r.times[1] - r.times[0]).toBeCloseTo(period, 1);
    expect(r.energyLost).toBeCloseTo(2 * STRIKE_DAMAGE, 5);
    expect(r.jam).toBeCloseTo(STRIKE_JAM, 1);
  });

  it('under the Rookie policy a strike costs no energy, does not jam the boost, and slows the ship by the hit scale', async () => {
    const period = (fields[0] as { period: number }).period;
    const r = await wait(0, HAZARDS_ROOKIE, period + 0.5, { speed: 80 });
    console.log(`lightning rookie: hits=${r.hits} energyLost=${r.energyLost.toFixed(1)} jam=${r.jam} v ${r.speedBefore.toFixed(0)}→${r.speedAfter.toFixed(1)}`);
    expect(r.hits).toBe(1);
    expect(r.energyLost).toBe(0);
    expect(r.jam).toBe(0);
    expect(r.speedAfter).toBeLessThanOrEqual(r.speedBefore * HAZARDS_ROOKIE.hitSpeedScale + 1e-6);
    expect(r.speedAfter).toBeGreaterThan(r.speedBefore * HAZARDS_ROOKIE.hitSpeedScale - 2);
  });

  it('a raised Shield takes the strike and drops: no hit, no energy lost', async () => {
    const period = (fields[0] as { period: number }).period;
    const r = await wait(0, HAZARDS_NORMAL, period + 0.5, { shield: true });
    expect(r.blocked).toBe(1);
    expect(r.hits).toBe(0);
    expect(r.energyLost).toBe(0);
  });

  it('the clear lane is never struck, however long a ship stays on it', async () => {
    const f = fields[0] as { lane?: number; period: number };
    const r = await wait(0, HAZARDS_NORMAL, 3 * f.period, { lateral: f.lane ?? 0 });
    expect(r.hits).toBe(0);
    expect(r.energyLost).toBe(0);
  });

  it('the strikes run on physics time since the reset: the same wait takes the same hits at the same times', async () => {
    const a = await wait(3, HAZARDS_NORMAL, 12);
    const b = await wait(3, HAZARDS_NORMAL, 12);
    expect(a.hits).toBeGreaterThanOrEqual(2);
    expect(b.times).toEqual(a.times);
  });
});

/**
 * Cinder Forge's lava geysers. A vent glows, then erupts for GEYSER_TIME seconds: a hull that touches the column
 * takes one hit per eruption. Normal policy: a knock up off the road and GEYSER_DAMAGE energy; Rookie policy: no
 * energy lost, no knock, the slow-down. A raised Shield takes the hit instead. Every field leaves a clear lane, no
 * vent is on the Plunge, and the eruptions run on physics time since the reset.
 */
describe('Cinder Forge geysers', () => {
  const forge: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['cinder-forge'] });
  const fields = forge.features.filter((f) => f.type === 'geysers');

  function forgeSlot(u: number, lateral: number): GridSlot {
    const s = forge.sampleAt(u);
    const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
    const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
    return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
  }

  interface GeyserRun {
    hits: number;
    blocked: number;
    energyLost: number;
    /** Speed up the road's normal right after the first hit, and the speed just before and after it. */
    knock: number;
    speedBefore: number;
    speedAfter: number;
    /** Hazard time of each hit. */
    times: number[];
  }

  /** Hold a ship on vent `index` (or beside it at `lateral`) for `seconds`, counting the eruptions that hit it. */
  async function wait(index: number, hazards: Readonly<HazardPolicy>, seconds: number, opts: { lateral?: number; shield?: boolean; speed?: number } = {}): Promise<GeyserRun> {
    const bus = new EventBus<GameEvents>();
    const physics = await PhysicsSystem.create(forge, bus, { hazards });
    const g = physics.geysers[index];
    const ship = physics.addShip(SHIP_ROSTER[0], forge.startGrid[0]);
    physics.resetTime();
    const slot = forgeSlot(g.u, opts.lateral ?? g.lateral);
    physics.resetShip(0, slot);
    ship.status = 'racing';
    if (opts.shield) ship.shield = 99;
    const run: GeyserRun = { hits: 0, blocked: 0, energyLost: 0, knock: 0, speedBefore: 0, speedAfter: 0, times: [] };
    bus.on('hazard:geyser', () => {
      run.hits++;
      run.times.push(physics.hazardTime);
    });
    bus.on('item:shield', (e) => {
      if (e.blocked === 'geyser') run.blocked++;
    });
    const e0 = ship.energy;
    const controls = new Map<ShipId, ControlInput>();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(slot.quaternion);
    for (let i = 0; i < 120 * seconds; i++) {
      // Put the hull back on the vent every step: it then sits in the column for the whole eruption.
      physics.bodyOf(0)!.setTranslation(slot.position, true);
      ship.position.copy(slot.position);
      const hitsBefore = run.hits;
      ship.velocity.copy(fwd).multiplyScalar(opts.speed ?? 0);
      controls.set(0, { throttle: 0, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
      physics.step(CONFIG.FIXED_DT, controls);
      if (run.hits > hitsBefore && run.hits === 1) {
        run.knock = ship.velocity.dot(g.up);
        run.speedBefore = opts.speed ?? 0;
        run.speedAfter = ship.velocity.dot(fwd);
      }
    }
    run.energyLost = e0 - ship.energy;
    physics.dispose();
    return run;
  }

  it('has two fields on the rim; every vent leaves the clear lane and the rails alone, and none is on the Plunge', () => {
    expect(fields.length).toBe(2);
    const vents = buildGeysersOf(forge);
    expect(vents.length).toBe(10);
    const plunge = forge.features.find((f) => f.type === 'plunge')!;
    if (plunge.type !== 'plunge') throw new Error('no plunge');
    for (const f of fields) {
      if (f.type !== 'geysers') continue;
      const mine = vents.filter((g) => g.d >= f.dStart && g.d <= f.dEnd);
      expect(mine.length).toBe(f.count);
      for (const g of mine) {
        expect(Math.abs(g.lateral - (f.lane ?? 0)) - GEYSER_RADIUS - CONFIG.SHIP_WIDTH / 2).toBeGreaterThanOrEqual(GEYSER_LANE_MARGIN - 1e-6);
        expect(Math.abs(g.lateral) + GEYSER_RADIUS).toBeLessThan(forge.halfWidth);
        expect(g.d < plunge.dStart || g.d > plunge.dEnd).toBe(true);
        // On the level: the knock is straight up.
        expect(g.up.y).toBeGreaterThan(0.99);
      }
      expect(mine.some((g) => g.lateral < (f.lane ?? 0))).toBe(true);
      expect(mine.some((g) => g.lateral > (f.lane ?? 0))).toBe(true);
    }
  });

  it('the vent warns before it erupts, twice as early in Rookie races, and the eruption lasts GEYSER_TIME', () => {
    const g = buildGeysersOf(forge)[0];
    let first = 0;
    while (!geyserActive(g, first)) first += 1 / 120;
    let end = first;
    while (geyserActive(g, end)) end += 1 / 120;
    expect(end - first).toBeCloseTo(GEYSER_TIME, 1);
    let t = end + 0.05;
    while (!geyserActive(g, t)) t += 1 / 120;
    expect(t - first).toBeCloseTo(g.period, 1);
    expect(geyserWarning(g, t - GEYSER_WARNING - 0.1)).toBe(0);
    expect(geyserWarning(g, t - GEYSER_WARNING / 2)).toBeCloseTo(0.5, 1);
    expect(geyserWarning(g, t - GEYSER_WARNING - 0.1, 2 * GEYSER_WARNING)).toBeGreaterThan(0);
    expect(geyserWarning(g, t + GEYSER_TIME / 2)).toBe(1);
    expect(geyserProgress(g, t - 0.1)).toBe(0);
    expect(geyserProgress(g, t + GEYSER_TIME / 2)).toBeCloseTo(0.5, 1);
  });

  it('a hull on the vent takes one hit per eruption: a knock up and energy (normal policy)', async () => {
    const period = (fields[0] as { period: number }).period;
    const r = await wait(0, HAZARDS_NORMAL, 2 * period + 0.5);
    console.log(`geyser normal: hits=${r.hits} at ${r.times.map((t) => t.toFixed(2)).join(', ')} s energyLost=${r.energyLost.toFixed(1)} knock=${r.knock.toFixed(1)} m/s`);
    // The hull sits in the column for the whole 1.2 s of each eruption and is still hit only once.
    expect(r.hits).toBe(2);
    expect(r.times[1] - r.times[0]).toBeCloseTo(period, 1);
    expect(r.energyLost).toBeCloseTo(2 * GEYSER_DAMAGE, 5);
    expect(r.knock).toBeGreaterThan(GEYSER_KNOCK_UP - 2);
    expect(r.knock).toBeLessThanOrEqual(GEYSER_KNOCK_UP + 0.5);
  });

  it('under the Rookie policy an eruption costs no energy, does not knock the ship, and slows it by the hit scale', async () => {
    const period = (fields[0] as { period: number }).period;
    const r = await wait(0, HAZARDS_ROOKIE, period + 0.5, { speed: 80 });
    console.log(`geyser rookie: hits=${r.hits} energyLost=${r.energyLost.toFixed(1)} knock=${r.knock.toFixed(2)} v ${r.speedBefore.toFixed(0)}→${r.speedAfter.toFixed(1)}`);
    expect(r.hits).toBe(1);
    expect(r.energyLost).toBe(0);
    expect(Math.abs(r.knock)).toBeLessThan(1);
    expect(r.speedAfter).toBeLessThanOrEqual(r.speedBefore * HAZARDS_ROOKIE.hitSpeedScale + 1e-6);
    expect(r.speedAfter).toBeGreaterThan(r.speedBefore * HAZARDS_ROOKIE.hitSpeedScale - 2);
  });

  it('a raised Shield takes the eruption and drops: no hit, no energy lost', async () => {
    const period = (fields[0] as { period: number }).period;
    const r = await wait(0, HAZARDS_NORMAL, period + 0.5, { shield: true });
    expect(r.blocked).toBe(1);
    expect(r.hits).toBe(0);
    expect(r.energyLost).toBe(0);
  });

  it('the clear lane is never hit, however long a ship stays on it', async () => {
    const f = fields[0] as { lane?: number; period: number };
    const r = await wait(0, HAZARDS_NORMAL, 3 * f.period, { lateral: f.lane ?? 0 });
    expect(r.hits).toBe(0);
    expect(r.energyLost).toBe(0);
  });

  it('a ship knocked up by a geyser at racing speed comes back down on the road', async () => {
    const bus = new EventBus<GameEvents>();
    const physics = await PhysicsSystem.create(forge, bus, { hazards: HAZARDS_NORMAL });
    const g = physics.geysers[0];
    const ship = physics.addShip(SHIP_ROSTER[0], forge.startGrid[0]);
    physics.resetTime();
    // Let the hazard clock run until the hull, starting 100 m back on the straight, will reach the vent mid-eruption.
    const speed = 120;
    const runUp = 100;
    let t = runUp / speed;
    while (!geyserActive(g, t - GEYSER_TIME / 2) || !geyserActive(g, t + GEYSER_TIME / 4)) t += 1 / 120;
    const idle = new Map<ShipId, ControlInput>();
    for (let i = 0; i < Math.round((t - runUp / speed) * 120); i++) physics.step(CONFIG.FIXED_DT, idle);
    physics.resetShip(0, forgeSlot((g.d - runUp) / forge.length, g.lateral));
    ship.status = 'racing';
    ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(speed);
    let hits = 0;
    let after = 0;
    let respawns = 0;
    let rail = 0;
    let peak = 0;
    bus.on('hazard:geyser', () => hits++);
    bus.on('ship:respawn', () => respawns++);
    bus.on('ship:railHit', () => rail++);
    const controls = new Map<ShipId, ControlInput>();
    // The second after the hit is enough to see the ship settle (the straight ends not far past the field).
    for (let i = 0; i < 120 * (runUp / speed + 1); i++) {
      const over = ship.forwardSpeed - speed;
      controls.set(0, { throttle: Math.min(1, Math.max(0, 0.5 - over / 4)), brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
      physics.step(CONFIG.FIXED_DT, controls);
      if (hits === 0) continue;
      peak = Math.max(peak, ship.heightAboveTrack);
      // Half a second after the hit the hull has settled; stop before the next vent along the line.
      if (++after >= 60) break;
    }
    console.log(`geyser at ${speed} m/s: hits=${hits} peak height=${peak.toFixed(2)} m respawns=${respawns} rail=${rail} end height=${ship.heightAboveTrack.toFixed(2)} grounded=${ship.grounded}`);
    expect(hits).toBe(1);
    expect(respawns).toBe(0);
    expect(rail).toBe(0);
    // The magnetic lock holds the knock to a bump: the hull lifts a little and never leaves hover range.
    expect(peak).toBeGreaterThan(CONFIG.HOVER_HEIGHT + 0.15);
    expect(peak).toBeLessThan(CONFIG.HOVER_HEIGHT + 2);
    expect(ship.grounded).toBe(true);
    expect(Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT)).toBeLessThan(0.3);
    physics.dispose();
  });

  it('the eruptions run on physics time since the reset: the same wait takes the same hits at the same times', async () => {
    const a = await wait(3, HAZARDS_NORMAL, 12);
    const b = await wait(3, HAZARDS_NORMAL, 12);
    expect(a.hits).toBeGreaterThanOrEqual(2);
    expect(b.times).toEqual(a.times);
  });
});

/**
 * Abyss Line's pressure jets, on the Spine. A vent's bubble stream warns, then the jet fires for JET_TIME seconds: a
 * hull that touches it takes one hit per jet. Normal policy: a knock round the tube, away from the vent, and JET_DAMAGE
 * energy; Rookie policy: no energy lost, a smaller knock and the slow-down. A raised Shield takes the hit instead. Every
 * field leaves a clear lane, no vent is near the bottom seam, and the jets run on physics time since the reset.
 */
describe('Abyss Line pressure jets', () => {
  const abyss: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['abyss-line'] });
  const fields = abyss.features.filter((f) => f.type === 'jets');
  const spine = abyss.features.find((f) => f.type === 'spine')!;
  if (spine.type !== 'spine') throw new Error('no spine');

  /** A slot on the curled surface of the Spine at (u, lateral), aligned to it. */
  function tubeSlot(u: number, lateral: number): GridSlot {
    const s = abyss.sampleAt(u);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    abyss.surfacePoint(u, lateral, p, n);
    const right = new THREE.Vector3().crossVectors(s.forward, n);
    const m = new THREE.Matrix4().makeBasis(right, n, s.forward.clone().negate());
    return { u, lateral, position: p.addScaledVector(n, CONFIG.HOVER_HEIGHT), quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
  }

  /** The tube's direction of increasing lateral at (u, lateral): forward × the surface normal. */
  function aroundDir(u: number, lateral: number): THREE.Vector3 {
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    abyss.surfacePoint(u, lateral, p, n);
    return new THREE.Vector3().crossVectors(abyss.sampleAt(u).forward, n).normalize();
  }

  interface JetRun {
    hits: number;
    blocked: number;
    energyLost: number;
    /** Speed round the tube toward the field's clear lane right after the first hit, and the speed along before and after it. */
    knock: number;
    speedBefore: number;
    speedAfter: number;
    times: number[];
  }

  /** Hold a ship on vent `index` (or beside it at `lateral`) for `seconds`, counting the jets that hit it. */
  async function wait(index: number, hazards: Readonly<HazardPolicy>, seconds: number, opts: { lateral?: number; shield?: boolean; speed?: number } = {}): Promise<JetRun> {
    const bus = new EventBus<GameEvents>();
    const physics = await PhysicsSystem.create(abyss, bus, { hazards });
    const j = physics.jets[index];
    const ship = physics.addShip(SHIP_ROSTER[0], abyss.startGrid[0]);
    physics.resetTime();
    const slot = tubeSlot(j.u, opts.lateral ?? j.lateral);
    physics.resetShip(0, slot);
    ship.status = 'racing';
    if (opts.shield) ship.shield = 99;
    const run: JetRun = { hits: 0, blocked: 0, energyLost: 0, knock: 0, speedBefore: 0, speedAfter: 0, times: [] };
    bus.on('hazard:jet', () => {
      run.hits++;
      run.times.push(physics.hazardTime);
    });
    bus.on('item:shield', (e) => {
      if (e.blocked === 'jet') run.blocked++;
    });
    const e0 = ship.energy;
    const controls = new Map<ShipId, ControlInput>();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(slot.quaternion);
    const towardLane = aroundDir(j.u, j.lateral).multiplyScalar(Math.sign((j.lane ?? 0) - j.lateral) || 1);
    for (let i = 0; i < 120 * seconds; i++) {
      physics.bodyOf(0)!.setTranslation(slot.position, true);
      ship.position.copy(slot.position);
      const hitsBefore = run.hits;
      ship.velocity.copy(fwd).multiplyScalar(opts.speed ?? 0);
      controls.set(0, { throttle: 0, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
      physics.step(CONFIG.FIXED_DT, controls);
      if (run.hits > hitsBefore && run.hits === 1) {
        run.knock = ship.velocity.dot(towardLane);
        run.speedBefore = opts.speed ?? 0;
        run.speedAfter = ship.velocity.dot(fwd);
      }
    }
    run.energyLost = e0 - ship.energy;
    physics.dispose();
    return run;
  }

  it('has two fields on the closed Spine; every vent leaves the clear lane and the seam alone, on the tube', () => {
    expect(fields.length).toBe(2);
    const vents = buildJetsOf(abyss);
    expect(vents.length).toBe(8);
    const W = abyss.halfWidth;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const f of fields) {
      if (f.type !== 'jets') continue;
      expect(f.dStart).toBeGreaterThanOrEqual(spine.dStart + spine.transition);
      expect(f.dEnd).toBeLessThanOrEqual(spine.dEnd - spine.transition);
      const mine = vents.filter((j) => j.d >= f.dStart && j.d <= f.dEnd);
      expect(mine.length).toBe(f.count);
      for (const j of mine) {
        expect(Math.abs(j.lateral - (f.lane ?? 0)) - JET_RADIUS - CONFIG.SHIP_WIDTH / 2).toBeGreaterThanOrEqual(JET_LANE_MARGIN - 1e-6);
        expect(Math.abs(j.lateral)).toBeLessThanOrEqual(W - jetSeamGap() + 1e-6);
        // The vent sits on the curled surface and fires straight out of the tube.
        abyss.surfacePoint(j.u, j.lateral, p, n);
        expect(j.position.distanceTo(p)).toBeLessThan(1e-6);
        expect(j.up.dot(n)).toBeGreaterThan(0.999);
      }
      expect(mine.some((j) => j.lateral < (f.lane ?? 0))).toBe(true);
      expect(mine.some((j) => j.lateral > (f.lane ?? 0))).toBe(true);
    }
  });

  it('the bubble stream warns before the jet, twice as early in Rookie races, and the jet lasts JET_TIME', () => {
    const j = buildJetsOf(abyss)[0];
    let first = 0;
    while (!jetActive(j, first)) first += 1 / 120;
    let end = first;
    while (jetActive(j, end)) end += 1 / 120;
    expect(end - first).toBeCloseTo(JET_TIME, 1);
    let t = end + 0.05;
    while (!jetActive(j, t)) t += 1 / 120;
    expect(t - first).toBeCloseTo(j.period, 1);
    expect(jetWarning(j, t - JET_WARNING - 0.1)).toBe(0);
    expect(jetWarning(j, t - JET_WARNING / 2)).toBeCloseTo(0.5, 1);
    expect(jetWarning(j, t - JET_WARNING - 0.1, 2 * JET_WARNING)).toBeGreaterThan(0);
    expect(jetWarning(j, t + JET_TIME / 2)).toBe(1);
    expect(jetProgress(j, t - 0.1)).toBe(0);
    expect(jetProgress(j, t + JET_TIME / 2)).toBeCloseTo(0.5, 1);
  });

  it('a hull on the vent takes one hit per jet: a knock round the tube and energy (normal policy)', async () => {
    const period = (fields[0] as { period: number }).period;
    const r = await wait(0, HAZARDS_NORMAL, 2 * period + 0.5);
    console.log(`jet normal: hits=${r.hits} at ${r.times.map((t) => t.toFixed(2)).join(', ')} s energyLost=${r.energyLost.toFixed(1)} knock=${r.knock.toFixed(1)} m/s`);
    expect(r.hits).toBe(2);
    expect(r.times[1] - r.times[0]).toBeCloseTo(period, 1);
    expect(r.energyLost).toBeCloseTo(2 * JET_DAMAGE, 5);
    // Round the tube (toward the clear lane, for a hull right on the vent), × pushScale (1 for this ship).
    expect(r.knock).toBeGreaterThan(JET_KNOCK - 2);
    expect(r.knock).toBeLessThanOrEqual(JET_KNOCK + 0.5);
  });

  it('under the Rookie policy a jet costs no energy, knocks the ship less and slows it by the hit scale', async () => {
    const period = (fields[0] as { period: number }).period;
    const r = await wait(0, HAZARDS_ROOKIE, period + 0.5, { speed: 80 });
    console.log(`jet rookie: hits=${r.hits} energyLost=${r.energyLost.toFixed(1)} knock=${r.knock.toFixed(2)} v ${r.speedBefore.toFixed(0)}→${r.speedAfter.toFixed(1)}`);
    expect(r.hits).toBe(1);
    expect(r.energyLost).toBe(0);
    expect(r.knock).toBeGreaterThan(JET_KNOCK_ROOKIE - 1.5);
    expect(r.knock).toBeLessThanOrEqual(JET_KNOCK_ROOKIE + 0.5);
    expect(r.speedAfter).toBeLessThanOrEqual(r.speedBefore * HAZARDS_ROOKIE.hitSpeedScale + 1e-6);
    expect(r.speedAfter).toBeGreaterThan(r.speedBefore * HAZARDS_ROOKIE.hitSpeedScale - 2);
  });

  it('a raised Shield takes the jet and drops: no hit, no energy lost', async () => {
    const period = (fields[0] as { period: number }).period;
    const r = await wait(0, HAZARDS_NORMAL, period + 0.5, { shield: true });
    expect(r.blocked).toBe(1);
    expect(r.hits).toBe(0);
    expect(r.energyLost).toBe(0);
  });

  it('the clear lane is never hit, however long a ship stays on it', async () => {
    const f = fields[0] as { lane?: number; period: number };
    const r = await wait(0, HAZARDS_NORMAL, 3 * f.period, { lateral: f.lane ?? 0 });
    expect(r.hits).toBe(0);
    expect(r.energyLost).toBe(0);
  });

  /**
   * Drive at `speed` with no steer over vent 0, timed so its jet fires as the hull passes (or, for the control run,
   * half a period later, so it is idle). Returns the lateral 0.5 s after reaching the column and what the hit did.
   */
  async function passVent(fire: boolean, speed: number) {
    const bus = new EventBus<GameEvents>();
    const physics = await PhysicsSystem.create(abyss, bus, { hazards: HAZARDS_NORMAL });
    const j = physics.jets[0];
    const ship = physics.addShip(SHIP_ROSTER[0], abyss.startGrid[0]);
    physics.resetTime();
    const runUp = 60;
    let t = runUp / speed;
    while (!jetActive(j, t - JET_TIME / 2) || !jetActive(j, t + JET_TIME / 4)) t += 1 / 120;
    if (!fire) t += j.period / 2;
    const idle = new Map<ShipId, ControlInput>();
    for (let i = 0; i < Math.round((t - runUp / speed) * 120); i++) physics.step(CONFIG.FIXED_DT, idle);
    physics.resetShip(0, tubeSlot((j.d - runUp) / abyss.length, j.lateral));
    ship.status = 'racing';
    ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(speed);
    const towardLane = Math.sign((j.lane ?? 0) - j.lateral) || 1;
    const out = { hits: 0, respawns: 0, worst: 0, knock: 0, latAtVent: 0, latAfter: 0, grounded: false, towardLane };
    bus.on('hazard:jet', () => {
      out.hits++;
      out.knock = ship.velocity.dot(aroundDir(ship.trackU, ship.lateral)) * towardLane;
    });
    bus.on('ship:respawn', () => out.respawns++);
    const controls = new Map<ShipId, ControlInput>();
    let after = -1;
    for (let i = 0; i < 120 * (runUp / speed + 1.5); i++) {
      const over = ship.forwardSpeed - speed;
      controls.set(0, { throttle: Math.min(1, Math.max(0, 0.5 - over / 4)), brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
      physics.step(CONFIG.FIXED_DT, controls);
      // Measure from just before the hull can touch the column (its radius and half a hull length ahead of the vent).
      if (after < 0 && ship.trackU * abyss.length >= j.d - JET_RADIUS - 4) {
        after = 0;
        out.latAtVent = ship.lateral;
      }
      if (after < 0) continue;
      out.worst = Math.max(out.worst, Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT));
      if (++after >= 60) break;
    }
    out.latAfter = ship.lateral;
    out.grounded = ship.grounded;
    physics.dispose();
    return out;
  }

  it('a ship knocked by a jet at racing speed takes the full knock, moves toward the lane, stays on the tube and settles', async () => {
    const speed = 120;
    const hit = await passVent(true, speed);
    const control = await passVent(false, speed);
    // How much further toward the clear lane the hit ship is, 0.5 s on, than the same pass with the vent idle.
    const gained = ((hit.latAfter - hit.latAtVent) - (control.latAfter - control.latAtVent)) * hit.towardLane;
    console.log(
      `jet at ${speed} m/s: hits=${hit.hits} knock=${hit.knock.toFixed(1)} m/s heightErr=${hit.worst.toFixed(2)} ` +
        `lateral ${hit.latAtVent.toFixed(2)}→${hit.latAfter.toFixed(2)} (idle vent ${control.latAtVent.toFixed(2)}→${control.latAfter.toFixed(2)}) ` +
        `gained=${gained.toFixed(2)} m respawns=${hit.respawns} grounded=${hit.grounded}`,
    );
    expect(hit.hits).toBe(1);
    expect(control.hits).toBe(0);
    expect(hit.respawns + control.respawns).toBe(0);
    // The full knock at speed, as at rest (the speed along the track does not eat it).
    expect(hit.knock).toBeGreaterThan(JET_KNOCK - 2);
    // Lateral grip bleeds the knock off in about a tenth of a second, so the ship is moved, not flung: toward the lane,
    // by at least half a metre more than the idle pass, and no more than the tube's half-width.
    expect(gained).toBeGreaterThan(0.5);
    expect(gained).toBeLessThan(abyss.halfWidth);
    expect(hit.worst).toBeLessThan(0.6);
    expect(hit.grounded).toBe(true);
  });

  it('the jets run on physics time since the reset: the same wait takes the same hits at the same times', async () => {
    const a = await wait(5, HAZARDS_NORMAL, 12);
    const b = await wait(5, HAZARDS_NORMAL, 12);
    expect(a.hits).toBeGreaterThanOrEqual(2);
    expect(b.times).toEqual(a.times);
  });
});
