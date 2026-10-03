/**
 * Integration: Sunset Mesa's jumps with real physics. At any racing speed (a slow exit, cruise, top speed,
 * boosting) and any line across the deck, a ship must leave the lip, fly the gap, land on the far deck and
 * settle back to hover height without a respawn. A ship far too slow falls into the respawn net and comes
 * back on the landing side, never in front of the ramp it just failed.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CONFIG, SHIP_ROSTER } from '../core/config';
import type { ControlInput, GridSlot, ShipId, TrackData } from '../core/contracts';
import { clamp, wrap01 } from '../core/math';
import { EventBus, type GameEvents } from '../core/events';
import { TRACK_DEFS } from '../content/tracks';
import { PhysicsSystem } from '../physics';
import { trackFromSource } from '../track';

vi.setConfig({ testTimeout: 300_000 });

const track: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['sunset-mesa'] });

function slotAt(u: number, lateral: number): GridSlot {
  const s = track.sampleAt(u);
  const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
  const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
  return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
}

/** Metres from a to b going forward around the lap. */
function ahead(a: number, b: number): number {
  return wrap01(b - a) * track.length;
}

interface Run {
  respawns: number;
  jumps: number;
  lands: number;
  landIntensity: number;
  airSteps: number;
  maxLateral: number;
  worstSettledHeightErr: number;
  respawnDistances: number[];
  speedAtLip: number;
  /** Lowest hover height in the second after touchdown (the spring must catch the hull above the deck). */
  minHeightAfterLand: number;
  /** Metres flown from the lip to touchdown. */
  flight: number;
}

async function runJump(jumpIndex: number, speed: number, lateral: number, opts: { boost?: boolean; coast?: boolean } = {}): Promise<Run> {
  const j = track.jumps[jumpIndex];
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus);
  const ship = physics.addShip(SHIP_ROSTER[0], track.startGrid[0]);
  const startU = wrap01((j.dTakeoff - 140) / track.length);
  physics.resetShip(0, slotAt(startU, lateral));
  ship.status = 'racing';
  ship.boostUnlocked = true;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
  ship.velocity.copy(fwd).multiplyScalar(speed);

  const run: Run = { respawns: 0, jumps: 0, lands: 0, landIntensity: 0, airSteps: 0, maxLateral: 0, worstSettledHeightErr: 0, respawnDistances: [], speedAtLip: 0, minHeightAfterLand: Infinity, flight: 0 };
  let t = 0;
  let landedAt = -1;
  bus.on('ship:respawn', () => {
    run.respawns++;
    run.respawnDistances.push(ship.trackU * track.length);
  });
  bus.on('ship:jump', () => run.jumps++);
  bus.on('ship:land', (e) => {
    run.lands++;
    landedAt = t;
    run.flight = ahead(j.uTakeoff, ship.trackU);
    run.landIntensity = Math.max(run.landIntensity, e.intensity);
  });

  const controls = new Map<ShipId, ControlInput>();
  const uLip = j.uTakeoff;
  const endAt = j.dLanding + 220;
  let prevLat = ship.lateral;
  for (let i = 0; i < 120 * 14; i++) {
    const rel = ahead(startU, ship.trackU);
    if (rel > endAt - (j.dTakeoff - 140) && rel < track.length / 2) break;
    const latVel = (ship.lateral - prevLat) / CONFIG.FIXED_DT;
    prevLat = ship.lateral;
    const steer = clamp(0.06 * (lateral - ship.lateral) - 0.05 * latVel, -1, 1);
    if (opts.boost) {
      ship.boosting = true;
      ship.boostTimer = 5;
    }
    const over = ship.forwardSpeed - speed;
    const throttle = opts.coast ? 0 : opts.boost ? 1 : clamp(0.5 - over / 4, 0, 1);
    const brake = opts.coast || opts.boost ? 0 : clamp((over - 3) / 10, 0, 1);
    controls.set(0, { throttle, brake, steer, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
    const before = ship.trackU;
    physics.step(CONFIG.FIXED_DT, controls);
    t += CONFIG.FIXED_DT;
    if (ahead(before, uLip) < ahead(before, ship.trackU) && ahead(before, ship.trackU) < 50) run.speedAtLip = ship.speed;
    if (track.surfaceKindAt(ship.trackU, ship.lateral) === 'air' && ship.airborne) run.airSteps++;
    if (ship.status === 'racing') run.maxLateral = Math.max(run.maxLateral, Math.abs(ship.lateral));
    const past = ahead(j.uLanding, ship.trackU);
    if (landedAt >= 0 && t - landedAt < 1) run.minHeightAfterLand = Math.min(run.minHeightAfterLand, ship.heightAboveTrack);
    if (landedAt >= 0 && t - landedAt > 0.6 && past < 400) {
      run.worstSettledHeightErr = Math.max(run.worstSettledHeightErr, Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT));
    }
  }
  physics.dispose();
  return run;
}

const CASES: Array<[string, number, boolean]> = [
  ['slow exit', 100, false],
  ['cruise', 125, false],
  ['top speed', 140, false],
  ['boosting', 185, true],
];

describe.each([0, 1])('Sunset Mesa jump %i', (jumpIndex) => {
  describe.each(CASES)('%s (%i m/s)', (_name, speed, boost) => {
    it.each([-7, 0, 7])('clears the gap at lateral %i m and settles on the far deck', async (lateral) => {
      const r = await runJump(jumpIndex, speed, lateral, { boost });
      console.log(
        `jump ${jumpIndex} v=${speed} lat=${lateral}: lip=${r.speedAtLip.toFixed(0)}m/s air=${r.airSteps} jumps=${r.jumps} lands=${r.lands} ` +
          `flight=${r.flight.toFixed(0)}m landI=${r.landIntensity.toFixed(2)} minH=${r.minHeightAfterLand.toFixed(2)} settledErr=${r.worstSettledHeightErr.toFixed(2)} maxLat=${r.maxLateral.toFixed(1)} respawns=${r.respawns}`,
      );
      expect(r.respawns).toBe(0);
      expect(r.airSteps).toBeGreaterThan(10);
      expect(r.jumps).toBe(1);
      expect(r.lands).toBe(1);
      expect(r.minHeightAfterLand).toBeGreaterThan(0.3);
      expect(r.worstSettledHeightErr).toBeLessThan(0.6);
      expect(r.maxLateral).toBeLessThan(track.halfWidth);
    });
  });
});

describe('missed jump', () => {
  it('a ship far too slow falls into the respawn net and returns on the landing side', async () => {
    const j = track.jumps[1];
    const r = await runJump(1, 45, 0, { coast: true });
    console.log(`missed: respawns=${r.respawns} at ${r.respawnDistances.map((d) => d.toFixed(0)).join(',')} (landing ${j.dLanding.toFixed(0)})`);
    expect(r.respawns).toBe(1);
    expect(r.respawnDistances[0]).toBeGreaterThan(j.dLanding);
    expect(r.respawnDistances[0]).toBeLessThan(j.dLanding + 60);
  });
});
