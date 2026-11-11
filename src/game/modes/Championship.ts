/**
 * The championship (SPEC §10.4, IMPLEMENTATION §X1): a season is every playable cup, in `CUPS` order, at one
 * CPU tier. The season score is the sum of a racer's cup points; ties break on cups won, then on the best cup
 * rank, then on ship id, so the order is total and stable.
 *
 * Data and pure functions only: nothing here is saved, paid or shown yet. M8's modes decide the screen and
 * the rewards.
 */
import type { AITier, ShipId } from '../../core/contracts';
import { availableCups, type CupDef } from '../../content/cups';
import { cupFinished, cupStandings, type CupState } from './GrandPrix';

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
