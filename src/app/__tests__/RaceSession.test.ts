import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../core/config';
import { buildRaceField, defaultLoadout } from '../../content/pilots';
import type { RecordStore } from '../../game';
import { RaceSession, type RaceSetup } from '../RaceSession';


function setup(overrides: Partial<RaceSetup> = {}): RaceSetup {
  return {
    seed: CONFIG.TRACK_SEED,
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
});
