import { describe, expect, it } from 'vitest';
import { BufferCache, CACHE_BYTES } from '../BufferCache';

const MB = 1024 * 1024;

describe('BufferCache (§M6b step 4)', () => {
  it('holds 100 MB by default', () => {
    expect(CACHE_BYTES).toBe(100 * MB);
    expect(new BufferCache().budget).toBe(CACHE_BYTES);
  });

  it('put 3 songs of 40 MB → the oldest unpinned one is evicted', () => {
    const c = new BufferCache<string>();
    expect(c.put('a', 'A', 40 * MB).evicted).toEqual([]);
    expect(c.put('b', 'B', 40 * MB).evicted).toEqual([]);
    expect(c.put('c', 'C', 40 * MB).evicted).toEqual(['a']);
    expect(c.has('a')).toBe(false);
    expect(c.bytes).toBe(80 * MB);
  });

  it('a use makes an entry the most recent', () => {
    const c = new BufferCache<string>();
    c.put('a', 'A', 40 * MB);
    c.put('b', 'B', 40 * MB);
    expect(c.get('a')).toBe('A');
    expect(c.put('c', 'C', 40 * MB).evicted).toEqual(['b']);
  });

  it('a pinned entry is never evicted', () => {
    const c = new BufferCache<string>();
    c.put('a', 'A', 40 * MB);
    c.pin('a');
    c.put('b', 'B', 40 * MB);
    expect(c.put('c', 'C', 40 * MB).evicted).toEqual(['b']);
    expect(c.has('a')).toBe(true);
    c.unpin('a');
    expect(c.put('d', 'D', 40 * MB).evicted).toEqual(['a']);
  });

  it('pins count, and a pin can come before the entry arrives', () => {
    const c = new BufferCache<string>();
    c.pin('a');
    c.pin('a');
    c.put('a', 'A', 60 * MB);
    c.unpin('a');
    expect(c.put('b', 'B', 30 * MB).evicted).toEqual([]);
    expect(c.put('c', 'C', 30 * MB).evicted).toEqual(['b']);
    expect(c.pinned('a')).toBe(true);
  });

  it('the total never exceeds 100 MB after a put: what cannot fit beside the pinned entries is refused', () => {
    const c = new BufferCache<string>();
    c.put('a', 'A', 70 * MB);
    c.pin('a');
    const r = c.put('b', 'B', 40 * MB);
    expect(r.stored).toBe(false);
    expect(c.has('b')).toBe(false);
    expect(c.bytes).toBe(70 * MB);
    for (let i = 0; i < 20; i++) {
      c.put(`x${i}`, 'X', (5 + (i % 7) * 4) * MB);
      expect(c.bytes).toBeLessThanOrEqual(100 * MB);
    }
  });

  it('replacing an entry counts its bytes once; delete frees them and reports the value', () => {
    const c = new BufferCache<string>();
    c.put('a', 'A', 10 * MB);
    c.put('a', 'A2', 20 * MB);
    expect(c.bytes).toBe(20 * MB);
    expect(c.get('a')).toBe('A2');
    expect(c.delete('a')).toBe('A2');
    expect(c.bytes).toBe(0);
  });

  it('an evicted entry is handed to onEvict (the player releases its buffers)', () => {
    const gone: string[] = [];
    const c = new BufferCache<string>(100 * MB, (id, v) => gone.push(`${id}=${v}`));
    c.put('a', 'A', 60 * MB);
    c.put('b', 'B', 60 * MB);
    expect(gone).toEqual(['a=A']);
  });
});
