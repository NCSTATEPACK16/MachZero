import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { GhostData } from '../../game/ghost/ghostCodec';
import { GhostStore } from '../GhostStore';

function ghost(totalTime: number, trackId = 'neon-bay'): GhostData {
  const n = 5;
  const pos = new Int16Array(3 * n).map((_, i) => i * 100 - 700);
  const quat = new Int16Array(3 * n).map((_, i) => (i % 3) * 1000);
  return { version: 1, trackId, chassisId: 'comet', totalTime, lapTimes: [totalTime / 3, totalTime / 3, totalTime / 3], count: n, min: [-10, 0, 5], size: [100, 20, 300], pos, quat, largest: new Uint8Array(n).fill(3) };
}

describe('GhostStore (IMPLEMENTATION §M8b step 2)', () => {
  it('put → get gives the ghost back; a missing one is null', async () => {
    const s = new GhostStore(new IDBFactory());
    expect(await s.get('p1', 'neon-bay')).toBeNull();
    expect(await s.put('p1', 'neon-bay', ghost(95))).toBe(true);
    const g = await s.get('p1', 'neon-bay');
    expect(g?.totalTime).toBe(95);
    expect(Array.from(g!.pos)).toEqual(Array.from(ghost(95).pos));
    expect(s.inMemory).toBe(false);
  });

  it('survives a new store on the same database (a reload)', async () => {
    const idb = new IDBFactory();
    await new GhostStore(idb).put('p1', 'jade-ruins', ghost(104.5, 'jade-ruins'));
    expect((await new GhostStore(idb).get('p1', 'jade-ruins'))?.totalTime).toBe(104.5);
  });

  it('a better ghost replaces the old one; a slower or equal one does not', async () => {
    const s = new GhostStore(new IDBFactory());
    await s.put('p1', 'neon-bay', ghost(95));
    expect(await s.put('p1', 'neon-bay', ghost(96))).toBe(false);
    expect(await s.put('p1', 'neon-bay', ghost(95))).toBe(false);
    expect((await s.get('p1', 'neon-bay'))?.totalTime).toBe(95);
    expect(await s.put('p1', 'neon-bay', ghost(93.2))).toBe(true);
    expect((await s.get('p1', 'neon-bay'))?.totalTime).toBe(93.2);
  });

  it("deleting a profile deletes its ghosts and only its ghosts", async () => {
    const s = new GhostStore(new IDBFactory());
    await s.put('p1', 'neon-bay', ghost(95));
    await s.put('p1', 'cryo-station', ghost(80, 'cryo-station'));
    await s.put('p10', 'neon-bay', ghost(97)); // shares the "p1" prefix but not "p1:"
    await s.put('p2', 'neon-bay', ghost(99));
    await s.deleteProfile('p1');
    expect(await s.get('p1', 'neon-bay')).toBeNull();
    expect(await s.get('p1', 'cryo-station')).toBeNull();
    expect((await s.get('p10', 'neon-bay'))?.totalTime).toBe(97);
    expect((await s.get('p2', 'neon-bay'))?.totalTime).toBe(99);
  });

  it('without IndexedDB it keeps ghosts in memory and never throws', async () => {
    const s = new GhostStore(null);
    expect(s.inMemory).toBe(true);
    expect(await s.get('p1', 'neon-bay')).toBeNull();
    expect(await s.put('p1', 'neon-bay', ghost(95))).toBe(true);
    expect(await s.put('p1', 'neon-bay', ghost(99))).toBe(false);
    expect((await s.get('p1', 'neon-bay'))?.totalTime).toBe(95);
    await s.deleteProfile('p1');
    expect(await s.get('p1', 'neon-bay')).toBeNull();
  });

  it('when opening the database fails it falls back to memory', async () => {
    const broken = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    const s = new GhostStore(broken);
    expect(await s.put('p1', 'neon-bay', ghost(95))).toBe(true);
    expect((await s.get('p1', 'neon-bay'))?.totalTime).toBe(95);
    expect(s.inMemory).toBe(true);
  });

  it('when a transaction throws it falls back to memory and keeps the ghost', async () => {
    const idb = new IDBFactory();
    const s = new GhostStore(idb);
    await s.get('p1', 'neon-bay'); // opens the database
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw new Error('InvalidStateError');
    });
    try {
      expect(await s.put('p1', 'neon-bay', ghost(95))).toBe(true);
      expect((await s.get('p1', 'neon-bay'))?.totalTime).toBe(95);
      expect(s.inMemory).toBe(true);
    } finally {
      vi.restoreAllMocks();
      warn.mockRestore();
    }
  });
});
