/**
 * Ordered save migrations. `MIGRATIONS[n]` upgrades a version-n object to version n + 1. Version 1 is the
 * v1 game, which had no save object, only the lap record under `machzero.recordLap`; SaveStore wraps that
 * as `{ version: 1, recordLap }` before migrating.
 */
import { CONFIG } from '../core/config';
import { DEFAULT_CUP_ID } from '../content/cups';
import { SAVE_VERSION, createProfile, defaultSettings } from './schema';

type Obj = Record<string, unknown>;

export interface V1Save {
  version: 1;
  recordLap: number | null;
}

export const MIGRATIONS: Readonly<Record<number, (save: Obj) => Obj>> = {
  // v1 → 2: the v1 lap record becomes the "Classic" record of a profile named PILOT (Classic preset),
  // so returning players keep their best lap and simply rename the profile if they like.
  1: (save) => {
    const lap = save.recordLap;
    const out: Obj = { version: 2, profiles: [], activeProfileId: null, settings: defaultSettings() };
    if (typeof lap === 'number' && Number.isFinite(lap) && lap > 0) {
      const p = createProfile('PILOT', 0, 'classic');
      p.records.classic = { bestLap: lap };
      out.profiles = [p];
      out.activeProfileId = p.id;
    }
    return out;
  },
  // v2 → 3: every race so far ran Rookie rivals whatever the profile said (tiers were not wired in), so
  // existing profiles keep that difficulty now that the picker is live. Profiles gain an empty item bag.
  2: (save) => ({
    ...save,
    version: 3,
    profiles: Array.isArray(save.profiles) ? save.profiles.map((p) => (typeof p === 'object' && p !== null ? { ...p, aiTier: 'rookie', items: { emp: 0 } } : p)) : [],
  }),
  // v3 → 4: the Shield and Drop Mine join the EMP (IMPLEMENTATION §P): the bag holds a count per kind. The
  // sanitizer clamps the total to the slot count afterwards.
  3: (save) => ({
    ...save,
    version: 4,
    profiles: Array.isArray(save.profiles)
      ? save.profiles.map((p) => {
          if (typeof p !== 'object' || p === null) return p;
          const items = (p as Obj).items;
          const emp = typeof items === 'object' && items !== null ? (items as Obj).emp : 0;
          return { ...p, items: { emp: typeof emp === 'number' ? emp : 0, shield: 0, mine: 0 } };
        })
      : [],
  }),
  // v4 → 5: Grand Prix cups (IMPLEMENTATION §GP): no cup in progress, no trophies yet.
  4: (save) => ({
    ...save,
    version: 5,
    profiles: Array.isArray(save.profiles) ? save.profiles.map((p) => (typeof p === 'object' && p !== null ? { ...p, cup: null, trophies: [] } : p)) : [],
  }),
  // v5 → 6: cups become a list (IMPLEMENTATION §X1). The one cup so far is the Neon Cup: a cup in progress
  // gains its id, and the trophies (a list of tiers) become that cup's trophies.
  5: (save) => ({
    ...save,
    version: 6,
    profiles: Array.isArray(save.profiles)
      ? save.profiles.map((p) => {
          if (typeof p !== 'object' || p === null) return p;
          const { cup, trophies } = p as Obj;
          return {
            ...p,
            cup: typeof cup === 'object' && cup !== null ? { ...cup, cupId: DEFAULT_CUP_ID } : null,
            trophies: Array.isArray(trophies) && trophies.length ? { [DEFAULT_CUP_ID]: trophies } : {},
          };
        })
      : [],
  }),
  // v6 → 7: sidegrades and the Aero slot (IMPLEMENTATION §X3). Owned parts become part keys: every tier owned
  // so far is the A variant ('1a'), Stock is '0'. The loadout gains Stock Aero and variant A everywhere.
  6: (save) => ({
    ...save,
    version: 7,
    profiles: Array.isArray(save.profiles)
      ? save.profiles.map((p) => {
          if (typeof p !== 'object' || p === null) return p;
          const { owned, loadout } = p as Obj;
          const ow = typeof owned === 'object' && owned !== null ? (owned as Obj) : {};
          const keys: Obj = { aero: ['0'] };
          for (const slot of ['engine', 'booster', 'stabilizer', 'hull']) {
            const list = Array.isArray(ow[slot]) ? (ow[slot] as unknown[]) : [];
            keys[slot] = list.filter((t) => t === 0 || t === 1 || t === 2 || t === 3).map((t) => (t === 0 ? '0' : `${t}a`));
          }
          const lo = typeof loadout === 'object' && loadout !== null ? (loadout as Obj) : {};
          const parts = typeof lo.parts === 'object' && lo.parts !== null ? (lo.parts as Obj) : {};
          return {
            ...p,
            owned: keys,
            loadout: { ...lo, parts: { ...parts, aero: 0 }, variants: { engine: 'a', booster: 'a', stabilizer: 'a', hull: 'a', aero: 'a' } },
          };
        })
      : [],
  }),
};

/** Version of a raw save (missing or invalid → 0, treated as unreadable by the caller). */
export function versionOf(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null) return 0;
  const v = (raw as Obj).version;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0;
}

/** Apply every migration from the object's version up to SAVE_VERSION. Unknown/older-than-1 → null. */
export function migrate(raw: unknown): Obj | null {
  let v = versionOf(raw);
  if (v === 0 || v > SAVE_VERSION) return null;
  let save = raw as Obj;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) return null;
    save = step(save);
    v = versionOf(save);
  }
  return save;
}

/** Read v1's legacy lap record as a version-1 save. */
export function readV1(getItem: (key: string) => string | null): V1Save {
  const raw = getItem(CONFIG.RECORD_STORAGE_KEY);
  const lap = raw === null ? Number.NaN : Number.parseFloat(raw);
  return { version: 1, recordLap: Number.isFinite(lap) && lap > 0 ? lap : null };
}
