import { describe, expect, it } from 'vitest';
import type { RacerStanding, ShipId } from '../../../core/contracts';
import { AI_TIERS } from '../../../save/schema';
import {
  GP_RACES,
  GP_WORLDS,
  addTrophy,
  cupAward,
  cupBonus,
  cupFinished,
  cupGridOrder,
  cupStandings,
  cupWorld,
  newCup,
  pointsFor,
  recordRace,
  sanitizeCup,
  type CupState,
} from '../GrandPrix';

/** Standings with ships finishing in `order` (ids); ids in `retired` retired. */
function standings(order: ShipId[], retired: ShipId[] = []): RacerStanding[] {
  const run = order.filter((id) => !retired.includes(id));
  return [...run, ...retired].map((id, i) => ({
    id,
    name: `S${id}`,
    position: i + 1,
    lap: 3,
    progress: 3,
    totalTime: 100 + i,
    bestLap: 30,
    status: retired.includes(id) ? 'retired' : 'finished',
  }));
}

const IDS = [0, 1, 2, 3, 4, 5, 6, 7];

describe('Grand Prix: points and the table', () => {
  it('scores 10-8-6-5-4-3-2-1 and nothing for a retire', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(pointsFor)).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
    expect(pointsFor(0)).toBe(0);
    const cup = recordRace(newCup('pilot'), standings([3, 0, 1, 2, 4, 5, 6, 7], [0]));
    const t = cupStandings(cup);
    expect(t.find((r) => r.id === 0)).toMatchObject({ points: 0, best: 0, last: 0, rank: 8 });
    // The others close up: ship 1 is 2nd once the player is out.
    expect(t.find((r) => r.id === 1)).toMatchObject({ points: 8, rank: 2 });
  });

  it('breaks a tie on best finish, then on the last race', () => {
    // Rows are per ship id: that ship's finishing position.
    const best: CupState = { tier: 'rookie', results: [[8, 1, 2, 3, 4, 5, 6, 7], [8, 5, 3, 1, 2, 4, 6, 7]] };
    // Ship 3: 6 + 10 = 16. Ship 1: 10 + 4 = 14 (best 1st). Ship 2: 8 + 6 = 14 (best 2nd). Ship 4: 5 + 8 = 13.
    const t = cupStandings(best);
    expect(t.slice(0, 4).map((r) => [r.id, r.points, r.best])).toEqual([[3, 16, 1], [1, 14, 1], [2, 14, 2], [4, 13, 2]]);
    const last: CupState = { tier: 'rookie', results: [[8, 1, 5, 2, 3, 4, 6, 7], [8, 5, 1, 2, 3, 4, 6, 7]] };
    // Ship 3: 16. Ships 1 and 2: 14 each, both with a win; ship 2 won the last race.
    expect(cupStandings(last).slice(0, 3).map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it('reports movement since the race before', () => {
    let cup = recordRace(newCup('rookie'), standings([1, 2, 3, 4, 5, 6, 7, 0]));
    expect(cupStandings(cup).every((r) => r.moved === 0)).toBe(true);
    cup = recordRace(cup, standings([0, 7, 6, 5, 4, 3, 2, 1]));
    const t = cupStandings(cup);
    const me = t.find((r) => r.id === 0)!;
    expect(me.points).toBe(11);
    expect(me.rank).toBeLessThan(8);
    expect(me.moved).toBe(8 - me.rank);
    expect(t.reduce((a, r) => a + r.moved, 0)).toBe(0);
  });
});

describe('Grand Prix: the cup', () => {
  it('runs five races in world order, with a retire, then stops', () => {
    expect(GP_RACES).toBe(5);
    expect(GP_WORLDS).toEqual(['neon-bay', 'sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring']);
    let cup = newCup('ace');
    const seen: string[] = [];
    for (let i = 0; i < GP_RACES; i++) {
      seen.push(cupWorld(cup)!);
      expect(cupFinished(cup)).toBe(false);
      cup = recordRace(cup, i === 2 ? standings([7, 6, 5, 4, 3, 2, 1, 0], [0]) : standings(IDS));
    }
    expect(seen).toEqual(GP_WORLDS);
    expect(cupFinished(cup)).toBe(true);
    expect(cupWorld(cup)).toBeNull();
    expect(recordRace(cup, standings(IDS))).toBe(cup);
    // Player won 4 of 5 and retired once: 40 points, still the cup.
    const me = cupStandings(cup).find((r) => r.id === 0)!;
    expect(me).toMatchObject({ points: 40, rank: 1 });
    expect(cupAward(cup)).toEqual({ position: 1, bonus: cupBonus('ace'), trophy: 'ace' });
  });

  it('a forced retire (quit mid-race) scores 0 and moves everyone behind up', () => {
    const cup = recordRace(newCup('rookie'), standings([0, 1, 2, 3, 4, 5, 6, 7]), 0);
    expect(cup.results[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('race 1 keeps the normal grid; from race 2 the leader starts last', () => {
    let cup = newCup('pilot');
    expect(cupGridOrder(cup)).toBeNull();
    cup = recordRace(cup, standings([4, 2, 0, 1, 3, 5, 6, 7]));
    const grid = cupGridOrder(cup)!;
    expect(grid).toHaveLength(8);
    expect([...grid].sort()).toEqual(IDS);
    expect(grid[7]).toBe(4); // leader at the back
    expect(grid[0]).toBe(7); // last on pole
    expect(grid).toEqual([7, 6, 5, 3, 1, 0, 2, 4]);
  });

  it('pays the cup bonus × tier and a trophy only for 1st overall', () => {
    expect(cupBonus('rookie')).toBe(3000);
    expect(cupBonus('pilot')).toBe(3900);
    expect(cupBonus('ace')).toBe(5100);
    expect(cupBonus('legend')).toBe(6600);
    let cup = newCup('legend');
    for (let i = 0; i < GP_RACES; i++) cup = recordRace(cup, standings([1, 0, 2, 3, 4, 5, 6, 7]));
    expect(cupAward(cup)).toEqual({ position: 2, bonus: 0, trophy: null });
    expect(cupAward(newCup('legend'))).toBeNull();
  });

  it('keeps one trophy per tier, in tier order', () => {
    let t = addTrophy([], 'ace', AI_TIERS);
    t = addTrophy(t, 'rookie', AI_TIERS);
    t = addTrophy(t, 'ace', AI_TIERS);
    expect(t).toEqual(['rookie', 'ace']);
  });

  it('sanitizes a saved cup', () => {
    const ok = recordRace(newCup('pilot'), standings(IDS));
    expect(sanitizeCup(JSON.parse(JSON.stringify(ok)), AI_TIERS)).toEqual(ok);
    expect(sanitizeCup(null, AI_TIERS)).toBeNull();
    expect(sanitizeCup({ tier: 'boss', results: [] }, AI_TIERS)).toBeNull();
    expect(sanitizeCup({ tier: 'ace', results: [[1, 2]] }, AI_TIERS)).toBeNull();
    expect(sanitizeCup({ tier: 'ace', results: [[1, 2, 3, 4, 5, 6, 7, 'x']] }, AI_TIERS)).toEqual({ tier: 'ace', results: [[1, 2, 3, 4, 5, 6, 7, 0]] });
    expect(sanitizeCup({ tier: 'ace', results: Array.from({ length: 5 }, () => [1, 2, 3, 4, 5, 6, 7, 8]) }, AI_TIERS)).toBeNull();
  });
});
