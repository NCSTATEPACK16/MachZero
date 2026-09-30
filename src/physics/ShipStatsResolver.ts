/**
 * Loadout → ShipStats (pure). Class base stats plus part deltas from content/parts.ts.
 * Effective thrust = (class thrust + engine bonus) · mass / (mass + Σ part weight), so Stock = class value.
 */
import type { Loadout, PartSlot, PartTier, ShipStats } from '../core/contracts';
import { CLASS_STATS, chassisById } from '../content/ships';
import { PART_EFFECTS } from '../content/parts';

export function resolveStats(loadout: Pick<Loadout, 'chassisId' | 'parts'>): ShipStats {
  const base = CLASS_STATS[chassisById(loadout.chassisId).cls];
  const { engine, booster, stabilizer, hull } = loadout.parts;
  const E = PART_EFFECTS.engine;
  const B = PART_EFFECTS.booster;
  const S = PART_EFFECTS.stabilizer;
  const H = PART_EFFECTS.hull;

  const weight = E.weight[engine] + H.weight[hull];
  const massScale = base.mass / (base.mass + weight);
  const steer = S.steerScale[stabilizer];

  return {
    topSpeed: base.topSpeed + E.topSpeed[engine] + S.topSpeed[stabilizer],
    thrustAccel: (base.thrustAccel + E.thrustAccel[engine]) * massScale,
    boostTopSpeed: base.boostTopSpeed + B.boostTopSpeed[booster],
    boostAccel: base.boostAccel * massScale,
    boostCost: B.boostCost[booster],
    boostTime: B.boostTime[booster],
    steerRate: base.steerRate * steer,
    steerRateHighSpeed: base.steerRateHighSpeed * steer,
    lateralGrip: base.lateralGrip + S.lateralGrip[stabilizer],
    airbrakeGrip: base.airbrakeGrip,
    energyMax: base.energyMax + H.energyMax[hull],
    damageTakenScale: base.damageTakenScale * H.damageScale[hull],
    mass: base.mass + weight,
  };
}

/** Uniform-tier parts (rival fits and tests). */
export function partsAt(tier: PartTier): Record<PartSlot, PartTier> {
  return { engine: tier, booster: tier, stabilizer: tier, hull: tier };
}
