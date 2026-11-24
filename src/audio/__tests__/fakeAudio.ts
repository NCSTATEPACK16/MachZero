/**
 * A fake Web Audio context for Node tests (IMPLEMENTATION §M6a step 1). It implements the subset of the API that
 * MachZero's audio code uses and records every call into `log` as one line of text, so a test can compare a whole
 * session's graph and automation against a golden file. Numbers are rounded to 10 significant digits so that the
 * log is stable across harmless reorderings of floating-point arithmetic.
 *
 * Log lines:
 *   new AudioContext {"latencyHint":"interactive"}
 *   #3 = Gain                       a node was created (#0 is the destination)
 *   #3.connect(#2)                  #3.disconnect() / #3.disconnect(#2)
 *   #3.gain = 0.8                   a property or AudioParam value set
 *   #3.gain.setTargetAtTime(0.8, 0, 0.02)
 *   #5.start(0.5) / #5.stop(1.2)
 *   buf1 = createBuffer(1, 88200, 44100)
 *   ctx.resume() / ctx.suspend() / ctx.close()
 */

export const fmt = (v: unknown): string => {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Number(v.toPrecision(10))) : String(v);
  if (v instanceof FakeAudioNode) return `#${v.id}`;
  if (v instanceof FakeAudioBuffer) return v.name;
  if (v instanceof Float32Array) {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * ((i % 7) + 1);
    return `Float32Array(${v.length}; ${fmt(sum)})`;
  }
  if (v === undefined) return 'undefined';
  return JSON.stringify(v);
};

export class FakeAudioParam {
  private _value: number;
  constructor(
    private readonly ctx: FakeAudioContext,
    private readonly owner: FakeAudioNode,
    private readonly name: string,
    value: number,
  ) {
    this._value = value;
  }
  get value(): number {
    return this._value;
  }
  set value(v: number) {
    this._value = v;
    this.ctx.record(`#${this.owner.id}.${this.name} = ${fmt(v)}`);
  }
  private call(method: string, ...args: number[]): this {
    this.ctx.record(`#${this.owner.id}.${this.name}.${method}(${args.map(fmt).join(', ')})`);
    return this;
  }
  setValueAtTime(v: number, t: number): this {
    this._value = v;
    return this.call('setValueAtTime', v, t);
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this._value = v;
    return this.call('linearRampToValueAtTime', v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    this._value = v;
    return this.call('exponentialRampToValueAtTime', v, t);
  }
  setTargetAtTime(v: number, t: number, tc: number): this {
    this._value = v;
    return this.call('setTargetAtTime', v, t, tc);
  }
  cancelScheduledValues(t: number): this {
    return this.call('cancelScheduledValues', t);
  }
  cancelAndHoldAtTime(t: number): this {
    return this.call('cancelAndHoldAtTime', t);
  }
}

export class FakeAudioNode {
  readonly id: number;
  readonly inputs = new Set<FakeAudioNode>();
  readonly outputs = new Set<FakeAudioNode>();
  onended: (() => void) | null = null;
  private props = new Map<string, unknown>();

  constructor(
    readonly context: FakeAudioContext,
    readonly kind: string,
    params: Record<string, number> = {},
    props: Record<string, unknown> = {},
  ) {
    this.id = context.nextNodeId++;
    context.nodes.push(this);
    if (kind !== 'Destination') context.record(`#${this.id} = ${kind}`);
    for (const [name, v] of Object.entries(params)) {
      Object.defineProperty(this, name, { value: new FakeAudioParam(context, this, name, v), enumerable: true });
    }
    const all: Record<string, unknown> = { channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers', ...props };
    for (const [name, v] of Object.entries(all)) {
      this.props.set(name, v);
      Object.defineProperty(this, name, {
        get: () => this.props.get(name),
        set: (nv: unknown) => {
          this.props.set(name, nv);
          context.record(`#${this.id}.${name} = ${fmt(nv)}`);
        },
        enumerable: true,
      });
    }
  }

  /** Read a param by name (tests). */
  param(name: string): FakeAudioParam {
    return (this as unknown as Record<string, FakeAudioParam>)[name];
  }

  /** Read a plain property by name (tests). */
  prop(name: string): unknown {
    return this.props.get(name);
  }

  connect(dest: FakeAudioNode | FakeAudioParam, output?: number, input?: number): FakeAudioNode | FakeAudioParam {
    const extra = [output, input].filter((x) => x !== undefined).map(fmt);
    const target = dest instanceof FakeAudioNode ? `#${dest.id}` : 'param';
    this.context.record(`#${this.id}.connect(${[target, ...extra].join(', ')})`);
    if (dest instanceof FakeAudioNode) {
      this.outputs.add(dest);
      dest.inputs.add(this);
    }
    return dest;
  }

  disconnect(dest?: FakeAudioNode): void {
    this.context.record(dest ? `#${this.id}.disconnect(#${dest.id})` : `#${this.id}.disconnect()`);
    const targets = dest ? [dest] : [...this.outputs];
    for (const t of targets) {
      this.outputs.delete(t);
      t.inputs.delete(this);
    }
  }

  start(...args: number[]): void {
    this.context.record(`#${this.id}.start(${args.map(fmt).join(', ')})`);
    this.context.started.add(this);
  }

  stop(...args: number[]): void {
    this.context.record(`#${this.id}.stop(${args.map(fmt).join(', ')})`);
  }

  addEventListener(type: string, fn: () => void): void {
    if (type === 'ended') this.endedListeners.push(fn);
  }

  removeEventListener(type: string, fn: () => void): void {
    if (type === 'ended') this.endedListeners = this.endedListeners.filter((f) => f !== fn);
  }

  endedListeners: Array<() => void> = [];

  /** Fire `ended` as the browser would when a source stops. */
  fireEnded(): void {
    this.context.started.delete(this);
    this.onended?.();
    for (const fn of [...this.endedListeners]) fn();
  }
}

export class FakeAudioBuffer {
  readonly name: string;
  readonly duration: number;
  private readonly data: Float32Array[];
  constructor(
    ctx: FakeAudioContext | null,
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.name = ctx ? `buf${++ctx.nextBufferId}` : 'buf?';
    this.duration = length / sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(c: number): Float32Array {
    return this.data[c];
  }
  copyToChannel(src: Float32Array, c: number, offset = 0): void {
    this.data[c].set(src.subarray(0, this.length - offset), offset);
  }
}

export interface FakeContextOptions {
  latencyHint?: string;
  sampleRate?: number;
}

/** The state a new context starts in (browsers start `suspended` without a gesture; tests can choose). */
let initialState: AudioContextState = 'running';

export class FakeAudioContext {
  /** Every context created since the last `FakeAudioContext.reset()`. */
  static instances: FakeAudioContext[] = [];
  /** Set to make constructors throw (a browser without audio). */
  static throwOnCreate = false;

  static reset(state: AudioContextState = 'running'): void {
    FakeAudioContext.instances = [];
    FakeAudioContext.throwOnCreate = false;
    initialState = state;
  }

  readonly log: string[] = [];
  readonly nodes: FakeAudioNode[] = [];
  readonly started = new Set<FakeAudioNode>();
  nextNodeId = 0;
  nextBufferId = 0;
  currentTime = 0;
  readonly sampleRate: number;
  state: AudioContextState | 'interrupted' = initialState;
  readonly destination: FakeAudioNode;
  onstatechange: (() => void) | null = null;
  private stateListeners: Array<() => void> = [];

  constructor(opts?: FakeContextOptions) {
    if (FakeAudioContext.throwOnCreate) throw new Error('no audio');
    this.sampleRate = opts?.sampleRate ?? 44100;
    this.record(`new AudioContext ${opts ? JSON.stringify(opts) : ''}`.trim());
    this.destination = new FakeAudioNode(this, 'Destination', {}, { maxChannelCount: 2 });
    FakeAudioContext.instances.push(this);
  }

  record(line: string): void {
    this.log.push(line);
  }

  createGain(): FakeAudioNode {
    return new FakeAudioNode(this, 'Gain', { gain: 1 });
  }
  createOscillator(): FakeAudioNode {
    return new FakeAudioNode(this, 'Oscillator', { frequency: 440, detune: 0 }, { type: 'sine' });
  }
  createBiquadFilter(): FakeAudioNode {
    return new FakeAudioNode(this, 'BiquadFilter', { frequency: 350, Q: 1, gain: 0, detune: 0 }, { type: 'lowpass' });
  }
  createBufferSource(): FakeAudioNode {
    return new FakeAudioNode(this, 'BufferSource', { playbackRate: 1, detune: 0 }, { buffer: null, loop: false, loopStart: 0, loopEnd: 0 });
  }
  createDynamicsCompressor(): FakeAudioNode {
    return new FakeAudioNode(this, 'DynamicsCompressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }, { reduction: 0 });
  }
  createStereoPanner(): FakeAudioNode {
    return new FakeAudioNode(this, 'StereoPanner', { pan: 0 });
  }
  createDelay(maxDelayTime = 1): FakeAudioNode {
    return new FakeAudioNode(this, `Delay(${fmt(maxDelayTime)})`, { delayTime: 0 });
  }
  createWaveShaper(): FakeAudioNode {
    return new FakeAudioNode(this, 'WaveShaper', {}, { curve: null, oversample: 'none' });
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    const b = new FakeAudioBuffer(this, channels, length, sampleRate);
    this.record(`${b.name} = createBuffer(${channels}, ${length}, ${fmt(sampleRate)})`);
    return b;
  }

  private setState(s: AudioContextState | 'interrupted'): void {
    if (this.state === s) return;
    this.state = s;
    this.onstatechange?.();
    for (const fn of [...this.stateListeners]) fn();
  }

  /** Tests: move the context to a state as the browser would (e.g. iOS `interrupted`). */
  forceState(s: AudioContextState | 'interrupted'): void {
    this.setState(s);
  }

  resume(): Promise<void> {
    this.record('ctx.resume()');
    if (this.state !== 'closed') this.setState('running');
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.record('ctx.suspend()');
    if (this.state !== 'closed') this.setState('suspended');
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.record('ctx.close()');
    this.setState('closed');
    return Promise.resolve();
  }

  addEventListener(type: string, fn: () => void): void {
    if (type === 'statechange') this.stateListeners.push(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    if (type === 'statechange') this.stateListeners = this.stateListeners.filter((f) => f !== fn);
  }

  /** Fire `ended` on every started source (one-shots finishing), in creation order. */
  endAll(): void {
    for (const n of [...this.started].sort((a, b) => a.id - b.id)) if (n.onended || n.endedListeners.length) n.fireEnded();
  }

  /** Nodes currently connected to something or with an input (alive in the graph). */
  connectedNodes(): FakeAudioNode[] {
    return this.nodes.filter((n) => n.kind !== 'Destination' && (n.outputs.size > 0 || n.inputs.size > 0));
  }
}

/** A minimal `window` + `document` for audio code: records listeners so a test can fire them. */
export interface FakeDom {
  window: {
    AudioContext?: unknown;
    addEventListener(type: string, fn: () => void, opts?: unknown): void;
    removeEventListener(type: string, fn: () => void): void;
  };
  document: {
    hidden: boolean;
    visibilityState: string;
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
  };
  navigator: Record<string, unknown>;
  /** Fire every window listener of a type (e.g. 'pointerdown'). */
  fire(type: string): void;
  /** Set `document.hidden` and fire `visibilitychange`. */
  setHidden(hidden: boolean): void;
  listeners(type: string): number;
}

export function makeFakeDom(): FakeDom {
  const win = new Map<string, Array<() => void>>();
  const doc = new Map<string, Array<() => void>>();
  const add = (m: Map<string, Array<() => void>>) => (type: string, fn: () => void) => {
    const list = m.get(type) ?? [];
    if (!list.includes(fn)) list.push(fn);
    m.set(type, list);
  };
  const remove = (m: Map<string, Array<() => void>>) => (type: string, fn: () => void) => {
    m.set(
      type,
      (m.get(type) ?? []).filter((f) => f !== fn),
    );
  };
  const dom: FakeDom = {
    window: { AudioContext: FakeAudioContext, addEventListener: add(win), removeEventListener: remove(win) },
    document: { hidden: false, visibilityState: 'visible', addEventListener: add(doc), removeEventListener: remove(doc) },
    navigator: {},
    fire(type) {
      for (const fn of [...(win.get(type) ?? [])]) fn();
    },
    setHidden(hidden) {
      dom.document.hidden = hidden;
      dom.document.visibilityState = hidden ? 'hidden' : 'visible';
      for (const fn of [...(doc.get('visibilitychange') ?? [])]) fn();
    },
    listeners(type) {
      return (win.get(type) ?? []).length;
    },
  };
  return dom;
}

/** A seeded linear congruential generator in [0, 1) for `Math.random` in golden tests. */
export function lcg(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
