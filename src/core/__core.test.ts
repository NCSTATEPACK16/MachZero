import { describe, expect, it } from 'vitest';
import { COLLISION, GROUP_QUERY, GROUP_RAIL, GROUP_SHIP, GROUP_SURFACE } from './config';
import { EventBus } from './events';
import { formatTime, inLoopRange, loopDelta, ordinal, wrap01 } from './math';
import { Rng } from './rng';

/** Rapier's pairwise rule: ((a >> 16) & b) != 0 && ((b >> 16) & a) != 0 */
const interacts = (a: number, b: number) => ((a >>> 16) & b) !== 0 && ((b >>> 16) & a) !== 0;

describe('collision groups', () => {
  it('hover rays hit only the surface', () => {
    expect(interacts(COLLISION.HOVER_RAY, COLLISION.SURFACE)).toBe(true);
    expect(interacts(COLLISION.HOVER_RAY, COLLISION.RAIL)).toBe(false);
    expect(interacts(COLLISION.HOVER_RAY, COLLISION.SHIP)).toBe(false);
  });
  it('ships collide with rails and ships but never the surface', () => {
    expect(interacts(COLLISION.SHIP, COLLISION.RAIL)).toBe(true);
    expect(interacts(COLLISION.SHIP, COLLISION.SHIP)).toBe(true);
    expect(interacts(COLLISION.SHIP, COLLISION.SURFACE)).toBe(false);
  });
  it('groups are distinct bits', () => {
    expect(new Set([GROUP_SURFACE, GROUP_RAIL, GROUP_SHIP, GROUP_QUERY]).size).toBe(4);
  });
});

describe('math', () => {
  it('wraps and measures loop distance', () => {
    expect(wrap01(1.25)).toBeCloseTo(0.25);
    expect(wrap01(-0.25)).toBeCloseTo(0.75);
    expect(loopDelta(0.95, 0.05)).toBeCloseTo(0.1);
    expect(loopDelta(0.05, 0.95)).toBeCloseTo(-0.1);
    expect(inLoopRange(0.02, 0.9, 0.1)).toBe(true);
    expect(inLoopRange(0.5, 0.9, 0.1)).toBe(false);
  });
  it('formats', () => {
    expect(formatTime(83.456)).toBe('1:23.456');
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
  });
});

describe('rng', () => {
  it('is deterministic', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });
});

describe('event bus', () => {
  it('emits and unsubscribes', () => {
    const bus = new EventBus<{ x: number }>();
    let got = 0;
    const off = bus.on('x', (v) => (got += v));
    bus.emit('x', 2);
    off();
    bus.emit('x', 5);
    expect(got).toBe(2);
  });
});
