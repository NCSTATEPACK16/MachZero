/**
 * The event-to-sound table (IMPLEMENTATION §M6.2) as data. `RaceSounds` and `MenuSounds` look up which sound an event
 * plays here; the tests check that every event is either in the table or in SILENT_EVENTS, that every sound id exists,
 * and that every warning (priority 0) has its visual or haptic twin (§M6.6).
 *
 * `since: 'v1'` rows play with `music` off and on; `'M6'` rows only with `music` on, and an M6 row for an event
 * replaces the v1 row for it.
 */
import type { GameEvents, MenuEvents } from '../core/events';
import { PRESETS, type PresetId } from './sfx/presets';
import { V1_SOUNDS, type V1SoundId } from './sfx/v1Sounds';
import type { Priority } from './VoicePool';

export type SoundId = V1SoundId | PresetId;
export type UiSoundKind = 'move' | 'confirm' | 'back' | 'slider' | 'tab';
export type SoundBus = 'sfx' | 'ui' | 'music';
/** `player`: only the player's own events; `near`: the player or a ship within hearing range (panned). */
export type Who = 'player' | 'near';
export type Since = 'v1' | 'M6';

export type SoundSource = { kind: 'race'; event: keyof GameEvents } | { kind: 'menu'; event: keyof MenuEvents } | { kind: 'ui'; event: UiSoundKind };

export interface SoundRule {
  source: SoundSource;
  /** The sound, or null for an event handled without a one-shot (a continuous voice, a stinger, a fade). */
  sound: SoundId | null;
  who: Who;
  /** Priority for the player's own sound; a `near` sound from another ship plays at 2. */
  priority: Priority;
  since: Since;
  bus: SoundBus;
  /** Which variant of the event (the row's condition in §M6.2), when an event has several rows. */
  when?: string;
}

const race = (event: keyof GameEvents, sound: SoundId | null, who: Who, priority: Priority, since: Since, when?: string): SoundRule => ({
  source: { kind: 'race', event },
  sound,
  who,
  priority,
  since,
  bus: 'sfx',
  when,
});
const menu = (event: keyof MenuEvents, sound: SoundId | null, priority: Priority, bus: SoundBus = 'ui'): SoundRule => ({
  source: { kind: 'menu', event },
  sound,
  who: 'player',
  priority,
  since: 'M6',
  bus,
});
const ui = (event: UiSoundKind, sound: SoundId): SoundRule => ({ source: { kind: 'ui', event }, sound, who: 'player', priority: 3, since: 'M6', bus: 'ui' });

export const SOUND_RULES: readonly SoundRule[] = [
  race('race:countdown', 'countdown.beep', 'player', 0, 'v1', '3, 2, 1'),
  race('race:countdown', 'countdown.go', 'player', 0, 'v1', '0'),
  race('race:lap', 'lap.chime', 'player', 1, 'v1', 'not the final lap'),
  race('race:lap', 'lap.final', 'player', 1, 'v1', 'the final lap begins'),
  race('race:finish', 'finish.fanfare', 'player', 1, 'v1'),
  race('ship:boost', 'boost', 'near', 1, 'v1'),
  race('ship:dash', 'dash', 'near', 1, 'v1'),
  race('ship:draft', 'draft.whoosh', 'player', 3, 'v1', 'active'),
  race('ship:railHit', 'hit.rail', 'near', 1, 'v1'),
  race('ship:shipHit', 'hit.ship', 'near', 1, 'v1'),
  race('ship:pit', 'pit.enter', 'player', 1, 'v1', 'active'),
  race('ship:lowEnergy', 'alarm.energy', 'player', 0, 'v1'),
  race('ship:destroyed', 'ko', 'near', 1, 'v1'),
  race('ship:respawn', 'respawn', 'player', 1, 'M6'),
  race('ship:jump', 'jump.launch', 'near', 1, 'M6'),
  race('ship:land', 'jump.land', 'near', 1, 'M6', 'intensity ≥ 0.15'),
  race('ship:ice', null, 'player', 1, 'M6', 'ice.crackle (continuous)'),
  race('ship:wind', 'wind.gust', 'player', 1, 'M6', 'active'),
  race('hazard:gate', 'gate.hit', 'near', 1, 'M6'),
  race('hazard:debris', 'debris.hit', 'near', 1, 'M6'),
  race('hazard:mine', 'mine.blast', 'near', 1, 'v1'),
  race('hazard:lightning', 'lightning.hit', 'near', 1, 'M6'),
  race('hazard:geyser', 'mine.blast', 'near', 1, 'v1'),
  race('hazard:geyser', 'geyser.hit', 'near', 1, 'M6'),
  race('hazard:jet', 'mine.blast', 'near', 1, 'v1'),
  race('hazard:jet', 'jet.hit', 'near', 1, 'M6'),
  race('item:use', 'shield.up', 'near', 1, 'v1', 'shield'),
  race('item:use', 'mine.drop', 'near', 1, 'v1', 'mine'),
  race('item:emp', 'emp.fire', 'near', 1, 'v1', 'at the firer'),
  race('item:emp', 'emp.hit', 'near', 1, 'v1', 'at the target'),
  race('item:shield', 'shield.block', 'near', 1, 'v1'),
  race('item:warn', 'alarm.emp', 'player', 0, 'v1', 'target = player'),
  race('item:fail', 'item.fail', 'player', 1, 'v1'),

  ui('move', 'ui.move'),
  ui('confirm', 'ui.confirm'),
  ui('back', 'ui.back'),
  ui('slider', 'ui.slider'),
  ui('tab', 'ui.tab'),
  menu('ui:locked', 'ui.locked', 3),
  menu('shop:buy', 'ui.buy', 1),
  menu('shop:equip', 'ui.equip', 1),
  menu('shop:deny', 'ui.deny', 1),
  menu('results:open', null, 1, 'music'),
  menu('results:tally', 'ui.tally', 1),
  menu('results:total', 'ui.coin', 1),
  menu('results:unlock', null, 1, 'music'),
  menu('results:trophy', null, 1, 'music'),
  menu('results:medal', null, 1, 'music'),
  menu('results:champion', null, 1, 'music'),
  menu('tutorial:step', 'ui.tutorial', 1),
  menu('tutorial:done', 'ui.sparkle', 1),
];

/**
 * Events that make no sound of their own, on purpose. `race:state` drives the pause fade of the race sounds and (from
 * M6b) the music's muffle, not a one-shot.
 */
export const SILENT_EVENTS: readonly string[] = ['race:state', 'race:results', 'economy:credits', 'audio:mute'];

export interface TimelineSound {
  sound: PresetId | V1SoundId;
  hazard: 'mine' | 'gate' | 'lightning' | 'geyser' | 'jet';
  /** `warning`: a telegraph while the warning runs; `start`: a one-shot as the hazard goes off. */
  on: 'warning' | 'start';
  /** Metres within which it sounds (ahead of the player for warnings). */
  range: number;
  who: Who;
  priority: Priority;
  /** A continuous voice whose level and pitch follow the warning (not in the pool). */
  continuous: boolean;
}

/** Sounds read from the hazard timelines (§M6.2), no event. */
export const TIMELINE_SOUNDS: readonly TimelineSound[] = [
  { sound: 'mine.beep', hazard: 'mine', on: 'warning', range: 70, who: 'player', priority: 0, continuous: false },
  { sound: 'gate.rumble', hazard: 'gate', on: 'warning', range: 80, who: 'player', priority: 0, continuous: false },
  { sound: 'lightning.charge', hazard: 'lightning', on: 'warning', range: 80, who: 'player', priority: 0, continuous: true },
  { sound: 'lightning.bolt', hazard: 'lightning', on: 'start', range: 120, who: 'near', priority: 1, continuous: false },
  { sound: 'geyser.rumble', hazard: 'geyser', on: 'warning', range: 80, who: 'player', priority: 0, continuous: true },
  { sound: 'geyser.erupt', hazard: 'geyser', on: 'start', range: 100, who: 'near', priority: 1, continuous: false },
  { sound: 'jet.hiss', hazard: 'jet', on: 'warning', range: 80, who: 'player', priority: 0, continuous: true },
  { sound: 'jet.fire', hazard: 'jet', on: 'start', range: 100, who: 'near', priority: 1, continuous: false },
];

/** §M6.6: every warning sound (priority 0) and what tells the same thing without sound. */
export const WARNING_TWINS: Readonly<Record<string, { visual: string; haptic?: string }>> = {
  'countdown.beep': { visual: 'The 3-2-1-GO numbers' },
  'countdown.go': { visual: 'The 3-2-1-GO numbers' },
  'alarm.emp': { visual: '"⚠ EMP INCOMING" on the HUD (shown with no items since M6a)', haptic: 'iOS heavy tap' },
  'alarm.energy': { visual: "The energy bar's low-energy flash" },
  'mine.beep': { visual: 'The mine on the road; the hazard cue in colour-blind mode' },
  'gate.rumble': { visual: 'The gate closing; the hazard cue' },
  'lightning.charge': { visual: 'The glowing circle on the deck; the hazard cue' },
  'geyser.rumble': { visual: "The vent's glow; the hazard cue" },
  'jet.hiss': { visual: 'The bubble stream; the hazard cue' },
  'item.fail': { visual: 'The item chip (empty)' },
};

export const isV1Sound = (id: string): id is V1SoundId => id in V1_SOUNDS;
export const isPreset = (id: string): id is PresetId => id in PRESETS;

/** The rule an event plays: the M6 row when `modern` (music on) and there is one, else the v1 row. */
export function rulesFor(kind: SoundSource['kind'], event: string, modern: boolean): SoundRule[] {
  const rows = SOUND_RULES.filter((r) => r.source.kind === kind && r.source.event === event);
  if (!modern) return rows.filter((r) => r.since === 'v1');
  const m6 = rows.filter((r) => r.since === 'M6');
  return m6.length > 0 ? m6 : rows;
}

/** Every sound's name in SOUND TEST and the PR's listening checklist, grouped as SOUND TEST shows them. */
export const SOUND_GROUPS: ReadonlyArray<{ title: string; sounds: ReadonlyArray<{ id: SoundId; name: string }> }> = [
  {
    title: 'RACE',
    sounds: [
      { id: 'countdown.beep', name: 'Countdown 3-2-1' },
      { id: 'countdown.go', name: 'Countdown GO' },
      { id: 'lap.chime', name: 'Lap' },
      { id: 'lap.final', name: 'Final lap' },
      { id: 'finish.fanfare', name: 'Finish' },
      { id: 'boost', name: 'Boost' },
      { id: 'dash', name: 'Dash pad' },
      { id: 'draft.whoosh', name: 'Slipstream' },
      { id: 'hit.rail', name: 'Rail hit' },
      { id: 'hit.ship', name: 'Ship hit' },
      { id: 'pit.enter', name: 'Pit' },
      { id: 'alarm.energy', name: 'Low energy' },
      { id: 'ko', name: 'Knock-out' },
      { id: 'respawn', name: 'Respawn' },
      { id: 'jump.launch', name: 'Jump' },
      { id: 'jump.land', name: 'Landing' },
      { id: 'ice.crackle', name: 'Ice (loop)' },
      { id: 'wind.gust', name: 'Crosswind gust' },
      { id: 'shield.up', name: 'Shield up' },
      { id: 'mine.drop', name: 'Mine dropped' },
      { id: 'emp.fire', name: 'EMP fired' },
      { id: 'emp.hit', name: 'EMP hit' },
      { id: 'shield.block', name: 'Shield block' },
      { id: 'alarm.emp', name: 'EMP incoming' },
      { id: 'item.fail', name: 'Item empty' },
    ],
  },
  {
    title: 'HAZARDS',
    sounds: [
      { id: 'mine.beep', name: 'Mine ahead' },
      { id: 'mine.blast', name: 'Mine blast' },
      { id: 'gate.rumble', name: 'Gate closing' },
      { id: 'gate.hit', name: 'Gate hit' },
      { id: 'debris.hit', name: 'Debris hit' },
      { id: 'lightning.charge', name: 'Lightning charging (loop)' },
      { id: 'lightning.bolt', name: 'Lightning bolt' },
      { id: 'lightning.hit', name: 'Lightning hit' },
      { id: 'geyser.rumble', name: 'Geyser rumbling (loop)' },
      { id: 'geyser.erupt', name: 'Geyser erupts' },
      { id: 'geyser.hit', name: 'Geyser hit' },
      { id: 'jet.hiss', name: 'Jet hissing (loop)' },
      { id: 'jet.fire', name: 'Jet fires' },
      { id: 'jet.hit', name: 'Jet hit' },
    ],
  },
  {
    title: 'MENUS',
    sounds: [
      { id: 'ui.move', name: 'Move' },
      { id: 'ui.confirm', name: 'Confirm' },
      { id: 'ui.back', name: 'Back' },
      { id: 'ui.slider', name: 'Slider' },
      { id: 'ui.tab', name: 'Tab' },
      { id: 'ui.locked', name: 'Locked' },
      { id: 'ui.buy', name: 'Buy' },
      { id: 'ui.equip', name: 'Equip' },
      { id: 'ui.deny', name: 'Not enough credits' },
      { id: 'ui.tally', name: 'Results tally' },
      { id: 'ui.coin', name: 'Results total' },
      { id: 'ui.tutorial', name: 'Tutorial step' },
      { id: 'ui.sparkle', name: 'Tutorial done' },
    ],
  },
];
