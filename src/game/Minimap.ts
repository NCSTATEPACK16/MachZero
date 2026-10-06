import type { ShipState, TrackData, TrackSample } from '../core/contracts';

const PAD = 14;

function hex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Top-down canvas minimap. The static track outline is rendered once to an offscreen
 * layer (split paths drawn thinner); ship dots are drawn on top each frame. The map
 * is rotated so the start straight points up the screen.
 */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly base: HTMLCanvasElement;
  private readonly size: number;
  private readonly dpr: number;

  // world (x,z) → canvas transform: rotate by theta, scale, translate
  private cos = 1;
  private sin = 0;
  private scale = 1;
  private offX = 0;
  private offZ = 0;

  constructor(private readonly track: TrackData, size = 180) {
    this.size = size;
    this.dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(size * this.dpr);
    this.canvas.height = Math.round(size * this.dpr);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.className = 'mz-minimap-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    this.computeTransform();
    this.drawBase();
  }

  /** Redraw the ship dots on top of the cached track outline. */
  update(ships: readonly ShipState[], player: ShipState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.scale(s, s);

    // AI first, player last so it sits on top.
    for (const ship of ships) {
      if (ship === player || ship.status === 'retired') continue;
      const [x, y] = this.map(ship.position.x, ship.position.z);
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = hex(ship.def.livery.primary);
      ctx.shadowColor = hex(ship.def.livery.glow);
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.stroke();
    }

    const [px, py] = this.map(player.position.x, player.position.z);
    // heading tick: ship forward is local -Z
    const q = player.quaternion;
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const hx = fx * this.cos - fz * this.sin;
    const hz = fx * this.sin + fz * this.cos;
    const hl = Math.hypot(hx, hz) || 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + (hx / hl) * 12, py + (hz / hl) * 12);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(px, py, 5.6, 0, Math.PI * 2);
    ctx.fillStyle = hex(player.def.livery.primary);
    ctx.shadowColor = hex(player.def.livery.glow);
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  // ---------------------------------------------------------------------

  private map(x: number, z: number): [number, number] {
    const rx = x * this.cos - z * this.sin;
    const rz = x * this.sin + z * this.cos;
    return [rx * this.scale + this.offX, rz * this.scale + this.offZ];
  }

  private computeTransform(): void {
    const samples = this.track.samples;
    // Rotate so the start-line forward direction points up the screen (-y).
    const f = samples[0].forward;
    const heading = Math.atan2(f.z, f.x);
    const theta = -Math.PI / 2 - heading;
    this.cos = Math.cos(theta);
    this.sin = Math.sin(theta);

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of [...samples, ...this.track.branches.flatMap((b) => b.samples)]) {
      const rx = s.position.x * this.cos - s.position.z * this.sin;
      const rz = s.position.x * this.sin + s.position.z * this.cos;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (rz < minZ) minZ = rz;
      if (rz > maxZ) maxZ = rz;
    }
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxZ - minZ);
    const avail = this.size - PAD * 2;
    this.scale = Math.min(avail / w, avail / h);
    this.offX = (this.size - w * this.scale) / 2 - minX * this.scale;
    this.offZ = (this.size - h * this.scale) / 2 - minZ * this.scale;
  }

  private drawBase(): void {
    const ctx = this.base.getContext('2d');
    if (!ctx) return;
    ctx.scale(this.dpr, this.dpr);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const samples = this.track.samples;

    const trace = (pts: readonly TrackSample[], closed: boolean): void => {
      const stride = Math.max(1, Math.floor(pts.length / 256));
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += stride) {
        const [x, y] = this.map(pts[i].position.x, pts[i].position.z);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (closed) ctx.closePath();
      else {
        const last = pts[pts.length - 1];
        ctx.lineTo(...this.map(last.position.x, last.position.z));
      }
    };

    // dark under-stroke, neon core; split paths (half width) drawn thinner, under the main loop
    const roads: [readonly TrackSample[], boolean, number][] = [
      ...this.track.branches.map((b): [readonly TrackSample[], boolean, number] => [b.samples, false, 0.6]),
      [samples, true, 1],
    ];
    for (const [pts, closed, w] of roads) {
      trace(pts, closed);
      ctx.lineWidth = 8 * w;
      ctx.strokeStyle = 'rgba(5,3,15,0.85)';
      ctx.stroke();
      trace(pts, closed);
      ctx.lineWidth = 4 * w;
      ctx.strokeStyle = 'rgba(25,240,255,0.30)';
      ctx.shadowColor = '#19f0ff';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      trace(pts, closed);
      ctx.lineWidth = 1.6 * w;
      ctx.strokeStyle = '#19f0ff';
      ctx.stroke();
    }

    // pit lane highlight
    for (const zone of this.track.zones) {
      if (zone.type !== 'pit') continue;
      const span = ((zone.uEnd - zone.uStart) % 1 + 1) % 1;
      const n = Math.max(2, Math.ceil(span * samples.length));
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const u = zone.uStart + (i / n) * span;
        const s = samples[Math.floor((u - Math.floor(u)) * samples.length) % samples.length];
        const [x, y] = this.map(s.position.x, s.position.z);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = '#ffb319';
      ctx.stroke();
    }

    // start line tick
    const s0 = samples[0];
    const [ax, ay] = this.map(s0.position.x + s0.right.x * 12, s0.position.z + s0.right.z * 12);
    const [bx, by] = this.map(s0.position.x - s0.right.x * 12, s0.position.z - s0.right.z * 12);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
}
