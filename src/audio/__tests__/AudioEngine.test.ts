import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, CLIP_CEILING, softClipCurve } from '../AudioEngine';
import { FakeAudioContext, makeFakeDom, type FakeAudioNode, type FakeDom } from './fakeAudio';

let dom: FakeDom;

beforeEach(() => {
  FakeAudioContext.reset('running');
  dom = makeFakeDom();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', dom.navigator);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const node = (n: unknown) => n as unknown as FakeAudioNode;
const ctx = () => FakeAudioContext.instances[0];

function chainToDestination(start: FakeAudioNode): string[] {
  const kinds: string[] = [];
  let n: FakeAudioNode | undefined = start;
  while (n) {
    kinds.push(n.kind);
    if (n.kind === 'Destination') break;
    n = [...n.outputs][0];
  }
  return kinds;
}

describe('AudioEngine', () => {
  it('creates no context before the first input', () => {
    const e = new AudioEngine(true);
    expect(FakeAudioContext.instances.length).toBe(0);
    expect(e.state).toBe('none');
    dom.fire('pointerdown');
    expect(FakeAudioContext.instances.length).toBe(1);
  });

  it("builds v1's graph with music off: master → compressor → destination, sfx under the master", () => {
    const e = new AudioEngine(false);
    dom.fire('keydown');
    expect(chainToDestination(node(e.sfx))).toEqual(['Gain', 'Gain', 'DynamicsCompressor', 'Destination']);
    expect(e.music).toBeNull();
    expect(e.limiter).toBeNull();
    expect(dom.listeners('touchend')).toBe(0);
  });

  it('builds the §M6.1 graph with music on: four buses, compressor, limiter, soft clip', () => {
    const e = new AudioEngine(true);
    e.setLevels({ master: 1, music: 0.7, effects: 1, muted: false });
    dom.fire('pointerdown');
    expect(chainToDestination(node(e.sfx))).toEqual(['Gain', 'Gain', 'DynamicsCompressor', 'DynamicsCompressor', 'WaveShaper', 'Destination']);
    for (const bus of [e.music, e.ui, e.ambience]) expect([...node(bus).outputs][0]).toBe(node(e.master));
    const lim = node(e.limiter);
    expect([lim.param('threshold').value, lim.param('knee').value, lim.param('ratio').value, lim.param('attack').value, lim.param('release').value]).toEqual([-4, 0, 20, 0.001, 0.1]);
    expect(node(e.clip).prop('oversample')).toBe('2x');
    // Base levels: master 0.8, music 0.7 × 0.5, ui 0.7, ambience 0.35.
    expect(node(e.master).param('gain').value).toBeCloseTo(0.8);
    expect(node(e.music).param('gain').value).toBeCloseTo(0.35);
    expect(node(e.ui).param('gain').value).toBeCloseTo(0.7);
    expect(node(e.ambience).param('gain').value).toBeCloseTo(0.35);
    expect(e.nodeCount).toBe(9);
  });

  it('keeps the soft clip under −3 dBFS for any input', () => {
    const curve = softClipCurve();
    expect(curve.length).toBe(2048);
    const peak = curve.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeLessThanOrEqual(CLIP_CEILING);
    expect(peak).toBeGreaterThan(0.6);
    // Near-linear for small signals.
    expect(curve[1024 + 10] / ((10 / 2047) * 2)).toBeCloseTo(1, 1);
  });

  it('ramps slider changes with τ = 20 ms and mutes the master', () => {
    const e = new AudioEngine(true);
    dom.fire('pointerdown');
    const ac = ctx();
    ac.currentTime = 3;
    ac.log.length = 0;
    e.setLevels({ master: 0.5, music: 0.2, effects: 0.6, muted: false });
    expect(ac.log).toEqual([
      `#${node(e.master).id}.gain.setTargetAtTime(0.4, 3, 0.02)`,
      `#${node(e.sfx).id}.gain.setTargetAtTime(0.6, 3, 0.02)`,
      `#${node(e.music).id}.gain.setTargetAtTime(0.1, 3, 0.02)`,
      `#${node(e.ui).id}.gain.setTargetAtTime(0.42, 3, 0.02)`,
      `#${node(e.ambience).id}.gain.setTargetAtTime(0.21, 3, 0.02)`,
    ]);
    e.setLevels({ master: 0.5, music: 0.2, effects: 0.6, muted: true });
    expect(node(e.master).param('gain').value).toBe(0);
  });

  it('inserts and removes the mono node, and zeroes the pans', () => {
    const e = new AudioEngine(true);
    dom.fire('pointerdown');
    const ac = ctx();
    const panner = ac.createStereoPanner();
    panner.param('pan').value = 0.6;
    e.panners.add(panner as unknown as StereoPannerNode);
    e.setMono(true);
    expect(chainToDestination(node(e.clip))).toEqual(['WaveShaper', 'Gain', 'Destination']);
    const mono = node(e.monoNode);
    expect([mono.prop('channelCount'), mono.prop('channelCountMode'), mono.prop('channelInterpretation')]).toEqual([1, 'explicit', 'speakers']);
    expect(panner.param('pan').value).toBe(0);
    e.setMono(false);
    expect(chainToDestination(node(e.clip))).toEqual(['WaveShaper', 'Destination']);
  });

  it('counts nodes up and down', () => {
    const e = new AudioEngine(true);
    dom.fire('pointerdown');
    const base = e.nodeCount;
    e.made(5);
    e.freed(2);
    expect(e.nodeCount).toBe(base + 3);
  });

  it('sets an ambient audio session before the context, only with music on', () => {
    const session = { type: 'auto' };
    dom.navigator.audioSession = session;
    let typeAtCreate = '';
    const Orig = FakeAudioContext;
    dom.window.AudioContext = class extends Orig {
      constructor(o?: { latencyHint?: string }) {
        typeAtCreate = session.type;
        super(o);
      }
    };
    new AudioEngine(false);
    dom.fire('pointerdown');
    expect(session.type).toBe('auto');
    FakeAudioContext.reset('running');
    vi.stubGlobal('window', { ...dom.window });
    const dom2 = makeFakeDom();
    dom2.navigator.audioSession = session;
    dom2.window.AudioContext = dom.window.AudioContext;
    vi.stubGlobal('window', dom2.window);
    vi.stubGlobal('document', dom2.document);
    vi.stubGlobal('navigator', dom2.navigator);
    new AudioEngine(true);
    dom2.fire('pointerdown');
    expect(session.type).toBe('ambient');
    expect(typeAtCreate).toBe('ambient');
  });

  it('survives a browser without navigator.audioSession or without audio at all', () => {
    const e = new AudioEngine(true);
    FakeAudioContext.throwOnCreate = true;
    dom.fire('pointerdown');
    expect(e.ac).toBeNull();
    expect(e.state).toBe('none');
  });

  it('with music on: hidden pauses and suspends; visible resumes with a 0.5 s master ramp', async () => {
    const e = new AudioEngine(true);
    const paused = vi.fn();
    e.onHidden(paused);
    e.setLevels({ master: 1, music: 0.7, effects: 1, muted: false });
    dom.fire('pointerdown');
    const ac = ctx();
    ac.currentTime = 10;
    dom.setHidden(true);
    expect(paused).toHaveBeenCalledTimes(1);
    expect(ac.state).toBe('suspended');
    ac.log.length = 0;
    dom.setHidden(false);
    const m = node(e.master).id;
    expect(ac.log.slice(0, 4)).toEqual([`#${m}.gain.cancelScheduledValues(10)`, `#${m}.gain.setValueAtTime(0, 10)`, `#${m}.gain.linearRampToValueAtTime(0.8, 10.5)`, 'ctx.resume()']);
    expect(ac.state).toBe('running');
  });

  it('with music off: hidden only suspends (v1), no pause callback', () => {
    const e = new AudioEngine(false);
    const paused = vi.fn();
    e.onHidden(paused);
    dom.fire('pointerdown');
    dom.setHidden(true);
    expect(paused).not.toHaveBeenCalled();
    expect(ctx().state).toBe('suspended');
  });

  it('adds the unlock listeners again when the context is still not running after a resume (iOS interrupted)', async () => {
    const e = new AudioEngine(true);
    dom.fire('touchend');
    const ac = ctx();
    expect(dom.listeners('pointerdown')).toBe(0);
    dom.setHidden(true);
    // iOS leaves the context interrupted: resume() does not bring it back.
    ac.resume = () => {
      ac.record('ctx.resume()');
      ac.forceState('interrupted');
      return Promise.resolve();
    };
    dom.setHidden(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(dom.listeners('pointerdown')).toBe(1);
    expect(dom.listeners('touchend')).toBe(1);
    // The next input resumes it.
    ac.resume = FakeAudioContext.prototype.resume.bind(ac);
    dom.fire('pointerdown');
    expect(ac.state).toBe('running');
    expect(dom.listeners('pointerdown')).toBe(0);
    void e;
  });
});
