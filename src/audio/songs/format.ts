/**
 * The song data format (IMPLEMENTATION §M6.4). Songs are small TypeScript data files, one per song
 * (`songs/<id>.ts`), imported only by the render Worker (and the main-thread fallback); the page carries only the
 * catalogue (`catalog.ts`).
 */
import type { InstrumentId, InstrumentParams } from '../dsp/instruments';

export type SongId = 'neon-bay' | 'sunset-mesa' | 'cryo-station' | 'jade-ruins' | 'orbital-ring' | 'tempest-spire' | 'cinder-forge' | 'abyss-line' | 'menu' | 'results';
export type StingerId = 'win' | 'podium' | 'finish' | 'record' | 'unlock' | 'trophy' | 'medal-bronze' | 'medal-silver' | 'medal-gold' | 'champion';
export type MusicId = SongId | StingerId;

export type SongKind = 'world' | 'menu' | 'results' | 'stinger';

export const WORLD_SONGS: readonly SongId[] = ['neon-bay', 'sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring', 'tempest-spire', 'cinder-forge', 'abyss-line'];
export const STINGER_IDS: readonly StingerId[] = ['win', 'podium', 'finish', 'record', 'unlock', 'trophy', 'medal-bronze', 'medal-silver', 'medal-gold', 'champion'];

/** §M6.3: each stinger's length in seconds (the validator allows ± 0.25 s). */
export const STINGER_SECONDS: Readonly<Record<StingerId, number>> = {
  win: 3.0,
  podium: 2.5,
  finish: 2.0,
  record: 1.2,
  unlock: 1.5,
  trophy: 1.2,
  'medal-bronze': 1.2,
  'medal-silver': 1.2,
  'medal-gold': 1.2,
  champion: 4.0,
};

export function kindOf(id: MusicId): SongKind {
  if (id === 'menu') return 'menu';
  if (id === 'results') return 'results';
  return (STINGER_IDS as readonly string[]).includes(id) ? 'stinger' : 'world';
}

export interface TrackDef {
  /** An instrument id from dsp/instruments.ts, with optional overrides of its parameters. */
  instrument: InstrumentId;
  params?: Partial<InstrumentParams>;
  gain: number; // 0..1, linear
  pan?: number; // −1..1 (the lift layer ignores it: mono)
  delay?: number; // send 0..1
  reverb?: number; // send 0..1
  /** Duck this track's gain on every hit of the named drum track (a sidechain pump): depth 0..1, release in s. */
  pump?: { by: string; depth: number; release: number };
  /** Rendered into the mono lift layer instead of the main mix. */
  lift?: boolean;
}

/**
 * A step string: one token per 16th note, separated by spaces; 16 tokens per bar; a pattern's tracks all have
 * the same number of bars. Tokens:
 *   .        rest
 *   -        hold: the previous note is still held through this step
 *   A3  C#4  a note (sharps only, C0..B8), velocity 0.8
 *   A3!      the same note accented (velocity 1)
 *   A3+C4+E4 a chord (at most 4 notes)
 *   x  X     a drum hit / an accented drum hit (drum instruments only)
 * Example (one bar): 'A3 - - - C4 - E4 . A4! . . . E4 - . .'
 */
export type StepString = string;

export interface SongDef {
  id: MusicId;
  title: string; // shown in SOUND TEST, e.g. 'NEON BAY — "GRID RUNNER"'
  bpm: number; // 80..160
  key: string; // for people only, e.g. 'A minor'
  swing?: number; // 0..0.3: the off-beat 16ths are delayed by swing × one step
  tracks: Record<string, TrackDef>;
  patterns: Record<string, Partial<Record<string, StepString>>>; // pattern name → track name → steps; a missing track rests
  intro: readonly string[]; // pattern names, played once (a stinger has only an intro)
  loop: readonly string[]; // pattern names, looped; [] for a stinger
  fx: {
    delay: { beats: number; feedback: number; tone: number }; // beats: 0.75 = a dotted 8th; tone: low-pass Hz
    reverb: { size: number; damp: number }; // 0..1 each
  };
}
