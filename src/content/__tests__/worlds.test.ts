import { describe, expect, it } from 'vitest';
import { CUPS, availableCups } from '../cups';
import { TRACK_DEFS } from '../tracks';
import { WORLDS, worldById, worldsFor } from '../worlds';
import { hasTheme } from '../../graphics/themes';

describe('worlds', () => {
  it('lists the five 2.0 worlds, then the 2.1 expansion worlds, in order', () => {
    expect(WORLDS.map((w) => w.order)).toEqual(WORLDS.map((_, i) => i + 1));
    expect(WORLDS.slice(0, 5).some((w) => w.expansion)).toBe(false);
    expect(WORLDS.slice(5).every((w) => w.expansion)).toBe(true);
    expect(WORLDS[5].id).toBe('tempest-spire');
  });

  it('every built world has its authored track and a theme of its own (never Neon Bay by fallback)', () => {
    for (const w of WORLDS.filter((x) => x.built)) {
      expect(TRACK_DEFS[w.trackId]?.worldId, w.id).toBe(w.id);
      expect(hasTheme(w.id), w.id).toBe(true);
    }
  });

  it('the menus hide the expansion worlds while the flag is off, and show every world with it on', () => {
    const off = worldsFor({ expansion: false });
    expect(off.map((w) => w.id)).toEqual(['neon-bay', 'sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring']);
    expect(worldsFor({ expansion: true })).toEqual(WORLDS);
    // The world itself stays known, so ?world=tempest-spire and a saved world still resolve.
    expect(worldById('tempest-spire')?.built).toBe(true);
  });

  it('a cup with an expansion world is not offered while the flag is off', () => {
    const allBuilt = [...WORLDS, { id: 'cinder-forge', built: true, expansion: true as const }, { id: 'abyss-line', built: true, expansion: true as const }];
    const storm = CUPS.find((c) => c.id === 'storm')!;
    expect(availableCups(allBuilt)).toContain(storm);
    expect(availableCups(allBuilt.filter((w) => !('expansion' in w && w.expansion)))).not.toContain(storm);
    expect(availableCups(worldsFor({ expansion: false })).map((c) => c.id)).toEqual(['neon']);
  });
});
