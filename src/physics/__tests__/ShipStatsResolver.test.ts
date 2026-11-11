import { describe, expect, it } from 'vitest';
import { CLASSIC_STATS } from '../../core/config';
import { CHASSIS, CLASS_STATS } from '../../content/ships';
import { RIVAL_FITS, buildRaceField, defaultLoadout } from '../../content/pilots';
import { PART_EFFECTS, PART_EFFECTS_B, PART_PRICES, hasVariants, parsePartKey, partKey, partName } from '../../content/parts';
import { partsAt, resolveStats, variantsAt } from '../ShipStatsResolver';

describe('resolveStats', () => {
  it('Balanced Stock equals v1 CONFIG exactly (stats parity)', () => {
    expect(resolveStats({ chassisId: 'comet', parts: partsAt(0) })).toEqual(CLASSIC_STATS);
    expect(resolveStats({ chassisId: 'arrow', parts: partsAt(0) })).toEqual(CLASSIC_STATS);
  });

  it('Stock parts give each class its base stats', () => {
    for (const c of CHASSIS) expect(resolveStats({ chassisId: c.id, parts: partsAt(0) })).toEqual(CLASS_STATS[c.cls]);
  });

  it('engine upgrades raise top speed and thrust, but weight tempers acceleration', () => {
    const stock = resolveStats({ chassisId: 'comet', parts: partsAt(0) });
    const proto = resolveStats({ chassisId: 'comet', parts: { ...partsAt(0), engine: 3 } });
    expect(proto.topSpeed).toBe(stock.topSpeed + 10);
    expect(proto.thrustAccel).toBeCloseTo((62 + 8) / 1.07, 9);
    expect(proto.mass).toBeCloseTo(1.07, 9);
  });

  it('boosters make boosts faster, longer and cheaper', () => {
    const s = resolveStats({ chassisId: 'dart', parts: { ...partsAt(0), booster: 3 } });
    expect(s.boostTopSpeed).toBe(184 + 15);
    expect(s.boostCost).toBe(11);
    expect(s.boostTime).toBe(2.0);
  });

  it('stabilizers trade a little top speed for steering and grip', () => {
    const s = resolveStats({ chassisId: 'titan', parts: { ...partsAt(0), stabilizer: 2 } });
    expect(s.steerRate).toBeCloseTo(1.7 * 1.08, 9);
    expect(s.steerRateHighSpeed).toBeCloseTo(1.1 * 1.08, 9);
    expect(s.lateralGrip).toBe(7.5);
    expect(s.topSpeed).toBe(145);
  });

  it('hulls add energy and damage resistance, and weight', () => {
    const s = resolveStats({ chassisId: 'bastion', parts: { ...partsAt(0), hull: 3 } });
    expect(s.energyMax).toBe(150);
    expect(s.damageTakenScale).toBeCloseTo(0.85 * 0.85, 9);
    expect(s.thrustAccel).toBeLessThan(54);
  });

  it('every tier upgrade is monotonic in the stat it sells', () => {
    let prev = resolveStats({ chassisId: 'comet', parts: partsAt(0) });
    for (const t of [1, 2, 3] as const) {
      const s = resolveStats({ chassisId: 'comet', parts: partsAt(t) });
      expect(s.topSpeed).toBeGreaterThan(prev.topSpeed);
      expect(s.boostTopSpeed).toBeGreaterThan(prev.boostTopSpeed);
      expect(s.energyMax).toBeGreaterThan(prev.energyMax);
      expect(s.steerRate).toBeGreaterThan(prev.steerRate);
      prev = s;
    }
  });
});

describe('sidegrades and the Aero slot (IMPLEMENTATION §X3)', () => {
  it('a loadout with no variants, all-A variants or no Aero entry resolves exactly as in 2.0', () => {
    for (const c of CHASSIS) {
      for (const t of [0, 1, 2, 3] as const) {
        const plain = resolveStats({ chassisId: c.id, parts: partsAt(t) });
        expect(resolveStats({ chassisId: c.id, parts: partsAt(t), variants: variantsAt('a') })).toEqual(plain);
        const { aero: _aero, ...four } = partsAt(t);
        expect(resolveStats({ chassisId: c.id, parts: four as ReturnType<typeof partsAt> })).toEqual(plain);
        expect(plain.draftScale).toBe(1);
        expect(plain.pushScale).toBe(1);
        expect(plain.airSteerScale).toBe(1);
        expect(plain.ramMass).toBe(1);
      }
    }
  });

  it('Stock is the same part in both variants', () => {
    expect(resolveStats({ chassisId: 'comet', parts: partsAt(0), variants: variantsAt('b') })).toEqual(CLASSIC_STATS);
    for (const slot of ['engine', 'booster', 'stabilizer', 'hull'] as const) {
      for (const [stat, a] of Object.entries(PART_EFFECTS[slot])) expect((PART_EFFECTS_B[slot] as Record<string, readonly number[]>)[stat][0]).toBe(a[0]);
    }
  });

  it('each B part trades differently from its A part', () => {
    for (const t of [1, 2, 3] as const) {
      const a = resolveStats({ chassisId: 'comet', parts: partsAt(t) });
      const sprint = resolveStats({ chassisId: 'comet', parts: partsAt(t), variants: { engine: 'b' } });
      expect(sprint.topSpeed).toBeLessThan(a.topSpeed);
      expect(sprint.thrustAccel).toBeGreaterThan(a.thrustAccel);
      const burst = resolveStats({ chassisId: 'comet', parts: partsAt(t), variants: { booster: 'b' } });
      expect(burst.boostTopSpeed).toBeGreaterThan(a.boostTopSpeed);
      expect(burst.boostTime).toBeLessThan(a.boostTime);
      const agility = resolveStats({ chassisId: 'comet', parts: partsAt(t), variants: { stabilizer: 'b' } });
      expect(agility.steerRate).toBeGreaterThan(a.steerRate);
      expect(agility.lateralGrip).toBeLessThan(a.lateralGrip);
      const plate = resolveStats({ chassisId: 'comet', parts: partsAt(t), variants: { hull: 'b' } });
      expect(plate.energyMax).toBeLessThan(a.energyMax);
      expect(plate.damageTakenScale).toBeLessThan(a.damageTakenScale);
      expect(plate.ramMass).toBeGreaterThan(1);
      expect(plate.mass).toBeGreaterThan(a.mass);
    }
  });

  it('Aero trades a little top speed for slipstream, wind resistance and air steering', () => {
    const stock = resolveStats({ chassisId: 'comet', parts: partsAt(0) });
    const s = resolveStats({ chassisId: 'comet', parts: { ...partsAt(0), aero: 3 } });
    expect(s.draftScale).toBe(1.5);
    expect(s.pushScale).toBe(0.7);
    expect(s.airSteerScale).toBe(1.3);
    expect(s.topSpeed).toBe(stock.topSpeed - 1);
    // Aero has one line of parts: a stray 'b' changes nothing.
    expect(resolveStats({ chassisId: 'comet', parts: { ...partsAt(0), aero: 3 }, variants: { aero: 'b' } })).toEqual(s);
  });

  it('part keys, names and prices', () => {
    expect(partKey('engine', 0, 'b')).toBe('0');
    expect(partKey('engine', 2, 'b')).toBe('2b');
    expect(partKey('engine', 2)).toBe('2a');
    expect(partKey('aero', 3, 'b')).toBe('3a');
    expect(parsePartKey('2b')).toEqual({ tier: 2, variant: 'b' });
    expect(parsePartKey('0')).toEqual({ tier: 0, variant: 'a' });
    for (const bad of ['4a', '0b', 'a2', '', 2, null, '2c']) expect(parsePartKey(bad)).toBeNull();
    expect(hasVariants('hull', 0)).toBe(false);
    expect(hasVariants('hull', 1)).toBe(true);
    expect(hasVariants('aero', 3)).toBe(false);
    expect(partName('engine', 2, 'b')).toBe('Mk III Sprint');
    expect(partName('engine', 0, 'b')).toBe('Stock');
    expect(partName('aero', 3)).toBe('Prototype');
    expect(PART_PRICES).toEqual({ 0: 0, 1: 600, 2: 1500, 3: 3200 });
  });

  it('rival fits: Rookie is all Stock; variants follow personality; Aero rises with the tier', () => {
    expect(Object.values(RIVAL_FITS.rookie).every((t) => t === 0)).toBe(true);
    expect([RIVAL_FITS.rookie.aero, RIVAL_FITS.pilot.aero, RIVAL_FITS.ace.aero, RIVAL_FITS.legend.aero]).toEqual([0, 0, 1, 2]);
    const rookie = buildRaceField({ playerName: 'ME', playerLoadout: defaultLoadout(), tier: 'rookie' });
    for (const d of rookie) expect(d.stats).toEqual(CLASS_STATS[CHASSIS.find((c) => c.id === d.loadout!.chassisId)!.cls]);
    const legend = buildRaceField({ playerName: 'ME', playerLoadout: defaultLoadout(), tier: 'legend' });
    const variantsUsed = new Set(legend.slice(1).map((d) => JSON.stringify(d.loadout!.variants)));
    expect(variantsUsed.size).toBe(3);
    for (const d of legend.slice(1)) expect(d.stats.draftScale).toBe(1.3);
  });
});

describe('buildRaceField', () => {
  it('takes an explicit grid order for every ship (Grand Prix), and ignores a malformed one', () => {
    const base = buildRaceField({ playerName: 'ME', playerLoadout: defaultLoadout(), tier: 'pilot' });
    const order = [7, 6, 5, 3, 1, 0, 2, 4];
    const field = buildRaceField({ playerName: 'ME', playerLoadout: defaultLoadout(), tier: 'pilot', gridOrder: order });
    for (const d of field) expect(order[d.gridIndex]).toBe(d.id);
    const bad = buildRaceField({ playerName: 'ME', playerLoadout: defaultLoadout(), tier: 'pilot', gridOrder: [0, 0, 1, 2, 3, 4, 5, 6] });
    expect(bad.map((d) => d.gridIndex)).toEqual(base.map((d) => d.gridIndex));
  });

  it('builds 8 ships with unique ids and grid slots; the player is id 0', () => {
    for (const tier of ['rookie', 'pilot', 'ace', 'legend'] as const) {
      const field = buildRaceField({ playerName: 'ME', playerLoadout: defaultLoadout(), tier });
      expect(field).toHaveLength(8);
      expect(new Set(field.map((d) => d.id)).size).toBe(8);
      expect(new Set(field.map((d) => d.gridIndex))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
      expect(field[0].isPlayer).toBe(true);
      expect(field.filter((d) => d.isPlayer)).toHaveLength(1);
      expect(field[0].gridIndex).toBe(tier === 'rookie' ? 7 : 4);
      for (const d of field.slice(1)) {
        expect(d.personality).toBeDefined();
        expect(d.loadout?.parts).toEqual(RIVAL_FITS[tier]);
      }
    }
  });

  it('a new profile drives a stock COMET (v1 handling)', () => {
    const [player] = buildRaceField({ playerName: 'ME', playerLoadout: defaultLoadout(), tier: 'pilot' });
    expect(player.stats).toEqual(CLASSIC_STATS);
  });
});
