/**
 * Time Trial (SPEC §12, IMPLEMENTATION §M8b): solo, 3 laps, against the clock and the ghosts. Medals are measured
 * against the dev ghost's total time (the same for every ship and kit, whatever the profile's tier), and each
 * medal pays once per track. Pure: nothing here saves or pays.
 */
import { MEDAL_CREDITS } from '../../content/economy';
import type { TallyLine } from './raceResult';
import { MEDALS, type Medal, type TrackRecord } from '../../save/schema';

/** A medal's total time is at most the dev time × its factor. */
export const MEDAL_FACTORS = { gold: 1.02, silver: 1.06, bronze: 1.12 } as const;

export function medalTimes(devTime: number): Record<Medal, number> {
  return { gold: devTime * MEDAL_FACTORS.gold, silver: devTime * MEDAL_FACTORS.silver, bronze: devTime * MEDAL_FACTORS.bronze };
}

/** The best medal a 3-lap total earns, or null. */
export function medalFor(total: number, devTime: number): Medal | null {
  if (!Number.isFinite(total)) return null;
  const t = medalTimes(devTime);
  for (const m of [...MEDALS].reverse()) if (total <= t[m]) return m;
  return null;
}

const rank = (m: Medal | null) => (m ? MEDALS.indexOf(m) : -1);

/** Credits for the medals reached now and not held before. */
export function medalPayout(previous: Medal | null, reached: Medal | null): number {
  let pay = 0;
  for (let i = rank(previous) + 1; i <= rank(reached); i++) pay += MEDAL_CREDITS[MEDALS[i]];
  return pay;
}

/** The next medal above `held` and its total time, or null when gold is held. */
export function nextMedal(held: Medal | null, devTime: number): { medal: Medal; time: number } | null {
  const m = MEDALS[rank(held) + 1];
  return m ? { medal: m, time: medalTimes(devTime)[m] } : null;
}

/** Book a finished run: the new record (best time, best medal), the credits it pays, whether it is the best. */
export function bookTrial(rec: Readonly<TrackRecord>, total: number, devTime: number): { record: TrackRecord; pay: number; best: boolean; reached: Medal | null } {
  const reached = medalFor(total, devTime);
  const held = rec.medal ?? null;
  const best = Number.isFinite(total) && (rec.trialTime === undefined || total < rec.trialTime);
  const record: TrackRecord = { ...rec };
  if (best) record.trialTime = total;
  const medal = rank(reached) > rank(held) ? reached : held;
  if (medal) record.medal = medal;
  return { record, pay: medalPayout(held, reached), best, reached };
}

export const MEDAL_NAMES: Readonly<Record<Medal, string>> = { gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE' };

/** The results tally of a run: one line per medal paid now (bronze first). */
export function medalTally(previous: Medal | null, reached: Medal | null): TallyLine[] {
  const lines: TallyLine[] = [];
  for (let i = rank(previous) + 1; i <= rank(reached); i++) lines.push({ label: `${MEDAL_NAMES[MEDALS[i]]} MEDAL`, amount: MEDAL_CREDITS[MEDALS[i]] });
  return lines;
}
