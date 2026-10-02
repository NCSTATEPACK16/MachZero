import { describe, expect, it } from 'vitest';
import type { RacerStanding } from '../../core/contracts';
import { buyPart, equipPart, owns, racePayout, selectChassis, settleRace, type Garage } from '../economy';
import { createProfile } from '../../save/schema';

function garage(credits: number): Garage {
  const p = createProfile('T', 0, 'rookie');
  p.credits = credits;
  return p;
}

describe('race payouts (SPEC §4.4)', () => {
  it('pays every place at Rookie', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((p) => racePayout(p, 'rookie'))).toEqual([1000, 750, 550, 400, 300, 220, 160, 120]);
  });

  it('scales by tier and rounds to 10', () => {
    expect(racePayout(1, 'pilot')).toBe(1300);
    expect(racePayout(1, 'ace')).toBe(1700);
    expect(racePayout(1, 'legend')).toBe(2200);
    expect(racePayout(6, 'pilot')).toBe(290); // 220 × 1.3 = 286
  });

  it('a larger field pays last place; nonsense pays nothing', () => {
    expect(racePayout(12, 'rookie')).toBe(120);
    expect(racePayout(0, 'rookie')).toBe(0);
    expect(racePayout(Number.NaN, 'rookie')).toBe(0);
  });
});

describe('settling a race on a profile', () => {
  const standing = (position: number, status: RacerStanding['status'] = 'finished'): RacerStanding => ({ id: 0, name: 'T', position, lap: 3, progress: 3, totalTime: 100, bestLap: 30, status });

  it('a win counts, pays and adds up across races', () => {
    const p = createProfile('T', 0, 'rookie');
    expect(settleRace(p, standing(1), 'rookie')).toBe(1000);
    expect(settleRace(p, standing(4), 'pilot')).toBe(520);
    expect(p).toMatchObject({ credits: 1520, stats: { races: 2, wins: 1 } });
  });

  it('a retired player still earns their final place, but not a win', () => {
    const p = createProfile('T', 0, 'rookie');
    expect(settleRace(p, standing(8, 'retired'), 'rookie')).toBe(120);
    expect(p).toMatchObject({ credits: 120, stats: { races: 1, wins: 0 } });
  });

  it('no standing: the race counts, nothing is paid', () => {
    const p = createProfile('T', 0, 'rookie');
    expect(settleRace(p, undefined, 'rookie')).toBe(0);
    expect(p).toMatchObject({ credits: 0, stats: { races: 1, wins: 0 } });
  });
});

describe('garage rules', () => {
  it('buying pays, owns and fits the part', () => {
    const g = garage(2000);
    expect(buyPart(g, 'engine', 2)).toBe('bought');
    expect(g.credits).toBe(500);
    expect(g.owned.engine).toEqual([0, 2]);
    expect(g.loadout.parts.engine).toBe(2);
  });

  it('refuses when short of credits, and changes nothing', () => {
    const g = garage(599);
    expect(buyPart(g, 'booster', 1)).toBe('short');
    expect(g.credits).toBe(599);
    expect(g.owned.booster).toEqual([0]);
    expect(g.loadout.parts.booster).toBe(0);
  });

  it('never charges twice for an owned part', () => {
    const g = garage(5000);
    expect(buyPart(g, 'hull', 0)).toBe('owned');
    buyPart(g, 'hull', 3);
    expect(buyPart(g, 'hull', 3)).toBe('owned');
    expect(g.credits).toBe(1800);
  });

  it('equips only owned parts; Stock is always owned', () => {
    const g = garage(1000);
    expect(equipPart(g, 'stabilizer', 1)).toBe(false);
    buyPart(g, 'stabilizer', 1);
    expect(equipPart(g, 'stabilizer', 0)).toBe(true);
    expect(g.loadout.parts.stabilizer).toBe(0);
    expect(owns(g, 'stabilizer', 1)).toBe(true);
    expect(equipPart(g, 'stabilizer', 1)).toBe(true);
    expect(g.loadout.parts.stabilizer).toBe(1);
  });

  it('chassis are free; parts and livery carry over; unknown ids are refused', () => {
    const g = garage(0);
    g.loadout.parts.engine = 0;
    const livery = { ...g.loadout.livery };
    expect(selectChassis(g, 'titan')).toBe(true);
    expect(g.loadout.chassisId).toBe('titan');
    expect(g.loadout.livery).toEqual(livery);
    expect(selectChassis(g, 'nope')).toBe(false);
    expect(g.loadout.chassisId).toBe('titan');
  });
});
