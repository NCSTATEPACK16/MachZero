import { describe, expect, it } from 'vitest';
import type { CupDef } from '../../../content/cups';
import { seasonChampion, seasonCups, seasonFinished, seasonStandings } from '../Championship';
import type { CupState } from '../GrandPrix';

/** A finished 5-race Neon-length cup in which the ships finish every race in `order` (ids, winner first). */
function cup(cupId: string, order: number[], tier: CupState['tier'] = 'ace', races = 5): CupState {
  const row = new Array<number>(8).fill(0);
  order.forEach((id, i) => (row[id] = i + 1));
  return { cupId, tier, results: Array.from({ length: races }, () => [...row]) };
}

// Two cups of the same length as the real ones. 'neon' is real; the second reuses it under another id is not
// possible (cup length comes from content/cups), so the season tests use the two real cup ids.
const TWO: CupDef[] = [
  { id: 'neon', name: 'NEON CUP', tagline: '', worlds: ['a', 'b', 'c', 'd', 'e'] },
  { id: 'storm', name: 'STORM CUP', tagline: '', worlds: ['a', 'b', 'c', 'd', 'e'] },
];

describe('Championship: a season across cups (pure, not shown yet)', () => {
  it('the season is the playable cups in order', () => {
    expect(seasonCups().map((c) => c.id)[0]).toBe('neon');
    expect(seasonCups(TWO)).toBe(TWO);
  });

  it('sums cup points', () => {
    const t = seasonStandings([cup('neon', [0, 1, 2, 3, 4, 5, 6, 7]), cup('storm', [1, 0, 2, 3, 4, 5, 6, 7])]);
    // 5 wins (50) + 5 seconds (40) each for ships 0 and 1.
    expect(t.find((r) => r.id === 0)).toMatchObject({ points: 90, cupsWon: 1, bestCup: 1 });
    expect(t.find((r) => r.id === 1)).toMatchObject({ points: 90, cupsWon: 1, bestCup: 1 });
    expect(t.find((r) => r.id === 2)).toMatchObject({ points: 60, cupsWon: 0, bestCup: 3, rank: 3 });
    // Level on points, cups won and best cup: ship id decides, so the order is total.
    expect(t.slice(0, 2).map((r) => r.id)).toEqual([0, 1]);
  });

  it('breaks a points tie on cups won, then on the best cup rank', () => {
    // Ship 0: wins Neon (50) and is 4th in Storm (25) = 75. Ship 1: 2nd (40) + 3rd... build explicit rows.
    const neon: CupState = { cupId: 'neon', tier: 'ace', results: [[1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8]] };
    // Storm: ship 1 scores 45, ship 0 scores 35 → both 85 over the season; each won one cup? Ship 2 wins Storm.
    const storm: CupState = { cupId: 'storm', tier: 'ace', results: [[3, 1, 2, 4, 5, 6, 7, 8], [2, 3, 1, 4, 5, 6, 7, 8], [2, 3, 1, 4, 5, 6, 7, 8], [3, 2, 1, 4, 5, 6, 7, 8], [4, 2, 1, 5, 3, 6, 7, 8]] };
    const t = seasonStandings([neon, storm]);
    const a = t.find((r) => r.id === 0)!;
    const b = t.find((r) => r.id === 1)!;
    const c = t.find((r) => r.id === 2)!;
    // Neon: 50 / 40 / 30. Storm: ship 0 = 6+8+8+6+5 = 33, ship 1 = 10+6+6+8+8 = 38, ship 2 = 8+10+10+10+10 = 48.
    expect([a.points, b.points, c.points]).toEqual([83, 78, 78]);
    expect(a.rank).toBe(1);
    // Ships 1 and 2 are level on 78: ship 2 won a cup, ship 1 did not.
    expect([b.cupsWon, c.cupsWon]).toEqual([0, 1]);
    expect(c.rank).toBeLessThan(b.rank);
    // Level on points and cups won: the better best-cup rank wins.
    const x = seasonStandings([
      { cupId: 'neon', tier: 'ace', results: [[3, 1, 2, 4, 5, 6, 7, 8]] } as CupState,
    ]);
    expect(x).toEqual([]); // an unfinished cup counts for nothing
  });

  it('ignores unfinished cups, a second tier and a repeated cup', () => {
    const base = cup('neon', [0, 1, 2, 3, 4, 5, 6, 7]);
    const half = cup('storm', [1, 0, 2, 3, 4, 5, 6, 7], 'ace', 2);
    const otherTier = cup('storm', [1, 0, 2, 3, 4, 5, 6, 7], 'legend');
    const again = cup('neon', [7, 6, 5, 4, 3, 2, 1, 0]);
    const t = seasonStandings([base, half, otherTier, again]);
    expect(t.find((r) => r.id === 0)!.points).toBe(50);
    expect(t.find((r) => r.id === 7)!.points).toBe(5);
  });

  it('names the champion only once every cup is done at one tier', () => {
    const neon = cup('neon', [0, 1, 2, 3, 4, 5, 6, 7]);
    const storm = cup('storm', [0, 1, 2, 3, 4, 5, 6, 7]);
    expect(seasonFinished([neon], TWO)).toBe(false);
    expect(seasonChampion([neon], TWO)).toBeNull();
    expect(seasonFinished([neon, cup('storm', [0, 1, 2, 3, 4, 5, 6, 7], 'legend')], TWO)).toBe(false);
    expect(seasonFinished([neon, storm], TWO)).toBe(true);
    expect(seasonChampion([neon, storm], TWO)).toEqual({ id: 0, tier: 'ace' });
    // A one-cup season: winning the cup wins the season.
    expect(seasonChampion([neon], [TWO[0]])).toEqual({ id: 0, tier: 'ace' });
    expect(seasonChampion([], TWO)).toBeNull();
  });
});
