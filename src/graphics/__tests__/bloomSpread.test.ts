import { describe, expect, it } from 'vitest';
import { BLOOM_FACTORS, bloomLevelTints, bloomLevelWeight, bloomOctaveShift } from '../bloomSpread';
import { CONFIG } from '../../core/config';

const R = CONFIG.BLOOM_RADIUS;
const weights = BLOOM_FACTORS.map((f) => bloomLevelWeight(f, R));
const total = (tints: number[]) => tints.reduce((s, t, i) => s + t * weights[i], 0);

describe('bloom spread', () => {
  it('matches the UnrealBloom composite weight', () => {
    expect(bloomLevelWeight(1, 0)).toBe(1);
    expect(bloomLevelWeight(1, 1)).toBeCloseTo(0.2);
    expect(bloomLevelWeight(0.6, 0.5)).toBeCloseTo(0.6);
  });

  it('is coarser only when the buffer is smaller than the reference', () => {
    expect(bloomOctaveShift(1000, 1000)).toBe(0);
    expect(bloomOctaveShift(2000, 1000)).toBe(0); // High at DPR 2: finer than Med, left as it was
    expect(bloomOctaveShift(250, 1000)).toBeCloseTo(2); // Low on a phone: ¼ of Med's width
    expect(bloomOctaveShift(0, 1000)).toBe(0);
  });

  it('leaves the reference chain untouched', () => {
    expect(bloomLevelTints(0, R)).toEqual([1, 1, 1, 1, 1]);
  });

  it('shifts the levels and keeps the total glow at whole and fractional shifts', () => {
    for (const s of [0.5, 1, 1.58, 2, 3]) expect(total(bloomLevelTints(s, R))).toBeCloseTo(total([1, 1, 1, 1, 1]), 6);
    const two = bloomLevelTints(2, R);
    // Levels 3 and 4 would stand in for levels 5 and 6, which the reference chain doesn't have.
    expect(two[3]).toBe(0);
    expect(two[4]).toBe(0);
    // Level 1 now plays the reference's level 3.
    expect(two[1] * weights[1]).toBeCloseTo(weights[3]);
  });

  it('reuses the output array', () => {
    const out = [9, 9, 9, 9, 9, 9];
    expect(bloomLevelTints(1, R, out)).toBe(out);
    expect(out).toHaveLength(5);
  });
});
