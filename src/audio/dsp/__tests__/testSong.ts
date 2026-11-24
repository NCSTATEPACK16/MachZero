/** A test song for the renderer and the render client. */
import type { SongDef } from '../../songs/format';

export const rep = (s: string, n: number) => Array(n).fill(s.trim()).join(' ');

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
