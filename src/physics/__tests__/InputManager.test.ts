import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../InputManager';

interface KeyInit {
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

function fakeWindow(): { win: Window; target: EventTarget } {
  const target = new EventTarget();
  return { win: target as unknown as Window, target };
}

function key(target: EventTarget, type: 'keydown' | 'keyup', code: string, init: KeyInit = {}): Event {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { code, key: '', repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...init });
  target.dispatchEvent(e);
  return e;
}

function tick(input: InputManager, n = 1): void {
  for (let i = 0; i < n; i++) input.update();
}

interface PadInit {
  axes?: number[];
  pressed?: number[];
  values?: Record<number, number>;
}

function stubPad(init: PadInit): void {
  const buttons = Array.from({ length: 16 }, (_, i) => ({
    pressed: (init.pressed ?? []).includes(i) || (init.values?.[i] ?? 0) > 0.5,
    value: init.values?.[i] ?? ((init.pressed ?? []).includes(i) ? 1 : 0),
  }));
  vi.stubGlobal('navigator', {
    getGamepads: () => [{ connected: true, axes: init.axes ?? [0, 0, 0, 0], buttons }],
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InputManager keyboard', () => {
  it('maps throttle, brake and air-brakes while held', () => {
    const { win, target } = fakeWindow();
    const input = new InputManager(win);
    key(target, 'keydown', 'KeyW');
    key(target, 'keydown', 'KeyS');
    key(target, 'keydown', 'KeyQ');
    let c = input.sample();
    expect(c).toMatchObject({ throttle: 1, brake: 1, airbrakeLeft: 1, airbrakeRight: 0, boost: false });
    key(target, 'keyup', 'KeyW');
    key(target, 'keydown', 'KeyE');
    c = input.sample();
    expect(c).toMatchObject({ throttle: 0, airbrakeRight: 1 });
    input.dispose();
  });

  it('accepts arrow keys for throttle/brake/steer', () => {
    const { win, target } = fakeWindow();
    const input = new InputManager(win);
    key(target, 'keydown', 'ArrowUp');
    key(target, 'keydown', 'ArrowRight');
    tick(input, 60);
    const c = input.sample();
    expect(c.throttle).toBe(1);
    expect(c.steer).toBeGreaterThan(0.9);
    input.dispose();
  });

  it('ramps steering smoothly and never snaps between -1 and 1', () => {
    const { win, target } = fakeWindow();
    const input = new InputManager(win);
    key(target, 'keydown', 'KeyD');
    tick(input);
    const first = input.sample().steer;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.2);
    tick(input, 120);
    expect(input.sample().steer).toBeGreaterThan(0.98);

    key(target, 'keyup', 'KeyD');
    key(target, 'keydown', 'KeyA');
    let prev = input.sample().steer;
    let maxJump = 0;
    let crossedZero = false;
    for (let i = 0; i < 120; i++) {
      tick(input);
      const s = input.sample().steer;
      maxJump = Math.max(maxJump, Math.abs(s - prev));
      if (prev > 0 && s <= 0) crossedZero = true;
      prev = s;
    }
    expect(maxJump).toBeLessThan(0.17);
    expect(crossedZero).toBe(true);
    expect(prev).toBeLessThan(-0.98);

    key(target, 'keyup', 'KeyA');
    tick(input, 120);
    expect(input.sample().steer).toBe(0);
    input.dispose();
  });

  it('boost is edge-triggered: one true sample per press, ignoring key repeat', () => {
    const { win, target } = fakeWindow();
    const input = new InputManager(win);
    key(target, 'keydown', 'Space');
    expect(input.sample().boost).toBe(true);
    expect(input.sample().boost).toBe(false);
    key(target, 'keydown', 'Space', { repeat: true });
    expect(input.sample().boost).toBe(false);
    key(target, 'keyup', 'Space');
    key(target, 'keydown', 'ShiftLeft');
    expect(input.sample().boost).toBe(true);
    expect(input.sample().boost).toBe(false);
    input.dispose();
  });

  it('consume() returns true once per press for every menu action', () => {
    const { win, target } = fakeWindow();
    const input = new InputManager(win);
    const cases: Array<[string, Parameters<InputManager['consume']>[0]]> = [
      ['Escape', 'pause'],
      ['KeyP', 'pause'],
      ['Enter', 'confirm'],
      ['Backspace', 'back'],
      ['KeyM', 'mute'],
      ['KeyR', 'restart'],
      ['ArrowUp', 'up'],
      ['ArrowDown', 'down'],
    ];
    for (const [code, action] of cases) {
      expect(input.consume(action)).toBe(false);
      key(target, 'keydown', code);
      expect(input.consume(action)).toBe(true);
      expect(input.consume(action)).toBe(false);
      key(target, 'keyup', code);
    }
    input.dispose();
  });

  it('does not repeat menu actions from key auto-repeat', () => {
    const { win, target } = fakeWindow();
    const input = new InputManager(win);
    key(target, 'keydown', 'Escape');
    expect(input.consume('pause')).toBe(true);
    key(target, 'keydown', 'Escape', { repeat: true });
    expect(input.consume('pause')).toBe(false);
    input.dispose();
  });

  it('expires unconsumed menu presses', () => {
    const { win, target } = fakeWindow();
    const input = new InputManager(win);
    key(target, 'keydown', 'Backspace');
    tick(input, 40);
    expect(input.consume('back')).toBe(false);
    input.dispose();
  });

  it('clears held keys on window blur', () => {
    const { win, target } = fakeWindow();
    const input = new InputManager(win);
    key(target, 'keydown', 'KeyW');
    key(target, 'keydown', 'KeyD');
    tick(input, 30);
    target.dispatchEvent(new Event('blur'));
    tick(input, 120);
    const c = input.sample();
    expect(c.throttle).toBe(0);
    expect(c.steer).toBe(0);
    input.dispose();
  });

  it('prevents default for game keys only, and ignores browser shortcuts', () => {
    const { win, target } = fakeWindow();
    const input = new InputManager(win);
    expect(key(target, 'keydown', 'ArrowDown').defaultPrevented).toBe(true);
    expect(key(target, 'keydown', 'Space').defaultPrevented).toBe(true);
    expect(key(target, 'keydown', 'KeyW').defaultPrevented).toBe(false);
    expect(key(target, 'keydown', 'KeyR', { metaKey: true }).defaultPrevented).toBe(false);
    expect(input.consume('restart')).toBe(false);
    input.dispose();
  });

  it('dispose removes listeners', () => {
    const { win, target } = fakeWindow();
    const input = new InputManager(win);
    input.dispose();
    key(target, 'keydown', 'KeyW');
    expect(input.sample().throttle).toBe(0);
  });
});

describe('InputManager gamepad', () => {
  it('reads triggers, bumpers and the deadzoned left stick', () => {
    const { win } = fakeWindow();
    const input = new InputManager(win);
    stubPad({ axes: [0.1, 0], values: { 7: 0.8, 6: 0.3 }, pressed: [4] });
    input.update();
    let c = input.sample();
    expect(c.steer).toBe(0);
    expect(c.throttle).toBeCloseTo(0.8, 5);
    expect(c.brake).toBeCloseTo(0.3, 5);
    expect(c.airbrakeLeft).toBe(1);
    expect(c.airbrakeRight).toBe(0);

    stubPad({ axes: [-1, 0], pressed: [5] });
    input.update();
    c = input.sample();
    expect(c.steer).toBeCloseTo(-1, 5);
    expect(c.airbrakeRight).toBe(1);
    input.dispose();
  });

  it('A and B double as throttle and brake', () => {
    const { win } = fakeWindow();
    const input = new InputManager(win);
    stubPad({ pressed: [0, 1] });
    input.update();
    const c = input.sample();
    expect(c.throttle).toBe(1);
    expect(c.brake).toBe(1);
    input.dispose();
  });

  it('boost (X/Y) and menu buttons are edge-triggered', () => {
    const { win } = fakeWindow();
    const input = new InputManager(win);
    stubPad({ pressed: [2, 9, 0] });
    input.update();
    expect(input.sample().boost).toBe(true);
    expect(input.sample().boost).toBe(false);
    expect(input.consume('pause')).toBe(true);
    expect(input.consume('confirm')).toBe(true);
    // Still held: no new edges.
    input.update();
    expect(input.sample().boost).toBe(false);
    expect(input.consume('pause')).toBe(false);
    expect(input.consume('confirm')).toBe(false);
    // Release and press again.
    stubPad({});
    input.update();
    stubPad({ pressed: [3] });
    input.update();
    expect(input.sample().boost).toBe(true);
    input.dispose();
  });

  it('merges with the keyboard using the larger steering magnitude', () => {
    const { win, target } = fakeWindow();
    const input = new InputManager(win);
    key(target, 'keydown', 'KeyD');
    tick(input, 3); // small keyboard steer
    stubPad({ axes: [-1, 0] });
    input.update();
    expect(input.sample().steer).toBeCloseTo(-1, 5);
    input.dispose();
  });

  it('works without a gamepad API (node / older browsers)', () => {
    const { win } = fakeWindow();
    const input = new InputManager(win);
    vi.stubGlobal('navigator', {});
    expect(() => input.update()).not.toThrow();
    expect(input.sample().throttle).toBe(0);
    input.dispose();
  });
});
