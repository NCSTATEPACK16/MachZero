/**
 * The sequencer (IMPLEMENTATION §M6.4): step strings → note events, swing, and the voice count.
 */
import type { SongDef } from '../songs/format';
import { INSTRUMENTS, isDrum, releaseSeconds, resolveInstrument } from './instruments';

const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** A note name (C0..B8, sharps only) → MIDI number, or null. */
export function noteToMidi(tok: string): number | null {
  const m = /^([A-G])(#?)([0-8])$/.exec(tok);
  if (!m) return null;
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] ? 1 : 0);
}

export interface ParsedNote {
  step: number;
  /** MIDI numbers ([] for a drum hit). */
  midis: number[];
  velocity: number;
  /** Length in steps. */
  steps: number;
}

export const VELOCITY = 0.8;
export const ACCENT = 1;
const MAX_CHORD = 4;

/** Parse one track's step string. Errors name the pattern, the track, the step (1-based) and the token. */
export function parseSteps(steps: string, where: { pattern: string; track: string; drum: boolean }): { notes: ParsedNote[]; count: number; errors: string[] } {
  const toks = steps.trim().split(/\s+/).filter(Boolean);
  const notes: ParsedNote[] = [];
  const errors: string[] = [];
  const err = (i: number, why: string) => errors.push(`pattern ${where.pattern}, track ${where.track}, step ${i + 1}: ${why}`);
  let last: ParsedNote | null = null;
  toks.forEach((raw, i) => {
    if (raw === '.') {
      last = null;
      return;
    }
    if (raw === '-') {
      if (last) last.steps++;
      else err(i, 'a hold (-) with no note before it');
      return;
    }
    const accent = raw.endsWith('!');
    const tok = accent ? raw.slice(0, -1) : raw;
    if (where.drum) {
      if (raw === 'x' || raw === 'X') {
        last = { step: i, midis: [], velocity: raw === 'X' ? ACCENT : VELOCITY, steps: 1 };
        notes.push(last);
      } else err(i, `“${raw}” on a drum track (x, X, . and - only)`);
      return;
    }
    const parts = tok.split('+');
    const midis = parts.map(noteToMidi);
    if (parts.length > MAX_CHORD) err(i, `“${raw}” has more than ${MAX_CHORD} notes`);
    else if (midis.some((m) => m === null)) err(i, `“${raw}” is not a note (C0..B8, sharps only)`);
    else {
      last = { step: i, midis: midis as number[], velocity: accent ? ACCENT : VELOCITY, steps: 1 };
      notes.push(last);
      return;
    }
    last = null;
  });
  return { notes, count: toks.length, errors };
}

export interface NoteEvent {
  /** Seconds from the part's start (swing applied). */
  time: number;
  /** The step (16th) from the part's start, and the swing offset in steps. */
  step: number;
  swing: number;
  midi: number;
  velocity: number;
  /** Seconds and steps the note is written to last. */
  length: number;
  steps: number;
  track: string;
  /** The previous note on the same track (glide), or null. */
  prev: number | null;
}

/** Seconds per step (a 16th) at `bpm`. */
export const stepSeconds = (bpm: number): number => 60 / bpm / 4;

/** The steps a pattern lasts (its longest track; the validator holds every track to the same length). */
export function patternSteps(def: SongDef, name: string): number {
  const p = def.patterns[name];
  if (!p) return 0;
  let n = 0;
  for (const s of Object.values(p)) if (s) n = Math.max(n, s.trim().split(/\s+/).filter(Boolean).length);
  return n;
}

/** The intro's or the loop's note events in time order, its length in steps, and any parse errors. */
export function sequence(def: SongDef, part: 'intro' | 'loop'): { events: NoteEvent[]; steps: number; errors: string[] } {
  const events: NoteEvent[] = [];
  const errors: string[] = [];
  const st = stepSeconds(def.bpm);
  const swing = def.swing ?? 0;
  const prev = new Map<string, number>();
  let at = 0;
  for (const name of part === 'intro' ? def.intro : def.loop) {
    const pattern = def.patterns[name];
    if (!pattern) {
      errors.push(`pattern ${name} does not exist`);
      continue;
    }
    for (const [track, steps] of Object.entries(pattern)) {
      const t = def.tracks[track];
      if (!t || !steps) {
        if (!t) errors.push(`pattern ${name}: track ${track} is not in tracks`);
        continue;
      }
      const r = parseSteps(steps, { pattern: name, track, drum: isDrum(t.instrument) });
      errors.push(...r.errors);
      for (const n of r.notes) {
        const step = at + n.step;
        const sw = step % 2 === 1 ? swing : 0;
        for (const midi of n.midis.length ? n.midis : [60]) {
          events.push({ time: (step + sw) * st, step, swing: sw, midi, velocity: n.velocity, length: n.steps * st, steps: n.steps, track, prev: n.midis.length === 1 ? (prev.get(track) ?? null) : null });
        }
        if (n.midis.length === 1) prev.set(track, n.midis[0]);
      }
    }
    at += patternSteps(def, name);
  }
  events.sort((a, b) => a.step - b.step || (a.track < b.track ? -1 : a.track > b.track ? 1 : a.midi - b.midi));
  return { events, steps: at, errors };
}

/**
 * The most voices sounding at once (§M6.4: ≤ 24), each from its start to the end of its release, over the intro,
 * then the loop twice (so a loop's end overlapping its own start counts).
 */
export function countVoices(def: SongDef): number {
  const st = stepSeconds(def.bpm);
  const intro = sequence(def, 'intro');
  const loop = sequence(def, 'loop');
  const spans: Array<[number, number]> = [];
  const add = (events: NoteEvent[], offset: number) => {
    for (const e of events) {
      const t = def.tracks[e.track];
      if (!t || !INSTRUMENTS[t.instrument]) continue;
      const inst = resolveInstrument(t.instrument, t.params);
      const held = inst.kind === 'drum' ? 0 : e.length * (inst.p.gate ?? 0.9);
      spans.push([offset + e.time, offset + e.time + held + releaseSeconds(inst)]);
    }
  };
  add(intro.events, 0);
  for (let pass = 0; pass < 2; pass++) add(loop.events, (intro.steps + pass * loop.steps) * st);
  const edges: Array<[number, number]> = [];
  for (const [a, b] of spans) edges.push([a, 1], [b, -1]);
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let n = 0;
  let max = 0;
  for (const [, d] of edges) {
    n += d;
    max = Math.max(max, n);
  }
  return max;
}
