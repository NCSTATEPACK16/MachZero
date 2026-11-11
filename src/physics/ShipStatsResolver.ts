/**
 * Loadout → ShipStats (pure). Class base stats plus part deltas from content/parts.ts.
 * Effective thrust = (class thrust + engine bonus) · mass / (mass + Σ part weight), so Stock = class value.
 * A slot's variant picks its effects table (IMPLEMENTATION §X3); a missing variant is 'a', the 2.0 part.
 */
import type { Loadout, PartSlot, PartTier, PartVariant, ShipStats } from '../core/contracts';
import { CLASS_STATS, chassisById } from '../content/ships';
import { AERO_EFFECTS, partEffects } from '../content/parts';

export function resolveStats(loadout: Pick<Loadout, 'chassisId' | 'parts' | 'variants'>): ShipStats {
  const base = CLASS_STATS[chassisById(loadout.chassisId).cls];
  const { engine, booster, stabilizer, hull } = loadout.parts;
  // Loadouts written before the Aero slot existed have no aero entry.
  const aero: PartTier = loadout.parts.aero ?? 0;
  const v = loadout.variants ?? {};
  const E = partEffects(v.engine).engine;
  const B = partEffects(v.booster).booster;
  const S = partEffects(v.stabilizer).stabilizer;
  const H = partEffects(v.hull).hull;
  const A = AERO_EFFECTS;

  const weight = E.weight[engine] + H.weight[hull];
  const massScale = base.mass / (base.mass + weight);
  const steer = S.steerScale[stabilizer];

  return {
    topSpeed: base.topSpeed + E.topSpeed[engine] + S.topSpeed[stabilizer] + A.topSpeed[aero],
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
    draftScale: base.draftScale * A.draftScale[aero],
    pushScale: base.pushScale * A.pushScale[aero],
    airSteerScale: base.airSteerScale * A.airSteerScale[aero],
    ramMass: base.ramMass * H.ramMass[hull],
  };
}

/** Uniform-tier parts in the four 2.0 slots, Stock Aero (rival fits and tests). */
export function partsAt(tier: PartTier): Record<PartSlot, PartTier> {
  return { engine: tier, booster: tier, stabilizer: tier, hull: tier, aero: 0 };
}

/** The same variant in every slot that has one (tests and the balance sim). */
export function variantsAt(variant: PartVariant): Record<PartSlot, PartVariant> {
  return { engine: variant, booster: variant, stabilizer: variant, hull: variant, aero: 'a' };
}
