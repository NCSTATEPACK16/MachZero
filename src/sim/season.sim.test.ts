/**
 * The championship, whole and headless (IMPLEMENTATION §M8c step 4): a season at Pilot over both cups (the Neon Cup,
 * then the Storm Cup), ten real autopilot races, each booked with `bookCupRaceOn` as the App books it and saved through
 * the SaveStore. In the middle of the second cup the save is reloaded by a new store (the app closed and reopened)
 * and the season carries on. At the end the season table equals `seasonStandings` of the two cups, and the champion
 * is paid once.
 */
import { describe, expect, it, vi } from 'vitest';
import { CUPS } from '../content/cups';
import { worldById } from '../content/worlds';
import { CHAMPION_BONUS, newSeason, seasonCup, seasonStandings } from '../game/modes/Championship';
import { bookCupRaceOn, type CupBooking } from '../game/modes/cupBooking';
import { cupBonus, cupGridOrder, cupWorld, newCup, type CupState } from '../game/modes/GrandPrix';
import { SaveStore, type StorageLike } from '../save/SaveStore';
import { createProfile, emptySave } from '../save/schema';
import { runWorldRace } from './worldRace';

vi.setConfig({ testTimeout: 300_000 });

class MemStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('Championship: a whole season at Pilot, headless', () => {
  it('runs both cups in order, survives a reload mid-cup 2, and pays the champion once', async () => {
    const cups = CUPS; // both cups (every world built)
    expect(cups.map((c) => c.id)).toEqual(['neon', 'storm']);
    const storage = new MemStorage();
    let store = new SaveStore(storage);
    const save = emptySave();
    const profile = createProfile('SEASON', 0, 'classic');
    profile.trophies = { neon: ['rookie'], storm: ['rookie'] };
    profile.season = newSeason('pilot');
    profile.cup = newCup(seasonCup(profile.season, cups)!.id, 'pilot');
    save.profiles.push(profile);
    save.activeProfileId = profile.id;
    store.save(save);
    const startCredits = profile.credits;

    const played: string[] = [];
    const finished: CupState[] = [];
    let cupBonuses = 0;
    let end: CupBooking['ended'] = null;
    for (let race = 0; race < 10; race++) {
      if (race === 7) store = new SaveStore(storage); // closed and reopened in the middle of the Storm Cup
      const data = store.load();
      const p = data.profiles[0];
      expect(p.season, `race ${race + 1}: the season is still running`).not.toBeNull();
      expect(p.season!.done).toHaveLength(race < 5 ? 0 : 1);
      const cup = p.cup!;
      expect(cup.cupId).toBe(race < 5 ? 'neon' : 'storm');
      expect(cup.results).toHaveLength(race % 5);
      const world = cupWorld(cup)!;
      played.push(world);
      const grid = cupGridOrder(cup);
      const r = await runWorldRace(worldById(world)!.trackId, cup.tier, grid ? { gridOrder: grid } : {});
      const b = bookCupRaceOn(p, r.results, cups);
      if (b.done) {
        finished.push(b.done);
        cupBonuses += b.award?.bonus ?? 0;
        expect(b.inSeason).toBe(true);
      }
      if (b.ended) end = b.ended;
      store.save(data);
    }

    expect(played).toEqual([...cups[0].worlds, ...cups[1].worlds]);
    const after = new SaveStore(storage).load().profiles[0];
    expect(after.season).toBeNull();
    expect(after.cup).toBeNull();
    expect(end).not.toBeNull();
    // The season table is the two cups' standings added up.
    expect(end!.season.done).toEqual(finished);
    const table = seasonStandings(finished);
    expect(table.map((r) => r.points)).toEqual([...table.map((r) => r.points)].sort((a, b) => b - a));
    expect(end!.champion).toBe(table[0].id);
    const champBonus = end!.champion === 0 ? Math.round(CHAMPION_BONUS * 1.3) : 0;
    expect(end!.bonus).toBe(champBonus);
    expect(after.champion).toEqual(end!.champion === 0 ? ['pilot'] : []);
    // Credits: ten races' pay is not booked here (the App does it), so the change is the cup and champion bonuses.
    expect(after.credits - startCredits).toBe(cupBonuses + champBonus);
    expect(cupBonuses % cupBonus('pilot')).toBe(0);
    console.log(`season: ${table.map((r) => `${r.id}:${r.points}${r.cupsWon ? `(${r.cupsWon}🏆)` : ''}`).join(' ')}; champion ${end!.champion}, bonus ${end!.bonus}`);
  });
});
