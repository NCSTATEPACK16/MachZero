import { describe, expect, it } from 'vitest';
import { POOL_SIZE, VoicePool } from '../VoicePool';

describe('VoicePool (decision H)', () => {
  it('has 28 slots and every claim succeeds while one is free', () => {
    const pool = new VoicePool();
    expect(POOL_SIZE).toBe(28);
    for (let i = 0; i < 28; i++) expect(pool.claim(3, i)).toEqual({ slot: i });
    expect(pool.active).toBe(28);
  });

  it('steals the oldest priority-3 voice for a 29th claim at priority 1', () => {
    const pool = new VoicePool();
    for (let i = 0; i < 28; i++) pool.claim(i < 10 ? 2 : 3, i);
    // Slot 10 is the oldest priority-3 voice.
    expect(pool.claim(1, 100)).toEqual({ steal: 10 });
    expect(pool.priorityOf(10)).toBe(1);
    // Next: the oldest remaining priority 3 (slot 11).
    expect(pool.claim(1, 101)).toEqual({ steal: 11 });
  });

  it('takes the lowest priority first, then the oldest', () => {
    const pool = new VoicePool(3);
    pool.claim(2, 0);
    pool.claim(3, 5);
    pool.claim(3, 1);
    expect(pool.claim(0, 9)).toEqual({ steal: 2 });
  });

  it('never steals an equal or higher priority', () => {
    const pool = new VoicePool();
    for (let i = 0; i < 28; i++) pool.claim(0, i);
    expect(pool.claim(0, 50)).toBeNull();
    const p2 = new VoicePool(2);
    p2.claim(1, 0);
    p2.claim(2, 0);
    expect(p2.claim(2, 1)).toBeNull();
    expect(p2.claim(1, 1)).toEqual({ steal: 1 });
  });

  it('lets a priority-0 claim take any voice but another priority 0', () => {
    const pool = new VoicePool(2);
    pool.claim(0, 0);
    pool.claim(1, 0);
    expect(pool.claim(0, 1)).toEqual({ steal: 1 });
    expect(pool.claim(0, 2)).toBeNull();
  });

  it('frees a slot on release; ties at the same start time steal the first claimed', () => {
    const pool = new VoicePool(2);
    pool.claim(3, 0);
    pool.claim(3, 0);
    pool.release(1);
    expect(pool.claim(2, 1)).toEqual({ slot: 1 });
    expect(pool.claim(1, 2)).toEqual({ steal: 0 });
  });
});
