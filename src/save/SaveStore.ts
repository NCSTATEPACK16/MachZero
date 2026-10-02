/**
 * Versioned save in localStorage (`machzero.save`). All storage access is wrapped: if storage is missing,
 * throws, is full, or holds a save from a newer build, the game keeps running on an in-memory copy and
 * `onFallback` fires once so the UI can show a toast.
 */
import { migrate, readV1, versionOf } from './migrations';
import { SAVE_KEY, SAVE_VERSION, emptySave, sanitizeSave, type SaveData } from './schema';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export type FallbackReason = 'unavailable' | 'write-failed' | 'newer-version';

export interface SaveStoreOptions {
  /** Called once, the first time the store falls back to memory. */
  onFallback?: (reason: FallbackReason) => void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // e.g. Safari with storage blocked throws on access
  }
}

export class SaveStore {
  private storage: StorageLike | null;
  private fellBack = false;
  private memory: string | null = null;

  constructor(
    storage: StorageLike | null = defaultStorage(),
    private readonly opts: SaveStoreOptions = {},
  ) {
    this.storage = storage;
    if (!storage) this.fallback('unavailable');
  }

  /** True while saves reach real storage. */
  get persistent(): boolean {
    return this.storage !== null;
  }

  /** Read, migrate and sanitise. Never throws. */
  load(): SaveData {
    if (!this.storage) return this.memory ? this.parse(this.memory) : emptySave();
    let raw: string | null;
    try {
      raw = this.storage.getItem(SAVE_KEY);
    } catch {
      this.fallback('unavailable');
      return emptySave();
    }
    if (raw === null) {
      // First 2.0 launch: pick up v1's legacy lap record.
      let v1;
      try {
        v1 = readV1((k) => this.storage!.getItem(k));
      } catch {
        v1 = { version: 1 as const, recordLap: null };
      }
      return sanitizeSave(migrate(v1));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return emptySave(); // corrupt JSON → safe defaults (the next save overwrites it)
    }
    if (versionOf(parsed) > SAVE_VERSION) {
      // A newer build wrote this. Play on a copy and never overwrite it.
      this.fallback('newer-version');
      this.memory = raw;
      return sanitizeSave(parsed);
    }
    return sanitizeSave(migrate(parsed) ?? parsed);
  }

  /** Persist (sanitised). Falls back to memory on any storage error. */
  save(data: SaveData): void {
    const json = JSON.stringify(sanitizeSave(data));
    if (this.storage) {
      try {
        this.storage.setItem(SAVE_KEY, json);
        return;
      } catch {
        this.fallback('write-failed');
      }
    }
    this.memory = json;
  }

  /** Pretty JSON for the export download. */
  exportJson(data: SaveData): string {
    return JSON.stringify({ ...sanitizeSave(data), exportedAt: new Date().toISOString(), game: 'machzero' }, null, 2);
  }

  /** Parse an exported file. Throws a readable Error when it isn't a MachZero save. */
  importJson(text: string): SaveData {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('That file is not valid JSON.');
    }
    const v = versionOf(parsed);
    if (v === 0) throw new Error('That file is not a MachZero save.');
    if (v > SAVE_VERSION) throw new Error('That save comes from a newer version of MachZero.');
    const migrated = migrate(parsed);
    if (!migrated) throw new Error('That save could not be upgraded.');
    return sanitizeSave(migrated);
  }

  private parse(json: string): SaveData {
    try {
      return sanitizeSave(JSON.parse(json));
    } catch {
      return emptySave();
    }
  }

  private fallback(reason: FallbackReason): void {
    this.storage = null;
    if (this.fellBack) return;
    this.fellBack = true;
    this.opts.onFallback?.(reason);
  }
}
