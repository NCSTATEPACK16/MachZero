import { describe, expect, it } from 'vitest';
import { createProfile, emptySave } from '../../save/schema';
import { initialRoute, isMenuRoute } from '../routes';

const noFlags = { autopilot: false, seed: null };
const on = { profiles: true };

describe('initialRoute', () => {
  it('autopilot and ?seed go straight to a race', () => {
    expect(initialRoute({ autopilot: true, seed: null }, on, emptySave())).toEqual({ name: 'race' });
    expect(initialRoute({ autopilot: false, seed: 7 }, on, emptySave())).toEqual({ name: 'race' });
  });

  it('without the profiles feature the v1 start screen (race route) is used', () => {
    expect(initialRoute(noFlags, { profiles: false }, emptySave())).toEqual({ name: 'race' });
  });

  it('asks for a profile when there is none, or several', () => {
    expect(initialRoute(noFlags, on, emptySave())).toEqual({ name: 'profiles' });
    const s = emptySave();
    s.profiles.push(createProfile('a', 0, 'rookie'), createProfile('b', 1, 'classic'));
    s.activeProfileId = s.profiles[0].id;
    expect(initialRoute(noFlags, on, s)).toEqual({ name: 'profiles' });
  });

  it('skips the picker for a single active profile', () => {
    const s = emptySave();
    s.profiles.push(createProfile('solo', 0, 'rookie'));
    s.activeProfileId = s.profiles[0].id;
    expect(initialRoute(noFlags, on, s)).toEqual({ name: 'menu' });
  });

  it('only the race route shows the in-race HUD', () => {
    expect(isMenuRoute({ name: 'race' })).toBe(false);
    expect(isMenuRoute({ name: 'menu' })).toBe(true);
    expect(isMenuRoute({ name: 'settings', back: 'pause' })).toBe(true);
  });
});
