/**
 * Centerline resampling and frame construction.
 *
 * Pipeline: closed Catmull-Rom curve -> arc-length uniform resample ->
 * tangents / curvature -> rotation-minimising frames (double reflection) with the
 * closure twist spread linearly around the loop -> roll (banking + corkscrew).
 *
 * Everything here works on flat Float64Arrays (3 doubles per sample) so it stays fast
 * and allocation-free in the hot loops. Nothing touches the DOM.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { TrackSample } from '../core/contracts';
import { TAU, clamp, smootherstep } from '../core/math';

/** Arc-length parameterised polyline sampled from the spline. */
export interface ResampledCurve {
  count: number;
  /** Total loop length in metres. */
  length: number;
  /** Spacing between consecutive samples in metres (length / count). */
  ds: number;
  /** xyz triples, `count` samples, uniform by arc length, sample 0 = curve.getPoint(0). */
  pos: Float64Array;
  /** Arc length (metres) reached at curve parameter t in [0,1). */
  arcAtParam(t: number): number;
}

export interface Differentials {
  /** Unit tangents (xyz triples). */
  tan: Float64Array;
  /** dT/ds (xyz triples), 1/m. */
  dTds: Float64Array;
  /** |dT/ds| per sample, 1/m. */
  kappa: Float64Array;
}

export interface FrameSet {
  count: number;
  length: number;
  ds: number;
  pos: Float64Array;
  tan: Float64Array;
  up: Float64Array;
  right: Float64Array;
  /** Total roll relative to the rotation-minimising frame (banking + corkscrew). */
  roll: Float64Array;
  /** Banking part of the roll only. */
  bank: Float64Array;
  /** Pipe curl of the cross-section, 0 (flat deck) to 1 (closed tube); see features/pipe.ts. */
  curl: Float64Array;
  /** Signed lateral curvature (dT/ds)·rmfRight in the unbanked frame, positive = turning right. */
  curvature: Float64Array;
}

export interface CorkscrewRange {
  uStart: number;
  uEnd: number;
  /** Full barrel rolls (default 1). */
  turns?: number;
}

export interface BankOptions {
  /** Radians of roll per (1/m) of curvature, before the clamp. */
  bankFactor: number;
  maxBank: number;
}

const DEFAULT_BANK: BankOptions = { bankFactor: CONFIG.BANK_FACTOR, maxBank: CONFIG.MAX_BANK };

/**
 * Moves fine samples before arc-length resampling (jump ramps and flight arcs). `cum[j]` is the arc length of
 * fine sample j on the undisplaced curve; displace xyz triples in `fp` in place.
 */
export type CurveDisplacement = (fp: Float64Array, cum: Float64Array, fine: number) => void;

/**
 * Sample the closed spline finely, optionally displace the samples, then resample to `count` points uniform by
 * arc length. With a displacement, `remapDistance` maps a distance on the undisplaced curve to the result.
 */
export function resampleCurve(
  curve: THREE.CatmullRomCurve3,
  count: number,
  fine = 16384,
  displace?: CurveDisplacement,
): ResampledCurve & { remapDistance(d: number): number } {
  const fp = new Float64Array(fine * 3);
  const tmp = new THREE.Vector3();
  for (let j = 0; j < fine; j++) {
    curve.getPoint(j / fine, tmp);
    fp[j * 3] = tmp.x;
    fp[j * 3 + 1] = tmp.y;
    fp[j * 3 + 2] = tmp.z;
  }
  let cum = cumulativeLength(fp, fine);
  let remapDistance = (d: number): number => d;
  if (displace) {
    const before = cum;
    displace(fp, before, fine);
    const after = cumulativeLength(fp, fine);
    cum = after;
    remapDistance = (d: number): number => {
      const L0 = before[fine];
      const w = ((d % L0) + L0) % L0;
      let lo = 0;
      let hi = fine;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (before[mid] <= w) lo = mid;
        else hi = mid;
      }
      const seg = before[lo + 1] - before[lo];
      const f = seg > 0 ? (w - before[lo]) / seg : 0;
      return after[lo] + (after[lo + 1] - after[lo]) * f + (d - w) * (after[fine] / L0);
    };
  }
  const length = cum[fine];
  const ds = length / count;
  const pos = new Float64Array(count * 3);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = i * ds;
    while (j < fine - 1 && cum[j + 1] <= s) j++;
    const seg = cum[j + 1] - cum[j];
    const f = seg > 0 ? (s - cum[j]) / seg : 0;
    const k = (j + 1) % fine;
    pos[i * 3] = fp[j * 3] + (fp[k * 3] - fp[j * 3]) * f;
    pos[i * 3 + 1] = fp[j * 3 + 1] + (fp[k * 3 + 1] - fp[j * 3 + 1]) * f;
    pos[i * 3 + 2] = fp[j * 3 + 2] + (fp[k * 3 + 2] - fp[j * 3 + 2]) * f;
  }
  const arcAtParam = (t: number): number => {
    const w = t - Math.floor(t);
    const x = w * fine;
    const jj = Math.min(Math.floor(x), fine - 1);
    return cum[jj] + (cum[jj + 1] - cum[jj]) * (x - jj);
  };
  return { count, length, ds, pos, arcAtParam, remapDistance };
}

/** Running arc length of a closed polyline of `n` xyz points (n + 1 entries; the last closes the loop). */
function cumulativeLength(fp: Float64Array, n: number): Float64Array {
  const cum = new Float64Array(n + 1);
  let acc = 0;
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    const dx = fp[k * 3] - fp[j * 3];
    const dy = fp[k * 3 + 1] - fp[j * 3 + 1];
    const dz = fp[k * 3 + 2] - fp[j * 3 + 2];
    acc += Math.sqrt(dx * dx + dy * dy + dz * dz);
    cum[j + 1] = acc;
  }
  return cum;
}

/** Central-difference tangents and dT/ds on the periodic sample ring. */
export function computeDifferentials(pos: Float64Array, count: number, ds: number): Differentials {
  const tan = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = ((i + 1) % count) * 3;
    const b = ((i - 1 + count) % count) * 3;
    const dx = pos[a] - pos[b];
    const dy = pos[a + 1] - pos[b + 1];
    const dz = pos[a + 2] - pos[b + 2];
    const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
    tan[i * 3] = dx * inv;
    tan[i * 3 + 1] = dy * inv;
    tan[i * 3 + 2] = dz * inv;
  }
  const dTds = new Float64Array(count * 3);
  const kappa = new Float64Array(count);
  const inv2ds = 1 / (2 * ds);
  for (let i = 0; i < count; i++) {
    const a = ((i + 1) % count) * 3;
    const b = ((i - 1 + count) % count) * 3;
    const x = (tan[a] - tan[b]) * inv2ds;
    const y = (tan[a + 1] - tan[b + 1]) * inv2ds;
    const z = (tan[a + 2] - tan[b + 2]) * inv2ds;
    dTds[i * 3] = x;
    dTds[i * 3 + 1] = y;
    dTds[i * 3 + 2] = z;
    kappa[i] = Math.sqrt(x * x + y * y + z * z);
  }
  return { tan, dTds, kappa };
}

/** Periodic Gaussian smoothing (kernel truncated at 3 sigma). */
export function smoothPeriodic(values: Float64Array, sigma: number): Float64Array {
  const n = values.length;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + radius] = w;
    sum += w;
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      acc += values[(((i + k) % n) + n) % n] * kernel[k + radius];
    }
    out[i] = acc;
  }
  return out;
}

const rot = new Float64Array(3);

/** Rodrigues rotation of v about unit axis a by `ang` radians (right-handed), result in `rot`. */
function rotateAbout(vx: number, vy: number, vz: number, ax: number, ay: number, az: number, ang: number): void {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const d = (ax * vx + ay * vy + az * vz) * (1 - c);
  const cx = ay * vz - az * vy;
  const cy = az * vx - ax * vz;
  const cz = ax * vy - ay * vx;
  rot[0] = vx * c + cx * s + ax * d;
  rot[1] = vy * c + cy * s + ay * d;
  rot[2] = vz * c + cz * s + az * d;
}

/**
 * Rotation-minimising "up" vectors by double-reflection parallel transport (Wang et al. 2008).
 * The transported vector after a full loop generally differs from the start by a rotation
 * about the tangent (holonomy); that closure twist is distributed linearly so the loop closes.
 */
function rotationMinimisingUp(pos: Float64Array, tan: Float64Array, count: number): Float64Array {
  const up = new Float64Array(count * 3);
  // Initial normal: world up projected into the plane normal to the first tangent.
  {
    const tx = tan[0];
    const ty = tan[1];
    const tz = tan[2];
    let ux = -tx * ty;
    let uy = 1 - ty * ty;
    let uz = -tz * ty;
    const l = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= l;
    uy /= l;
    uz /= l;
    up[0] = ux;
    up[1] = uy;
    up[2] = uz;
  }
  let rx = up[0];
  let ry = up[1];
  let rz = up[2];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const i3 = i * 3;
    const j3 = j * 3;
    const v1x = pos[j3] - pos[i3];
    const v1y = pos[j3 + 1] - pos[i3 + 1];
    const v1z = pos[j3 + 2] - pos[i3 + 2];
    const c1 = v1x * v1x + v1y * v1y + v1z * v1z;
    const k1 = (2 / c1) * (v1x * rx + v1y * ry + v1z * rz);
    const rLx = rx - k1 * v1x;
    const rLy = ry - k1 * v1y;
    const rLz = rz - k1 * v1z;
    const kt = (2 / c1) * (v1x * tan[i3] + v1y * tan[i3 + 1] + v1z * tan[i3 + 2]);
    const tLx = tan[i3] - kt * v1x;
    const tLy = tan[i3 + 1] - kt * v1y;
    const tLz = tan[i3 + 2] - kt * v1z;
    const v2x = tan[j3] - tLx;
    const v2y = tan[j3 + 1] - tLy;
    const v2z = tan[j3 + 2] - tLz;
    const c2 = v2x * v2x + v2y * v2y + v2z * v2z;
    if (c2 > 1e-24) {
      const k2 = (2 / c2) * (v2x * rLx + v2y * rLy + v2z * rLz);
      rx = rLx - k2 * v2x;
      ry = rLy - k2 * v2y;
      rz = rLz - k2 * v2z;
    } else {
      rx = rLx;
      ry = rLy;
      rz = rLz;
    }
    if (j !== 0) {
      up[j3] = rx;
      up[j3 + 1] = ry;
      up[j3 + 2] = rz;
    }
  }
  // (rx, ry, rz) is now the frame transported once around the loop back to sample 0.
  const t0x = tan[0];
  const t0y = tan[1];
  const t0z = tan[2];
  const cx = ry * up[2] - rz * up[1];
  const cy = rz * up[0] - rx * up[2];
  const cz = rx * up[1] - ry * up[0];
  const holonomy = Math.atan2(t0x * cx + t0y * cy + t0z * cz, rx * up[0] + ry * up[1] + rz * up[2]);
  for (let i = 1; i < count; i++) {
    const i3 = i * 3;
    rotateAbout(up[i3], up[i3 + 1], up[i3 + 2], tan[i3], tan[i3 + 1], tan[i3 + 2], (holonomy * i) / count);
    up[i3] = rot[0];
    up[i3 + 1] = rot[1];
    up[i3 + 2] = rot[2];
  }
  // Re-orthogonalise against the tangent to remove accumulated round-off.
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const d = up[i3] * tan[i3] + up[i3 + 1] * tan[i3 + 1] + up[i3 + 2] * tan[i3 + 2];
    const x = up[i3] - d * tan[i3];
    const y = up[i3 + 1] - d * tan[i3 + 1];
    const z = up[i3 + 2] - d * tan[i3 + 2];
    const inv = 1 / Math.sqrt(x * x + y * y + z * z);
    up[i3] = x * inv;
    up[i3 + 1] = y * inv;
    up[i3 + 2] = z * inv;
  }
  return up;
}

/** Roll contributed by a corkscrew at loop parameter u: `turns` full barrel rolls, flat at both ends. */
export function corkscrewRoll(u: number, range: CorkscrewRange): number {
  if (u < range.uStart || u > range.uEnd) return 0;
  return TAU * (range.turns ?? 1) * smootherstep(range.uStart, range.uEnd, u);
}

/**
 * Build the final orthonormal frames. Roll positive = `up` leans toward +right, so a right turn
 * (positive curvature) banks with the right side lower.
 */
export function buildFrames(
  curve: ResampledCurve,
  diff: Differentials,
  corkscrews: CorkscrewRange | readonly CorkscrewRange[],
  bankOpts: BankOptions = DEFAULT_BANK,
  curl: Float64Array = new Float64Array(curve.count),
): FrameSet {
  const rolls: readonly CorkscrewRange[] = Array.isArray(corkscrews) ? corkscrews : [corkscrews as CorkscrewRange];
  const { count, length, ds, pos } = curve;
  const { tan, dTds } = diff;
  const rmfUp = rotationMinimisingUp(pos, tan, count);

  // Banking from curvature measured in the unbanked (RMF) frame. That same RMF-frame bend is what is
  // exported as `curvature`: it is the turn a ship must steer through, independent of bank/corkscrew
  // roll (measuring it on the rolled frame would shrink it by cos(roll) and flip it when inverted).
  const rawBank = new Float64Array(count);
  const curvature = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    // rmfRight = tan × rmfUp
    const rx = tan[i3 + 1] * rmfUp[i3 + 2] - tan[i3 + 2] * rmfUp[i3 + 1];
    const ry = tan[i3 + 2] * rmfUp[i3] - tan[i3] * rmfUp[i3 + 2];
    const rz = tan[i3] * rmfUp[i3 + 1] - tan[i3 + 1] * rmfUp[i3];
    const k = dTds[i3] * rx + dTds[i3 + 1] * ry + dTds[i3 + 2] * rz;
    curvature[i] = k;
    rawBank[i] = clamp(k * bankOpts.bankFactor, -bankOpts.maxBank, bankOpts.maxBank);
  }
  // Wide Gaussian (~45 m sigma) so bank transitions are gradual; periodic so it wraps correctly.
  const bank = smoothPeriodic(rawBank, 45 / ds);
  // A pipe is not banked: the tube would rotate about its floor. Fade the bank out as the deck curls.
  for (let i = 0; i < count; i++) bank[i] *= 1 - curl[i];

  const up = new Float64Array(count * 3);
  const right = new Float64Array(count * 3);
  const roll = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const u = i / count;
    let total = bank[i];
    for (const r of rolls) total += corkscrewRoll(u, r);
    roll[i] = total;
    rotateAbout(rmfUp[i3], rmfUp[i3 + 1], rmfUp[i3 + 2], tan[i3], tan[i3 + 1], tan[i3 + 2], total);
    const ux = rot[0];
    const uy = rot[1];
    const uz = rot[2];
    up[i3] = ux;
    up[i3 + 1] = uy;
    up[i3 + 2] = uz;
    // right = tan × up
    const rx = tan[i3 + 1] * uz - tan[i3 + 2] * uy;
    const ry = tan[i3 + 2] * ux - tan[i3] * uz;
    const rz = tan[i3] * uy - tan[i3 + 1] * ux;
    right[i3] = rx;
    right[i3 + 1] = ry;
    right[i3 + 2] = rz;
  }
  return { count, length, ds, pos, tan, up, right, roll, bank, curvature, curl };
}

/** Convert flat frames into contract `TrackSample` objects. */
export function toTrackSamples(frames: FrameSet): TrackSample[] {
  const out: TrackSample[] = new Array<TrackSample>(frames.count);
  for (let i = 0; i < frames.count; i++) {
    const i3 = i * 3;
    out[i] = {
      u: i / frames.count,
      distance: i * frames.ds,
      position: new THREE.Vector3(frames.pos[i3], frames.pos[i3 + 1], frames.pos[i3 + 2]),
      forward: new THREE.Vector3(frames.tan[i3], frames.tan[i3 + 1], frames.tan[i3 + 2]),
      up: new THREE.Vector3(frames.up[i3], frames.up[i3 + 1], frames.up[i3 + 2]),
      right: new THREE.Vector3(frames.right[i3], frames.right[i3 + 1], frames.right[i3 + 2]),
      roll: frames.roll[i],
      curvature: frames.curvature[i],
      halfWidth: CONFIG.TRACK_HALF_WIDTH,
    };
  }
  return out;
}
