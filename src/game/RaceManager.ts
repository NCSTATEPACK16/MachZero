import { Vector3 } from 'three';
import { CONFIG } from '../core/config';
import type {
  IRaceManager,
  RaceSnapshot,
  RaceState,
  RacerStanding,
  ShipState,
  TrackData,
  TrackSample,
} from '../core/contracts';
import type { GameBus } from '../core/events';
import { clamp, damp, loopDelta, smoothstep } from '../core/math';

/** Per-ship race bookkeeping (everything the RaceManager owns besides ShipState's GAME fields). */
interface Racer {
  ship: ShipState;
  /** Accumulated signed track progress in laps; starts at trackU - 1 (negative on the grid). */
  progress: number;
  /** Progress value at GO (used for pace estimation). */
  startProgress: number;
  prevU: number;
  /** Highest completed-lap count achieved (never decreases, so reversing cannot double count). */
  lapsDone: number;
  /** Race time at which the current lap started. */
  lapStart: number;
  lapTimes: number[];
  bestLap: number | null;
  totalTime: number | null;
  /** 1-based finish order, 0 = not finished. */
  finishOrder: number;
  standing: RacerStanding;
}

/** Distance (m) over which rubber-banding reaches its full effect. */
const RUBBER_RANGE = 350;
const RUBBER_DEAD_ZONE = 20;
const RUBBER_RATE = 1.2;
const WRONG_WAY_DOT = -0.3;
const WRONG_WAY_MIN_SPEED = 10;
const WRONG_WAY_DELAY = 0.5;
/** Progress deltas larger than this per fixed step are treated as teleports and ignored. */
const MAX_STEP_DELTA = 0.1;

function normaliseGridU(u: number): number {
  return u > 0.5 ? u - 1 : u;
}

function readRecord(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CONFIG.RECORD_STORAGE_KEY);
    if (raw === null) return null;
    const v = Number.parseFloat(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeRecord(value: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CONFIG.RECORD_STORAGE_KEY, String(value));
  } catch {
    /* storage unavailable (private mode, quota) — record simply isn't persisted */
  }
}

export class RaceManager implements IRaceManager {
  private _state: RaceState = 'title';
  private resumeState: RaceState = 'racing';

  private readonly racers: Racer[];
  private readonly playerRacer: Racer;
  private readonly sorted: RacerStanding[] = [];
  private readonly snap: RaceSnapshot;

  private raceTime = 0;
  private countdownClock = 0;
  private countdownValue = -1;
  private finishedCount = 0;
  private resultsClock = 0;
  private wrongWayClock = 0;
  private wrongWay = false;
  private recordLap: number | null;

  private readonly scratchSample: TrackSample;
  private readonly fwd = new Vector3();

  constructor(
    private readonly track: TrackData,
    ships: ShipState[],
    private readonly bus: GameBus,
  ) {
    this.racers = ships.map((ship) => ({
      ship,
      progress: normaliseGridU(ship.trackU),
      startProgress: normaliseGridU(ship.trackU),
      prevU: ship.trackU,
      lapsDone: 0,
      lapStart: 0,
      lapTimes: [],
      bestLap: null,
      totalTime: null,
      finishOrder: 0,
      standing: {
        id: ship.def.id,
        name: ship.def.name,
        position: 0,
        lap: 0,
        progress: 0,
        totalTime: null,
        bestLap: null,
        status: 'grid',
      },
    }));
    const player = this.racers.find((r) => r.ship.def.isPlayer) ?? this.racers[0];
    if (!player) throw new Error('RaceManager requires at least one ship');
    this.playerRacer = player;
    this.sorted = this.racers.map((r) => r.standing);
    this.recordLap = readRecord();
    const s0 = track.samples[0];
    this.scratchSample = {
      u: 0,
      distance: 0,
      position: new Vector3().copy(s0.position),
      forward: new Vector3().copy(s0.forward),
      up: new Vector3().copy(s0.up),
      right: new Vector3().copy(s0.right),
      roll: 0,
      curvature: 0,
      halfWidth: s0.halfWidth,
    };
    this.snap = {
      state: 'title',
      countdown: -1,
      raceTime: 0,
      lap: 1,
      totalLaps: CONFIG.TOTAL_LAPS,
      lapTimes: player.lapTimes,
      currentLapTime: 0,
      bestLap: null,
      recordLap: this.recordLap,
      standings: this.sorted,
      player: player.ship,
      wrongWay: false,
      ships,
    };
    this.resetShipFields();
  }

  get state(): RaceState {
    return this._state;
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  start(): void {
    if (this._state === 'results') this.reset();
    if (this._state !== 'title') return;
    this.syncGrid();
    this.countdownClock = 0;
    this.countdownValue = 3;
    this.setState('countdown');
    this.bus.emit('race:countdown', { value: 3 });
  }

  pause(paused: boolean): void {
    if (paused) {
      if (this._state === 'racing' || this._state === 'countdown') {
        this.resumeState = this._state;
        this.setState('paused');
      }
    } else if (this._state === 'paused') {
      this.setState(this.resumeState);
    }
  }

  reset(): void {
    this.raceTime = 0;
    this.countdownClock = 0;
    this.countdownValue = -1;
    this.finishedCount = 0;
    this.resultsClock = 0;
    this.wrongWayClock = 0;
    this.wrongWay = false;
    this.resumeState = 'racing';
    this.recordLap = readRecord();
    for (const r of this.racers) {
      r.lapsDone = 0;
      r.lapStart = 0;
      r.lapTimes.length = 0;
      r.bestLap = null;
      r.totalTime = null;
      r.finishOrder = 0;
    }
    this.resetShipFields();
    this.syncGrid();
    this.setState('title');
  }

  fixedUpdate(dt: number): void {
    switch (this._state) {
      case 'title':
        this.syncGrid();
        break;
      case 'countdown':
        this.syncGrid();
        this.tickCountdown(dt);
        break;
      case 'racing':
        this.tickRacing(dt);
        break;
      default:
        break; // paused / results: frozen
    }
  }

  snapshot(): RaceSnapshot {
    const p = this.playerRacer;
    const s = this.snap;
    this.updateStandings();
    s.state = this._state;
    s.countdown = this.countdownDisplay();
    s.raceTime = p.totalTime !== null && p.ship.status === 'finished' ? p.totalTime : this.raceTime;
    s.lap = Math.min(p.lapsDone + 1, CONFIG.TOTAL_LAPS);
    s.totalLaps = CONFIG.TOTAL_LAPS;
    s.lapTimes = p.lapTimes;
    if (p.ship.status === 'racing') s.currentLapTime = Math.max(0, this.raceTime - p.lapStart);
    else if (p.ship.status === 'finished') s.currentLapTime = p.lapTimes.length > 0 ? p.lapTimes[p.lapTimes.length - 1] : 0;
    else if (p.ship.status === 'grid') s.currentLapTime = 0;
    s.bestLap = p.bestLap;
    s.recordLap = this.recordLap;
    s.standings = this.sorted;
    s.player = p.ship;
    s.wrongWay = this.wrongWay;
    return s;
  }

  // ---------------------------------------------------------------------
  // State machine internals
  // ---------------------------------------------------------------------

  private setState(next: RaceState): void {
    const prev = this._state;
    if (prev === next) return;
    this._state = next;
    this.bus.emit('race:state', { state: next, prev });
  }

  private resetShipFields(): void {
    for (const r of this.racers) {
      r.ship.status = 'grid';
      r.ship.boostUnlocked = false;
      r.ship.thrustScale = 1;
    }
  }

  private syncGrid(): void {
    for (const r of this.racers) {
      const p = normaliseGridU(r.ship.trackU);
      r.progress = p;
      r.startProgress = p;
      r.prevU = r.ship.trackU;
    }
  }

  private countdownDisplay(): number {
    const effective = this._state === 'paused' ? this.resumeState : this._state;
    if (effective === 'countdown') return this.countdownValue;
    if (effective === 'racing' && this.raceTime < CONFIG.COUNTDOWN_STEP) return 0;
    return -1;
  }

  private tickCountdown(dt: number): void {
    this.countdownClock += dt;
    const idx = Math.min(3, Math.floor(this.countdownClock / CONFIG.COUNTDOWN_STEP + 1e-9));
    const value = 3 - idx;
    while (this.countdownValue > value) {
      this.countdownValue -= 1;
      this.bus.emit('race:countdown', { value: this.countdownValue as 3 | 2 | 1 | 0 });
    }
    if (this.countdownValue === 0) this.goRace();
  }

  private goRace(): void {
    this.syncGrid();
    this.raceTime = 0;
    for (const r of this.racers) {
      r.lapStart = 0;
      r.ship.status = 'racing';
    }
    this.setState('racing');
  }

  private tickRacing(dt: number): void {
    this.raceTime += dt;
    for (const r of this.racers) {
      if (r.ship.status !== 'racing') continue;
      this.advanceProgress(r, dt);
      if (r.ship.status === 'racing' && r.ship.energy <= 0) this.retire(r);
    }
    this.updateWrongWay(dt);
    this.updateRubberBand(dt);

    if (this.playerRacer.ship.status !== 'racing') {
      this.resultsClock += dt;
      if (this.resultsClock >= CONFIG.RESULTS_DELAY) this.enterResults();
    }
  }

  private advanceProgress(r: Racer, dt: number): void {
    const u = r.ship.trackU;
    let d = loopDelta(r.prevU, u);
    if (Math.abs(d) > MAX_STEP_DELTA) d = 0;
    r.prevU = u;
    const before = r.progress;
    r.progress += d;

    while (r.lapsDone < CONFIG.TOTAL_LAPS && Math.floor(r.progress) > r.lapsDone) {
      r.lapsDone += 1;
      const span = r.progress - before;
      const frac = span > 1e-12 ? clamp((r.lapsDone - before) / span, 0, 1) : 1;
      const crossTime = this.raceTime - dt * (1 - frac);
      this.completeLap(r, crossTime);
      if (r.lapsDone >= CONFIG.TOTAL_LAPS) {
        this.finishRacer(r, crossTime);
        break;
      }
    }
  }

  private completeLap(r: Racer, crossTime: number): void {
    const lapTime = Math.max(0, crossTime - r.lapStart);
    r.lapStart = crossTime;
    r.lapTimes.push(lapTime);
    const isBest = r.bestLap === null || lapTime < r.bestLap;
    if (isBest) r.bestLap = lapTime;
    let isRecord = false;
    if (r === this.playerRacer && lapTime > 0 && (this.recordLap === null || lapTime < this.recordLap)) {
      isRecord = true;
      this.recordLap = lapTime;
      writeRecord(lapTime);
    }
    r.ship.boostUnlocked = true;
    this.bus.emit('race:lap', { shipId: r.ship.def.id, lap: r.lapsDone, lapTime, isBest, isRecord });
  }

  private finishRacer(r: Racer, crossTime: number): void {
    r.ship.status = 'finished';
    r.ship.thrustScale = 1;
    r.totalTime = crossTime;
    this.finishedCount += 1;
    r.finishOrder = this.finishedCount;
    this.bus.emit('race:finish', { shipId: r.ship.def.id, position: r.finishOrder, totalTime: crossTime });
  }

  private retire(r: Racer): void {
    r.ship.status = 'retired';
    r.ship.thrustScale = 1;
    this.bus.emit('ship:destroyed', { shipId: r.ship.def.id, position: r.ship.position.clone() });
  }

  private updateWrongWay(dt: number): void {
    const ship = this.playerRacer.ship;
    if (ship.status !== 'racing' || ship.speed <= WRONG_WAY_MIN_SPEED) {
      this.wrongWayClock = 0;
      this.wrongWay = false;
      return;
    }
    this.fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
    const tf = this.track.sampleAt(ship.trackU, this.scratchSample).forward;
    if (this.fwd.dot(tf) < WRONG_WAY_DOT) {
      this.wrongWayClock += dt;
      if (this.wrongWayClock >= WRONG_WAY_DELAY) this.wrongWay = true;
    } else {
      this.wrongWayClock = 0;
      this.wrongWay = false;
    }
  }

  private updateRubberBand(dt: number): void {
    const player = this.playerRacer;
    const playerRacing = player.ship.status === 'racing';
    for (const r of this.racers) {
      if (r === player || r.ship.def.isPlayer) continue;
      if (r.ship.status !== 'racing') {
        r.ship.thrustScale = 1;
        continue;
      }
      let target = 1;
      if (playerRacing) {
        const gap = (r.progress - player.progress) * this.track.length; // + = AI ahead
        const k = smoothstep(RUBBER_DEAD_ZONE, RUBBER_RANGE, Math.abs(gap));
        target = gap < 0 ? 1 + (CONFIG.AI_RUBBER_BAND_MAX - 1) * k : 1 - (1 - CONFIG.AI_RUBBER_BAND_MIN) * k;
      }
      r.ship.thrustScale = damp(r.ship.thrustScale, target, RUBBER_RATE, dt);
    }
  }

  private enterResults(): void {
    const total = CONFIG.TOTAL_LAPS;
    for (const r of this.racers) {
      r.ship.thrustScale = 1;
      if (r.ship.status !== 'racing') continue;
      // Estimate the finishing time of unfinished ships from their average pace.
      const done = r.progress - r.startProgress;
      if (done > 0.02) r.totalTime = (this.raceTime * (total - r.startProgress)) / done;
    }
    this.setState('results');
    this.updateStandings();
    this.bus.emit('race:results', { standings: this.sorted.map((s) => ({ ...s })) });
  }

  private updateStandings(): void {
    for (const r of this.racers) {
      const st = r.standing;
      st.lap = r.lapsDone;
      st.progress = r.progress;
      st.totalTime = r.totalTime;
      st.bestLap = r.bestLap;
      st.status = r.ship.status;
    }
    this.sorted.sort((a, b) => this.compare(a, b));
    for (let i = 0; i < this.sorted.length; i++) this.sorted[i].position = i + 1;
  }

  private readonly compare = (a: RacerStanding, b: RacerStanding): number => {
    const ga = this.group(a);
    const gb = this.group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) {
      const ta = a.totalTime ?? Infinity;
      const tb = b.totalTime ?? Infinity;
      if (ta !== tb) return ta - tb;
    } else if (a.progress !== b.progress) {
      return b.progress - a.progress;
    }
    return a.id - b.id;
  };

  /** 0 = finished, 1 = still running, 2 = retired. */
  private group(s: RacerStanding): number {
    return s.status === 'finished' ? 0 : s.status === 'retired' ? 2 : 1;
  }
}
