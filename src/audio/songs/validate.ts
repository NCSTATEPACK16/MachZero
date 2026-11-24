/**
 * The song validator (IMPLEMENTATION §M6.4): `validateSong(def)` returns every problem it finds (empty when valid).
 */
import { INSTRUMENTS, isDrum } from '../dsp/instruments';
import { countVoices, parseSteps, patternSteps, sequence, stepSeconds } from '../dsp/sequence';
import { kindOf, STINGER_IDS, STINGER_SECONDS, type SongDef, type StingerId } from './format';

export const MAX_VOICES = 24;
/** World songs and the menu theme loop for 60–80 s (§M6, the correction: seconds win over bars). */
export const LOOP_SECONDS: readonly [number, number] = [60, 80];
export const MAX_INTRO_BARS = 8;
/** The menu theme's intro (its table row: 2 bars), with room to spare. */
export const MAX_MENU_INTRO_BARS = 4;
export const RESULTS_LOOP_BARS = 16;
export const STINGER_TOLERANCE = 0.25;

export function validateSong(def: SongDef): string[] {
  const errs: string[] = [];
  const kind = kindOf(def.id);
  if (!(def.bpm >= 80 && def.bpm <= 160)) errs.push(`bpm ${def.bpm} is outside 80–160`);
  if (def.swing !== undefined && !(def.swing >= 0 && def.swing <= 0.3)) errs.push(`swing ${def.swing} is outside 0–0.3`);

  // Tracks.
  for (const [name, t] of Object.entries(def.tracks)) {
    if (!INSTRUMENTS[t.instrument]) {
      errs.push(`track ${name}: no instrument ${t.instrument}`);
      continue;
    }
    if (!(t.gain >= 0 && t.gain <= 1)) errs.push(`track ${name}: gain ${t.gain} is outside 0–1`);
    if (t.pan !== undefined && !(t.pan >= -1 && t.pan <= 1)) errs.push(`track ${name}: pan ${t.pan} is outside −1–1`);
    for (const send of ['delay', 'reverb'] as const) if (t[send] !== undefined && !(t[send]! >= 0 && t[send]! <= 1)) errs.push(`track ${name}: ${send} ${t[send]} is outside 0–1`);
    if (t.pump) {
      const by = def.tracks[t.pump.by];
      if (!by || !isDrum(by.instrument)) errs.push(`track ${name}: pump by ${t.pump.by}, which is not a drum track`);
    }
  }

  // Patterns: every token parses, notes in range, every track exists, every track the same whole number of bars.
  for (const [pname, pattern] of Object.entries(def.patterns)) {
    let bars: number | null = null;
    for (const [tname, steps] of Object.entries(pattern)) {
      const t = def.tracks[tname];
      if (!t) {
        errs.push(`pattern ${pname}: track ${tname} is not in tracks`);
        continue;
      }
      if (steps === undefined || !INSTRUMENTS[t.instrument]) continue;
      const r = parseSteps(steps, { pattern: pname, track: tname, drum: isDrum(t.instrument) });
      errs.push(...r.errors);
      const [lo, hi] = INSTRUMENTS[t.instrument].range;
      for (const n of r.notes) for (const m of n.midis) if (m < lo || m > hi) errs.push(`pattern ${pname}, track ${tname}, step ${n.step + 1}: MIDI ${m} is outside ${t.instrument}'s range ${lo}–${hi}`);
      if (r.count % 16 !== 0) errs.push(`pattern ${pname}, track ${tname}: ${r.count} steps is not a whole number of bars`);
      const b = r.count / 16;
      if (bars === null) bars = b;
      else if (b !== bars) errs.push(`pattern ${pname}: track ${tname} has ${b} bars, another track ${bars}`);
    }
  }
  for (const name of [...def.intro, ...def.loop]) if (!def.patterns[name]) errs.push(`pattern ${name} (in the ${def.intro.includes(name) ? 'intro' : 'loop'}) does not exist`);
  if (errs.length) return errs;

  // Lengths.
  const st = stepSeconds(def.bpm);
  const introBars = def.intro.reduce((s, p) => s + patternSteps(def, p), 0) / 16;
  const loopBars = def.loop.reduce((s, p) => s + patternSteps(def, p), 0) / 16;
  const loopSec = loopBars * 16 * st;
  const introSec = introBars * 16 * st;
  if (kind === 'world' || kind === 'menu') {
    if (loopSec < LOOP_SECONDS[0] || loopSec > LOOP_SECONDS[1]) errs.push(`the loop lasts ${loopSec.toFixed(1)} s (${loopBars} bars); it must last ${LOOP_SECONDS[0]}–${LOOP_SECONDS[1]} s`);
    const maxIntro = kind === 'menu' ? MAX_MENU_INTRO_BARS : MAX_INTRO_BARS;
    if (introBars > maxIntro) errs.push(`the intro has ${introBars} bars; at most ${maxIntro}`);
  } else if (kind === 'results') {
    if (loopBars !== RESULTS_LOOP_BARS) errs.push(`the results theme loops ${loopBars} bars; it must loop ${RESULTS_LOOP_BARS}`);
  } else {
    const want = STINGER_SECONDS[def.id as StingerId];
    if (def.loop.length) errs.push('a stinger has no loop');
    if (Math.abs(introSec - want) > STINGER_TOLERANCE) errs.push(`the stinger lasts ${introSec.toFixed(2)} s; it must last ${want} ± ${STINGER_TOLERANCE} s`);
  }
  if (!(STINGER_IDS as readonly string[]).includes(def.id) && def.loop.length === 0) errs.push('the song has no loop');

  // Voices and the lift.
  const voices = countVoices(def);
  if (voices > MAX_VOICES) errs.push(`${voices} voices sound at once; at most ${MAX_VOICES}`);
  const lifts = Object.entries(def.tracks).filter(([, t]) => t.lift);
  if (kind === 'world' && lifts.length === 0) errs.push('a world song needs at least one lift track');
  if (kind !== 'world' && lifts.length) errs.push(`only world songs have a lift (tracks ${lifts.map(([n]) => n).join(', ')})`);
  if (kind === 'world') {
    const loop = sequence(def, 'loop');
    if (!lifts.some(([n]) => loop.events.some((e) => e.track === n))) errs.push('the lift tracks play no note in the loop');
  }
  return errs;
}
