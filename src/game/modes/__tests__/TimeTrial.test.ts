import { describe, expect, it } from 'vitest';
import { MEDAL_CREDITS } from '../../../content/economy';
import { MEDAL_FACTORS, bookTrial, medalFor, medalPayout, medalTimes, nextMedal } from '../TimeTrial';

const DEV = 100;

describe('Time Trial rules (IMPLEMENTATION §M8b step 3)', () => {
  it('the medal times are dev × 1.02 / 1.06 / 1.12', () => {
    expect(MEDAL_FACTORS).toEqual({ gold: 1.02, silver: 1.06, bronze: 1.12 });
    const t = medalTimes(91.79);
    expect(t.gold).toBeCloseTo(93.6258, 6);
    expect(t.silver).toBeCloseTo(97.2974, 6);
    expect(t.bronze).toBeCloseTo(102.8048, 6);
  });

  it('medalFor: the best medal whose time is reached, boundaries included', () => {
    expect(medalFor(90, DEV)).toBe('gold');
    expect(medalFor(102, DEV)).toBe('gold');
    expect(medalFor(102.0001, DEV)).toBe('silver');
    expect(medalFor(106, DEV)).toBe('silver');
    expect(medalFor(110, DEV)).toBe('bronze');
    expect(medalFor(112, DEV)).toBe('bronze');
    expect(medalFor(112.01, DEV)).toBeNull();
    expect(medalFor(Infinity, DEV)).toBeNull();
    expect(medalFor(NaN, DEV)).toBeNull();
  });

  it('medalPayout pays each medal reached now and not held before, once', () => {
    expect(MEDAL_CREDITS).toEqual({ bronze: 300, silver: 600, gold: 1000 });
    expect(medalPayout(null, null)).toBe(0);
    expect(medalPayout(null, 'bronze')).toBe(300);
    expect(medalPayout(null, 'silver')).toBe(900);
    expect(medalPayout(null, 'gold')).toBe(1900);
    expect(medalPayout('bronze', 'gold')).toBe(1600);
    expect(medalPayout('silver', 'gold')).toBe(1000);
    expect(medalPayout('gold', 'gold')).toBe(0);
    expect(medalPayout('gold', 'bronze')).toBe(0);
    expect(medalPayout('silver', null)).toBe(0);
  });

  it('nextMedal: the medal to chase and its time', () => {
    expect(nextMedal(null, DEV)?.medal).toBe('bronze');
    expect(nextMedal(null, DEV)?.time).toBeCloseTo(112, 9);
    expect(nextMedal('bronze', DEV)?.medal).toBe('silver');
    expect(nextMedal('silver', DEV)?.medal).toBe('gold');
    expect(nextMedal('gold', DEV)).toBeNull();
  });

  it('a first run: the time is the best, every medal reached is paid', () => {
    const r = bookTrial({}, 101, DEV);
    expect(r).toEqual({ record: { trialTime: 101, medal: 'gold' }, pay: 1900, best: true, reached: 'gold' });
    const none = bookTrial({ bestLap: 30 }, 120, DEV);
    expect(none).toEqual({ record: { bestLap: 30, trialTime: 120 }, pay: 0, best: true, reached: null });
  });

  it('a slower run keeps the best time and the medal, and pays nothing', () => {
    const r = bookTrial({ bestLap: 30, trialTime: 101, medal: 'gold' }, 108, DEV);
    expect(r).toEqual({ record: { bestLap: 30, trialTime: 101, medal: 'gold' }, pay: 0, best: false, reached: 'bronze' });
  });

  it('a faster run raises the medal and pays only the new ones', () => {
    const a = bookTrial({}, 111, DEV);
    expect(a.pay).toBe(300);
    const b = bookTrial(a.record, 105, DEV);
    expect(b).toEqual({ record: { trialTime: 105, medal: 'silver' }, pay: 600, best: true, reached: 'silver' });
    const c = bookTrial(b.record, 104, DEV);
    expect(c.pay).toBe(0);
    expect(c.best).toBe(true);
    const d = bookTrial(c.record, 101.5, DEV);
    expect(d.pay).toBe(1000);
    expect(d.record.medal).toBe('gold');
  });

  it('the input record is not changed', () => {
    const rec = Object.freeze({ bestLap: 31, trialTime: 110, medal: 'bronze' as const });
    bookTrial(rec, 100, DEV);
    expect(rec).toEqual({ bestLap: 31, trialTime: 110, medal: 'bronze' });
  });
});

describe('the Time Trial tally', () => {
  it('one line per medal paid, adding up to medalPayout', async () => {
    const { medalTally } = await import('../TimeTrial');
    expect(medalTally(null, 'gold')).toEqual([
      { label: 'BRONZE MEDAL', amount: 300 },
      { label: 'SILVER MEDAL', amount: 600 },
      { label: 'GOLD MEDAL', amount: 1000 },
    ]);
    expect(medalTally('silver', 'gold')).toEqual([{ label: 'GOLD MEDAL', amount: 1000 }]);
    expect(medalTally('gold', 'gold')).toEqual([]);
    expect(medalTally(null, null)).toEqual([]);
    for (const [a, b] of [[null, 'silver'], ['bronze', 'gold'], [null, 'bronze']] as const) {
      expect(medalTally(a, b).reduce((s, l) => s + l.amount, 0)).toBe(medalPayout(a, b));
    }
  });
});
