import { describe, expect, it } from 'vitest';
import type { GameEvents, MenuEvents } from '../../core/events';
import { PRESETS } from '../sfx/presets';
import { V1_SOUNDS } from '../sfx/v1Sounds';
import { SILENT_EVENTS, SOUND_GROUPS, SOUND_RULES, TIMELINE_SOUNDS, WARNING_TWINS, rulesFor } from '../soundTable';

// Exhaustive by type: adding an event to GameEvents or MenuEvents fails the typecheck until it is listed here,
// and then this test fails until the event is in the sound table or in SILENT_EVENTS.
const GAME_EVENTS = {
  'race:state': true,
  'race:countdown': true,
  'race:lap': true,
  'race:finish': true,
  'race:results': true,
  'ship:railHit': true,
  'ship:shipHit': true,
  'ship:boost': true,
  'ship:dash': true,
  'ship:pit': true,
  'ship:lowEnergy': true,
  'ship:destroyed': true,
  'ship:respawn': true,
  'ship:ice': true,
  'ship:jump': true,
  'hazard:gate': true,
  'hazard:mine': true,
  'hazard:debris': true,
  'hazard:lightning': true,
  'hazard:geyser': true,
  'hazard:jet': true,
  'ship:wind': true,
  'ship:draft': true,
  'ship:land': true,
  'item:emp': true,
  'item:fail': true,
  'item:use': true,
  'item:warn': true,
  'item:shield': true,
  'economy:credits': true,
  'audio:mute': true,
} satisfies Record<keyof GameEvents, true>;

const MENU_EVENTS = {
  'results:tally': true,
  'results:total': true,
  'results:unlock': true,
  'results:trophy': true,
  'results:medal': true,
  'results:champion': true,
  'ui:locked': true,
  'tutorial:step': true,
  'tutorial:done': true,
  'shop:buy': true,
  'shop:equip': true,
  'shop:deny': true,
  'results:open': true,
} satisfies Record<keyof MenuEvents, true>;

const tabled = (kind: 'race' | 'menu', e: string) => SOUND_RULES.some((r) => r.source.kind === kind && r.source.event === e);

describe('the event-to-sound table (§M6.2)', () => {
  it('lists every race event, or names it silent', () => {
    const missing = Object.keys(GAME_EVENTS).filter((e) => !tabled('race', e) && !SILENT_EVENTS.includes(e));
    expect(missing).toEqual([]);
  });

  it('lists every menu event, or names it silent', () => {
    const missing = Object.keys(MENU_EVENTS).filter((e) => !tabled('menu', e) && !SILENT_EVENTS.includes(e));
    expect(missing).toEqual([]);
  });

  it('names no silent event that also has a row', () => {
    expect(SILENT_EVENTS.filter((e) => tabled('race', e) || tabled('menu', e))).toEqual([]);
  });

  it('uses only sound ids that exist, v1 rows only v1 recipes', () => {
    const exists = (id: string) => id in V1_SOUNDS || id in PRESETS;
    for (const r of SOUND_RULES) if (r.sound) expect(exists(r.sound), r.sound).toBe(true);
    for (const r of SOUND_RULES) if (r.since === 'v1' && r.sound) expect(r.sound in V1_SOUNDS, r.sound).toBe(true);
    for (const t of TIMELINE_SOUNDS) expect(exists(t.sound), t.sound).toBe(true);
  });

  it('gives every warning (priority 0) a visual or haptic twin (§M6.6)', () => {
    const warnings = [...SOUND_RULES.filter((r) => r.priority === 0).map((r) => r.sound), ...TIMELINE_SOUNDS.filter((t) => t.priority === 0).map((t) => t.sound)];
    expect(warnings.length).toBeGreaterThan(5);
    for (const w of warnings) expect(WARNING_TWINS[w!]?.visual, `${w} has no twin`).toBeTruthy();
  });

  it('plays the v1 rows with music off and lets an M6 row replace them with music on', () => {
    expect(rulesFor('race', 'hazard:geyser', false).map((r) => r.sound)).toEqual(['mine.blast']);
    expect(rulesFor('race', 'hazard:geyser', true).map((r) => r.sound)).toEqual(['geyser.hit']);
    expect(rulesFor('race', 'ship:jump', false)).toEqual([]);
    expect(rulesFor('race', 'ship:boost', true).map((r) => r.sound)).toEqual(['boost']);
    expect(rulesFor('menu', 'shop:deny', false)).toEqual([]);
  });

  it('lists every sound once in SOUND TEST', () => {
    const listed = SOUND_GROUPS.flatMap((g) => g.sounds.map((x) => x.id));
    expect(new Set(listed).size).toBe(listed.length);
    const used = new Set([...SOUND_RULES.map((r) => r.sound).filter((x) => x !== null), ...TIMELINE_SOUNDS.map((t) => t.sound), 'ice.crackle']);
    expect([...used].filter((id) => !listed.includes(id as never))).toEqual([]);
    expect(listed.filter((id) => !(id in V1_SOUNDS) && !(id in PRESETS))).toEqual([]);
  });
});
