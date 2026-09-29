import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../../core/config';
import type { ShipId, ShipState, TrackData } from '../../core/contracts';
import { RaceManager } from '../RaceManager';
import { makeBus, makeCircleTrack, makeShip, placeShip, type Recorded } from './helpers';

const DT = 1 / 60;

interface Rig {
  track: TrackData;
  ships: ShipState[];
  race: RaceManager;
  events: Recorded[];
  player: ShipState;
}

function rig(): Rig {
  const track = makeCircleTrack();
  const ships: ShipState[] = ([0, 1, 2, 3] as ShipId[]).map((id) => makeShip(id));
  ships.forEach((s, i) => placeShip(s, track, 0.99 - i * 0.002, 0));
  const { bus, events } = makeBus();
  const race = new RaceManager(track, ships, bus);
  return { track, ships, race, events, player: ships[0] };
}

function runFor(r: Rig, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) r.race.fixedUpdate(DT);
}

/** Start the race and run through the countdown so all ships are 'racing'. */
function goRacing(r: Rig): void {
  r.race.start();
  runFor(r, CONFIG.COUNTDOWN_STEP * 3 + 0.1);
  expect(r.race.state).toBe('racing');
}

/** Drive ship `s` along the track from u0 for `laps` laps (signed), moving `du` per step, running the race each step. */
function drive(r: Rig, s: ShipState, u0: number, laps: number, du = 0.002): void {
  const dir = Math.sign(laps) || 1;
  const steps = Math.round(Math.abs(laps) / du);
  let u = u0;
  for (let i = 0; i < steps; i++) {
    u += dir * du;
    s.trackU = u - Math.floor(u);
    r.race.fixedUpdate(DT);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RaceManager state machine', () => {
  it('starts in title with ships on the grid', () => {
    const r = rig();
    expect(r.race.state).toBe('title');
    expect(r.ships.every((s) => s.status === 'grid')).toBe(true);
    expect(r.race.snapshot().countdown).toBe(-1);
  });

  it('counts down 3,2,1,GO and releases the ships at GO', () => {
    const r = rig();
    r.race.start();
    expect(r.race.state).toBe('countdown');
    expect(r.race.snapshot().countdown).toBe(3);
    runFor(r, 0.5);
    expect(r.ships.every((s) => s.status === 'grid')).toBe(true);
    runFor(r, CONFIG.COUNTDOWN_STEP * 2.3); // t = 2.8 s
    expect(r.race.state).toBe('countdown');
    expect(r.race.snapshot().countdown).toBe(1);
    expect(r.ships.every((s) => s.status === 'grid')).toBe(true);
    runFor(r, CONFIG.COUNTDOWN_STEP * 0.4); // t = 3.2 s
    expect(r.race.state).toBe('racing');
    expect(r.ships.every((s) => s.status === 'racing')).toBe(true);
    const counts = r.events.filter((e) => e.type === 'race:countdown').map((e) => (e.payload as { value: number }).value);
    expect(counts).toEqual([3, 2, 1, 0]);
    const states = r.events.filter((e) => e.type === 'race:state').map((e) => (e.payload as { state: string }).state);
    expect(states).toEqual(['countdown', 'racing']);
  });

  it('only advances race time while racing', () => {
    const r = rig();
    r.race.start();
    runFor(r, 1.5);
    expect(r.race.snapshot().raceTime).toBe(0);
    runFor(r, 2);
    const t0 = r.race.snapshot().raceTime;
    expect(t0).toBeGreaterThan(0);
    r.race.pause(true);
    expect(r.race.state).toBe('paused');
    runFor(r, 2);
    expect(r.race.snapshot().raceTime).toBe(t0);
    r.race.pause(false);
    expect(r.race.state).toBe('racing');
    runFor(r, 1);
    expect(r.race.snapshot().raceTime).toBeGreaterThan(t0);
  });

  it('reset() returns to title and clears bookkeeping', () => {
    const r = rig();
    goRacing(r);
    drive(r, r.player, 0.99, 1.02);
    expect(r.player.boostUnlocked).toBe(true);
    r.race.reset();
    expect(r.race.state).toBe('title');
    expect(r.ships.every((s) => s.status === 'grid' && !s.boostUnlocked && s.thrustScale === 1)).toBe(true);
    const snap = r.race.snapshot();
    expect(snap.lapTimes).toHaveLength(0);
    expect(snap.raceTime).toBe(0);
    expect(snap.lap).toBe(1);
  });
});

describe('RaceManager lap counting', () => {
  it('does not count the grid to start-line crossing as a lap', () => {
    const r = rig();
    goRacing(r);
    drive(r, r.player, 0.99, 0.05); // crosses u = 0
    expect(r.events.filter((e) => e.type === 'race:lap')).toHaveLength(0);
    const snap = r.race.snapshot();
    expect(snap.lap).toBe(1);
    expect(snap.lapTimes).toHaveLength(0);
    expect(r.player.boostUnlocked).toBe(false);
  });

  it('counts a lap on every wrap and unlocks boost after lap 1', () => {
    const r = rig();
    goRacing(r);
    drive(r, r.player, 0.99, 1.03); // one full lap + a bit
    const laps = r.events.filter((e) => e.type === 'race:lap');
    expect(laps).toHaveLength(1);
    expect((laps[0].payload as { lap: number }).lap).toBe(1);
    expect(r.player.boostUnlocked).toBe(true);
    expect(r.ships[1].boostUnlocked).toBe(false); // per ship
    expect(r.race.snapshot().lap).toBe(2);
    drive(r, r.player, 0.02, 1.0);
    expect(r.events.filter((e) => e.type === 'race:lap')).toHaveLength(2);
    expect(r.race.snapshot().lap).toBe(3);
    expect(r.race.snapshot().lapTimes).toHaveLength(2);
  });

  it('does not count laps when driving in reverse', () => {
    const r = rig();
    goRacing(r);
    drive(r, r.player, 0.99, -2.2); // two and a bit laps backwards
    expect(r.events.filter((e) => e.type === 'race:lap')).toHaveLength(0);
    expect(r.player.boostUnlocked).toBe(false);
    // Driving forward again only recovers the lost progress; no lap is credited.
    drive(r, r.player, r.player.trackU, 2.1);
    expect(r.events.filter((e) => e.type === 'race:lap')).toHaveLength(0);
    expect(r.race.snapshot().lap).toBe(1);
  });

  it('flags the wrong way after a debounce', () => {
    const r = rig();
    goRacing(r);
    placeShip(r.player, r.track, 0.3, 0, Math.PI); // facing backwards
    r.player.speed = 60;
    runFor(r, 0.3);
    expect(r.race.snapshot().wrongWay).toBe(false);
    runFor(r, 0.4);
    expect(r.race.snapshot().wrongWay).toBe(true);
    placeShip(r.player, r.track, 0.3, 0, 0);
    runFor(r, 0.1);
    expect(r.race.snapshot().wrongWay).toBe(false);
  });
});

describe('RaceManager finish, retire and results', () => {
  it('finishes after TOTAL_LAPS, records times and emits race:finish', () => {
    const r = rig();
    goRacing(r);
    drive(r, r.player, 0.99, CONFIG.TOTAL_LAPS + 0.02);
    expect(r.player.status).toBe('finished');
    const finish = r.events.filter((e) => e.type === 'race:finish');
    expect(finish).toHaveLength(1);
    const payload = finish[0].payload as { shipId: number; position: number; totalTime: number };
    expect(payload.shipId).toBe(0);
    expect(payload.position).toBe(1);
    expect(payload.totalTime).toBeGreaterThan(0);
    expect(r.events.filter((e) => e.type === 'race:lap')).toHaveLength(CONFIG.TOTAL_LAPS);
    const snap = r.race.snapshot();
    expect(snap.lap).toBe(CONFIG.TOTAL_LAPS);
    expect(snap.lapTimes).toHaveLength(CONFIG.TOTAL_LAPS);
    expect(snap.bestLap).toBe(Math.min(...snap.lapTimes));
  });

  it('retires a ship at zero energy and emits ship:destroyed', () => {
    const r = rig();
    goRacing(r);
    r.ships[2].energy = 0;
    r.race.fixedUpdate(DT);
    expect(r.ships[2].status).toBe('retired');
    const d = r.events.filter((e) => e.type === 'ship:destroyed');
    expect(d).toHaveLength(1);
    expect((d[0].payload as { shipId: number }).shipId).toBe(2);
    expect(r.ships[1].status).toBe('racing');
  });

  it('orders standings: finished by time, then racing by progress, retired last', () => {
    const r = rig();
    goRacing(r);
    // Ship 3 leads the pack, ship 1 next, ship 2 retires, player trails.
    for (let i = 0; i < 40; i++) {
      r.ships[3].trackU = 0.99 + (i + 1) * 0.0015 - Math.floor(0.99 + (i + 1) * 0.0015);
      r.ships[1].trackU = 0.99 + (i + 1) * 0.001 - Math.floor(0.99 + (i + 1) * 0.001);
      r.player.trackU = 0.99 + (i + 1) * 0.0005 - Math.floor(0.99 + (i + 1) * 0.0005);
      r.race.fixedUpdate(DT);
    }
    r.ships[2].energy = 0;
    r.race.fixedUpdate(DT);
    let order = r.race.snapshot().standings.map((s) => s.id);
    expect(order).toEqual([3, 1, 0, 2]);
    expect(r.race.snapshot().standings.map((s) => s.position)).toEqual([1, 2, 3, 4]);

    // Ship 3 finishes first, the player second (well within RESULTS_DELAY of each other in sim time).
    drive(r, r.ships[3], r.ships[3].trackU, CONFIG.TOTAL_LAPS + 0.05, 0.004);
    expect(r.ships[3].status).toBe('finished');
    drive(r, r.player, r.player.trackU, CONFIG.TOTAL_LAPS + 0.05, 0.004);
    expect(r.player.status).toBe('finished');
    order = r.race.snapshot().standings.map((s) => s.id);
    expect(order).toEqual([3, 0, 1, 2]);
    // A finished ship stays ahead of a running one even if the runner has more progress.
    expect(r.race.snapshot().standings[0].status).toBe('finished');
  });

  it('goes to results after the delay with estimated AI times', () => {
    const r = rig();
    goRacing(r);
    // Give the AI some progress so their pace can be estimated.
    for (let i = 0; i < 60; i++) {
      for (const s of [r.ships[1], r.ships[2], r.ships[3]]) s.trackU = (0.99 + (i + 1) * 0.004) % 1;
      r.race.fixedUpdate(DT);
    }
    drive(r, r.player, r.player.trackU, CONFIG.TOTAL_LAPS + 0.05);
    expect(r.player.status).toBe('finished');
    expect(r.race.state).toBe('racing');
    runFor(r, CONFIG.RESULTS_DELAY + 0.2);
    expect(r.race.state).toBe('results');
    const results = r.events.filter((e) => e.type === 'race:results');
    expect(results).toHaveLength(1);
    const standings = (results[0].payload as { standings: { id: number; totalTime: number | null; status: string }[] }).standings;
    expect(standings[0].id).toBe(0);
    for (const s of standings.slice(1)) {
      expect(s.status).toBe('racing'); // status is kept
      expect(s.totalTime).not.toBeNull();
      expect(s.totalTime as number).toBeGreaterThan(0);
    }
  });

  it('persists the record lap in localStorage (guarded)', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const r = rig();
    expect(r.race.snapshot().recordLap).toBeNull();
    goRacing(r);
    drive(r, r.player, 0.99, 1.02);
    const rec = r.race.snapshot().recordLap;
    expect(rec).not.toBeNull();
    expect(Number(store.get(CONFIG.RECORD_STORAGE_KEY))).toBeCloseTo(rec as number, 6);
    const lap = r.events.find((e) => e.type === 'race:lap');
    expect((lap?.payload as { isRecord: boolean }).isRecord).toBe(true);
  });

  it('rubber-bands AI only: trailing AI speeds up, leading AI slows, player untouched', () => {
    const r = rig();
    goRacing(r);
    for (let i = 0; i < 300; i++) {
      r.ships[1].trackU = (0.99 + 0.05 + i * 0.0002) % 1; // well ahead
      r.ships[2].trackU = 0.99; // stuck at the line (behind)
      r.race.fixedUpdate(DT);
    }
    expect(r.ships[1].thrustScale).toBeLessThan(1);
    expect(r.ships[1].thrustScale).toBeGreaterThanOrEqual(CONFIG.AI_RUBBER_BAND_MIN - 1e-9);
    for (let i = 0; i < 400; i++) {
      r.player.trackU = (0.99 + Math.min(i, 100) * 0.002) % 1; // player pulls 0.2 laps clear
      r.race.fixedUpdate(DT);
    }
    expect(r.ships[2].thrustScale).toBeGreaterThan(1);
    expect(r.ships[2].thrustScale).toBeLessThanOrEqual(CONFIG.AI_RUBBER_BAND_MAX + 1e-9);
    expect(r.player.thrustScale).toBe(1);
  });
});
