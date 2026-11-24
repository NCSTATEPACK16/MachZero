import { describe, expect, it } from 'vitest';
import { DUCKS, dbToGain, duckTarget } from '../duck';

describe('duckTarget (decision C)', () => {
  it('gives each source its own row alone', () => {
    expect(duckTarget(['countdown'])).toEqual({ db: -8, lowpassHz: null, source: 'countdown' });
    expect(duckTarget(['stinger'])).toEqual({ db: -10, lowpassHz: null, source: 'stinger' });
    expect(duckTarget(['warning'])).toEqual({ db: -4, lowpassHz: null, source: 'warning' });
    expect(duckTarget(['pause'])).toEqual({ db: -12, lowpassHz: 1200, source: 'pause' });
  });

  it('lets the deepest duck win, never adding them up', () => {
    expect(duckTarget(['countdown', 'pause'])).toEqual({ db: -12, lowpassHz: 1200, source: 'pause' });
    expect(duckTarget(['warning', 'countdown', 'stinger'])).toEqual({ db: -10, lowpassHz: null, source: 'stinger' });
  });

  it('is 0 dB with no low-pass when nothing ducks', () => {
    expect(duckTarget([])).toEqual({ db: 0, lowpassHz: null, source: null });
  });

  it('keeps the attacks and releases of the table', () => {
    expect([DUCKS.countdown.attack, DUCKS.countdown.release]).toEqual([0.05, 0.6]);
    expect([DUCKS.stinger.attack, DUCKS.stinger.release]).toEqual([0.03, 0.4]);
    expect([DUCKS.warning.attack, DUCKS.warning.release]).toEqual([0.02, 0.3]);
    expect([DUCKS.pause.attack, DUCKS.pause.release]).toEqual([0.15, 0.3]);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
  });
});
