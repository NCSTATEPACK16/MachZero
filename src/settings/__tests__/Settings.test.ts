import { signal } from '@preact/signals';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEY_BINDINGS, defaultSettings } from '../../save/schema';
import { Settings } from '../Settings';

describe('Settings', () => {
  it('snapshots what it was given', () => {
    const d = { ...defaultSettings(), largeText: true, sfxVolume: 0.25 };
    expect(new Settings(d).snapshot()).toEqual(d);
  });

  it('notifies after changes, not on subscribe; a batch replace notifies once', () => {
    const s = new Settings(defaultSettings());
    const fn = vi.fn();
    const off = s.onChange(fn);
    expect(fn).not.toHaveBeenCalled();
    s.reducedMotion.value = true;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].reducedMotion).toBe(true);
    s.replace({ ...defaultSettings(), muted: true, colorBlind: true });
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    s.muted.value = false;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('listeners may read and write other signals (no effect cycle)', () => {
    const s = new Settings(defaultSettings());
    const store = signal(0);
    s.onChange(() => {
      store.value = store.value + 1; // what App.updateSave does with its save signal
    });
    expect(() => {
      s.muted.value = true;
      s.largeText.value = true;
    }).not.toThrow();
    expect(store.value).toBe(2);
  });

  it('binding a key moves it off any other control; a robbed control gets the swapped key', () => {
    const s = new Settings(defaultSettings());
    expect(s.bindKey('boost', 0, 'KeyA')).toBe(true); // KeyA was steer-left's primary; left keeps ArrowLeft
    expect(s.keyBindings.value.boost).toEqual(['KeyA', 'ShiftLeft', 'ShiftRight']);
    expect(s.keyBindings.value.left).toEqual(['ArrowLeft']);
    expect(s.bindKey('throttle', 0, 'KeyQ')).toBe(true); // air-brake left's only key → it inherits KeyW
    expect(s.keyBindings.value.throttle).toEqual(['KeyQ', 'ArrowUp']);
    expect(s.keyBindings.value.airLeft).toEqual(['KeyW']);
    expect(s.bindKey('brake', 5, 'KeyE')).toBe(false); // appending would leave air-brake right unbound
    expect(s.keyBindings.value.airRight).toEqual(['KeyE']);
    expect(s.bindKey('brake', 5, 'KeyX')).toBe(true);
    expect(s.keyBindings.value.brake).toEqual(['KeyS', 'ArrowDown', 'KeyX']);
    s.resetKeyBindings();
    expect(s.keyBindings.value).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('refuses reserved keys', () => {
    const s = new Settings(defaultSettings());
    expect(s.bindKey('boost', 0, 'Escape')).toBe(false);
    expect(s.keyBindings.value.boost).not.toContain('Escape');
  });
});
