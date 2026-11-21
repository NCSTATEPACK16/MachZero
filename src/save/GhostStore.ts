/**
 * Best ghosts (IMPLEMENTATION §M8b): one per track per profile, in IndexedDB (database `machzero-ghosts`, version
 * 1, object store `best`, key `<profileId>:<trackId>`, value the encoded ArrayBuffer). Plain IndexedDB, no library.
 * Ghosts are not part of the save file and so are never exported.
 *
 * When IndexedDB is missing or fails (a private window, a blocked origin), an in-memory map takes over for the
 * rest of the session and nothing throws.
 */
import { decodeGhost, encodeGhost, type GhostData } from '../game/ghost/ghostCodec';

export const GHOST_DB = 'machzero-ghosts';
const STORE = 'best';

const key = (profileId: string, trackId: string) => `${profileId}:${trackId}`;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class GhostStore {
  private db: Promise<IDBDatabase | null> | null = null;
  /** The fallback (and only store once IndexedDB has failed). */
  private readonly memory = new Map<string, ArrayBuffer>();
  private failed = false;

  /** `null`: no IndexedDB (memory only). */
  constructor(private readonly idb: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB) {}

  /** True once the store runs on the in-memory map. */
  get inMemory(): boolean {
    return this.failed || !this.idb;
  }

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    const idb = this.idb;
    this.db = new Promise<IDBDatabase | null>((resolve) => {
      if (!idb) return resolve(null);
      try {
        const r = idb.open(GHOST_DB, 1);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }).then((db) => {
      if (!db) this.fail();
      return db;
    });
    return this.db;
  }

  private fail(e?: unknown): void {
    if (!this.failed && e) console.warn('MachZero: ghost storage is unavailable; ghosts last until the app closes.', e);
    this.failed = true;
  }

  async get(profileId: string, trackId: string): Promise<GhostData | null> {
    const k = key(profileId, trackId);
    const db = this.failed ? null : await this.open();
    let buf: ArrayBuffer | undefined = this.memory.get(k);
    if (db && !this.failed) {
      try {
        buf = (await req(db.transaction(STORE, 'readonly').objectStore(STORE).get(k))) as ArrayBuffer | undefined;
      } catch (e) {
        this.fail(e);
        buf = this.memory.get(k);
      }
    }
    return buf instanceof ArrayBuffer ? decodeGhost(buf) : null;
  }

  /** Keep `ghost` when the track has none or it is faster than the one held. Resolves true when it was kept. */
  async put(profileId: string, trackId: string, ghost: GhostData): Promise<boolean> {
    const old = await this.get(profileId, trackId);
    if (old && old.totalTime <= ghost.totalTime) return false;
    const k = key(profileId, trackId);
    const buf = encodeGhost(ghost);
    const db = this.failed ? null : await this.open();
    if (db && !this.failed) {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(buf, k);
        await done(tx);
        return true;
      } catch (e) {
        this.fail(e);
      }
    }
    this.memory.set(k, buf);
    return true;
  }

  /** Forget every ghost of a profile (the profile was deleted). */
  async deleteProfile(profileId: string): Promise<void> {
    const prefix = `${profileId}:`;
    for (const k of [...this.memory.keys()]) if (k.startsWith(prefix)) this.memory.delete(k);
    const db = this.failed ? null : await this.open();
    if (!db || this.failed) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      // Keys sort as strings: every `<profileId>:…` key lies in [prefix, prefix + U+FFFF).
      tx.objectStore(STORE).delete(IDBKeyRange.bound(prefix, `${prefix}￿`));
      await done(tx);
    } catch (e) {
      this.fail(e);
    }
  }
}
