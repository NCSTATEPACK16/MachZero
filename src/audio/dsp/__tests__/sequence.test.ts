import { describe, expect, it } from 'vitest';
import type { SongDef } from '../../songs/format';
import { countVoices, noteToMidi, parseSteps, sequence } from '../sequence';

const bar = (s: string) => s.trim().split(/\s+/).join(' ');

function song(tracks: Record<string, string>, extra: Partial<SongDef> = {}): SongDef {
  return {
    id: 'neon-bay',
    title: 'TEST',
    bpm: 120,
    key: 'A minor',
    tracks: {
      lead: { instrument: 'saw-lead', gain: 0.5 },
      pad: { instrument: 'saw-pad', gain: 0.5 },
      hat: { instrument: 'hat', gain: 0.5 },
    },
    patterns: { A: tracks },
    intro: [],
    loop: ['A'],
    fx: { delay: { beats: 0.75, feedback: 0.3, tone: 3000 }, reverb: { size: 0.5, damp: 0.5 } },
    ...extra,
  };
}

describe('note names', () => {
  it('maps names to MIDI (C4 = 60, sharps only, C0..B8)', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('C#4')).toBe(61);
    expect(noteToMidi('C0')).toBe(12);
    expect(noteToMidi('B8')).toBe(119);
    expect(noteToMidi('Db4')).toBeNull();
    expect(noteToMidi('C9')).toBeNull();
    expect(noteToMidi('H2')).toBeNull();
  });
});

describe('step strings', () => {
  it('a one-bar string with 4 notes gives 4 events at the right times at 120 BPM (a step is 0.125 s)', () => {
    const { events, errors } = sequence(song({ lead: bar('A3 . . . C4 . . . E4 . . . A4 . . .') }), 'loop');
    expect(errors).toEqual([]);
    expect(events.map((e) => e.time)).toEqual([0, 0.5, 1, 1.5]);
    expect(events.map((e) => e.midi)).toEqual([57, 60, 64, 69]);
    expect(events.every((e) => e.length === 0.125 && e.velocity === 0.8 && e.track === 'lead')).toBe(true);
  });

  it('`-` extends a note’s length', () => {
    const { events } = sequence(song({ lead: bar('A3 - - - C4 - . . E4 . . . . . . .') }), 'loop');
    expect(events.map((e) => e.length)).toEqual([0.5, 0.25, 0.125]);
  });

  it('a chord gives one event per note', () => {
    const { events } = sequence(song({ pad: bar('A3+C4+E4 - - - . . . . . . . . . . . .') }), 'loop');
    expect(events.map((e) => e.midi)).toEqual([57, 60, 64]);
    expect(events.every((e) => e.time === 0 && e.length === 0.5)).toBe(true);
  });

  it('swing 0.2 moves only the odd 16ths, by 0.2 steps', () => {
    const { events } = sequence(song({ hat: bar('x x x x . . . . . . . . . . . .') }, { swing: 0.2 }), 'loop');
    expect(events.map((e) => +e.time.toFixed(6))).toEqual([0, 0.15, 0.25, 0.4]);
  });

  it('an accent gives velocity 1', () => {
    const { events } = sequence(song({ lead: bar('A3! . . . . . . . . . . . . . . .'), hat: bar('X x . . . . . . . . . . . . . .') }), 'loop');
    expect(events.find((e) => e.track === 'lead')!.velocity).toBe(1);
    expect(events.filter((e) => e.track === 'hat').map((e) => e.velocity)).toEqual([1, 0.8]);
  });

  it('a bad token is an error naming the pattern, track and step', () => {
    const r = parseSteps(bar('A3 . . . Q9 . . . . . . . . . . .'), { pattern: 'A', track: 'lead', drum: false });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/pattern A/);
    expect(r.errors[0]).toMatch(/track lead/);
    expect(r.errors[0]).toMatch(/step 5/);
    expect(r.errors[0]).toMatch(/Q9/);
  });

  it('drum tracks take x, X, . and - only; note tracks take no x', () => {
    expect(parseSteps('x . A3 .', { pattern: 'A', track: 'hat', drum: true }).errors[0]).toMatch(/A3/);
    expect(parseSteps('x . . .', { pattern: 'A', track: 'lead', drum: false }).errors[0]).toMatch(/x/);
  });

  it('a chord has at most 4 notes, and a hold needs a note before it', () => {
    expect(parseSteps('A3+C4+E4+G4+B4 . . .', { pattern: 'A', track: 'pad', drum: false }).errors).toHaveLength(1);
    expect(parseSteps('- . . .', { pattern: 'A', track: 'pad', drum: false }).errors[0]).toMatch(/hold/);
  });

  it('the loop’s patterns follow each other, and a missing track rests', () => {
    const def = song({ lead: bar('A3 . . . . . . . . . . . . . . .') });
    def.patterns.B = { hat: bar('x . . . . . . . . . . . . . . .') };
    def.loop = ['A', 'B', 'A'];
    const { events, steps } = sequence(def, 'loop');
    expect(steps).toBe(48);
    expect(events.map((e) => [e.track, e.step])).toEqual([
      ['lead', 0],
      ['hat', 16],
      ['lead', 32],
    ]);
  });

  it('each note knows the previous note on its track (glide)', () => {
    const { events } = sequence(song({ lead: bar('A3 . C4 . E4 . . . . . . . . . . .') }), 'loop');
    expect(events.map((e) => e.prev)).toEqual([null, 57, 60]);
  });
});

describe('voices', () => {
  it('counts the notes sounding at once, each until the end of its release', () => {
    const def = song({ pad: bar('A3+C4+E4 - - - . . . . . . . . . . . .'), lead: bar('A4 . . . . . . . . . . . . . . .') });
    // The pad's release (1 s) is still sounding when the lead starts? No: the lead starts with the pad.
    expect(countVoices(def)).toBe(4);
  });
});
