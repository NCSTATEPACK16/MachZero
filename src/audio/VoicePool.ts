/**
 * The one-shot voice pool (IMPLEMENTATION §M6 decision H). Pure allocation over a fixed number of slots.
 * Priorities: 0 critical (never dropped), 1 the player's own sounds, 2 other ships, 3 decoration. A claim takes a free
 * slot; when none is free it steals the oldest voice of the lowest priority below its own; otherwise it is dropped.
 * A priority-0 claim may take any voice except another priority 0.
 */
export type Priority = 0 | 1 | 2 | 3;

export const POOL_SIZE = 28;

export type Claim = { slot: number } | { steal: number } | null;

export class VoicePool {
  private readonly prio: Array<Priority | -1>;
  private readonly started: number[];
  private seq = 0;
  private readonly order: number[];

  constructor(readonly size = POOL_SIZE) {
    this.prio = new Array<Priority | -1>(size).fill(-1);
    this.started = new Array<number>(size).fill(0);
    this.order = new Array<number>(size).fill(0);
  }

  /** Take a slot for a sound of `priority` starting at `now`. The caller stops the stolen voice before reusing it. */
  claim(priority: Priority, now: number): Claim {
    const free = this.prio.indexOf(-1);
    if (free >= 0) {
      this.take(free, priority, now);
      return { slot: free };
    }
    let victim = -1;
    for (let i = 0; i < this.size; i++) {
      const p = this.prio[i];
      if (p <= priority) continue;
      if (victim < 0) {
        victim = i;
        continue;
      }
      const v = this.prio[victim];
      if (p > v || (p === v && this.isOlder(i, victim))) victim = i;
    }
    if (victim < 0) return null;
    this.take(victim, priority, now);
    return { steal: victim };
  }

  release(slot: number): void {
    if (slot >= 0 && slot < this.size) this.prio[slot] = -1;
  }

  get active(): number {
    let n = 0;
    for (const p of this.prio) if (p >= 0) n++;
    return n;
  }

  priorityOf(slot: number): Priority | null {
    const p = this.prio[slot];
    return p === -1 || p === undefined ? null : p;
  }

  clear(): void {
    this.prio.fill(-1);
  }

  private isOlder(a: number, b: number): boolean {
    return this.started[a] < this.started[b] || (this.started[a] === this.started[b] && this.order[a] < this.order[b]);
  }

  private take(slot: number, priority: Priority, now: number): void {
    this.prio[slot] = priority;
    this.started[slot] = now;
    this.order[slot] = this.seq++;
  }
}
