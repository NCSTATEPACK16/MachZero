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
