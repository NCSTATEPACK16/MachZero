/**
 * World Tour (SPEC §12, IMPLEMENTATION §M8a): the visible worlds form a chain in tour order. World 1 is always
 * open; a top-3 finish at any tier clears a world, earns its trophy for that tier and every lower one, pays the
 * first-clear bonus once, and opens the next world.
 *
 * Every rule is written for "the worlds the player can see" (`tourWorlds(features)`), so a world hidden by the
 * `expansion` flag neither blocks nor unlocks anything, and the chain grows from 5 to 8 worlds with no change.
 * Pure: nothing here saves, pays or shows anything.
 */
import type { AITier, RacerStanding } from '../../core/contracts';
import { worldsFor, type WorldDef, type WorldId } from '../../content/worlds';
import { AI_TIERS, type TourState } from '../../save/schema';

/** Credits for the first clear of a world (no tier multiplier). */
export const FIRST_CLEAR_BONUS = 1000;
/** A finish at this position or better clears a world. */
export const CLEAR_POSITION = 3;

/** The worlds on the tour: the visible worlds, in tour order. */
export function tourWorlds(features: { expansion: boolean }): readonly WorldDef[] {
  return [...worldsFor(features)].sort((a, b) => a.order - b.order);
}

export function tourTrophies(tour: Readonly<TourState>, id: WorldId): readonly AITier[] {
  return tour.trophies[id] ?? [];
}

/** A world is cleared once it holds at least one trophy. */
export function worldCleared(tour: Readonly<TourState>, id: WorldId): boolean {
  return tourTrophies(tour, id).length > 0;
}

/**
 * Open when it is the first visible world, was granted, or the visible world before it is cleared. Progress
 * further along the chain (a later world cleared or granted, e.g. raced before the tour existed) opens every
 * world before it, so the open worlds are always a run from world 1.
 */
export function worldUnlocked(tour: Readonly<TourState>, id: WorldId, worlds: readonly WorldDef[]): boolean {
  const i = worlds.findIndex((w) => w.id === id);
  if (i < 0) return false;
  if (i === 0 || worldCleared(tour, worlds[i - 1].id)) return true;
  for (let j = i; j < worlds.length; j++) {
    if (tour.granted.includes(worlds[j].id) || worldCleared(tour, worlds[j].id)) return true;
  }
  return false;
}

/** How many of the visible worlds are cleared. */
export function clearedCount(tour: Readonly<TourState>, worlds: readonly WorldDef[]): number {
  return worlds.filter((w) => worldCleared(tour, w.id)).length;
}

export interface TourResult {
  tour: TourState;
  /** The world had no trophy before this race. */
  firstClear: boolean;
  /** Trophies earned by this race, in tier order. */
  newTrophies: AITier[];
  /** The next visible world, when this race opened it. */
  unlocked: WorldId | null;
  /** FIRST_CLEAR_BONUS on a first clear, else 0. */
  bonus: number;
}

/** Book one finished race on `id` at `tier` for the player's standing `me`. The input tour is not changed. */
export function bookTourRace(tour: Readonly<TourState>, id: WorldId, tier: AITier, me: RacerStanding | undefined, worlds: readonly WorldDef[]): TourResult {
  const none: TourResult = { tour: tour as TourState, firstClear: false, newTrophies: [], unlocked: null, bonus: 0 };
  const i = worlds.findIndex((w) => w.id === id);
  if (i < 0 || !me || me.status !== 'finished' || me.position > CLEAR_POSITION) return none;
  const held = tourTrophies(tour, id);
  const earned = AI_TIERS.slice(0, AI_TIERS.indexOf(tier) + 1);
  const newTrophies = earned.filter((t) => !held.includes(t));
  if (newTrophies.length === 0) return none;
  const next: TourState = { granted: [...tour.granted], trophies: { ...tour.trophies, [id]: AI_TIERS.filter((t) => held.includes(t) || earned.includes(t)) } };
  const after = worlds[i + 1];
  const unlocked = after && !worldUnlocked(tour, after.id, worlds) && worldUnlocked(next, after.id, worlds) ? after.id : null;
  const firstClear = held.length === 0;
  return { tour: next, firstClear, newTrophies, unlocked, bonus: firstClear ? FIRST_CLEAR_BONUS : 0 };
}
