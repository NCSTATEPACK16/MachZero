import { describe, expect, it } from 'vitest';
import { CLASSIC_STATS } from '../../core/config';
import { CHASSIS, CLASS_STATS } from '../../content/ships';
import { RIVAL_FITS, buildRaceField, defaultLoadout } from '../../content/pilots';
import { partsAt, resolveStats } from '../ShipStatsResolver';

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

describe('buildRaceField', () => {
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
