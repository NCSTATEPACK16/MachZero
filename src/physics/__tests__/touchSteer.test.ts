import { describe, expect, it } from 'vitest';
import { AIRBRAKE_RAMP, AIRBRAKE_START, SLIDER_LOCK, sliderControls, type SliderOut } from '../touchSteer';

const out = (): SliderOut => ({ steer: 9, airbrakeLeft: 9, airbrakeRight: 9 });

describe('sliderControls (IMPLEMENTATION §M7b)', () => {
  it('is zero at the origin', () => {
    expect(sliderControls(0, 1, 'slider', out())).toEqual({ steer: 0, airbrakeLeft: 0, airbrakeRight: 0 });
  });

  it('reaches ±1 at full lock for each sensitivity, and stays there', () => {
    for (const s of [0, 1, 2] as const) {
      const lock = SLIDER_LOCK[s];
      expect(sliderControls(lock, s, 'slider', out()).steer).toBeCloseTo(1, 10);
      expect(sliderControls(-lock, s, 'slider', out()).steer).toBeCloseTo(-1, 10);
      expect(sliderControls(lock * 3, s, 'buttons', out()).steer).toBe(1);
      expect(sliderControls(lock * 0.99, s, 'slider', out()).steer).toBeLessThan(1);
    }
    expect(SLIDER_LOCK).toEqual([80, 60, 44]);
  });

  it('follows the 1.5 curve: half travel gives 0.354', () => {
    for (const s of [0, 1, 2] as const) expect(sliderControls(SLIDER_LOCK[s] / 2, s, 'slider', out()).steer).toBeCloseTo(0.3536, 4);
  });

  it('is odd-symmetric', () => {
    for (const dx of [3, 17.5, 40, 59, 75, 90, 120]) {
      const a = sliderControls(dx, 1, 'slider', out());
      const b = sliderControls(-dx, 1, 'slider', out());
      expect(b.steer).toBeCloseTo(-a.steer, 12);
      expect(b.airbrakeLeft).toBeCloseTo(a.airbrakeRight, 12);
      expect(b.airbrakeRight).toBe(0);
      expect(a.airbrakeLeft).toBe(0);
    }
  });

  it('applies no air-brake inside full lock, nor in the first 12 points past it', () => {
    for (const s of [0, 1, 2] as const) {
      const lock = SLIDER_LOCK[s];
      for (const dx of [0, lock / 2, lock, lock + AIRBRAKE_START]) {
        const r = sliderControls(dx, s, 'slider', out());
        expect(r.airbrakeLeft + r.airbrakeRight).toBe(0);
      }
    }
  });

  it('ramps the air-brake from 12 to 32 points past full lock', () => {
    const lock = SLIDER_LOCK[1];
    expect(AIRBRAKE_START + AIRBRAKE_RAMP).toBe(32);
    expect(sliderControls(lock + 22, 1, 'slider', out()).airbrakeRight).toBeCloseTo(0.5, 10);
    expect(sliderControls(-(lock + 22), 1, 'slider', out()).airbrakeLeft).toBeCloseTo(0.5, 10);
    expect(sliderControls(lock + 32, 1, 'slider', out()).airbrakeRight).toBe(1);
    expect(sliderControls(lock + 200, 1, 'slider', out()).airbrakeRight).toBe(1);
  });

  it('never air-brakes in the buttons style', () => {
    for (const dx of [-500, -100, 100, 500]) {
      const r = sliderControls(dx, 1, 'buttons', out());
      expect(r.airbrakeLeft + r.airbrakeRight).toBe(0);
      expect(Math.abs(r.steer)).toBe(1);
    }
  });

  it('treats a non-finite travel as the origin', () => {
    expect(sliderControls(Number.NaN, 1, 'slider', out()).steer).toBe(0);
  });
});
