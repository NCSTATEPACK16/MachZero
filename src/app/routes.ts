/**
 * App screens. `race` covers everything the in-race HUD shows (countdown, racing, pause, results); every
 * other route is a Preact screen drawn over the live menu backdrop (the next race waiting in 'title').
 */
import type { FeatureName, FeatureSet } from '../core/features';
import type { UrlFlags } from '../core/config';
import type { SaveData } from '../save/schema';

export type Route =
  | { name: 'profiles' }
  | { name: 'menu' }
  | { name: 'settings'; back: 'menu' | 'pause' }
  | { name: 'soon'; feature: FeatureName; title: string }
  | { name: 'garage' }
  | { name: 'loading' }
  | { name: 'race' };

export type RouteName = Route['name'];

/** Menu entries gated by 2.0 feature flags (hidden on `main` until their milestone ships). */
export const MENU_PLACEHOLDERS: ReadonlyArray<{ feature: FeatureName; title: string; blurb: string; milestone: string }> = [
  { feature: 'worlds', title: 'WORLD TOUR', blurb: 'Five worlds, one race each. Top 3 unlocks the next.', milestone: 'M3' },
  { feature: 'modes', title: 'TIME TRIAL', blurb: 'Race your ghost and the dev ghost for medals.', milestone: 'M8' },
];

/**
 * Where the app starts.
 * - `?autopilot=1` or `?seed=N` jump straight into a race (smoke test, Bonus Track).
 * - Without the `profiles` feature, the v1 flow: the race screen with the HUD's own start screen.
 * - Otherwise the profile picker, unless exactly one profile exists and is active.
 */
export function initialRoute(flags: Pick<UrlFlags, 'autopilot' | 'seed'>, features: Pick<FeatureSet, 'profiles'>, save: SaveData): Route {
  if (flags.autopilot || flags.seed !== null) return { name: 'race' };
  if (!features.profiles) return { name: 'race' };
  if (save.profiles.length === 1 && save.activeProfileId === save.profiles[0].id) return { name: 'menu' };
  return { name: 'profiles' };
}

/** Routes over which the in-race HUD is hidden (a menu screen owns the display). */
export function isMenuRoute(r: Route): boolean {
  return r.name !== 'race';
}
