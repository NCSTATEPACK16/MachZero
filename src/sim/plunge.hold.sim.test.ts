/**
 * Integration: Cinder Forge's Plunge with real physics (IMPLEMENTATION §X5). The Plunge is a 55° dive of about
 * 110 m into the crater, a floor section and a climb back out.
 *  - The magnetic hold keeps a ship on the deck at any speed and on any line: at hover height, never airborne, no
 *    respawn, on the line it went in on.
 *  - Gravity acts along the road on the Plunge only: a ship gains speed on the dive and loses it on the climb.
 *  - The top-speed cap is 1.2 × the ship's top speed on the Plunge, and it holds.
 *  - A climb never stalls a ship or rolls it back.
 *  - The chase camera stays above the deck with the ship in view all the way down and up.
 *  - A ship lost on the dive comes back on the floor.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CONFIG, SHIP_ROSTER } from '../core/config';
import type { ControlInput, GridSlot, ShipId, TrackData } from '../core/contracts';
import { clamp, inLoopRange, wrap01 } from '../core/math';
import { EventBus, type GameEvents } from '../core/events';
import { TRACK_DEFS } from '../content/tracks';
import { PhysicsSystem } from '../physics';
import { trackFromSource } from '../track';
import { PLUNGE_MIN_RADIUS, PLUNGE_RESPAWN_AFTER, PLUNGE_SPEED_CAP, buildPlunges, plungeDiveFoot } from '../track/features/plunge';
import { ChaseCamera } from '../graphics/ChaseCamera';

vi.setConfig({ testTimeout: 60_000 });

const track: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['cinder-forge'] });
const L = track.length;
const plunge = buildPlunges(track)[0];
const TOP = SHIP_ROSTER[0].stats.topSpeed;

/** Metres along the lap where the road is steepest downhill (mid-dive), flat again (the foot of the dive), and steepest uphill. */
const profile = (() => {
  let dive = plunge.dStart;
  let climb = plunge.dStart;
  let steepDown = 0;
  let steepUp = 0;
  for (let d = plunge.dStart; d <= plunge.dEnd; d += 1) {
    const fy = track.sampleAt(wrap01(d / L)).forward.y;
    if (fy < steepDown) [steepDown, dive] = [fy, d];
    if (fy > steepUp) [steepUp, climb] = [fy, d];
  }
  const foot = plungeDiveFoot(plunge, (d) => track.sampleAt(wrap01(d / L)).forward.y);
  let climbFoot = climb;
  while (track.sampleAt(wrap01(climbFoot / L)).forward.y > 0.01) climbFoot -= 1;
  return { dive, foot, climbFoot, climb, steepDown, steepUp };
})();

function slotAt(d: number, lateral: number): GridSlot {
  const u = wrap01(d / L);
  const s = track.sampleAt(u);
  const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
  const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
  return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
}

interface Run {
  insideSteps: number;
  respawns: number;
  railHits: number;
  airborne: number;
  worstHeightErr: number;
  worstLineErr: number;
  /** Lowest dot(ship up, road up). */
  minAlign: number;
  speedIn: number;
  /** Forward speed at the foot of the dive, at the foot of the climb and on leaving the Plunge. */
  speedFoot: number;
  speedClimbFoot: number;
  speedOut: number;
  maxSpeed: number;
  minForward: number;
  /** Lowest chase-camera height above the deck, lowest midpoint of its sight line, and the ship's worst screen offset (NDC). */
  camHeight: number;
  sightHeight: number;
  worstScreen: number;
  exited: boolean;
  trace: number[];
}

interface RunOpts {
  /** Metres along the lap to start from (default: 60 m before the Plunge). */
  from?: number;
  /** Stop here (metres along the lap) instead of at the end of the Plunge. */
  to?: number;
  throttle?: number;
  /** Fire the boost again and again. */
  boost?: boolean;
  handsOff?: boolean;
}

async function runPlunge(speed: number, lateral: number, opts: RunOpts = {}): Promise<Run> {
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus);
  const ship = physics.addShip(SHIP_ROSTER[0], track.startGrid[0]);
  physics.resetShip(0, slotAt(opts.from ?? plunge.dStart - 60, lateral));
  ship.status = 'racing';
  if (opts.boost) ship.boostUnlocked = true;
  const stats = ship.def.stats;
  ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(speed);
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 5000);
  const chase = new ChaseCamera(camera);
  const sight = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const up = new THREE.Vector3();
  const run: Run = {
    insideSteps: 0, respawns: 0, railHits: 0, airborne: 0, worstHeightErr: 0, worstLineErr: 0, minAlign: 1,
    speedIn: NaN, speedFoot: NaN, speedClimbFoot: NaN, speedOut: NaN, maxSpeed: 0, minForward: Infinity,
    camHeight: Infinity, sightHeight: Infinity, worstScreen: 0, exited: false, trace: [],
  };
  bus.on('ship:respawn', () => run.respawns++);
  bus.on('ship:railHit', () => run.railHits++);

  const controls = new Map<ShipId, ControlInput>();
  let prevLat = ship.lateral;
  let wasInside = false;
  for (let i = 0; i < 120 * 40; i++) {
    const inside = inLoopRange(ship.trackU, plunge.uStart, plunge.uEnd);
    if (wasInside && (!inside || (opts.to !== undefined && ship.trackU * L >= opts.to))) {
      run.exited = true;
      run.speedOut = ship.forwardSpeed;
      break;
    }
    if (!wasInside && !inside) run.speedIn = ship.forwardSpeed;
    wasInside ||= inside;
    const latVel = (ship.lateral - prevLat) / CONFIG.FIXED_DT;
    prevLat = ship.lateral;
    // Feed-forward for the floor's sweeper (the yaw rate the bend needs), plus the usual line-holding terms.
    const steerRate = stats.steerRate + (stats.steerRateHighSpeed - stats.steerRate) * clamp(ship.forwardSpeed / stats.topSpeed, 0, 1);
    const bend = (track.sampleAt(ship.trackU).curvature * ship.forwardSpeed) / steerRate;
    const steer = opts.handsOff ? 0 : clamp(bend + 0.15 * (lateral - ship.lateral) - 0.06 * latVel, -1, 1);
    controls.set(0, { throttle: opts.throttle ?? 1, brake: 0, steer, airbrakeLeft: 0, airbrakeRight: 0, boost: !!opts.boost && i % 40 < 20 });
    physics.step(CONFIG.FIXED_DT, controls);
    chase.update(CONFIG.FIXED_DT, i * CONFIG.FIXED_DT, 'racing', 0, { pos: ship.position, quat: ship.quaternion, ship }, track);
    if (!inLoopRange(ship.trackU, plunge.uStart, plunge.uEnd)) continue;

    const d = ship.trackU * L;
    run.insideSteps++;
    run.trace.push(ship.lateral, ship.forwardSpeed);
    run.worstHeightErr = Math.max(run.worstHeightErr, Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT));
    run.worstLineErr = Math.max(run.worstLineErr, Math.abs(ship.lateral - lateral));
    if (!ship.grounded) run.airborne++;
    up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    run.minAlign = Math.min(run.minAlign, up.dot(track.sampleAt(ship.trackU).up));
    run.maxSpeed = Math.max(run.maxSpeed, ship.forwardSpeed);
    run.minForward = Math.min(run.minForward, ship.forwardSpeed);
    if (d <= profile.foot) run.speedFoot = ship.forwardSpeed;
    if (d <= profile.climbFoot) run.speedClimbFoot = ship.forwardSpeed;

    camera.updateMatrixWorld();
    run.camHeight = Math.min(run.camHeight, track.project(camera.position, ship.trackU).height);
    sight.lerpVectors(camera.position, ship.position, 0.5);
    run.sightHeight = Math.min(run.sightHeight, track.project(sight, ship.trackU).height);
    ndc.copy(ship.position).project(camera);
    run.worstScreen = Math.max(run.worstScreen, Math.abs(ndc.x), Math.abs(ndc.y));
  }
  physics.dispose();
  return run;
}

function report(name: string, r: Run): void {
  console.log(
    `plunge ${name}: inside=${r.insideSteps} heightErr=${r.worstHeightErr.toFixed(2)} align=${r.minAlign.toFixed(3)} lineErr=${r.worstLineErr.toFixed(2)} ` +
      `v in=${r.speedIn.toFixed(0)} foot=${r.speedFoot.toFixed(0)} climbFoot=${r.speedClimbFoot.toFixed(0)} out=${r.speedOut.toFixed(0)} max=${r.maxSpeed.toFixed(0)} min=${r.minForward.toFixed(0)} ` +
      `cam=${r.camHeight.toFixed(2)} sight=${r.sightHeight.toFixed(2)} screen=${r.worstScreen.toFixed(2)} airborne=${r.airborne} rail=${r.railHits} respawns=${r.respawns}`,
  );
}

function expectHeld(r: Run): void {
  expect(r.exited).toBe(true);
  expect(r.insideSteps).toBeGreaterThan(200);
  expect(r.respawns).toBe(0);
  expect(r.railHits).toBe(0);
  expect(r.airborne).toBe(0);
  expect(r.worstHeightErr).toBeLessThan(0.6);
  expect(r.minAlign).toBeGreaterThan(0.99);
  // The chase camera stays above the deck with a clear view of the ship, and the ship stays on screen.
  expect(r.camHeight).toBeGreaterThan(1);
  expect(r.sightHeight).toBeGreaterThan(0.5);
  expect(r.worstScreen).toBeLessThan(0.85);
}

describe('Cinder Forge Plunge', () => {
  it('dives about 110 m at about 55°, straight in plan and unbanked, on a vertical radius of at least 115 m', () => {
    const top = track.sampleAt(plunge.uStart).position.y;
    const floor = track.sampleAt(wrap01(profile.foot / L)).position.y;
    expect(top - floor).toBeGreaterThan(100);
    expect(top - floor).toBeLessThan(120);
    const pitchDown = (Math.asin(-profile.steepDown) * 180) / Math.PI;
    const pitchUp = (Math.asin(profile.steepUp) * 180) / Math.PI;
    expect(pitchDown).toBeGreaterThan(50);
    expect(pitchDown).toBeLessThan(58);
    expect(pitchUp).toBeGreaterThan(50);
    expect(pitchUp).toBeLessThan(58);
    // No roll and no plan bend on the dive and the climb; the pitch turns no tighter than the limit.
    let minRadius = Infinity;
    for (const [from, to] of [[plunge.dStart, profile.foot], [profile.climbFoot, plunge.dEnd]]) {
      for (let d = from; d <= to; d += 2) {
        const s = track.sampleAt(wrap01(d / L));
        expect(Math.abs(s.right.y)).toBeLessThan(0.01);
        expect(Math.abs(s.curvature)).toBeLessThan(1 / 900);
        const a = track.sampleAt(wrap01((d + 2) / L)).forward;
        const b = track.sampleAt(wrap01((d - 2) / L)).forward;
        minRadius = Math.min(minRadius, 4 / Math.max(a.distanceTo(b), 1e-9));
      }
    }
    console.log(`plunge geometry: drop=${(top - floor).toFixed(1)} m pitch=${pitchDown.toFixed(1)}°/${pitchUp.toFixed(1)}° minVerticalRadius=${minRadius.toFixed(0)} m`);
    expect(minRadius).toBeGreaterThan(PLUNGE_MIN_RADIUS);
    // Level at both ends.
    expect(track.sampleAt(plunge.uStart).up.y).toBeGreaterThan(0.999);
    expect(track.sampleAt(plunge.uEnd).up.y).toBeGreaterThan(0.999);
  });

  it('brings a ship lost on the dive back on the floor', () => {
    const back = track.safeRespawnU(wrap01(profile.dive / L)) * L;
    expect(back - profile.foot).toBeCloseTo(PLUNGE_RESPAWN_AFTER, 0);
    expect(Math.abs(track.sampleAt(wrap01(back / L)).forward.y)).toBeLessThan(0.02);
    // On the floor and on the climb a ship comes back where it was.
    const floorU = wrap01((profile.foot + 100) / L);
    expect(track.safeRespawnU(floorU)).toBe(floorU);
    const climbU = wrap01(profile.climb / L);
    expect(track.safeRespawnU(climbU)).toBe(climbU);
  });

  describe.each([
    ['crawl', 40],
    ['slow', 90],
    ['racing', 140],
    ['boosted', 180],
  ])('%s (%i m/s)', (_name, speed) => {
    it.each([-10, -5, 0, 5, 10])('holds a line at lateral %i m down the dive, across the floor and up the climb', async (lateral) => {
      const r = await runPlunge(speed, lateral);
      report(`v=${speed} lat=${lateral}`, r);
      expectHeld(r);
      expect(r.worstLineErr).toBeLessThan(1.5);
    });
  });

  // The floor has a sweeper, so a hands-off ship is only followed down the dive.
  it.each([
    [70, 0],
    [140, 6],
    [180, -8],
  ])('carries a hands-off ship down the dive on its line at %i m/s (lateral %i m)', async (speed, lateral) => {
    const r = await runPlunge(speed, lateral, { handsOff: true, to: profile.foot });
    report(`hands-off v=${speed} lat=${lateral}`, r);
    expect(r.respawns).toBe(0);
    expect(r.railHits).toBe(0);
    expect(r.airborne).toBe(0);
    expect(r.worstLineErr).toBeLessThan(0.5);
  });

  it('gains speed on the dive, keeps it across the floor and loses it on the climb', async () => {
    const r = await runPlunge(TOP, 0);
    report('speed profile', r);
    expect(r.speedIn).toBeGreaterThan(TOP - 5);
    expect(r.speedIn).toBeLessThan(TOP + 1);
    // The dive takes a ship at top speed to the cap, or just under it.
    expect(r.speedFoot).toBeGreaterThan(TOP * 1.12);
    expect(r.speedFoot).toBeLessThan(TOP * PLUNGE_SPEED_CAP + 1);
    // The floor keeps most of it (it is above top speed, so the engine adds nothing).
    expect(r.speedClimbFoot).toBeGreaterThan(TOP * 1.08);
    // The climb spends it: the ship comes out near the speed it went in at.
    expect(r.speedOut).toBeLessThan(r.speedClimbFoot - 20);
    expect(r.speedOut).toBeGreaterThan(TOP * 0.9);
    expect(r.speedOut).toBeLessThan(TOP + 1);
  });

  it('gives a slow ship speed on the dive too', async () => {
    const r = await runPlunge(40, 0, { throttle: 0, to: profile.foot });
    report('coasting dive', r);
    // No engine: the fall alone doubles its speed.
    expect(r.speedFoot).toBeGreaterThan(70);
    expect(r.speedFoot).toBeLessThan(TOP);
  });

  it('holds the cap: 1.2 × top speed, and 1.2 × boost top speed while boosting', async () => {
    const plain = await runPlunge(TOP, 0);
    expect(plain.maxSpeed).toBeLessThan(TOP * PLUNGE_SPEED_CAP + 1);
    const boosted = await runPlunge(TOP, 0, { boost: true });
    report('boosted dive', boosted);
    const boostTop = SHIP_ROSTER[0].stats.boostTopSpeed;
    expect(boosted.maxSpeed).toBeGreaterThan(boostTop);
    expect(boosted.maxSpeed).toBeLessThan(boostTop * PLUNGE_SPEED_CAP + 1);
    expect(boosted.respawns).toBe(0);
    expect(boosted.airborne).toBe(0);
  });

  it('never stalls a ship on the climb', async () => {
    // From a standstill at the foot of the climb, on the engine alone.
    const r = await runPlunge(0, 0, { from: profile.climbFoot });
    report('climb from rest', r);
    expect(r.exited).toBe(true);
    expect(r.respawns).toBe(0);
    expect(r.speedOut).toBeGreaterThan(40);
    // Stopped half-way up with no throttle, a ship does not roll back.
    const parked = await runPlunge(0, 0, { from: profile.climb, throttle: 0 });
    expect(parked.minForward).toBeGreaterThan(-0.5);
    expect(parked.respawns).toBe(0);
  });

  it('is the same run twice', async () => {
    const a = await runPlunge(125, 4, { handsOff: true });
    const b = await runPlunge(125, 4, { handsOff: true });
    expect(b.trace).toEqual(a.trace);
  });
});
