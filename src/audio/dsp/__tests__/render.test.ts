import { describe, expect, it } from 'vitest';
import type { SongDef } from '../../songs/format';
import { validateSong } from '../../songs/validate';
import { renderSong, SongRender, songBytes } from '../render';
import { peakOf, rms } from './spectrum';

const rep = (s: string, n: number) => Array(n).fill(s.trim()).join(' ');

/**
 * A small world song with every mechanism the renderer has: an intro, a pumped bass, a chorused pad held over bar
 * lines, a delayed lead with glide, reverb on the snare, swing, and a lift track. 120 BPM: 30 bars = 60 s.
 */
export function testSong(): SongDef {
  const kick = rep('x . . . x . . . x . . . x . . .', 1);
  const snare = rep('. . . . X . . . . . . . X . . .', 1);
  const hats = rep('x x x x x x x x x x x x x x x x', 1);
  const bass = rep('A2 . A2 . A3 . A2 . F2 . F2 . F3 . G2 .', 1);
  const pad = 'A3+C4+E4 - - - - - - - - - - - - - - - F3+A3+C4 - - - - - - - - - - - - - - -';
  const lead = 'A4 - - - C5 - E5 - D5 - - - C5 - - - E5 - - - - - - - . . . . . . . .';
  const lift = rep('A5 . E5 . C5 . E5 .', 4);
  return {
    id: 'neon-bay',
    title: 'TEST SONG',
    bpm: 120,
    key: 'A minor',
    swing: 0.1,
    tracks: {
      kick: { instrument: 'kick', gain: 0.8 },
      snare: { instrument: 'snare', gain: 0.5, reverb: 0.4 },
      hat: { instrument: 'hat', gain: 0.4, pan: 0.3 },
      bass: { instrument: 'saw-bass', gain: 0.6, pump: { by: 'kick', depth: 0.5, release: 0.25 } },
      pad: { instrument: 'saw-pad', gain: 0.4, reverb: 0.3 },
      lead: { instrument: 'saw-lead', gain: 0.5, delay: 0.35, pan: -0.1 },
      lift: { instrument: 'pulse-lead', gain: 0.45, delay: 0.3, reverb: 0.2, lift: true },
    },
    patterns: {
      I: { kick: rep(kick, 2), pad },
      A: { kick: rep(kick, 2), snare: rep(snare, 2), hat: rep(hats, 2), bass: rep(bass, 2), pad, lead, lift: rep(lift, 1) },
    },
    intro: ['I'],
    loop: Array(15).fill('A'),
    fx: { delay: { beats: 0.75, feedback: 0.45, tone: 3500 }, reverb: { size: 0.6, damp: 0.4 } },
  };
}

describe('renderSong', () => {
  const def = testSong();
  const song = renderSong(def);

  it('the test song is valid', () => expect(validateSong(def)).toEqual([]));

  it('renders an intro with its tail, a loop of exactly its length, and a lift as long', () => {
    expect(song.introSamples).toBe(Math.round(2 * 2 * 44100)); // 2 bars at 120 BPM
    expect(song.intro![0].length).toBeGreaterThan(song.introSamples);
    expect(song.loopSamples).toBe(60 * 44100);
    expect(song.loop[0].length).toBe(song.loopSamples);
    expect(song.lift!.length).toBe(song.loopSamples);
    expect(song.introBars).toBe(2);
    expect(song.loopBars).toBe(30);
    expect(songBytes(song)).toBe(4 * (2 * song.intro![0].length + 3 * song.loopSamples));
  });

  it('is normalised: the loop measures −14 ± 1 LUFS and peaks at or under −1 dBFS', () => {
    expect(Math.abs(song.lufs + 14)).toBeLessThanOrEqual(1);
    expect(song.truePeakDb).toBeLessThanOrEqual(-1 + 1e-6);
    expect(Math.max(peakOf(song.loop[0]), peakOf(song.loop[1]))).toBeLessThanOrEqual(Math.pow(10, -1 / 20));
  });

  it('the loop is seamless: the folded loop equals the loop’s second pass', () => {
    const folded = new SongRender(def).raw();
    const twice = new SongRender(def, { passes: 2 }).raw();
    const n = folded.loopSamples;
    let err = 0;
    for (const [a, b] of [
      [folded.loop[0], twice.loop[0]],
      [folded.loop[1], twice.loop[1]],
      [folded.lift!, twice.lift!],
    ] as const) {
      for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(a[i] - b[n + i]));
    }
    // 1e-4 after normalisation.
    expect(err * song.gain).toBeLessThan(1e-4);
    // And it is not trivially so: the second pass differs from the first near the start (the first has no tail).
    let diff = 0;
    for (let i = 0; i < 44100; i++) diff = Math.max(diff, Math.abs(twice.loop[0][i] - twice.loop[0][n + i]));
    expect(diff).toBeGreaterThan(1e-3);
  });

  it('the lift holds only the lift tracks, and is not silent', () => {
    expect(rms(song.lift!)).toBeGreaterThan(0.01);
    const noLift = testSong();
    noLift.patterns.A.lift = rep('.', 64);
    noLift.id = 'neon-bay';
    const r = new SongRender(noLift).raw();
    expect(peakOf(r.lift!)).toBe(0);
  });

  it('two renders give identical samples', () => {
    const again = renderSong(def);
    expect(again.loop[0]).toEqual(song.loop[0]);
    expect(again.loop[1]).toEqual(song.loop[1]);
    expect(again.lift).toEqual(song.lift);
    expect(again.intro![0]).toEqual(song.intro![0]);
  });

  it('rendering in slices gives the same samples as all at once', () => {
    const job = new SongRender(def);
    let slices = 0;
    while (!job.step(5)) slices++;
    expect(slices).toBeGreaterThan(10);
    const r = job.result();
    expect(r.loop[0]).toEqual(song.loop[0]);
    expect(r.lift).toEqual(song.lift);
  });

  it('a song without lift tracks has no lift layer', () => {
    const menu = testSong();
    menu.id = 'menu';
    delete menu.tracks.lift;
    delete menu.patterns.A.lift;
    expect(renderSong(menu).lift).toBeNull();
  });
});
