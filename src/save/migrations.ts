/**
 * Ordered save migrations. `MIGRATIONS[n]` upgrades a version-n object to version n + 1. Version 1 is the
 * v1 game, which had no save object, only the lap record under `machzero.recordLap`; SaveStore wraps that
 * as `{ version: 1, recordLap }` before migrating.
 */
import { CONFIG } from '../core/config';
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
