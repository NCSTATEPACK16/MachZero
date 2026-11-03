/**
 * Integration: the Drop Mine and the Shield with real physics (IMPLEMENTATION §P). A ship that drives into a
 * dropped mine gets the track-mine hit (knock, MINE_DAMAGE) with `owner` set; a raised shield takes the hit
 * instead and drops. An AI driver steers round a dropped mine on its line (Rookies look less far ahead, but still
 * clear one on a straight); without the live mines it drives straight into it, so the avoidance is what saves it.
 * CPU items are seeded: the same Legend race twice gives the same standings and the same item use.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CONFIG, SHIP_ROSTER } from '../core/config';
import type { AITier, ControlInput, GridSlot, ShipId, TrackData } from '../core/contracts';
import { clamp, wrap01 } from '../core/math';
import { EventBus, type GameEvents } from '../core/events';
import { TRACK_DEFS } from '../content/tracks';
import { AIDriver } from '../game';
import { PhysicsSystem } from '../physics';
import type { MineField } from '../physics/MineField';
import { trackFromSource } from '../track';
import { runWorldRace } from './worldRace';

vi.setConfig({ testTimeout: 60_000 });

const track: TrackData = trackFromSource({ kind: 'authored', def: TRACK_DEFS['neon-bay'] });
const L = track.length;
const DT = CONFIG.FIXED_DT;

function slotAt(u: number, lateral: number): GridSlot {
  const s = track.sampleAt(u);
  const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
  const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
  return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
}

/** Start (m) of the longest straight on Neon Bay: the road heading 300 m on stays within ~6° of here. */
const STRAIGHT = (() => {
  let best = 0;
  let bestDot = -1;
  for (let d = 0; d < L; d += 10) {
    let dot = 1;
    const a = track.sampleAt(d / L).forward;
    for (let k = 20; k <= 300; k += 20) dot = Math.min(dot, a.dot(track.sampleAt((d + k) / L).forward));
    if (dot > bestDot) {
      bestDot = dot;
      best = d;
    }
  }
  return best;
})();

/** Throttle to hold `speed`, steer for `lateral`. */
function hold(ship: { forwardSpeed: number; lateral: number }, speed: number, lateral: number, latVel: number): ControlInput {
  return { throttle: clamp(0.5 - (ship.forwardSpeed - speed) / 4, 0, 1), brake: 0, steer: clamp(0.15 * (lateral - ship.lateral) - 0.06 * latVel, -1, 1), airbrakeLeft: 0, airbrakeRight: 0, boost: false };
}

describe('Drop Mine and Shield in physics', () => {
  async function runIntoDroppedMine(shielded: boolean) {
    const bus = new EventBus<GameEvents>();
    const physics = await PhysicsSystem.create(track, bus);
    const lead = physics.addShip(SHIP_ROSTER[0], track.startGrid[0]);
    const chaser = physics.addShip(SHIP_ROSTER[1], track.startGrid[1]);
    physics.resetTime();
    physics.resetShip(0, slotAt(wrap01((STRAIGHT + 60) / L), 0));
    physics.resetShip(1, slotAt(wrap01(STRAIGHT / L), 0));
    for (const s of [lead, chaser]) {
      s.status = 'racing';
      s.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(s.quaternion)).multiplyScalar(60);
    }
    chaser.shield = shielded ? 8 : 0;
    const mines: GameEvents['hazard:mine'][] = [];
    const blocks: GameEvents['item:shield'][] = [];
    bus.on('hazard:mine', (e) => mines.push(e));
    bus.on('item:shield', (e) => blocks.push(e));
    const e0 = chaser.energy;
    const controls = new Map<ShipId, ControlInput>();
    const prev = [lead.lateral, chaser.lateral];
    let dropped = -1;
    for (let i = 0; i < 3 * 120; i++) {
      [lead, chaser].forEach((s, k) => {
        controls.set(s.def.id, hold(s, 60, 0, (s.lateral - prev[k]) / DT));
        prev[k] = s.lateral;
      });
      physics.step(DT, controls);
      if (i === 10) dropped = physics.dropMine(0)!;
    }
    const field = (physics as unknown as { mineField: MineField }).mineField;
    const left = field.mines[dropped].armed;
    physics.dispose();
    return { mines, blocks, energyLost: e0 - chaser.energy, shield: chaser.shield, left, dropped };
  }

  it('a dropped mine hits the ship behind like a track mine, with its owner, and is gone', async () => {
    const r = await runIntoDroppedMine(false);
    expect(r.mines).toHaveLength(1);
    expect(r.mines[0]).toMatchObject({ shipId: 1, owner: 0, mine: r.dropped });
    expect(r.energyLost).toBeCloseTo(CONFIG.MINE_DAMAGE, 0);
    expect(r.left).toBe(false);
    expect(r.blocks).toEqual([]);
  });

  it('a raised shield blocks it and drops; no knock, no damage', async () => {
    const r = await runIntoDroppedMine(true);
    expect(r.mines).toEqual([]);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toMatchObject({ shipId: 1, blocked: 'mine' });
    expect(r.energyLost).toBeLessThan(0.5);
    expect(r.shield).toBe(0);
    expect(r.left).toBe(false);
  });
});

describe('AI and dropped mines', () => {
  /**
   * An AI driver onto the straight. With `mine`, a mine is dropped there 1 s in (at main-loop u, lateral); without,
   * the run records where the driver crosses `probeU` (its line), so the mine can be laid dead on it.
   */
  async function aiRun(tier: AITier, live: boolean, mine: { u: number; lateral: number } | null, probeU = 0) {
    const bus = new EventBus<GameEvents>();
    const physics = await PhysicsSystem.create(track, bus);
    const ship = physics.addShip({ ...SHIP_ROSTER[1], tier }, track.startGrid[0]);
    const ai = new AIDriver(ship, track, 'steady', 7, [ship], { hazardClock: () => physics.hazardTime, ...(live ? { liveMines: () => physics.mines } : {}) });
    physics.resetTime();
    physics.resetShip(ship.def.id, slotAt(wrap01((STRAIGHT - 200) / L), 0));
    ship.status = 'racing';
    ship.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion)).multiplyScalar(90);
    let hits = 0;
    bus.on('hazard:mine', () => hits++);
    const controls = new Map<ShipId, ControlInput>();
    const field = (physics as unknown as { mineField: MineField }).mineField;
    let uAtDrop = 0;
    let crossed: number | null = null;
    for (let i = 0; i < 6 * 120; i++) {
      const before = ship.trackU;
      controls.set(ship.def.id, ai.update(DT));
      physics.step(DT, controls);
      if (i === 120) {
        uAtDrop = ship.trackU;
        if (mine) field.drop(5, mine.u, mine.lateral, physics.hazardTime);
      }
      if (crossed === null && i > 120 && wrap01(probeU - before) < 0.5 && wrap01(ship.trackU - probeU) < 0.5) crossed = ship.lateral;
    }
    physics.dispose();
    return { hits, uAtDrop, crossed };
  }

  it.each<[AITier, number]>([
    ['legend', 120],
    ['rookie', 120],
  ])('a %s driver steers round a mine dropped %i m ahead on its line', async (tier, ahead) => {
    const first = await aiRun(tier, true, null);
    const probeU = wrap01(first.uAtDrop + ahead / L);
    const path = await aiRun(tier, true, null, probeU);
    const mine = { u: probeU, lateral: path.crossed! };
    const blind = await aiRun(tier, false, mine);
    const seen = await aiRun(tier, true, mine);
    console.log(`AI ${tier} mine ${ahead} m ahead at lateral ${mine.lateral.toFixed(2)}: blind hits=${blind.hits}, seeing hits=${seen.hits}`);
    expect(blind.hits).toBe(1);
    expect(seen.hits).toBe(0);
  });
});

describe('CPU items in a race', () => {
  it('a Legend race with CPU items replays exactly (seeded), uses every kind, and Rookie CPUs carry none', async () => {
    const a = await runWorldRace('neon-bay', 'legend');
    const b = await runWorldRace('neon-bay', 'legend');
    console.log(a.table);
    expect(a.finished).toBe(true);
    expect(b.standings).toEqual(a.standings);
    expect(b.itemUses).toEqual(a.itemUses);
    expect(a.itemUses.emp + a.itemUses.shield + a.itemUses.mine).toBeGreaterThan(0);
    const rookie = await runWorldRace('neon-bay', 'rookie');
    expect(rookie.itemUses).toEqual({ emp: 0, shield: 0, mine: 0, blocked: 0, empHits: 0 });
  });
});
