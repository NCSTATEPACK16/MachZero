/**
 * Grand Prix cups (SPEC §10.4, IMPLEMENTATION §X1). A cup is a named, ordered list of worlds: adding a world
 * to `WORLDS` never changes a cup. A cup can be played once every one of its worlds is built, so a cup that
 * names a world still to come stays hidden until that world ships.
 */
import { WORLDS, type WorldId } from './worlds';

/** What a cup needs to know about a world. */
export interface CupWorld {
  id: string;
  built: boolean;
}

export interface CupDef {
  id: string;
  name: string;
  /** One line for the cup card. */
  tagline: string;
  /** World ids, in race order. */
  worlds: readonly string[];
  /** With `modes` on, the cup opens once this World Tour world is cleared (IMPLEMENTATION §M8a). */
  requires: WorldId;
}

/** Races in every cup today (a cup's own length is `cup.worlds.length`). */
export const CUP_RACES = 5;

export const CUPS: readonly CupDef[] = [
  {
    id: 'neon',
    name: 'NEON CUP',
    tagline: 'The five original worlds, in order',
    worlds: ['neon-bay', 'sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring'],
    requires: 'orbital-ring',
  },
  {
    id: 'storm',
    name: 'STORM CUP',
    tagline: 'Wind, fire and deep water',
    worlds: ['sunset-mesa', 'tempest-spire', 'jade-ruins', 'cinder-forge', 'abyss-line'],
    requires: 'abyss-line',
  },
];

/** The cup that every save before v6 was playing (IMPLEMENTATION §GP's single cup). */
export const DEFAULT_CUP_ID = 'neon';

export function cupById(id: string): CupDef | undefined {
  return CUPS.find((c) => c.id === id);
}

/** True when every world of the cup exists and is built. */
export function cupAvailable(cup: CupDef, worlds: readonly CupWorld[] = WORLDS): boolean {
  return cup.worlds.every((id) => worlds.some((w) => w.id === id && w.built));
}

/** The cups that can be played now, in `CUPS` order. */
export function availableCups(worlds: readonly CupWorld[] = WORLDS): CupDef[] {
  return CUPS.filter((c) => cupAvailable(c, worlds));
}

/** What `cupUnlocked` reads from a profile: its World Tour trophies and its cup trophies. */
export interface CupProgress {
  tour: { trophies: Partial<Record<WorldId, readonly string[]>> };
  trophies: Readonly<Record<string, readonly string[]>>;
}

/**
 * With `modes` on (IMPLEMENTATION §M8a): a cup is open once its `requires` world is cleared on the World Tour, or
 * when the profile already holds any trophy of that cup (won before the Tour existed). With `modes` off every cup
 * is open, as before.
 */
export function cupUnlocked(cup: CupDef, profile: CupProgress, modes = true): boolean {
  if (!modes) return true;
  return (profile.tour.trophies[cup.requires]?.length ?? 0) > 0 || (profile.trophies[cup.id]?.length ?? 0) > 0;
}
