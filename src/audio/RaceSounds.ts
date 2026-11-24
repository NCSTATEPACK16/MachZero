/**
 * Race sounds (IMPLEMENTATION §M6a, §M6.2): one race's bus at a time, the continuous voices (v1's engine, boost, wind,
 * scrape and pit hum; with `modern`, the ice crackle and the three hazard telegraphs), and the sounds read from the
 * hazard timelines.
 *
 * Decision F: the race bus emits from inside the physics step, so the handlers here only queue the event; `update`
 * drains the queue once per rendered frame, after physics, and only then builds nodes. A sound can start up to one
 * frame later than in v1; with `modern` off, nothing else differs from v1 (the v1 golden test).
 */
import { Vector3 } from 'three';
import { CONFIG } from '../core/config';
import type { FrameContext, ShipId, ShipState } from '../core/contracts';
import type { GameBus, GameEvents } from '../core/events';
import { clamp } from '../core/math';
import { buildGates, gateWarning, type BuiltGate } from '../track/features/gate';
import { buildGeysers, GEYSER_TIME, GEYSER_WARNING, geyserActive, geyserWarning } from '../track/features/geyser';
import { buildJets, JET_TIME, JET_WARNING, jetActive, jetWarning } from '../track/features/jet';
import { buildStrikes, STRIKE_TIME, STRIKE_WARNING, strikeActive, strikeWarning } from '../track/features/lightning';
import type { TimedPoint } from '../track/features/timedField';
import type { AudioEngine } from './AudioEngine';
import type { PlayOptions, SfxBank } from './SfxBank';
import type { SoundId } from './soundTable';
import type { Priority } from './VoicePool';

/** Sound is audible for ships this close to the player (m); the player itself is always audible. */
export const HEARING_RANGE = 60;
const UPDATE_INTERVAL = 1 / 40;
/** Metres inside which an armed mine ahead of the player beeps. */
const MINE_BEEP_RANGE = 70;
/** Decision F's queue length; on overflow the lowest priority goes. */
export const QUEUE_MAX = 64;
/** Decision G: metres to the side for a full pan, and the widest pan. */
export const PAN_METRES = 30;
export const PAN_MAX = 0.8;
/** Decision D: race sounds fade to silence this fast when the race pauses (time constant). */
const PAUSE_TAU = 0.08 / 3;
/** The telegraphs: how far ahead a warning is heard, and how far a hazard going off is heard. */
const TELEGRAPH_RANGE = 80;
const GATE_RANGE = 80;
const BOLT_RANGE = 120;
const BLAST_RANGE = 100;

type Osc = OscillatorType;

type Queued = { [K in keyof GameEvents]: { type: K; e: GameEvents[K]; prio: Priority } }[keyof GameEvents];

interface Telegraph {
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** Base playback rate (pitch rises with the warning). */
  level: number;
}

type TelegraphId = 'lightning.charge' | 'geyser.rumble' | 'jet.hiss';

/** Pan for a point seen from the player: its distance along the player's right axis (+X), over PAN_METRES, clamped. */
export function panFor(point: Vector3, player: Pick<ShipState, 'position' | 'quaternion'>, out = new Vector3()): number {
  const right = out.set(1, 0, 0).applyQuaternion(player.quaternion);
  const dx = point.x - player.position.x;
  const dy = point.y - player.position.y;
  const dz = point.z - player.position.z;
  return clamp((dx * right.x + dy * right.y + dz * right.z) / PAN_METRES, -PAN_MAX, PAN_MAX);
}

/** Built hazard timelines for one track (cached by track object). */
interface Timelines {
  track: unknown;
  gates: BuiltGate[];
  strikes: TimedPoint[];
  geysers: TimedPoint[];
  jets: TimedPoint[];
  /** Per point: was it active / warning at the last check (edge detection). */
  strikeOn: boolean[];
  geyserOn: boolean[];
  jetOn: boolean[];
  gateWarn: boolean[];
}

export class RaceSounds {
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
  // modern continuous voices
  private ice: Telegraph | null = null;
  private iceOn = false;
  private readonly telegraphs = new Map<TelegraphId, Telegraph>();

  private frame: FrameContext | null = null;
  private accum = 0;
  private scrape = 0;
  private alarmClock = 1;
  private beepClock = 0;
  private readonly ahead = new Vector3();
  private readonly tmp = new Vector3();
  private readonly lastImpact = new Map<ShipId, number>();
  private readonly offs: Array<() => void> = [];
  private readonly queue: Queued[] = [];
  private timelines: Timelines | null = null;
  private paused = false;

  constructor(
    private readonly engine: AudioEngine,
    private readonly bank: SfxBank,
    readonly modern: boolean,
  ) {
    engine.onContext((ac) => {
      const out = engine.sfx!;
      this.buildEngine(ac, out);
      this.buildWind(ac, out);
      this.buildScrape(ac, out);
      this.buildHum(ac, out);
    });
  }

  /** Listen to one race's events (detaches from the previous race). */
  attach(bus: GameBus): void {
    this.detach();
    const q = <K extends keyof GameEvents>(type: K, prio: (e: GameEvents[K]) => Priority | null) =>
      bus.on(type, (e) => {
        const p = prio(e);
        if (p !== null) this.enqueue({ type, e, prio: p } as Queued);
      });
    const near = (id: ShipId): Priority => (this.isPlayer(id) ? 1 : 2);
    this.offs.push(
      q('race:countdown', () => 0),
      q('ship:boost', (e) => near(e.shipId)),
      q('ship:draft', (e) => (e.active ? 3 : null)),
      q('ship:railHit', (e) => near(e.shipId)),
      q('ship:shipHit', (e) => Math.min(near(e.a), near(e.b)) as Priority),
      q('ship:dash', (e) => near(e.shipId)),
      q('item:emp', (e) => Math.min(near(e.from), near(e.target)) as Priority),
      q('hazard:mine', (e) => near(e.shipId)),
      q('hazard:geyser', (e) => near(e.shipId)),
      q('hazard:jet', (e) => near(e.shipId)),
      q('item:use', (e) => near(e.shipId)),
      q('item:shield', (e) => near(e.shipId)),
      q('item:warn', () => 0),
      q('item:fail', () => 1),
      q('ship:pit', () => 1),
      q('ship:lowEnergy', () => 0),
      q('ship:destroyed', (e) => near(e.shipId)),
      q('race:lap', () => 1),
      q('race:finish', () => 1),
    );
    if (this.modern) {
      this.offs.push(
        q('ship:respawn', () => 1),
        q('ship:jump', (e) => near(e.shipId)),
        q('ship:land', (e) => (e.intensity >= 0.15 ? near(e.shipId) : null)),
        q('ship:ice', () => 1),
        q('ship:wind', (e) => (e.active ? 1 : null)),
        q('hazard:gate', (e) => near(e.shipId)),
        q('hazard:debris', (e) => near(e.shipId)),
        q('hazard:lightning', (e) => near(e.shipId)),
        q('race:state', () => 1),
      );
    }
  }

  /** Stop listening to the current race and fade its continuous voices out. */
  detach(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.queue.length = 0;
    this.frame = null;
    this.scrape = 0;
    this.lastImpact.clear();
    this.timelines = null;
    this.paused = false;
    this.iceOn = false;
    const ac = this.engine.ac;
    if (!ac) return;
    const t = ac.currentTime;
    for (const g of [this.engineGain, this.boostGain, this.windGain, this.scrapeGain, this.humGain]) g?.gain.setTargetAtTime(0, t, 0.08);
    if (this.modern) this.silenceModern(t, 0.08);
  }

  /** Events waiting for the next frame (tests). */
  get queued(): number {
    return this.queue.length;
  }

  private enqueue(item: Queued): void {
    if (this.queue.length >= QUEUE_MAX) {
      // Drop the lowest priority (the newest of them), which may be this one.
      let worst = -1;
      for (let i = 0; i < this.queue.length; i++) if (worst < 0 || this.queue[i].prio >= this.queue[worst].prio) worst = i;
      if (worst < 0 || this.queue[worst].prio < item.prio) return;
      this.queue.splice(worst, 1);
    }
    this.queue.push(item);
  }

  // ---------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------

  update(ctx: FrameContext): void {
    this.frame = ctx;
    this.drain();
    const ac = this.engine.ac;
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
    // Decision D: a paused race fades in 80 ms (modern); v1 lets the engine fall with its own time constant.
    const fade = this.modern && state === 'paused' ? PAUSE_TAU : null;

    // Engine
    const base = 46 + 150 * Math.min(ratio, 1) + 42 * Math.max(0, ratio - 1) + throttle * 14;
    const tc = 0.05;
    for (const osc of this.engineOscs) osc.frequency.setTargetAtTime(base, t, tc);
    this.boostOsc?.frequency.setTargetAtTime(base * 2.01, t, tc);
    const cutoff = 260 + 2300 * Math.min(ratio, 1.2) + throttle * 700 + (boosting ? 1400 : 0);
    this.engineFilter?.frequency.setTargetAtTime(cutoff, t, 0.08);
    const engineLevel = live ? 0.035 + 0.075 * throttle + 0.05 * Math.min(ratio, 1) : 0;
    this.engineGain?.gain.setTargetAtTime(engineLevel, t, fade ?? (live ? 0.08 : 0.25));
    this.boostGain?.gain.setTargetAtTime(boosting ? 0.32 : 0, t, fade ?? (boosting ? 0.05 : 0.2));

    // Wind
    const windLevel = live ? 0.28 * ratio * ratio : 0;
    this.windGain?.gain.setTargetAtTime(windLevel, t, fade ?? 0.12);
    this.windFilter?.frequency.setTargetAtTime(350 + 2600 * Math.min(ratio, 1.3), t, 0.12);

    // Pit hum
    const humOn = live && p.inPit;
    this.humGain?.gain.setTargetAtTime(humOn ? 0.05 : 0, t, fade ?? (humOn ? 0.15 : 0.3));
    if (humOn) {
      const rise = 1 + (p.energy / p.def.stats.energyMax) * 0.5;
      this.humOscs.forEach((o, i) => o.frequency.setTargetAtTime([196, 294.3, 392.6][i] * rise, t, 0.2));
    }

    // Rail scrape
    this.scrapeGain?.gain.setTargetAtTime(this.scrape * 0.32, t, fade ?? 0.03);
    this.scrapeFilter?.frequency.setTargetAtTime(900 + this.scrape * 3200, t, 0.04);

    this.mineBeep(ctx, dt);

    // Low-energy alarm
    if (driving && p.energy < (CONFIG.LOW_ENERGY_THRESHOLD / 100) * p.def.stats.energyMax && p.energy > 0) {
      this.alarmClock += dt;
      if (this.alarmClock >= 1.1) {
        this.alarmClock = 0;
        this.play('alarm.energy', { priority: 0 });
      }
    } else {
      this.alarmClock = 1;
    }

    if (this.modern) this.modernUpdate(ctx, t, live);
  }

  private drain(): void {
    if (this.queue.length === 0) return;
    const items = this.queue.splice(0, this.queue.length);
    for (const item of items) this.handle(item);
  }

  private handle(item: Queued): void {
    switch (item.type) {
      case 'race:countdown':
        this.play(item.e.value > 0 ? 'countdown.beep' : 'countdown.go', { priority: 0 });
        break;
      case 'ship:boost':
        this.near('boost', item.e.shipId);
        break;
      case 'ship:draft':
        if (item.e.active && this.nearness(item.e.shipId) >= 1) this.play('draft.whoosh', { priority: 3 });
        break;
      case 'ship:railHit':
        this.onRailHit(item.e.shipId, item.e.intensity);
        break;
      case 'ship:shipHit':
        this.onShipHit(item.e.a, item.e.b, item.e.intensity);
        break;
      case 'ship:dash':
        this.near('dash', item.e.shipId);
        break;
      case 'item:emp':
        this.near('emp.fire', item.e.from);
        this.near('emp.hit', item.e.target);
        break;
      case 'hazard:mine':
        this.near('mine.blast', item.e.shipId);
        break;
      case 'hazard:geyser':
        this.near(this.modern ? 'geyser.hit' : 'mine.blast', item.e.shipId);
        break;
      case 'hazard:jet':
        this.near(this.modern ? 'jet.hit' : 'mine.blast', item.e.shipId);
        break;
      case 'item:use':
        this.near(item.e.kind === 'shield' ? 'shield.up' : 'mine.drop', item.e.shipId);
        break;
      case 'item:shield':
        this.near('shield.block', item.e.shipId);
        break;
      case 'item:warn':
        // A CPU EMP is on its way to the player: three fast alarm pips inside the 0.5 s warning.
        if (this.isPlayer(item.e.target)) this.play('alarm.emp', { priority: 0 });
        break;
      case 'item:fail':
        if (this.isPlayer(item.e.shipId)) this.play('item.fail', { priority: 1 });
        break;
      case 'ship:pit':
        if (item.e.active && this.isPlayer(item.e.shipId)) this.play('pit.enter', { priority: 1 });
        break;
      case 'ship:lowEnergy':
        if (this.isPlayer(item.e.shipId)) {
          this.play('alarm.energy', { priority: 0 });
          this.alarmClock = 0;
        }
        break;
      case 'ship:destroyed':
        this.near('ko', item.e.shipId);
        break;
      case 'race:lap':
        if (!this.isPlayer(item.e.shipId)) break;
        if (item.e.lap === CONFIG.TOTAL_LAPS - 1) this.play('lap.final', { priority: 1 });
        else this.play('lap.chime', { priority: 1, x: item.e.isRecord ? 1 : 0 });
        break;
      case 'race:finish':
        if (this.isPlayer(item.e.shipId)) this.play('finish.fanfare', { priority: 1, x: item.e.position === 1 ? 1 : 0 });
        break;
      // --- modern only (not subscribed with `modern` off) ---
      case 'ship:respawn':
        if (this.isPlayer(item.e.shipId)) this.play('respawn', { priority: 1 });
        break;
      case 'ship:jump':
        this.near('jump.launch', item.e.shipId, clamp(item.e.intensity, 0, 1));
        break;
      case 'ship:land':
        this.near('jump.land', item.e.shipId, clamp(item.e.intensity, 0, 1));
        break;
      case 'ship:ice':
        if (this.isPlayer(item.e.shipId)) this.setIce(item.e.active);
        break;
      case 'ship:wind':
        if (item.e.active && this.isPlayer(item.e.shipId)) this.play('wind.gust', { priority: 1, pan: item.e.dir * 0.6 });
        break;
      case 'hazard:gate':
        this.near('gate.hit', item.e.shipId);
        break;
      case 'hazard:debris':
        this.near('debris.hit', item.e.shipId);
        break;
      case 'hazard:lightning':
        this.near('lightning.hit', item.e.shipId);
        break;
      case 'race:state':
        this.setPaused(item.e.state === 'paused');
        break;
      default:
        break;
    }
  }

  private play(id: SoundId, opts: PlayOptions): void {
    this.bank.play(id, opts);
  }

  /** A sound at a ship: v1's nearness as its level; with `modern`, panned and at priority 2 when not the player. */
  private near(id: SoundId, shipId: ShipId, scale = 1): void {
    const g = this.nearness(shipId);
    if (g <= 0.02) return;
    const player = this.isPlayer(shipId);
    this.play(id, { gain: g * scale, priority: player ? 1 : 2, pan: this.modern && !player ? this.panOf(shipId) : 0 });
  }

  private panOf(id: ShipId): number {
    const f = this.frame;
    const ship = f?.ships.find((s) => s.def.id === id);
    if (!f || !ship) return 0;
    return panFor(ship.position, f.player, this.tmp);
  }

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

  private onRailHit(id: ShipId, intensity: number): void {
    const g = this.nearness(id);
    if (g <= 0.02) return;
    const i = clamp(intensity, 0, 1) * g;
    this.scrape = Math.max(this.scrape, i);
    const ac = this.engine.ac;
    if (!ac) return;
    const last = this.lastImpact.get(id) ?? -1;
    if (intensity > 0.35 && ac.currentTime - last > 0.15) {
      this.lastImpact.set(id, ac.currentTime);
      const player = this.isPlayer(id);
      this.play('hit.rail', { gain: i, priority: player ? 1 : 2, pan: this.modern && !player ? this.panOf(id) : 0 });
    }
  }

  private onShipHit(a: ShipId, b: ShipId, intensity: number): void {
    const g = Math.max(this.nearness(a), this.nearness(b));
    if (g <= 0.02) return;
    const i = clamp(0.35 + intensity, 0, 1) * g;
    const player = this.isPlayer(a) || this.isPlayer(b);
    this.play('hit.ship', { gain: i, priority: player ? 1 : 2, pan: this.modern && !player ? this.panOf(a) : 0 });
  }

  /** Proximity beep: the nearest armed mine ahead of the player beeps faster as it closes in. */
  private mineBeep(ctx: FrameContext, dt: number): void {
    const mines = ctx.mines;
    const p = ctx.player;
    if (!mines || ctx.race.state !== 'racing' || p.status !== 'racing') return;
    let nearest = Infinity;
    for (const m of mines) {
      if (!m.armed) continue;
      const d = m.position.distanceTo(p.position);
      if (d < nearest && this.ahead.subVectors(m.position, p.position).dot(p.velocity) > 0) nearest = d;
    }
    if (nearest > MINE_BEEP_RANGE) {
      this.beepClock = 0;
      return;
    }
    this.beepClock += dt;
    const interval = 0.08 + 0.42 * (nearest / MINE_BEEP_RANGE);
    if (this.beepClock >= interval) {
      this.beepClock = 0;
      this.play('mine.beep', { priority: 0 });
    }
  }

  // ---------------------------------------------------------------------
  // Modern: pause, ice, the hazard timelines
  // ---------------------------------------------------------------------

  private setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    const ac = this.engine.ac;
    if (!ac || !paused) return;
    const t = ac.currentTime;
    for (const g of [this.engineGain, this.boostGain, this.windGain, this.scrapeGain, this.humGain]) g?.gain.setTargetAtTime(0, t, PAUSE_TAU);
    this.silenceModern(t, PAUSE_TAU);
  }

  private silenceModern(t: number, tau: number): void {
    this.ice?.gain.gain.setTargetAtTime(0, t, tau);
    for (const v of this.telegraphs.values()) v.gain.gain.setTargetAtTime(0, t, tau);
  }

  private setIce(on: boolean): void {
    this.iceOn = on;
    const ac = this.engine.ac;
    if (!ac) return;
    const v = this.ice ?? (this.ice = this.loopVoice('ice.crackle'));
    if (!v) return;
    // 80 ms in, 200 ms out.
    v.gain.gain.setTargetAtTime(on && !this.paused ? v.level : 0, ac.currentTime, on ? 0.08 / 3 : 0.2 / 3);
  }

  /** A looping preset voice on the sfx bus, silent until its level is set. */
  private loopVoice(id: TelegraphId | 'ice.crackle'): Telegraph | null {
    const ac = this.engine.ac;
    const buf = this.bank.buffer(id);
    const out = this.engine.sfx;
    if (!ac || !buf || !out) return null;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ac.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(out);
    src.start();
    this.engine.made(2);
    const level = id === 'ice.crackle' ? 0.16 : id === 'lightning.charge' ? 0.2 : id === 'geyser.rumble' ? 0.32 : 0.22;
    return { src, gain, level };
  }

  private telegraph(id: TelegraphId): Telegraph | null {
    let v = this.telegraphs.get(id);
    if (!v) {
      const made = this.loopVoice(id);
      if (!made) return null;
      v = made;
      this.telegraphs.set(id, v);
    }
    return v;
  }

  private timelinesFor(ctx: FrameContext): Timelines {
    if (this.timelines && this.timelines.track === ctx.track) return this.timelines;
    const track = ctx.track;
    const has = (type: string) => track.features.some((f) => f.type === type);
    const gates = has('gate') ? buildGates(track).filter((g) => g.branch === null) : [];
    const strikes = has('lightning') ? buildStrikes(track) : [];
    const geysers = has('geysers') ? buildGeysers(track) : [];
    const jets = has('jets') ? buildJets(track) : [];
    this.timelines = {
      track,
      gates,
      strikes,
      geysers,
      jets,
      strikeOn: strikes.map(() => true),
      geyserOn: geysers.map(() => true),
      jetOn: jets.map(() => true),
      gateWarn: gates.map(() => true),
    };
    return this.timelines;
  }

  private modernUpdate(ctx: FrameContext, t: number, live: boolean): void {
    const tl = this.timelinesFor(ctx);
    const p = ctx.player;
    const now = ctx.hazardTime;
    const scale = ctx.telegraphScale ?? 1;
    const racing = live && ctx.race.state === 'racing';

    // Ice (the voice follows the pause and the race state).
    if (this.ice) this.ice.gain.gain.setTargetAtTime(this.iceOn && live ? this.ice.level : 0, t, this.iceOn && live ? 0.08 / 3 : 0.2 / 3);

    // Gates: a one-shot rumble when a gate ahead starts its closing warning.
    tl.gates.forEach((g, i) => {
      const w = gateWarning(g, now, 1.5 * scale);
      const warning = w > 0 && w < 1;
      if (warning && !tl.gateWarn[i] && racing) {
        const d = g.center.distanceTo(p.position);
        if (d <= GATE_RANGE && this.isAhead(g.center, p)) this.play('gate.rumble', { priority: 0, pan: g.span === 'left' ? -0.5 : g.span === 'right' ? 0.5 : 0 });
      }
      tl.gateWarn[i] = warning;
    });

    this.timedField('lightning.charge', 'lightning.bolt', tl.strikes, tl.strikeOn, (s) => strikeWarning(s, now, STRIKE_WARNING * scale), (s) => strikeActive(s, now), BOLT_RANGE, p, t, racing);
    this.timedField('geyser.rumble', 'geyser.erupt', tl.geysers, tl.geyserOn, (s) => geyserWarning(s, now, GEYSER_WARNING * scale), (s) => geyserActive(s, now), BLAST_RANGE, p, t, racing);
    this.timedField('jet.hiss', 'jet.fire', tl.jets, tl.jetOn, (s) => jetWarning(s, now, JET_WARNING * scale), (s) => jetActive(s, now), BLAST_RANGE, p, t, racing);
    void STRIKE_TIME;
    void GEYSER_TIME;
    void JET_TIME;
  }

  private isAhead(point: Vector3, p: ShipState): boolean {
    return this.ahead.subVectors(point, p.position).dot(p.velocity) > 0;
  }

  /**
   * One timed field: the telegraph follows the warning (0..1, not yet active) of the nearest point within
   * TELEGRAPH_RANGE ahead; a one-shot plays as any point within `blastRange` goes off.
   */
  private timedField(
    telegraphId: TelegraphId,
    startId: SoundId,
    points: readonly TimedPoint[],
    was: boolean[],
    warning: (p: TimedPoint) => number,
    active: (p: TimedPoint) => boolean,
    blastRange: number,
    player: ShipState,
    t: number,
    racing: boolean,
  ): void {
    if (points.length === 0) return;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const on = active(pt);
      const d = pt.position.distanceTo(player.position);
      if (on && !was[i] && racing && d <= blastRange) {
        const k = 1 - d / blastRange;
        this.play(startId, { gain: Math.max(0.15, k * k), priority: 1, pan: panFor(pt.position, player, this.tmp) });
      }
      was[i] = on;
      if (on || d > TELEGRAPH_RANGE || d >= bestD || !this.isAhead(pt.position, player)) continue;
      const w = warning(pt);
      if (w <= 0) continue;
      best = w;
      bestD = d;
    }
    const v = racing && best > 0 ? this.telegraph(telegraphId) : this.telegraphs.get(telegraphId) ?? null;
    if (!v) return;
    const level = racing ? best * v.level : 0;
    v.gain.gain.setTargetAtTime(level, t, 0.05);
    v.src.playbackRate.setTargetAtTime(0.8 + 0.6 * best, t, 0.05);
  }

  /** The telegraph voice's level now (tests). */
  telegraphLevel(id: TelegraphId): number | null {
    const v = this.telegraphs.get(id);
    return v ? v.gain.gain.value : null;
  }

  // ---------------------------------------------------------------------
  // v1's persistent voices, verbatim
  // ---------------------------------------------------------------------

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
    this.engine.made(10);
  }

  private noiseLoop(ac: AudioContext): AudioBufferSourceNode {
    const src = ac.createBufferSource();
    src.buffer = this.engine.noiseBuffer;
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
    src.start(0, Math.random() * 2 * 0.5);
    this.windFilter = filter;
    this.windGain = gain;
    this.engine.made(3);
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
    src.start(0, Math.random() * 2 * 0.5);
    this.scrapeFilter = filter;
    this.scrapeGain = gain;
    this.engine.made(3);
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
    this.engine.made(7);
  }
}
