import { signal } from '@preact/signals';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEY_BINDINGS, defaultSettings } from '../../save/schema';
import { Settings } from '../Settings';

describe('Settings', () => {
  it('snapshots what it was given', () => {
    const d = { ...defaultSettings(), hudSize: 'large' as const, sfxVolume: 0.25 };
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
      s.hudSize.value = 'large';
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

describe('Settings pad bindings (IMPLEMENTATION §M7c)', () => {
  it('a swap moves the button and the robbed control inherits the replaced one; reset restores the defaults', async () => {
    const { DEFAULT_PAD_BINDINGS } = await import('../../save/schema');
    const s = new Settings(defaultSettings());
    expect(s.bindPad('boost', 0, 3)).toBe(true); // Ⓨ was the item button's only one: item inherits Ⓧ
    expect(s.padBindings.value.boost).toEqual([3]);
    expect(s.padBindings.value.item).toEqual([2]);
    expect(s.bindPad('throttle', 1, 5)).toBe(true); // RB replaces Ⓐ as throttle's second; air-right inherits Ⓐ
    expect(s.padBindings.value.throttle).toEqual([7, 5]);
    expect(s.padBindings.value.airRight).toEqual([0]);
    expect(s.bindPad('brake', 5, 14)).toBe(false); // brake already has two buttons
    expect(s.bindPad('airLeft', 1, 15)).toBe(false); // appending would leave item-next with nothing
    expect(s.bindPad('airLeft', 0, 16)).toBe(false);
    s.resetPadBindings();
    expect(s.padBindings.value).toEqual(DEFAULT_PAD_BINDINGS);
    // A change reaches the snapshot (and so the save).
    s.bindPad('boost', 0, 10);
    expect(s.snapshot().padBindings.boost).toEqual([10]);
  });
});
