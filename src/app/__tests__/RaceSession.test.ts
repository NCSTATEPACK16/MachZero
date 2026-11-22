import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../core/config';
import { buildRaceField, defaultLoadout } from '../../content/pilots';
import type { RecordStore } from '../../game';
import { TRACK_DEFS } from '../../content/tracks';
import type { ControlInput } from '../../core/contracts';
import { RaceSession, type RaceSetup } from '../RaceSession';


function setup(overrides: Partial<RaceSetup> = {}): RaceSetup {
  return {
    source: { kind: 'seeded', seed: CONFIG.TRACK_SEED },
    worldId: 'neon-bay',
    trackKey: 'classic',
    field: buildRaceField({ playerName: 'T', playerLoadout: defaultLoadout(), tier: 'rookie' }),
    autopilot: true,
    records: { load: () => null, save: () => undefined },
    ...overrides,
  };
}

const heapUsed = (): number => (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process.memoryUsage().heapUsed;

function run(session: RaceSession, seconds: number): void {
  const dt = CONFIG.FIXED_DT;
  for (let t = 0; t < seconds; t += dt) session.fixed(dt, null);
}

describe('RaceSession lifecycle', () => {
  it('builds, races and disposes 10 races in a row without leaking listeners or bodies', async () => {
    const heap0 = heapUsed();
    for (let i = 0; i < 10; i++) {
      const s = await RaceSession.create(setup());
      expect(s.ships).toHaveLength(8);
      s.start();
      run(s, 5);
      expect(['countdown', 'racing']).toContain(s.state);
      expect(s.player.trackU).not.toBe(0);
      s.dispose();
      expect(s.isDisposed).toBe(true);
      expect(s.bus.listenerCount()).toBe(0);
      expect(s.physics.ships).toHaveLength(0);
      // Stepping a disposed session is a safe no-op.
      s.fixed(CONFIG.FIXED_DT, null);
      s.dispose();
    }
    // Loose guard: 10 track builds must not accumulate (each is several MB of geometry).
    const grownMb = (heapUsed() - heap0) / 1e6;
    expect(grownMb).toBeLessThan(200);
  });

  it('restart and toTitle reset the grid; pause freezes the race', async () => {
    const s = await RaceSession.create(setup());
    s.start();
    run(s, 6);
    const moved = s.player.position.clone();
    s.togglePause();
    expect(s.state).toBe('paused');
    run(s, 1);
    expect(s.player.position.distanceTo(moved)).toBe(0);
    s.togglePause();
    s.restart();
    expect(s.state).toBe('countdown');
    expect(s.player.forwardSpeed).toBe(0);
    s.toTitle();
    expect(s.state).toBe('title');
    s.dispose();
  });

  it('an autopilot race finishes and reports the lap record to the given store', async () => {
    let saved: number | null = null;
    const records: RecordStore = { load: () => 999, save: (v) => (saved = v) };
    const s = await RaceSession.create(setup({ records }));
    s.start();
    const dt = CONFIG.FIXED_DT;
    let t = 0;
    while (s.state !== 'results' && t < 300) {
      s.fixed(dt, null);
      t += dt;
    }
    expect(s.state).toBe('results');
    expect(saved).not.toBeNull();
    expect(saved!).toBeLessThan(999);
    s.dispose();
  });

  it('a human input drives the player unless autopilot is on', async () => {
    const s = await RaceSession.create(setup({ autopilot: false }));
    s.start();
    const idle = { throttle: 0, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false };
    const dt = CONFIG.FIXED_DT;
    for (let t = 0; t < 6; t += dt) s.fixed(dt, idle);
    expect(s.player.forwardSpeed).toBeLessThan(1); // nobody pressed throttle
    expect(s.ships.some((x) => x !== s.player && x.forwardSpeed > 30)).toBe(true);
    s.dispose();
  });

  it('builds an authored world track (Sunset Mesa, with jumps) and races it', async () => {
    const s = await RaceSession.create(setup({ source: { kind: 'authored', def: TRACK_DEFS['sunset-mesa'] }, worldId: 'sunset-mesa', trackKey: 'sunset-mesa' }));
    expect(s.track.id).toBe('sunset-mesa');
    expect(s.track.jumps).toHaveLength(2);
    s.start();
    run(s, 8);
    expect(s.state).toBe('racing');
    expect(s.player.trackU).toBeGreaterThan(0);
    s.dispose();
  });
});

describe('RaceSession items', () => {
  it('fires the EMP at the racer directly ahead, spends one, and is not spent without stock', async () => {
    const bag = { emp: 1, shield: 0, mine: 0 };
    const s = await RaceSession.create(setup({ autopilot: false, items: { counts: () => bag, use: (k) => void bag[k]-- } }));
    const hits: Array<{ from: number; target: number }> = [];
    const fails: string[] = [];
    s.bus.on('item:emp', (e) => hits.push(e));
    s.bus.on('item:fail', (e) => fails.push(e.reason));
    const drive = { throttle: 1, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false };
    s.start();
    for (let i = 0; i < 2000 && s.state !== 'racing'; i++) s.fixed(CONFIG.FIXED_DT, drive);
    for (let i = 0; i < 60; i++) s.fixed(CONFIG.FIXED_DT, drive); // standings settle
    const ahead = s.race.racerAhead(s.player.def.id);
    expect(ahead).not.toBeNull();
    s.fixed(CONFIG.FIXED_DT, { ...drive, fire: true });
    expect(hits).toEqual([{ from: s.player.def.id, target: ahead!.def.id, targetName: ahead!.def.name }]);
    expect(bag.emp).toBe(0);
    expect(ahead!.empLock).toBeGreaterThan(CONFIG.EMP_LOCK_TIME - 0.1);
    expect(ahead!.empSlow).toBeGreaterThan(CONFIG.EMP_SLOW_TIME - 0.1);
    s.fixed(CONFIG.FIXED_DT, { ...drive, fire: true });
    expect(fails).toEqual(['empty']);
    expect(hits).toHaveLength(1);
    s.restart();
    expect(ahead!.empLock).toBe(0);
    s.dispose();
  });
});

describe('RaceSession assists (IMPLEMENTATION §M7a)', () => {
  it('assists the player\'s controls while the raw input still reaches the items', async () => {
    const bag = { emp: 1, shield: 0, mine: 0 };
    const s = await RaceSession.create(setup({ autopilot: false, items: { counts: () => bag, use: (k) => void bag[k]-- }, assists: { autoAccelerate: true, steering: 2, noKO: true, earlyBoost: true } }));
    expect(s.player.noKO).toBe(true);
    expect(s.player.earlyBoost).toBe(true);
    const idle = { throttle: 0, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false };
    const seen: Array<ControlInput | null> = [];
    const fixed = s.items.fixed.bind(s.items);
    s.items.fixed = (dt, c) => (seen.push(c), fixed(dt, c));
    s.start();
    const dt = CONFIG.FIXED_DT;
    for (let t = 0; t < 6; t += dt) s.fixed(dt, idle);
    expect(s.state).toBe('racing');
    expect(s.player.forwardSpeed).toBeGreaterThan(10); // auto-accelerate, nobody pressed throttle
    expect(s.player.lastControls.throttle).toBe(1);
    expect(seen.at(-1)).toBe(idle); // the items get the raw input object
    expect(s.player.boostUnlocked).toBe(true); // boost from lap 1
    // Classic mid-race: the next step uses the raw input.
    s.setAssists({ autoAccelerate: false, steering: 0, noKO: false, earlyBoost: false });
    expect(s.player.noKO).toBe(false);
    s.fixed(dt, idle);
    expect(s.player.lastControls.throttle).toBe(0);
    s.dispose();
  });
});

describe('Time Trial session (IMPLEMENTATION §M8b step 5)', () => {
  it('the player alone on pole, no items; the run is recorded as a ghost; the given ghost is listed', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { decodeGhost, GHOST_HZ } = await import('../../game/ghost/ghostCodec');
    const b = readFileSync(join(__dirname, '../../../public/game/ghosts/cryo-station.bin'));
    const dev = decodeGhost(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)!;
    const field = buildRaceField({ playerName: 'T', playerLoadout: defaultLoadout(), tier: 'legend', rivals: 0, playerGridIndex: 0 });
    expect(field).toHaveLength(1);
    const s = await RaceSession.create(
      setup({ source: { kind: 'authored', def: TRACK_DEFS['cryo-station'] }, worldId: 'cryo-station', trackKey: 'cryo-station', field, trial: { ghosts: [{ kind: 'dev', data: dev }], hud: { medalTimes: { gold: 1, silver: 2, bronze: 3 }, held: null, bestLaps: null } } }),
    );
    expect(s.isTrial).toBe(true);
    expect(s.ships).toHaveLength(1);
    expect(s.player.def.gridIndex).toBe(0);
    expect(s.items.playerView()).toBeNull();
    expect(s.shownGhosts).toEqual([{ kind: 'dev', totalTime: dev.totalTime, visible: false }]);
    s.start();
    let finished = 0;
    s.bus.on('race:finish', (e) => (finished = e.totalTime));
    for (let t = 0; t < 200 && s.state !== 'results'; t += CONFIG.FIXED_DT) s.fixed(CONFIG.FIXED_DT, null);
    expect(s.state).toBe('results');
    const g = s.trialGhost!;
    expect(g).not.toBeNull();
    expect(g.trackId).toBe('cryo-station');
    expect(g.totalTime).toBe(finished);
    expect(g.lapTimes).toHaveLength(3);
    expect(Math.abs((g.count - 1) / GHOST_HZ - g.totalTime)).toBeLessThan(0.1);
    // A restart throws the take away until the next finish.
    s.restart();
    expect(s.trialGhost).not.toBeNull(); // kept until the next GO
    for (let t = 0; t < 5; t += CONFIG.FIXED_DT) s.fixed(CONFIG.FIXED_DT, null);
    expect(s.trialGhost).toBeNull();
    s.dispose();
  });
});
