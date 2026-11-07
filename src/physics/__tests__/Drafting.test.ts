import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ShipState } from '../../core/contracts';
import { EventBus, type GameEvents } from '../../core/events';
import { makeShip } from '../../game/__tests__/helpers';
import { DRAFT, Drafting, inDraftWindow } from '../Drafting';

const DT = 1 / 120;

/** A racing ship at (x, y, z) facing -Z (its forward), moving at 100 m/s. */
function at(id: number, x: number, z: number, y = 0, yawDeg = 0): ShipState {
  const s = makeShip(id);
  s.status = 'racing';
  s.position.set(x, y, z);
  s.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (yawDeg * Math.PI) / 180);
  s.forwardSpeed = 100;
  s.speed = 100;
  return s;
}

function run(d: Drafting, ships: ShipState[], seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) d.update(ships, DT);
}

describe('Drafting window', () => {
  it('needs the leader within 30 m directly ahead, ±12° and ±4 m', () => {
    const me = at(0, 0, 0);
    expect(inDraftWindow(me, at(1, 0, -10))).toBe(true);
    expect(inDraftWindow(me, at(1, 0, -29.9))).toBe(true);
    expect(inDraftWindow(me, at(1, 0, -30.5))).toBe(false); // too far
    expect(inDraftWindow(me, at(1, 0, 10))).toBe(false); // behind
    expect(inDraftWindow(me, at(1, 3.9, -25))).toBe(true); // 3.9 m aside at 25 m: 8.9° and inside the lane
    expect(inDraftWindow(me, at(1, 4.5, -25))).toBe(false); // outside the 4 m lane
    expect(inDraftWindow(me, at(1, 3, -10))).toBe(false); // 16.7°: outside the cone
    expect(inDraftWindow(me, at(1, 0, -10, 6))).toBe(false); // overhead (pipe, loop)
  });

  it('follows the follower’s heading, not the world axes', () => {
    const me = at(0, 0, 0, 0, 90); // facing -X
    expect(inDraftWindow(me, at(1, -15, 0))).toBe(true);
    expect(inDraftWindow(me, at(1, 0, -15))).toBe(false);
  });
});

describe('Drafting build-up', () => {
  it('builds to 1 over 0.6 s behind a ship, then fades over 0.4 s', () => {
    const me = at(0, 0, 0);
    const lead = at(1, 0, -15);
    const d = new Drafting();
    run(d, [me, lead], 0.3);
    expect(me.drafting).toBeCloseTo(0.5, 1);
    run(d, [me, lead], 0.31);
    expect(me.drafting).toBe(1);
    expect(lead.drafting).toBe(0); // nobody ahead of the leader
    lead.position.x = 10; // pulls out of the wake
    run(d, [me, lead], 0.2);
    expect(me.drafting).toBeCloseTo(0.5, 1);
    run(d, [me, lead], 0.21);
    expect(me.drafting).toBe(0);
  });

  it('only between racing ships, above walking pace and on the ground', () => {
    const d = new Drafting();
    const me = at(0, 0, 0);
    const lead = at(1, 0, -15);
    lead.status = 'retired';
    run(d, [me, lead], 1);
    expect(me.drafting).toBe(0);
    lead.status = 'racing';
    me.forwardSpeed = DRAFT.MIN_SPEED - 1;
    run(d, [me, lead], 1);
    expect(me.drafting).toBe(0);
    me.forwardSpeed = 100;
    me.airborne = true;
    run(d, [me, lead], 1);
    expect(me.drafting).toBe(0);
  });

  it('emits ship:draft once on entering and once on leaving (hysteresis)', () => {
    const bus = new EventBus<GameEvents>();
    const seen: boolean[] = [];
    bus.on('ship:draft', (e) => seen.push(e.active));
    const me = at(0, 0, 0);
    const lead = at(1, 0, -15);
    const d = new Drafting(bus);
    run(d, [me, lead], 1);
    lead.position.x = 10;
    run(d, [me, lead], 1);
    expect(seen).toEqual([true, false]);
    // clear() on a grid reset drops it at once.
    lead.position.x = 0;
    run(d, [me, lead], 1);
    d.clear(me);
    expect(me.drafting).toBe(0);
    expect(seen).toEqual([true, false, true, false]);
  });
});
