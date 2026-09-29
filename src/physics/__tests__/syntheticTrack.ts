import * as THREE from 'three';
import { CONFIG } from '../../core/config';
import type { GridSlot, TrackData, TrackProjection, TrackSample, TrackZone, TriMesh } from '../../core/contracts';
import { wrap01 } from '../../core/math';

export interface SyntheticTrackOptions {
  /** Centerline radius (m). */
  radius?: number;
  /** Height of the driving surface above y = 0. */
  elevation?: number;
  /** Segments around the loop for collision meshes. */
  segments?: number;
  /** Constant bank (rad); positive tilts the surface toward the circle centre (right side lower... i.e. up leans right). */
  bank?: number;
  zones?: TrackZone[];
}

/**
 * A flat circular loop in the XZ plane. Travel direction is counter-clockwise seen from +Y,
 * up = +Y, so `right` points toward the circle centre (curvature > 0 = turning right, as required).
 * Frames and projection are analytic, collision meshes are watertight rails + a flat surface strip.
 */
export function makeSyntheticTrack(opts: SyntheticTrackOptions = {}): TrackData {
  const R = opts.radius ?? 1000;
  const y0 = opts.elevation ?? 30;
  const N = opts.segments ?? 1024;
  const bank = opts.bank ?? 0;
  const cb = Math.cos(bank);
  const sb = Math.sin(bank);
  const halfWidth = CONFIG.TRACK_HALF_WIDTH;
  const railHeight = CONFIG.RAIL_HEIGHT;
  const railThickness = CONFIG.RAIL_THICKNESS;
  const length = 2 * Math.PI * R;

  const frameAt = (u: number, out: TrackSample): TrackSample => {
    const th = u * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    out.u = wrap01(u);
    out.distance = out.u * length;
    out.position.set(R * c, y0, R * s);
    out.forward.set(-s, 0, c);
    // up leans toward the circle centre by `bank`; right = forward x up.
    out.up.set(-c * sb, cb, -s * sb);
    out.right.set(-c * cb, -sb, -s * cb);
    out.roll = bank;
    out.curvature = 1 / R;
    out.halfWidth = halfWidth;
    return out;
  };
  const makeSample = (): TrackSample => ({
    u: 0,
    distance: 0,
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    up: new THREE.Vector3(),
    right: new THREE.Vector3(),
    roll: 0,
    curvature: 0,
    halfWidth,
  });

  const samples: TrackSample[] = [];
  for (let i = 0; i < CONFIG.TRACK_SAMPLES; i++) samples.push(frameAt(i / CONFIG.TRACK_SAMPLES, makeSample()));

  const curvePoints: THREE.Vector3[] = [];
  for (let i = 0; i < 24; i++) curvePoints.push(frameAt(i / 24, makeSample()).position.clone());
  const curve = new THREE.CatmullRomCurve3(curvePoints, true, 'centripetal');

  const sampleAt = (u: number, out?: TrackSample): TrackSample => frameAt(u, out ?? makeSample());

  const project = (pos: THREE.Vector3): TrackProjection => {
    const u = wrap01(Math.atan2(pos.z, pos.x) / (Math.PI * 2));
    const sample = frameAt(u, makeSample());
    const rho = R - Math.hypot(pos.x, pos.z); // horizontal distance toward the centre
    const dy = pos.y - y0;
    return {
      u,
      distance: u * length,
      lateral: rho * cb - dy * sb,
      height: rho * sb + dy * cb,
      sample,
    };
  };

  // --- collision meshes ---
  const surface = buildSurface(R, y0, halfWidth, N, bank);
  const rails = buildRails(R, y0, halfWidth, railThickness, railHeight, N, bank);

  const startGrid: GridSlot[] = [];
  for (let i = 0; i < 4; i++) {
    const u = wrap01(-(12 + i * 8) / length);
    const s = frameAt(u, makeSample());
    const lateral = i % 2 === 0 ? -4 : 4;
    const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
    const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
    startGrid.push({ u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) });
  }

  return {
    seed: 0,
    length,
    halfWidth,
    railHeight,
    curve,
    samples,
    sampleAt,
    project,
    zones: opts.zones ?? [],
    startGrid,
    collision: { surface, rails },
    visual: new THREE.Group(),
    corkscrew: { uStart: 0.5, uEnd: 0.6 },
  };
}

/** World point at (lateral, height) in the banked cross-section at angle th. */
function ringPoint(R: number, y0: number, lateral: number, height: number, th: number, bank: number): [number, number, number] {
  const cb = Math.cos(bank);
  const sb = Math.sin(bank);
  // right = (cb * inward, -sb), up = (sb * inward, cb) in the (inward-horizontal, Y) plane.
  const inward = lateral * cb + height * sb;
  const y = y0 - lateral * sb + height * cb;
  const r = R - inward;
  return [r * Math.cos(th), y, r * Math.sin(th)];
}

function buildSurface(R: number, y0: number, halfWidth: number, N: number, bank: number): TriMesh {
  const laterals = [-halfWidth, 0, halfWidth];
  const vertices = new Float32Array(N * laterals.length * 3);
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    for (let j = 0; j < laterals.length; j++) {
      const [x, y, z] = ringPoint(R, y0, laterals[j], 0, th, bank);
      const o = (i * laterals.length + j) * 3;
      vertices[o] = x;
      vertices[o + 1] = y;
      vertices[o + 2] = z;
    }
  }
  const idx: number[] = [];
  const L = laterals.length;
  for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N;
    for (let j = 0; j < L - 1; j++) {
      const a = i * L + j;
      const b = i * L + j + 1;
      const c = i2 * L + j;
      const d = i2 * L + j + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { vertices, indices: new Uint32Array(idx) };
}

/** Two closed rectangular tubes (watertight solids) flanking the track. */
function buildRails(
  R: number,
  y0: number,
  halfWidth: number,
  thickness: number,
  height: number,
  N: number,
  bank: number,
): TriMesh {
  const verts: number[] = [];
  const idx: number[] = [];
  for (const side of [-1, 1]) {
    const inner = side * halfWidth;
    const outer = side * (halfWidth + thickness);
    const base = verts.length / 3;
    // 4 corners per ring section: inner-bottom, outer-bottom, outer-top, inner-top.
    const corners: Array<[number, number]> = [
      [inner, 0],
      [outer, 0],
      [outer, height],
      [inner, height],
    ];
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      for (const [lat, h] of corners) verts.push(...ringPoint(R, y0, lat, h, th, bank));
    }
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        const a = base + i * 4 + k;
        const b = base + i * 4 + k2;
        const c = base + i2 * 4 + k;
        const d = base + i2 * 4 + k2;
        idx.push(a, b, c, b, d, c);
      }
    }
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}
