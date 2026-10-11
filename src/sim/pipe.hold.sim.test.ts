/**
 * Integration: Cryo Station's full-pipe with real physics. The deck curls into a closed tube of circumference
 * 2·halfWidth, so `lateral` is the position around the circumference. A ship holding any line (up to 154° up
 * the wall, either side) at a slow or a racing speed must stay glued to the tube at hover height, with its hull
 * aligned to the curled surface, from the closing transition to the opening one. A ship that steers a spiral must
 * be able to drive a full 360° around the inside. No respawns, never airborne.
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
import { PIPE_RADIUS } from '../track/features/pipe';

vi.setConfig({ testTimeout: 60_000 });

const track: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['cryo-station'] });
const pipeDef = track.features.find((f) => f.type === 'pipe')!;
if (pipeDef.type !== 'pipe') throw new Error('cryo-station has no pipe');
const pipe = track.pipes[0];
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
  /** Worst |distance from the tube axis − (R − hover)| on the closed stretch, measured in world space. */
  worstAxisErr: number;
  /** Lowest dot(ship up, surface normal) inside the pipe. */
  minAlign: number;
  /** Unwrapped lateral travelled around the circumference inside the closed stretch (m). */
  aroundTravel: number;
  maxAbsLateral: number;
  speedOut: number;
}

async function runPipe(speed: number, target: (insideMetres: number) => number, startLateral: number): Promise<Run> {
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus);
  const ship = physics.addShip(SHIP_ROSTER[0], track.startGrid[0]);
  // Start on the short straight before the pipe (the right-hander before it is not part of this test).
  physics.resetShip(0, slotAt(wrap01(pipe.uStart - 35 / track.length), startLateral));
  ship.status = 'racing';
  ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(speed);
  const run: Run = { insideSteps: 0, closedSteps: 0, respawns: 0, airborne: 0, worstHeightErr: 0, worstAxisErr: 0, minAlign: 1, aroundTravel: 0, maxAbsLateral: 0, speedOut: 0 };
  bus.on('ship:respawn', () => run.respawns++);

  const controls = new Map<ShipId, ControlInput>();
  const closedFrom = pipeDef.dStart + pipeDef.transition;
  const closedTo = pipeDef.dEnd - pipeDef.transition;
  const up = new THREE.Vector3();
  const surfUp = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let prevLat = ship.lateral;
  let wasInside = false;
  for (let i = 0; i < 120 * 20; i++) {
    const inside = inLoopRange(ship.trackU, pipe.uStart, pipe.uEnd);
    if (wasInside && !inside) break;
    wasInside ||= inside;
    const d = ship.trackU * track.length;
    const insideMetres = inside ? wrap01(ship.trackU - pipe.uStart) * track.length : 0;
    const latVel = wrapLat(ship.lateral - prevLat) / CONFIG.FIXED_DT;
    prevLat = ship.lateral;
    const err = wrapLat(target(insideMetres) - ship.lateral);
    const steer = clamp(0.15 * err - 0.06 * latVel, -1, 1);
    const over = ship.forwardSpeed - speed;
    controls.set(0, { throttle: clamp(0.5 - over / 4, 0, 1), brake: clamp((over - 3) / 10, 0, 1), steer, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
    physics.step(CONFIG.FIXED_DT, controls);
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
      // Independent of project(): the tube axis runs PIPE_RADIUS above the centreline floor.
      const s = track.sampleAt(ship.trackU);
      const axis = s.position.clone().addScaledVector(s.up, PIPE_RADIUS);
      const rel = ship.position.clone().sub(axis);
      rel.addScaledVector(s.forward, -rel.dot(s.forward));
      run.worstAxisErr = Math.max(run.worstAxisErr, Math.abs(rel.length() - (PIPE_RADIUS - CONFIG.HOVER_HEIGHT)));
    }
  }
  run.speedOut = ship.speed;
  physics.dispose();
  return run;
}

function report(name: string, r: Run): void {
  console.log(
    `pipe ${name}: inside=${r.insideSteps} closed=${r.closedSteps} heightErr=${r.worstHeightErr.toFixed(2)} axisErr=${r.worstAxisErr.toFixed(2)} ` +
      `align=${r.minAlign.toFixed(3)} around=${r.aroundTravel.toFixed(1)}m maxLat=${r.maxAbsLateral.toFixed(1)} airborne=${r.airborne} respawns=${r.respawns} vOut=${r.speedOut.toFixed(0)}`,
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
}

describe('Cryo Station full-pipe', () => {
  describe.each([
    ['slow', 70],
    ['racing', 125],
  ])('%s (%i m/s)', (_name, speed) => {
    it.each([-12, -7, 0, 7, 12])('holds a line at lateral %i m (up the wall) through the whole tube', async (lateral) => {
      const r = await runPipe(speed, () => lateral, lateral);
      report(`v=${speed} lat=${lateral}`, r);
      expectHeld(r);
      // Same line in, same line out: the tube neither flings nor drains the ship.
      expect(r.speedOut).toBeGreaterThan(speed * 0.85);
    });
  });

  it('drives a full 360° around the inside on a spiral', async () => {
    const closedLen = pipeDef.dEnd - pipeDef.dStart - 2 * pipeDef.transition;
    // One and three-quarter turns over the closed stretch.
    const r = await runPipe(90, (m) => clamp((m - pipeDef.transition) / closedLen, 0, 1) * 3.5 * W, 0);
    report('spiral', r);
    expectHeld(r);
    expect(r.aroundTravel).toBeGreaterThan(2 * W);
  });
});
