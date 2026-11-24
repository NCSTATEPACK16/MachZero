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
import { MusicDirector, type JukeboxPick, type MusicInput } from './MusicDirector';
import { MusicPlayer } from './MusicPlayer';
import { RaceSounds } from './RaceSounds';
import { catalogEntry } from './songs/catalog';
import type { MusicId } from './songs/format';
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
  /** The music (modern): the song playing, the lift, the pause muffle, the duck (dB). */
  song: MusicId | null;
  lift: boolean;
  muffle: boolean;
  duckDb: number;
  /** ms of the last frame's audio work (RaceSounds.update, its queue, MusicPlayer.tick). */
  audioMs: number;
}

/** What the App tells the music each frame; the race's own part (the player's laps) comes from RaceSounds. */
export type MusicScene = Omit<MusicInput, 'playerLap' | 'playerFinished' | 'jukebox'>;

export interface AudioSystemOptions {
  /** The `music` flag (default: the page's flag). */
  modern?: boolean;
  render?: RenderClientOptions;
  /** Whether a song is written (default: the catalogue's `ready`); tests set it. */
  songReady?: (id: MusicId) => boolean;
}

export class AudioSystem implements IAudioSystem {
  readonly modern: boolean;
  readonly engine: AudioEngine;
  readonly bank: SfxBank;
  readonly race: RaceSounds;
  readonly menu: MenuSounds;
  /** The music player (modern only). */
  readonly player: MusicPlayer | null;
  private readonly director: MusicDirector | null;
  private lastPrepare = '';
  /** SOUND TEST's song. */
  private jukeboxPick: JukeboxPick | null = null;
  private jukeboxSeq = 0;
  /** ms of the last `update`'s work. */
  audioMs = 0;
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
    if (this.modern) {
      const music = new MusicPlayer(this.engine, { request: (id, purpose) => this.render?.renderSong(id, purpose) ?? Promise.resolve(null) });
      this.player = music;
      this.director = new MusicDirector(opts.songReady ?? ((id) => catalogEntry(id)?.ready ?? false));
      this.bank.onWarning = () => music.warning();
      this.race.music = music;
    } else {
      this.player = null;
      this.director = null;
    }
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
    if (!this.player) {
      this.race.update(ctx);
      return;
    }
    const t0 = now();
    this.race.update(ctx);
    this.player.tick();
    this.audioMs = now() - t0;
  }

  /** A frame with no race to update (the music still ticks). */
  tick(): void {
    if (!this.player) return;
    const t0 = now();
    this.player.tick();
    this.audioMs = now() - t0;
  }

  /**
   * The music's view of the game, once per frame (modern; nothing happens before the render Worker starts after
   * the first frame). The director answers a cue, which the player applies when anything changed.
   */
  setScene(scene: MusicScene): void {
    const director = this.director;
    if (!director || !this.player || !this.render) return;
    const cue = director.update({ ...scene, playerLap: this.race.playerLap, playerFinished: this.race.playerFinished, jukebox: scene.route === 'soundtest' ? this.jukeboxPick : null });
    const prepare = cue.prepare.join();
    if (cue.changed || prepare !== this.lastPrepare) {
      this.lastPrepare = prepare;
      if (cue.restart && cue.song !== null && scene.race !== 'countdown') this.player.resetRace();
      this.player.apply(cue);
    }
  }

  /** SOUND TEST: play a song (from its intro, or straight into its loop), set its lift, or stop it. */
  jukebox(cmd: { play: MusicId; fromIntro?: boolean; lift?: boolean } | { lift: boolean } | 'stop'): void {
    if (!this.player) return;
    if (this.engine.ac?.state !== 'running') this.engine.unlock();
    if (cmd === 'stop') this.jukeboxPick = null;
    else if ('play' in cmd) this.jukeboxPick = { id: cmd.play, fromIntro: cmd.fromIntro ?? true, lift: cmd.lift ?? this.jukeboxPick?.lift ?? false, seq: ++this.jukeboxSeq };
    else if (this.jukeboxPick) this.jukeboxPick = { ...this.jukeboxPick, lift: cmd.lift };
  }

  /** SOUND TEST's song now. */
  get jukeboxSong(): JukeboxPick | null {
    return this.jukeboxPick;
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
    const m = this.player?.debug();
    return {
      state: this.engine.state,
      nodes: this.engine.nodeCount,
      voices: this.bank.activeVoices,
      bufferBytes: this.bank.bufferBytes + (m?.bufferBytes ?? 0),
      presetsMs: this.presetsMs,
      presetsBy: this.presetsBy,
      played: [...this.bank.played],
      song: m?.song ?? null,
      lift: m?.lift ?? false,
      muffle: m?.muffle ?? false,
      duckDb: m?.duckDb ?? 0,
      audioMs: this.audioMs,
    };
  }

  /** Where songs render now (SOUND TEST). */
  get renderedBy(): 'worker' | 'main' | null {
    return this.render ? (this.render.fallback ? 'main' : 'worker') : null;
  }

  dispose(): void {
    this.detach();
    this.player?.dispose();
    this.menu.dispose();
    this.render?.dispose();
    this.engine.dispose();
  }

  private applyLevels(): void {
    this.engine.setLevels({ master: this.master, music: this.music, effects: this.effects, muted: this._muted });
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
