import { describe, expect, it } from 'vitest';
import { partsAt } from '../../physics/ShipStatsResolver';
import { statBars, type StatKey } from '../garageModel';

const bar = (chassisId: string, parts = partsAt(0)) => Object.fromEntries(statBars({ chassisId, parts }).map((b) => [b.key, b.value])) as Record<StatKey, number>;

describe('garage stat bars', () => {
  it('stay within the floor..1 range for the extremes', () => {
    for (const id of ['dart', 'comet', 'titan']) {
      for (const t of [0, 3] as const) {
        for (const v of Object.values(bar(id, partsAt(t)))) {
          expect(v).toBeGreaterThanOrEqual(0.12);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('show the class trade-offs at Stock', () => {
    const light = bar('dart');
    const heavy = bar('titan');
    expect(heavy.speed).toBeGreaterThan(light.speed);
    expect(heavy.armor).toBeGreaterThan(light.armor);
    expect(light.accel).toBeGreaterThan(heavy.accel);
    expect(light.handling).toBeGreaterThan(heavy.handling);
  });

  it('two ships of a class read the same', () => {
    expect(bar('dart')).toEqual(bar('wisp'));
    expect(bar('titan')).toEqual(bar('bastion'));
  });

  it('each part moves its own bars the right way', () => {
    const stock = bar('comet');
    const engine = bar('comet', { ...partsAt(0), engine: 3 });
    expect(engine.speed).toBeGreaterThan(stock.speed);
    expect(engine.accel).toBeGreaterThan(stock.accel);
    expect(bar('comet', { ...partsAt(0), booster: 3 }).boost).toBeGreaterThan(stock.boost);
    const stab = bar('comet', { ...partsAt(0), stabilizer: 3 });
    expect(stab.handling).toBeGreaterThan(stock.handling);
    expect(stab.speed).toBeLessThan(stock.speed); // the trade-off is visible
    expect(bar('comet', { ...partsAt(0), hull: 3 }).armor).toBeGreaterThan(stock.armor);
  });
});
