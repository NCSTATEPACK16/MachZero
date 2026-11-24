/**
 * Helpers for writing songs (Worker side only): they expand compact notation into step strings (§M6.4).
 *   line('F4:4 C5:2 D5:2 .:8')   a note and its length in 16ths ('.' rests; 'A3+C4' a chord; 'F5!' accented;
 *                                '|' is only a bar mark for the reader)
 *   hits('x...x...X...x...')     a drum picture, one character per 16th
 *   arp(['C5', 'G5'], 2, 16)     notes in turn, each `every` steps long, for `steps` steps
 *   rest(bars)                   bars of rest
 */
export function line(spec: string): string {
  const out: string[] = [];
  for (const tok of spec.trim().split(/\s+/)) {
    if (tok === '|' || tok === '') continue;
    const [note, len] = tok.split(':');
    const n = len === undefined ? 1 : Number(len);
    if (note === '.') for (let i = 0; i < n; i++) out.push('.');
    else {
      out.push(note);
      for (let i = 1; i < n; i++) out.push('-');
    }
  }
  return out.join(' ');
}

export const hits = (pic: string): string => [...pic.replace(/[\s|]/g, '')].join(' ');

export function arp(notes: readonly string[], every: number, steps: number): string {
  const out: string[] = [];
  for (let i = 0; out.length < steps; i++) {
    out.push(notes[i % notes.length]);
    for (let k = 1; k < every && out.length < steps; k++) out.push('-');
  }
  return out.join(' ');
}

export const rest = (bars: number): string => Array(16 * bars).fill('.').join(' ');

export const rep = (s: string, n: number): string => Array(n).fill(s).join(' ');

export const join = (...parts: string[]): string => parts.join(' ');

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A note name moved by `semis` (sharps only): up('C5', 12) → 'C6'. */
export function up(note: string, semis: number): string {
  const m = /^([A-G]#?)(\d)$/.exec(note);
  if (!m) return note;
  const midi = 12 * (Number(m[2]) + 1) + NAMES.indexOf(m[1]) + semis;
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
