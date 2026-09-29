import { CONFIG } from '../core/config';
import type { FrameContext, IAudioSystem, ShipId } from '../core/contracts';
import type { GameBus } from '../core/events';
import { clamp } from '../core/math';

/** Sound is audible for ships this close to the player (m); the player itself is always audible. */
const HEARING_RANGE = 60;
const MASTER_LEVEL = 0.8;
const MAX_ONE_SHOTS = 28;
const UPDATE_INTERVAL = 1 / 40;
const NOISE_SECONDS = 2;

type Osc = OscillatorType;

interface ToneOptions {
  freqEnd?: number;
  delay?: number;
  attack?: number;
}

interface NoiseOptions {
  filter: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  delay?: number;
  attack?: number;
}

/** Fully procedural Web Audio: engine, wind, scrape, pit hum and one-shot effects. Browser only. */
export class AudioSystem implements IAudioSystem {
  private _muted = false;

  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // persistent voices
  private engineOscs: OscillatorNode[] = [];
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private boostOsc: OscillatorNode | null = null;
  private boostGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private scrapeFilter: BiquadFilterNode | null = null;
  private scrapeGain: GainNode | null = null;
  private humOscs: OscillatorNode[] = [];
  private humGain: GainNode | null = null;

  private frame: FrameContext | null = null;
  private voices = 0;
  private accum = 0;
  private scrape = 0;
  private alarmClock = 1;
  private readonly lastImpact = new Map<ShipId, number>();
  private readonly offs: Array<() => void> = [];
  private listening = false;

  constructor(bus: GameBus) {
    this.offs.push(
      bus.on('race:countdown', (e) => this.onCountdown(e.value)),
      bus.on('ship:boost', (e) => this.onBoost(e.shipId)),
      bus.on('ship:railHit', (e) => this.onRailHit(e.shipId, e.intensity)),
      bus.on('ship:shipHit', (e) => this.onShipHit(e.a, e.b, e.intensity)),
      bus.on('ship:dash', (e) => this.onDash(e.shipId)),
      bus.on('ship:pit', (e) => {
        if (e.active && this.isPlayer(e.shipId)) {
          this.tone(660, 0.12, 'sine', 0.12);
          this.tone(990, 0.16, 'sine', 0.12, { delay: 0.1 });
        }
      }),
      bus.on('ship:lowEnergy', (e) => {
        if (this.isPlayer(e.shipId)) {
          this.alarm();
          this.alarmClock = 0;
        }
      }),
      bus.on('ship:destroyed', (e) => this.onDestroyed(e.shipId)),
      bus.on('race:lap', (e) => {
        if (!this.isPlayer(e.shipId)) return;
        if (e.lap === CONFIG.TOTAL_LAPS - 1) this.finalLapFanfare();
        else this.lapChime(e.isRecord);
      }),
      bus.on('race:finish', (e) => {
        if (this.isPlayer(e.shipId)) this.finishFanfare(e.position === 1);
      }),
    );

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      window.addEventListener('pointerdown', this.unlock, { passive: true });
      window.addEventListener('keydown', this.unlock, { passive: true });
      window.addEventListener('touchstart', this.unlock, { passive: true });
      this.listening = true;
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.ac && this.master) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, this.ac.currentTime, 0.02);
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('machzero:mute', { detail: { muted } }));
    }
  }

  // ---------------------------------------------------------------------
  // Context lifecycle
  // ---------------------------------------------------------------------

  private readonly unlock = (): void => {
    if (!this.ac) this.build();
    const ac = this.ac;
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume().catch(() => undefined);
    if (ac.state === 'running' && this.listening) this.stopListening();
  };

  private stopListening(): void {
    this.listening = false;
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    window.removeEventListener('touchstart', this.unlock);
  }

  private readonly onVisibility = (): void => {
    const ac = this.ac;
    if (!ac) return;
    if (document.hidden) void ac.suspend().catch(() => undefined);
    else void ac.resume().catch(() => undefined);
  };

  private build(): void {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    let ac: AudioContext;
    try {
      ac = new Ctor({ latencyHint: 'interactive' });
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
    master.gain.value = this._muted ? 0 : MASTER_LEVEL;
    master.connect(compressor);
    compressor.connect(ac.destination);
    this.master = master;
    const sfx = ac.createGain();
    sfx.gain.value = 1;
    sfx.connect(master);
    this.sfx = sfx;

    // Shared white-noise buffer used by every noise source.
    const len = Math.floor(ac.sampleRate * NOISE_SECONDS);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    this.buildEngine(ac, master);
    this.buildWind(ac, master);
    this.buildScrape(ac, master);
    this.buildHum(ac, master);
  }

  private buildEngine(ac: AudioContext, out: AudioNode): void {
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 3.5;
    const gain = ac.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    gain.connect(out);
    this.engineFilter = filter;
    this.engineGain = gain;

    const layers: Array<{ type: Osc; detune: number; level: number }> = [
      { type: 'sawtooth', detune: 0, level: 0.5 },
      { type: 'sawtooth', detune: 14, level: 0.4 },
      { type: 'square', detune: -1200 + 6, level: 0.32 },
    ];
    for (const l of layers) {
      const osc = ac.createOscillator();
      osc.type = l.type;
      osc.frequency.value = 60;
      osc.detune.value = l.detune;
      const g = ac.createGain();
      g.gain.value = l.level;
      osc.connect(g);
      g.connect(filter);
      osc.start();
      this.engineOscs.push(osc);
    }

    // Boost layer: bright octave-up saw.
    const bo = ac.createOscillator();
    bo.type = 'sawtooth';
    bo.frequency.value = 120;
    const bg = ac.createGain();
    bg.gain.value = 0;
    bo.connect(bg);
    bg.connect(filter);
    bo.start();
    this.boostOsc = bo;
    this.boostGain = bg;
  }

  private noiseLoop(ac: AudioContext): AudioBufferSourceNode {
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  private buildWind(ac: AudioContext, out: AudioNode): void {
    const src = this.noiseLoop(ac);
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.6;
    const gain = ac.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(0, Math.random() * NOISE_SECONDS * 0.5);
    this.windFilter = filter;
    this.windGain = gain;
  }

  private buildScrape(ac: AudioContext, out: AudioNode): void {
    const src = this.noiseLoop(ac);
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 1.6;
    const gain = ac.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(0, Math.random() * NOISE_SECONDS * 0.5);
    this.scrapeFilter = filter;
    this.scrapeGain = gain;
  }

  private buildHum(ac: AudioContext, out: AudioNode): void {
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(out);
    for (const f of [196, 294.3, 392.6]) {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ac.createGain();
      g.gain.value = f < 250 ? 0.6 : 0.3;
      osc.connect(g);
      g.connect(gain);
      osc.start();
      this.humOscs.push(osc);
    }
    this.humGain = gain;
  }

  // ---------------------------------------------------------------------
  // Per-frame continuous voices
  // ---------------------------------------------------------------------

  update(ctx: FrameContext): void {
    this.frame = ctx;
    const ac = this.ac;
    if (!ac || ac.state !== 'running') return;

    // Scrape decays every frame; audio params are refreshed at a bounded rate.
    this.scrape = Math.max(0, this.scrape - ctx.dt * 5);
    this.accum += ctx.dt;
    if (this.accum < UPDATE_INTERVAL) return;
    const dt = this.accum;
    this.accum = 0;

    const t = ac.currentTime;
    const p = ctx.player;
    const state = ctx.race.state;
    const live = (state === 'racing' || state === 'countdown') && p.status !== 'retired';
    const driving = state === 'racing' && p.status === 'racing';
    const ratio = clamp(p.speed / CONFIG.TOP_SPEED, 0, 1.4);
    const throttle = driving ? p.lastControls.throttle : state === 'countdown' ? 0.25 : p.status === 'finished' ? 0.15 : 0;
    const boosting = live && p.boosting;

    // Engine
    const base = 46 + 150 * Math.min(ratio, 1) + 42 * Math.max(0, ratio - 1) + throttle * 14;
    const tc = 0.05;
    for (const osc of this.engineOscs) osc.frequency.setTargetAtTime(base, t, tc);
    this.boostOsc?.frequency.setTargetAtTime(base * 2.01, t, tc);
    const cutoff = 260 + 2300 * Math.min(ratio, 1.2) + throttle * 700 + (boosting ? 1400 : 0);
    this.engineFilter?.frequency.setTargetAtTime(cutoff, t, 0.08);
    const engineLevel = live ? 0.035 + 0.075 * throttle + 0.05 * Math.min(ratio, 1) : 0;
    this.engineGain?.gain.setTargetAtTime(engineLevel, t, live ? 0.08 : 0.25);
    this.boostGain?.gain.setTargetAtTime(boosting ? 0.32 : 0, t, boosting ? 0.05 : 0.2);

    // Wind
    const windLevel = live ? 0.28 * ratio * ratio : 0;
    this.windGain?.gain.setTargetAtTime(windLevel, t, 0.12);
    this.windFilter?.frequency.setTargetAtTime(350 + 2600 * Math.min(ratio, 1.3), t, 0.12);

    // Pit hum
    const humOn = live && p.inPit;
    this.humGain?.gain.setTargetAtTime(humOn ? 0.05 : 0, t, humOn ? 0.15 : 0.3);
    if (humOn) {
      const rise = 1 + (p.energy / CONFIG.ENERGY_MAX) * 0.5;
      this.humOscs.forEach((o, i) => o.frequency.setTargetAtTime([196, 294.3, 392.6][i] * rise, t, 0.2));
    }

    // Rail scrape
    this.scrapeGain?.gain.setTargetAtTime(this.scrape * 0.32, t, 0.03);
    this.scrapeFilter?.frequency.setTargetAtTime(900 + this.scrape * 3200, t, 0.04);

    // Low-energy alarm
    if (driving && p.energy < CONFIG.LOW_ENERGY_THRESHOLD && p.energy > 0) {
      this.alarmClock += dt;
      if (this.alarmClock >= 1.1) {
        this.alarmClock = 0;
        this.alarm();
      }
    } else {
      this.alarmClock = 1;
    }
  }

  // ---------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------

  private isPlayer(id: ShipId): boolean {
    return this.frame ? this.frame.player.def.id === id : id === 0;
  }

  /** 1 for the player, falling to 0 at HEARING_RANGE for other ships, 0 when unknown. */
  private nearness(id: ShipId): number {
    const f = this.frame;
    if (!f) return id === 0 ? 1 : 0;
    if (f.player.def.id === id) return 1;
    const ship = f.ships.find((s) => s.def.id === id);
    if (!ship) return 0;
    const d = ship.position.distanceTo(f.player.position);
    if (d >= HEARING_RANGE) return 0;
    const k = 1 - d / HEARING_RANGE;
    return k * k * 0.85;
  }

  private onCountdown(value: number): void {
    if (value > 0) {
      this.tone(330, 0.28, 'square', 0.16);
      this.tone(165, 0.28, 'sine', 0.2);
    } else {
      this.tone(660, 0.8, 'sawtooth', 0.14, { attack: 0.01 });
      this.tone(990, 0.8, 'square', 0.1, { attack: 0.01 });
      this.tone(1320, 0.5, 'sine', 0.12, { attack: 0.01 });
    }
  }

  private onBoost(id: ShipId): void {
    const g = this.nearness(id);
    if (g <= 0.02) return;
    this.noise(0.95, 0.55 * g, { filter: 'bandpass', f0: 350, f1: 3800, q: 1.1, attack: 0.05 });
    this.tone(110, 0.7, 'sawtooth', 0.16 * g, { freqEnd: 380, attack: 0.04 });
  }

  private onRailHit(id: ShipId, intensity: number): void {
    const g = this.nearness(id);
    if (g <= 0.02) return;
    const i = clamp(intensity, 0, 1) * g;
    this.scrape = Math.max(this.scrape, i);
    const ac = this.ac;
    if (!ac) return;
    const last = this.lastImpact.get(id) ?? -1;
    if (intensity > 0.35 && ac.currentTime - last > 0.15) {
      this.lastImpact.set(id, ac.currentTime);
      this.noise(0.2, 0.5 * i, { filter: 'lowpass', f0: 2200, f1: 180, q: 0.8 });
      this.tone(120, 0.22, 'sine', 0.45 * i, { freqEnd: 45 });
    }
  }

  private onShipHit(a: ShipId, b: ShipId, intensity: number): void {
    const g = Math.max(this.nearness(a), this.nearness(b));
    if (g <= 0.02) return;
    const i = clamp(0.35 + intensity, 0, 1) * g;
    this.noise(0.16, 0.5 * i, { filter: 'lowpass', f0: 1600, f1: 120, q: 0.9 });
    this.tone(95, 0.26, 'sine', 0.55 * i, { freqEnd: 38 });
    this.tone(210, 0.1, 'square', 0.12 * i, { freqEnd: 90 });
  }

  private onDash(id: ShipId): void {
    const g = this.nearness(id);
    if (g <= 0.02) return;
    this.tone(280, 0.3, 'sawtooth', 0.15 * g, { freqEnd: 1900, attack: 0.01 });
    this.tone(560, 0.22, 'square', 0.07 * g, { freqEnd: 2600, attack: 0.01, delay: 0.03 });
    this.noise(0.18, 0.2 * g, { filter: 'highpass', f0: 2500, q: 0.7 });
  }

  private onDestroyed(id: ShipId): void {
    const g = this.nearness(id) || 0;
    if (g <= 0.02) return;
    this.noise(1.7, 0.95 * g, { filter: 'lowpass', f0: 4200, f1: 70, q: 0.7, attack: 0.005 });
    this.tone(150, 1.5, 'sine', 0.75 * g, { freqEnd: 26 });
    this.tone(75, 1.2, 'sawtooth', 0.25 * g, { freqEnd: 22 });
  }

  private lapChime(record: boolean): void {
    this.tone(1318.5, 0.55, 'sine', 0.2);
    this.tone(1760, 0.8, 'sine', 0.18, { delay: 0.12 });
    this.tone(2637, 0.4, 'triangle', 0.06, { delay: 0.12 });
    if (record) this.tone(2093, 0.9, 'sine', 0.16, { delay: 0.26 });
  }

  private finalLapFanfare(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone(f, 0.28, 'square', 0.09, { delay: i * 0.11, attack: 0.008 });
      this.tone(f * 2, 0.28, 'sine', 0.07, { delay: i * 0.11, attack: 0.008 });
    });
    this.tone(1046.5, 0.9, 'sawtooth', 0.08, { delay: 0.46, attack: 0.01 });
    this.tone(1318.5, 0.9, 'sine', 0.1, { delay: 0.46, attack: 0.01 });
  }

  private finishFanfare(win: boolean): void {
    const notes = win ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568] : [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      this.tone(f, 0.34, 'square', 0.09, { delay: i * 0.13, attack: 0.008 });
      this.tone(f / 2, 0.34, 'sawtooth', 0.06, { delay: i * 0.13, attack: 0.008 });
    });
    const end = notes.length * 0.13;
    this.tone(1046.5, 1.4, 'sine', 0.14, { delay: end });
    this.tone(1318.5, 1.4, 'sine', 0.12, { delay: end });
    this.tone(1568, 1.4, 'sine', 0.1, { delay: end });
  }

  private alarm(): void {
    for (let i = 0; i < 3; i++) this.tone(1200, 0.09, 'square', 0.09, { delay: i * 0.16, attack: 0.005 });
  }

  // ---------------------------------------------------------------------
  // One-shot primitives (self-disconnecting, bounded)
  // ---------------------------------------------------------------------

  private tone(freq: number, dur: number, type: Osc, vol: number, opts: ToneOptions = {}): void {
    const ac = this.ac;
    const out = this.sfx;
    if (!ac || !out || this.voices >= MAX_ONE_SHOTS || vol <= 0) return;
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
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
      this.voices--;
    };
  }

  private noise(dur: number, vol: number, o: NoiseOptions): void {
    const ac = this.ac;
    const out = this.sfx;
    const buf = this.noiseBuffer;
    if (!ac || !out || !buf || this.voices >= MAX_ONE_SHOTS || vol <= 0) return;
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
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
      this.voices--;
    };
  }
}
