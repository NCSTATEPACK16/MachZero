/**
 * AI tiers (SPEC §7, IMPLEMENTATION §M5): the ceiling each difficulty sets on a CPU pilot. The pilot's personality
 * (AIDriver PROFILES) is the flavour inside it: the driver's effective profile is the personality's numbers scaled
 * by `drive`, plus the tier's own behaviour knobs below.
 *
 * Legend is v1's AI at full stretch (every multiplier 1). Lower tiers drive more carefully, boost less, never hunt
 * for a draft, and race at a lower thrust cap (`paceScale`). Their parts come from RIVAL_FITS (content/pilots.ts).
 */
import type { AITier } from '../core/contracts';

export interface TierDef {
  id: AITier;
  label: string;
  /** One-line description for the tier picker. */
  hint: string;
  /** Thrust and top-speed cap (ShipState.thrustScale base) before the rubber band. */
  paceScale: number;
  /** Rubber-band range: `min` well ahead of the player, `max` well behind. Replaces CONFIG.AI_RUBBER_BAND_*. */
  rubberBand: { min: number; max: number };
  /** Multipliers on the personality's driving numbers (AIDriver PROFILES). */
  drive: { latBudget: number; yawFactor: number; brakeDecel: number; overspeedTol: number; lookScale: number };
  /** Boost policy: energy % added to the personality's boost threshold, and a scale on its cooldown. */
  boost: { energyOffset: number; cooldownScale: number };
  /** Energy % added to the personality's pit threshold (Rookies pit early). */
  pitEnergyOffset: number;
  /** Small mistakes (a lift off the throttle) per minute of racing, for every personality. */
  mistakeRate: number;
  /** Fraction of the racing line's lateral swing given up (0 = apex to apex; Rookies stay nearer the middle). */
  lineInset: number;
  /** 0: never rams and yields room; 1: rams whenever ahead on energy (aggressive pilots only below 1). */
  aggression: number;
  /** 0..1: how eagerly the driver tucks in behind a ship ahead to draft. */
  draftSeeking: number;
  /** Chance of taking a split path's shortcut on each approach (Legend: always, unless its gate will be shut). */
  shortcutOdds: number;
  /** Clearance (m) kept from mines and debris. */
  hazardMargin: number;
  /** Fraction of the hazard look-ahead used for dropped mines (SPEC §4.4a: Rookies are a little worse). */
  droppedLookahead: number;
}

export const TIER_ORDER: readonly AITier[] = ['rookie', 'pilot', 'ace', 'legend'];

export const TIERS: Readonly<Record<AITier, Readonly<TierDef>>> = {
  rookie: {
    id: 'rookie',
    label: 'ROOKIE',
    hint: 'Slower rivals on stock parts who never speed up to catch you. Hazards only slow you down. You start at the back.',
    // The user playtested 0.90 on iPhone (PR #18) and liked it: Rookie is never slower than that.
    paceScale: 0.9,
    rubberBand: { min: 0.92, max: 1 },
    drive: { latBudget: 1, yawFactor: 1, brakeDecel: 0.85, overspeedTol: 0.6, lookScale: 1.05 },
    boost: { energyOffset: 12, cooldownScale: 1.8 },
    pitEnergyOffset: 6,
    mistakeRate: 0.8,
    lineInset: 0.25,
    aggression: 0,
    draftSeeking: 0,
    shortcutOdds: 0,
    hazardMargin: 2.5,
    droppedLookahead: 0.7,
  },
  pilot: {
    id: 'pilot',
    label: 'PILOT',
    hint: 'Rivals with tuned engines who push to keep up with you.',
    paceScale: 0.94,
    rubberBand: { min: 0.97, max: 1.06 },
    drive: { latBudget: 0.96, yawFactor: 0.97, brakeDecel: 0.92, overspeedTol: 0.8, lookScale: 1.02 },
    boost: { energyOffset: 6, cooldownScale: 1.25 },
    pitEnergyOffset: 2,
    mistakeRate: 0.5,
    lineInset: 0.12,
    aggression: 0.35,
    draftSeeking: 0,
    shortcutOdds: 0.3,
    hazardMargin: 1.2,
    droppedLookahead: 1,
  },
  ace: {
    id: 'ace',
    label: 'ACE',
    hint: 'Fast, upgraded rivals who take shortcuts and hunt for your slipstream. Pays more credits.',
    paceScale: 0.97,
    rubberBand: { min: 0.98, max: 1.04 },
    drive: { latBudget: 0.98, yawFactor: 0.99, brakeDecel: 1, overspeedTol: 1, lookScale: 1 },
    boost: { energyOffset: 2, cooldownScale: 1.05 },
    pitEnergyOffset: 0,
    mistakeRate: 0.2,
    lineInset: 0.05,
    aggression: 0.6,
    draftSeeking: 0.7,
    shortcutOdds: 0.6,
    hazardMargin: 1.2,
    droppedLookahead: 1,
  },
  legend: {
    id: 'legend',
    label: 'LEGEND',
    hint: 'Fully upgraded rivals on near-perfect lines who draft, block and ram. Pays the most credits.',
    paceScale: 1,
    rubberBand: { min: 0.99, max: 1.02 },
    drive: { latBudget: 1, yawFactor: 1, brakeDecel: 1, overspeedTol: 1, lookScale: 1 },
    boost: { energyOffset: 0, cooldownScale: 1 },
    pitEnergyOffset: 0,
    mistakeRate: 0,
    lineInset: 0,
    aggression: 1,
    draftSeeking: 1,
    shortcutOdds: 1,
    hazardMargin: 1.2,
    droppedLookahead: 1,
  },
};

/** Tier picker options in order (World Select, Settings → Race). */
export const TIER_OPTIONS: ReadonlyArray<{ value: AITier; label: string }> = TIER_ORDER.map((t) => ({ value: t, label: TIERS[t].label }));

export function tierDef(tier: AITier | undefined): Readonly<TierDef> {
  return TIERS[tier ?? 'pilot'];
}

