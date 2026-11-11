/**
 * Credits (SPEC §4.4): race payouts by finishing position × AI-tier multiplier, part prices, and the garage
 * rules (buy = pay + own + equip; equip only what you own; no selling). Pure; the App applies these to the
 * active profile inside a save update.
 */
import type { AITier, Loadout, PartSlot, PartTier, PartVariant, RacerStanding } from '../core/contracts';
import { PART_PRICES, PART_SLOTS, PART_TIERS, PART_VARIANTS, STOCK_VARIANTS, hasVariants, partKey, variantOf } from './parts';
import { CHASSIS } from './ships';

/** Credits by finishing position (index 0 = 1st), at Rookie. */
export const RACE_PAYOUTS: readonly number[] = [1000, 750, 550, 400, 300, 220, 160, 120];

export const TIER_MULTIPLIER: Readonly<Record<AITier, number>> = { rookie: 1, pilot: 1.3, ace: 1.7, legend: 2.2 };

/** Grand Prix 1st overall, × tier multiplier (M5). */
export const GP_CUP_BONUS = 3000;

/** Time Trial medals, paid once each (M6). */
export const MEDAL_CREDITS = { bronze: 300, silver: 600, gold: 1000 } as const;

/** Credits for finishing `position` (1-based) against `tier` rivals. Every place pays; rounded to 10. */
export function racePayout(position: number, tier: AITier): number {
  if (!Number.isFinite(position) || position < 1) return 0;
  const base = RACE_PAYOUTS[Math.min(RACE_PAYOUTS.length, Math.floor(position)) - 1];
  return Math.round((base * TIER_MULTIPLIER[tier]) / 10) * 10;
}

/**
 * Book a finished race on a profile: count it, count a win, pay the credits. Returns the credits paid.
 * `me` is the player's final standing (absent if the player wasn't in the field).
 */
export function settleRace(p: { credits: number; stats: { races: number; wins: number } }, me: RacerStanding | undefined, tier: AITier): number {
  p.stats.races++;
  if (!me) return 0;
  if (me.position === 1 && me.status === 'finished') p.stats.wins++;
  const pay = racePayout(me.position, tier);
  p.credits += pay;
  return pay;
}

export function partPrice(tier: PartTier): number {
  return PART_PRICES[tier];
}

/** The garage-relevant part of a profile. */
export interface Garage {
  credits: number;
  loadout: Loadout;
  /** Part keys owned per slot (content/parts `partKey`: '0', '1a', '2b'…). Stock is always owned. */
  owned: Record<PartSlot, string[]>;
}

export function owns(g: Garage, slot: PartSlot, tier: PartTier, variant: PartVariant = 'a'): boolean {
  return tier === 0 || g.owned[slot].includes(partKey(slot, tier, variant));
}

function fit(g: Garage, slot: PartSlot, tier: PartTier, variant: PartVariant): void {
  g.loadout.parts[slot] = tier;
  g.loadout.variants = { ...STOCK_VARIANTS, ...g.loadout.variants, [slot]: variantOf(slot, tier, variant) };
}

export type PurchaseResult = 'bought' | 'owned' | 'short' | 'invalid';

/**
 * Buy a part and fit it. Mutates `g` only on 'bought'. The two variants of a tier are bought separately, at
 * the same price; a variant the slot does not have (Aero, or Stock) is 'invalid'.
 */
export function buyPart(g: Garage, slot: PartSlot, tier: PartTier, variant: PartVariant = 'a'): PurchaseResult {
  if (!PART_SLOTS.includes(slot) || !PART_TIERS.includes(tier) || !PART_VARIANTS.includes(variant)) return 'invalid';
  if (variant === 'b' && !hasVariants(slot, tier)) return 'invalid';
  if (owns(g, slot, tier, variant)) return 'owned';
  const price = partPrice(tier);
  if (g.credits < price) return 'short';
  g.credits -= price;
  g.owned[slot] = [...g.owned[slot], partKey(slot, tier, variant)].sort();
  fit(g, slot, tier, variant);
  return 'bought';
}

/** Fit an owned part (free). Returns false (and changes nothing) if it isn't owned. */
export function equipPart(g: Garage, slot: PartSlot, tier: PartTier, variant: PartVariant = 'a'): boolean {
  if (!PART_SLOTS.includes(slot) || !PART_TIERS.includes(tier) || !owns(g, slot, tier, variant)) return false;
  if (variant === 'b' && !hasVariants(slot, tier)) return false;
  fit(g, slot, tier, variant);
  return true;
}

/** Every chassis is free to pick; the parts and livery carry over. */
export function selectChassis(g: Garage, chassisId: string): boolean {
  if (!CHASSIS.some((c) => c.id === chassisId)) return false;
  g.loadout.chassisId = chassisId;
  return true;
}
