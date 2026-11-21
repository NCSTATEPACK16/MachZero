/**
 * What the results screen shows (IMPLEMENTATION §M8a step 6): the credit tally, line by line, and the rest of a
 * finished race's outcome. Pure: App builds a RaceResult from the race and the save update, the screen draws it.
 */
import type { AITier, RacerStanding, ShipId } from '../../core/contracts';
import { ordinal } from '../../core/math';
import { RACE_PAYOUTS, TIER_MULTIPLIER, racePayout } from '../../content/economy';
import { TIERS } from '../../content/tiers';
import type { WorldId } from '../../content/worlds';
import type { Medal } from '../../save/schema';
import type { RosterEntry } from '../pilotPortrait';

export interface TallyLine {
  label: string;
  amount: number;
}

export interface RaceResult {
  mode: 'tour' | 'cup' | 'trial';
  worldId: WorldId;
  tier: AITier;
  standings: RacerStanding[];
  playerId: ShipId;
  /** Portraits and catchphrases for the standings table. */
  roster: RosterEntry[];
  tally: TallyLine[];
  /** The profile's credits after the tally. */
  credits: number;
  unlocked: WorldId | null;
  newTrophies: AITier[];
  /** Time Trial (M8b). */
  medal?: { reached: Medal | null; previous: Medal | null; time: number; best: boolean };
  /** The winner's catchphrase when a rival won. */
  quote: { pilot: string; text: string } | null;
}

/**
 * The tally for a race: the position's payout, the tier's extra (Pilot ×1.3 and up), the first-clear bonus and the
 * cup bonus. The lines add up to what `settleRace` paid plus the bonuses. No standing → no lines.
 */
export function raceTally(me: RacerStanding | undefined, tier: AITier, bonuses: { firstClear?: number; cup?: number } = {}): TallyLine[] {
  const lines: TallyLine[] = [];
  if (me) {
    const pos = Math.min(RACE_PAYOUTS.length, Math.floor(me.position));
    const base = RACE_PAYOUTS[pos - 1];
    const pay = racePayout(me.position, tier);
    lines.push({ label: me.status === 'retired' ? 'RETIRED' : `${ordinal(pos).toUpperCase()} PLACE`, amount: base });
    if (pay !== base) lines.push({ label: `${TIERS[tier].label} ×${TIER_MULTIPLIER[tier]}`, amount: pay - base });
  }
  if (bonuses.firstClear) lines.push({ label: 'FIRST CLEAR', amount: bonuses.firstClear });
  if (bonuses.cup) lines.push({ label: 'CUP BONUS', amount: bonuses.cup });
  return lines;
}

/** The winner's catchphrase, when a rival (not the player) won. */
export function winnerQuote(standings: readonly RacerStanding[], roster: readonly RosterEntry[], playerId: ShipId): RaceResult['quote'] {
  const winner = standings.find((s) => s.position === 1);
  if (!winner || winner.id === playerId) return null;
  const text = roster.find((r) => r.id === winner.id)?.catchphrase;
  return text ? { pilot: winner.name, text } : null;
}
