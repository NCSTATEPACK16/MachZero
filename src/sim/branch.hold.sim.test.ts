/**
 * Integration: Jade Ruins' split path with real physics. A ship that keeps to the shortcut's side of the main
 * road at the fork must change road onto the shortcut, drive it and rejoin the main road at the merge, at a slow
 * and a racing speed, with no respawn, never airborne, its race progress never going backwards, and arriving
 * well ahead of a ship that stays on the main road. A ship on the other half stays on the main road past the
 * fork. A ship driven off the shortcut's open edge is respawned on the shortcut, where it left it.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CONFIG, SHIP_ROSTER } from '../core/config';
import type { AITier, ControlInput, GridSlot, ShipId, TrackData } from '../core/contracts';
import { clamp, wrap01 } from '../core/math';
import { EventBus, type GameEvents } from '../core/events';
import { TRACK_DEFS } from '../content/tracks';
import { PhysicsSystem } from '../physics';
import { trackFromSource } from '../track';
import type { BuiltBranch } from '../track/features/branch';
import { AIDriver, shortcutOdds } from '../game/AIDriver';
import { gateClosure } from '../track/features/gate';

vi.setConfig({ testTimeout: 60_000 });

const track: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['jade-ruins'] });
const branch = track.branches[0] as BuiltBranch;
const L = track.length;
const SHORTCUT_LAT = branch.side * (track.halfWidth - branch.halfWidth);

function slotAt(u: number, lateral: number): GridSlot {
  const s = track.sampleAt(u);
  const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
  const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
  return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
}

/** Main-loop metres, unwrapped so the fork-to-merge stretch is increasing. */
const unwrap = (u: number): number => {
  let d = u * L;
  if (d < branch.dFork - L / 2) d += L;
  return d;
};

interface Run {
  /** Roads in the order driven (consecutive duplicates removed). */
  roads: (string | null)[];
  branchSteps: number;
  respawns: number;
  airborne: number;
  worstHeightErr: number;
  /** Largest backward step of race progress (m). */
  worstRegress: number;
  /** Seconds from the start to `endD`, or Infinity. */
  time: number;
  speedOut: number;
  /** Branch metres where the ship was put back after its first respawn (NaN if none / not on the branch). */
  respawnS: number;
  respawnPath: string | null | undefined;
  /** Branch metres where the ship last had |lateral| ≤ halfWidth before its first respawn. */
  leftAtS: number;
}

/**
 * Drive from 150 m before the fork at `startLateral` on the main road to `endD` (main metres). `target` gives the
 * wanted lateral on the current road; speed is held near `speed`. `forkLat` is the shortcut's centreline in main
 * lateral while the ship is on the main road near the fork (NaN elsewhere): following it takes the shortcut.
 */
type Target = (path: string | null, pathS: number, forkLat: number, respawns: number) => number;
async function drive(speed: number, startLateral: number, endD: number, target: Target): Promise<Run> {
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus);
  const ship = physics.addShip(SHIP_ROSTER[0], track.startGrid[0]);
  physics.resetShip(0, slotAt(wrap01((branch.dFork - 150) / L), startLateral));
  ship.status = 'racing';
  ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(speed);
  const run: Run = {
    roads: [null],
    branchSteps: 0,
    respawns: 0,
    airborne: 0,
    worstHeightErr: 0,
    worstRegress: 0,
    time: Infinity,
    speedOut: 0,
    respawnS: NaN,
    respawnPath: undefined,
    leftAtS: NaN,
  };
  let respawned = false;
  bus.on('ship:respawn', () => {
    run.respawns++;
    respawned = true;
  });

  const controls = new Map<ShipId, ControlInput>();
  let prevLat = ship.lateral;
  let prevPath = ship.path;
  let prevD = unwrap(ship.trackU);
  let lastS = 0;
  for (let i = 0; i < 120 * 30; i++) {
    if (ship.path !== prevPath) prevLat = ship.lateral; // a road change re-bases lateral
    prevPath = ship.path;
    const latVel = (ship.lateral - prevLat) / CONFIG.FIXED_DT;
    prevLat = ship.lateral;
    const pathS = ship.path ? branch.project(ship.position, lastS).s : 0;
    let forkLat = NaN;
    const dNow = unwrap(ship.trackU);
    if (!ship.path && dNow > branch.dFork - 20 && dNow < branch.dSepFork + 40) {
      // Aim at the shortcut's centre half a second ahead (main is straight here, so its right is constant).
      const c = branch.sampleAt(branch.project(ship.position).s + 0.5 * Math.max(ship.forwardSpeed, 0)).position;
      const m = track.sampleAt(ship.trackU);
      forkLat = c.clone().sub(m.position).dot(m.right);
    }
    const err = target(ship.path, pathS, forkLat, run.respawns) - ship.lateral;
    const steer = clamp(0.15 * err - 0.06 * latVel, -1, 1);
    const over = ship.forwardSpeed - speed;
    controls.set(0, { throttle: clamp(0.5 - over / 4, 0, 1), brake: clamp((over - 3) / 10, 0, 1), steer, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
    physics.step(CONFIG.FIXED_DT, controls);

    if (respawned) {
      respawned = false;
      if (run.respawns > 1) continue;
      run.respawnPath = ship.path;
      run.respawnS = ship.path ? branch.project(ship.position, lastS).s : NaN;
      prevLat = ship.lateral;
    }
    if (ship.path) {
      lastS = branch.project(ship.position, lastS).s;
      if (Math.abs(ship.lateral) <= branch.halfWidth && run.respawns === 0) run.leftAtS = lastS;
    }
    if (run.roads[run.roads.length - 1] !== ship.path) run.roads.push(ship.path);
    if (ship.path) run.branchSteps++;
    if (!ship.grounded) run.airborne++;
    run.worstHeightErr = Math.max(run.worstHeightErr, Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT));
    const d = unwrap(ship.trackU);
    run.worstRegress = Math.max(run.worstRegress, prevD - d);
    prevD = d;
    if (d >= endD) {
      run.time = (i + 1) * CONFIG.FIXED_DT;
      break;
    }
  }
  run.speedOut = ship.speed;
  physics.dispose();
  return run;
}

function report(name: string, r: Run): void {
  console.log(
    `branch ${name}: roads=${r.roads.map((p) => p ?? 'main').join('>')} branchSteps=${r.branchSteps} heightErr=${r.worstHeightErr.toFixed(2)} ` +
      `regress=${r.worstRegress.toFixed(2)}m airborne=${r.airborne} respawns=${r.respawns} time=${r.time.toFixed(2)}s vOut=${r.speedOut.toFixed(0)}` +
      (r.respawns ? ` leftAt=${r.leftAtS.toFixed(0)}m respawnAt=${r.respawnS.toFixed(0)}m on ${r.respawnPath ?? 'main'}` : ''),
  );
}

const pastMerge = branch.dMerge + 100;
/** Keep to the shortcut's half of the main deck, follow its centreline off the main road, then hold that line. */
const takeShortcut: Target = (path, _s, forkLat) => (path ? 0 : Number.isNaN(forkLat) ? SHORTCUT_LAT : Math.max(SHORTCUT_LAT, forkLat));

describe('Jade Ruins split path', () => {
  describe.each([
    ['slow', 70],
    ['racing', 125],
  ])('%s (%i m/s)', (_name, speed) => {
    it('takes the shortcut on its side of the fork and rejoins the main road at the merge', async () => {
      // Keep to the shortcut's half of the main deck, the shortcut's centre on it, then the same line on main.
      const r = await drive(speed, SHORTCUT_LAT, pastMerge, takeShortcut);
      report(`shortcut v=${speed}`, r);
      expect(r.roads).toEqual([null, 'shortcut', null]);
      expect(r.branchSteps * CONFIG.FIXED_DT * speed).toBeGreaterThan(branch.length * 0.9);
      expect(r.respawns).toBe(0);
      expect(r.airborne).toBe(0);
      expect(r.worstHeightErr).toBeLessThan(0.6);
      expect(r.worstRegress).toBeLessThan(0.05);
      expect(r.speedOut).toBeGreaterThan(speed * 0.85);
    });
  });

  it('stays on the main road past the fork on the other half', async () => {
    const r = await drive(70, -SHORTCUT_LAT, branch.dSepFork + 60, () => -SHORTCUT_LAT);
    report('main past fork', r);
    expect(r.roads).toEqual([null]);
    expect(r.respawns).toBe(0);
    expect(r.time).toBeLessThan(Infinity);
  });

  it('the shortcut is the quicker way from fork to merge', async () => {
    const speed = 90;
    const short = await drive(speed, SHORTCUT_LAT, pastMerge, takeShortcut);
    // The main road through the temple bends: hold the centre line (no gates yet in this test).
    const main = await drive(speed, -SHORTCUT_LAT, pastMerge, (path) => (path ? 0 : -2));
    report('race shortcut', short);
    report('race main', main);
    expect(main.roads).toEqual([null]);
    expect(main.respawns).toBe(0);
    expect(short.respawns).toBe(0);
    // Same speed: the time saved is the length saved (≈ 170 m) over the speed, less steering losses.
    expect(main.time - short.time).toBeGreaterThan((0.7 * (branch.dMerge - branch.dFork - branch.length)) / speed);
  });

  it('respawns on the shortcut, where it left it, after driving off the open edge', async () => {
    const e = branch.openEdge!;
    const sOff = (e.sFrom + e.sTo) / 2;
    const r = await drive(70, SHORTCUT_LAT, pastMerge, (path, s, forkLat, respawns) =>
      // Off the open edge once; after the respawn, drive on down the shortcut and rejoin.
      path && s > sOff && respawns === 0 ? e.side * (branch.halfWidth + 12) : takeShortcut(path, s, forkLat, respawns));
    report('off the edge', r);
    expect(r.respawns).toBe(1);
    expect(r.respawnPath).toBe('shortcut');
    expect(r.roads).toEqual([null, 'shortcut', null]);
    expect(Math.abs(r.respawnS - r.leftAtS)).toBeLessThan(15);
    expect(r.leftAtS).toBeGreaterThan(e.sFrom);
    expect(r.leftAtS).toBeLessThan(e.sTo);
  });

  /**
   * An AI driver from 400 m before the fork at 80 m/s, with the gate clock started at `t0` (the shortcut's gate is
   * shut for 2.1 s of every 7 s); returns the roads driven.
   */
  async function aiRun(tier: AITier, t0: number): Promise<{ roads: (string | null)[]; respawns: number; regress: number; reached: boolean; gateHits: number; closureAtGate: number }> {
    const bus = new EventBus<GameEvents>();
    const physics = await PhysicsSystem.create(track, bus);
    while (physics.hazardTime < t0) physics.step(CONFIG.FIXED_DT, new Map());
    const ship = physics.addShip({ ...SHIP_ROSTER[0], tier }, track.startGrid[0]);
    physics.resetShip(0, slotAt(wrap01((branch.dFork - 400) / L), 0));
    ship.status = 'racing';
    ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(80);
    const ai = new AIDriver(ship, track, 'steady', 12345, [ship], { hazardClock: () => physics.hazardTime });
    let respawns = 0;
    let gateHits = 0;
    bus.on('ship:respawn', () => respawns++);
    bus.on('hazard:gate', () => gateHits++);
    const roads: (string | null)[] = [null];
    const controls = new Map<ShipId, ControlInput>();
    let regress = 0;
    let prevD = unwrap(ship.trackU);
    const gate = physics.gates.find((g) => g.branch === branch.id)!;
    let closureAtGate = Number.NaN;
    for (let i = 0; i < 120 * 40; i++) {
      controls.set(0, ai.update(CONFIG.FIXED_DT));
      physics.step(CONFIG.FIXED_DT, controls);
      if (roads[roads.length - 1] !== ship.path) roads.push(ship.path);
      if (ship.path === branch.id && Number.isNaN(closureAtGate) && ship.pathS > gate.d) closureAtGate = gateClosure(gate, physics.hazardTime);
      const d = unwrap(ship.trackU);
      regress = Math.max(regress, prevD - d);
      prevD = d;
      if (d > pastMerge) break;
    }
    physics.dispose();
    const r = { roads, respawns, regress, reached: prevD > pastMerge, gateHits, closureAtGate };
    console.log(`branch AI ${tier} t0=${t0}: roads=${roads.map((p) => p ?? 'main').join('>')} respawns=${respawns} gateHits=${gateHits} regress=${regress.toFixed(2)}m reached=${r.reached}`);
    return r;
  }

  // The AI reaches the shortcut's gate ≈ 5.5 s after the start: t0 = 5 puts that in the open part of the gate's
  // cycle, t0 = 1.5 while it is shut.
  it.each([
    ['legend', 5, [null, 'shortcut', null]],
    ['legend', 1.5, [null]],
    ['rookie', 5, [null]],
  ] as [AITier, number, (string | null)[]][])('an AI driver (%s, gate clock from %f s) drives %j', async (tier, t0, expected) => {
    const r = await aiRun(tier, t0);
    expect(r.reached).toBe(true);
    expect(r.respawns).toBe(0);
    expect(r.gateHits).toBe(0);
    expect(r.regress).toBeLessThan(0.05);
    expect(r.roads).toEqual(expected);
    if (expected.includes('shortcut')) expect(r.closureAtGate).toBe(0);
  });

  it('shortcut odds follow the tier table (Rookie never, Legend always, PIXEL a coin flip, aggressive lean in)', () => {
    expect(shortcutOdds('rookie', 'aggressive')).toBe(0);
    expect(shortcutOdds('legend', 'steady')).toBe(1);
    expect(shortcutOdds('pilot', 'steady')).toBeCloseTo(0.3);
    expect(shortcutOdds('ace', 'steady')).toBeCloseTo(0.6);
    expect(shortcutOdds('ace', 'aggressive')).toBeGreaterThan(0.6);
    expect(shortcutOdds('pilot', 'erratic')).toBe(0.5);
  });
});
