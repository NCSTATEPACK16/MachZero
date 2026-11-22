/**
 * Booking a Grand Prix race on a profile (IMPLEMENTATION §GP, §M8c): the race goes into the cup; at the cup's end
 * the award is paid (cup bonus and trophy), and in a season the cup is booked on the season too: the next cup is
 * queued in `profile.cup` at once, or at the season's end the champion is crowned and paid (once per tier).
 * Shared by `App` and the season sim. Changes the profile it is given (a draft); nothing is saved or shown here.
 */
import type { RacerStanding, ShipId } from '../../core/contracts';
import type { CupDef } from '../../content/cups';
import { AI_TIERS, type Profile, type SeasonState } from '../../save/schema';
import { bookSeasonCup, championBonus, seasonChampion, seasonCup } from './Championship';
import { addTrophy, cupAward, cupFinished, newCup, recordRace, type CupAward, type CupState } from './GrandPrix';

/** How a season ended. */
export interface SeasonEnd {
  season: SeasonState;
  /** The season's winner, or null when the season could not go on. */
  champion: ShipId | null;
  /** Credits paid to the player for the win (0 when a rival won or the tier's crown was held). */
  bonus: number;
  newTrophy: boolean;
}

export interface CupBooking {
  /** The finished cup and its award, when this race ended a cup. */
  done: CupState | null;
  award: CupAward | null;
  /** The finished cup belonged to a season. */
  inSeason: boolean;
  /** The season ended with this cup. */
  ended: SeasonEnd | null;
}

const NONE: CupBooking = { done: null, award: null, inSeason: false, ended: null };

/** Book one cup race (`retire`: the player retired, 0 points) on `p`. `cups` are the season's cups. */
export function bookCupRaceOn(p: Profile, standings: readonly RacerStanding[], cups: readonly CupDef[], retire?: ShipId): CupBooking {
  if (!p.cup) return NONE;
  const cup = recordRace(p.cup, standings, retire);
  if (!cupFinished(cup)) {
    p.cup = cup;
    return NONE;
  }
  const award = cupAward(cup);
  p.cup = null;
  if (award?.trophy) p.trophies = addTrophy(p.trophies, cup.cupId, award.trophy, AI_TIERS);
  p.credits += award?.bonus ?? 0;
  if (!p.season) return { done: cup, award, inSeason: false, ended: null };
  const season = bookSeasonCup(p.season, cup, cups);
  const booked = season !== p.season;
  const next = booked ? seasonCup(season, cups) : null;
  if (next) {
    p.season = season;
    p.cup = newCup(next.id, season.tier);
    return { done: cup, award, inSeason: true, ended: null };
  }
  // The season is over (or could not go on): crown the champion when it is the player.
  const champ = booked ? seasonChampion(season.done, cups) : null;
  const mine = champ?.id === 0;
  const bonus = mine ? championBonus(season.tier, p.champion) : 0;
  const newTrophy = mine && !p.champion.includes(season.tier);
  if (newTrophy) p.champion = AI_TIERS.filter((t) => t === season.tier || p.champion.includes(t));
  p.credits += bonus;
  p.season = null;
  return { done: cup, award, inSeason: true, ended: { season, champion: champ?.id ?? null, bonus, newTrophy } };
}
