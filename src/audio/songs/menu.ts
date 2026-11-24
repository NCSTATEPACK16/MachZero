/**
 * The menu theme, "STARTING GRID" (IMPLEMENTATION §M6.3): relaxed synthwave, 108 BPM, F major. It states the MachZero
 * motif (F4 C5 D5 C5 F5: quarter, eighth, eighth, quarter, half) in its first loop bar, and again at every A.
 *
 * Intro (2 bars): B♭ | C, leading into F. Loop (32 bars, 71.1 s): A A2 B A3.
 *   A, A2  F | Dm | B♭ | C (twice)        the motif, then its answers
 *   B      B♭ | C | Am | Dm | B♭ | C | Gm | C   long, higher notes
 *   A3     F | Dm | B♭ | C | F | Am | B♭ | C    the motif, then a line falling to E4, which leads to F4 at the top
 * No lift (only the world songs have one).
 */
import type { SongDef } from './format';
import { hits, join, line, rep } from './build';

// Chords: pad voicings, electric-piano voicings (sevenths, no root) and bass roots (low, high).
const CH = {
  F: { pad: 'F3+A3+C4', ep: 'A3+C4+E4', bass: ['F2', 'F3'] },
  Dm: { pad: 'F3+A3+D4', ep: 'A3+C4+F4', bass: ['D2', 'D3'] },
  Bb: { pad: 'F3+A#3+D4', ep: 'A3+D4+F4', bass: ['A#1', 'A#2'] },
  C: { pad: 'E3+G3+C4', ep: 'A#3+E4+G4', bass: ['C2', 'C3'] },
  Am: { pad: 'E3+A3+C4', ep: 'G3+C4+E4', bass: ['A1', 'A2'] },
  Gm: { pad: 'D3+G3+A#3', ep: 'A#3+D4+F4', bass: ['G1', 'G2'] },
} as const;
type Chord = keyof typeof CH;

const pad = (cs: Chord[]) => join(...cs.map((c) => line(`${CH[c].pad}:16`)));
const ep = (cs: Chord[]) => join(...cs.map((c) => line(`.:2 ${CH[c].ep}:4 .:4 ${CH[c].ep}:2 .:4`)));
const bass = (cs: Chord[]) => join(...cs.map((c) => line(`${CH[c].bass[0]}:3 .:3 ${CH[c].bass[0]}:2 ${CH[c].bass[1]}:2 .:2 ${CH[c].bass[0]}:2 .:2`)));

const A: Chord[] = ['F', 'Dm', 'Bb', 'C', 'F', 'Dm', 'Bb', 'C'];
const B: Chord[] = ['Bb', 'C', 'Am', 'Dm', 'Bb', 'C', 'Gm', 'C'];
const A3: Chord[] = ['F', 'Dm', 'Bb', 'C', 'F', 'Am', 'Bb', 'C'];

const KICK = hits('x.......x.....x.');
const SNARE = hits('....x.......x...');
const HAT = hits('x.x.x.x.x.x.x.x.');

const MOTIF = 'F4:4 C5:2 D5:2 C5:4 F5:8'; // 20 steps: the motif runs 4 steps into its second bar

export const menu: SongDef = {
  id: 'menu',
  title: 'MACHZERO — "STARTING GRID"',
  bpm: 108,
  key: 'F major',
  swing: 0.08,
  tracks: {
    kick: { instrument: 'kick-soft', gain: 0.66 },
    snare: { instrument: 'snare', gain: 0.42, reverb: 0.25 },
    hat: { instrument: 'hat', gain: 0.3, pan: 0.2 },
    bass: { instrument: 'saw-bass', gain: 0.42, params: { cutoff: 500, envAmt: 1.6 }, pump: { by: 'kick', depth: 0.25, release: 0.2 } },
    pad: { instrument: 'saw-pad', gain: 0.32, reverb: 0.35, params: { cutoff: 1300 } },
    keys: { instrument: 'fm-epiano', gain: 0.34, pan: -0.2, reverb: 0.25, delay: 0.1 },
    lead: { instrument: 'saw-lead', gain: 0.46, delay: 0.22, reverb: 0.2, params: { cutoff: 2000, vib: 0.14 } },
  },
  patterns: {
    intro: {
      pad: pad(['Bb', 'C']),
      keys: ep(['Bb', 'C']),
      bass: line('.:16 C2:8 C3:4 .:4'),
    },
    A: {
      kick: rep(KICK, 8),
      hat: rep(HAT, 8),
      bass: bass(A),
      pad: pad(A),
      keys: ep(A),
      lead: line(
        `${MOTIF} .:2 E5:2 D5:4 C5:2 A4:2 | A#4:4 C5:2 D5:2 F5:6 .:2 | E5:4 D5:2 C5:2 G4:8 |` +
          ` ${MOTIF} A5:4 G5:2 F5:2 D5:4 | F5:6 D5:2 C5:4 A#4:4 | C5:12 .:4`,
      ),
    },
    A2: {
      kick: rep(KICK, 8),
      snare: rep(SNARE, 8),
      hat: rep(HAT, 8),
      bass: bass(A),
      pad: pad(A),
      keys: ep(A),
      lead: line(
        `${MOTIF} .:2 E5:2 F5:2 E5:2 D5:4 | D5:4 F5:2 G5:2 F5:4 D5:4 | E5:6 C5:2 G4:4 A4:2 A#4:2 |` +
          ` C5:8 A4:4 F4:4 | A4:4 C5:2 D5:2 F5:8 | F5:4 D5:4 C5:2 A#4:2 A4:4 | G4:16`,
      ),
    },
    B: {
      kick: rep(KICK, 8),
      snare: rep(SNARE, 8),
      hat: rep(hits('x.x.x.x.x.x.x.xx'), 8),
      bass: bass(B),
      pad: pad(B),
      keys: ep(B),
      lead: line(
        'D5:8 F5:8 | G5:8 E5:8 | A5:6 G5:2 E5:4 C5:4 | D5:12 .:4 | D5:4 F5:4 A5:8 | G5:8 E5:4 D5:4 | D5:4 A#4:4 D5:4 G5:4 | E5:4 D5:4 C5:8',
      ),
    },
    A3: {
      kick: rep(KICK, 8),
      snare: join(rep(SNARE, 7), hits('....x.......x.xx')),
      hat: rep(HAT, 8),
      bass: bass(A3),
      pad: pad(A3),
      keys: ep(A3),
      lead: line(
        `${MOTIF} .:2 E5:2 D5:4 C5:2 A4:2 | A#4:4 C5:2 D5:2 F5:6 .:2 | E5:4 D5:2 C5:2 G4:8 |` +
          ' A4:4 C5:4 F5:4 E5:2 D5:2 | C5:4 E5:4 A5:6 G5:2 | F5:4 D5:4 A#4:4 D5:4 | C5:6 A#4:2 A4:2 G4:2 E4:4',
      ),
    },
  },
  intro: ['intro'],
  loop: ['A', 'A2', 'B', 'A3'],
  fx: { delay: { beats: 0.75, feedback: 0.35, tone: 3000 }, reverb: { size: 0.6, damp: 0.5 } },
};
