/**
 * The championship (SPEC §10.4, IMPLEMENTATION §X1): a season is every playable cup, in `CUPS` order, at one
 * CPU tier. The season score is the sum of a racer's cup points; ties break on cups won, then on the best cup
 * rank, then on ship id, so the order is total and stable.
 *
 * As played (IMPLEMENTATION §M8c): it opens once the profile holds a trophy of every available cup (and at least two
 * are available); each cup plays as a single cup does, and the season's winner takes the Champion trophy for the
 * tier and CHAMPION_BONUS × the tier multiplier, once per tier. Pure: nothing here saves, pays or shows anything.
 */
import type { AITier, ShipId } from '../../core/contracts';
import { availableCups, type CupDef } from '../../content/cups';
import { TIER_MULTIPLIER } from '../../content/economy';
import type { SeasonState } from '../../save/schema';
import { cupFinished, cupStandings, type CupState, type Trophies } from './GrandPrix';

/** Credits for a season win, before the tier multiplier. */
export const CHAMPION_BONUS = 5000;

/** One racer's line in the season table. */
export interface SeasonStanding {
  id: ShipId;
  /** 1-based season position. */
  rank: number;
  /** Sum of cup points over the cups done. */
  points: number;
  /** Cups finished 1st overall. */
  cupsWon: number;
  /** Best cup rank so far (0 = no cup done yet). */
  bestCup: number;
}

/** The cups of a season, in order. */
export function seasonCups(cups: readonly CupDef[] = availableCups()): readonly CupDef[] {
  return cups;
}

/**
 * The season table from the finished cups (one `CupState` per cup done, any order). Unfinished cups, cups at
 * another tier than the first one's and a second run of the same cup are ignored.
 */
export function seasonStandings(done: readonly CupState[]): SeasonStanding[] {
  const tier: AITier | undefined = done[0]?.tier;
  const seen = new Set<string>();
  const rows = new Map<ShipId, SeasonStanding>();
  for (const cup of done) {
    if (cup.tier !== tier || !cupFinished(cup) || seen.has(cup.cupId)) continue;
    seen.add(cup.cupId);
    for (const s of cupStandings(cup)) {
      const r = rows.get(s.id) ?? { id: s.id, rank: 0, points: 0, cupsWon: 0, bestCup: 0 };
      r.points += s.points;
      if (s.rank === 1) r.cupsWon++;
      if (r.bestCup === 0 || s.rank < r.bestCup) r.bestCup = s.rank;
      rows.set(s.id, r);
    }
  }
  const out = [...rows.values()];
  out.sort((a, b) => b.points - a.points || b.cupsWon - a.cupsWon || a.bestCup - b.bestCup || a.id - b.id);
  out.forEach((r, i) => (r.rank = i + 1));
  return out;
}

/** True once every cup of the season is in `done`, finished, at one tier. */
export function seasonFinished(done: readonly CupState[], cups: readonly CupDef[] = availableCups()): boolean {
  const tier = done[0]?.tier;
  return cups.length > 0 && cups.every((c) => done.some((d) => d.cupId === c.id && d.tier === tier && cupFinished(d)));
}

/** The season's champion and the tier of the Champion trophy, or null while the season runs. */
export function seasonChampion(done: readonly CupState[], cups: readonly CupDef[] = availableCups()): { id: ShipId; tier: AITier } | null {
  if (!seasonFinished(done, cups)) return null;
  const first = seasonStandings(done.filter((d) => cups.some((c) => c.id === d.cupId)))[0];
  return first ? { id: first.id, tier: done[0].tier } : null;
}

/** The championship is open: at least two cups are available and the profile holds a trophy of each. */
export function seasonUnlocked(trophies: Readonly<Trophies>, cups: readonly CupDef[] = availableCups()): boolean {
  return cups.length >= 2 && cups.every((c) => (trophies[c.id]?.length ?? 0) > 0);
}

export function newSeason(tier: AITier): SeasonState {
  return { tier, done: [] };
}

/** The cup to play now: the first of the season's cups not done yet, or null when the season is over. */
export function seasonCup(season: Readonly<SeasonState>, cups: readonly CupDef[] = availableCups()): CupDef | null {
  return cups.find((c) => !season.done.some((d) => d.cupId === c.id)) ?? null;
}

/** Book a finished cup: only the season's current cup, at its tier, finished. Anything else changes nothing. */
export function bookSeasonCup(season: Readonly<SeasonState>, finished: CupState, cups: readonly CupDef[] = availableCups()): SeasonState {
  const now = seasonCup(season, cups);
  if (!now || finished.cupId !== now.id || finished.tier !== season.tier || !cupFinished(finished)) return season as SeasonState;
  return { tier: season.tier, done: [...season.done, finished] };
}

/** Credits for winning a season at `tier`: 0 when the profile already holds that tier's Champion trophy. */
export function championBonus(tier: AITier, held: readonly AITier[]): number {
  return held.includes(tier) ? 0 : Math.round(CHAMPION_BONUS * TIER_MULTIPLIER[tier]);
}
