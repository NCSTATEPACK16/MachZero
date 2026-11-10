/**
 * App level, headless: a whole Grand Prix cup (IMPLEMENTATION §GP). Five real autopilot races in world order,
 * each grid built from the cup (race 1 the tier's normal grid, then the reverse of the standings), each result
 * booked with `recordRace` and saved through the SaveStore. Halfway, the save is reloaded from storage by a new
 * store (the app closed and reopened) and the cup carries on from it. At the end: points add up, the award and
 * the trophy follow the final table.
 */
import { describe, expect, it, vi } from 'vitest';
import { RACE_SIZE } from '../content/pilots';
import { addTrophy, cupAward, cupFinished, cupGridOrder, cupRaces, cupStandings, cupWorld, newCup, recordRace, type CupState } from '../game/modes/GrandPrix';
import { SaveStore, type StorageLike } from '../save/SaveStore';
import { AI_TIERS, createProfile, emptySave } from '../save/schema';
import { worldById } from '../content/worlds';
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

describe('Grand Prix: a whole cup, headless', () => {
  it('runs five races with reverse grids, survives a reload mid-cup, and settles the award', async () => {
    const storage = new MemStorage();
    let store = new SaveStore(storage);
    const save = emptySave();
    const profile = createProfile('CUP', 0, 'classic');
    profile.cup = newCup('neon', 'pilot');
    const races = cupRaces(profile.cup);
    expect(races).toBe(5);
    save.profiles.push(profile);
    save.activeProfileId = profile.id;
    store.save(save);

    const worlds: string[] = [];
    for (let race = 0; race < races; race++) {
      if (race === 3) store = new SaveStore(storage); // closed and reopened between races 3 and 4
      const data = store.load();
      const p = data.profiles[0];
      const cup = p.cup as CupState;
      expect(cup.results).toHaveLength(race);
      const world = cupWorld(cup)!;
      worlds.push(world);
      const grid = cupGridOrder(cup);
      const r = await runWorldRace(worldById(world)!.trackId, cup.tier, grid ? { gridOrder: grid } : {});
      // Every racer ends the race finished, still running (time estimated) or retired (destroyed).
      expect(r.results.map((x) => x.position).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      if (grid) {
        // The cup leader started last, the last-placed on pole.
        const table = cupStandings(cup);
        expect(grid[RACE_SIZE - 1]).toBe(table[0].id);
        expect(grid[0]).toBe(table[RACE_SIZE - 1].id);
      }
      p.cup = recordRace(cup, r.results);
      if (cupFinished(p.cup)) {
        const award = cupAward(p.cup)!;
        if (award.trophy) p.trophies = addTrophy(p.trophies, p.cup.cupId, award.trophy, AI_TIERS);
        p.credits += award.bonus;
        console.log(`cup over: player ${award.position}, bonus ${award.bonus}; ` + cupStandings(p.cup).map((s) => `${s.id}:${s.points}`).join(' '));
        expect(cupStandings(p.cup).reduce((a, s) => a + s.points, 0)).toBeLessThanOrEqual(races * 39);
        expect(award.trophy !== null).toBe(award.position === 1);
        p.cup = null;
      }
      store.save(data);
    }
    expect(worlds).toEqual(['neon-bay', 'sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring']);
    const end = new SaveStore(storage).load().profiles[0];
    expect(end.cup).toBeNull();
  });
});
