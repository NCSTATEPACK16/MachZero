/**
 * 2.0 feature flags. `main` is the live site (every merged PR deploys), so unfinished 2.0 surfaces stay
 * off until their milestone is complete. Previews enable them with `?features=all` or a comma list,
 * e.g. `?features=garage,worlds`. Flip a default to `true` in the PR that completes its milestone.
 */
export const FEATURE_NAMES = [
  'profiles', // M1: profiles, saves, settings menus
  'garage', // M2: Blender ships, parts, garage, livery editor
  'worlds', // M3/M4: authored worlds + world select
  'tiers', // M5: AI tiers, pilots, drafting
  'music', // M6: music sequencer + expanded SFX
  'touch', // M7: touch / tilt controls, comfort settings
  'modes', // M8: World Tour, Grand Prix, Time Trial + ghosts
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureSet = Readonly<Record<FeatureName, boolean>>;

/** Defaults shipped on `main`. A flag turns on in the PR that completes its milestone. */
export const FEATURE_DEFAULTS: FeatureSet = {
  profiles: true, // M1 complete
  garage: true, // M2 complete
  worlds: false,
  tiers: false,
  music: false,
  touch: false,
  modes: false,
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

/** Flags for this page load. */
export const FEATURES: FeatureSet = resolveFeatures(typeof location !== 'undefined' ? location.search : '');

export function isEnabled(name: FeatureName): boolean {
  return FEATURES[name];
}
