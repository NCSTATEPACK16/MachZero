import { describe, expect, it } from 'vitest';
import { PRESET_IDS, PRESETS, renderPreset, type SfxPreset } from '../sfx/presets';
import { PRESET_LEVELS } from '../sfx/presetMeta';
import { renderSfxr, sfxrLength } from '../sfx/sfxr';

const peakOf = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('sfxr presets (§M6a step 2)', () => {
  const rendered = new Map<string, Float32Array>();
  const t0 = performance.now();
  for (const id of PRESET_IDS) rendered.set(id, renderPreset(PRESETS[id] as SfxPreset, 44100));
  const ms = performance.now() - t0;

  it('names the same presets in the recipes and the playback levels', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(Object.keys(PRESET_LEVELS).sort());
    for (const id of PRESET_IDS) expect(PRESET_LEVELS[id]).toBeGreaterThan(0);
  });

  it('renders every preset non-silent, within ±1, with no NaN', () => {
    for (const id of PRESET_IDS) {
      const b = rendered.get(id)!;
      expect(b.length, id).toBeGreaterThan(100);
      expect(b.every(Number.isFinite), `${id} has NaN`).toBe(true);
      const peak = peakOf(b);
      expect(peak, `${id} is silent`).toBeGreaterThan(0.05);
      expect(peak, id).toBeLessThanOrEqual(1);
    }
  });

  it('makes each layer as long as its envelope (shorter only when the frequency limit cuts it)', () => {
    for (const id of PRESET_IDS) {
      for (const l of (PRESETS[id] as SfxPreset).layers) {
        const n = renderSfxr(l.p, 44100).length;
        const env = sfxrLength(l.p);
        if ((l.p.freqLimit ?? 0) > 0) expect(n).toBeLessThanOrEqual(env);
        else expect(Math.abs(n - env), id).toBeLessThanOrEqual(3);
      }
    }
  });

  it('gives loops their loop length', () => {
    for (const id of PRESET_IDS) {
      const p = PRESETS[id] as SfxPreset;
      if (p.loop) expect(rendered.get(id)!.length, id).toBe(Math.round((p.loopSeconds ?? 1) * 44100));
    }
  });

  it('is deterministic (the noise is seeded)', () => {
    const a = renderPreset(PRESETS['gate.hit'], 44100);
    const b = renderPreset(PRESETS['gate.hit'], 44100);
    expect(a).toEqual(b);
    expect(renderSfxr({ wave: 'noise', freq: 0.3, seed: 1 })).not.toEqual(renderSfxr({ wave: 'noise', freq: 0.3, seed: 2 }));
  });

  it('renders the whole batch in ≤ 2 s and ≤ 3 MB', () => {
    let bytes = 0;
    for (const b of rendered.values()) bytes += b.byteLength;
    console.info(`[sfxr] ${PRESET_IDS.length} presets in ${ms.toFixed(0)} ms, ${(bytes / 1048576).toFixed(2)} MB`);
    expect(ms).toBeLessThanOrEqual(2000);
    expect(bytes).toBeLessThanOrEqual(3 * 1048576);
  });

  it('resamples to another rate', () => {
    const p = PRESETS['ui.move'];
    const a = renderPreset(p, 44100);
    const b = renderPreset(p, 48000);
    expect(Math.abs(b.length - (a.length * 48000) / 44100)).toBeLessThanOrEqual(2);
  });
});
