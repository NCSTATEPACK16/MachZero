/**
 * Parts: 4 slots × 4 tiers (SPEC §5.2, IMPLEMENTATION Appendix A). Pure data; physics/ShipStatsResolver
 * turns a loadout into ShipStats.
 */
import type { PartSlot, PartTier } from '../core/contracts';

export const PART_SLOTS: readonly PartSlot[] = ['engine', 'booster', 'stabilizer', 'hull'];
export const PART_TIERS: readonly PartTier[] = [0, 1, 2, 3];

export const TIER_NAMES: Readonly<Record<PartTier, string>> = { 0: 'Stock', 1: 'Mk II', 2: 'Mk III', 3: 'Prototype' };
export const SLOT_NAMES: Readonly<Record<PartSlot, string>> = {
  engine: 'Engine',
  booster: 'Booster',
  stabilizer: 'Stabilizer',
  hull: 'Hull',
};
export const SLOT_BLURBS: Readonly<Record<PartSlot, string>> = {
  engine: 'Top speed and acceleration. Adds weight.',
  booster: 'Faster, longer and cheaper boosts.',
  stabilizer: 'Sharper steering and more grip. Costs a little top speed.',
  hull: 'More energy and less damage. Adds weight.',
};

/** Credits per tier (Stock is free). */
export const PART_PRICES: Readonly<Record<PartTier, number>> = { 0: 0, 1: 600, 2: 1500, 3: 3200 };

type PerTier = readonly [number, number, number, number];

/** Per-tier effects, indexed by PartTier. */
export const PART_EFFECTS = {
  engine: {
    topSpeed: [0, 3, 6, 10] as PerTier,
    thrustAccel: [0, 3, 6, 8] as PerTier,
    weight: [0, 0.02, 0.04, 0.07] as PerTier,
  },
  booster: {
    boostTopSpeed: [0, 5, 10, 15] as PerTier,
    boostCost: [14, 13, 12, 11] as PerTier,
    boostTime: [1.6, 1.7, 1.8, 2.0] as PerTier,
  },
  stabilizer: {
    steerScale: [1, 1.04, 1.08, 1.12] as PerTier,
    lateralGrip: [0, 0.5, 1, 1.5] as PerTier,
    topSpeed: [0, -0.5, -1, -1.5] as PerTier,
  },
  hull: {
    energyMax: [0, 10, 20, 30] as PerTier,
    damageScale: [1, 0.95, 0.9, 0.85] as PerTier,
    weight: [0, 0.03, 0.06, 0.1] as PerTier,
  },
} as const;

export const STOCK_PARTS: Readonly<Record<PartSlot, PartTier>> = Object.freeze({
  engine: 0,
  booster: 0,
  stabilizer: 0,
  hull: 0,
});
