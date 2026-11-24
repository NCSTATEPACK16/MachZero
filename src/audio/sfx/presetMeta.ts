/**
 * The M6 presets' playback data (IMPLEMENTATION §M6a): their ids and levels. Kept apart from the recipes
 * (`presets.ts`), which only the render Worker and the main-thread fallback (a lazy chunk) need, so the page itself does
 * not carry the synthesis code. `presets.test` checks both files name the same presets.
 */
export const PRESET_LEVELS = {
  respawn: 0.22,
  'jump.launch': 0.35,
  'jump.land': 0.5,
  'ice.crackle': 0.16,
  'wind.gust': 0.32,
  'gate.hit': 0.55,
  'debris.hit': 0.45,
  'lightning.hit': 0.45,
  'geyser.hit': 0.5,
  'jet.hit': 0.5,
  'gate.rumble': 0.3,
  'lightning.charge': 0.2,
  'lightning.bolt': 0.6,
  'geyser.rumble': 0.32,
  'geyser.erupt': 0.55,
  'jet.hiss': 0.22,
  'jet.fire': 0.55,
  'ui.move': 0.12,
  'ui.confirm': 0.16,
  'ui.back': 0.15,
  'ui.slider': 0.1,
  'ui.tab': 0.14,
  'ui.locked': 0.22,
  'ui.buy': 0.2,
  'ui.equip': 0.25,
  'ui.deny': 0.18,
  'ui.tally': 0.12,
  'ui.coin': 0.2,
  'ui.tutorial': 0.16,
  'ui.sparkle': 0.15,
} as const;

export type PresetId = keyof typeof PRESET_LEVELS;
export const PRESET_IDS = Object.keys(PRESET_LEVELS) as PresetId[];
