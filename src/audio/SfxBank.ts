/**
 * The SFX bank (IMPLEMENTATION §M6a): plays a sound id. v1's recipes (`sfx/v1Sounds.ts`) are built per sound from v1's
 * `tone()` and `noise()` primitives, which this file keeps verbatim; the M6 presets play rendered buffers.
 *
 * With `modern` off this is v1 exactly: one-shots go straight to the sfx bus, at most 28 at once, and a sound that
 * does not fit is dropped. With `modern` on, voices come from the priority pool (decision H: a warning is never
 * dropped), a sound may be panned (decision G; MONO zeroes it), and sounds may go to the ui bus.
 */
import type { AudioEngine } from './AudioEngine';
import { PRESET_LEVELS, type PresetId } from './sfx/presetMeta';
import { V1_SOUNDS, type NoiseOptions, type SfxOut, type ToneOptions, type V1SoundId } from './sfx/v1Sounds';
import type { SoundId } from './soundTable';
import { VoicePool, type Priority } from './VoicePool';

const MAX_ONE_SHOTS = 28;
const NOISE_SECONDS = 2;
/** How many recently played sound ids `played` keeps (the e2e reads them). */
const PLAYED_KEEP = 64;

export interface PlayOptions {
  /** Level: v1's nearness or intensity (recipes scale their layers by it); presets multiply their level by it. */
  gain?: number;
  /** −1..1; ignored under MONO and with `modern` off. */
  pan?: number;
  priority?: Priority;
  bus?: 'sfx' | 'ui';
  /** A recipe's extra argument (the lap record, the win). */
  x?: number;
  /** Presets: playback rate (pitch). */
  rate?: number;
}

/** A voice the pool can steal. */
interface VoiceHandle {
  stop(at: number): void;
}

export class SfxBank {
  /** v1's count of one-shot layers alive. */
  private voices = 0;
  private readonly pool = new VoicePool();
  private readonly owners: Array<VoiceHandle | null> = new Array(28).fill(null);
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Recently played sound ids, newest last. */
  readonly played: string[] = [];
  /** Bytes of rendered preset samples held. */
  bufferBytes = 0;

  constructor(
    private readonly engine: AudioEngine,
    readonly modern: boolean,
  ) {}

  /** Rendered preset samples arrive (from the Worker or the fallback); buffers are made once the context exists. */
  private readonly pending = new Map<string, Float32Array>();

  addRendered(id: string, data: Float32Array, sampleRate: number): void {
    const ac = this.engine.ac;
    if (!ac) {
      this.pending.set(id, data);
      this.pendingRate = sampleRate;
      return;
    }
    const buf = ac.createBuffer(1, Math.max(1, data.length), sampleRate);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    if (!this.buffers.has(id)) this.bufferBytes += data.byteLength;
    this.buffers.set(id, buf);
  }

  private pendingRate = 44100;

  /** Turn samples that arrived before the context into buffers (called when the context is built). */
  flushPending(): void {
    if (!this.engine.ac || this.pending.size === 0) return;
    for (const [id, data] of this.pending) this.addRendered(id, data, this.pendingRate);
    this.pending.clear();
  }

  hasBuffer(id: string): boolean {
    return this.buffers.has(id);
  }

  buffer(id: string): AudioBuffer | null {
    return this.buffers.get(id) ?? null;
  }

  /** Pool voices alive (modern) or v1's count. */
  get activeVoices(): number {
    return this.modern ? this.pool.active : this.voices;
  }

  /** Play a sound by id. Returns false when nothing could play (no context, not rendered yet, no voice). */
  play(id: SoundId, opts: PlayOptions = {}): boolean {
    const ac = this.engine.ac;
    if (!ac) return false;
    this.note(id);
    if (id in V1_SOUNDS) {
      const out = this.output(opts);
      if (!out) return false;
      V1_SOUNDS[id as V1SoundId](out.sfx, opts.gain ?? 1, opts.x ?? 0);
      out.done();
      return true;
    }
    return this.playPreset(id as PresetId, opts);
  }

  /** Record a sound id as played (continuous voices call this as they start). */
  note(id: string): void {
    this.played.push(id);
    if (this.played.length > PLAYED_KEEP) this.played.splice(0, this.played.length - PLAYED_KEEP);
  }

  /** The node a sound's layers connect to: the bus, or a panner on it (modern). Refcounted so the panner goes when the last layer ends. */
  private output(opts: PlayOptions): { sfx: SfxOut; done(): void } | null {
    const ac = this.engine.ac;
    const bus = opts.bus === 'ui' && this.modern ? this.engine.ui : this.engine.sfx;
    if (!ac || !bus) return null;
    const priority = opts.priority ?? 1;
    const pan = this.modern && !this.engine.mono ? opts.pan ?? 0 : 0;
    if (!this.modern || pan === 0) return { sfx: this.primitives(bus, priority), done: () => undefined };
    const panner = ac.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(bus);
    this.engine.made();
    this.engine.panners.add(panner);
    let layers = 0;
    let closed = false;
    const release = (): void => {
      if (!closed || layers > 0) return;
      panner.disconnect();
      this.engine.panners.delete(panner);
      this.engine.freed();
    };
    const out = this.primitives(panner, priority, {
      start: () => layers++,
      end: () => {
        layers--;
        release();
      },
    });
    return {
      sfx: out,
      done: () => {
        closed = true;
        release();
      },
    };
  }

  // ---------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------

  private playPreset(id: PresetId, opts: PlayOptions): boolean {
    const ac = this.engine.ac;
    const buf = this.buffers.get(id);
    const base = PRESET_LEVELS[id];
    if (!ac || !buf || base === undefined) return false;
    const level = base * (opts.gain ?? 1);
    if (level <= 0) return false;
    const claim = this.claim(opts.priority ?? 1);
    if (!claim) return false;
    const bus = opts.bus === 'ui' ? this.engine.ui : this.engine.sfx;
    if (!bus) return false;
    const t0 = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = buf;
    if (opts.rate && opts.rate !== 1) src.playbackRate.value = opts.rate;
    const g = ac.createGain();
    g.gain.value = level;
    src.connect(g);
    let panner: StereoPannerNode | null = null;
    const pan = this.engine.mono ? 0 : opts.pan ?? 0;
    if (pan !== 0) {
      panner = ac.createStereoPanner();
      panner.pan.value = pan;
      g.connect(panner);
      panner.connect(bus);
      this.engine.panners.add(panner);
    } else {
      g.connect(bus);
    }
    const nodes = panner ? 3 : 2;
    this.engine.made(nodes);
    src.start(t0);
    const handle: VoiceHandle = {
      stop: (at) => {
        g.gain.cancelScheduledValues(at);
        g.gain.setTargetAtTime(0, at, 0.005);
        src.stop(at + 0.03);
      },
    };
    const token = this.own(claim, handle, t0);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      if (panner) {
        panner.disconnect();
        this.engine.panners.delete(panner);
      }
      this.engine.freed(nodes);
      this.disown(token, handle);
    };
    return true;
  }

  // ---------------------------------------------------------------------
  // The modern pool
  // ---------------------------------------------------------------------

  private claim(priority: Priority): ReturnType<VoicePool['claim']> {
    const ac = this.engine.ac;
    if (!ac) return null;
    const c = this.pool.claim(priority, ac.currentTime);
    if (c && 'steal' in c) {
      this.owners[c.steal]?.stop(ac.currentTime);
      this.owners[c.steal] = null;
    }
    return c;
  }

  private own(claim: NonNullable<ReturnType<VoicePool['claim']>>, handle: VoiceHandle, _t: number): number {
    const slot = 'slot' in claim ? claim.slot : claim.steal;
    this.owners[slot] = handle;
    return slot;
  }

  private disown(slot: number, handle: VoiceHandle): void {
    if (this.owners[slot] !== handle) return; // stolen and reused
    this.owners[slot] = null;
    this.pool.release(slot);
  }

  // ---------------------------------------------------------------------
  // v1's one-shot primitives (self-disconnecting, bounded), verbatim
  // ---------------------------------------------------------------------

  /** The primitives bound to an output node; `track` counts layers for a panner's refcount. */
  private primitives(out: AudioNode, priority: Priority, track?: { start(): void; end(): void }): SfxOut {
    return {
      tone: (freq, dur, type, vol, opts) => this.tone(out, priority, track, freq, dur, type, vol, opts),
      noise: (dur, vol, o) => this.noise(out, priority, track, dur, vol, o),
    };
  }

  /** v1: room for one more layer? Modern: a pool voice (or null). */
  private layerSlot(priority: Priority): { ok: boolean; claim: ReturnType<VoicePool['claim']> } {
    if (!this.modern) return { ok: this.voices < MAX_ONE_SHOTS, claim: null };
    const claim = this.claim(priority);
    return { ok: claim !== null, claim };
  }

  private tone(out: AudioNode, priority: Priority, track: { start(): void; end(): void } | undefined, freq: number, dur: number, type: OscillatorType, vol: number, opts: ToneOptions = {}): void {
    const ac = this.engine.ac;
    if (!ac || !out || vol <= 0) return;
    const { ok, claim } = this.layerSlot(priority);
    if (!ok) return;
    const t0 = ac.currentTime + (opts.delay ?? 0);
    const attack = Math.min(opts.attack ?? 0.006, dur * 0.5);
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    this.voices++;
    this.engine.made(2);
    track?.start();
    const handle: VoiceHandle = { stop: (at) => osc.stop(at + 0.01) };
    const slot = claim ? this.own(claim, handle, t0) : -1;
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
      this.voices--;
      this.engine.freed(2);
      if (slot >= 0) this.disown(slot, handle);
      track?.end();
    };
  }

  private noise(out: AudioNode, priority: Priority, track: { start(): void; end(): void } | undefined, dur: number, vol: number, o: NoiseOptions): void {
    const ac = this.engine.ac;
    const buf = this.engine.noiseBuffer;
    if (!ac || !out || !buf || vol <= 0) return;
    const { ok, claim } = this.layerSlot(priority);
    if (!ok) return;
    const t0 = ac.currentTime + (o.delay ?? 0);
    const attack = Math.min(o.attack ?? 0.004, dur * 0.5);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = o.filter;
    filter.Q.value = o.q ?? 1;
    filter.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) filter.frequency.exponentialRampToValueAtTime(o.f1, t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(out);
    const offset = Math.random() * Math.max(0, NOISE_SECONDS - dur - 0.1);
    src.start(t0, offset, dur + 0.05);
    this.voices++;
    this.engine.made(3);
    track?.start();
    const handle: VoiceHandle = { stop: (at) => src.stop(at + 0.01) };
    const slot = claim ? this.own(claim, handle, t0) : -1;
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
      this.voices--;
      this.engine.freed(3);
      if (slot >= 0) this.disown(slot, handle);
      track?.end();
    };
  }
}
