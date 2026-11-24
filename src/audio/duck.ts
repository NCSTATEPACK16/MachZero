/**
 * Music ducking (IMPLEMENTATION §M6 decision C). Pure: which music level and low-pass the active duck sources ask for.
 * Only the songs are ducked (not the stingers); the deepest active duck wins and ducks never add up.
 */
export type DuckSource = 'countdown' | 'stinger' | 'warning' | 'pause';

export interface DuckSpec {
  /** Music level while the source is active (dB). */
  db: number;
  /** Seconds to reach the level, and to come back once the source ends. */
  attack: number;
  release: number;
  /** A low-pass on the songs while active, or null. */
  lowpassHz: number | null;
}

export const DUCKS: Readonly<Record<DuckSource, DuckSpec>> = {
  countdown: { db: -8, attack: 0.05, release: 0.6, lowpassHz: null },
  stinger: { db: -10, attack: 0.03, release: 0.4, lowpassHz: null },
  warning: { db: -4, attack: 0.02, release: 0.3, lowpassHz: null },
  pause: { db: -12, attack: 0.15, release: 0.3, lowpassHz: 1200 },
};

/** The countdown duck holds this long after GO. */
export const COUNTDOWN_DUCK_HOLD = 0.6;

export interface DuckTarget {
  db: number;
  lowpassHz: number | null;
  /** The deepest source (whose attack applies), or null when nothing ducks. */
  source: DuckSource | null;
}

/** The music level for the active sources: the deepest duck, and a low-pass if any active source has one. */
export function duckTarget(active: readonly DuckSource[]): DuckTarget {
  let db = 0;
  let lowpassHz: number | null = null;
  let source: DuckSource | null = null;
  for (const s of active) {
    const d = DUCKS[s];
    if (d.db < db) {
      db = d.db;
      source = s;
    }
    if (d.lowpassHz !== null) lowpassHz = lowpassHz === null ? d.lowpassHz : Math.min(lowpassHz, d.lowpassHz);
  }
  return { db, lowpassHz, source };
}

/** The time constant for `setTargetAtTime` that gets within ~95% of a step in `seconds`. */
export function rampTau(seconds: number): number {
  return seconds / 3;
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
