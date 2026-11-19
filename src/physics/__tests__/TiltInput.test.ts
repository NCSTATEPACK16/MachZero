import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../core/config';
import { TILT_FRESH_MS, TiltInput } from '../TiltInput';

function rig(sign: 1 | -1 = 1, angle: 0 | 90 | 180 | 270 = 90) {
  let t = 1000;
  const target = new EventTarget() as unknown as Window;
  const tilt = new TiltInput(target, () => t, sign, () => angle);
  return { tilt, advance: (ms: number) => (t += ms) };
}

describe('TiltInput (IMPLEMENTATION §M7c)', () => {
  it('steers right for a clockwise turn, smoothed, and is fresh only while data arrives', () => {
    const { tilt, advance } = rig();
    expect(tilt.fresh).toBe(false);
    const r = (70 * Math.PI) / 180; // landscape (90) turned 20° clockwise
    tilt.feed(Math.sin(r) * 9.81, Math.cos(r) * 9.81);
    expect(tilt.fresh).toBe(true);
    let s = 0;
    for (let i = 0; i < 120; i++) s = tilt.update(CONFIG.FIXED_DT, 0, 1);
    expect(s).toBeCloseTo((20 - 3) / (25 - 3), 3);
    advance(TILT_FRESH_MS + 1);
    expect(tilt.fresh).toBe(false);
  });

  it('normalises the iOS sign in one place', () => {
    const r = (70 * Math.PI) / 180;
    const a = rig(1);
    const b = rig(-1);
    a.tilt.feed(Math.sin(r) * 9.81, Math.cos(r) * 9.81);
    b.tilt.feed(-Math.sin(r) * 9.81, -Math.cos(r) * 9.81);
    expect(b.tilt.currentRoll).toBeCloseTo(a.tilt.currentRoll!, 9);
  });

  it('eases to zero and reports flat when the screen lies flat', () => {
    const { tilt } = rig();
    tilt.feed(9.81, -2.5);
    for (let i = 0; i < 60; i++) tilt.update(CONFIG.FIXED_DT, 0, 2);
    tilt.feed(0.3, 0.2);
    let s = 1;
    for (let i = 0; i < 240; i++) s = tilt.update(CONFIG.FIXED_DT, 0, 2);
    expect(Math.abs(s)).toBeLessThan(1e-3);
    expect(tilt.flat).toBe(true);
    expect(tilt.currentRoll).toBeNull();
  });

  it('listens to devicemotion between start and stop', () => {
    const target = new EventTarget();
    const tilt = new TiltInput(target as unknown as Window, () => 0, 1, () => 0);
    const fire = () => {
      const e = new Event('devicemotion');
      Object.assign(e, { accelerationIncludingGravity: { x: 0, y: 9.81, z: 0 } });
      target.dispatchEvent(e);
    };
    fire();
    expect(tilt.fresh).toBe(false);
    tilt.start();
    fire();
    expect(tilt.fresh).toBe(true);
    tilt.stop();
    expect(tilt.fresh).toBe(false);
  });
});
