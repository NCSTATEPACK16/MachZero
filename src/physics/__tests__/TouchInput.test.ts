import { describe, expect, it } from 'vitest';
import { neutralControls } from '../../core/controls';
import { TouchInput } from '../TouchInput';
import { SLIDER_LOCK } from '../touchSteer';

const read = (t: TouchInput) => t.read(neutralControls());

describe('TouchInput (IMPLEMENTATION §M7b)', () => {
  it('steers from where the thumb lands, with the boost under another finger at the same time', () => {
    const t = new TouchInput();
    expect(t.steerStart(1, 200)).toBe(true);
    t.steerMove(1, 200 + SLIDER_LOCK[1]);
    t.press('boost', true);
    const c = read(t);
    expect(c.steer).toBeCloseTo(1, 10);
    expect(c.boost).toBe(true);
    t.steerMove(1, 200 - SLIDER_LOCK[1] / 2);
    expect(read(t).steer).toBeCloseTo(-0.3536, 4);
  });

  it('ignores a second pointer in the steering zone', () => {
    const t = new TouchInput();
    t.steerStart(1, 100);
    expect(t.steerStart(2, 300)).toBe(false);
    t.steerMove(2, 500);
    expect(read(t).steer).toBe(0);
    expect(t.steerOrigin).toBe(100);
    t.steerEnd(2); // not the steering pointer
    t.steerMove(1, 130);
    expect(read(t).steer).toBeGreaterThan(0);
    t.steerEnd(1);
    expect(read(t).steer).toBe(0);
    expect(t.steerOrigin).toBeNull();
    // Now the second finger may steer.
    expect(t.steerStart(2, 300)).toBe(true);
  });

  it('pointercancel and releaseAll leave everything neutral', () => {
    const t = new TouchInput();
    t.steerStart(1, 100);
    t.steerMove(1, 400);
    for (const c of ['brake', 'throttle', 'airLeft', 'airRight', 'boost', 'item', 'itemNext', 'pause'] as const) t.press(c, true);
    t.releaseAll();
    const c = read(t);
    expect(c).toEqual({ ...neutralControls(), fire: false, itemCycle: 0 });
    expect(t.consumePause()).toBe(false);
    expect(t.steerOrigin).toBeNull();
  });

  it('a boost press latches exactly once; so do item, next item and pause', () => {
    const t = new TouchInput();
    t.press('boost', true);
    t.press('boost', true); // a repeated down (no up between) is the same press
    expect(read(t).boost).toBe(true);
    expect(read(t).boost).toBe(false);
    t.press('boost', false);
    t.press('boost', true);
    expect(read(t).boost).toBe(true);
    t.press('item', true);
    t.press('itemNext', true);
    const c = read(t);
    expect(c.fire).toBe(true);
    expect(c.itemCycle).toBe(1);
    expect(read(t).fire).toBe(false);
    t.press('pause', true);
    expect(t.consumePause()).toBe(true);
    expect(t.consumePause()).toBe(false);
  });

  it('holds brake, throttle and the air-brake buttons; the slider overdrive air-brakes only in the slider style', () => {
    const t = new TouchInput();
    t.press('brake', true);
    t.press('airLeft', true);
    let c = read(t);
    expect(c.brake).toBe(1);
    expect(c.airbrakeLeft).toBe(1);
    t.press('brake', false);
    t.press('airLeft', false);
    t.steerStart(1, 0);
    t.steerMove(1, SLIDER_LOCK[1] + 32);
    expect(read(t).airbrakeRight).toBe(1);
    t.setConfig({ sensitivity: 1, airbrake: 'buttons' });
    c = read(t);
    expect(c.airbrakeRight).toBe(0);
    expect(c.steer).toBe(1);
    t.setConfig({ sensitivity: 0, airbrake: 'slider' });
    expect(read(t).steer).toBeCloseTo(Math.pow((SLIDER_LOCK[1] + 32) / SLIDER_LOCK[0], 1.5) > 1 ? 1 : Math.pow((SLIDER_LOCK[1] + 32) / SLIDER_LOCK[0], 1.5), 6);
  });

  it('reports activity on presses and steering starts', () => {
    const t = new TouchInput();
    let n = 0;
    t.onActivity = () => n++;
    t.steerStart(1, 0);
    t.press('boost', true);
    t.press('boost', false);
    expect(n).toBe(2);
  });
});
