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
    expect(p.aiTier).toBe('pilot');
    expect(p.loadout.chassisId).toBe('comet');
    expect(p.loadout.parts.engine).toBe(0); // not owned → stock
    expect(p.owned.engine).toEqual([0]);
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
    expect(p('cryo-station')).toBe('neon-bay'); // not built yet
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
