import { describe, expect, it } from 'vitest';
import type { ControlInput } from '../../core/contracts';
import { Tutorial, TUTORIAL_STEPS, type TutorialShip, type TutorialTrack } from '../Tutorial';

const DT = 1 / 120;
const LEN = 2000;
const N = 1000;
/** A 2 km loop: straight except a sharp bend at 1,000–1,100 m; the pit strip 30–250 m past the line. */
const TRACK: TutorialTrack = {
  length: LEN,
  samples: Array.from({ length: N }, (_, i) => {
    const distance = (i * LEN) / N;
    return { distance, curvature: distance >= 1000 && distance < 1100 ? 0.008 : 0 };
  }),
  zones: [{ type: 'pit', uStart: 30 / LEN, uEnd: 250 / LEN, lateralMin: -12, lateralMax: -6 }],
};

function ship(over: Partial<TutorialShip> = {}): TutorialShip {
  return { trackU: 0.05, path: null, speed: 60, boosting: false, boostUnlocked: false, energy: 100, inPit: false, def: { stats: { energyMax: 100 } }, ...over };
}
const idle = (over: Partial<ControlInput> = {}): ControlInput => ({ throttle: 1, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false, ...over });
const racing = { state: 'racing', lap: 1 };

/** Run `seconds` of fixed steps; returns the last view. */
function run(t: Tutorial, seconds: number, s: TutorialShip, input: ControlInput, race: { state: string; lap: number; itemUsed?: boolean } = racing) {
  let v = t.update(DT, s, input, race);
  for (let k = DT; k < seconds; k += DT) v = t.update(DT, s, input, race);
  return v;
}

describe('Tutorial (IMPLEMENTATION §M8c step 5)', () => {
  it('the steps, in order', () => {
    expect(TUTORIAL_STEPS).toEqual(['steer', 'boost', 'airbrake', 'pit', 'item']);
  });

  it('nothing shows before the lights go out; then STEER, cleared by 1 s of steering in total', () => {
    const t = new Tutorial(TRACK, { hasItem: true });
    expect(t.update(DT, ship(), idle(), { state: 'countdown', lap: 1 })).toEqual({ step: null, done: false });
    expect(t.update(DT, ship(), idle(), racing).step).toBe('steer');
    run(t, 0.6, ship(), idle({ steer: 0.5 }));
    expect(run(t, 0.2, ship(), idle()).step).toBe('steer'); // 0.6 s so far
    run(t, 0.2, ship(), idle({ steer: -0.8 })); // 0.8 s
    expect(t.update(DT, ship(), idle({ steer: 0.2 }), racing).step).toBe('steer'); // under 0.3 does not count
    run(t, 0.25, ship(), idle({ steer: 1 }));
    expect(t.current).not.toBe('steer');
  });

  it('STEER gives up after 12 s; BOOST waits for the boost and a straight, clears on boosting', () => {
    const t = new Tutorial(TRACK, { hasItem: false });
    run(t, 12.1, ship(), idle());
    expect(t.current).toBe('boost');
    // Boost still locked: nothing shows.
    expect(run(t, 1, ship(), idle()).step).toBeNull();
    // Unlocked, but a sharp bend 100 m ahead at 60 m/s (2 s = 120 m): not a straight.
    expect(run(t, 0.1, ship({ boostUnlocked: true, trackU: 950 / LEN }), idle()).step).toBeNull();
    expect(run(t, 0.1, ship({ boostUnlocked: true, trackU: 300 / LEN }), idle()).step).toBe('boost');
    expect(run(t, 0.1, ship({ boostUnlocked: true, boosting: true, trackU: 300 / LEN }), idle()).step).not.toBe('boost');
    expect(t.current).toBe('airbrake');
  });

  it('BOOST gives up after two showings of 8 s', () => {
    const t = new Tutorial(TRACK, { hasItem: false });
    run(t, 1.1, ship(), idle({ steer: 1 }));
    const s = ship({ boostUnlocked: true, trackU: 300 / LEN });
    expect(run(t, 7.9, s, idle()).step).toBe('boost');
    expect(run(t, 0.2, s, idle()).step).toBeNull(); // the first showing is over; a short pause before the next
    run(t, 4, s, idle());
    expect(run(t, 8, s, idle()).step).not.toBe('boost');
    expect(t.current).toBe('airbrake');
  });

  it('AIR-BRAKE shows 1.5 s before a sharp bend and clears on 0.3 s of air-brake over 0.5', () => {
    const t = new Tutorial(TRACK, { hasItem: false });
    t.skipTo('airbrake');
    // 60 m/s: shown from 90 m before the bend (1,000 m).
    expect(run(t, 0.1, ship({ trackU: 800 / LEN }), idle()).step).toBeNull();
    expect(run(t, 0.1, ship({ trackU: 930 / LEN }), idle()).step).toBe('airbrake');
    run(t, 0.2, ship({ trackU: 930 / LEN }), idle({ airbrakeLeft: 0.9 }));
    expect(t.current).toBe('airbrake');
    run(t, 0.15, ship({ trackU: 930 / LEN }), idle({ airbrakeRight: 0.6 }));
    expect(t.current).toBe('pit');
  });

  it('PIT shows with the strip within 300 m once power is under 70% or lap 2 starts; clears in the pit', () => {
    const t = new Tutorial(TRACK, { hasItem: false });
    t.skipTo('pit');
    // Lap 1, full power, 1,900 m (the strip is 130 m ahead, past the line, so lap 2 is starting): shown.
    expect(run(t, 0.1, ship({ trackU: 1900 / LEN }), idle()).step).toBe('pit');
    const u = new Tutorial(TRACK, { hasItem: true });
    u.skipTo('pit');
    // Lap 1 at 500 m with full power: no. With 60% power and the strip far away: no.
    expect(run(u, 0.1, ship({ trackU: 500 / LEN }), idle()).step).toBeNull();
    expect(run(u, 0.1, ship({ trackU: 500 / LEN, energy: 60 }), idle()).step).toBeNull();
    // Lap 2, 1,800 m: the strip 230 m ahead: shown; in the pit: done.
    expect(run(u, 0.1, ship({ trackU: 1800 / LEN }), idle(), { state: 'racing', lap: 2 }).step).toBe('pit');
    run(u, 0.1, ship({ trackU: 100 / LEN, inPit: true }), idle(), { state: 'racing', lap: 2 });
    expect(u.current).toBe('item');
  });

  it('ITEM shows 3 s after the steps before it, on a straight, and clears when the item is used; without one it is skipped', () => {
    const t = new Tutorial(TRACK, { hasItem: true });
    t.skipTo('item');
    expect(run(t, 2.9, ship({ trackU: 300 / LEN }), idle()).step).toBeNull();
    expect(run(t, 0.2, ship({ trackU: 300 / LEN }), idle()).step).toBe('item');
    const v = t.update(DT, ship({ trackU: 300 / LEN }), idle(), { state: 'racing', lap: 2, itemUsed: true });
    expect(v).toEqual({ step: null, done: true });
    const n = new Tutorial(TRACK, { hasItem: false });
    n.skipTo('item');
    expect(n.update(DT, ship(), idle(), racing)).toEqual({ step: null, done: true });
  });

  it('ITEM gives up after 10 s', () => {
    const t = new Tutorial(TRACK, { hasItem: true });
    t.skipTo('item');
    run(t, 3.1, ship({ trackU: 300 / LEN }), idle());
    expect(run(t, 9.8, ship({ trackU: 300 / LEN }), idle()).step).toBe('item');
    expect(run(t, 0.3, ship({ trackU: 300 / LEN }), idle()).done).toBe(true);
  });

  it('an action done before its prompt still clears the step; SKIP and the race end finish the tutorial', () => {
    const t = new Tutorial(TRACK, { hasItem: true });
    run(t, 1.1, ship(), idle({ steer: 1 }));
    expect(t.current).toBe('boost');
    t.update(DT, ship({ boosting: true, trackU: 950 / LEN }), idle(), racing); // boosting into a bend, no prompt shown
    expect(t.current).toBe('airbrake');
    t.skip();
    expect(t.update(DT, ship(), idle(), racing)).toEqual({ step: null, done: true });
    const u = new Tutorial(TRACK, { hasItem: true });
    u.update(DT, ship(), idle(), racing);
    expect(u.update(DT, ship(), idle(), { state: 'results', lap: 3 })).toEqual({ step: null, done: true });
  });

  it('on a split path nothing new shows', () => {
    const t = new Tutorial(TRACK, { hasItem: false });
    t.skipTo('airbrake');
    expect(run(t, 0.1, ship({ trackU: 930 / LEN, path: 'shortcut' }), idle()).step).toBeNull();
  });
});
