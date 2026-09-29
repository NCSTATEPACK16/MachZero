import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../core/config';
import type { AIPersonality, ControlInput, ShipState, TrackData } from '../../core/contracts';
import { wrapAngle } from '../../core/math';
import { AIDriver } from '../AIDriver';
import { makeCircleTrack, makeShip, placeShip } from './helpers';

function racingShip(track: TrackData, u: number, lateral: number, yaw: number, speed = 60): ShipState {
  const s = makeShip(1, false, 'steady');
  placeShip(s, track, u, lateral, yaw);
  s.status = 'racing';
  s.speed = speed;
  s.forwardSpeed = speed;
  return s;
}

describe('AIDriver steering', () => {
  it('steers right (positive) when the target lies to the right', () => {
    const track = makeCircleTrack(400, 1); // right-hand circle
    const ship = racingShip(track, 0.1, 0, 0.5); // pointing 0.5 rad left of the track
    const ai = new AIDriver(ship, track, 'steady', 42);
    let c = ai.update(1 / 120);
    for (let i = 0; i < 20; i++) c = ai.update(1 / 120);
    expect(c.steer).toBeGreaterThan(0.2);
  });

  it('steers left (negative) when the target lies to the left', () => {
    const track = makeCircleTrack(400, 1);
    const ship = racingShip(track, 0.1, 0, -0.5); // pointing right of the track, target is to the left
    const ai = new AIDriver(ship, track, 'steady', 42);
    let c = ai.update(1 / 120);
    for (let i = 0; i < 20; i++) c = ai.update(1 / 120);
    expect(c.steer).toBeLessThan(-0.2);
  });

  it('mirrors on a left-hand circle', () => {
    const track = makeCircleTrack(400, -1);
    const ship = racingShip(track, 0.3, 0, -0.5);
    const ai = new AIDriver(ship, track, 'aggressive', 5);
    let c = ai.update(1 / 120);
    for (let i = 0; i < 20; i++) c = ai.update(1 / 120);
    expect(c.steer).toBeLessThan(-0.2); // aligned with a left curve and yawed right => steer left
  });

  it('returns neutral controls while on the grid', () => {
    const track = makeCircleTrack();
    const ship = racingShip(track, 0.1, 0, 0.3);
    ship.status = 'grid';
    const ai = new AIDriver(ship, track, 'steady', 1);
    const c = ai.update(1 / 120);
    expect(c.throttle).toBe(0);
    expect(c.steer).toBe(0);
    expect(c.boost).toBe(false);
    expect(ai.shipId).toBe(1);
  });

  it('brakes when far above the safe cornering speed', () => {
    const track = makeCircleTrack(70, 1); // very tight corner
    const ship = racingShip(track, 0.1, 0, 0, 140);
    const ai = new AIDriver(ship, track, 'steady', 3);
    const c = ai.update(1 / 120);
    expect(c.brake).toBeGreaterThan(0.3);
    expect(c.throttle).toBeLessThan(0.2);
  });
});

describe('AIDriver boost', () => {
  it('only boosts when unlocked, and fires as a single-step edge', () => {
    const track = makeCircleTrack(4000, 1); // effectively straight
    const ship = racingShip(track, 0.1, 0, 0, 110);

    const locked = new AIDriver(ship, track, 'aggressive', 9);
    for (let i = 0; i < 600; i++) expect(locked.update(1 / 120).boost).toBe(false);

    ship.boostUnlocked = true;
    const ai = new AIDriver(ship, track, 'aggressive', 9);
    const seq: boolean[] = [];
    for (let i = 0; i < 600; i++) seq.push(ai.update(1 / 120).boost);
    expect(seq.some(Boolean)).toBe(true);
    for (let i = 1; i < seq.length; i++) expect(seq[i] && seq[i - 1]).toBe(false);
  });

  it('does not boost with low energy or while boosting', () => {
    const track = makeCircleTrack(4000, 1);
    const ship = racingShip(track, 0.1, 0, 0, 110);
    ship.boostUnlocked = true;
    ship.energy = 20;
    const ai = new AIDriver(ship, track, 'steady', 9);
    for (let i = 0; i < 600; i++) expect(ai.update(1 / 120).boost).toBe(false);
    ship.energy = 100;
    ship.boosting = true;
    for (let i = 0; i < 600; i++) expect(ai.update(1 / 120).boost).toBe(false);
  });

  it('does not boost when a corner is coming up', () => {
    const track = makeCircleTrack(120, 1);
    const ship = racingShip(track, 0.1, 0, 0, 60);
    ship.boostUnlocked = true;
    const ai = new AIDriver(ship, track, 'aggressive', 9);
    for (let i = 0; i < 600; i++) expect(ai.update(1 / 120).boost).toBe(false);
  });
});

describe('AIDriver determinism and pit', () => {
  function run(seed: number, personality: AIPersonality): number[] {
    const track = makeCircleTrack(300, 1);
    const ship = racingShip(track, 0.2, 2, 0.05, 90);
    const ai = new AIDriver(ship, track, personality, seed);
    const out: number[] = [];
    for (let i = 0; i < 500; i++) out.push(ai.update(1 / 120).steer);
    return out;
  }

  it('is deterministic per seed and differs across seeds for the erratic driver', () => {
    expect(run(11, 'erratic')).toEqual(run(11, 'erratic'));
    expect(run(11, 'erratic')).not.toEqual(run(12, 'erratic'));
  });

  it('aims for the pit lane when energy is low and the pit is near', () => {
    const track = makeCircleTrack(600, 1, { pit: true });
    const ship = racingShip(track, 0.85, 8, 0, 100);
    ship.energy = 20;
    const ai = new AIDriver(ship, track, 'steady', 4);
    // Ship starts to the right of a pit at lateral -10: it must steer left (negative).
    let c: ControlInput = ai.update(1 / 120);
    for (let i = 0; i < 60; i++) c = ai.update(1 / 120);
    expect(c.steer).toBeLessThan(-0.05);
  });
});

/** Minimal kinematic plant: yaw rate = steer * ω(v); speed follows throttle/brake. */
function simulate(track: TrackData, personality: AIPersonality, seconds: number, seed = 7): { maxLat: number; laps: number; minSpeed: number; avgSpeed: number } {
  const ship = makeShip(1, false, personality);
  placeShip(ship, track, 0.98, 0, 0);
  ship.status = 'racing';
  const ai = new AIDriver(ship, track, personality, seed);
  const dt = 1 / 120;
  let heading = 0; // yaw about +Y, measured relative to the track tangent at start
  const s0 = track.sampleAt(0.98);
  const pos = ship.position.clone();
  const dir = s0.forward.clone();
  const up = new THREE.Vector3(0, 1, 0);
  let speed = 40;
  let maxLat = 0;
  let minSpeed = Infinity;
  let sumSpeed = 0;
  let steps = 0;
  let progress = 0;
  let prevU = ship.trackU;
  for (let t = 0; t < seconds; t += dt) {
    ship.speed = speed;
    ship.forwardSpeed = speed;
    const c = ai.update(dt);
    const k = Math.min(1, speed / CONFIG.TOP_SPEED);
    const omega = CONFIG.STEER_RATE + (CONFIG.STEER_RATE_HIGH_SPEED - CONFIG.STEER_RATE) * k;
    const yawRate = -c.steer * omega; // +steer = right = clockwise seen from +Y = negative rotation about +Y
    heading += yawRate * dt;
    dir.applyAxisAngle(up, yawRate * dt);
    const accel = c.throttle * CONFIG.THRUST_ACCEL * (1 - speed / CONFIG.TOP_SPEED) - c.brake * CONFIG.BRAKE_DECEL;
    speed = Math.max(5, Math.min(CONFIG.TOP_SPEED, speed + accel * dt));
    pos.addScaledVector(dir, speed * dt);
    // Body pose: forward = dir, up = +Y.
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    ship.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, dir.clone().negate()));
    ship.position.copy(pos);
    const pr = track.project(pos, ship.trackU);
    ship.trackU = pr.u;
    ship.lateral = pr.lateral;
    let d = pr.u - prevU;
    if (d > 0.5) d -= 1;
    else if (d < -0.5) d += 1;
    progress += d;
    prevU = pr.u;
    maxLat = Math.max(maxLat, Math.abs(pr.lateral));
    if (t > 3) {
      minSpeed = Math.min(minSpeed, speed);
      sumSpeed += speed;
      steps++;
    }
  }
  void heading;
  return { maxLat, laps: progress, minSpeed, avgSpeed: steps ? sumSpeed / steps : 0 };
}

describe('AIDriver closed loop on a synthetic circle', () => {
  for (const personality of ['aggressive', 'steady', 'erratic'] as AIPersonality[]) {
    it(`${personality} stays on track and keeps moving`, () => {
      const track = makeCircleTrack(350, 1);
      const r = simulate(track, personality, 40);
      expect(r.maxLat).toBeLessThan(track.halfWidth);
      expect(r.laps).toBeGreaterThan(0.5);
      expect(r.minSpeed).toBeGreaterThan(20);
    });
    it(`${personality} stays on a left-hand circle`, () => {
      const track = makeCircleTrack(350, -1);
      const r = simulate(track, personality, 40);
      expect(r.maxLat).toBeLessThan(track.halfWidth);
      expect(r.laps).toBeGreaterThan(0.5);
    });
  }
});

void wrapAngle;
