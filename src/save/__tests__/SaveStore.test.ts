import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../../core/config';
import { SaveStore, type StorageLike } from '../SaveStore';
import { MIGRATIONS, migrate } from '../migrations';
import { DEFAULT_KEY_BINDINGS, SAVE_KEY, SAVE_VERSION, createProfile, defaultSettings, emptySave, sanitizeSave } from '../schema';

class MemStorage implements StorageLike {
  readonly map = new Map<string, string>();
  failWrites = false;
  failReads = false;
  getItem(k: string): string | null {
    if (this.failReads) throw new Error('SecurityError');
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw new DOMException('quota', 'QuotaExceededError');
    this.map.set(k, v);
  }
}

describe('SaveStore', () => {
  it('starts empty with default settings on a fresh device', () => {
    const s = new SaveStore(new MemStorage());
    expect(s.load()).toEqual(emptySave());
    expect(s.persistent).toBe(true);
  });

  it('round-trips profiles and settings', () => {
    const mem = new MemStorage();
    const store = new SaveStore(mem);
    const data = emptySave();
    const p = createProfile('ada', 3, 'rookie');
    p.records.classic = { bestLap: 31.25 };
    p.credits = 1234;
    data.profiles.push(p);
    data.activeProfileId = p.id;
    data.settings.largeText = true;
    data.settings.keyBindings.boost = ['KeyB'];
    store.save(data);
    const again = new SaveStore(mem).load();
    expect(again).toEqual(data);
    expect(again.profiles[0].name).toBe('ADA');
    expect(again.profiles[0].assists).toEqual({ autoAccelerate: true, steering: 2, noKO: true, earlyBoost: true });
  });

  it('migrates v1: the legacy lap record becomes the Classic record of an active PILOT profile', () => {
    const mem = new MemStorage();
    mem.map.set(CONFIG.RECORD_STORAGE_KEY, '32.5');
    const data = new SaveStore(mem).load();
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.profiles).toHaveLength(1);
    expect(data.profiles[0].name).toBe('PILOT');
    expect(data.profiles[0].records.classic).toEqual({ bestLap: 32.5 });
    expect(data.profiles[0].assists.autoAccelerate).toBe(false);
    expect(data.activeProfileId).toBe(data.profiles[0].id);
  });

  it('migrates v1 without a record (or a junk record) to an empty save', () => {
    expect(new SaveStore(new MemStorage()).load().profiles).toEqual([]);
    const mem = new MemStorage();
    mem.map.set(CONFIG.RECORD_STORAGE_KEY, 'banana');
    expect(new SaveStore(mem).load().profiles).toEqual([]);
  });

  it('has a migration for every version below the current one', () => {
    for (let v = 1; v < SAVE_VERSION; v++) expect(MIGRATIONS[v], `migration ${v}`).toBeTypeOf('function');
    expect(migrate({ version: 1, recordLap: null })).toMatchObject({ version: SAVE_VERSION });
    expect(migrate({})).toBeNull();
    expect(migrate({ version: SAVE_VERSION + 1 })).toBeNull();
  });

  it('migrates v2: existing profiles race Rookie rivals (the tier was never applied before)', () => {
    const p = createProfile('ACE', 0, 'classic');
    expect(p.aiTier).toBe('pilot');
    const out = migrate({ version: 2, profiles: [p], activeProfileId: p.id, settings: defaultSettings() }) as { profiles: Array<{ aiTier: string }> };
    expect(out.profiles[0].aiTier).toBe('rookie');
  });

  it('migrates v3: the EMP count becomes a bag of every kind, clamped to the slots (EMPs kept first)', () => {
    const p = { ...createProfile('ACE', 0, 'classic'), items: { emp: 2 } };
    const out = migrate({ version: 3, profiles: [p, null], activeProfileId: p.id, settings: defaultSettings() }) as { version: number; profiles: Array<{ items: unknown }> };
    expect(out.version).toBe(SAVE_VERSION); // chained on through every later migration
    expect(out.profiles[0].items).toEqual({ emp: 2, shield: 0, mine: 0 });
    // A v3 profile with no bag, and an over-full v4 bag, both come out clean.
    const noBag = migrate({ version: 3, profiles: [{ ...p, items: undefined }], activeProfileId: p.id, settings: defaultSettings() }) as { profiles: Array<{ items: unknown }> };
    expect(noBag.profiles[0].items).toEqual({ emp: 0, shield: 0, mine: 0 });
    const full = sanitizeSave({ version: 4, profiles: [{ id: 'a', name: 'A', items: { emp: 1, shield: 5, mine: 2 } }] });
    expect(full.profiles[0].items).toEqual({ emp: 1, shield: 1, mine: 0 });
  });

  it('migrates v4: no cup in progress and no trophies; a saved cup and trophies survive a reload', () => {
    const p = { ...createProfile('CUP', 0, 'classic') } as Record<string, unknown>;
    delete p.cup;
    delete p.trophies;
    const out = migrate({ version: 4, profiles: [p], activeProfileId: p.id, settings: defaultSettings() }) as { version: number; profiles: Array<Record<string, unknown>> };
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.profiles[0]).toMatchObject({ cup: null, trophies: {} });
    const cup = { cupId: 'neon', tier: 'ace', results: [[2, 1, 3, 4, 5, 6, 7, 8]] };
    const back = sanitizeSave({ version: SAVE_VERSION, profiles: [{ id: 'a', name: 'A', cup, trophies: { neon: ['legend', 'rookie', 'boss', 'rookie'] } }] });
    expect(back.profiles[0].cup).toEqual(cup);
    expect(back.profiles[0].trophies).toEqual({ neon: ['rookie', 'legend'] });
    expect(sanitizeSave({ version: SAVE_VERSION, profiles: [{ id: 'a', name: 'A', cup: { cupId: 'neon', tier: 'ace', results: 'x' } }] }).profiles[0].cup).toBeNull();
  });

  it('migrates v5: the cup in progress and the trophies become the Neon Cup\'s (IMPLEMENTATION §X1)', () => {
    const base = { ...createProfile('CUP', 0, 'classic') } as Record<string, unknown>;
    const results = [[2, 1, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8]];
    const v5 = { ...base, cup: { tier: 'pilot', results }, trophies: ['rookie', 'ace'], credits: 4321 };
    const storage = new MemStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 5, profiles: [v5], activeProfileId: base.id, settings: defaultSettings() }));
    const p = new SaveStore(storage).load().profiles[0];
    expect(p.cup).toEqual({ cupId: 'neon', tier: 'pilot', results });
    expect(p.trophies).toEqual({ neon: ['rookie', 'ace'] });
    expect(p.credits).toBe(4321);
    // No cup and no trophies: stays empty.
    const none = migrate({ version: 5, profiles: [{ ...base, cup: null, trophies: [] }], activeProfileId: base.id, settings: defaultSettings() }) as { version: number; profiles: Array<Record<string, unknown>> };
    expect(none.version).toBe(SAVE_VERSION);
    expect(none.profiles[0]).toMatchObject({ cup: null, trophies: {} });
    // A saved cup that names a cup this build can't play is dropped; the trophies and the rest stay.
    const odd = sanitizeSave({ version: SAVE_VERSION, profiles: [{ id: 'a', name: 'A', credits: 99, cup: { cupId: 'bogus', tier: 'ace', results: [] }, trophies: { neon: ['ace'], bogus: ['ace'] } }] });
    expect(odd.profiles[0]).toMatchObject({ cup: null, trophies: { neon: ['ace'] }, credits: 99 });
  });

  it('migrates v6: owned tiers become variant-A part keys; the loadout gains Stock Aero (IMPLEMENTATION §X3)', () => {
    const base = { ...createProfile('PARTS', 0, 'classic') } as Record<string, unknown>;
    const livery = { primary: 0x112233, secondary: 0x445566, glow: 0x778899, decal: 2 };
    const v6 = {
      ...base,
      credits: 777,
      owned: { engine: [0, 1, 3], booster: [0, 2], stabilizer: [0], hull: [0, 1] },
      loadout: { chassisId: 'titan', parts: { engine: 3, booster: 2, stabilizer: 0, hull: 1 }, livery },
    };
    const storage = new MemStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 6, profiles: [v6], activeProfileId: base.id, settings: defaultSettings() }));
    const p = new SaveStore(storage).load().profiles[0];
    expect(p.owned).toEqual({ engine: ['0', '1a', '3a'], booster: ['0', '2a'], stabilizer: ['0'], hull: ['0', '1a'], aero: ['0'] });
    expect(p.loadout).toEqual({
      chassisId: 'titan',
      parts: { engine: 3, booster: 2, stabilizer: 0, hull: 1, aero: 0 },
      variants: { engine: 'a', booster: 'a', stabilizer: 'a', hull: 'a', aero: 'a' },
      livery,
    });
    expect(p.credits).toBe(777);
  });

  it('v7 parts: a fitted part must be owned in that variant; bad keys are dropped', () => {
    const p = sanitizeSave({
      version: SAVE_VERSION,
      profiles: [
        {
          id: 'a',
          name: 'A',
          owned: { engine: ['0', '2b', '9z', 2, '2b'], booster: ['1a'], hull: ['3b'], aero: ['1a', '2b'] },
          loadout: { chassisId: 'comet', parts: { engine: 2, booster: 1, stabilizer: 1, hull: 3, aero: 2 }, variants: { engine: 'b', booster: 'b', hull: 'b', aero: 'b' } },
        },
      ],
    }).profiles[0];
    expect(p.owned).toEqual({ engine: ['0', '2b'], booster: ['0', '1a'], stabilizer: ['0'], hull: ['0', '3b'], aero: ['0', '1a'] });
    // engine 2b is owned and stays; booster 1b is not owned (1a is) → Stock; stabilizer 1 is not owned → Stock;
    // hull 3b stays; Aero Mk III is not owned → Stock.
    expect(p.loadout.parts).toEqual({ engine: 2, booster: 0, stabilizer: 0, hull: 3, aero: 0 });
    expect(p.loadout.variants).toEqual({ engine: 'b', booster: 'a', stabilizer: 'a', hull: 'b', aero: 'a' });
  });

  it('corrupt JSON gives safe defaults', () => {
    const mem = new MemStorage();
    mem.map.set(SAVE_KEY, '{"version":2,"profiles":[{"id":');
    expect(new SaveStore(mem).load()).toEqual(emptySave());
  });

  it('corrupt fields are repaired field by field', () => {
    const mem = new MemStorage();
    mem.map.set(
      SAVE_KEY,
      JSON.stringify({
        version: 2,
        activeProfileId: 'ghost',
        profiles: [
          { id: 'a', name: '<script>x', badge: 99, credits: -5, aiTier: 'godlike', loadout: { chassisId: 'ufo', parts: { engine: 3 } }, owned: { engine: [7] }, records: { classic: { bestLap: -1 } } },
          { id: 'a', name: 'dupe' },
          { name: 'no id' },
          'nonsense',
        ],
        settings: { masterVolume: 7, quality: 'ultra', keyBindings: { boost: ['Escape', 'KeyB', 'KeyB'], left: 'x' } },
      }),
    );
    const d = new SaveStore(mem).load();
    expect(d.profiles).toHaveLength(1);
    const p = d.profiles[0];
    expect(p.name).toBe('SCRIPTX');
    expect(p.badge).toBe(0);
    expect(p.credits).toBe(0);
    expect(p.aiTier).toBe('rookie');
    expect(p.loadout.chassisId).toBe('comet');
    expect(p.loadout.parts.engine).toBe(0); // not owned → stock
    expect(p.owned.engine).toEqual(['0']);
    expect(p.owned.aero).toEqual(['0']);
    expect(p.loadout.parts.aero).toBe(0);
    expect(p.records.classic).toEqual({});
    expect(d.activeProfileId).toBeNull();
    expect(d.settings.masterVolume).toBe(1);
    expect(d.settings.quality).toBe('auto');
    expect(d.settings.keyBindings.boost).toEqual(['KeyB']);
    expect(d.settings.keyBindings.left).toEqual(DEFAULT_KEY_BINDINGS.left);
  });

  it('keeps the selected world when it is built, otherwise falls back to the first world', () => {
    const p = (world: unknown) => sanitizeSave({ version: 2, profiles: [{ id: 'a', name: 'A', world }] }).profiles[0].world;
    expect(createProfile('KID', 0, 'rookie').world).toBe('neon-bay');
    expect(p('sunset-mesa')).toBe('sunset-mesa');
    expect(p('cryo-station')).toBe('cryo-station');
    expect(p('jade-ruins')).toBe('jade-ruins');
    expect(p('orbital-ring')).toBe('orbital-ring');
    expect(p('atlantis')).toBe('neon-bay');
    expect(p(undefined)).toBe('neon-bay');
  });

  it('a key bound to two controls keeps only its first use', () => {
    const d = sanitizeSave({ version: 2, settings: { keyBindings: { throttle: ['KeyA'], left: ['KeyA', 'KeyZ'] } } });
    expect(d.settings.keyBindings.throttle).toEqual(['KeyA']);
    expect(d.settings.keyBindings.left).toEqual(['KeyZ']);
  });

  it('quota errors fall back to memory once and keep the session going', () => {
    const mem = new MemStorage();
    const onFallback = vi.fn();
    const store = new SaveStore(mem, { onFallback });
    mem.failWrites = true;
    const data = emptySave();
    data.profiles.push(createProfile('kid', 1, 'rookie'));
    store.save(data);
    store.save(data);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith('write-failed');
    expect(store.persistent).toBe(false);
    expect(store.load().profiles[0].name).toBe('KID');
  });

  it('blocked storage (reads throw) gives defaults and a single fallback notice', () => {
    const mem = new MemStorage();
    mem.failReads = true;
    const onFallback = vi.fn();
    const store = new SaveStore(mem, { onFallback });
    expect(store.load()).toEqual(emptySave());
    expect(onFallback).toHaveBeenCalledWith('unavailable');
  });

  it('no storage at all runs in memory', () => {
    const onFallback = vi.fn();
    const store = new SaveStore(null, { onFallback });
    const d = emptySave();
    d.settings.muted = true;
    store.save(d);
    expect(store.load().settings.muted).toBe(true);
    expect(onFallback).toHaveBeenCalledWith('unavailable');
  });

  it('never overwrites a save written by a newer build', () => {
    const mem = new MemStorage();
    const future = JSON.stringify({ version: SAVE_VERSION + 1, profiles: [{ id: 'z', name: 'future' }], settings: {} });
    mem.map.set(SAVE_KEY, future);
    const onFallback = vi.fn();
    const store = new SaveStore(mem, { onFallback });
    const d = store.load();
    expect(d.profiles[0].name).toBe('FUTURE');
    store.save(emptySave());
    expect(mem.map.get(SAVE_KEY)).toBe(future);
    expect(onFallback).toHaveBeenCalledWith('newer-version');
  });

  it('exports and imports JSON', () => {
    const store = new SaveStore(new MemStorage());
    const d = emptySave();
    d.profiles.push(createProfile('max', 5, 'classic'));
    d.activeProfileId = d.profiles[0].id;
    d.settings = { ...defaultSettings(), colorBlind: true };
    expect(store.importJson(store.exportJson(d))).toEqual(d);
  });

  it('import rejects files that are not MachZero saves', () => {
    const store = new SaveStore(new MemStorage());
    expect(() => store.importJson('nope')).toThrow(/not valid JSON/);
    expect(() => store.importJson('{"hello":1}')).toThrow(/not a MachZero save/);
    expect(() => store.importJson(JSON.stringify({ version: SAVE_VERSION + 5 }))).toThrow(/newer version/);
  });
});
