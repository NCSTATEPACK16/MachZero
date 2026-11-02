/**
 * Integration: Orbital Ring's loop-the-loop with real physics. The magnetic hold keeps a ship on the deck right
 * round the loop at any speed (no minimum), on any line across the deck: it must go over the top inverted, stay at
 * hover height with its hull aligned to the deck, and come out on the same line it went in on, even hands-off,
 * although the loop exits 36 m to the side of its entry. No respawns, never airborne.
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

vi.setConfig({ testTimeout: 60_000 });

const track: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['orbital-ring'] });
const loop = track.loops[0];

function slotAt(u: number, lateral: number): GridSlot {
  const s = track.sampleAt(u);
  const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
  const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
  return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
}

/**
 * The deck's real normal at (u, lateral), from neighbouring surface points (independent of project()). Off the
 * centreline it tilts away from the frame's up where the loop's deck twists.
 */
function deckNormal(u: number, lateral: number, out: THREE.Vector3): THREE.Vector3 {
  const du = 0.5 / track.length;
  const a = track.surfacePoint(wrap01(u + du), lateral, new THREE.Vector3()).sub(track.surfacePoint(wrap01(u - du), lateral, new THREE.Vector3()));
  const b = track.surfacePoint(u, lateral + 0.5, new THREE.Vector3()).sub(track.surfacePoint(u, lateral - 0.5, new THREE.Vector3()));
  return out.crossVectors(b, a).normalize();
}

interface Run {
  insideSteps: number;
  respawns: number;
  airborne: number;
  worstHeightErr: number;
  /** Lowest dot(ship up, true deck normal) inside the loop. */
  minAlign: number;
  /** Lowest world-up component of the ship's up (−1 = upside down at the top). */
  minUpY: number;
  /** Largest |lateral − line| inside the loop. */
  worstLineErr: number;
  /** Lateral on the first step past the loop, and 30 steps (≈ 20–45 m) later. */
  lateralExit: number;
  lateralOut: number;
  speedOut: number;
}

async function runLoop(speed: number, lateral: number, opts: { handsOff?: boolean } = {}): Promise<Run> {
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus);
  const ship = physics.addShip(SHIP_ROSTER[0], track.startGrid[0]);
  physics.resetShip(0, slotAt(wrap01(loop.uStart - 60 / track.length), lateral));
  ship.status = 'racing';
  ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(speed);
  const run: Run = { insideSteps: 0, respawns: 0, airborne: 0, worstHeightErr: 0, minAlign: 1, minUpY: 1, worstLineErr: 0, lateralExit: NaN, lateralOut: NaN, speedOut: 0 };
  bus.on('ship:respawn', () => run.respawns++);

  const controls = new Map<ShipId, ControlInput>();
  const up = new THREE.Vector3();
  const surfUp = new THREE.Vector3();
  let prevLat = ship.lateral;
  let wasInside = false;
  for (let i = 0; i < 120 * 12; i++) {
    const inside = inLoopRange(ship.trackU, loop.uStart, loop.uEnd);
    if (wasInside && !inside) {
      run.lateralExit = ship.lateral;
      break;
    }
    wasInside ||= inside;
    const latVel = (ship.lateral - prevLat) / CONFIG.FIXED_DT;
    prevLat = ship.lateral;
    const steer = opts.handsOff ? 0 : clamp(0.15 * (lateral - ship.lateral) - 0.06 * latVel, -1, 1);
    const over = ship.forwardSpeed - speed;
    controls.set(0, { throttle: clamp(0.5 - over / 4, 0, 1), brake: clamp((over - 3) / 10, 0, 1), steer, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
    physics.step(CONFIG.FIXED_DT, controls);
    if (!inLoopRange(ship.trackU, loop.uStart, loop.uEnd)) continue;

    run.insideSteps++;
    run.worstHeightErr = Math.max(run.worstHeightErr, Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT));
    run.worstLineErr = Math.max(run.worstLineErr, Math.abs(ship.lateral - lateral));
    if (!ship.grounded) run.airborne++;
    deckNormal(ship.trackU, ship.lateral, surfUp);
    up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    run.minAlign = Math.min(run.minAlign, up.dot(surfUp));
    run.minUpY = Math.min(run.minUpY, up.y);
  }
  // A few metres past the exit, back on the level.
  for (let i = 0; i < 30; i++) physics.step(CONFIG.FIXED_DT, controls);
  run.lateralOut = ship.lateral;
  run.speedOut = ship.speed;
  physics.dispose();
  return run;
}

function report(name: string, r: Run): void {
  console.log(
    `loop ${name}: inside=${r.insideSteps} heightErr=${r.worstHeightErr.toFixed(2)} align=${r.minAlign.toFixed(3)} upY=${r.minUpY.toFixed(2)} ` +
      `lineErr=${r.worstLineErr.toFixed(2)} latExit=${r.lateralExit.toFixed(2)} latOut=${r.lateralOut.toFixed(2)} airborne=${r.airborne} respawns=${r.respawns} vOut=${r.speedOut.toFixed(0)}`,
  );
}

function expectHeld(r: Run): void {
  expect(r.insideSteps).toBeGreaterThan(40);
  expect(r.respawns).toBe(0);
  expect(r.airborne).toBe(0);
  expect(r.worstHeightErr).toBeLessThan(0.6);
  expect(r.minAlign).toBeGreaterThan(0.95);
  // Over the top upside down.
  expect(r.minUpY).toBeLessThan(-0.95);
}

describe('Orbital Ring loop-the-loop', () => {
  it('is 30 m tall and exits beside its entry, on the level', () => {
    const f = track.features.find((x) => x.type === 'loop')!;
    if (f.type !== 'loop') throw new Error('no loop');
    const entry = track.sampleAt(loop.uStart);
    let top = -Infinity;
    for (let d = f.dStart; d <= f.dEnd; d += 0.5) top = Math.max(top, track.sampleAt(wrap01(d / track.length)).position.y);
    expect(top - entry.position.y).toBeCloseTo(30, 0);
    const exit = track.sampleAt(loop.uEnd);
    expect(Math.abs(exit.position.clone().sub(entry.position).dot(entry.right) - f.sideOffset)).toBeLessThan(1);
    expect(exit.up.y).toBeGreaterThan(0.999);
    // A ship lost inside the loop comes back just past it.
    const mid = wrap01((loop.uStart + wrap01(loop.uEnd - loop.uStart) / 2));
    expect(wrap01(track.safeRespawnU(mid) - loop.uEnd) * track.length).toBeCloseTo(20, 0);
  });

  describe.each([
    ['crawl', 25],
    ['slow', 70],
    ['racing', 125],
    ['boosted', 180],
  ])('%s (%i m/s)', (_name, speed) => {
    it.each([-10, -5, 0, 5, 10])('holds a line at lateral %i m right round the loop', async (lateral) => {
      const r = await runLoop(speed, lateral);
      report(`v=${speed} lat=${lateral}`, r);
      expectHeld(r);
      expect(r.worstLineErr).toBeLessThan(1.5);
      expect(Math.abs(r.lateralOut - lateral)).toBeLessThan(1);
    });
  });

  // Hands-off, the loop itself brings the ship out on its line: within 0.2 m on the centreline, and within 2 m at the
  // edges, where a small heading error proportional to the line's offset (≈ 1.5° at 8 m) remains (as-built notes).
  it.each([
    [70, 0, 0.2],
    [180, 0, 0.2],
    [70, 6, 2],
    [140, -8, 2],
  ])('carries a hands-off ship along its line at %i m/s (lateral %i m)', async (speed, lateral, tol) => {
    const r = await runLoop(speed, lateral, { handsOff: true });
    report(`hands-off v=${speed} lat=${lateral}`, r);
    expectHeld(r);
    expect(Math.abs(r.lateralExit - lateral)).toBeLessThan(tol);
  });
});
