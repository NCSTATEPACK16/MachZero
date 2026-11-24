import { describe, expect, it } from 'vitest';
import type { SongDef } from '../format';
import { validateSong } from '../validate';

const rest = (bars: number) => Array(16 * bars).fill('.').join(' ');
const hits = (bars: number) => Array(4 * bars).fill('x . . .').join(' ');
const notes = (bars: number, n = 'A3') => Array(4 * bars).fill(`${n} . . .`).join(' ');

/** A valid world song: 118 BPM, a 4-bar intro, a 32-bar loop (65.1 s), a lift track. */
function world(): SongDef {
  return {
    id: 'neon-bay',
    title: 'TEST',
    bpm: 118,
    key: 'A minor',
    tracks: {
      bass: { instrument: 'saw-bass', gain: 0.6, pump: { by: 'kick', depth: 0.4, release: 0.2 } },
      kick: { instrument: 'kick', gain: 0.8 },
      lift: { instrument: 'pulse-lead', gain: 0.5, lift: true },
    },
    patterns: {
      I: { kick: hits(4), bass: notes(4, 'A2') },
      A: { kick: hits(8), bass: notes(8, 'A2'), lift: notes(8, 'A4') },
    },
    intro: ['I'],
    loop: ['A', 'A', 'A', 'A'],
    fx: { delay: { beats: 0.75, feedback: 0.3, tone: 3000 }, reverb: { size: 0.5, damp: 0.5 } },
  };
}

describe('validateSong (§M6.4)', () => {
  it('a valid world song has no errors', () => expect(validateSong(world())).toEqual([]));

  it('every token parses', () => {
    const d = world();
    d.patterns.A.bass = notes(8, 'A2').replace('A2', 'Z2');
    expect(validateSong(d).join()).toMatch(/pattern A, track bass, step 1/);
  });

  it('every note is inside its instrument’s range', () => {
    const d = world();
    d.patterns.A.bass = notes(8, 'A6');
    expect(validateSong(d).join()).toMatch(/MIDI 93 is outside saw-bass's range/);
  });

  it('drum tracks use only x, X, . and -', () => {
    const d = world();
    d.patterns.A.kick = notes(8, 'C4');
    expect(validateSong(d).join()).toMatch(/drum track/);
  });

  it('every pattern in the intro and loop exists, and every track in a pattern exists', () => {
    const d = world();
    d.loop = ['A', 'Q'];
    expect(validateSong(d).join()).toMatch(/pattern Q \(in the loop\) does not exist/);
    const e = world();
    e.patterns.A.ghost = rest(8);
    expect(validateSong(e).join()).toMatch(/track ghost is not in tracks/);
  });

  it('within a pattern every track has the same number of whole bars', () => {
    const d = world();
    d.patterns.A.bass = notes(4, 'A2');
    expect(validateSong(d).join()).toMatch(/has 4 bars, another track 8/);
    const e = world();
    e.patterns.A.bass = notes(8, 'A2') + ' .';
    expect(validateSong(e).join()).toMatch(/not a whole number of bars/);
  });

  it('bpm is 80–160', () => {
    expect(validateSong({ ...world(), bpm: 170 }).join()).toMatch(/bpm 170/);
  });

  it('a world song loops 60–80 s and has at most 8 intro bars', () => {
    expect(validateSong({ ...world(), loop: ['A', 'A'] }).join()).toMatch(/loop lasts 32\.5 s/);
    expect(validateSong({ ...world(), loop: ['A', 'A', 'A', 'A', 'A', 'A'] }).join()).toMatch(/loop lasts 97\.6 s/);
    expect(validateSong({ ...world(), intro: ['I', 'I', 'I'] }).join()).toMatch(/intro has 12 bars/);
  });

  it('the menu loops 60–80 s with at most 4 intro bars, and has no lift', () => {
    const d = { ...world(), id: 'menu' as const };
    expect(validateSong(d).join()).toMatch(/only world songs have a lift/);
    delete d.tracks.lift;
    delete d.patterns.A.lift;
    expect(validateSong(d)).toEqual([]);
    expect(validateSong({ ...d, intro: ['I', 'I'] }).join()).toMatch(/intro has 8 bars; at most 4/);
  });

  it('the results theme loops 16 bars', () => {
    const d = { ...world(), id: 'results' as const, intro: [] };
    delete d.tracks.lift;
    delete d.patterns.A.lift;
    expect(validateSong(d).join()).toMatch(/loops 32 bars; it must loop 16/);
    expect(validateSong({ ...d, loop: ['A', 'A'] })).toEqual([]);
  });

  it('a stinger lasts its table length ± 0.25 s and has no loop', () => {
    // 1 bar at 120 BPM = 2 s: `finish` (2.0 s) fits, `win` (3.0 s) does not.
    const sting = (id: 'finish' | 'win'): SongDef => ({ ...world(), id, bpm: 120, tracks: { kick: { instrument: 'kick', gain: 0.8 } }, patterns: { S: { kick: hits(1) } }, intro: ['S'], loop: [] });
    expect(validateSong(sting('finish'))).toEqual([]);
    expect(validateSong(sting('win')).join()).toMatch(/lasts 2\.00 s; it must last 3 ± 0\.25/);
    expect(validateSong({ ...sting('finish'), loop: ['S'] }).join()).toMatch(/a stinger has no loop/);
  });

  it('at most 24 voices sound at once', () => {
    const d = world();
    d.tracks.pad = { instrument: 'saw-pad', gain: 0.4 };
    // A 4-note chord on every 16th, each with the pad's 1 s release: about nine chords ring at once.
    d.patterns.A.pad = Array(128).fill('A3+C4+E4+G4').join(' ');
    expect(validateSong(d).join()).toMatch(/voices sound at once; at most 24/);
  });

  it('a world song needs a lift track that plays', () => {
    const d = world();
    delete d.tracks.lift;
    delete d.patterns.A.lift;
    expect(validateSong(d).join()).toMatch(/needs at least one lift track/);
    const e = world();
    e.patterns.A.lift = rest(8);
    expect(validateSong(e).join()).toMatch(/lift tracks play no note/);
  });

  it('a pump names a drum track', () => {
    const d = world();
    d.tracks.bass.pump = { by: 'lift', depth: 0.4, release: 0.2 };
    expect(validateSong(d).join()).toMatch(/pump by lift, which is not a drum track/);
  });
});
