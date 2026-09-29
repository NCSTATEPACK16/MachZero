/**
 * Custom profile sweep.
 *
 * A 2D cross-section (THREE.Shape / polyline in (x = lateral-right, y = up) coordinates) is swept
 * along our own banked/twisted frames: profile point (x, y) maps to `position + right·x + up·y`.
 * `ExtrudeGeometry` cannot do this (Frenet frames, no roll control), hence this module.
 *
 * Profiles are listed counter-clockwise (outward normal = (dy, -dx) of each segment). Segments
 * get their own vertex pair per ring so profile corners stay crisp; normals are exact per ring.
 * For closed loops an extra seam ring duplicates ring 0 (identical position/normal, UV advanced
 * to the full lap length) so textures tile without a stretched last quad while the surface stays
 * crack-free. The collision sweep is fully welded instead (no UVs needed).
 */
import * as THREE from 'three';
import type { TriMesh } from '../core/contracts';
import type { FrameSet } from './TrackFrames';
import type { TrackQuery } from './TrackQuery';
import { wrap01 } from '../core/math';

export interface SweepFrames {
  /** Number of distinct rings (excluding the duplicated seam ring of a closed loop). */
  count: number;
  closed: boolean;
  pos: Float64Array;
  right: Float64Array;
  up: Float64Array;
  /** Metres along the sweep for each ring (used for the u texture coordinate). */
  dist: Float64Array;
  /** Distance at the seam ring of a closed loop (the lap length). */
  totalLength: number;
}

export interface ProfilePoint {
  x: number;
  y: number;
  /** Explicit v texture coordinate; defaults to cumulative profile length * vScale. */
  v?: number;
}

export interface UvOptions {
  /** Metres of track per texture repeat along u. */
  uTile: number;
  /** v per metre of profile length (used when points carry no explicit v). */
  vScale?: number;
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array | null;
  indices: Uint32Array;
}

/** Convert a THREE.Shape (or any Vector2 outline) into profile points. */
export function profileFromShape(shape: THREE.Shape, vOf?: (p: THREE.Vector2, i: number) => number): ProfilePoint[] {
  const pts = shape.getPoints();
  // Path.getPoints may repeat the first point when the path is closed.
  if (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-12) pts.pop();
  return pts.map((p, i) => (vOf ? { x: p.x, y: p.y, v: vOf(p, i) } : { x: p.x, y: p.y }));
}

/** Mirror across x = 0 keeping the counter-clockwise ordering (reverses point order). */
export function mirrorProfile(points: ProfilePoint[]): ProfilePoint[] {
  return points
    .map((p) => (p.v === undefined ? { x: -p.x, y: p.y } : { x: -p.x, y: p.y, v: p.v }))
    .reverse();
}

export function framesFromFrameSet(fs: FrameSet): SweepFrames {
  const dist = new Float64Array(fs.count);
  for (let i = 0; i < fs.count; i++) dist[i] = i * fs.ds;
  return { count: fs.count, closed: true, pos: fs.pos, right: fs.right, up: fs.up, dist, totalLength: fs.length };
}

/**
 * Open frames covering distance [dStart, dEnd] (metres, may be negative to wrap behind the start
 * line) sampled every ~`step` metres from the query. `dist` is relative to dStart.
 */
export function framesFromRange(query: TrackQuery, length: number, dStart: number, dEnd: number, step: number): SweepFrames {
  const span = dEnd - dStart;
  const count = Math.max(2, Math.ceil(span / step) + 1);
  const pos = new Float64Array(count * 3);
  const right = new Float64Array(count * 3);
  const up = new Float64Array(count * 3);
  const dist = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const d = (span * k) / (count - 1);
    const s = query.sampleAt(wrap01((dStart + d) / length));
    pos[k * 3] = s.position.x;
    pos[k * 3 + 1] = s.position.y;
    pos[k * 3 + 2] = s.position.z;
    right[k * 3] = s.right.x;
    right[k * 3 + 1] = s.right.y;
    right[k * 3 + 2] = s.right.z;
    up[k * 3] = s.up.x;
    up[k * 3 + 1] = s.up.y;
    up[k * 3 + 2] = s.up.z;
    dist[k] = d;
  }
  return { count, closed: false, pos, right, up, dist, totalLength: span };
}

/**
 * Sweep `points` along `frames`. `closedProfile` joins the last point back to the first.
 * `ringColors` (rgb per ring) becomes a per-vertex color attribute.
 */
export function sweepProfile(
  frames: SweepFrames,
  points: ProfilePoint[],
  closedProfile: boolean,
  uv: UvOptions,
  ringColors?: Float32Array,
): MeshData {
  const P = points.length;
  const segs = closedProfile ? P : P - 1;
  const rings = frames.count + (frames.closed ? 1 : 0);
  const vertCount = rings * segs * 2;

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = ringColors ? new Float32Array(vertCount * 3) : null;

  // Per-segment 2D normal (outward for counter-clockwise profiles) and v range.
  const nx = new Float64Array(segs);
  const ny = new Float64Array(segs);
  const v0 = new Float64Array(segs);
  const v1 = new Float64Array(segs);
  const vScale = uv.vScale ?? 1;
  let cumulative = 0;
  for (let j = 0; j < segs; j++) {
    const a = points[j];
    const b = points[(j + 1) % P];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    nx[j] = dy / len;
    ny[j] = -dx / len;
    v0[j] = a.v !== undefined ? a.v : cumulative * vScale;
    cumulative += len;
    v1[j] = b.v !== undefined ? b.v : cumulative * vScale;
  }

  for (let r = 0; r < rings; r++) {
    const ri = r % frames.count;
    const i3 = ri * 3;
    const px = frames.pos[i3];
    const py = frames.pos[i3 + 1];
    const pz = frames.pos[i3 + 2];
    const rx = frames.right[i3];
    const ry = frames.right[i3 + 1];
    const rz = frames.right[i3 + 2];
    const ux = frames.up[i3];
    const uy = frames.up[i3 + 1];
    const uz = frames.up[i3 + 2];
    const s = r === frames.count ? frames.totalLength : frames.dist[ri];
    const u = s / uv.uTile;
    for (let j = 0; j < segs; j++) {
      const a = points[j];
      const b = points[(j + 1) % P];
      const base = (r * segs + j) * 2;
      const nrx = rx * nx[j] + ux * ny[j];
      const nry = ry * nx[j] + uy * ny[j];
      const nrz = rz * nx[j] + uz * ny[j];
      for (let e = 0; e < 2; e++) {
        const q = e === 0 ? a : b;
        const vi = base + e;
        positions[vi * 3] = px + rx * q.x + ux * q.y;
        positions[vi * 3 + 1] = py + ry * q.x + uy * q.y;
        positions[vi * 3 + 2] = pz + rz * q.x + uz * q.y;
        normals[vi * 3] = nrx;
        normals[vi * 3 + 1] = nry;
        normals[vi * 3 + 2] = nrz;
        uvs[vi * 2] = u;
        uvs[vi * 2 + 1] = e === 0 ? v0[j] : v1[j];
        if (colors && ringColors) {
          colors[vi * 3] = ringColors[ri * 3];
          colors[vi * 3 + 1] = ringColors[ri * 3 + 1];
          colors[vi * 3 + 2] = ringColors[ri * 3 + 2];
        }
      }
    }
  }

  const indices = new Uint32Array((rings - 1) * segs * 6);
  let w = 0;
  for (let r = 0; r < rings - 1; r++) {
    for (let j = 0; j < segs; j++) {
      const a0 = (r * segs + j) * 2;
      const b0 = a0 + 1;
      const a1 = ((r + 1) * segs + j) * 2;
      const b1 = a1 + 1;
      indices[w++] = a0;
      indices[w++] = a1;
      indices[w++] = b0;
      indices[w++] = b0;
      indices[w++] = a1;
      indices[w++] = b1;
    }
  }
  return { positions, normals, uvs, colors, indices };
}

/** Fully welded closed sweep (shared vertices) for physics: `count * P` vertices, outward winding. */
export function sweepWelded(frames: SweepFrames, points: { x: number; y: number }[], closedProfile: boolean): TriMesh {
  const P = points.length;
  const segs = closedProfile ? P : P - 1;
  const n = frames.count;
  const vertices = new Float32Array(n * P * 3);
  for (let r = 0; r < n; r++) {
    const i3 = r * 3;
    for (let k = 0; k < P; k++) {
      const q = points[k];
      const o = (r * P + k) * 3;
      vertices[o] = frames.pos[i3] + frames.right[i3] * q.x + frames.up[i3] * q.y;
      vertices[o + 1] = frames.pos[i3 + 1] + frames.right[i3 + 1] * q.x + frames.up[i3 + 1] * q.y;
      vertices[o + 2] = frames.pos[i3 + 2] + frames.right[i3 + 2] * q.x + frames.up[i3 + 2] * q.y;
    }
  }
  const ringSpan = frames.closed ? n : n - 1;
  const indices = new Uint32Array(ringSpan * segs * 6);
  let w = 0;
  for (let r = 0; r < ringSpan; r++) {
    const r1 = (r + 1) % n;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % P;
      const a0 = r * P + j;
      const b0 = r * P + j1;
      const a1 = r1 * P + j;
      const b1 = r1 * P + j1;
      indices[w++] = a0;
      indices[w++] = a1;
      indices[w++] = b0;
      indices[w++] = b0;
      indices[w++] = a1;
      indices[w++] = b1;
    }
  }
  return { vertices, indices };
}

/** Concatenates MeshData chunks into one indexed BufferGeometry (one draw call per material). */
export class GeometryAccumulator {
  private readonly chunks: MeshData[] = [];

  add(data: MeshData): this {
    this.chunks.push(data);
    return this;
  }

  /** Add an existing BufferGeometry (position/normal/uv + index), optionally tinted with a constant color. */
  addGeometry(geo: THREE.BufferGeometry, color?: readonly [number, number, number]): this {
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const uvAttr = geo.getAttribute('uv');
    const idx = geo.getIndex();
    const n = pos.count;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = pos.getX(i);
      positions[i * 3 + 1] = pos.getY(i);
      positions[i * 3 + 2] = pos.getZ(i);
      normals[i * 3] = nor.getX(i);
      normals[i * 3 + 1] = nor.getY(i);
      normals[i * 3 + 2] = nor.getZ(i);
      uvs[i * 2] = uvAttr.getX(i);
      uvs[i * 2 + 1] = uvAttr.getY(i);
    }
    let colors: Float32Array | null = null;
    if (color) {
      colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        colors[i * 3] = color[0];
        colors[i * 3 + 1] = color[1];
        colors[i * 3 + 2] = color[2];
      }
    }
    let indices: Uint32Array;
    if (idx) {
      indices = new Uint32Array(idx.count);
      for (let i = 0; i < idx.count; i++) indices[i] = idx.getX(i);
    } else {
      indices = new Uint32Array(n);
      for (let i = 0; i < n; i++) indices[i] = i;
    }
    return this.add({ positions, normals, uvs, colors, indices });
  }

  get vertexCount(): number {
    return this.chunks.reduce((a, c) => a + c.positions.length / 3, 0);
  }

  get triangleCount(): number {
    return this.chunks.reduce((a, c) => a + c.indices.length / 3, 0);
  }

  toGeometry(): THREE.BufferGeometry {
    const vertexCount = this.vertexCount;
    const indexCount = this.chunks.reduce((a, c) => a + c.indices.length, 0);
    const anyColors = this.chunks.some((c) => c.colors !== null);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = anyColors ? new Float32Array(vertexCount * 3).fill(1) : null;
    const indices = new Uint32Array(indexCount);
    let vo = 0;
    let io = 0;
    for (const c of this.chunks) {
      positions.set(c.positions, vo * 3);
      normals.set(c.normals, vo * 3);
      uvs.set(c.uvs, vo * 2);
      if (colors && c.colors) colors.set(c.colors, vo * 3);
      for (let i = 0; i < c.indices.length; i++) indices[io + i] = c.indices[i] + vo;
      vo += c.positions.length / 3;
      io += c.indices.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    if (colors) geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}
