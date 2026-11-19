import { describe, expect, it } from 'vitest';
import { TILT_DEADZONE_DEG, TILT_LOCK_DEG, calibratedNeutral, deviceRoll, tiltSteer } from '../tilt';

const G = 9.81;
/** The "up" reading of a device turned `phi` degrees counter-clockwise from upright portrait, leaning back `lean`°. */
function up(phi: number, lean = 0): [number, number] {
  const r = (phi * Math.PI) / 180;
  const k = G * Math.cos((lean * Math.PI) / 180);
  return [Math.sin(r) * k, Math.cos(r) * k];
}

describe('deviceRoll (IMPLEMENTATION §M7c)', () => {
  it('a level device reads 0 in each orientation', () => {
    expect(deviceRoll(...up(0), 0)).toBeCloseTo(0, 6);
    expect(deviceRoll(...up(90), 90)).toBeCloseTo(0, 6); // landscape, top to the left
    expect(deviceRoll(...up(-90), 270)).toBeCloseTo(0, 6); // landscape, top to the right
    expect(deviceRoll(...up(180), 180)).toBeCloseTo(0, 6);
  });

  it('a clockwise turn (as the player sees it) is positive in both landscape orientations', () => {
    for (const turn of [5, 20, 40]) {
      // Clockwise = the device's counter-clockwise angle goes down.
      expect(deviceRoll(...up(90 - turn), 90)).toBeCloseTo(turn, 6);
      expect(deviceRoll(...up(-90 - turn), 270)).toBeCloseTo(turn, 6);
      expect(deviceRoll(...up(90 + turn), 90)).toBeCloseTo(-turn, 6);
      expect(deviceRoll(...up(-90 + turn), 270)).toBeCloseTo(-turn, 6);
    }
  });

  it('leaning back does not change the roll, until the screen is too flat (null under 3 m/s²)', () => {
    expect(deviceRoll(...up(80, 60), 90)).toBeCloseTo(10, 6);
    expect(deviceRoll(...up(80, 75), 90)).toBeNull(); // 9.81 · cos 75° = 2.5 m/s²
    expect(deviceRoll(0.5, 0.5, 90)).toBeNull();
    expect(deviceRoll(Number.NaN, 9, 90)).toBeNull();
  });
});

describe('tiltSteer', () => {
  it('has a 3° deadzone round the neutral angle', () => {
    expect(tiltSteer(0, 0, 1)).toBe(0);
    expect(tiltSteer(TILT_DEADZONE_DEG, 0, 1)).toBe(0);
    expect(tiltSteer(-TILT_DEADZONE_DEG, 0, 1)).toBe(0);
    expect(tiltSteer(TILT_DEADZONE_DEG + 1, 0, 1)).toBeGreaterThan(0);
  });

  it('reaches full lock at 35 / 25 / 18°, linearly, and stays there', () => {
    expect(TILT_LOCK_DEG).toEqual([35, 25, 18]);
    for (const s of [0, 1, 2] as const) {
      const lock = TILT_LOCK_DEG[s];
      expect(tiltSteer(lock, 0, s)).toBeCloseTo(1, 10);
      expect(tiltSteer(-lock, 0, s)).toBeCloseTo(-1, 10);
      expect(tiltSteer(lock + 30, 0, s)).toBe(1);
      expect(tiltSteer((lock + TILT_DEADZONE_DEG) / 2, 0, s)).toBeCloseTo(0.5, 10);
    }
  });

  it('measures from the neutral angle', () => {
    expect(tiltSteer(-12, -12, 1)).toBe(0);
    expect(tiltSteer(13, 10, 1)).toBe(0);
    expect(tiltSteer(-12 + 25, -12, 1)).toBeCloseTo(1, 10);
  });

  it('calibration keeps the neutral within ±20°', () => {
    expect(calibratedNeutral(7.5)).toBe(7.5);
    expect(calibratedNeutral(-40)).toBe(-20);
    expect(calibratedNeutral(null)).toBe(0);
  });
});
