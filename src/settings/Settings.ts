/**
 * Live settings as Preact signals. UI binds to the signals directly; systems subscribe with `onChange`
 * (called with a full snapshot after every change) and the App persists that snapshot into the save.
 */
import { batch, effect, signal, untracked } from '@preact/signals';
import type { KeyBindings } from '../core/contracts';
import { DEFAULT_KEY_BINDINGS, RESERVED_CODES, cloneBindings, sanitizeSettings, type QualitySetting, type SettingsData, type TouchSteer } from '../save/schema';

export class Settings {
  readonly masterVolume = signal(0);
  readonly musicVolume = signal(0);
  readonly sfxVolume = signal(0);
  readonly muted = signal(false);
  readonly reducedMotion = signal(false);
  readonly colorBlind = signal(false);
  readonly largeText = signal(false);
  readonly keyBindings = signal<KeyBindings>(cloneBindings(DEFAULT_KEY_BINDINGS));
  readonly quality = signal<QualitySetting>('auto');
  readonly touchSteer = signal<TouchSteer>('slider');

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
      this.largeText.value = d.largeText;
      this.keyBindings.value = d.keyBindings;
      this.quality.value = d.quality;
      this.touchSteer.value = d.touchSteer;
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
      largeText: this.largeText.value,
      keyBindings: cloneBindings(this.keyBindings.value),
      quality: this.quality.value,
      touchSteer: this.touchSteer.value,
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
