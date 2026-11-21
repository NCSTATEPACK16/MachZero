/**
 * Live settings as Preact signals. UI binds to the signals directly; systems subscribe with `onChange`
 * (called with a full snapshot after every change) and the App persists that snapshot into the save.
 */
import { batch, effect, signal, untracked } from '@preact/signals';
import type { KeyBindings } from '../core/contracts';
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_PAD_BINDINGS,
  PAD_CONTROLS,
  RESERVED_CODES,
  cloneBindings,
  clonePadBindings,
  defaultTouch,
  sanitizeSettings,
  type GhostSettings,
  type HudSize,
  type PadBindings,
  type PadControl,
  type QualitySetting,
  type SettingsData,
  type TouchSettings,
} from '../save/schema';

/** START always pauses (menu buttons are fixed), so it cannot drive. */
export const PAD_START = 9;

export class Settings {
  readonly masterVolume = signal(0);
  readonly musicVolume = signal(0);
  readonly sfxVolume = signal(0);
  readonly muted = signal(false);
  readonly reducedMotion = signal(false);
  readonly colorBlind = signal(false);
  readonly hudSize = signal<HudSize>('normal');
  readonly haptics = signal(true);
  readonly perfPanel = signal(false);
  readonly keyBindings = signal<KeyBindings>(cloneBindings(DEFAULT_KEY_BINDINGS));
  readonly quality = signal<QualitySetting>('auto');
  readonly detectedQuality = signal<SettingsData['detectedQuality']>(null);
  readonly touch = signal<TouchSettings>(defaultTouch());
  readonly padBindings = signal<PadBindings>(clonePadBindings(DEFAULT_PAD_BINDINGS));
  /** Time Trial ghosts (IMPLEMENTATION §M8b). */
  readonly ghosts = signal<GhostSettings>({ best: true, dev: true });

  constructor(initial: SettingsData) {
    this.replace(initial);
  }

  /** Overwrite every setting (e.g. after an import). Values are sanitised. */
  replace(data: SettingsData): void {
    const d = sanitizeSettings(data);
    batch(() => {
      this.masterVolume.value = d.masterVolume;
      this.musicVolume.value = d.musicVolume;
      this.sfxVolume.value = d.sfxVolume;
      this.muted.value = d.muted;
      this.reducedMotion.value = d.reducedMotion;
      this.colorBlind.value = d.colorBlind;
      this.hudSize.value = d.hudSize;
      this.haptics.value = d.haptics;
      this.perfPanel.value = d.perfPanel;
      this.keyBindings.value = d.keyBindings;
      this.quality.value = d.quality;
      this.detectedQuality.value = d.detectedQuality;
      this.touch.value = d.touch;
      this.padBindings.value = d.padBindings;
      this.ghosts.value = d.ghosts;
    });
  }

  snapshot(): SettingsData {
    return {
      masterVolume: this.masterVolume.value,
      musicVolume: this.musicVolume.value,
      sfxVolume: this.sfxVolume.value,
      muted: this.muted.value,
      reducedMotion: this.reducedMotion.value,
      colorBlind: this.colorBlind.value,
      hudSize: this.hudSize.value,
      haptics: this.haptics.value,
      perfPanel: this.perfPanel.value,
      keyBindings: cloneBindings(this.keyBindings.value),
      quality: this.quality.value,
      detectedQuality: this.detectedQuality.value,
      touch: { ...this.touch.value },
      padBindings: clonePadBindings(this.padBindings.value),
      ghosts: { ...this.ghosts.value },
    };
  }

  /**
   * Bind `code` to slot `slot` of `control` (a slot past the end appends). If another control used the key,
   * it moves; a control left with no key inherits the key it was swapped for. Returns false when the key is
   * reserved or the change would leave a control unbound.
   */
  bindKey(control: keyof KeyBindings, slot: number, code: string): boolean {
    if (RESERVED_CODES.has(code)) return false;
    const next = cloneBindings(this.keyBindings.value);
    const list = next[control];
    const replaced = slot < list.length ? list[slot] : undefined;
    if (replaced === code) return true;
    if (replaced !== undefined) list[slot] = code;
    else list.push(code);
    next[control] = list.filter((c, i) => list.indexOf(c) === i);
    let robbed: keyof KeyBindings | null = null;
    for (const k of Object.keys(next) as (keyof KeyBindings)[]) {
      if (k === control || !next[k].includes(code)) continue;
      robbed = k;
      next[k] = next[k].filter((c) => c !== code);
    }
    if (robbed && next[robbed].length === 0) {
      if (replaced === undefined) return false;
      next[robbed] = [replaced];
    }
    this.keyBindings.value = sanitizeSettings({ ...this.snapshot(), keyBindings: next }).keyBindings;
    return true;
  }

  /** Change some touch settings (sanitised; the rest stay). */
  setTouch(patch: Partial<TouchSettings>): void {
    this.touch.value = sanitizeSettings({ ...this.snapshot(), touch: { ...this.touch.value, ...patch } }).touch;
  }

  /**
   * Bind pad button `index` to slot `slot` of `control` (a slot past the end appends; at most two per control). The
   * same rules as bindKey: a button moves off the control that had it, and a control left with no button inherits the
   * one it was swapped for. Returns false when the change would leave a control unbound or the index is not 0–15.
   */
  bindPad(control: PadControl, slot: number, index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index > 15 || index === PAD_START) return false;
    const next = clonePadBindings(this.padBindings.value);
    const list = next[control];
    const replaced = slot < list.length ? list[slot] : undefined;
    if (replaced === index) return true;
    if (replaced !== undefined) list[slot] = index;
    else if (list.length < 2) list.push(index);
    else return false;
    next[control] = list.filter((b, i) => list.indexOf(b) === i);
    let robbed: PadControl | null = null;
    for (const k of PAD_CONTROLS) {
      if (k === control || !next[k].includes(index)) continue;
      robbed = k;
      next[k] = next[k].filter((b) => b !== index);
    }
    if (robbed && next[robbed].length === 0) {
      if (replaced === undefined) return false;
      next[robbed] = [replaced];
    }
    this.padBindings.value = sanitizeSettings({ ...this.snapshot(), padBindings: next }).padBindings;
    return true;
  }

  resetPadBindings(): void {
    this.padBindings.value = clonePadBindings(DEFAULT_PAD_BINDINGS);
  }

  resetKeyBindings(): void {
    this.keyBindings.value = cloneBindings(DEFAULT_KEY_BINDINGS);
  }

  /** Calls `fn` after every change (not immediately). Returns an unsubscribe. */
  onChange(fn: (s: SettingsData) => void): () => void {
    let first = true;
    return effect(() => {
      const snap = this.snapshot();
      if (first) {
        first = false;
        return;
      }
      // Untracked: listeners (e.g. the App persisting the save) must not become dependencies of this effect.
      untracked(() => fn(snap));
    });
  }
}
