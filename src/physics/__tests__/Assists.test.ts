import { describe, expect, it } from 'vitest';
import type { Assists, ControlInput } from '../../core/contracts';
import { neutralControls } from '../../core/controls';
import { makeCircleTrack, makeShip, placeShip } from '../../game/__tests__/helpers';
import { ASSIST, PlayerAssists } from '../Assists';

const OFF: Assists = { autoAccelerate: false, steering: 0, noKO: false, earlyBoost: false };
const STRONG: Assists = { autoAccelerate: true, steering: 2, noKO: false, earlyBoost: false };

function rig(lateral = 0, yaw = 0) {
  const track = makeCircleTrack(400); // curves right
  const ship = makeShip(0);
  ship.status = 'racing';
  ship.speed = 80;
  placeShip(ship, track, 0.2, lateral, yaw);
  return { track, ship, assists: new PlayerAssists(track) };
}

const input = (c: Partial<ControlInput>): ControlInput => ({ ...neutralControls(), ...c });

describe('PlayerAssists', () => {
  it('with everything off returns the input unchanged (and never mutates it)', () => {
    const { ship, assists } = rig();
    const c = input({ throttle: 0.3, steer: -0.4, brake: 0.2, boost: true });
    const before = { ...c };
    expect(assists.apply(ship, c, OFF)).toEqual(before);
    assists.apply(ship, c, STRONG);
    expect(c).toEqual(before);
  });

  it('auto-accelerate holds full throttle unless the brake is held', () => {
    const { ship, assists } = rig();
    expect(assists.apply(ship, input({}), { ...OFF, autoAccelerate: true }).throttle).toBe(1);
    expect(assists.apply(ship, input({ brake: 0.6 }), { ...OFF, autoAccelerate: true }).throttle).toBe(0);
  });

  it('steers toward the bend when the player does not', () => {
    const { ship, assists } = rig();
    const light = assists.apply(ship, input({}), { ...OFF, steering: 1 }).steer;
    const strong = assists.apply(ship, input({}), { ...OFF, steering: 2 }).steer;
    expect(light).toBeGreaterThan(0); // the circle bends right
    expect(strong).toBeGreaterThan(light);
  });

  it('never owns more than its share of the steer command (strong: 60%)', () => {
    for (const yaw of [-0.6, -0.2, 0, 0.2, 0.6]) {
      for (const human of [-1, -0.5, 0, 0.5, 1]) {
        const { ship, assists } = rig(0, yaw);
        const out = assists.apply(ship, input({ steer: human }), STRONG).steer;
        expect(Math.abs(out - (1 - ASSIST.WEIGHT[2]) * human)).toBeLessThanOrEqual(ASSIST.WEIGHT[2] + 1e-9);
      }
    }
  });

  it('pushes away from a rail the ship is about to scrape', () => {
    const centre = rig(0).ship;
    const a = rig(0);
    const nearRight = rig(13);
    const nearLeft = rig(-13);
    expect(nearRight.assists.assistSteer(nearRight.ship)).toBeLessThan(a.assists.assistSteer(centre));
    expect(nearLeft.assists.assistSteer(nearLeft.ship)).toBeGreaterThan(a.assists.assistSteer(centre));
  });

  it('does nothing before the start or after the finish', () => {
    const { ship, assists } = rig();
    ship.status = 'grid';
    expect(assists.apply(ship, input({}), STRONG)).toEqual(neutralControls());
    ship.status = 'finished';
    expect(assists.apply(ship, input({ steer: 0.2 }), STRONG).steer).toBe(0.2);
  });
});
