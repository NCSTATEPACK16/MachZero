/**
 * Every song and stinger in the registry (IMPLEMENTATION §M6b step 3): valid, non-silent, −14 ± 1 LUFS with true
 * peaks ≤ −1 dBFS, seamless, the lift by the rules, deterministic, and rendered in ≤ 10 s (each time printed).
 */
import { describe, expect, it } from 'vitest';
import { renderSong, SongRender } from '../../dsp/render';
import { rms } from '../../dsp/__tests__/spectrum';
import { CATALOG } from '../catalog';
import { kindOf, type MusicId } from '../format';
import { SONGS } from '../index';
import { validateSong } from '../validate';

const RENDER_LIMIT_MS = 10_000;

describe('the registry and the catalogue', () => {
  it('the ready catalogue entries are exactly the registry, with the same titles, tempos and keys', () => {
    const ready = CATALOG.filter((e) => e.ready).map((e) => e.id).sort();
    expect(Object.keys(SONGS).sort()).toEqual(ready);
    for (const e of CATALOG.filter((x) => x.ready)) {
      const def = SONGS[e.id]!;
      expect(def.id).toBe(e.id);
      expect(def.title).toBe(e.title);
      expect(def.bpm).toBe(e.bpm);
      expect(def.key).toBe(e.key);
      expect(kindOf(e.id)).toBe(e.kind);
    }
  });

  it('M6b ships the menu theme, Neon Bay and Orbital Ring', () => {
    expect(Object.keys(SONGS).sort()).toEqual(expect.arrayContaining(['menu', 'neon-bay', 'orbital-ring']));
  });
});

for (const [id, def] of Object.entries(SONGS) as Array<[MusicId, NonNullable<(typeof SONGS)[MusicId]>]>) {
  describe(`song ${id}`, () => {
    const t0 = performance.now();
    const song = renderSong(def);
    const ms = performance.now() - t0;
    console.info(`[song] ${id}: rendered in ${ms.toFixed(0)} ms; loop ${(song.loopSamples / song.sampleRate).toFixed(1)} s, ${song.lufs.toFixed(2)} LUFS, true peak ${song.truePeakDb.toFixed(2)} dBFS`);

    it('is valid', () => expect(validateSong(def)).toEqual([]));

    it(`renders in ≤ ${RENDER_LIMIT_MS / 1000} s`, () => expect(ms).toBeLessThanOrEqual(RENDER_LIMIT_MS));

    it('is not silent', () => {
      expect(rms(song.loop[0])).toBeGreaterThan(0.02);
      expect(rms(song.loop[1])).toBeGreaterThan(0.02);
      if (song.intro) expect(rms(song.intro[0], 0, song.introSamples)).toBeGreaterThan(0.005);
      for (const b of [...song.loop, ...(song.intro ?? []), ...(song.lift ? [song.lift] : [])]) expect(b.every(Number.isFinite)).toBe(true);
    });

    it('measures −14 ± 1 LUFS with true peaks ≤ −1 dBFS', () => {
      expect(Math.abs(song.lufs + 14)).toBeLessThanOrEqual(1);
      expect(song.truePeakDb).toBeLessThanOrEqual(-1 + 1e-6);
    });

    if (kindOf(id) !== 'stinger') {
      it('loops seamlessly (the folded loop equals the second pass within 1e-4)', () => {
        const folded = new SongRender(def).raw();
        const twice = new SongRender(def, { passes: 2 }).raw();
        const n = folded.loopSamples;
        let err = 0;
        const pairs: Array<[Float32Array, Float32Array]> = [
          [folded.loop[0], twice.loop[0]],
          [folded.loop[1], twice.loop[1]],
        ];
        if (folded.lift && twice.lift) pairs.push([folded.lift, twice.lift]);
        for (const [a, b] of pairs) for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(a[i] - b[n + i]));
        expect(err * song.gain).toBeLessThan(1e-4);
      });
    }

    it('has a lift by the rules (world songs: a non-silent lift; others: none)', () => {
      if (kindOf(id) === 'world') {
        expect(song.lift).not.toBeNull();
        expect(rms(song.lift!)).toBeGreaterThan(0.005);
      } else expect(song.lift).toBeNull();
    });

    it('renders the same samples twice', () => {
      const again = renderSong(def);
      expect(again.loop[0]).toEqual(song.loop[0]);
      expect(again.loop[1]).toEqual(song.loop[1]);
      expect(again.lift).toEqual(song.lift);
    });
  });
}
