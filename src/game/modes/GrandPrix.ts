/**
 * Grand Prix cups (IMPLEMENTATION §GP, SPEC §4.2): five races in world order against one CPU tier, points
 * 10-8-6-5-4-3-2-1, ties broken on best finish. From race 2 the grid is the reverse of the cup standings (the
 * leader starts last). Every race pays its normal payout; 1st overall adds the cup bonus and the tier's trophy.
 *
 * Pure and Node-safe: the App feeds it each race's standings and stores the `CupState` in the profile after
 * every race, so a cup survives the app being closed between races.
 */
import type { AITier, RacerStanding, ShipId } from '../../core/contracts';
import { GP_CUP_BONUS, TIER_MULTIPLIER } from '../../content/economy';
import { RACE_SIZE } from '../../content/pilots';
import { WORLDS } from '../../content/worlds';

/** Points by finishing position (index 0 = 1st). */
export const GP_POINTS: readonly number[] = [10, 8, 6, 5, 4, 3, 2, 1];

/** The cup's worlds, in world order. */
export const GP_WORLDS: readonly string[] = WORLDS.map((w) => w.id);

export const GP_RACES = GP_WORLDS.length;

/** A cup in progress, as saved in the profile. */
export interface CupState {
  /** CPU difficulty, fixed for the cup. */
  tier: AITier;
  /** Per race done: the finishing position of each ship id (index = ship id), 0 = retired (no points). */
  results: number[][];
}

/** One racer's line in the cup table. */
export interface CupStanding {
  id: ShipId;
  /** 1-based cup position. */
  rank: number;
  points: number;
  /** Best finishing position so far (0 = none yet). */
  best: number;
  /** Points from the last race done. */
  last: number;
  /** Places gained (+) or lost (−) in the table with the last race. */
  moved: number;
}

export function newCup(tier: AITier): CupState {
  return { tier, results: [] };
}

export function racesDone(cup: CupState): number {
  return cup.results.length;
}

export function cupFinished(cup: CupState): boolean {
  return cup.results.length >= GP_RACES;
}

/** The world of the next race (null once the cup is over). */
export function cupWorld(cup: CupState): string | null {
  return cupFinished(cup) ? null : GP_WORLDS[cup.results.length];
}

export function pointsFor(position: number): number {
  return position >= 1 ? (GP_POINTS[position - 1] ?? 0) : 0;
}

/**
 * Book a race. Retired ships score nothing; everyone else scores their position (unfinished CPUs are already
 * ranked behind the finishers by the race). `retire` forces one ship out, e.g. the player quitting mid-race.
 */
export function recordRace(cup: CupState, standings: readonly RacerStanding[], retire?: ShipId): CupState {
  if (cupFinished(cup)) return cup;
  const order = [...standings].sort((a, b) => a.position - b.position);
  const row = new Array<number>(RACE_SIZE).fill(0);
  let pos = 0;
  for (const s of order) {
    if (s.status === 'retired' || s.id === retire) continue;
    if (s.id >= 0 && s.id < RACE_SIZE) row[s.id] = ++pos;
  }
  return { ...cup, results: [...cup.results, row] };
}

function table(results: readonly number[][]): CupStanding[] {
  const rows: CupStanding[] = [];
  for (let id = 0; id < RACE_SIZE; id++) {
    let points = 0;
    let best = 0;
    for (const r of results) {
      const p = r[id] ?? 0;
      points += pointsFor(p);
      if (p > 0 && (best === 0 || p < best)) best = p;
    }
    const last = results.length ? pointsFor(results[results.length - 1][id] ?? 0) : 0;
    rows.push({ id, rank: 0, points, best, last, moved: 0 });
  }
  // Points, then best finish, then the last race's finish, then ship id (stable and total).
  const lastPos = (id: ShipId) => (results.length ? results[results.length - 1][id] || RACE_SIZE + 1 : 0);
  rows.sort((a, b) => b.points - a.points || (a.best || RACE_SIZE + 1) - (b.best || RACE_SIZE + 1) || lastPos(a.id) - lastPos(b.id) || a.id - b.id);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/** The cup table after the races done, leader first, with each racer's movement since the race before. */
export function cupStandings(cup: CupState): CupStanding[] {
  const now = table(cup.results);
  if (cup.results.length < 2) return now;
  const before = table(cup.results.slice(0, -1));
  const was = new Map(before.map((r) => [r.id, r.rank]));
  for (const r of now) r.moved = (was.get(r.id) ?? r.rank) - r.rank;
  return now;
}

/**
 * Grid for the next race: index = grid slot (0 = pole), value = ship id. Null for race 1 (the tier's normal
 * grid); from race 2, the reverse of the cup standings, so the leader starts last.
 */
export function cupGridOrder(cup: CupState): ShipId[] | null {
  if (cup.results.length === 0) return null;
  return cupStandings(cup)
    .map((r) => r.id)
    .reverse();
}

/** Credits for winning the cup at `tier` (rounded to 10, like race payouts). */
export function cupBonus(tier: AITier): number {
  return Math.round((GP_CUP_BONUS * TIER_MULTIPLIER[tier]) / 10) * 10;
}

/** The player's (id 0) final cup position, or null while the cup runs. */
export function cupResult(cup: CupState, playerId: ShipId = 0): number | null {
  if (!cupFinished(cup)) return null;
  return cupStandings(cup).find((r) => r.id === playerId)?.rank ?? null;
}

/** Trophies won, one per tier, kept in tier order. */
export function addTrophy(trophies: readonly AITier[], tier: AITier, order: readonly AITier[]): AITier[] {
  if (trophies.includes(tier)) return [...trophies];
  return order.filter((t) => t === tier || trophies.includes(t));
}

/** What finishing a cup earned the player. */
export interface CupAward {
  position: number;
  bonus: number;
  trophy: AITier | null;
}

/** The award once the cup is over: the bonus and trophy for 1st overall only. */
export function cupAward(cup: CupState, playerId: ShipId = 0): CupAward | null {
  const position = cupResult(cup, playerId);
  if (position === null) return null;
  return position === 1 ? { position, bonus: cupBonus(cup.tier), trophy: cup.tier } : { position, bonus: 0, trophy: null };
}

/** A saved cup from an untrusted save: well formed, or null. */
export function sanitizeCup(v: unknown, tiers: readonly AITier[]): CupState | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!tiers.includes(o.tier as AITier) || !Array.isArray(o.results) || o.results.length > GP_RACES) return null;
  const results: number[][] = [];
  for (const r of o.results) {
    if (!Array.isArray(r) || r.length !== RACE_SIZE) return null;
    const row = r.map((x) => (Number.isInteger(x) && x >= 0 && x <= RACE_SIZE ? (x as number) : 0));
    results.push(row);
  }
  // A finished cup is settled at its last race; one left over is dropped.
  if (results.length >= GP_RACES) return null;
  return { tier: o.tier as AITier, results };
}
