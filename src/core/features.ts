/**
 * 2.0 feature flags. `main` is the live site (every merged PR deploys), so unfinished 2.0 surfaces stay
 * off until their milestone is complete. Previews enable them with `?features=all` or a comma list,
 * e.g. `?features=garage,worlds`. Flip a default to `true` in the PR that completes its milestone.
 *
 * The iOS app has no URL to carry `?features=`, so a build can turn flags on instead: set `VITE_FEATURES` (the same
 * comma list) when building, e.g. `VITE_FEATURES=expansion npm run ios:sync`. Netlify builds do not set it, so the
 * live site and the previews keep the defaults.
 */
export const FEATURE_NAMES = [
  'profiles', // M1: profiles, saves, settings menus
  'garage', // M2: Blender ships, parts, garage, livery editor
  'worlds', // M3/M4: authored worlds + world select
  'tiers', // M5: AI tiers, pilots, drafting
  'music', // M6: music sequencer + expanded SFX
  'touch', // M7: touch / tilt controls, comfort settings
  'modes', // M8: World Tour, Grand Prix, Time Trial + ghosts
  'expansion', // 2.1 (IMPLEMENTATION §X): part variants and the Aero slot (X3), the new worlds (X4–X6)
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureSet = Readonly<Record<FeatureName, boolean>>;

/** Defaults shipped on `main`. A flag turns on in the PR that completes its milestone. */
export const FEATURE_DEFAULTS: FeatureSet = {
  profiles: true, // M1 complete
  garage: true, // M2 complete
  worlds: true, // M3 complete (Neon Bay, Sunset Mesa, world select)
  tiers: false,
  music: false,
  touch: false,
  modes: false,
  expansion: false,
};

const isFeature = (s: string): s is FeatureName => (FEATURE_NAMES as readonly string[]).includes(s);

/** Resolve flags from a URL query string (`?features=all` | `?features=a,b` | `?features=none`). */
export function resolveFeatures(search: string, defaults: FeatureSet = FEATURE_DEFAULTS): FeatureSet {
  const raw = new URLSearchParams(search).get('features');
  if (raw === null) return { ...defaults };
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.includes('none')) return Object.fromEntries(FEATURE_NAMES.map((n) => [n, false])) as FeatureSet;
  if (list.includes('all')) return Object.fromEntries(FEATURE_NAMES.map((n) => [n, true])) as FeatureSet;
  const out: Record<FeatureName, boolean> = { ...defaults };
  for (const name of list) if (isFeature(name)) out[name] = true;
  return out;
}

/** The defaults of a build made with `VITE_FEATURES=<list>` (`all`, or a comma list): those flags are on as well. */
export function buildDefaults(list: string | undefined, defaults: FeatureSet = FEATURE_DEFAULTS): FeatureSet {
  if (!list || list.trim() === '') return defaults;
  return resolveFeatures(`?features=${encodeURIComponent(list)}`, defaults);
}

/** Flags for this page load: the build's defaults, then the query string. */
export const FEATURES: FeatureSet = resolveFeatures(
  typeof location !== 'undefined' ? location.search : '',
  buildDefaults(import.meta.env?.VITE_FEATURES as string | undefined),
);

export function isEnabled(name: FeatureName): boolean {
  return FEATURES[name];
}
