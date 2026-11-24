/**
 * The audio context and the mix graph (IMPLEMENTATION §M6.1, decisions B, I, J, K). Owned by the App for the page's
 * lifetime through `AudioSystem`.
 *
 * With `modern` off (`music` off) the graph and the context's life are v1's exactly: master (MASTER × 0.8) → the v1
 * compressor → destination, the sfx bus under the master, the context created on the first input and suspended and
 * resumed with the page's visibility. The v1 golden test holds it to that.
 *
 * With `modern` on: four buses (music, sfx, ui, ambience) under the master, then the compressor, a limiter and a tanh
 * soft clip (ceiling −3 dBFS), and a mono node while MONO is on; `navigator.audioSession.type = 'ambient'` before the
 * context (the ringer switch); a hidden page pauses the race and suspends the context; a visible one resumes it and
 * raises the master from silence over 0.5 s; `touchend` also unlocks, and the unlock listeners come back whenever the
 * context is not running after a resume (iOS can leave it `interrupted`).
 */
import { clamp } from '../core/math';

/** v1's master level at MASTER = 1. */
export const MASTER_LEVEL = 0.8;
/** The music bus's fixed trim against the effects (−6 dB). */
export const MUSIC_TRIM = 0.5;
/** The ui bus's level against EFFECTS. */
export const UI_LEVEL = 0.7;
/** The ambience bus's level against EFFECTS (× the speed fade, M6d). */
export const AMBIENCE_LEVEL = 0.35;
/** Slider changes ramp with this time constant (v1's). */
export const LEVEL_TAU = 0.02;
/** The master rises from silence over this long when the page is shown again. */
export const RESUME_FADE = 0.5;
/** The soft clip's ceiling (−3 dBFS). */
export const CLIP_CEILING = 0.708;
const NOISE_SECONDS = 2;

export interface EngineLevels {
  master: number;
  music: number;
  effects: number;
  muted: boolean;
}

type Ctor = new (opts?: AudioContextOptions) => AudioContext;

/** Build the soft clip's curve: tanh, scaled so the output never exceeds `ceiling`. */
export function softClipCurve(points = 2048, ceiling = CLIP_CEILING): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = ceiling * Math.tanh(x / ceiling);
  }
  return curve;
}

export class AudioEngine {
  ac: AudioContext | null = null;
  master: GainNode | null = null;
  compressor: DynamicsCompressorNode | null = null;
  /** The sfx bus (race sounds); with `modern` off, v1's only bus. */
  sfx: GainNode | null = null;
  /** Modern only. */
  music: GainNode | null = null;
  ui: GainNode | null = null;
  ambience: GainNode | null = null;
  limiter: DynamicsCompressorNode | null = null;
  clip: WaveShaperNode | null = null;
  monoNode: GainNode | null = null;
  noiseBuffer: AudioBuffer | null = null;

  /** Every node audio code has alive (the fixed graph and every voice): the §M6.5 budget. */
  nodeCount = 0;
  mono = false;
  /** Panners alive, so MONO can zero them. */
  readonly panners = new Set<StereoPannerNode>();

  private levels: EngineLevels = { master: 1, music: 0.7, effects: 1, muted: false };
  private listening = false;
  private readonly contextListeners: Array<(ac: AudioContext) => void> = [];
  private hiddenHandler: (() => void) | null = null;
  private readonly hasDom: boolean;

  constructor(readonly modern: boolean) {
    this.hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
    if (this.hasDom) {
      this.listen();
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  /** Run `fn` when the context exists (now, if it already does). Voices are built here. */
  onContext(fn: (ac: AudioContext) => void): void {
    this.contextListeners.push(fn);
    if (this.ac) fn(this.ac);
  }

  /** Modern: what to do when the page is hidden (the App pauses a race that is running or counting down). */
  onHidden(fn: (() => void) | null): void {
    this.hiddenHandler = fn;
  }

  get state(): string {
    return this.ac ? this.ac.state : 'none';
  }

  get running(): boolean {
    return this.ac?.state === 'running';
  }

  setLevels(levels: EngineLevels): void {
    this.levels = { master: clamp(levels.master, 0, 1), music: clamp(levels.music, 0, 1), effects: clamp(levels.effects, 0, 1), muted: levels.muted };
    this.applyLevels();
  }

  get muted(): boolean {
    return this.levels.muted;
  }

  setMono(on: boolean): void {
    if (this.mono === on) return;
    this.mono = on;
    this.wireOutput();
    const ac = this.ac;
    if (on && ac) for (const p of this.panners) p.pan.setTargetAtTime(0, ac.currentTime, LEVEL_TAU);
  }

  /** Count nodes made by audio code (`made`) and released at `disconnect` (`freed`). */
  made(n = 1): void {
    this.nodeCount += n;
  }
  freed(n = 1): void {
    this.nodeCount = Math.max(0, this.nodeCount - n);
  }

  dispose(): void {
    if (this.listening) this.stopListening();
    if (this.hasDom) document.removeEventListener('visibilitychange', this.onVisibility);
    void this.ac?.close().catch(() => undefined);
    this.ac = null;
  }

  // ---------------------------------------------------------------------
  // Levels
  // ---------------------------------------------------------------------

  private masterLevel(): number {
    return this.levels.muted ? 0 : MASTER_LEVEL * this.levels.master;
  }

  private applyLevels(): void {
    if (!this.ac || !this.master || !this.sfx) return;
    const t = this.ac.currentTime;
    this.master.gain.setTargetAtTime(this.masterLevel(), t, LEVEL_TAU);
    this.sfx.gain.setTargetAtTime(this.levels.effects, t, LEVEL_TAU);
    if (!this.modern) return;
    this.music?.gain.setTargetAtTime(this.levels.music * MUSIC_TRIM, t, LEVEL_TAU);
    this.ui?.gain.setTargetAtTime(this.levels.effects * UI_LEVEL, t, LEVEL_TAU);
    this.ambience?.gain.setTargetAtTime(this.levels.effects * AMBIENCE_LEVEL, t, LEVEL_TAU);
  }

  // ---------------------------------------------------------------------
  // Context lifecycle
  // ---------------------------------------------------------------------

  private listen(): void {
    window.addEventListener('pointerdown', this.unlock, { passive: true });
    window.addEventListener('keydown', this.unlock, { passive: true });
    window.addEventListener('touchstart', this.unlock, { passive: true });
    if (this.modern) window.addEventListener('touchend', this.unlock, { passive: true });
    this.listening = true;
  }

  private stopListening(): void {
    this.listening = false;
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    window.removeEventListener('touchstart', this.unlock);
    if (this.modern) window.removeEventListener('touchend', this.unlock);
  }

  /** Create the context on the first input; resume it on every later one until it runs. */
  readonly unlock = (): void => {
    if (!this.ac) this.build();
    const ac = this.ac;
    if (!ac) return;
    if (ac.state === 'suspended' || (ac.state as string) === 'interrupted') void ac.resume().catch(() => undefined);
    if (ac.state === 'running' && this.listening) this.stopListening();
  };

  private readonly onVisibility = (): void => {
    const ac = this.ac;
    if (!this.modern) {
      if (!ac) return;
      if (document.hidden) void ac.suspend().catch(() => undefined);
      else void ac.resume().catch(() => undefined);
      return;
    }
    if (document.hidden) {
      this.hiddenHandler?.();
      if (ac) void ac.suspend().catch(() => undefined);
      return;
    }
    if (!ac) return;
    const master = this.master;
    if (master) {
      const t = ac.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0, t);
      master.gain.linearRampToValueAtTime(this.masterLevel(), t + RESUME_FADE);
    }
    void ac
      .resume()
      .catch(() => undefined)
      .then(() => {
        if (this.ac === ac && ac.state !== 'running' && !this.listening) this.listen();
      });
  };

  private build(): void {
    if (this.modern) setAmbientSession();
    const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    const C = w.AudioContext ?? w.webkitAudioContext;
    if (!C) return;
    let ac: AudioContext;
    try {
      ac = new C({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    this.ac = ac;

    const compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    const master = ac.createGain();
    master.gain.value = this.masterLevel();
    master.connect(compressor);
    this.compressor = compressor;
    if (this.modern) this.buildOutput(ac, compressor);
    else compressor.connect(ac.destination);
    this.master = master;
    const sfx = ac.createGain();
    sfx.gain.value = this.levels.effects;
    sfx.connect(master);
    this.sfx = sfx;
    this.made(3);
    if (this.modern) this.buildBuses(ac, master);

    // Shared white-noise buffer used by every noise source.
    const len = Math.floor(ac.sampleRate * NOISE_SECONDS);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    for (const fn of this.contextListeners) fn(ac);
  }

  /** Modern: compressor → limiter → soft clip → (mono) → destination. */
  private buildOutput(ac: AudioContext, compressor: DynamicsCompressorNode): void {
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    const clip = ac.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';
    const mono = ac.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    mono.channelInterpretation = 'speakers';
    compressor.connect(limiter);
    limiter.connect(clip);
    mono.connect(ac.destination);
    this.limiter = limiter;
    this.clip = clip;
    this.monoNode = mono;
    this.made(3);
    this.wireOutput();
  }

  private wireOutput(): void {
    const ac = this.ac;
    const clip = this.clip;
    const mono = this.monoNode;
    if (!ac || !clip || !mono) return;
    clip.disconnect();
    clip.connect(this.mono ? mono : ac.destination);
  }

  private buildBuses(ac: AudioContext, master: GainNode): void {
    const bus = (level: number): GainNode => {
      const g = ac.createGain();
      g.gain.value = level;
      g.connect(master);
      return g;
    };
    this.music = bus(this.levels.music * MUSIC_TRIM);
    this.ui = bus(this.levels.effects * UI_LEVEL);
    this.ambience = bus(this.levels.effects * AMBIENCE_LEVEL);
    this.made(3);
  }
}

/** The ringer switch is respected: an `ambient` audio session (Safari 16.4+), set before the context exists. */
export function setAmbientSession(): void {
  try {
    const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { audioSession?: { type: string } }) | undefined;
    if (nav && 'audioSession' in nav && nav.audioSession) nav.audioSession.type = 'ambient';
  } catch {
    // Not supported: the default session behaves the same on iOS.
  }
}
