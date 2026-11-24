/**
 * The v1 golden test (IMPLEMENTATION §M6a step 1, decision K): a scripted race played against the audio code with
 * `music` off must produce exactly the Web Audio calls v1's AudioSystem made. The log was recorded on v1's code
 * before anything moved (`UPDATE_GOLDEN=1 npx vitest run src/audio/__tests__/v1Golden.test.ts`), and must never be
 * re-recorded to make a later step pass: a difference is a change to the live game's sound.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FrameContext, MineView, RaceSnapshot, ShipState } from '../../core/contracts';
import { EventBus, type GameEvents } from '../../core/events';
import { makeCircleTrack, makeShip, placeShip } from '../../game/__tests__/helpers';
import { FakeAudioContext, lcg, makeFakeDom } from './fakeAudio';
import { makeGoldenSubjects, type GoldenSubject } from './goldenSubjects';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'v1-golden.json');

/** Play the script against one subject and return the fake context's log. */
function play(subject: GoldenSubject): string[] {
  FakeAudioContext.reset('running');
  const dom = makeFakeDom();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.spyOn(Math, 'random').mockImplementation(lcg(7));

  const track = makeCircleTrack();
  const player = makeShip(0, true);
  const near = makeShip(1, false);
  const far = makeShip(2, false);
  placeShip(player, track, 0.1, 0);
  placeShip(near, track, 0.1, 15); // 15 m to the player's right
  placeShip(far, track, 0.1 + 80 / track.length, 0); // 80 m ahead: out of hearing range
  const ships: ShipState[] = [player, near, far];
  const fwd = track.sampleAt(0.1).forward;

  const mine = (index: number, metres: number): MineView => {
    const u = 0.1 + metres / track.length;
    return { index, owner: null, u, lateral: 0, position: track.sampleAt(u).position.clone().add(new THREE.Vector3(0, 1.2, 0)), armed: true };
  };
  const race = {
    state: 'countdown',
    countdown: 3,
    raceTime: 0,
    lap: 1,
    totalLaps: 3,
    lapTimes: [],
    currentLapTime: 0,
    bestLap: null,
    recordLap: null,
    standings: [],
    player,
    ships,
    wrongWay: false,
  } as unknown as RaceSnapshot;
  const ctx: FrameContext = { dt: 1 / 60, alpha: 1, time: 0, hazardTime: 0, telegraphScale: 1, ships, player, track, race, mines: [mine(0, 50), mine(1, 30)] };

  const bus = new EventBus<GameEvents>();
  const audio = subject.create();
  audio.setVolumes(0.8, 1);
  audio.attach(bus);
  // The first input creates the context.
  dom.fire('pointerdown');
  const ac = FakeAudioContext.instances[0];
  if (!ac) throw new Error('no context was created on the first input');

  const frame = (setup?: () => void): void => {
    setup?.();
    ctx.time += ctx.dt;
    ac.currentTime += ctx.dt;
    audio.update(ctx);
  };

  // 40 frames: countdown, then racing with rising speed, a boost, the pit, low energy, two mines ahead.
  for (let i = 0; i < 40; i++) {
    frame(() => {
      race.state = i < 8 ? 'countdown' : 'racing';
      player.status = i < 8 ? 'grid' : 'racing';
      player.speed = i < 8 ? 0 : Math.min(180, (i - 7) * 6);
      player.velocity.copy(fwd).multiplyScalar(player.speed);
      player.lastControls.throttle = i < 8 ? 0 : 1;
      player.boosting = i >= 18 && i < 24;
      player.inPit = i >= 24 && i < 30;
      player.energy = i < 24 ? 100 : i < 30 ? 40 + (i - 24) * 5 : 12;
    });
  }

  // Every v1 event once, each followed by one frame.
  const p = new THREE.Vector3();
  const n = new THREE.Vector3(0, 1, 0);
  const events: Array<() => void> = [
    () => bus.emit('race:countdown', { value: 3 }),
    () => bus.emit('race:countdown', { value: 2 }),
    () => bus.emit('race:countdown', { value: 1 }),
    () => bus.emit('race:countdown', { value: 0 }),
    () => bus.emit('ship:boost', { shipId: 0 }),
    () => bus.emit('ship:boost', { shipId: 1 }),
    () => bus.emit('ship:boost', { shipId: 2 }),
    () => bus.emit('ship:dash', { shipId: 0 }),
    () => bus.emit('ship:draft', { shipId: 0, active: true }),
    () => bus.emit('ship:draft', { shipId: 1, active: true }),
    () => bus.emit('ship:railHit', { shipId: 0, point: p, normal: n, intensity: 0.2 }),
    () => bus.emit('ship:railHit', { shipId: 0, point: p, normal: n, intensity: 0.8 }),
    () => bus.emit('ship:railHit', { shipId: 1, point: p, normal: n, intensity: 0.8 }),
    () => bus.emit('ship:shipHit', { a: 0, b: 1, point: p, intensity: 0.5 }),
    () => bus.emit('item:emp', { from: 1, target: 0, targetName: 'SHIP 0' }),
    () => bus.emit('hazard:mine', { shipId: 0, mine: 0, owner: null, point: p }),
    () => bus.emit('hazard:geyser', { shipId: 1, geyser: 0, point: p }),
    () => bus.emit('hazard:jet', { shipId: 0, jet: 0, point: p }),
    () => bus.emit('item:use', { shipId: 0, kind: 'shield' }),
    () => bus.emit('item:use', { shipId: 1, kind: 'mine' }),
    () => bus.emit('item:shield', { shipId: 0, blocked: 'emp', point: p }),
    () => bus.emit('item:warn', { from: 1, target: 0 }),
    () => bus.emit('item:warn', { from: 0, target: 1 }),
    () => bus.emit('item:fail', { shipId: 0, reason: 'empty', kind: 'emp' }),
    () => bus.emit('ship:pit', { shipId: 0, active: true }),
    () => bus.emit('ship:lowEnergy', { shipId: 0 }),
    () => bus.emit('ship:destroyed', { shipId: 1, position: p }),
    () => bus.emit('race:lap', { shipId: 0, lap: 1, lapTime: 40, isBest: true, isRecord: true }),
    () => bus.emit('race:lap', { shipId: 0, lap: 2, lapTime: 39, isBest: true, isRecord: false }),
    () => bus.emit('race:finish', { shipId: 0, position: 1, totalTime: 120 }),
  ];
  for (const e of events) {
    // Advance the clock before the event so an event and the frame that follows it share a time
    // (decision F: a sound may start up to one frame later than in v1, never at a different context time here).
    ac.currentTime += 1 / 60;
    ctx.time += 1 / 60;
    e();
    audio.update(ctx);
    ac.endAll();
  }

  // A burst past the 28-voice cap (v1 drops what does not fit), then everything ends.
  ac.currentTime += 1 / 60;
  for (let i = 0; i < 16; i++) bus.emit('ship:boost', { shipId: 0 });
  audio.update(ctx);

  // One-shots end; the levels change; mute; the race ends.
  ac.endAll();
  audio.setVolumes(0.5, 0.7);
  audio.setMuted(true);
  audio.setMuted(false);
  audio.detach();
  dom.setHidden(true);
  dom.setHidden(false);
  audio.dispose();

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  return ac.log;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('v1 golden: with `music` off the audio is v1 exactly', () => {
  const subjects = makeGoldenSubjects();

  if (process.env.UPDATE_GOLDEN === '1') {
    it('records the golden log from the reference subject', () => {
      const log = play(subjects[0]);
      writeFileSync(GOLDEN, JSON.stringify({ note: 'Recorded on v1 AudioSystem; see v1Golden.test.ts', log }, null, 1) + '\n');
      expect(log.length).toBeGreaterThan(100);
    });
    return;
  }

  it('has a golden log', () => {
    expect(existsSync(GOLDEN)).toBe(true);
  });

  for (const subject of subjects) {
    it(`${subject.name} reproduces the golden log`, () => {
      const golden = (JSON.parse(readFileSync(GOLDEN, 'utf8')) as { log: string[] }).log;
      const log = play(subject);
      expect(log).toEqual(golden);
    });
  }
});
