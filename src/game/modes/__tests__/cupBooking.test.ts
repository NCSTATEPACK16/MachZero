import { describe, expect, it } from 'vitest';
import type { RacerStanding } from '../../../core/contracts';
import type { CupDef } from '../../../content/cups';
import { createProfile, type Profile } from '../../../save/schema';
import { CHAMPION_BONUS, newSeason, seasonStandings } from '../Championship';
import { bookCupRaceOn } from '../cupBooking';
import { cupBonus, newCup } from '../GrandPrix';

const TWO: CupDef[] = [
  { id: 'neon', name: 'NEON CUP', tagline: '', worlds: ['neon-bay', 'sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring'], requires: 'orbital-ring' },
  { id: 'storm', name: 'STORM CUP', tagline: '', worlds: ['sunset-mesa', 'tempest-spire', 'jade-ruins', 'cinder-forge', 'abyss-line'], requires: 'abyss-line' },
];

/** Standings with ships finishing in `order` (ids, winner first). */
const finish = (order: number[]): RacerStanding[] => order.map((id, i) => ({ id, name: `S${id}`, position: i + 1, lap: 3, progress: 3, totalTime: 90 + i, bestLap: 30, status: 'finished' }));
const WIN = [0, 1, 2, 3, 4, 5, 6, 7];
const LOSE = [1, 2, 3, 4, 5, 6, 7, 0];

function seasonProfile(): Profile {
  const p = createProfile('SEASON', 0, 'classic');
  p.season = newSeason('pilot');
  p.cup = newCup('neon', 'pilot');
  return p;
}

describe('booking cup races (IMPLEMENTATION §M8c step 2)', () => {
  it('a single cup: books each race, pays the award at the end, nothing about seasons', () => {
    const p = createProfile('CUP', 0, 'classic');
    p.cup = newCup('neon', 'ace');
    for (let r = 0; r < 4; r++) expect(bookCupRaceOn(p, finish(WIN), TWO).done).toBeNull();
    const credits = p.credits;
    const b = bookCupRaceOn(p, finish(WIN), TWO);
    expect(b.done?.results).toHaveLength(5);
    expect(b.award?.trophy).toBe('ace');
    expect(b.inSeason).toBe(false);
    expect(p.cup).toBeNull();
    expect(p.credits - credits).toBe(cupBonus('ace'));
    expect(p.trophies.neon).toEqual(['ace']);
    // No cup: nothing to book.
    expect(bookCupRaceOn(p, finish(WIN), TWO)).toEqual({ done: null, award: null, inSeason: false, ended: null });
  });

  it('a season: the next cup is queued as soon as one ends; at the end the champion is crowned and paid once', () => {
    const p = seasonProfile();
    for (let r = 0; r < 5; r++) bookCupRaceOn(p, finish(WIN), TWO);
    expect(p.season?.done.map((c) => c.cupId)).toEqual(['neon']);
    expect(p.cup).toEqual(newCup('storm', 'pilot'));
    const before = p.credits;
    let last = bookCupRaceOn(p, finish(WIN), TWO);
    for (let r = 1; r < 5; r++) last = bookCupRaceOn(p, finish(WIN), TWO);
    expect(last.inSeason).toBe(true);
    expect(last.ended?.champion).toBe(0);
    expect(last.ended?.bonus).toBe(Math.round(CHAMPION_BONUS * 1.3));
    expect(last.ended?.newTrophy).toBe(true);
    expect(seasonStandings(last.ended!.season.done)[0].id).toBe(0);
    expect(p.champion).toEqual(['pilot']);
    expect(p.season).toBeNull();
    expect(p.cup).toBeNull();
    expect(p.credits - before).toBe(cupBonus('pilot') + Math.round(CHAMPION_BONUS * 1.3));
    // A second season won at the same tier pays nothing more.
    const q = seasonProfile();
    q.champion = ['rookie', 'pilot'];
    for (let r = 0; r < 10; r++) last = bookCupRaceOn(q, finish(WIN), TWO);
    expect(last.ended).toMatchObject({ champion: 0, bonus: 0, newTrophy: false });
    expect(q.champion).toEqual(['rookie', 'pilot']);
  });

  it('a rival champion: no bonus and no crown; cup bonuses already paid stay', () => {
    const p = seasonProfile();
    for (let r = 0; r < 5; r++) bookCupRaceOn(p, finish(WIN), TWO); // the player wins Neon
    let last = bookCupRaceOn(p, finish(LOSE), TWO);
    for (let r = 1; r < 5; r++) last = bookCupRaceOn(p, finish([1, 0, 2, 3, 4, 5, 6, 7]), TWO);
    // Neon: the player 50, ship 1 40. Storm: ship 1 wins all five (50), the player 1 + 8 × 4 = 33. Season: ship 1 90, the player 83.
    expect(last.ended?.champion).toBe(1);
    expect(last.ended?.bonus).toBe(0);
    expect(p.champion).toEqual([]);
    expect(p.trophies.neon).toEqual(['pilot']);
  });

  it('a retire in a season scores no points for that race but the season goes on', () => {
    const p = seasonProfile();
    const b = bookCupRaceOn(p, finish(WIN), TWO, 0);
    expect(b.done).toBeNull();
    expect(p.cup?.results).toHaveLength(1);
    expect(p.season?.done).toEqual([]);
  });
});
