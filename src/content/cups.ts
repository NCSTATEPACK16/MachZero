/**
 * Grand Prix cups (SPEC §10.4, IMPLEMENTATION §X1). A cup is a named, ordered list of worlds: adding a world
 * to `WORLDS` never changes a cup. A cup can be played once every one of its worlds is built, so a cup that
 * names a world still to come stays hidden until that world ships.
 */
import { WORLDS } from './worlds';

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
}

/** Races in every cup today (a cup's own length is `cup.worlds.length`). */
export const CUP_RACES = 5;

export const CUPS: readonly CupDef[] = [
  {
    id: 'neon',
    name: 'NEON CUP',
    tagline: 'The five original worlds, in order',
    worlds: ['neon-bay', 'sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring'],
  },
  {
    id: 'storm',
    name: 'STORM CUP',
    tagline: 'Wind, fire and deep water',
    worlds: ['sunset-mesa', 'tempest-spire', 'jade-ruins', 'cinder-forge', 'abyss-line'],
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
