/** World themes by world id. Worlds without their own theme yet (M4) fall back to Neon Bay. */
import type { FogUniforms } from '../shaders/fog';
import { NeonBayTheme } from './neonBay';
import { SunsetMesaTheme } from './sunsetMesa';
import type { ThemeFactory, WorldTheme } from './WorldTheme';

const THEMES: Record<string, ThemeFactory> = {
  'neon-bay': (fog) => new NeonBayTheme(fog),
  'sunset-mesa': (fog) => new SunsetMesaTheme(fog),
};

export function createTheme(worldId: string, fog: FogUniforms): WorldTheme {
  return (THEMES[worldId] ?? THEMES['neon-bay'])(fog);
}

export function hasTheme(worldId: string): boolean {
  return worldId in THEMES;
}

export type { WorldTheme } from './WorldTheme';
