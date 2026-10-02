import { describe, expect, it } from 'vitest';
import { FEATURE_DEFAULTS, FEATURE_NAMES, resolveFeatures } from './features';

describe('feature flags', () => {
  it('ship everything off on main by default', () => {
    expect(resolveFeatures('')).toEqual(FEATURE_DEFAULTS);
    for (const n of FEATURE_NAMES) expect(FEATURE_DEFAULTS[n]).toBe(false);
  });
  it('enables all, a list, or none from the query string', () => {
    const all = resolveFeatures('?features=all');
    for (const n of FEATURE_NAMES) expect(all[n]).toBe(true);
    const some = resolveFeatures('?features=garage, worlds,bogus');
    expect(some.garage).toBe(true);
    expect(some.worlds).toBe(true);
    expect(some.music).toBe(false);
    const none = resolveFeatures('?features=none', { ...FEATURE_DEFAULTS, garage: true });
    expect(none.garage).toBe(false);
  });
});
