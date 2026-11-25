/**
 * The song buffer cache (IMPLEMENTATION §M6b, §M6.5: ≤ 100 MB). Pure bookkeeping: entries by id with their bytes,
 * least recently used first out. `pin` keeps an entry (the song playing, one fading out, one being prepared); pins
 * count, and may come before the entry arrives. A put that cannot fit beside the pinned entries is refused, so the
 * total never exceeds the budget.
 */
export const CACHE_BYTES = 100 * 1024 * 1024;

export class BufferCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private readonly pins = new Map<string, number>();
  bytes = 0;

  constructor(
    readonly budget = CACHE_BYTES,
    private readonly onEvict: ((id: string, value: T) => void) | null = null,
  ) {}

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** The entry, made the most recently used. */
  get(id: string): T | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    this.entries.delete(id);
    this.entries.set(id, e);
    return e.value;
  }

  /** Store `value` (most recent), evicting the least recently used unpinned entries until it fits. */
  put(id: string, value: T, bytes: number): { stored: boolean; evicted: string[] } {
    const old = this.entries.get(id);
    const base = this.bytes - (old?.bytes ?? 0);
    let pinnedBytes = 0;
    for (const [k, e] of this.entries) if (k !== id && this.pinned(k)) pinnedBytes += e.bytes;
    if (pinnedBytes + bytes > this.budget) return { stored: false, evicted: [] };
    if (old) {
      this.entries.delete(id);
      this.bytes = base;
    }
    const evicted: string[] = [];
    for (const [k, e] of this.entries) {
      if (this.bytes + bytes <= this.budget) break;
      if (this.pinned(k)) continue;
      this.entries.delete(k);
      this.bytes -= e.bytes;
      evicted.push(k);
      this.onEvict?.(k, e.value);
    }
    this.entries.set(id, { value, bytes });
    this.bytes += bytes;
    return { stored: true, evicted };
  }

  delete(id: string): T | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    this.entries.delete(id);
    this.bytes -= e.bytes;
    return e.value;
  }

  pin(id: string): void {
    this.pins.set(id, (this.pins.get(id) ?? 0) + 1);
  }

  unpin(id: string): void {
    const n = (this.pins.get(id) ?? 0) - 1;
    if (n > 0) this.pins.set(id, n);
    else this.pins.delete(id);
  }

  pinned(id: string): boolean {
    return (this.pins.get(id) ?? 0) > 0;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }
}
