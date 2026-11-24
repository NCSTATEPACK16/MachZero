import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { FrameContext, RaceSnapshot } from '../../core/contracts';
import { EventBus, type GameEvents } from '../../core/events';
import { makeCircleTrack, makeShip, placeShip } from '../../game/__tests__/helpers';
import { AudioSystem } from '../AudioSystem';
import { QUEUE_MAX } from '../RaceSounds';
import { FakeAudioContext, makeFakeDom } from './fakeAudio';

beforeEach(() => FakeAudioContext.reset('running'));
afterEach(() => vi.unstubAllGlobals());

function setup(modern: boolean) {
  const dom = makeFakeDom();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', dom.navigator);
  const audio = new AudioSystem({ modern });
  dom.fire('pointerdown');
  const ac = FakeAudioContext.instances.at(-1)!;
  const bus = new EventBus<GameEvents>();
  audio.attach(bus);
  const track = makeCircleTrack();
  const player = makeShip(0, true);
  placeShip(player, track, 0.1);
  const race = { state: 'racing', player, ships: [player] } as unknown as RaceSnapshot;
  const ctx: FrameContext = { dt: 1 / 60, alpha: 1, time: 0, hazardTime: 0, telegraphScale: 1, ships: [player], player, track, race };
  return { audio, ac, bus, ctx };
}

describe('decision F: handlers only queue; update drains after physics', () => {
  for (const modern of [false, true]) {
    it(`builds no node inside the emit (music ${modern ? 'on' : 'off'})`, () => {
      const { audio, ac, bus, ctx } = setup(modern);
      audio.update(ctx);
      const before = ac.nodes.length;
      bus.emit('race:countdown', { value: 3 });
      bus.emit('ship:boost', { shipId: 0 });
      bus.emit('hazard:mine', { shipId: 0, mine: 0, owner: null, point: new THREE.Vector3() });
      expect(ac.nodes.length).toBe(before);
      expect(audio.race.queued).toBe(3);
      audio.update(ctx);
      expect(audio.race.queued).toBe(0);
      expect(ac.nodes.length).toBeGreaterThan(before);
    });
  }

  it(`keeps at most ${QUEUE_MAX} events, dropping the lowest priority first`, () => {
    const { audio, bus } = setup(true);
    for (let i = 0; i < QUEUE_MAX; i++) bus.emit('ship:draft', { shipId: 0, active: true }); // priority 3
    bus.emit('race:countdown', { value: 2 }); // priority 0 pushes a draft out
    expect(audio.race.queued).toBe(QUEUE_MAX);
    bus.emit('ship:draft', { shipId: 0, active: true }); // a priority 3 replaces a priority 3
    expect(audio.race.queued).toBe(QUEUE_MAX);
    for (let i = 0; i < QUEUE_MAX; i++) bus.emit('item:warn', { from: 1, target: 0 }); // priority 0 fills the queue
    bus.emit('ship:draft', { shipId: 0, active: true }); // dropped: nothing lower to push out
    expect(audio.race.queued).toBe(QUEUE_MAX);
  });

  it('drops the queue at detach', () => {
    const { audio, bus } = setup(false);
    bus.emit('ship:boost', { shipId: 0 });
    audio.detach();
    expect(audio.race.queued).toBe(0);
  });
});
