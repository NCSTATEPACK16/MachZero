/**
 * Neon Bay, "GRID RUNNER" (IMPLEMENTATION §M6.3): synthwave, as the sketch the owner approved. 118 BPM, A minor,
 * i–VI–III–VII (Am–F–C–G), a chord a bar.
 *
 * Intro (4 bars): the pad and the arpeggio, then the bass and the kick. Loop (32 bars, 65.1 s): A B A′ C.
 *   A   the theme: a rising A–C–E figure answered a bar later, twice
 *   B   long, high notes over 16th hats (the lead's vibrato sings)
 *   A′  the theme again, starting high the second time, peaking on B5
 *   C   a breakdown: four bars without the lead or the kick, then a line that falls to B4, which leads to A4 at the top
 * Drums: a four-on-the-floor kick, hats, and a big snare once every two bars (beat 3), which leaves room for the
 * effects. The bass pumps under the kick.
 * Lift (the final lap): a pulse-lead counter-melody an octave above the lead, and open hats on the off-beats.
 */
import type { SongDef } from './format';
import { arp, hits, join, line, rep, rest } from './build';

const CH = {
  Am: { pad: 'A3+C4+E4', arp: ['A3', 'C4', 'E4', 'A4'], bass: ['A1', 'A2'] },
  F: { pad: 'A3+C4+F4', arp: ['F3', 'A3', 'C4', 'F4'], bass: ['F1', 'F2'] },
  C: { pad: 'G3+C4+E4', arp: ['C4', 'E4', 'G4', 'C5'], bass: ['C2', 'C3'] },
  G: { pad: 'G3+B3+D4', arp: ['G3', 'B3', 'D4', 'G4'], bass: ['G1', 'G2'] },
} as const;
type Chord = keyof typeof CH;
const PROG: Chord[] = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'];

const pad = (cs: Chord[]) => join(...cs.map((c) => line(`${CH[c].pad}:16`)));
const arps = (cs: Chord[]) => join(...cs.map((c) => arp(CH[c].arp, 1, 16)));
const bass = (cs: Chord[]) => join(...cs.map((c) => line(rep(`${CH[c].bass[0]}:2 ${CH[c].bass[1]}:2`, 4))));

const KICK = hits('x...x...x...x...');
const HAT8 = hits('x.x.X.x.x.x.X.x.');
const HAT16 = hits('xxXxxxXxxxXxxxXx');
/** The big snare: beat 3 of every second bar. */
const BIG = join(rest(1), hits('........X.......'));
const OPEN = hits('..x...x...x...x.');

const THEME_1 = 'A4:2 C5:2 E5:4 D5:2 C5:2 D5:4 | C5:4 A4:4 .:4 A4:2 C5:2 | E5:2 G5:2 E5:4 D5:2 C5:2 D5:4 | D5:8 B4:4 .:4';
/** The lift's counter-melody, a 4-bar cycle an octave above the lead, and its brighter second form. */
const COUNTER_1 = 'E6:8 C6:8 | C6:8 A5:8 | G5:8 C6:8 | D6:8 B5:8';
const COUNTER_2 = 'A5:4 C6:4 E6:8 | F6:8 C6:8 | E6:8 G6:8 | D6:16';

export const neonBay: SongDef = {
  id: 'neon-bay',
  title: 'NEON BAY — "GRID RUNNER"',
  bpm: 118,
  key: 'A minor',
  tracks: {
    kick: { instrument: 'kick', gain: 0.68 },
    snare: { instrument: 'snare-big', gain: 0.55, reverb: 0.55 },
    hat: { instrument: 'hat', gain: 0.34, pan: 0.25 },
    bass: { instrument: 'saw-bass', gain: 0.42, pump: { by: 'kick', depth: 0.45, release: 0.2 } },
    arp: { instrument: 'square-arp', gain: 0.3, pan: -0.25, delay: 0.3 },
    pad: { instrument: 'saw-pad', gain: 0.3, reverb: 0.3, pump: { by: 'kick', depth: 0.25, release: 0.25 } },
    lead: { instrument: 'saw-lead', gain: 0.46, delay: 0.25, reverb: 0.2 },
    counter: { instrument: 'pulse-lead', gain: 0.28, delay: 0.3, reverb: 0.25, lift: true },
    open: { instrument: 'hat-open', gain: 0.24, lift: true },
  },
  patterns: {
    intro: {
      pad: pad(['Am', 'F', 'C', 'G']),
      arp: arps(['Am', 'F', 'C', 'G']),
      bass: join(rest(2), bass(['C', 'G'])),
      hat: join(rest(2), rep(HAT8, 2)),
      kick: join(rest(3), KICK),
    },
    A: {
      kick: rep(KICK, 8),
      snare: rep(BIG, 4),
      hat: rep(HAT8, 8),
      bass: bass(PROG),
      arp: arps(PROG),
      pad: pad(PROG),
      lead: line(`${THEME_1} | A4:2 C5:2 E5:4 D5:2 C5:2 D5:4 | C5:4 A4:4 F5:4 E5:2 D5:2 | E5:6 G5:2 E5:4 C5:4 | D5:12 B4:2 D5:2`),
      counter: line(`${COUNTER_1} | ${COUNTER_1}`),
      open: rep(OPEN, 8),
    },
    B: {
      kick: rep(KICK, 8),
      snare: rep(BIG, 4),
      hat: rep(HAT16, 8),
      bass: bass(PROG),
      arp: arps(PROG),
      pad: pad(PROG),
      lead: line('E5:8 A5:8 | A5:4 G5:4 F5:8 | E5:8 G5:8 | G5:8 D5:8 | C5:4 E5:4 A5:8 | A5:4 C6:4 A5:4 F5:4 | G5:8 E5:4 C5:4 | D5:8 B4:4 G4:4'),
      counter: line(`${COUNTER_2} | ${COUNTER_2}`),
      open: rep(OPEN, 8),
    },
    A2: {
      kick: rep(KICK, 8),
      snare: rep(BIG, 4),
      hat: rep(HAT8, 8),
      bass: bass(PROG),
      arp: arps(PROG),
      pad: pad(PROG),
      lead: line(`${THEME_1} | A5:2 G5:2 E5:4 D5:2 C5:2 D5:4 | C5:4 A4:4 F5:4 E5:2 D5:2 | E5:4 G5:4 C6:4 G5:4 | B5:8 G5:4 D5:4`),
      counter: line(`${COUNTER_1} | ${COUNTER_1}`),
      open: rep(OPEN, 8),
    },
    C: {
      kick: join(rest(4), rep(KICK, 4)),
      snare: join(rest(2), BIG, rep(BIG, 2)),
      hat: join(rep(HAT8, 4), rep(HAT16, 4)),
      bass: join(rest(2), bass(['C', 'G']), bass(PROG.slice(4))),
      arp: arps(PROG),
      pad: pad(PROG),
      lead: line('.:64 | E5:4 D5:4 C5:4 B4:4 | C5:8 A4:8 | G4:4 C5:4 E5:4 G5:4 | D5:4 C5:4 B4:4 G4:2 B4:2'),
      counter: line(`${COUNTER_1} | ${COUNTER_2}`),
      open: join(rest(4), rep(OPEN, 4)),
    },
  },
  intro: ['intro'],
  loop: ['A', 'B', 'A2', 'C'],
  fx: { delay: { beats: 0.75, feedback: 0.4, tone: 3500 }, reverb: { size: 0.7, damp: 0.45 } },
};
