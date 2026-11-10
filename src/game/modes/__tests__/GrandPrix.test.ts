import { describe, expect, it } from 'vitest';
import type { RacerStanding, ShipId } from '../../../core/contracts';
import { CUPS, CUP_RACES, availableCups, cupAvailable, cupById } from '../../../content/cups';
import { WORLDS } from '../../../content/worlds';
import { AI_TIERS } from '../../../save/schema';
import {
  addTrophy,
  cupAward,
  cupBonus,
  cupFinished,
  cupRaces,
  cupWorlds,
  cupGridOrder,
  cupStandings,
  cupWorld,
  newCup,
  pointsFor,
  recordRace,
  sanitizeCup,
  sanitizeTrophies,
  trophiesOf,
  trophyCount,
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
    const cup = recordRace(newCup('neon', 'pilot'), standings([3, 0, 1, 2, 4, 5, 6, 7], [0]));
    const t = cupStandings(cup);
    expect(t.find((r) => r.id === 0)).toMatchObject({ points: 0, best: 0, last: 0, rank: 8 });
    // The others close up: ship 1 is 2nd once the player is out.
    expect(t.find((r) => r.id === 1)).toMatchObject({ points: 8, rank: 2 });
  });

  it('breaks a tie on best finish, then on the last race', () => {
    // Rows are per ship id: that ship's finishing position.
    const best: CupState = { cupId: 'neon', tier: 'rookie', results: [[8, 1, 2, 3, 4, 5, 6, 7], [8, 5, 3, 1, 2, 4, 6, 7]] };
    // Ship 3: 6 + 10 = 16. Ship 1: 10 + 4 = 14 (best 1st). Ship 2: 8 + 6 = 14 (best 2nd). Ship 4: 5 + 8 = 13.
    const t = cupStandings(best);
    expect(t.slice(0, 4).map((r) => [r.id, r.points, r.best])).toEqual([[3, 16, 1], [1, 14, 1], [2, 14, 2], [4, 13, 2]]);
    const last: CupState = { cupId: 'neon', tier: 'rookie', results: [[8, 1, 5, 2, 3, 4, 6, 7], [8, 5, 1, 2, 3, 4, 6, 7]] };
    // Ship 3: 16. Ships 1 and 2: 14 each, both with a win; ship 2 won the last race.
    expect(cupStandings(last).slice(0, 3).map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it('reports movement since the race before', () => {
    let cup = recordRace(newCup('neon', 'rookie'), standings([1, 2, 3, 4, 5, 6, 7, 0]));
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
    const NEON = ['neon-bay', 'sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring'];
    let cup = newCup('neon', 'ace');
    expect(cupRaces(cup)).toBe(5);
    expect(cupWorlds(cup)).toEqual(NEON);
    const seen: string[] = [];
    for (let i = 0; i < cupRaces(cup); i++) {
      seen.push(cupWorld(cup)!);
      expect(cupFinished(cup)).toBe(false);
      cup = recordRace(cup, i === 2 ? standings([7, 6, 5, 4, 3, 2, 1, 0], [0]) : standings(IDS));
    }
    expect(seen).toEqual(NEON);
    expect(cupFinished(cup)).toBe(true);
    expect(cupWorld(cup)).toBeNull();
    expect(recordRace(cup, standings(IDS))).toBe(cup);
    // Player won 4 of 5 and retired once: 40 points, still the cup.
    const me = cupStandings(cup).find((r) => r.id === 0)!;
    expect(me).toMatchObject({ points: 40, rank: 1 });
    expect(cupAward(cup)).toEqual({ position: 1, bonus: cupBonus('ace'), trophy: 'ace' });
  });

  it('a forced retire (quit mid-race) scores 0 and moves everyone behind up', () => {
    const cup = recordRace(newCup('neon', 'rookie'), standings([0, 1, 2, 3, 4, 5, 6, 7]), 0);
    expect(cup.results[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('race 1 keeps the normal grid; from race 2 the leader starts last', () => {
    let cup = newCup('neon', 'pilot');
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
    let cup = newCup('neon', 'legend');
    for (let i = 0; i < cupRaces(cup); i++) cup = recordRace(cup, standings([1, 0, 2, 3, 4, 5, 6, 7]));
    expect(cupAward(cup)).toEqual({ position: 2, bonus: 0, trophy: null });
    expect(cupAward(newCup('neon', 'legend'))).toBeNull();
  });

  it('keeps one trophy per cup and tier, in tier order', () => {
    let t = addTrophy({}, 'neon', 'ace', AI_TIERS);
    t = addTrophy(t, 'neon', 'rookie', AI_TIERS);
    t = addTrophy(t, 'neon', 'ace', AI_TIERS);
    t = addTrophy(t, 'storm', 'legend', AI_TIERS);
    expect(t).toEqual({ neon: ['rookie', 'ace'], storm: ['legend'] });
    expect(trophiesOf(t, 'neon')).toEqual(['rookie', 'ace']);
    expect(trophiesOf(t, 'nope')).toEqual([]);
    expect(trophyCount(t)).toBe(3);
  });

  it('sanitizes saved trophies: known cups and tiers only', () => {
    expect(sanitizeTrophies({ neon: ['legend', 'rookie', 'boss', 'rookie'], bogus: ['ace'], storm: 'x' }, AI_TIERS)).toEqual({ neon: ['rookie', 'legend'] });
    expect(sanitizeTrophies(['rookie'], AI_TIERS)).toEqual({});
    expect(sanitizeTrophies(null, AI_TIERS)).toEqual({});
  });

  it('sanitizes a saved cup', () => {
    const ok = recordRace(newCup('neon', 'pilot'), standings(IDS));
    expect(sanitizeCup(JSON.parse(JSON.stringify(ok)), AI_TIERS)).toEqual(ok);
    expect(sanitizeCup(null, AI_TIERS)).toBeNull();
    expect(sanitizeCup({ cupId: 'neon', tier: 'boss', results: [] }, AI_TIERS)).toBeNull();
    // No cup id (a pre-v6 cup that skipped its migration), an unknown cup, and a cup whose worlds aren't built yet.
    expect(sanitizeCup({ tier: 'ace', results: [] }, AI_TIERS)).toBeNull();
    expect(sanitizeCup({ cupId: 'bogus', tier: 'ace', results: [] }, AI_TIERS)).toBeNull();
    if (!cupAvailable(cupById('storm')!)) expect(sanitizeCup({ cupId: 'storm', tier: 'ace', results: [] }, AI_TIERS)).toBeNull();
    expect(sanitizeCup({ cupId: 'neon', tier: 'ace', results: [[1, 2]] }, AI_TIERS)).toBeNull();
    expect(sanitizeCup({ cupId: 'neon', tier: 'ace', results: [[1, 2, 3, 4, 5, 6, 7, 'x']] }, AI_TIERS)).toEqual({ cupId: 'neon', tier: 'ace', results: [[1, 2, 3, 4, 5, 6, 7, 0]] });
    expect(sanitizeCup({ cupId: 'neon', tier: 'ace', results: Array.from({ length: 5 }, () => [1, 2, 3, 4, 5, 6, 7, 8]) }, AI_TIERS)).toBeNull();
  });
});

describe('Cups are data (IMPLEMENTATION §X1)', () => {
  it('every cup has five distinct worlds and a unique id', () => {
    expect(new Set(CUPS.map((c) => c.id)).size).toBe(CUPS.length);
    for (const c of CUPS) {
      expect(c.worlds).toHaveLength(CUP_RACES);
      expect(new Set(c.worlds).size).toBe(CUP_RACES);
    }
  });

  it('the Neon Cup is the five original worlds, whatever else is in WORLDS', () => {
    expect(cupById('neon')!.worlds).toEqual(['neon-bay', 'sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring']);
    // A sixth world (the bug this replaces: the cup used to be WORLDS.map) changes no cup.
    const more = [...WORLDS, { id: 'world-six', built: true }];
    expect(availableCups(more).find((c) => c.id === 'neon')!.worlds).toHaveLength(5);
    expect(cupRaces(newCup('neon', 'rookie'))).toBe(5);
  });

  it('a cup is available only when all of its worlds are built', () => {
    const built = (ids: string[]) => ids.map((id) => ({ id, built: true }));
    const storm = cupById('storm')!;
    expect(cupAvailable(storm, built(['sunset-mesa', 'jade-ruins', 'tempest-spire', 'cinder-forge']))).toBe(false);
    expect(cupAvailable(storm, [...built(['sunset-mesa', 'jade-ruins', 'tempest-spire', 'cinder-forge']), { id: 'abyss-line', built: false }])).toBe(false);
    expect(cupAvailable(storm, built([...storm.worlds]))).toBe(true);
    expect(availableCups().map((c) => c.id)).toContain('neon');
  });

  it('an unknown cup has no races and counts as finished', () => {
    const ghost: CupState = { cupId: 'bogus', tier: 'ace', results: [] };
    expect(cupRaces(ghost)).toBe(0);
    expect(cupFinished(ghost)).toBe(true);
    expect(cupWorld(ghost)).toBeNull();
  });
});
