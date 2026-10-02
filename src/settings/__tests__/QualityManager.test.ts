import { describe, expect, it } from 'vitest';
import { BENCH_SECONDS, BENCH_WARMUP, QUALITY_PROFILES, QualityBenchmark, deviceHint } from '../QualityManager';

function run(b: QualityBenchmark, fps: number, seconds = BENCH_WARMUP + BENCH_SECONDS + 0.05) {
  let step = b.feed(0);
  for (let t = 0; t < seconds; t += 1 / fps) step = b.feed(1 / fps);
  return step;
}

describe('quality presets', () => {
  it('High is v1 (4× MSAA, full effects, 1024 shadows, 2× DPR cap)', () => {
    expect(QUALITY_PROFILES.high).toMatchObject({ msaa: 4, blurTaps: 10, chromatic: true, shadowMap: 1024, pixelRatioCap: 2, renderScale: 1, scenery: 1, particles: 1, fog: 1 });
  });

  it('every knob is monotonic Low ≤ Med ≤ High', () => {
    const [l, m, h] = [QUALITY_PROFILES.low, QUALITY_PROFILES.med, QUALITY_PROFILES.high];
    for (const k of ['pixelRatioCap', 'renderScale', 'msaa', 'bloomScale', 'blurTaps', 'shadowMap', 'scenery', 'particles'] as const) {
      expect(l[k]).toBeLessThanOrEqual(m[k]);
      expect(m[k]).toBeLessThanOrEqual(h[k]);
    }
    expect(l.fog).toBeGreaterThanOrEqual(m.fog);
  });
});

describe('deviceHint', () => {
  it('phones and tablets start at Low', () => {
    expect(deviceHint({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe('low');
    expect(deviceHint({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' })).toBe('low');
    expect(deviceHint({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe('low');
  });

  it('≤ 4 cores start at Low; bigger desktops need the benchmark', () => {
    expect(deviceHint({ userAgent: 'Windows NT 10.0', hardwareConcurrency: 4 })).toBe('low');
    expect(deviceHint({ userAgent: 'Windows NT 10.0', hardwareConcurrency: 8 })).toBeNull();
    expect(deviceHint({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0, hardwareConcurrency: 12 })).toBeNull();
  });
});

describe('QualityBenchmark', () => {
  it('keeps High at 60 fps', () => {
    expect(run(new QualityBenchmark(), 60)).toEqual({ done: true, level: 'high' });
  });

  it('steps down to Med when High is slow, and stops when Med is fast enough', () => {
    const b = new QualityBenchmark();
    expect(run(b, 40)).toEqual({ done: false, test: 'med' });
    expect(run(b, 58)).toEqual({ done: true, level: 'med' });
  });

  it('can be allowed to measure Low too', () => {
    const b = new QualityBenchmark(2);
    run(b, 30);
    run(b, 30);
    expect(b.testing).toBe('low');
    expect(run(b, 20)).toEqual({ done: true, level: 'low' });
  });

  it('by default a still-slow Med settles at Low without measuring it', () => {
    const b = new QualityBenchmark();
    run(b, 30);
    expect(run(b, 30)).toEqual({ done: true, level: 'low' });
  });

  it('ignores the warm-up and hitches (tab switches)', () => {
    const b = new QualityBenchmark();
    for (let t = 0; t < BENCH_WARMUP; t += 0.1) b.feed(0.1); // 10 fps warm-up does not count
    b.feed(5); // hidden tab
    expect(run(b, 60)).toEqual({ done: true, level: 'high' });
  });
});
