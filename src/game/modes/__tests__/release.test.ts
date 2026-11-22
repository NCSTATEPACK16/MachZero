/**
 * The 2.0 release (IMPLEMENTATION §M8d, the device gate's step 4): the live site ran save v9 with `modes` off. There a
 * race granted its world (`tour.granted`) and every cup was open. A save written that way, loaded by 2.0 with the
 * World Tour on, keeps everything: the worlds it raced stay open, a cup it holds a trophy of stays open, and its
 * credits, parts, records and trophies are untouched.
 */
import { describe, expect, it } from 'vitest';
import { cupById, cupUnlocked } from '../../../content/cups';
import { worldsFor } from '../../../content/worlds';
import { SaveStore, type StorageLike } from '../../../save/SaveStore';
import { SAVE_KEY, createProfile, defaultSettings } from '../../../save/schema';
import { tourWorlds, worldUnlocked } from '../WorldTour';

function load(save: unknown) {
  const map = new Map<string, string>([[SAVE_KEY, JSON.stringify(save)]]);
  const storage: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
  return new SaveStore(storage).load();
}

/** A profile as the live site (save v9, `modes` off) wrote it after some racing. */
function liveProfile(granted: string[], trophies: Record<string, string[]>) {
  const p = createProfile('veteran', 4, 'classic');
  return {
    ...p,
    credits: 12_340,
    owned: { ...p.owned, engine: ['0', '1a', '2b'], hull: ['0', '1a'] },
    loadout: { ...p.loadout, chassisId: 'bastion', parts: { ...p.loadout.parts, engine: 2, hull: 1 }, variants: { ...p.loadout.variants, engine: 'b' } },
    records: { 'neon-bay': { bestLap: 31.4 }, 'sunset-mesa': { bestLap: 32.9 }, 'cryo-station': { bestLap: 27.1 } },
    stats: { races: 23, wins: 7 },
    trophies,
    tour: { granted, trophies: {} },
    tutorialDone: true,
  };
}

describe('MachZero 2.0: a save from the live site (modes off) under the World Tour', () => {
  const worlds = tourWorlds({ expansion: false });

  it('keeps the worlds it raced open, and the rest of the chain locked', () => {
    const p = liveProfile(['neon-bay', 'sunset-mesa', 'cryo-station'], {});
    const d = load({ version: 9, profiles: [p], activeProfileId: p.id, settings: defaultSettings() });
    const q = d.profiles[0];
    expect(d.version).toBe(9);
    expect(worlds.map((w) => worldUnlocked(q.tour, w.id, worlds))).toEqual([true, true, true, false, false]);
    expect(q.credits).toBe(12_340);
    expect(q.owned.engine).toEqual(['0', '1a', '2b']);
    expect(q.loadout).toMatchObject({ chassisId: 'bastion', parts: { engine: 2, hull: 1 }, variants: { engine: 'b' } });
    expect(q.records['cryo-station']).toEqual({ bestLap: 27.1 });
    expect(q.stats).toEqual({ races: 23, wins: 7 });
  });

  it('a cup it holds a trophy of stays open; with none, the cup waits for its world on the Tour', () => {
    const neon = cupById('neon')!;
    const won = load({ version: 9, profiles: [liveProfile(['neon-bay'], { neon: ['pilot'] })], activeProfileId: null, settings: defaultSettings() }).profiles[0];
    expect(won.trophies).toEqual({ neon: ['pilot'] });
    expect(cupUnlocked(neon, won)).toBe(true);
    const none = load({ version: 9, profiles: [liveProfile(['neon-bay'], {})], activeProfileId: null, settings: defaultSettings() }).profiles[0];
    expect(cupUnlocked(neon, none)).toBe(false);
  });

  it('a world raced on the live site with `expansion` (a later world granted) opens every world before it', () => {
    const all = worldsFor({ expansion: true });
    const p = liveProfile(['abyss-line'], {});
    const q = load({ version: 9, profiles: [p], activeProfileId: p.id, settings: defaultSettings() }).profiles[0];
    expect(all.every((w) => worldUnlocked(q.tour, w.id, all))).toBe(true);
  });
});
