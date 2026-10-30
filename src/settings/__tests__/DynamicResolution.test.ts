import { describe, expect, it } from 'vitest';
import { FrameStats, HITCH_MS, MISSED_FRAME_MS } from '../../core/FrameStats';
import { DYNRES_MIN, DynamicResolution } from '../DynamicResolution';

/** Feed `seconds` of frames, `missedEvery`-th frame slow (0 = all fast). Returns how many times the scale changed. */
function run(d: DynamicResolution, seconds: number, missedEvery = 0): number {
  d.resetWindow(); // each phase starts on a window boundary
  let changes = 0;
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    const slow = missedEvery > 0 && i % missedEvery === 0;
    if (d.feed(slow ? 34 : 16.7)) changes++;
  }
  return changes;
}

describe('DynamicResolution', () => {
  it('stays at full resolution while frames hold 60 Hz', () => {
    const d = new DynamicResolution();
    expect(run(d, 20)).toBe(0);
    expect(d.scale).toBe(1);
  });

  it('steps down while frames miss, never below the floor', () => {
    const d = new DynamicResolution();
    run(d, 1.2, 3); // a third of frames missed
    expect(d.scale).toBeCloseTo(0.9);
    run(d, 30, 3);
    expect(d.scale).toBe(DYNRES_MIN);
  });

  it('ignores the odd missed frame and long stalls', () => {
    const d = new DynamicResolution();
    run(d, 10, 120); // under 1% missed
    expect(d.feed(4000)).toBe(false); // loading stall
    expect(d.scale).toBe(1);
  });

  it('climbs back after clean windows, and backs off when a step up brings misses back', () => {
    const d = new DynamicResolution();
    run(d, 3.5, 3);
    const low = d.scale;
    expect(low).toBeLessThan(0.8);
    run(d, 3.2); // three clean windows: one step up
    expect(d.scale).toBeCloseTo(low + 0.05);
    // That step was too far: misses come straight back, so it steps down and now waits 6 s before probing.
    run(d, 1.05, 3);
    const after = d.scale;
    run(d, 4.5);
    expect(d.scale).toBe(after);
    run(d, 2);
    expect(d.scale).toBeCloseTo(after + 0.05);
  });

  it('a gap reset forgets the partial window', () => {
    const d = new DynamicResolution();
    for (let i = 0; i < 20; i++) d.feed(34); // 0.68 s of misses, window not yet full
    d.resetWindow();
    for (let i = 0; i < 40; i++) d.feed(16.7);
    for (let i = 0; i < 2; i++) d.feed(34);
    expect(d.scale).toBe(1);
  });
});

describe('FrameStats', () => {
  it('summarises percentiles over the window and misses over the run', () => {
    const s = new FrameStats(100);
    for (let i = 0; i < 200; i++) s.push({ frameMs: i % 10 === 0 ? 40 : 16, simMs: 1, updateMs: 2, renderMs: 3 });
    const r = s.summary();
    expect(s.size).toBe(100);
    expect(r.frames).toBe(200);
    expect(r.p50).toBe(16);
    expect(r.p95).toBe(40);
    expect(r.missed).toBeCloseTo(0.1);
    expect(r.hitches).toBe(0);
    expect(r.worst).toBe(40);
    expect(r.simMs).toBeCloseTo(1);
    expect(r.renderMs).toBeCloseTo(3);
    expect(r.fps).toBeCloseTo(1000 / 18.4, 1);
  });

  it('counts hitches and resets per run without losing the graph', () => {
    const s = new FrameStats(10);
    s.push({ frameMs: HITCH_MS + 1, simMs: 0, updateMs: 0, renderMs: 0 });
    s.push({ frameMs: MISSED_FRAME_MS + 1, simMs: 0, updateMs: 0, renderMs: 0 });
    expect(s.summary().hitches).toBe(1);
    s.resetRun();
    expect(s.summary().frames).toBe(0);
    expect(s.summary().hitches).toBe(0);
    expect(s.size).toBe(2);
  });
});
