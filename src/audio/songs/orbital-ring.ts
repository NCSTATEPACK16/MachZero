/**
 * Orbital Ring, "LOW ORBIT" (IMPLEMENTATION §M6.3): an ambient arpeggio, 96 BPM, C Lydian. The ♯4 (F♯) is in the
 * bell arpeggio from its first bar (Cmaj7♯11), and the Lydian II chord (D over a C pedal) answers it. A chord
 * every two bars; slow saw-pad swells; a sine sub; a soft kick and a rim; no snare. The arpeggio runs in eighths on a
 * long dotted delay; a second bell sings the melody in long notes.
 *
 * Intro (4 bars): Cmaj7 | D/C, pad, sub and the arpeggio. Loop (32 bars, 80.0 s): A B A′ B′.
 *   A   Cmaj7 | D/C | Cmaj7 | D/C       the melody rises to D6 and settles on G5
 *   B   Am7 | Bm7 | Em7 | D             higher, the kick and rim fuller
 *   A′  Cmaj7 | D/C | Em7 | D/C
 *   B′  Am7 | Bm7 | Em7 | D             ends on F♯5, which rises to G5 at the top
 * Lift (the final lap): a half-time snare and the arpeggio an octave up.
 */
import type { SongDef } from './format';
import { hits, join, line, rep, rest, up } from './build';

const CH = {
  C: { pad: 'C3+G3+B3+E4', arp: ['C5', 'G5', 'B5', 'E5', 'F#5', 'B5', 'G5', 'E5'], sub: 'C2' },
  DC: { pad: 'C3+F#3+A3+D4', arp: ['C5', 'A5', 'D6', 'F#5', 'A5', 'D6', 'A5', 'F#5'], sub: 'C2' },
  Am: { pad: 'A2+E3+G3+C4', arp: ['A4', 'E5', 'G5', 'C6', 'B5', 'G5', 'E5', 'C5'], sub: 'A1' },
  Bm: { pad: 'B2+F#3+A3+D4', arp: ['B4', 'F#5', 'A5', 'D5', 'F#5', 'D6', 'A5', 'F#5'], sub: 'B1' },
  Em: { pad: 'E3+G3+B3+D4', arp: ['E5', 'B5', 'D6', 'G5', 'F#5', 'B5', 'G5', 'D5'], sub: 'E2' },
  D: { pad: 'D3+F#3+A3+D4', arp: ['D5', 'A5', 'D6', 'F#5', 'E5', 'A5', 'F#5', 'D5'], sub: 'D2' },
} as const;
type Chord = keyof typeof CH;

/** Each chord lasts two bars. */
const pad = (cs: Chord[]) => join(...cs.map((c) => line(`${CH[c].pad}:32`)));
const sub = (cs: Chord[]) => join(...cs.map((c) => line(`${CH[c].sub}:30 .:2`)));
const arps = (cs: Chord[], semis = 0) => join(...cs.map((c) => line(rep(CH[c].arp.map((n) => `${up(n, semis)}:2`).join(' '), 2))));

const A: Chord[] = ['C', 'DC', 'C', 'DC'];
const B: Chord[] = ['Am', 'Bm', 'Em', 'D'];
const A2: Chord[] = ['C', 'DC', 'Em', 'DC'];

const KICK = hits('x.........x.....');
const RIM = join(hits('........x.......'), hits('........x.....x.'));
const HALF = hits('........x.......');

export const orbitalRing: SongDef = {
  id: 'orbital-ring',
  title: 'ORBITAL RING — "LOW ORBIT"',
  bpm: 96,
  key: 'C Lydian',
  tracks: {
    kick: { instrument: 'kick-soft', gain: 0.62 },
    rim: { instrument: 'rim', gain: 0.32, pan: 0.3, delay: 0.25, reverb: 0.25 },
    sub: { instrument: 'sine-sub', gain: 0.34, pump: { by: 'kick', depth: 0.3, release: 0.3 } },
    pad: { instrument: 'saw-pad', gain: 0.3, reverb: 0.45, params: { a: 1.4, r: 2.0, cutoff: 1400, envAmt: 0.8, fDecay: 2.5 } },
    arp: { instrument: 'bell', gain: 0.28, pan: -0.3, delay: 0.5, reverb: 0.35, params: { index: 2.4, d: 0.9, r: 0.6 } },
    melody: { instrument: 'bell', gain: 0.4, delay: 0.25, reverb: 0.45, params: { ratio: 2, index: 1.6, indexDecay: 0.8, d: 2.2, r: 1.0 } },
    snare: { instrument: 'snare', gain: 0.32, reverb: 0.35, lift: true },
    arpHigh: { instrument: 'bell', gain: 0.17, delay: 0.4, reverb: 0.3, lift: true, params: { index: 2.0, d: 0.7, r: 0.5 } },
  },
  patterns: {
    intro: {
      pad: pad(['C', 'DC']),
      sub: sub(['C', 'DC']),
      arp: arps(['C', 'DC']),
    },
    A: {
      kick: join(rest(4), rep(KICK, 4)),
      rim: join(rest(2), rep(RIM, 3)),
      sub: sub(A),
      pad: pad(A),
      arp: arps(A),
      melody: line('G5:8 E5:8 | B5:12 .:4 | A5:8 F#5:8 | F#5:4 A5:4 D6:8 | C6:8 B5:4 G5:4 | E5:12 .:4 | F#5:8 A5:8 | G5:16'),
      snare: rep(HALF, 8),
      arpHigh: arps(A, 12),
    },
    B: {
      kick: rep(join(KICK, hits('x.........x...x.')), 4),
      rim: rep(RIM, 4),
      sub: sub(B),
      pad: pad(B),
      arp: arps(B),
      melody: line('E5:8 G5:8 | C6:8 B5:8 | D6:8 B5:8 | A5:8 F#5:8 | G5:8 B5:8 | D6:8 B5:8 | A5:8 F#5:4 E5:4 | A5:16'),
      snare: rep(HALF, 8),
      arpHigh: arps(B, 12),
    },
    A2: {
      kick: rep(KICK, 8),
      rim: rep(RIM, 4),
      sub: sub(A2),
      pad: pad(A2),
      arp: arps(A2),
      melody: line('G5:8 E5:8 | B5:12 .:4 | A5:8 F#5:8 | F#5:4 A5:4 D6:8 | B5:8 G5:4 E5:4 | D6:12 .:4 | C6:8 A5:8 | F#5:16'),
      snare: rep(HALF, 8),
      arpHigh: arps(A2, 12),
    },
    B2: {
      kick: rep(join(KICK, hits('x.........x...x.')), 4),
      rim: rep(RIM, 4),
      sub: sub(B),
      pad: pad(B),
      arp: arps(B),
      melody: line('E5:8 G5:8 | C6:8 B5:8 | D6:8 B5:8 | A5:8 F#5:8 | G5:8 B5:8 | D6:4 B5:4 G5:8 | A5:8 F#5:4 E5:4 | F#5:16'),
      snare: rep(HALF, 8),
      arpHigh: arps(B, 12),
    },
  },
  intro: ['intro'],
  loop: ['A', 'B', 'A2', 'B2'],
  fx: { delay: { beats: 0.75, feedback: 0.55, tone: 2600 }, reverb: { size: 0.85, damp: 0.55 } },
};
