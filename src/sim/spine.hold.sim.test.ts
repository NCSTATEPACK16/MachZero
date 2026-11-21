/**
 * Integration: Abyss Line's Spine with real physics. The deck curls **down** around a tube of circumference
 * 2·halfWidth below the centreline, and ships ride its outside, so `lateral` is the position around the tube
 * (0 = the crown, ±W = the bottom seam). A ship holding any line (up to 154° round either side) at a slow or a
 * racing speed must stay on the tube at hover height, with its hull aligned to the curled surface, from the closing
 * transition to the opening one. A ship that steers a spiral must be able to drive a full 360° round the outside.
 * No respawns, never airborne. The chase camera rolls with the ship and stays outside the tube.
 *
 * The driver is the pipe test's. Under the Spine its steady error through the bend points at the bottom seam, so the
 * track must leave the bend before the tube opens (the validator's spine rule): opening right at the bend's end, a
 * ship holding 154° came out of the bend still heading out and met the rails rising at the seam.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CONFIG, SHIP_ROSTER } from '../core/config';
import type { ControlInput, GridSlot, ShipId, TrackData } from '../core/contracts';
import { clamp, inLoopRange, wrap01 } from '../core/math';
import { EventBus, type GameEvents } from '../core/events';
import { TRACK_DEFS } from '../content/tracks';
import { ChaseCamera } from '../graphics/ChaseCamera';
import { PhysicsSystem } from '../physics';
import { trackFromSource } from '../track';
import { PIPE_RADIUS } from '../track/features/pipe';

vi.setConfig({ testTimeout: 60_000 });

const track: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['abyss-line'] });
const spineDef = track.features.find((f) => f.type === 'spine')!;
if (!spineDef || spineDef.type !== 'spine') throw new Error('abyss-line has no spine');
const spine = track.spines[0];
const W = track.halfWidth;

function slotAt(u: number, lateral: number): GridSlot {
  const s = track.sampleAt(u);
  const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
  const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
  return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
}

/** Lateral difference wrapped to (−W, W]: the tube's circumference is 2W. */
function wrapLat(d: number): number {
  return d - 2 * W * Math.round(d / (2 * W));
}

interface Run {
  insideSteps: number;
  closedSteps: number;
  respawns: number;
  airborne: number;
  worstHeightErr: number;
  /** Worst |distance from the tube axis − (R + hover)| on the closed stretch, measured in world space. */
  worstAxisErr: number;
  /** Lowest dot(ship up, surface normal) on the Spine. */
  minAlign: number;
  /** Unwrapped lateral travelled round the circumference on the closed stretch (m). */
  aroundTravel: number;
  maxAbsLateral: number;
  speedOut: number;
  /** Closest the chase camera comes to the tube axis, minus the tube radius (m): > 0 means outside the tube. */
  camClear: number;
  /** Lowest dot(camera up, ship up) on the closed stretch: the camera rolls with the ship. */
  camRoll: number;
  /** Worst screen offset of the ship (NDC). */
  worstScreen: number;
}

async function runSpine(speed: number, target: (insideMetres: number) => number, startLateral: number): Promise<Run> {
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus);
  const ship = physics.addShip(SHIP_ROSTER[0], track.startGrid[0]);
  // Start on the straight before the Spine.
  physics.resetShip(0, slotAt(wrap01(spine.uStart - 35 / track.length), startLateral));
  ship.status = 'racing';
  ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(speed);
  const run: Run = {
    insideSteps: 0, closedSteps: 0, respawns: 0, airborne: 0, worstHeightErr: 0, worstAxisErr: 0, minAlign: 1, aroundTravel: 0,
    maxAbsLateral: 0, speedOut: 0, camClear: Infinity, camRoll: 1, worstScreen: 0,
  };
  bus.on('ship:respawn', () => run.respawns++);
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 5000);
  const chase = new ChaseCamera(camera);
  const ndc = new THREE.Vector3();

  const controls = new Map<ShipId, ControlInput>();
  const closedFrom = spineDef.dStart + spineDef.transition;
  const closedTo = spineDef.dEnd - spineDef.transition;
  const up = new THREE.Vector3();
  const surfUp = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let prevLat = ship.lateral;
  let wasInside = false;
  for (let i = 0; i < 120 * 20; i++) {
    const inside = inLoopRange(ship.trackU, spine.uStart, spine.uEnd);
    if (wasInside && !inside) break;
    wasInside ||= inside;
    const d = ship.trackU * track.length;
    const insideMetres = inside ? wrap01(ship.trackU - spine.uStart) * track.length : 0;
    const latVel = wrapLat(ship.lateral - prevLat) / CONFIG.FIXED_DT;
    prevLat = ship.lateral;
    const err = wrapLat(target(insideMetres) - ship.lateral);
    const steer = clamp(0.15 * err - 0.06 * latVel, -1, 1);
    const over = ship.forwardSpeed - speed;
    controls.set(0, { throttle: clamp(0.5 - over / 4, 0, 1), brake: clamp((over - 3) / 10, 0, 1), steer, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
    physics.step(CONFIG.FIXED_DT, controls);
    chase.update(CONFIG.FIXED_DT, i * CONFIG.FIXED_DT, 'racing', 0, { pos: ship.position, quat: ship.quaternion, ship }, track);
    if (!inside) continue;

    run.insideSteps++;
    run.maxAbsLateral = Math.max(run.maxAbsLateral, Math.abs(ship.lateral));
    run.worstHeightErr = Math.max(run.worstHeightErr, Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT));
    if (!ship.grounded) run.airborne++;
    track.surfacePoint(ship.trackU, ship.lateral, tmp, surfUp);
    up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    run.minAlign = Math.min(run.minAlign, up.dot(surfUp));
    if (d > closedFrom && d < closedTo) {
      run.closedSteps++;
      run.aroundTravel += Math.abs(wrapLat(ship.lateral - prevLat));
      // Independent of project(): the tube axis runs PIPE_RADIUS below the centreline crown.
      const s = track.sampleAt(ship.trackU);
      const axis = s.position.clone().addScaledVector(s.up, -PIPE_RADIUS);
      const rel = ship.position.clone().sub(axis);
      rel.addScaledVector(s.forward, -rel.dot(s.forward));
      run.worstAxisErr = Math.max(run.worstAxisErr, Math.abs(rel.length() - (PIPE_RADIUS + CONFIG.HOVER_HEIGHT)));
      // The camera: outside the tube, rolled with the ship, the ship on screen.
      camera.updateMatrixWorld();
      const sc = track.sampleAt(ship.trackU);
      const cAxis = sc.position.clone().addScaledVector(sc.up, -PIPE_RADIUS);
      const cRel = camera.position.clone().sub(cAxis);
      cRel.addScaledVector(sc.forward, -cRel.dot(sc.forward));
      run.camClear = Math.min(run.camClear, cRel.length() - PIPE_RADIUS);
      run.camRoll = Math.min(run.camRoll, camera.up.dot(up));
      ndc.copy(ship.position).project(camera);
      run.worstScreen = Math.max(run.worstScreen, Math.abs(ndc.x), Math.abs(ndc.y));
    }
  }
  run.speedOut = ship.speed;
  physics.dispose();
  return run;
}

function report(name: string, r: Run): void {
  console.log(
    `spine ${name}: inside=${r.insideSteps} closed=${r.closedSteps} heightErr=${r.worstHeightErr.toFixed(2)} axisErr=${r.worstAxisErr.toFixed(2)} ` +
      `align=${r.minAlign.toFixed(3)} around=${r.aroundTravel.toFixed(1)}m maxLat=${r.maxAbsLateral.toFixed(1)} airborne=${r.airborne} respawns=${r.respawns} ` +
      `vOut=${r.speedOut.toFixed(0)} camClear=${r.camClear.toFixed(2)} camRoll=${r.camRoll.toFixed(3)} screen=${r.worstScreen.toFixed(2)}`,
  );
}

function expectHeld(r: Run): void {
  expect(r.insideSteps).toBeGreaterThan(200);
  expect(r.closedSteps).toBeGreaterThan(100);
  expect(r.respawns).toBe(0);
  expect(r.airborne).toBe(0);
  expect(r.worstHeightErr).toBeLessThan(0.6);
  expect(r.worstAxisErr).toBeLessThan(0.6);
  expect(r.minAlign).toBeGreaterThan(0.95);
  // The chase camera stays outside the tube (with room for the near plane), rolls with the ship, keeps it on screen.
  expect(r.camClear).toBeGreaterThan(0.5);
  expect(r.camRoll).toBeGreaterThan(0.9);
  expect(r.worstScreen).toBeLessThan(0.8);
}

describe('Abyss Line Spine', () => {
  it('curls the deck down: the crown stays put, the edges meet under a tube below the centreline', () => {
    const uMid = wrap01((spineDef.dStart + spineDef.dEnd) / 2 / track.length);
    const s = track.sampleAt(uMid);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    track.surfacePoint(uMid, 0, p, n);
    expect(p.distanceTo(s.position)).toBeLessThan(1e-6);
    expect(n.dot(s.up)).toBeGreaterThan(0.999);
    for (const lat of [-W, W]) {
      track.surfacePoint(uMid, lat, p, n);
      const bottom = s.position.clone().addScaledVector(s.up, -2 * PIPE_RADIUS);
      expect(p.distanceTo(bottom)).toBeLessThan(0.05);
      // The normal points away from the axis: straight down at the bottom seam.
      expect(n.dot(s.up)).toBeLessThan(-0.999);
    }
    // project() inverts surfacePoint on the outside of the tube.
    for (const lat of [-12, -7, 0, 7, 12]) {
      track.surfacePoint(uMid, lat, p, n);
      const pr = track.project(p.clone().addScaledVector(n, CONFIG.HOVER_HEIGHT), uMid);
      expect(pr.lateral).toBeCloseTo(lat, 2);
      expect(pr.height).toBeCloseTo(CONFIG.HOVER_HEIGHT, 2);
    }
  });

  describe.each([
    ['slow', 70],
    ['racing', 125],
  ])('%s (%i m/s)', (_name, speed) => {
    it.each([-12, -7, 0, 7, 12])('holds a line at lateral %i m (round the side) along the whole Spine', async (lateral) => {
      const r = await runSpine(speed, () => lateral, lateral);
      report(`v=${speed} lat=${lateral}`, r);
      expectHeld(r);
      // Same line in, same line out: the tube neither flings nor drains the ship.
      expect(r.speedOut).toBeGreaterThan(speed * 0.85);
    });
  });

  it('drives a full 360° round the outside on a spiral', async () => {
    const closedLen = spineDef.dEnd - spineDef.dStart - 2 * spineDef.transition;
    // One and three-quarter turns over the closed stretch.
    const r = await runSpine(90, (m) => clamp((m - spineDef.transition) / closedLen, 0, 1) * 3.5 * W, 0);
    report('spiral', r);
    expectHeld(r);
    expect(r.aroundTravel).toBeGreaterThan(2 * W);
  });
});
