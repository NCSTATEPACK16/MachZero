/**
 * Rendering a song (IMPLEMENTATION §M6b): `renderSong(def)` turns a SongDef into an intro, a seamless loop and a mono
 * lift layer, normalised together. Everything runs in 128-sample blocks; `SongRender` is resumable (`step(ms)`), so
 * the main-thread fallback can render a song in slices that never block a frame for long.
 *
 * How the parts fit:
 *  - The intro is rendered with its own tail (notes still ringing, the delay and the reverb), so its buffer is longer
 *    than the intro itself. At playback the loop starts `introSamples` after the intro, and the intro's tail plays
 *    over the loop's first seconds.
 *  - The loop is rendered once, then its tail past the end (no new notes) until it is silent, and the tail is added
 *    onto the loop's start. Every effect after a voice is linear, every note is seeded by what it is (not when), the
 *    pump's hits repeat with the loop, and the chorus's rate fits the loop a whole number of times, so the folded
 *    loop equals the loop's second pass exactly (the song tests check it).
 *  - `lift: true` tracks go to a mono accumulator with their own mono delay and reverb, folded the same way.
 *  - One gain for intro, loop and lift together: the loop measures −14 LUFS, and no true peak (the intro over the
 *    loop's start, the loop with the lift) exceeds −1 dBFS; if the peak limits the gain, the loop ends quieter.
 *  - A stinger is an intro only, with at most 2 s of tail.
 */
import { kindOf, type SongDef } from '../songs/format';
import { Chorus, Delay, pumpGain, Reverb } from './effects';
import { renderNote, resolveInstrument, type ResolvedInstrument } from './instruments';
import { LoudnessMeter, TruePeakMeter, toDb } from './loudness';
import { hash, rng } from './osc';
import { sequence, stepSeconds, type NoteEvent } from './sequence';

export const SAMPLE_RATE = 44100;
export const BLOCK = 128;
export const TARGET_LUFS = -14;
export const PEAK_CEILING_DB = -1;
/** A tail ends once its output stays below this for SILENT_SECONDS (and the delay's own time). */
const SILENCE = 1e-6;
const SILENT_SECONDS = 0.5;
const TAIL_MAX_SECONDS = 20;
const STINGER_TAIL_SECONDS = 2;
/** Rendered notes kept for reuse (a note is the same every time it repeats: arps, bass lines, drums). */
const NOTE_CACHE_BYTES = 32 * 1024 * 1024;
/** The chorus's rate before it is fitted to the loop. */
const CHORUS_HZ = 0.7;

export interface RenderedSong {
  id: string;
  sampleRate: number;
  bpm: number;
  /** The intro with its tail ([L, R]), or null; the loop starts `introSamples` after the intro does. */
  intro: [Float32Array, Float32Array] | null;
  introSamples: number;
  /** The seamless loop ([L, R]), exactly `loopSamples` long; for a stinger, the whole stinger. */
  loop: [Float32Array, Float32Array];
  loopSamples: number;
  /** The mono lift layer (as long as the loop), or null. */
  lift: Float32Array | null;
  introBars: number;
  loopBars: number;
  /** The loop's loudness (LUFS) and the highest true peak (dBFS) after normalisation; the gain applied. */
  lufs: number;
  truePeakDb: number;
  gain: number;
  renderMs: number;
}

export interface RenderOptions {
  sampleRate?: number;
  /** Tests: render the loop this many times in a row without folding (the seamless check). */
  passes?: number;
  /** A clock in ms (performance.now). */
  now?: () => number;
}

interface TrackState {
  name: string;
  index: number;
  inst: ResolvedInstrument;
  lift: boolean;
  gain: number;
  gl: number;
  gr: number;
  delay: number;
  reverb: number;
  pump: { hits: Float64Array; depth: number; release: number; at: number } | null;
  chorus: Chorus | null;
  chorusMix: number;
  /** Blocks left for the chorus's own delay to empty after the last voice. */
  chorusTail: number;
  voices: Array<{ buf: Float32Array; start: number }>;
}

interface Timed {
  start: number;
  gate: number;
  ev: NoteEvent;
}

/** Notes rendered once and reused, up to a byte budget. */
class NoteCache {
  private readonly map = new Map<string, Float32Array>();
  private bytes = 0;
  get(key: string, make: () => Float32Array): Float32Array {
    const hit = this.map.get(key);
    if (hit) return hit;
    const buf = make();
    if (this.bytes + buf.byteLength <= NOTE_CACHE_BYTES) {
      this.map.set(key, buf);
      this.bytes += buf.byteLength;
    }
    return buf;
  }
}

/** One part (the intro or the loop) rendered block by block. */
class Segment {
  done = false;
  /** Where the output ends (for an unfolded part: the written length plus the tail). */
  end = 0;
  readonly outL: Float32Array;
  readonly outR: Float32Array;
  readonly outLift: Float32Array | null;
  private pos = 0;
  private next = 0;
  private silentRun = 0;
  private readonly silentBlocks: number;
  private readonly tailMax: number;
  private readonly bl = new Float32Array(BLOCK);
  private readonly br = new Float32Array(BLOCK);
  private readonly scratch = new Float32Array(BLOCK);
  private readonly dSend = new Float32Array(BLOCK);
  private readonly rSend = new Float32Array(BLOCK);
  private readonly liftDry = new Float32Array(BLOCK);
  private readonly liftD = new Float32Array(BLOCK);
  private readonly liftR = new Float32Array(BLOCK);
  private readonly tl = new Float32Array(BLOCK);
  private readonly tr = new Float32Array(BLOCK);
  private readonly delay: Delay;
  private readonly reverb: Reverb;
  private readonly liftDelay: Delay | null;
  private readonly liftReverb: Reverb | null;

  constructor(
    private readonly def: SongDef,
    private readonly tracks: TrackState[],
    private readonly events: Timed[],
    /** The written length in samples (the loop's period when folding). */
    readonly length: number,
    private readonly fold: boolean,
    private readonly sr: number,
    private readonly cache: NoteCache,
    hasLift: boolean,
    tailSeconds: number,
  ) {
    for (const t of tracks) this.byName.set(t.name, t);
    const delaySeconds = def.fx.delay.beats * (60 / def.bpm);
    this.silentBlocks = Math.ceil((Math.max(SILENT_SECONDS, delaySeconds + 0.1) * sr) / BLOCK);
    this.tailMax = Math.round(Math.min(tailSeconds, fold ? length / sr : tailSeconds) * sr);
    const size = fold ? length : length + this.tailMax + BLOCK;
    this.outL = new Float32Array(size);
    this.outR = new Float32Array(size);
    this.outLift = hasLift ? new Float32Array(size) : null;
    const fx = def.fx;
    this.delay = new Delay(delaySeconds, fx.delay.feedback, fx.delay.tone, sr);
    this.reverb = new Reverb(fx.reverb.size, fx.reverb.damp, sr);
    this.liftDelay = hasLift ? new Delay(delaySeconds, fx.delay.feedback, fx.delay.tone, sr) : null;
    this.liftReverb = hasLift ? new Reverb(fx.reverb.size, fx.reverb.damp, sr) : null;
  }

  /** Render up to `blocks` blocks; returns true when the part is finished. */
  run(blocks: number): boolean {
    for (let n = 0; n < blocks && !this.done; n++) this.block();
    return this.done;
  }

  get progress(): number {
    return Math.min(1, this.pos / Math.max(1, this.length));
  }

  private block(): void {
    const b = this.pos;
    const len = BLOCK;
    const { bl, br, scratch, dSend, rSend, liftDry, liftD, liftR } = this;
    bl.fill(0);
    br.fill(0);
    dSend.fill(0);
    rSend.fill(0);
    if (this.outLift) {
      liftDry.fill(0);
      liftD.fill(0);
      liftR.fill(0);
    }
    // New notes.
    while (this.next < this.events.length && this.events[this.next].start < b + len) {
      const e = this.events[this.next++];
      const t = this.byName.get(e.ev.track);
      if (t) t.voices.push({ buf: this.note(t, e), start: e.start });
    }
    let active = false;
    for (const t of this.tracks) {
      if (t.voices.length === 0 && t.chorusTail <= 0) continue;
      active ||= t.voices.length > 0;
      scratch.fill(0);
      for (let v = t.voices.length - 1; v >= 0; v--) {
        const { buf, start } = t.voices[v];
        const from = Math.max(b, start);
        const to = Math.min(b + len, start + buf.length);
        for (let i = from; i < to; i++) scratch[i - b] += buf[i - start];
        if (start + buf.length <= b + len) t.voices.splice(v, 1);
      }
      if (t.pump) {
        const p = t.pump;
        for (let k = 0; k < len; k++) {
          const r = pumpGain(p.hits, (b + k) / this.sr, p.depth, p.release, p.at);
          p.at = r.index;
          scratch[k] *= r.gain;
        }
      }
      if (t.lift) {
        for (let k = 0; k < len; k++) {
          const s = scratch[k] * t.gain;
          liftDry[k] += s;
          liftD[k] += s * t.delay;
          liftR[k] += s * t.reverb;
        }
        continue;
      }
      if (t.chorus) {
        t.chorus.process(scratch, bl, br, len, b, t.chorusMix, t.gl, t.gr);
        t.chorusTail = t.voices.length ? 8 : t.chorusTail - 1;
      } else {
        for (let k = 0; k < len; k++) {
          bl[k] += scratch[k] * t.gl;
          br[k] += scratch[k] * t.gr;
        }
      }
      if (t.delay || t.reverb) {
        for (let k = 0; k < len; k++) {
          const s = scratch[k] * t.gain;
          dSend[k] += s * t.delay;
          rSend[k] += s * t.reverb;
        }
      }
    }
    this.delay.process(dSend, bl, br, len);
    this.reverb.process(rSend, bl, br, len);
    if (this.outLift) {
      const { tl, tr } = this;
      tl.fill(0);
      tr.fill(0);
      this.liftDelay!.process(liftD, tl, tr, len);
      this.liftReverb!.process(liftR, tl, tr, len);
      for (let k = 0; k < len; k++) liftDry[k] += (tl[k] + tr[k]) * 0.5;
    }

    // Write out (folding onto the start past the loop's end).
    let peak = 0;
    for (let k = 0; k < len; k++) {
      const p = b + k;
      const i = this.fold ? p % this.length : p;
      if (!this.fold && i >= this.outL.length) break;
      this.outL[i] += bl[k];
      this.outR[i] += br[k];
      if (this.outLift) this.outLift[i] += liftDry[k];
      peak = Math.max(peak, Math.abs(bl[k]), Math.abs(br[k]), this.outLift ? Math.abs(liftDry[k]) : 0);
    }
    this.pos = b + len;

    // The end: past the written length, no voice left, and silent for long enough (or the tail's limit).
    if (this.pos >= this.length && this.next >= this.events.length && !active) {
      this.silentRun = peak < SILENCE ? this.silentRun + 1 : 0;
      if (this.silentRun >= this.silentBlocks || this.pos >= this.length + this.tailMax) {
        this.done = true;
        this.end = Math.min(this.pos, this.length + this.tailMax);
      }
    }
  }

  private readonly byName = new Map<string, TrackState>();

  private note(t: TrackState, e: Timed): Float32Array {
    const ev = e.ev;
    const drum = t.inst.kind === 'drum';
    const key = drum ? `${t.index}|d|${ev.velocity}` : `${t.index}|${ev.midi}|${ev.velocity}|${e.gate}|${ev.prev ?? ''}`;
    return this.cache.get(key, () => renderNote(t.inst, ev.midi, ev.velocity, e.gate, this.sr, rng(hash(`${this.def.id}|${t.name}|${drum ? 'd' : ev.midi}|${ev.velocity}`)), ev.prev));
  }
}

/** The pump's trigger times (s) for a part: its own hits and the hits that repeat around it. */
function pumpHits(trigger: string, own: Timed[], sr: number, copies: Array<{ events: Timed[]; offset: number }>): Float64Array {
  const hits: number[] = [];
  for (const { events, offset } of [{ events: own, offset: 0 }, ...copies]) for (const e of events) if (e.ev.track === trigger) hits.push((e.start + offset) / sr);
  return Float64Array.from(new Set(hits)).sort();
}

/** Pan gains: centre is unity on both sides. */
function panGains(pan: number): [number, number] {
  const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2];
}

type Phase = 'intro' | 'loop' | 'measure' | 'scale' | 'done';

/** A song render that can run in slices (`step`), or all at once (`renderSong`). */
export class SongRender {
  readonly sampleRate: number;
  private readonly now: () => number;
  private busy = 0;
  private phase: Phase = 'intro';
  private readonly stinger: boolean;
  private readonly introSamples: number;
  private readonly loopSamples: number;
  private readonly introBars: number;
  private readonly loopBars: number;
  private readonly fold: boolean;
  private readonly makeLoop: () => Segment;
  private intro: Segment | null;
  private loop: Segment | null = null;
  /** The finished parts. */
  private introOut: [Float32Array, Float32Array] | null = null;
  private loopOut: [Float32Array, Float32Array] | null = null;
  private liftOut: Float32Array | null = null;
  private readonly loud: LoudnessMeter;
  private readonly peak = new TruePeakMeter();
  private cursor = 0;
  private gain = 1;
  private measured = { lufs: -Infinity, peakDb: -Infinity };
  private out: RenderedSong | null = null;

  constructor(
    readonly def: SongDef,
    opts: RenderOptions = {},
  ) {
    const sr = (this.sampleRate = opts.sampleRate ?? SAMPLE_RATE);
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.stinger = kindOf(def.id) === 'stinger';
    const stepSamples = stepSeconds(def.bpm) * sr;
    const intro = sequence(def, 'intro');
    const loop = sequence(def, 'loop');
    this.introBars = intro.steps / 16;
    this.loopBars = loop.steps / 16;
    this.introSamples = Math.round(intro.steps * stepSamples);
    this.loopSamples = Math.round(loop.steps * stepSamples);
    const loopSeconds = this.loopSamples / sr;
    // The chorus's rate fits the loop a whole number of times (seamless).
    const chorusRate = loopSeconds > 0 ? Math.max(1, Math.round(CHORUS_HZ * loopSeconds)) / loopSeconds : CHORUS_HZ;
    const stinger = this.stinger;

    // Fresh track states for each part.
    const makeTracks = (): TrackState[] =>
      Object.entries(def.tracks).map(([name, td], index) => {
        const inst = resolveInstrument(td.instrument, td.params);
        const lift = !!td.lift && !stinger;
        const [gl, gr] = panGains(lift ? 0 : (td.pan ?? 0));
        const chorusMix = lift ? 0 : (inst.p.chorus ?? 0);
        return { name, index, inst, lift, gain: td.gain, gl: gl * td.gain, gr: gr * td.gain, delay: td.delay ?? 0, reverb: td.reverb ?? 0, pump: null, chorus: chorusMix > 0 ? new Chorus(chorusRate, sr) : null, chorusMix, chorusTail: 0, voices: [] };
      });
    const probe = makeTracks();
    const byName = new Map(probe.map((t) => [t.name, t]));
    const hasLift = probe.some((t) => t.lift) && loop.steps > 0;
    const timed = (events: NoteEvent[], skipLift: boolean): Timed[] =>
      events
        .filter((e) => byName.has(e.track) && !(skipLift && byName.get(e.track)!.lift))
        .map((e) => {
          const t = byName.get(e.track)!;
          const gate = t.inst.kind === 'drum' ? 1 : Math.max(1, Math.round(e.steps * stepSamples * (t.inst.p.gate ?? 0.9)));
          return { start: Math.round((e.step + e.swing) * stepSamples), gate, ev: e };
        });
    const introEvents = timed(intro.events, true);
    const loopOnce = timed(loop.events, false);
    const passes = opts.passes ?? 1;
    this.fold = opts.passes === undefined;
    const loopEvents: Timed[] = [];
    for (let k = 0; k < passes; k++) for (const e of loopOnce) loopEvents.push({ ...e, start: e.start + k * this.loopSamples });

    // Pumps: a part's own hits, plus the hits that repeat around it.
    const withPumps = (tracks: TrackState[], own: Timed[], copies: Array<{ events: Timed[]; offset: number }>) => {
      for (const t of tracks) {
        const p = def.tracks[t.name].pump;
        if (p) t.pump = { hits: pumpHits(p.by, own, sr, copies), depth: p.depth, release: p.release, at: 0 };
      }
      return tracks;
    };
    const cache = new NoteCache();
    this.intro =
      introEvents.length > 0 || this.introSamples > 0
        ? new Segment(def, withPumps(makeTracks(), introEvents, [{ events: loopOnce, offset: this.introSamples }]), introEvents, this.introSamples, false, sr, cache, false, stinger ? STINGER_TAIL_SECONDS : TAIL_MAX_SECONDS)
        : null;
    this.makeLoop = () =>
      new Segment(
        def,
        withPumps(
          makeTracks(),
          loopEvents,
          [-1, passes].map((k) => ({ events: loopOnce, offset: k * this.loopSamples })),
        ),
        loopEvents,
        this.loopSamples * passes,
        this.fold,
        sr,
        cache,
        hasLift,
        TAIL_MAX_SECONDS,
      );
    if (!this.intro) this.startLoop();
    this.loud = new LoudnessMeter(sr, 2);
  }

  /** 0..1 */
  get progress(): number {
    if (this.phase === 'intro') return (this.intro?.progress ?? 1) * 0.1;
    if (this.phase === 'loop') return 0.1 + (this.loop?.progress ?? 0) * 0.8;
    return this.phase === 'done' ? 1 : 0.9;
  }

  get finished(): boolean {
    return this.phase === 'done';
  }

  /** Work for about `budgetMs` (Infinity: to the end). Returns true when the song is finished. */
  step(budgetMs = Infinity): boolean {
    const start = this.now();
    const deadline = start + budgetMs;
    while (this.phase !== 'done') {
      this.work();
      if (this.now() >= deadline) break;
    }
    this.busy += this.now() - start;
    if (this.out) this.out.renderMs = this.busy;
    return this.phase === 'done';
  }

  /** The unnormalised parts (tests: the seamless check). */
  raw(): { intro: [Float32Array, Float32Array] | null; loop: [Float32Array, Float32Array]; lift: Float32Array | null; loopSamples: number } {
    while (this.phase === 'intro' || this.phase === 'loop') this.work();
    return { intro: this.introOut, loop: this.loopOut!, lift: this.liftOut, loopSamples: this.loopSamples };
  }

  result(): RenderedSong {
    if (!this.out) throw new Error(`${this.def.id} is not rendered yet`);
    return this.out;
  }

  private startLoop(): void {
    if (this.stinger) {
      this.phase = 'measure';
      return;
    }
    this.loop = this.makeLoop();
    this.phase = 'loop';
  }

  /** One unit of work: 16 blocks, or a second or two of measuring or scaling. */
  private work(): void {
    const sr = this.sampleRate;
    switch (this.phase) {
      case 'intro': {
        const seg = this.intro!;
        if (!seg.run(16)) return;
        const end = Math.max(seg.end, this.introSamples);
        this.introOut = [seg.outL.slice(0, end), seg.outR.slice(0, end)];
        this.intro = null;
        if (this.stinger) this.fadeEnd(this.introOut);
        this.startLoop();
        return;
      }
      case 'loop': {
        const seg = this.loop!;
        if (!seg.run(16)) return;
        const end = this.fold ? seg.length : seg.end;
        this.loopOut = [seg.outL.subarray(0, end), seg.outR.subarray(0, end)];
        this.liftOut = seg.outLift ? seg.outLift.subarray(0, end) : null;
        this.loop = null;
        this.phase = this.fold ? 'measure' : 'done';
        this.cursor = 0;
        return;
      }
      case 'measure': {
        // The loop's loudness (a stinger's: its own), and the true peak of what can sound together.
        const [L, R] = this.stinger ? this.introOut! : this.loopOut!;
        const from = this.cursor;
        const to = Math.min(L.length, from + sr);
        this.loud.push([L, R], from, to);
        this.peakOfSums(from, to);
        this.cursor = to;
        if (to < L.length) return;
        if (!this.stinger) this.peakOfIntro();
        const lufs = this.loud.integrated();
        const ceiling = Math.pow(10, PEAK_CEILING_DB / 20);
        let g = Number.isFinite(lufs) ? Math.pow(10, (TARGET_LUFS - lufs) / 20) : 1;
        if (this.peak.peak * g > ceiling) g = ceiling / this.peak.peak;
        this.gain = g;
        this.measured = { lufs: lufs + toDb(g), peakDb: toDb(this.peak.peak * g) };
        this.cursor = 0;
        this.phase = 'scale';
        return;
      }
      case 'scale': {
        const bufs = [...(this.introOut ?? []), ...(this.stinger ? [] : [...this.loopOut!, ...(this.liftOut ? [this.liftOut] : [])])];
        const total = bufs.reduce((n, b) => n + b.length, 0);
        const from = this.cursor;
        const to = Math.min(total, from + 2 * sr);
        let offset = 0;
        for (const b of bufs) {
          const a = Math.max(from, offset);
          const z = Math.min(to, offset + b.length);
          for (let i = a; i < z; i++) b[i - offset] *= this.gain;
          offset += b.length;
        }
        this.cursor = to;
        if (to >= total) this.finish();
        return;
      }
      default:
    }
  }

  /** The true peak of the loop with the lift over it (wrapping at the seam), or of the stinger. */
  private peakOfSums(from: number, to: number): void {
    const pad = 8;
    const n = to - from;
    const srcs = this.stinger ? this.introOut! : this.loopOut!;
    const lift = this.stinger ? null : this.liftOut;
    const len = srcs[0].length;
    for (const src of srcs) {
      const tmp = new Float32Array(n + 2 * pad);
      for (let k = 0; k < tmp.length; k++) {
        let i = from - pad + k;
        if (this.stinger && (i < 0 || i >= len)) continue;
        i = ((i % len) + len) % len;
        tmp[k] = src[i] + (lift ? lift[i] : 0);
      }
      this.peak.push([tmp], pad, pad + n);
    }
  }

  /** The intro's tail plays over the loop's start: the true peak of the two together. */
  private peakOfIntro(): void {
    if (!this.introOut) return;
    const loop = this.loopOut!;
    const sum = (a: Float32Array, l: Float32Array) => {
      const out = new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = a[i] + (i >= this.introSamples ? l[(i - this.introSamples) % l.length] : 0);
      return out;
    };
    this.peak.push([sum(this.introOut[0], loop[0]), sum(this.introOut[1], loop[1])]);
  }

  /** A stinger cut at its tail's limit fades over its last 50 ms. */
  private fadeEnd([l, r]: [Float32Array, Float32Array]): void {
    const n = l.length;
    const fade = Math.min(n, Math.round(0.05 * this.sampleRate));
    for (let k = 0; k < fade; k++) {
      l[n - 1 - k] *= k / fade;
      r[n - 1 - k] *= k / fade;
    }
  }

  private finish(): void {
    const intro = this.introOut;
    this.out = {
      id: this.def.id,
      sampleRate: this.sampleRate,
      bpm: this.def.bpm,
      intro: this.stinger ? null : intro,
      introSamples: this.stinger ? 0 : this.introSamples,
      loop: this.stinger ? intro! : this.loopOut!,
      loopSamples: this.stinger ? intro![0].length : this.loopSamples,
      lift: this.stinger ? null : this.liftOut,
      introBars: this.introBars,
      loopBars: this.loopBars,
      lufs: this.measured.lufs,
      truePeakDb: this.measured.peakDb,
      gain: this.gain,
      renderMs: this.busy,
    };
    this.phase = 'done';
  }
}

/** Render a whole song at once (the Worker, Node). */
export function renderSong(def: SongDef, opts: RenderOptions = {}): RenderedSong {
  const r = new SongRender(def, opts);
  r.step();
  return r.result();
}

/** Bytes of a rendered song's samples. */
export function songBytes(s: Pick<RenderedSong, 'intro' | 'loop' | 'lift'>): number {
  return [...(s.intro ?? []), ...s.loop, ...(s.lift ? [s.lift] : [])].reduce((n, b) => n + b.byteLength, 0);
}
