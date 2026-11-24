/**
 * The App's audio (IMPLEMENTATION §M6a): one object for the page's lifetime that keeps v1's public surface
 * (`attach`, `detach`, `update`, `setVolumes`, `muted`, `setMuted`, `dispose`) over the M6 parts: the engine (context
 * and graph), the SFX bank, the race sounds, the menu sounds and the render client.
 *
 * `modern` is the `music` flag. With it off, everything is v1's (the v1 golden test), apart from decision F.
 */
import { isEnabled } from '../core/features';
import type { FrameContext, IAudioSystem } from '../core/contracts';
import type { EventBus, GameBus, MenuEvents } from '../core/events';
import { AudioEngine } from './AudioEngine';
import { MenuSounds } from './MenuSounds';
import { RaceSounds } from './RaceSounds';
import { RenderClient, type RenderClientOptions } from './render/RenderClient';
import { SfxBank } from './SfxBank';
import { PRESET_IDS } from './sfx/presetMeta';
import type { SoundId, UiSoundKind } from './soundTable';

export interface AudioDebug {
  state: string;
  nodes: number;
  voices: number;
  bufferBytes: number;
  /** Milliseconds the preset batch took to render (null until it has). */
  presetsMs: number | null;
  /** Where the presets rendered: the Worker, or the main-thread fallback. */
  presetsBy: 'worker' | 'main' | null;
  /** The last 64 sound ids played. */
  played: string[];
}

export interface AudioSystemOptions {
  /** The `music` flag (default: the page's flag). */
  modern?: boolean;
  render?: RenderClientOptions;
}

export class AudioSystem implements IAudioSystem {
  readonly modern: boolean;
  readonly engine: AudioEngine;
  readonly bank: SfxBank;
  readonly race: RaceSounds;
  readonly menu: MenuSounds;
  private readonly renderOptions: RenderClientOptions;
  private render: RenderClient | null = null;
  private bus: GameBus | null = null;
  private master = 1;
  private effects = 1;
  private music = 0.7;
  private _muted = false;
  private presetsMs: number | null = null;
  private presetsBy: 'worker' | 'main' | null = null;

  /** Pass a bus to attach immediately (v1 style); the App attaches one per race instead. */
  constructor(busOrOptions?: GameBus | AudioSystemOptions, options: AudioSystemOptions = {}) {
    const opts = busOrOptions && !('on' in busOrOptions) ? busOrOptions : options;
    const bus = busOrOptions && 'on' in busOrOptions ? busOrOptions : undefined;
    this.modern = opts.modern ?? isEnabled('music');
    this.renderOptions = opts.render ?? {};
    this.engine = new AudioEngine(this.modern);
    this.bank = new SfxBank(this.engine, this.modern);
    this.race = new RaceSounds(this.engine, this.bank, this.modern);
    this.menu = new MenuSounds(this.engine, this.bank, this.modern);
    this.engine.onContext(() => this.bank.flushPending());
    if (bus) this.attach(bus);
  }

  /** Listen to one race's events (detaches from the previous race). */
  attach(bus: GameBus): void {
    this.bus = bus;
    this.race.attach(bus);
  }

  /** Stop listening to the current race and fade its continuous voices out. */
  detach(): void {
    this.race.detach();
    this.bus = null;
  }

  update(ctx: FrameContext): void {
    this.race.update(ctx);
  }

  /** Settings volumes, 0..1: MASTER, EFFECTS (sfx, ui and ambience) and MUSIC. */
  setVolumes(master: number, effects: number, music = this.music): void {
    this.master = master;
    this.effects = effects;
    this.music = music;
    this.applyLevels();
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    this.applyLevels();
    this.bus?.emit('audio:mute', { muted });
  }

  /** MONO (Settings → Sound): one channel to both speakers, every pan at 0. Modern only. */
  setMono(on: boolean): void {
    if (this.modern) this.engine.setMono(on);
  }

  /** What to do when the page is hidden (modern): the App pauses a race that is running or counting down. */
  onHidden(fn: (() => void) | null): void {
    if (this.modern) this.engine.onHidden(fn);
  }

  /** The menu bus (`App.events`): shop, results and tutorial sounds. */
  bindMenus(events: EventBus<MenuEvents>): () => void {
    return this.menu.bind(events);
  }

  /** A UI sound from the DOM (`ui/uiSounds.ts`). */
  uiSound(kind: UiSoundKind, value?: number): void {
    this.menu.ui(kind, value);
  }

  /** SOUND TEST: play one sound now, as the player's own. */
  test(id: SoundId, opts: { pan?: number; gain?: number } = {}): boolean {
    if (!this.modern) return false;
    if (this.engine.ac?.state !== 'running') this.engine.unlock();
    return this.bank.play(id, { priority: 1, gain: opts.gain ?? 1, pan: opts.pan ?? 0, bus: id.startsWith('ui.') ? 'ui' : 'sfx' });
  }

  /**
   * Render the M6 presets (modern only). The App calls this after the first rendered frame, so nothing new happens
   * before it; nothing waits on the result.
   */
  startRendering(): void {
    if (!this.modern || this.render) return;
    this.render = new RenderClient(this.renderOptions);
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    void this.render.renderPresets(PRESET_IDS, 44100).then((res) => {
      for (const [id, data] of res.samples) this.bank.addRendered(id, data, res.sampleRate);
      this.presetsMs = res.ms ?? (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      this.presetsBy = res.by;
    });
  }

  debug(): AudioDebug {
    return {
      state: this.engine.state,
      nodes: this.engine.nodeCount,
      voices: this.bank.activeVoices,
      bufferBytes: this.bank.bufferBytes,
      presetsMs: this.presetsMs,
      presetsBy: this.presetsBy,
      played: [...this.bank.played],
    };
  }

  dispose(): void {
    this.detach();
    this.menu.dispose();
    this.render?.dispose();
    this.engine.dispose();
  }

  private applyLevels(): void {
    this.engine.setLevels({ master: this.master, music: this.music, effects: this.effects, muted: this._muted });
  }
}
