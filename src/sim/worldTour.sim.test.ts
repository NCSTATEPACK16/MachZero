/**
 * World Tour end to end (IMPLEMENTATION §M8a step 7): the Rookie-preset stand-in (Rookie hazards, the Rookie assists,
 * at its rivals' pace) races the eight worlds in tour order and each race is booked with `bookTourRace`. After eight
 * races every world is cleared and eight first-clear bonuses were paid: a Rookie never grinds.
 */
import { describe, expect, it, vi } from 'vitest';
import { HAZARDS_ROOKIE } from '../core/hazards';
import { bookTourRace, FIRST_CLEAR_BONUS, tourWorlds, worldCleared, worldUnlocked } from '../game/modes/WorldTour';
import { emptyTour } from '../save/schema';
import { runWorldRace } from './worldRace';

vi.setConfig({ testTimeout: 60_000 });

describe('World Tour: a Rookie clears all eight worlds in eight races', () => {
  const worlds = tourWorlds({ expansion: true });
  let tour = emptyTour();
  let bonus = 0;
  const rows: string[] = [];

  /** Race and book worlds [from, to) in order; each must be open when its turn comes. */
  async function leg(from: number, to: number): Promise<void> {
    for (const w of worlds.slice(from, to)) {
      expect(worldUnlocked(tour, w.id, worlds)).toBe(true);
      const r = await runWorldRace(w.trackId, 'rookie', { hazards: HAZARDS_ROOKIE, player: { tier: 'rookie', pace: 1, assisted: true } });
      const me = r.results.find((s) => s.id === 0);
      const b = bookTourRace(tour, w.id, 'rookie', me, worlds);
      rows.push(`${w.id.padEnd(14)} P${me?.position} ${me?.status} +${b.bonus} unlocked ${b.unlocked ?? '-'}`);
      expect(b.firstClear).toBe(true);
      tour = b.tour;
      bonus += b.bonus;
    }
  }

  // Two legs, so neither test is near the per-test timeout on a slow runner; the second goes on from the first.
  it('worlds 1–4: each opens in turn and is cleared with a top 3', async () => {
    expect(worlds).toHaveLength(8);
    await leg(0, 4);
  });

  it('worlds 5–8, and the whole tour is cleared with one bonus per world', async () => {
    await leg(4, 8);
    console.log(`world tour (rookie):\n${rows.join('\n')}`);
    expect(worlds.every((w) => worldCleared(tour, w.id))).toBe(true);
    expect(bonus).toBe(8 * FIRST_CLEAR_BONUS);
  });
});
