import { describe, expect, it } from 'vitest';
import type { AITier, RacerStanding } from '../../../core/contracts';
import { WORLDS, type WorldId } from '../../../content/worlds';
import { emptyTour, type TourState } from '../../../save/schema';
import { CLEAR_POSITION, FIRST_CLEAR_BONUS, bookTourRace, tourTrophies, tourWorlds, worldCleared, worldUnlocked } from '../WorldTour';

const me = (position: number, status: RacerStanding['status'] = 'finished'): RacerStanding => ({ id: 0, name: 'ME', position, lap: 3, progress: 3, totalTime: 90, bestLap: 30, status });
const FIVE = tourWorlds({ expansion: false });
const EIGHT = tourWorlds({ expansion: true });

describe('World Tour (IMPLEMENTATION §M8a)', () => {
  it('the tour worlds are the visible worlds in tour order', () => {
    expect(FIVE.map((w) => w.order)).toEqual([1, 2, 3, 4, 5]);
    expect(EIGHT.map((w) => w.id)).toEqual(WORLDS.map((w) => w.id));
    expect(CLEAR_POSITION).toBe(3);
    expect(FIRST_CLEAR_BONUS).toBe(1000);
  });

  it('a new tour has only the first world open', () => {
    const t = emptyTour();
    expect(FIVE.map((w) => worldUnlocked(t, w.id, FIVE))).toEqual([true, false, false, false, false]);
    expect(worldCleared(t, 'neon-bay')).toBe(false);
  });

  it('4th place changes nothing', () => {
    const r = bookTourRace(emptyTour(), 'neon-bay', 'legend', me(4), FIVE);
    expect(r).toEqual({ tour: emptyTour(), firstClear: false, newTrophies: [], unlocked: null, bonus: 0 });
  });

  it('a retired ship in 3rd, an unfinished race or no standing changes nothing', () => {
    expect(bookTourRace(emptyTour(), 'neon-bay', 'pilot', me(3, 'retired'), FIVE).newTrophies).toEqual([]);
    expect(bookTourRace(emptyTour(), 'neon-bay', 'pilot', me(1, 'racing'), FIVE).newTrophies).toEqual([]);
    expect(bookTourRace(emptyTour(), 'neon-bay', 'pilot', undefined, FIVE).bonus).toBe(0);
  });

  it('an Ace clear gives the Rookie, Pilot and Ace trophies, pays the bonus and opens the next world', () => {
    const r = bookTourRace(emptyTour(), 'neon-bay', 'ace', me(3), FIVE);
    expect(r.newTrophies).toEqual(['rookie', 'pilot', 'ace']);
    expect(tourTrophies(r.tour, 'neon-bay')).toEqual(['rookie', 'pilot', 'ace']);
    expect(r.firstClear).toBe(true);
    expect(r.bonus).toBe(FIRST_CLEAR_BONUS);
    expect(r.unlocked).toBe('sunset-mesa');
    expect(worldUnlocked(r.tour, 'sunset-mesa', FIVE)).toBe(true);
    expect(worldUnlocked(r.tour, 'cryo-station', FIVE)).toBe(false);
  });

  it('a second clear pays no bonus and unlocks nothing; a higher tier adds only its new trophies', () => {
    const a = bookTourRace(emptyTour(), 'neon-bay', 'pilot', me(1), FIVE);
    const b = bookTourRace(a.tour, 'neon-bay', 'rookie', me(2), FIVE);
    expect(b).toEqual({ tour: a.tour, firstClear: false, newTrophies: [], unlocked: null, bonus: 0 });
    const c = bookTourRace(a.tour, 'neon-bay', 'legend', me(1), FIVE);
    expect(c.newTrophies).toEqual(['ace', 'legend']);
    expect(c.firstClear).toBe(false);
    expect(c.bonus).toBe(0);
    expect(tourTrophies(c.tour, 'neon-bay')).toEqual(['rookie', 'pilot', 'ace', 'legend']);
  });

  it('the input tour is never changed', () => {
    const t: TourState = { granted: ['neon-bay'], trophies: { 'neon-bay': ['rookie'] } };
    const copy = structuredClone(t);
    bookTourRace(t, 'neon-bay', 'legend', me(1), FIVE);
    bookTourRace(t, 'sunset-mesa', 'legend', me(1), FIVE);
    expect(t).toEqual(copy);
  });

  it('a granted world is open; clearing it later still pays its bonus once, and opens nothing already open', () => {
    const t: TourState = { granted: ['neon-bay', 'sunset-mesa', 'cryo-station'], trophies: {} };
    expect(FIVE.map((w) => worldUnlocked(t, w.id, FIVE))).toEqual([true, true, true, false, false]);
    const a = bookTourRace(t, 'sunset-mesa', 'rookie', me(2), FIVE);
    expect(a.firstClear).toBe(true);
    expect(a.bonus).toBe(FIRST_CLEAR_BONUS);
    expect(a.unlocked).toBeNull(); // Cryo Station was granted already
    expect(bookTourRace(a.tour, 'sunset-mesa', 'pilot', me(1), FIVE).bonus).toBe(0);
    // Clearing the last granted world opens the next one.
    expect(bookTourRace(t, 'cryo-station', 'rookie', me(1), FIVE).unlocked).toBe('jade-ruins');
  });

  it('the chain with 5 visible worlds: five clears in order open every world and pay five bonuses', () => {
    let t = emptyTour();
    let paid = 0;
    const opened: (WorldId | null)[] = [];
    for (const w of FIVE) {
      expect(worldUnlocked(t, w.id, FIVE)).toBe(true);
      const r = bookTourRace(t, w.id, 'rookie', me(1), FIVE);
      t = r.tour;
      paid += r.bonus;
      opened.push(r.unlocked);
    }
    expect(paid).toBe(5 * FIRST_CLEAR_BONUS);
    expect(opened).toEqual(['sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring', null]);
    expect(FIVE.every((w) => worldCleared(t, w.id))).toBe(true);
  });

  it('the chain with 8 visible worlds continues after world 5', () => {
    let t = emptyTour();
    const opened: (WorldId | null)[] = [];
    for (const w of EIGHT) {
      const r = bookTourRace(t, w.id, 'pilot', me(3), EIGHT);
      t = r.tour;
      opened.push(r.unlocked);
    }
    expect(opened).toEqual(['sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring', 'tempest-spire', 'cinder-forge', 'abyss-line', null]);
    expect(EIGHT.every((w) => worldUnlocked(t, w.id, EIGHT))).toBe(true);
  });

  it('a world hidden by the flag neither blocks nor unlocks anything', () => {
    // Orbital Ring cleared: with 5 visible worlds there is no next world.
    let t = emptyTour();
    for (const w of FIVE.slice(0, 4)) t = bookTourRace(t, w.id, 'rookie', me(1), FIVE).tour;
    const last = bookTourRace(t, 'orbital-ring', 'rookie', me(1), FIVE);
    expect(last.unlocked).toBeNull();
    t = last.tour;
    // A hidden world is never unlocked, and booking one changes nothing.
    expect(worldUnlocked(t, 'tempest-spire', FIVE)).toBe(false);
    const r = bookTourRace(t, 'tempest-spire', 'rookie', me(1), FIVE);
    expect(r.tour).toEqual(t);
    expect(r.bonus).toBe(0);
    // When the flag turns on, Tempest Spire follows a cleared Orbital Ring.
    expect(worldUnlocked(t, 'tempest-spire', EIGHT)).toBe(true);
    expect(worldUnlocked(t, 'cinder-forge', EIGHT)).toBe(false);
  });

  it('progress further along the chain opens every world before it (a world raced while the tour was off)', () => {
    const r = bookTourRace(emptyTour(), 'jade-ruins', 'pilot', me(2), FIVE);
    expect(r.firstClear).toBe(true);
    expect(r.unlocked).toBe('orbital-ring');
    expect(FIVE.map((w) => worldUnlocked(r.tour, w.id, FIVE))).toEqual([true, true, true, true, true]);
    expect(FIVE.map((w) => worldCleared(r.tour, w.id))).toEqual([false, false, false, true, false]);
  });

  it('every tier clears with a top 3', () => {
    for (const tier of ['rookie', 'pilot', 'ace', 'legend'] as AITier[]) {
      expect(bookTourRace(emptyTour(), 'neon-bay', tier, me(CLEAR_POSITION), FIVE).firstClear).toBe(true);
    }
  });
});
