import { describe, expect, it } from 'vitest';
import { FEATURE_DEFAULTS, FEATURE_NAMES, buildDefaults, resolveFeatures } from './features';

describe('feature flags', () => {
  it('only the two unfinished surfaces are flags, both off on main (M8d removed the rest)', () => {
    expect([...FEATURE_NAMES]).toEqual(['music', 'expansion']);
    expect(resolveFeatures('')).toEqual(FEATURE_DEFAULTS);
    for (const n of FEATURE_NAMES) expect(FEATURE_DEFAULTS[n], n).toBe(false);
  });
  it('enables all, a list, or none from the query string', () => {
    const all = resolveFeatures('?features=all');
    for (const n of FEATURE_NAMES) expect(all[n]).toBe(true);
    const some = resolveFeatures('?features=expansion, bogus');
    expect(some).toEqual({ music: false, expansion: true });
    const none = resolveFeatures('?features=none', { ...FEATURE_DEFAULTS, expansion: true });
    expect(none.expansion).toBe(false);
  });
  it('an old link naming a removed flag still loads: the name is ignored', () => {
    expect(resolveFeatures('?features=modes,garage,touch')).toEqual(FEATURE_DEFAULTS);
    expect(resolveFeatures('?features=modes,expansion')).toEqual({ music: false, expansion: true });
    expect(Object.keys(resolveFeatures('?features=modes'))).toEqual([...FEATURE_NAMES]);
  });
  it('a build made with VITE_FEATURES turns those flags on as defaults (the iOS app has no query string)', () => {
    expect(buildDefaults(undefined)).toEqual(FEATURE_DEFAULTS);
    expect(buildDefaults('')).toEqual(FEATURE_DEFAULTS);
    const ios = buildDefaults('expansion');
    expect(ios.expansion).toBe(true);
    expect(ios.music).toBe(false);
    // An old build command that names `modes` still works: `modes` is ignored, `expansion` is on.
    expect(buildDefaults('modes,expansion, bogus')).toEqual({ music: false, expansion: true });
    for (const n of FEATURE_NAMES) expect(buildDefaults('all')[n]).toBe(true);
    // The query string still wins over the build: ?features=none turns everything off.
    expect(resolveFeatures('?features=none', ios).expansion).toBe(false);
  });
});
