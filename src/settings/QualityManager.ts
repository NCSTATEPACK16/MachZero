/**
 * Quality presets (IMPLEMENTATION §M1.6) and automatic detection: phones, tablets and ≤ 4-core machines
 * start at Low; everything else runs a 2 s title-screen benchmark at High and, under 50 fps, measures Med
 * once more (a slow Med settles at Low). Reduced motion is applied separately, on top of any preset.
 */
export type QualityLevel = 'low' | 'med' | 'high';
export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'med', 'high'];

export interface QualityProfile {
  level: QualityLevel;
  /** devicePixelRatio cap, then scaled by renderScale. */
  pixelRatioCap: number;
  renderScale: number;
  /** MSAA samples of the scene pass. */
  msaa: 0 | 2 | 4;
  /** Bloom input as a fraction of full resolution (UnrealBloom halves it again internally). */
  bloomScale: 0.5 | 1;
  /** Radial speed-blur taps (0 = pass off). */
  blurTaps: 0 | 6 | 10;
  chromatic: boolean;
  /** Ship shadow map size (0 = no shadows). */
  shadowMap: 0 | 512 | 1024;
  /** Skyline / scenery instance fraction. */
  scenery: number;
  /** Particle and speed-line budget fraction. */
  particles: number;
  /** Fog density multiplier (> 1 = shorter draw distance). */
  fog: number;
}

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = {
  low: { level: 'low', pixelRatioCap: 1, renderScale: 0.75, msaa: 0, bloomScale: 0.5, blurTaps: 0, chromatic: false, shadowMap: 0, scenery: 0.35, particles: 0.3, fog: 1.6 },
  med: { level: 'med', pixelRatioCap: 1.5, renderScale: 1, msaa: 2, bloomScale: 1, blurTaps: 6, chromatic: true, shadowMap: 512, scenery: 0.7, particles: 0.6, fog: 1.25 },
  high: { level: 'high', pixelRatioCap: 2, renderScale: 1, msaa: 4, bloomScale: 1, blurTaps: 10, chromatic: true, shadowMap: 1024, scenery: 1, particles: 1, fog: 1 },
};

export interface DeviceInfo {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  hardwareConcurrency?: number;
}

/** 'low' when the device alone decides it (mobile OS or ≤ 4 cores); null when a benchmark is needed. */
export function deviceHint(d: DeviceInfo): QualityLevel | null {
  const ua = d.userAgent;
  const iPadOS = d.platform === 'MacIntel' && (d.maxTouchPoints ?? 0) > 1; // iPadOS reports as a Mac
  if (/iPhone|iPad|iPod|Android/i.test(ua) || iPadOS) return 'low';
  if (d.hardwareConcurrency !== undefined && d.hardwareConcurrency > 0 && d.hardwareConcurrency <= 4) return 'low';
  return null;
}

export const BENCH_SECONDS = 2;
export const BENCH_WARMUP = 0.5;
export const BENCH_MIN_FPS = 50;
/** Frames longer than this (tab switch, GC hitch) are ignored. */
const BENCH_MAX_DT = 0.25;

export type BenchStep = { done: false; test: QualityLevel } | { done: true; level: QualityLevel };

/**
 * Feed frame times; the benchmark measures one level at a time, starting at High. Under BENCH_MIN_FPS it
 * steps down and measures again, at most `maxStepsDown` times.
 */
export class QualityBenchmark {
  private level: QualityLevel = 'high';
  private elapsed = 0;
  private frames = 0;
  private time = 0;
  private stepsLeft: number;
  private result: QualityLevel | null = null;

  /** Default: measure High, and Med once if High is slow; a slow Med settles at Low (spec: "repeats once"). */
  constructor(maxStepsDown = 1) {
    this.stepsLeft = maxStepsDown;
  }

  /** Level currently being measured (apply it while the benchmark runs). */
  get testing(): QualityLevel {
    return this.level;
  }

  get done(): QualityLevel | null {
    return this.result;
  }

  feed(dt: number): BenchStep {
    if (this.result) return { done: true, level: this.result };
    if (!(dt > 0) || dt > BENCH_MAX_DT) return { done: false, test: this.level };
    this.elapsed += dt;
    if (this.elapsed > BENCH_WARMUP) {
      this.frames++;
      this.time += dt;
    }
    if (this.elapsed < BENCH_WARMUP + BENCH_SECONDS) return { done: false, test: this.level };
    const fps = this.frames / Math.max(1e-6, this.time);
    const lower = QUALITY_LEVELS[QUALITY_LEVELS.indexOf(this.level) - 1];
    if (fps < BENCH_MIN_FPS && lower && this.stepsLeft > 0) {
      this.stepsLeft--;
      this.level = lower;
      this.elapsed = this.frames = this.time = 0;
      return { done: false, test: this.level };
    }
    this.result = fps < BENCH_MIN_FPS && lower ? lower : this.level;
    return { done: true, level: this.result };
  }
}
