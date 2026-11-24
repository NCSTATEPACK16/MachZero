/** M6a step 5: the new race sounds with `music` on: the timeline telegraphs, the panning of decision G, priorities. */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameContext, RaceSnapshot, ShipState, TrackFeature } from '../../core/contracts';
import { EventBus, type GameEvents } from '../../core/events';
import { makeCircleTrack, makeShip, placeShip } from '../../game/__tests__/helpers';
import { buildStrikes } from '../../track/features/lightning';
import { AudioSystem } from '../AudioSystem';
import { PRESET_IDS } from '../sfx/presets';
import { FakeAudioContext, makeFakeDom, type FakeAudioNode } from './fakeAudio';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => FakeAudioContext.reset('running'));

const PERIOD = 8;

/** A race on a circle track with one lightning point `metres` ahead of the player (negative: behind). */
function setup(opts: { modern?: boolean; strikeAt?: number | null; scale?: number } = {}) {
  const dom = makeFakeDom();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', dom.navigator);
  const audio = new AudioSystem({ modern: opts.modern ?? true });
  dom.fire('pointerdown');
  const ac = FakeAudioContext.instances.at(-1)!;
  for (const id of PRESET_IDS) audio.bank.addRendered(id, new Float32Array(441).fill(0.5), 44100);
  const track = makeCircleTrack();
  if (opts.strikeAt !== null) {
    const d = 0.1 * track.length + (opts.strikeAt ?? 60);
    const f: TrackFeature = { type: 'lightning', dStart: d - 1, dEnd: d + 1, count: 1, period: PERIOD, phase: 0 };
    track.features = [f];
  }
  const player = makeShip(0, true);
  const rival = makeShip(1, false);
  placeShip(player, track, 0.1);
  placeShip(rival, track, 0.1, 15); // 15 m to the player's right
  player.velocity.copy(track.sampleAt(0.1).forward).multiplyScalar(50);
  player.status = 'racing';
  const ships: ShipState[] = [player, rival];
  const race = { state: 'racing', player, ships } as unknown as RaceSnapshot;
  const ctx: FrameContext = { dt: 1 / 30, alpha: 1, time: 0, hazardTime: 0, telegraphScale: opts.scale ?? 1, ships, player, track, race };
  const bus = new EventBus<GameEvents>();
  audio.attach(bus);
  const at = (t: number) => {
    ctx.hazardTime = t;
    ac.currentTime += 1 / 30;
    audio.update(ctx);
  };
  return { audio, ac, bus, ctx, track, at };
}

/** The warning of the strike in the setup at hazard time t (1.5 s × scale before the bolt at 7.8 s of each 8 s cycle). */
const warnAt = (t: number, scale = 1) => {
  const c = t % PERIOD;
  const toGo = PERIOD - 0.2 - c;
  return toGo <= 0 ? 1 : toGo <= 1.5 * scale ? 1 - toGo / (1.5 * scale) : 0;
};

describe('the hazard telegraphs (§M6.2 timeline sounds)', () => {
  it('starts lightning.charge for a strike point 60 m ahead in its warning, at the warning value', () => {
    const { audio, track, at } = setup();
    expect(buildStrikes(track)[0].phase).toBe(0);
    at(1);
    expect(audio.race.telegraphLevel('lightning.charge')).toBeNull();
    at(7.05);
    expect(audio.race.telegraphLevel('lightning.charge')).toBeCloseTo(warnAt(7.05) * 0.2, 5);
    at(7.6);
    expect(audio.race.telegraphLevel('lightning.charge')).toBeCloseTo(warnAt(7.6) * 0.2, 5);
    // The bolt: the charge stops and the thunder plays.
    at(7.85);
    expect(audio.race.telegraphLevel('lightning.charge')).toBe(0);
    expect(audio.debug().played).toContain('lightning.bolt');
  });

  it('stays silent for a point behind the player, or 90 m ahead', () => {
    for (const strikeAt of [-60, 90]) {
      const { audio, at } = setup({ strikeAt });
      at(7.05);
      expect(audio.race.telegraphLevel('lightning.charge') ?? 0, `at ${strikeAt} m`).toBe(0);
    }
  });

  it('hears the bolt within 120 m, whichever side', () => {
    const { audio, at } = setup({ strikeAt: -100 });
    at(7.7);
    at(7.85);
    expect(audio.debug().played).toContain('lightning.bolt');
    const far = setup({ strikeAt: -130 });
    far.at(7.7);
    far.at(7.85);
    expect(far.audio.debug().played).not.toContain('lightning.bolt');
  });

  it('telegraphs twice as long in Rookie races (telegraphScale 2)', () => {
    const normal = setup({ scale: 1 });
    normal.at(5.5);
    expect(normal.audio.race.telegraphLevel('lightning.charge') ?? 0).toBe(0);
    const rookie = setup({ scale: 2 });
    rookie.at(5.5);
    expect(rookie.audio.race.telegraphLevel('lightning.charge')).toBeCloseTo(warnAt(5.5, 2) * 0.2, 5);
  });

  it('plays no telegraph with music off', () => {
    const { audio, at } = setup({ modern: false });
    at(7.05);
    at(7.85);
    expect(audio.race.telegraphLevel('lightning.charge')).toBeNull();
    expect(audio.debug().played).not.toContain('lightning.bolt');
  });
});

describe('the M6 event sounds', () => {
  it('plays jump, land, respawn, wind and the hazard hits with music on, and nothing new with it off', () => {
    for (const modern of [true, false]) {
      const { audio, bus, at } = setup({ modern, strikeAt: null });
      const p = new THREE.Vector3();
      bus.emit('ship:jump', { shipId: 0, intensity: 0.8 });
      bus.emit('ship:land', { shipId: 0, intensity: 0.6 });
      bus.emit('ship:land', { shipId: 0, intensity: 0.1 });
      bus.emit('ship:respawn', { shipId: 0 });
      bus.emit('ship:wind', { shipId: 0, active: true, dir: 1 });
      bus.emit('hazard:gate', { shipId: 0, gate: 0, point: p });
      bus.emit('hazard:debris', { shipId: 0, debris: 0, point: p });
      bus.emit('hazard:lightning', { shipId: 0, strike: 0, point: p });
      bus.emit('hazard:geyser', { shipId: 0, geyser: 0, point: p });
      bus.emit('hazard:jet', { shipId: 0, jet: 0, point: p });
      at(1);
      const played = audio.debug().played;
      if (modern) expect(played).toEqual(['jump.launch', 'jump.land', 'respawn', 'wind.gust', 'gate.hit', 'debris.hit', 'lightning.hit', 'geyser.hit', 'jet.hit']);
      else expect(played).toEqual(['mine.blast', 'mine.blast']);
    }
  });

  it('fades the ice crackle in on ice and out off it', () => {
    const { audio, ac, bus, at } = setup({ strikeAt: null });
    bus.emit('ship:ice', { shipId: 0, active: true });
    at(1);
    const voice = ac.nodes.find((n) => n.kind === 'BufferSource' && n.prop('loop') === true && (n.prop('buffer') as { length: number } | null)?.length === 441);
    expect(voice).toBeDefined();
    const gain = [...voice!.outputs][0];
    expect(gain.param('gain').value).toBeCloseTo(0.16);
    bus.emit('ship:ice', { shipId: 0, active: false });
    at(1.1);
    expect(gain.param('gain').value).toBe(0);
  });
});

describe('decision G: panning, and MONO', () => {
  const panners = (ac: FakeAudioContext): FakeAudioNode[] => ac.nodes.filter((n) => n.kind === 'StereoPanner');

  it('pans a rival 15 m to the right to 0.5; the player is centred', () => {
    const { ac, bus, at } = setup({ strikeAt: null });
    bus.emit('ship:boost', { shipId: 1 });
    at(1);
    const pans = panners(ac).map((p) => p.param('pan').value);
    expect(pans.length).toBe(1);
    expect(pans[0]).toBeCloseTo(0.5, 9);
    bus.emit('ship:boost', { shipId: 0 });
    at(1.1);
    expect(panners(ac).length).toBe(1);
  });

  it('clamps the pan at ±0.8', () => {
    const { ac, bus, ctx, track, at } = setup({ strikeAt: null });
    placeShip(ctx.ships[1], track, 0.1, -40); // 40 m to the left: within hearing range, past the clamp
    bus.emit('ship:dash', { shipId: 1 });
    at(1);
    expect(panners(ac).map((p) => p.param('pan').value)).toEqual([-0.8]);
  });

  it('plays everything centred under MONO', () => {
    const { audio, ac, bus, at } = setup({ strikeAt: null });
    audio.setMono(true);
    bus.emit('ship:boost', { shipId: 1 });
    at(1);
    expect(panners(ac)).toEqual([]);
    expect(audio.debug().played).toEqual(['boost']);
  });

  it('frees a sound panner once its last layer ends', () => {
    const { audio, ac, bus, at } = setup({ strikeAt: null });
    const base = audio.engine.nodeCount;
    bus.emit('ship:boost', { shipId: 1 });
    at(1);
    expect(audio.engine.nodeCount).toBeGreaterThan(base);
    ac.endAll();
    expect(audio.engine.nodeCount).toBe(base);
    expect(panners(ac)[0].outputs.size).toBe(0);
  });
});

describe('decision H: priorities', () => {
  it('never drops a warning: the EMP alarm takes voices from other ships', () => {
    const { audio, ac, bus, at } = setup({ strikeAt: null });
    for (let i = 0; i < 12; i++) bus.emit('ship:destroyed', { shipId: 1, position: new THREE.Vector3() });
    at(1);
    expect(audio.bank.activeVoices).toBe(28);
    const before = ac.log.length;
    bus.emit('item:warn', { from: 1, target: 0 });
    at(1.1);
    const alarm = ac.log.slice(before).filter((l) => l.includes('setValueAtTime(1320'));
    expect(alarm.length).toBe(3);
    expect(audio.bank.activeVoices).toBe(28);
  });

  it('drops another ship’s sound when the pool is full of the player’s own', () => {
    const { audio, ac, bus, at } = setup({ strikeAt: null });
    for (let i = 0; i < 10; i++) bus.emit('ship:destroyed', { shipId: 0, position: new THREE.Vector3() });
    at(1);
    expect(audio.bank.activeVoices).toBe(28);
    const before = ac.nodes.length;
    bus.emit('ship:boost', { shipId: 1 });
    at(1.1);
    // Only the (empty) panner is made; no layer starts.
    expect(ac.nodes.slice(before).filter((n) => n.kind !== 'StereoPanner')).toEqual([]);
  });
});

describe('the other telegraphs', () => {
  const cases = [
    { type: 'geysers' as const, telegraph: 'geyser.rumble' as const, start: 'geyser.erupt', active: 1.2 },
    { type: 'jets' as const, telegraph: 'jet.hiss' as const, start: 'jet.fire', active: 0.8 },
  ];
  for (const c of cases) {
    it(`${c.telegraph} follows the warning and ${c.start} plays as it goes off`, () => {
      const { audio, ctx, track, at } = setup({ strikeAt: null });
      const d = 0.1 * track.length + 50;
      track.features = [{ type: c.type, dStart: d - 1, dEnd: d + 1, count: 1, period: PERIOD, phase: 0 }];
      const fire = PERIOD - c.active;
      at(fire - 0.75);
      expect(audio.race.telegraphLevel(c.telegraph)).toBeGreaterThan(0);
      at(fire + 0.05);
      expect(audio.race.telegraphLevel(c.telegraph)).toBe(0);
      expect(audio.debug().played).toContain(c.start);
      void ctx;
    });
  }

  it('rumbles once when a gate ahead starts its closing warning', () => {
    const { audio, track, at } = setup({ strikeAt: null });
    const d = 0.1 * track.length + 50;
    // Shut for 2 s of every 8 (from 0 to 2 s of each cycle), so the warning runs from 6.5 s to 8 s.
    track.features = [{ type: 'gate', d, span: 'left', period: PERIOD, phase: 0, closedFraction: 0.25 } as TrackFeature];
    at(5);
    at(6.6);
    at(7.2);
    expect(audio.debug().played.filter((p) => p === 'gate.rumble')).toEqual(['gate.rumble']);
  });
});
