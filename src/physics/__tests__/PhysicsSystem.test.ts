import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { COLLISION, CONFIG, SHIP_ROSTER } from '../../core/config';
import type { ControlInput, GridSlot, ShipId, ShipState, TrackData } from '../../core/contracts';
import { neutralControls } from '../../core/controls';
import { EventBus, type GameEvents } from '../../core/events';
import { PhysicsSystem } from '../PhysicsSystem';
import { makeSyntheticTrack } from './syntheticTrack';

const DT = CONFIG.FIXED_DT;
const STEPS_PER_SECOND = Math.round(1 / DT);

type EventLog = { [K in keyof GameEvents]: GameEvents[K][] };

interface Rig {
  track: TrackData;
  physics: PhysicsSystem;
  events: EventLog;
}

const rigs: Rig[] = [];

async function makeRig(track: TrackData = makeSyntheticTrack()): Promise<Rig> {
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus);
  const events: EventLog = {
    'race:state': [],
    'race:countdown': [],
    'race:lap': [],
    'race:finish': [],
    'race:results': [],
    'audio:mute': [],
    'economy:credits': [],
    'ship:railHit': [],
    'ship:shipHit': [],
    'ship:boost': [],
    'ship:dash': [],
    'ship:pit': [],
    'ship:lowEnergy': [],
    'ship:jump': [],
    'ship:land': [],
    'ship:destroyed': [],
    'ship:respawn': [],
  };
  const subscribe = <K extends keyof GameEvents>(k: K) => bus.on(k, (p) => events[k].push(p));
  (Object.keys(events) as Array<keyof GameEvents>).forEach((k) => subscribe(k));
  const rig = { track, physics, events };
  rigs.push(rig);
  return rig;
}

afterEach(() => {
  while (rigs.length) rigs.pop()!.physics.dispose();
});

function controls(id: ShipId, c: Partial<ControlInput>): Map<ShipId, ControlInput> {
  return new Map([[id, { ...neutralControls(), ...c }]]);
}

/** Steering that keeps a ship on the centerline (or a lateral target) of the circular synthetic track. */
function autoSteer(ship: ShipState, track: TrackData, lateralTarget = 0): number {
  const smp = track.sampleAt(ship.trackU);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
  const cross = new THREE.Vector3().crossVectors(fwd, smp.forward);
  const err = Math.asin(THREE.MathUtils.clamp(cross.dot(smp.up), -1, 1)) + 0.012 * (ship.lateral - lateralTarget);
  return THREE.MathUtils.clamp(-3 * err, -1, 1);
}

function addRacer(rig: Rig, index = 0, mutate?: (slot: GridSlot) => GridSlot): ShipState {
  const def = SHIP_ROSTER[index];
  let slot = rig.track.startGrid[def.gridIndex];
  if (mutate) slot = mutate(slot);
  return rig.physics.addShip(def, slot);
}

function drive(rig: Rig, ship: ShipState, seconds: number, c: Partial<ControlInput> = { throttle: 1 }): void {
  for (let i = 0; i < Math.round(seconds * STEPS_PER_SECOND); i++) {
    rig.physics.step(DT, controls(ship.def.id, { ...c, steer: autoSteer(ship, rig.track) }));
  }
}

describe('PhysicsSystem hover', () => {
  it('settles a ship on the grid at HOVER_HEIGHT within 2 s (from a 3 m drop)', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig, 0, (slot) => ({ ...slot, position: slot.position.clone().add(new THREE.Vector3(0, 3, 0)) }));
    const start = ship.position.clone();
    for (let i = 0; i < 2 * STEPS_PER_SECOND; i++) rig.physics.step(DT, new Map());
    expect(ship.status).toBe('grid');
    expect(Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT)).toBeLessThan(0.15);
    expect(ship.grounded).toBe(true);
    // Grid ships stay put in the surface plane.
    expect(Math.hypot(ship.position.x - start.x, ship.position.z - start.z)).toBeLessThan(0.05);
    expect(ship.speed).toBeLessThan(0.5);
  });

  it('holds the slot height when spawned on the slot', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    for (let i = 0; i < 2 * STEPS_PER_SECOND; i++) rig.physics.step(DT, new Map());
    expect(Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT)).toBeLessThan(0.05);
  });

  it('initialises ShipState per contract', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    expect(ship.status).toBe('grid');
    expect(ship.boostUnlocked).toBe(false);
    expect(ship.thrustScale).toBe(1);
    expect(ship.energy).toBe(CONFIG.ENERGY_MAX);
    expect(rig.physics.ships).toContain(ship);
    expect(() => addRacer(rig)).toThrow();
  });

  it('copies pose into prev* before simulating', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    drive(rig, ship, 0.5);
    const before = ship.position.clone();
    drive(rig, ship, DT);
    expect(ship.prevPosition.distanceTo(before)).toBeLessThan(1e-9);
    expect(ship.position.distanceTo(before)).toBeGreaterThan(0.05);
  });
});

describe('PhysicsSystem propulsion', () => {
  it('approaches TOP_SPEED on full throttle without exceeding it by more than 2%', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    let maxSpeed = 0;
    let lastEnergy = ship.energy;
    for (let i = 0; i < 25 * STEPS_PER_SECOND; i++) {
      rig.physics.step(DT, controls(0, { throttle: 1, steer: autoSteer(ship, rig.track) }));
      maxSpeed = Math.max(maxSpeed, ship.speed);
      expect(ship.energy).toBeLessThanOrEqual(lastEnergy);
      lastEnergy = ship.energy;
    }
    expect(maxSpeed).toBeLessThanOrEqual(CONFIG.TOP_SPEED * 1.02);
    expect(ship.speed).toBeGreaterThan(CONFIG.TOP_SPEED * 0.95);
    expect(ship.forwardSpeed).toBeGreaterThan(CONFIG.TOP_SPEED * 0.9);
    expect(Math.abs(ship.lateral)).toBeLessThan(CONFIG.TRACK_HALF_WIDTH);
    expect(Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT)).toBeLessThan(0.6);
    expect(rig.events['ship:respawn']).toHaveLength(0);
    expect(rig.events['ship:railHit']).toHaveLength(0);
    expect(ship.energy).toBe(CONFIG.ENERGY_MAX);
  });

  it('scales top speed with thrustScale', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    ship.thrustScale = 0.9;
    drive(rig, ship, 25);
    expect(ship.speed).toBeLessThan(CONFIG.TOP_SPEED * 0.9 * 1.02);
    expect(ship.speed).toBeGreaterThan(CONFIG.TOP_SPEED * 0.9 * 0.93);
  });

  it('caps a finished ship below full-throttle speed', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'finished';
    drive(rig, ship, 25);
    expect(ship.speed).toBeLessThan(CONFIG.TOP_SPEED * 0.9);
    expect(ship.speed).toBeGreaterThan(20);
  });

  it('brakes to a stop without reversing', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    drive(rig, ship, 6);
    expect(ship.forwardSpeed).toBeGreaterThan(60);
    drive(rig, ship, 6, { brake: 1 });
    expect(ship.forwardSpeed).toBeGreaterThanOrEqual(-0.5);
    expect(ship.speed).toBeLessThan(1);
  });

  it('ignores controls and holds position on the grid', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    const start = ship.position.clone();
    for (let i = 0; i < STEPS_PER_SECOND; i++) rig.physics.step(DT, controls(0, { throttle: 1, steer: 1 }));
    expect(ship.position.distanceTo(start)).toBeLessThan(0.05);
  });

  it('banks into a right turn and leans away with a left air-brake (bank > 0 = right side dips)', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    drive(rig, ship, 4);
    for (let i = 0; i < 60; i++) rig.physics.step(DT, controls(0, { throttle: 1, steer: 1 }));
    expect(ship.bank).toBeGreaterThan(0.3);
    for (let i = 0; i < 120; i++) {
      rig.physics.step(DT, controls(0, { throttle: 1, steer: 0, airbrakeLeft: 1 }));
    }
    expect(ship.bank).toBeLessThan(0);
  });

  it('boost costs energy once, raises speed above TOP_SPEED, and never gains energy outside a pit', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    ship.boostUnlocked = true;
    let lastEnergy = ship.energy;
    let maxSpeed = 0;
    for (let i = 0; i < 12 * STEPS_PER_SECOND; i++) {
      const press = i === 8 * STEPS_PER_SECOND; // single-sample edge
      rig.physics.step(DT, controls(0, { throttle: 1, boost: press, steer: autoSteer(ship, rig.track) }));
      maxSpeed = Math.max(maxSpeed, ship.speed);
      expect(ship.energy).toBeLessThanOrEqual(lastEnergy + 1e-9);
      lastEnergy = ship.energy;
    }
    expect(rig.events['ship:boost']).toHaveLength(1);
    expect(ship.energy).toBeCloseTo(CONFIG.ENERGY_MAX - CONFIG.BOOST_COST, 5);
    expect(maxSpeed).toBeGreaterThan(CONFIG.TOP_SPEED * 1.12);
    expect(maxSpeed).toBeLessThanOrEqual(CONFIG.BOOST_TOP_SPEED * 1.02);
  });

  it('ignores boost while locked', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    rig.physics.step(DT, controls(0, { throttle: 1, boost: true }));
    rig.physics.step(DT, controls(0, { throttle: 1, boost: false }));
    expect(rig.events['ship:boost']).toHaveLength(0);
    expect(ship.energy).toBe(CONFIG.ENERGY_MAX);
  });

  it('fires a held boost request once when it becomes possible (one activation per hold)', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    for (let i = 0; i < 30; i++) rig.physics.step(DT, controls(0, { throttle: 1, boost: true }));
    expect(rig.events['ship:boost']).toHaveLength(0);
    ship.boostUnlocked = true;
    for (let i = 0; i < STEPS_PER_SECOND * 4; i++) rig.physics.step(DT, controls(0, { throttle: 1, boost: true }));
    expect(rig.events['ship:boost']).toHaveLength(1);
  });
});

describe('PhysicsSystem zones', () => {
  it('recharges energy inside the pit zone only, with pit events', async () => {
    const u = makeSyntheticTrack().startGrid[3].u;
    const rig = await makeRig(
      makeSyntheticTrack({ zones: [{ type: 'pit', uStart: u - 0.002, uEnd: u + 0.002, lateralMin: -13, lateralMax: 13 }] }),
    );
    const ship = addRacer(rig);
    ship.status = 'racing';
    ship.energy = 40;
    for (let i = 0; i < STEPS_PER_SECOND; i++) rig.physics.step(DT, controls(0, {}));
    expect(ship.inPit).toBe(true);
    expect(ship.energy).toBeGreaterThan(40 + CONFIG.PIT_RECHARGE_RATE * 0.9);
    for (let i = 0; i < 20 * STEPS_PER_SECOND; i++) rig.physics.step(DT, controls(0, {}));
    expect(ship.energy).toBe(CONFIG.ENERGY_MAX);
    expect(rig.events['ship:pit'][0]).toEqual({ shipId: 0, active: true });
  });

  it('does not recharge outside the pit zone', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    ship.energy = 40;
    drive(rig, ship, 3);
    expect(ship.inPit).toBe(false);
    expect(ship.energy).toBe(40);
  });

  it('applies the dash impulse once per entry', async () => {
    const u = makeSyntheticTrack().startGrid[3].u;
    const rig = await makeRig(
      makeSyntheticTrack({ zones: [{ type: 'dash', uStart: u + 0.0004, uEnd: u + 0.0016, lateralMin: -13, lateralMax: 13 }] }),
    );
    const ship = addRacer(rig);
    ship.status = 'racing';
    for (let i = 0; i < 8 * STEPS_PER_SECOND && rig.events['ship:dash'].length === 0; i++) {
      rig.physics.step(DT, controls(0, { throttle: 1, steer: autoSteer(ship, rig.track) }));
    }
    expect(rig.events['ship:dash']).toHaveLength(1);
    expect(ship.onDash).toBe(true);
    drive(rig, ship, 3);
    expect(rig.events['ship:dash']).toHaveLength(1);
    expect(ship.onDash).toBe(false);
  });
});

describe('PhysicsSystem collisions', () => {
  it('bounces off the rail, drains energy, and emits railHit with a wall-facing normal', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    // Drive gently toward the right rail (right = toward the circle centre).
    for (let i = 0; i < 12 * STEPS_PER_SECOND; i++) {
      const steer = ship.speed < 40 ? 0 : 0.35;
      rig.physics.step(DT, controls(0, { throttle: 0.7, steer }));
      if (rig.events['ship:railHit'].length > 0 && i > 300) break;
    }
    expect(rig.events['ship:railHit'].length).toBeGreaterThan(0);
    expect(ship.energy).toBeLessThan(CONFIG.ENERGY_MAX);
    expect(ship.energy).toBeGreaterThanOrEqual(0);
    const hit = rig.events['ship:railHit'][0];
    expect(hit.intensity).toBeGreaterThan(0);
    expect(hit.intensity).toBeLessThanOrEqual(1);
    // Normal points from the wall to the ship: for the right wall that is along -right.
    const smp = rig.track.sampleAt(ship.trackU);
    expect(hit.normal.dot(smp.right)).toBeLessThan(-0.7);
    expect(Math.abs(ship.lateral)).toBeLessThan(CONFIG.TRACK_HALF_WIDTH + 1);
    expect(rig.events['ship:respawn']).toHaveLength(0);
  });

  it('keeps the ship inside the rails when grinding along the wall at speed', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    let maxLateral = 0;
    for (let i = 0; i < 20 * STEPS_PER_SECOND; i++) {
      // Steer hard right for the first 8 s, then follow the wall.
      const steer = ship.speed < 40 ? 0 : 0.3;
      rig.physics.step(DT, controls(0, { throttle: 1, steer }));
      maxLateral = Math.max(maxLateral, Math.abs(ship.lateral));
    }
    expect(maxLateral).toBeLessThan(CONFIG.TRACK_HALF_WIDTH + 1.5);
    expect(rig.events['ship:respawn']).toHaveLength(0);
    expect(Number.isFinite(ship.position.x + ship.position.y + ship.position.z)).toBe(true);
  });

  it('never drops energy below zero and throttles scrape events', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    ship.energy = 3;
    const seconds = 10;
    for (let i = 0; i < seconds * STEPS_PER_SECOND; i++) rig.physics.step(DT, controls(0, { throttle: 1, steer: 0.25 }));
    expect(ship.energy).toBe(0);
    expect(rig.events['ship:railHit'].length).toBeLessThanOrEqual(seconds * 15 + 25);
  });

  it('emits lowEnergy once when crossing the threshold', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    ship.energy = CONFIG.LOW_ENERGY_THRESHOLD + 2;
    for (let i = 0; i < 10 * STEPS_PER_SECOND; i++) rig.physics.step(DT, controls(0, { throttle: 1, steer: 0.3 }));
    expect(rig.events['ship:lowEnergy']).toHaveLength(1);
  });

  it('detects ship-ship contact, damages both ships and emits shipHit', async () => {
    const rig = await makeRig();
    const a = addRacer(rig, 0);
    const bDef = SHIP_ROSTER[1];
    const aSlot = rig.track.startGrid[SHIP_ROSTER[0].gridIndex];
    // Park B directly ahead of A in the same lane.
    const s = rig.track.sampleAt(aSlot.u + 12 / rig.track.length);
    const bSlot: GridSlot = {
      u: s.u,
      lateral: aSlot.lateral,
      position: s.position.clone().addScaledVector(s.right, aSlot.lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT),
      quaternion: aSlot.quaternion.clone(),
    };
    const b = rig.physics.addShip(bDef, bSlot);
    a.status = 'racing';
    b.status = 'racing';
    const map = new Map<ShipId, ControlInput>();
    for (let i = 0; i < 4 * STEPS_PER_SECOND; i++) {
      map.set(0, { ...neutralControls(), throttle: 1, steer: autoSteer(a, rig.track, aSlot.lateral) });
      map.set(1, neutralControls());
      rig.physics.step(DT, map);
    }
    expect(rig.events['ship:shipHit'].length).toBeGreaterThan(0);
    expect(a.energy).toBeLessThan(CONFIG.ENERGY_MAX);
    expect(b.energy).toBeLessThan(CONFIG.ENERGY_MAX);
    // They must not have merged.
    expect(a.position.distanceTo(b.position)).toBeGreaterThan(CONFIG.SHIP_WIDTH * 0.8);
  });

  it('retired ships lose their collider and freeze; resetShip restores everything', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    drive(rig, ship, 3);
    expect(ship.speed).toBeGreaterThan(30);
    ship.status = 'retired';
    rig.physics.step(DT, controls(0, { throttle: 1 }));
    expect(rig.physics.colliderOf(0)!.isEnabled()).toBe(false);
    const frozenAt = ship.position.clone();
    for (let i = 0; i < 60; i++) rig.physics.step(DT, controls(0, { throttle: 1, steer: 1 }));
    expect(ship.speed).toBe(0);
    expect(ship.position.distanceTo(frozenAt)).toBeLessThan(0.01);

    ship.energy = 10;
    ship.boosting = true;
    ship.status = 'grid';
    const slot = rig.track.startGrid[SHIP_ROSTER[0].gridIndex];
    rig.physics.resetShip(0, slot);
    expect(rig.physics.colliderOf(0)!.isEnabled()).toBe(true);
    expect(ship.energy).toBe(CONFIG.ENERGY_MAX);
    expect(ship.boosting).toBe(false);
    expect(ship.speed).toBe(0);
    expect(ship.position.distanceTo(slot.position)).toBeLessThan(1e-6);
    expect(ship.prevPosition.distanceTo(slot.position)).toBeLessThan(1e-6);
    for (let i = 0; i < STEPS_PER_SECOND; i++) rig.physics.step(DT, new Map());
    expect(Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT)).toBeLessThan(0.05);
  });

  it('respawns a ship that leaves the track and emits ship:respawn', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    ship.status = 'racing';
    drive(rig, ship, 3);
    const fwdSpeedBefore = ship.forwardSpeed;
    // Simulate falling out of the world: teleport the body 30 m below the surface.
    rig.physics.bodyOf(0)!.setTranslation({ x: ship.position.x, y: ship.position.y - 30, z: ship.position.z }, true);
    let respawned = false;
    for (let i = 0; i < 2 * STEPS_PER_SECOND && !respawned; i++) {
      rig.physics.step(DT, controls(0, { throttle: 0 }));
      respawned = rig.events['ship:respawn'].length > 0;
    }
    expect(respawned).toBe(true);
    expect(rig.events['ship:respawn'][0]).toEqual({ shipId: 0 });
    expect(Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT)).toBeLessThan(0.3);
    expect(Math.abs(ship.lateral)).toBeLessThan(1);
    expect(ship.forwardSpeed).toBeLessThan(fwdSpeedBefore * 0.5);
  });
});

describe('PhysicsSystem banked track and airborne recovery', () => {
  it('holds a 50 degree banked loop at speed (magnet gravity + up alignment)', async () => {
    const rig = await makeRig(makeSyntheticTrack({ bank: (50 * Math.PI) / 180, radius: 400 }));
    const ship = addRacer(rig);
    ship.status = 'racing';
    let worstHeight = 0;
    for (let i = 0; i < 25 * STEPS_PER_SECOND; i++) {
      rig.physics.step(DT, controls(0, { throttle: 1, steer: autoSteer(ship, rig.track) }));
      worstHeight = Math.max(worstHeight, Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT));
    }
    expect(ship.speed).toBeGreaterThan(CONFIG.TOP_SPEED * 0.9);
    expect(worstHeight).toBeLessThan(1.0);
    expect(Math.abs(ship.lateral)).toBeLessThan(CONFIG.TRACK_HALF_WIDTH);
    expect(rig.events['ship:respawn']).toHaveLength(0);
    // Body up follows the banked surface normal.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quaternion);
    expect(up.dot(rig.track.sampleAt(ship.trackU).up)).toBeGreaterThan(0.99);
  });

  it('recovers from a 15 m fall (rays out of range) via track-normal magnet gravity', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig, 0, (slot) => ({ ...slot, position: slot.position.clone().add(new THREE.Vector3(0, 15, 0)) }));
    let sawAirborne = false;
    for (let i = 0; i < 5 * STEPS_PER_SECOND; i++) {
      rig.physics.step(DT, new Map());
      if (!ship.grounded) sawAirborne = true;
    }
    expect(sawAirborne).toBe(true);
    expect(Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT)).toBeLessThan(0.15);
    expect(rig.events['ship:respawn']).toHaveLength(0);
  });
});

describe('collision-group matrix in real Rapier', () => {
  it('hover rays hit the surface (not the rails) and rail probes hit only rails', async () => {
    const rig = await makeRig();
    const { world, surfaceCollider, railCollider } = rig.physics;
    const s = rig.track.sampleAt(0.2);
    const down = { x: -s.up.x, y: -s.up.y, z: -s.up.z };

    // Above the driving surface: the hover-ray filter finds the surface.
    const origin = s.position.clone().addScaledVector(s.up, 5);
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, down);
    const hit = world.castRayAndGetNormal(ray, CONFIG.HOVER_RAY_LENGTH, true, undefined, COLLISION.HOVER_RAY);
    expect(hit).not.toBeNull();
    expect(hit!.collider.handle).toBe(surfaceCollider.handle);
    expect(hit!.timeOfImpact).toBeCloseTo(5, 2);
    expect(Math.abs(hit!.normal.y)).toBeCloseTo(1, 3);

    // Straight down through the rail top: the hover filter must not see it, the rail probe must.
    const railTop = s.position
      .clone()
      .addScaledVector(s.right, CONFIG.TRACK_HALF_WIDTH + CONFIG.RAIL_THICKNESS / 2)
      .addScaledVector(s.up, CONFIG.RAIL_HEIGHT + 3);
    const railRay = new RAPIER.Ray({ x: railTop.x, y: railTop.y, z: railTop.z }, down);
    expect(world.castRayAndGetNormal(railRay, 20, true, undefined, COLLISION.HOVER_RAY)).toBeNull();
    const railHit = world.castRayAndGetNormal(railRay, 20, true, undefined, COLLISION.RAIL_RAY);
    expect(railHit).not.toBeNull();
    expect(railHit!.collider.handle).toBe(railCollider.handle);

    // Sideways at hover height toward the wall.
    const side = s.position.clone().addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
    const sideRay = new RAPIER.Ray({ x: side.x, y: side.y, z: side.z }, { x: s.right.x, y: s.right.y, z: s.right.z });
    expect(world.castRayAndGetNormal(sideRay, 30, true, undefined, COLLISION.HOVER_RAY)).toBeNull();
    const wall = world.castRayAndGetNormal(sideRay, 30, true, undefined, COLLISION.RAIL_RAY);
    expect(wall).not.toBeNull();
    expect(wall!.timeOfImpact).toBeCloseTo(CONFIG.TRACK_HALF_WIDTH, 1);
  });

  it('ships never generate contacts with the surface collider', async () => {
    const rig = await makeRig();
    const ship = addRacer(rig);
    for (let i = 0; i < 2 * STEPS_PER_SECOND; i++) rig.physics.step(DT, new Map());
    let contacts = 0;
    rig.physics.world.contactPair(rig.physics.colliderOf(0)!, rig.physics.surfaceCollider, () => contacts++);
    expect(contacts).toBe(0);
    expect(ship.grounded).toBe(true);
  });
});
