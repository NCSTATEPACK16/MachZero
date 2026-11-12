/**
 * Integration: a crosswind zone with real physics (the Tempest Spire gimmick, IMPLEMENTATION §X4). The zone is put
 * on the longest plain straight of Neon Bay, so this test needs no other part of the new world.
 *  - A ship that steers holds its line through the zone, at a slow and at a racing speed, on three lines.
 *  - A ship that does nothing is pushed a few metres downwind and stays inside the rails.
 *  - Aero parts cut the push (ShipStats.pushScale): the Prototype drifts less than Stock.
 *  - The gust runs on the hazard clock, so the same run twice is identical.
 *  - No gust, no push; and a ship in the air is not pushed.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CONFIG, SHIP_ROSTER } from '../core/config';
import type { ControlInput, GridSlot, ShipDefinition, ShipId, TrackData, TrackDefinition } from '../core/contracts';
import { clamp, wrap01 } from '../core/math';
import { EventBus, type GameEvents } from '../core/events';
import { TRACK_DEFS } from '../content/tracks';
import { AERO_EFFECTS } from '../content/parts';
import { PhysicsSystem } from '../physics';
import { trackFromSource } from '../track';
import { windGust } from '../track/features/wind';

vi.setConfig({ testTimeout: 60_000 });

const ZONE_LENGTH = 280;
const ACCEL = 7;

/** The longest stretch of Neon Bay that is straight and has no feature on it: [start, end] in metres. */
function plainStraight(track: TrackData): [number, number] {
  const L = track.length;
  const busy = track.features.flatMap((f) => ('dStart' in f ? [[f.dStart - 80, f.dEnd + 80] as [number, number]] : []));
  let best: [number, number] = [0, 0];
  let from = -1;
  for (let d = 300; d < L - 150; d += 5) {
    const ok = Math.abs(track.sampleAt(d / L).curvature) < 1 / 2000 && !busy.some(([a, b]) => d >= a && d <= b);
    if (ok && from < 0) from = d;
    if ((!ok || d + 5 >= L - 150) && from >= 0) {
      if (d - from > best[1] - best[0]) best = [from, d];
      from = -1;
    }
  }
  return best;
}

const base = trackFromSource({ kind: 'authored', def: TRACK_DEFS['neon-bay'] });
const straight = plainStraight(base);
const zoneStart = straight[0] + 90;
const zoneEnd = zoneStart + ZONE_LENGTH;

function windTrack(dir: 1 | -1, duty: number): TrackData {
  const def: TrackDefinition = {
    ...TRACK_DEFS['neon-bay'],
    id: 'wind-hold',
    features: [...TRACK_DEFS['neon-bay'].features, { type: 'wind', dStart: zoneStart, dEnd: zoneEnd, dir, accel: ACCEL, period: 20, phase: 0, duty }],
  };
  return trackFromSource({ kind: 'authored', def });
}

// The gust blows from 0.5 s to 17.5 s of each 20 s cycle: on for every run below.
const windy = windTrack(1, 0.9);
const windyLeft = windTrack(-1, 0.9);
const calm = windTrack(1, 0);
const L = windy.length;

function slotAt(track: TrackData, u: number, lateral: number): GridSlot {
  const s = track.sampleAt(u);
  const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
  const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
  return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
}

interface Run {
  /** Lateral on entering and on leaving the zone, and the furthest from the line inside it. */
  latIn: number;
  latOut: number;
  worstOff: number;
  maxAbsLateral: number;
  railHits: number;
  respawns: number;
  windEvents: { active: boolean; dir: number }[];
  /** Every step's lateral, for the determinism check. */
  trace: number[];
}

interface RunOpts {
  track?: TrackData;
  def?: ShipDefinition;
  /** Steer for the line (default) or leave the stick alone. */
  handsOff?: boolean;
  /** Lift the ship this high above the deck through the zone (it is then not grounded). */
  lift?: number;
}

async function runZone(speed: number, lateral: number, opts: RunOpts = {}): Promise<Run> {
  const track = opts.track ?? windy;
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus);
  const ship = physics.addShip(opts.def ?? SHIP_ROSTER[0], track.startGrid[0]);
  physics.resetTime();
  // 70 m before the zone: the gust is at full strength before the slowest ship reaches it.
  physics.resetShip(0, slotAt(track, wrap01((zoneStart - 70) / L), lateral));
  ship.status = 'racing';
  ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(speed);
  const run: Run = { latIn: NaN, latOut: NaN, worstOff: 0, maxAbsLateral: 0, railHits: 0, respawns: 0, windEvents: [], trace: [] };
  bus.on('ship:railHit', () => run.railHits++);
  bus.on('ship:respawn', () => run.respawns++);
  bus.on('ship:wind', (e) => run.windEvents.push({ active: e.active, dir: e.dir }));
  const controls = new Map<ShipId, ControlInput>();
  let prevLat = ship.lateral;
  for (let i = 0; i < 120 * 12; i++) {
    const d = ship.trackU * L;
    if (d > zoneEnd + 40) break;
    const latVel = (ship.lateral - prevLat) / CONFIG.FIXED_DT;
    prevLat = ship.lateral;
    const over = ship.forwardSpeed - speed;
    const steer = opts.handsOff ? 0 : clamp(0.15 * (lateral - ship.lateral) - 0.06 * latVel, -1, 1);
    controls.set(0, { throttle: clamp(0.5 - over / 4, 0, 1), brake: clamp((over - 3) / 10, 0, 1), steer, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
    if (opts.lift) {
      // Hold the hull above the hover rays' reach (10 m): they find no deck, so the ship is not grounded.
      const s = track.sampleAt(ship.trackU);
      const p = ship.position.clone().addScaledVector(s.up, opts.lift - ship.heightAboveTrack);
      physics.bodyOf(0)!.setTranslation(p, true);
      ship.position.copy(p);
    }
    physics.step(CONFIG.FIXED_DT, controls);
    const dNow = ship.trackU * L;
    run.trace.push(ship.lateral);
    if (dNow < zoneStart) run.latIn = ship.lateral;
    if (dNow >= zoneStart && dNow <= zoneEnd) {
      run.latOut = ship.lateral;
      run.worstOff = Math.max(run.worstOff, Math.abs(ship.lateral - lateral));
      run.maxAbsLateral = Math.max(run.maxAbsLateral, Math.abs(ship.lateral));
    }
  }
  physics.dispose();
  return run;
}

function aeroShip(tier: 0 | 3): ShipDefinition {
  const d = SHIP_ROSTER[0];
  return { ...d, stats: { ...d.stats, pushScale: d.stats.pushScale * AERO_EFFECTS.pushScale[tier] } };
}

describe('crosswind zone', () => {
  it('the test zone is on a long plain straight, and its gust is on from 0.5 s', () => {
    expect(straight[1] - straight[0]).toBeGreaterThan(ZONE_LENGTH + 130);
    expect(windGust({ period: 20, phase: 0, duty: 0.9 }, 0.6)).toBeGreaterThan(0.99);
    expect(windGust({ period: 20, phase: 0, duty: 0.9 }, 19)).toBe(0);
  });

  describe.each([
    ['slow', 70],
    ['racing', 125],
  ])('%s (%i m/s)', (_name, speed) => {
    it.each([-8, 0, 8])('a steering ship holds its line at lateral %i m', async (lateral) => {
      const r = await runZone(speed, lateral);
      console.log(`wind hold v=${speed} lat=${lateral}: worstOff=${r.worstOff.toFixed(2)} out=${r.latOut.toFixed(2)} railHits=${r.railHits}`);
      expect(r.worstOff).toBeLessThan(1.5);
      expect(r.railHits).toBe(0);
      expect(r.respawns).toBe(0);
    });

    it('a hands-off ship is pushed downwind and stays inside the rails', async () => {
      const r = await runZone(speed, 0, { handsOff: true });
      const drift = r.latOut - r.latIn;
      console.log(`wind hands-off v=${speed}: drift=${drift.toFixed(2)} m maxLat=${r.maxAbsLateral.toFixed(2)}`);
      // About 3 m at the pace a zone is driven at; a slower ship is in the wind for longer.
      expect(drift).toBeGreaterThan(speed > 100 ? 1.5 : 2);
      expect(drift).toBeLessThan(speed > 100 ? 3 : 4.5);
      expect(r.maxAbsLateral).toBeLessThan(windy.halfWidth - CONFIG.SHIP_WIDTH / 2);
      expect(r.railHits).toBe(0);
    });
  });

  it('the push follows the zone direction', async () => {
    const r = await runZone(100, 0, { handsOff: true, track: windyLeft });
    expect(r.latOut - r.latIn).toBeLessThan(-1.5);
    expect(r.windEvents[0]).toEqual({ active: true, dir: -1 });
  });

  it('Aero Prototype is pushed less than Stock', async () => {
    const stock = await runZone(100, 0, { handsOff: true, def: aeroShip(0) });
    const proto = await runZone(100, 0, { handsOff: true, def: aeroShip(3) });
    const a = stock.latOut - stock.latIn;
    const b = proto.latOut - proto.latIn;
    console.log(`wind aero: stock drift=${a.toFixed(2)} m, prototype drift=${b.toFixed(2)} m`);
    expect(b).toBeLessThan(a * 0.8);
    expect(b).toBeGreaterThan(a * 0.6);
  });

  it('with no gust there is no push and no wind event', async () => {
    const r = await runZone(100, 0, { handsOff: true, track: calm });
    // The straight itself moves a hands-off ship by a few centimetres.
    expect(Math.abs(r.latOut - r.latIn)).toBeLessThan(0.2);
    expect(r.windEvents).toEqual([]);
  });

  it('a ship in the air is not pushed', async () => {
    const r = await runZone(100, 0, { handsOff: true, lift: 12 });
    expect(Math.abs(r.latOut - r.latIn)).toBeLessThan(0.3);
  });

  it('tells the ship when the gust starts and stops pushing it', async () => {
    const r = await runZone(100, 0);
    expect(r.windEvents).toEqual([
      { active: true, dir: 1 },
      { active: false, dir: 1 },
    ]);
  });

  it('the same run twice is identical (the gust is on the hazard clock)', async () => {
    const a = await runZone(125, 4, { handsOff: true });
    const b = await runZone(125, 4, { handsOff: true });
    expect(b.trace).toEqual(a.trace);
  });
});
