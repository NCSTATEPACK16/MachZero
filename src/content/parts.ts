/**
 * Parts (SPEC §5.2 and §10, IMPLEMENTATION Appendix A and §X3). Pure data; physics/ShipStatsResolver turns a
 * loadout into ShipStats.
 *
 * 2.0 had 4 slots × 4 tiers. 2.1 adds:
 * - a sidegrade per slot at Mk II, Mk III and Prototype: variant A is the 2.0 part with unchanged numbers,
 *   variant B costs the same and trades differently (sim/parts.sim.test.ts keeps each pair within 1% a lap);
 * - a fifth slot, Aero, with four tiers and no variants.
 */
import type { PartSlot, PartTier, PartVariant } from '../core/contracts';

export const PART_SLOTS: readonly PartSlot[] = ['engine', 'booster', 'stabilizer', 'hull', 'aero'];
export const PART_TIERS: readonly PartTier[] = [0, 1, 2, 3];
export const PART_VARIANTS: readonly PartVariant[] = ['a', 'b'];
/** The 2.0 slots: the ones with an A/B choice. */
export const VARIANT_SLOTS: readonly PartSlot[] = ['engine', 'booster', 'stabilizer', 'hull'];

export const TIER_NAMES: Readonly<Record<PartTier, string>> = { 0: 'Stock', 1: 'Mk II', 2: 'Mk III', 3: 'Prototype' };
export const SLOT_NAMES: Readonly<Record<PartSlot, string>> = {
  engine: 'Engine',
  booster: 'Booster',
  stabilizer: 'Stabilizer',
  hull: 'Hull',
  aero: 'Aero',
};
export const SLOT_BLURBS: Readonly<Record<PartSlot, string>> = {
  engine: 'Top speed and acceleration. Adds weight.',
  booster: 'Faster, longer and cheaper boosts.',
  stabilizer: 'Sharper steering and more grip. Costs a little top speed.',
  hull: 'More energy and less damage. Adds weight.',
  aero: 'A stronger slipstream, steadier in wind, more steering in the air. Costs a little top speed.',
};

/** Variant names per slot. Aero has one line of parts. */
export const PART_VARIANT_NAMES: Readonly<Record<PartSlot, Readonly<Record<PartVariant, string>>>> = {
  engine: { a: 'Velocity', b: 'Sprint' },
  booster: { a: 'Longburn', b: 'Burst' },
  stabilizer: { a: 'Grip', b: 'Agility' },
  hull: { a: 'Cell', b: 'Plate' },
  aero: { a: 'Aero', b: 'Aero' },
};
export const PART_VARIANT_BLURBS: Readonly<Record<PartSlot, Readonly<Record<PartVariant, string>>>> = {
  engine: { a: 'The most top speed.', b: 'Much more acceleration, less top speed.' },
  booster: { a: 'Long, cheap boosts.', b: 'Short boosts with a much higher top speed.' },
  stabilizer: { a: 'The most grip.', b: 'Much sharper steering, little extra grip.' },
  hull: { a: 'The most energy.', b: 'Takes far less damage and shoves harder. Heavier, less energy.' },
  aero: { a: SLOT_BLURBS.aero, b: SLOT_BLURBS.aero },
};

/** Does this slot offer two variants at this tier? */
export function hasVariants(slot: PartSlot, tier: PartTier): boolean {
  return tier > 0 && VARIANT_SLOTS.includes(slot);
}

/** The variant in force for a slot and tier: 'a' wherever there is no choice. */
export function variantOf(slot: PartSlot, tier: PartTier, variant: PartVariant | undefined): PartVariant {
  return variant === 'b' && hasVariants(slot, tier) ? 'b' : 'a';
}

/**
 * How a part is recorded as owned (save v7): '0' for Stock, otherwise the tier and the variant ('1a', '3b').
 * Aero parts are always variant 'a'.
 */
export function partKey(slot: PartSlot, tier: PartTier, variant: PartVariant | undefined = 'a'): string {
  return tier === 0 ? '0' : `${tier}${variantOf(slot, tier, variant)}`;
}

/** '2b' → { tier: 2, variant: 'b' }; anything else → null. */
export function parsePartKey(key: unknown): { tier: PartTier; variant: PartVariant } | null {
  if (key === '0') return { tier: 0, variant: 'a' };
  if (typeof key !== 'string' || !/^[123][ab]$/.test(key)) return null;
  return { tier: Number(key[0]) as PartTier, variant: key[1] as PartVariant };
}

/** Display name: 'Stock', 'Mk II Sprint', 'Mk III' (Aero). */
export function partName(slot: PartSlot, tier: PartTier, variant: PartVariant | undefined = 'a'): string {
  return hasVariants(slot, tier) ? `${TIER_NAMES[tier]} ${PART_VARIANT_NAMES[slot][variantOf(slot, tier, variant)]}` : TIER_NAMES[tier];
}

/** Credits per tier (Stock is free). Both variants of a tier cost the same. */
export const PART_PRICES: Readonly<Record<PartTier, number>> = { 0: 0, 1: 600, 2: 1500, 3: 3200 };

type PerTier = readonly [number, number, number, number];

interface SlotEffects {
  engine: { topSpeed: PerTier; thrustAccel: PerTier; weight: PerTier };
  booster: { boostTopSpeed: PerTier; boostCost: PerTier; boostTime: PerTier };
  stabilizer: { steerScale: PerTier; lateralGrip: PerTier; topSpeed: PerTier };
  hull: { energyMax: PerTier; damageScale: PerTier; weight: PerTier; ramMass: PerTier };
}

/** Variant A: the 2.0 parts. These numbers do not change (every 2.0 test and sim depends on them). */
export const PART_EFFECTS: SlotEffects = {
  engine: {
    topSpeed: [0, 3, 6, 10],
    thrustAccel: [0, 3, 6, 8],
    weight: [0, 0.02, 0.04, 0.07],
  },
  booster: {
    boostTopSpeed: [0, 5, 10, 15],
    boostCost: [14, 13, 12, 11],
    boostTime: [1.6, 1.7, 1.8, 2.0],
  },
  stabilizer: {
    steerScale: [1, 1.04, 1.08, 1.12],
    lateralGrip: [0, 0.5, 1, 1.5],
    topSpeed: [0, -0.5, -1, -1.5],
  },
  hull: {
    energyMax: [0, 10, 20, 30],
    damageScale: [1, 0.95, 0.9, 0.85],
    weight: [0, 0.03, 0.06, 0.1],
    ramMass: [1, 1, 1, 1],
  },
};

/**
 * Variant B (index 0 is Stock, the same as A). Tuned by sim/parts.sim.test.ts: change these numbers, never
 * the 1% assertion.
 */
export const PART_EFFECTS_B: SlotEffects = {
  // Sprint: gets to speed sooner, tops out lower.
  engine: {
    topSpeed: [0, 2, 4, 7],
    thrustAccel: [0, 6, 11, 15],
    weight: [0, 0.02, 0.04, 0.07],
  },
  // Burst: a short, hard kick.
  booster: {
    boostTopSpeed: [0, 8, 15, 22],
    boostCost: [14, 14, 13, 11],
    boostTime: [1.6, 1.3, 1.35, 1.4],
  },
  // Agility: turns in harder, holds the line less.
  stabilizer: {
    steerScale: [1, 1.08, 1.15, 1.22],
    lateralGrip: [0, 0, 0.2, 0.5],
    topSpeed: [0, -0.5, -1, -1.5],
  },
  // Plate: armour, not a bigger energy cell.
  hull: {
    energyMax: [0, 3, 7, 10],
    damageScale: [1, 0.85, 0.75, 0.65],
    weight: [0, 0.05, 0.09, 0.14],
    ramMass: [1, 1.1, 1.2, 1.3],
  },
};

/** The effects table of a variant. */
export function partEffects(variant: PartVariant | undefined): SlotEffects {
  return variant === 'b' ? PART_EFFECTS_B : PART_EFFECTS;
}

/** Aero: four tiers, no variants. The push term has no effect until a world has wind or jets (X4, X6). */
export const AERO_EFFECTS = {
  draftScale: [1, 1.15, 1.3, 1.5] as PerTier,
  pushScale: [1, 0.9, 0.8, 0.7] as PerTier,
  airSteerScale: [1, 1.1, 1.2, 1.3] as PerTier,
  topSpeed: [0, -0.3, -0.6, -1] as PerTier,
} as const;

export const STOCK_PARTS: Readonly<Record<PartSlot, PartTier>> = Object.freeze({
  engine: 0,
  booster: 0,
  stabilizer: 0,
  hull: 0,
  aero: 0,
});

/** Every slot on variant A: the 2.0 loadout. */
export const STOCK_VARIANTS: Readonly<Record<PartSlot, PartVariant>> = Object.freeze({
  engine: 'a',
  booster: 'a',
  stabilizer: 'a',
  hull: 'a',
  aero: 'a',
});
