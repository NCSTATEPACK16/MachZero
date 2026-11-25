/**
 * Listening exports for the owner (IMPLEMENTATION §M6b step 8), opt-in: `npm run songs:export`. For each song in the
 * registry it writes, as the player would play them:
 *   <id>.wav       the intro, then the loop twice; the lift comes in over one bar at the second pass
 *   <id>-lift.wav  (world songs) the loop's first 8 bars without the lift, then the same 8 bars with it
 * into EXPORT_DIR (default `.song-exports/`, git-ignored), then M4A beside them when ffmpeg is installed.
 * Audio files are never committed.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { renderSong, type RenderedSong } from '../../dsp/render';
import { SONGS } from '../index';

const DIR = process.env.EXPORT_DIR ?? '.song-exports';

function wav(l: Float32Array, r: Float32Array, sampleRate: number): Buffer {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  const s16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(s16(l[i]), 44 + i * 4);
    buf.writeInt16LE(s16(r[i]), 46 + i * 4);
  }
  return buf;
}

/** The intro, then `passes` of the loop; the lift's gain per pass (ramped over a bar from the pass's start). */
function playback(s: RenderedSong, liftPerPass: number[], loopFrom = 0, loopLen = s.loopSamples): [Float32Array, Float32Array] {
  const introLen = s.intro ? s.introSamples : 0;
  const total = introLen + loopLen * liftPerPass.length + (s.intro && loopFrom === 0 ? 0 : 0);
  const l = new Float32Array(total);
  const r = new Float32Array(total);
  if (s.intro && loopFrom === 0) {
    for (let i = 0; i < Math.min(total, s.intro[0].length); i++) {
      l[i] += s.intro[0][i];
      r[i] += s.intro[1][i];
    }
  }
  const start = loopFrom === 0 ? introLen : 0;
  const bar = Math.round((240 / s.bpm) * s.sampleRate);
  let prev = 0;
  liftPerPass.forEach((lift, p) => {
    for (let k = 0; k < loopLen; k++) {
      const i = start + p * loopLen + k;
      if (i >= total) break;
      const j = (loopFrom + k) % s.loopSamples;
      const g = lift === prev ? lift : prev + (lift - prev) * Math.min(1, k / bar);
      const lv = s.lift ? s.lift[j] * g : 0;
      l[i] += s.loop[0][j] + lv;
      r[i] += s.loop[1][j] + lv;
    }
    prev = lift;
  });
  return [l, r];
}

it.skipIf(!process.env.EXPORT_SONGS)('exports every song for listening', () => {
  mkdirSync(DIR, { recursive: true });
  let ffmpeg = true;
  for (const [id, def] of Object.entries(SONGS)) {
    const s = renderSong(def!);
    const files: Array<[string, [Float32Array, Float32Array]]> = [[id, playback(s, [0, 1])]];
    if (s.lift) {
      const eight = Math.round(8 * (240 / s.bpm) * s.sampleRate);
      const [offL, offR] = playback(s, [0], 0, eight);
      const off: [Float32Array, Float32Array] = s.intro ? [offL.subarray(s.introSamples), offR.subarray(s.introSamples)] : [offL, offR];
      const on = playback({ ...s, intro: null }, [1], 0, eight);
      const l = new Float32Array(off[0].length + on[0].length);
      const r = new Float32Array(l.length);
      l.set(off[0]);
      l.set(on[0], off[0].length);
      r.set(off[1]);
      r.set(on[1], off[1].length);
      files.push([`${id}-lift`, [l, r]]);
    }
    for (const [name, [l, r]] of files) {
      const path = join(DIR, `${name}.wav`);
      writeFileSync(path, wav(l, r, s.sampleRate));
      if (ffmpeg) {
        try {
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path, '-c:a', 'aac', '-b:a', '192k', join(DIR, `${name}.m4a`)]);
        } catch {
          ffmpeg = false;
        }
      }
      console.info(`[export] ${path} (${(l.length / s.sampleRate).toFixed(1)} s)${ffmpeg ? ' + .m4a' : ''}`);
    }
  }
}, 300_000);
