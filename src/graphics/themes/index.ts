/**
 * World themes by world id. A world whose look is not built yet (its concept image has not arrived, IMPLEMENTATION
 * §X) runs on the placeholder theme; an unknown id falls back to Neon Bay.
 */
import type { FogUniforms } from '../shaders/fog';
import { NeonBayTheme } from './neonBay';
import { SunsetMesaTheme } from './sunsetMesa';
import { CryoStationTheme } from './cryoStation';
import { JadeRuinsTheme } from './jadeRuins';
import { OrbitalRingTheme } from './orbitalRing';
import { PlaceholderTheme } from './placeholder';
import type { ThemeFactory, WorldTheme } from './WorldTheme';

const THEMES: Record<string, ThemeFactory> = {
  'neon-bay': (fog) => new NeonBayTheme(fog),
  'sunset-mesa': (fog) => new SunsetMesaTheme(fog),
  'cryo-station': (fog) => new CryoStationTheme(fog),
  'jade-ruins': (fog) => new JadeRuinsTheme(fog),
  'orbital-ring': (fog) => new OrbitalRingTheme(fog),
  // Placeholder until assets/reference/worlds/tempest-spire/chosen.jpg arrives (IMPLEMENTATION §X4 step 8).
  'tempest-spire': (fog) => new PlaceholderTheme('tempest-spire', fog),
  // Placeholder until assets/reference/worlds/cinder-forge/chosen.jpg arrives (IMPLEMENTATION §X5 step 8).
  'cinder-forge': (fog) => new PlaceholderTheme('cinder-forge', fog),
};

export function createTheme(worldId: string, fog: FogUniforms): WorldTheme {
  return (THEMES[worldId] ?? THEMES['neon-bay'])(fog);
}

export function hasTheme(worldId: string): boolean {
  return worldId in THEMES;
}

export type { WorldTheme } from './WorldTheme';
