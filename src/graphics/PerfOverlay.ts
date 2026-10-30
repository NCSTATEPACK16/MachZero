import { FrameStats, HITCH_MS, MISSED_FRAME_MS, type FrameSummary } from '../core/FrameStats';

export interface PerfExtras {
  preset: string;
  /** Render pixels per CSS pixel. */
  pixelRatio: number;
  /** Dynamic-resolution factor. */
  dynScale: number;
  calls: number;
  triangles: number;
}

/**
 * Frame-time panel (top-right), shown with `?perf=1` or `?debug=1`: a graph of the last 4 s of frames against the
 * 60 Hz and 30 Hz lines, the recent percentiles and the current race's missed frames and hitches, so a phone
 * reading can be screenshotted. Unlike `?debug=1` it does not turn on preserveDrawingBuffer (which costs
 * bandwidth on mobile GPUs), so it measures the game as players get it.
 */
export class PerfOverlay {
  private readonly el: HTMLDivElement;
  private readonly text: HTMLPreElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private acc = 0;
  private lastText = '';
  /** The last finished race's summary (kept on screen under the live numbers). */
  private lastRace = '';

  constructor(
    container: HTMLElement,
    private readonly stats: FrameStats,
  ) {
    this.el = document.createElement('div');
    this.el.setAttribute('data-debug', 'perf');
    Object.assign(this.el.style, {
      position: 'fixed',
      top: 'calc(8px + env(safe-area-inset-top))',
      right: 'calc(8px + env(safe-area-inset-right))',
      zIndex: '60',
      padding: '6px 8px',
      font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace',
      color: '#19f0ff',
      background: 'rgba(5, 3, 15, 0.78)',
      border: '1px solid rgba(25, 240, 255, 0.35)',
      borderRadius: '4px',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.canvas = document.createElement('canvas');
    this.canvas.width = stats.capacity;
    this.canvas.height = 50;
    Object.assign(this.canvas.style, { display: 'block', width: `${stats.capacity}px`, height: '50px', marginBottom: '4px' });
    this.ctx = this.canvas.getContext('2d');
    this.text = document.createElement('pre');
    Object.assign(this.text.style, { margin: '0', font: 'inherit' });
    this.el.append(this.canvas, this.text);
    container.appendChild(this.el);
  }

  /** Remember a finished race's numbers (shown until the next one finishes). */
  setRaceSummary(world: string, s: FrameSummary): void {
    this.lastRace = `last race (${world})\n${formatSummary(s)}`;
    this.lastText = '';
  }

  /** Call once per frame; redraws 4× a second. */
  update(dt: number, extras: PerfExtras): void {
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const s = this.stats.summary();
    const text =
      `${extras.preset.toUpperCase()}  res ×${extras.pixelRatio.toFixed(2)}  dyn ${Math.round(extras.dynScale * 100)}%\n` +
      `frame p50 ${s.p50.toFixed(1)}  p95 ${s.p95.toFixed(1)}  p99 ${s.p99.toFixed(1)} ms\n` +
      `cpu  sim ${s.simMs.toFixed(1)}  upd ${s.updateMs.toFixed(1)}  draw ${s.renderMs.toFixed(1)} ms\n` +
      `${extras.calls} calls  ${(extras.triangles / 1000).toFixed(0)}k tris\n` +
      `this race ${formatSummary(s)}` +
      (this.lastRace ? `\n${this.lastRace}` : '');
    if (text !== this.lastText) {
      this.text.textContent = text;
      this.lastText = text;
    }
    this.drawGraph();
  }

  private drawGraph(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    const maxMs = 50;
    const y = (ms: number) => h - (Math.min(ms, maxMs) / maxMs) * h;
    ctx.clearRect(0, 0, w, h);
    const ring = this.stats.ring;
    const n = this.stats.size;
    const start = this.stats.start;
    for (let i = 0; i < n; i++) {
      const ms = ring[(start + i) % this.stats.capacity];
      ctx.fillStyle = ms > HITCH_MS ? '#ff3344' : ms > MISSED_FRAME_MS ? '#ffb020' : '#19f0ff';
      const top = y(ms);
      ctx.fillRect(w - n + i, top, 1, h - top);
    }
    ctx.fillStyle = 'rgba(244, 247, 255, 0.5)';
    ctx.fillRect(0, Math.round(y(1000 / 60)), w, 1);
    ctx.fillRect(0, Math.round(y(1000 / 30)), w, 1);
  }

  dispose(): void {
    this.el.remove();
  }
}

export function formatSummary(s: FrameSummary): string {
  return `${s.fps.toFixed(0)} fps  missed ${(s.missed * 100).toFixed(1)}%  hitches ${s.hitches}  worst ${s.worst.toFixed(0)} ms`;
}
