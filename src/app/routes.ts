/**
 * App screens. `race` covers everything the in-race HUD shows (countdown, racing, pause, results); every
 * other route is a Preact screen drawn over the live menu backdrop (the next race waiting in 'title').
 */
import type { UrlFlags } from '../core/config';
import type { SaveData } from '../save/schema';

export type Route =
  | { name: 'profiles' }
  | { name: 'menu' }
  | { name: 'settings'; back: 'menu' | 'pause' }
  /** SOUND TEST (IMPLEMENTATION §M6a, with `music`): opened from Settings → Sound; back returns there. */
  | { name: 'soundtest'; back: 'menu' | 'pause' }
  | { name: 'garage'; back?: 'menu' | 'cup' }
  | { name: 'gp' }
  | { name: 'cup' }
  | { name: 'tour' }
  | { name: 'results' }
  | { name: 'trial' }
  | { name: 'loading' }
  | { name: 'race' };

export type RouteName = Route['name'];

/**
 * Where the app starts.
 * - `?autopilot=1` or `?seed=N` jump straight into a race (smoke test, Bonus Track).
 * - Otherwise the profile picker, unless exactly one profile exists and is active.
 */
export function initialRoute(flags: Pick<UrlFlags, 'autopilot' | 'seed'>, save: SaveData): Route {
  if (flags.autopilot || flags.seed !== null) return { name: 'race' };
  if (save.profiles.length === 1 && save.activeProfileId === save.profiles[0].id) return { name: 'menu' };
  return { name: 'profiles' };
}

/** Routes over which the in-race HUD is hidden (a menu screen owns the display). */
export function isMenuRoute(r: Route): boolean {
  return r.name !== 'race';
}
