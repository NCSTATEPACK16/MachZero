import { describe, expect, it } from 'vitest';
import { ENVFX_MAX_DRAW_CALLS, NO_ENVFX, flashTime, planDrawCalls, resolveEnvFx, type EnvFxSpec } from '../EnvFxSpec';

const FULL: EnvFxSpec = {
  grade: { lift: [0, 0, 0.01], gamma: [1, 1, 1], gain: [1, 1, 1.05], saturation: 1.1 },
  weather: { kind: 'rain', count: 1000, fall: 30, wind: [2, 0], size: 0.03, color: 0x99aaff, streak: 0.04, opacity: 0.5 },
  heightFog: { base: 10, falloff: 20, color: 0x223355, density: 0.5 },
  lightning: { rate: 6, color: 0xffffff, flash: 0.5 },
  surface: { kind: 'spray', color: 0xaaccff },
  setPieces: [
    { prop: 'airship', count: 3, path: 'orbit', radius: 900, height: 200, speed: 8 },
    { prop: 'blimp', count: 2, path: 'line', radius: 1500, height: 300, speed: 12 },
  ],
  wetDeck: { gloss: 0.7, streak: 0.5 },
  shafts: { count: 10, color: 0xffffff, angle: 0.3, width: 30, height: 300, opacity: 0.2 },
};

describe('environment effects: quality scaling (IMPLEMENTATION §X2)', () => {
  it('an empty spec draws nothing on any preset', () => {
    for (const level of ['low', 'med', 'high'] as const) {
      const p = resolveEnvFx(NO_ENVFX, level, false);
      expect(p).toEqual({ grade: null, weather: null, heightFog: null, lightning: null, surface: null, setPieces: [], wetDeck: null, shafts: null });
      expect(planDrawCalls(p)).toBe(0);
    }
  });

  it('High draws everything', () => {
    const p = resolveEnvFx(FULL, 'high', false);
    expect(p.weather?.drawn).toBe(1000);
    expect(p.heightFog).toMatchObject({ sheets: 3, moving: true });
    expect(p.surface).toMatchObject({ ships: 'all', rate: 1 });
    expect(p.setPieces.map((s) => s.count)).toEqual([3, 2]);
    expect(p.wetDeck).not.toBeNull();
    expect(p.shafts?.drawn).toBe(10);
    expect(p.lightning).not.toBeNull();
  });

  it('Med thins weather and shafts and keeps the rest', () => {
    const p = resolveEnvFx(FULL, 'med', false);
    expect(p.weather?.drawn).toBe(600);
    expect(p.shafts?.drawn).toBe(5);
    expect(p.wetDeck).not.toBeNull();
    expect(p.surface?.ships).toBe('all');
    expect(p.setPieces.map((s) => s.count)).toEqual([3, 2]);
  });

  it('Low keeps grading, thin weather, still fog and lightning; drops the wet deck and shafts; one set piece per kind; player-only spray', () => {
    const p = resolveEnvFx(FULL, 'low', false);
    expect(p.grade).toEqual(FULL.grade);
    expect(p.weather?.drawn).toBe(300);
    expect(p.heightFog).toMatchObject({ sheets: 1, moving: false });
    expect(p.lightning).not.toBeNull();
    expect(p.wetDeck).toBeNull();
    expect(p.shafts).toBeNull();
    expect(p.setPieces.map((s) => s.count)).toEqual([1, 1]);
    expect(p.surface?.ships).toBe('player');
  });

  it('reduced motion: no lightning flash, still fog, shorter streaks, on every preset', () => {
    for (const level of ['low', 'med', 'high'] as const) {
      const p = resolveEnvFx(FULL, level, true);
      expect(p.lightning).toBeNull();
      expect(p.heightFog?.moving).toBe(false);
      expect(p.weather?.streak).toBeCloseTo(0.02);
      expect(p.grade).not.toBeNull();
    }
  });

  it('stays within the draw-call budget for a world with one set-piece kind of two role meshes', () => {
    const p = resolveEnvFx({ ...FULL, setPieces: [FULL.setPieces![0]] }, 'high', false);
    expect(planDrawCalls(p, 2)).toBeLessThanOrEqual(ENVFX_MAX_DRAW_CALLS);
  });

  it('ambient flashes come at fixed, increasing times', () => {
    const t = Array.from({ length: 20 }, (_, n) => flashTime(6, n));
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(t[0]).toBeGreaterThan(0);
    expect(t[19]).toBeLessThan(21 * 10);
    expect(flashTime(6, 3)).toBe(flashTime(6, 3));
    expect(flashTime(0, 1)).toBe(Infinity);
  });
});
