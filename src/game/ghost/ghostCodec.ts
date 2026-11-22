/**
 * The ghost format (IMPLEMENTATION §M8b): a pose recording at 20 Hz (position and rotation), not an input
 * replay, so it plays back the same on every device whatever the physics does there.
 *
 * Bytes: a uint32 (little-endian) header length, the JSON header (padded with spaces to an even length), then
 * `pos` (int16 × 3 per sample), `quat` (int16 × 3 per sample) and `largest` (uint8 per sample). 13 bytes a sample:
 * an 81–116 s run is 21–30 KB.
 *
 * Position: (p − min) / size mapped to −32767..32767 (under 1 cm of error on a track 1.3 km across). Rotation:
 * "smallest three": the largest component is dropped (and made positive by flipping the sign of the whole
 * quaternion), the other three are × √2 (so they span −1..1) and scaled to ±32767.
 */

export const GHOST_HZ = 20;
export const GHOST_VERSION = 1;

export interface GhostData {
  version: 1;
  trackId: string;
  chassisId: string;
  totalTime: number;
  lapTimes: number[];
  count: number;
  /** The samples' bounding box (m). */
  min: [number, number, number];
  size: [number, number, number];
  /** 3 per sample: (p − min) / size, scaled to −32767..32767. */
  pos: Int16Array;
  /** 3 per sample: the three smallest components × √2, scaled to ±32767. */
  quat: Int16Array;
  /** 1 per sample: the index of the dropped (largest) component, made positive. */
  largest: Uint8Array;
}

const Q = 32767;
const SQRT2 = Math.SQRT2;

interface Header {
  version: number;
  trackId: string;
  chassisId: string;
  totalTime: number;
  lapTimes: number[];
  count: number;
  min: number[];
  size: number[];
}

export function encodeGhost(g: GhostData): ArrayBuffer {
  const header: Header = { version: g.version, trackId: g.trackId, chassisId: g.chassisId, totalTime: g.totalTime, lapTimes: g.lapTimes, count: g.count, min: g.min, size: g.size };
  let json = JSON.stringify(header);
  if (json.length % 2) json += ' ';
  const head = new TextEncoder().encode(json);
  const nPos = g.pos.length;
  const nQuat = g.quat.length;
  const nLargest = g.largest.length;
  const buf = new ArrayBuffer(4 + head.length + 2 * nPos + 2 * nQuat + nLargest);
  const view = new DataView(buf);
  view.setUint32(0, head.length, true);
  new Uint8Array(buf, 4, head.length).set(head);
  let o = 4 + head.length;
  for (let i = 0; i < nPos; i++, o += 2) view.setInt16(o, g.pos[i], true);
  for (let i = 0; i < nQuat; i++, o += 2) view.setInt16(o, g.quat[i], true);
  new Uint8Array(buf, o, nLargest).set(g.largest);
  return buf;
}

const finite3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** The ghost in `buf`, or null when it is truncated, corrupt or of an unknown version. */
export function decodeGhost(buf: ArrayBuffer): GhostData | null {
  try {
    if (buf.byteLength < 4) return null;
    const view = new DataView(buf);
    const len = view.getUint32(0, true);
    if (4 + len > buf.byteLength) return null;
    const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as Partial<Header>;
    if (!h || h.version !== GHOST_VERSION) return null;
    const count = h.count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;
    if (typeof h.trackId !== 'string' || typeof h.chassisId !== 'string') return null;
    if (typeof h.totalTime !== 'number' || !Number.isFinite(h.totalTime)) return null;
    if (!Array.isArray(h.lapTimes) || !h.lapTimes.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
    if (!finite3(h.min) || !finite3(h.size)) return null;
    if (buf.byteLength !== 4 + len + 13 * count) return null;
    const pos = new Int16Array(3 * count);
    const quat = new Int16Array(3 * count);
    let o = 4 + len;
    for (let i = 0; i < pos.length; i++, o += 2) pos[i] = view.getInt16(o, true);
    for (let i = 0; i < quat.length; i++, o += 2) quat[i] = view.getInt16(o, true);
    const largest = new Uint8Array(buf.slice(o, o + count));
    if (largest.some((x) => x > 3)) return null;
    return { version: GHOST_VERSION, trackId: h.trackId, chassisId: h.chassisId, totalTime: h.totalTime, lapTimes: [...h.lapTimes], count, min: [...h.min], size: [...h.size], pos, quat, largest };
  } catch {
    return null;
  }
}

/** Position component → int16 (`size` 0 is treated as 1 m). */
export function packPos(p: number, min: number, size: number): number {
  const k = size > 0 ? (p - min) / size : 0;
  return Math.max(-Q, Math.min(Q, Math.round((k * 2 - 1) * Q)));
}

export function unpackPos(v: number, min: number, size: number): number {
  return min + ((v / Q + 1) / 2) * (size > 0 ? size : 0);
}

/**
 * Pack the quaternion (x, y, z, w) into `out[o..o+2]` (int16) and return the index of the dropped component.
 * The input need not be normalised.
 */
export function packQuat(x: number, y: number, z: number, w: number, out: Int16Array, o: number): number {
  const n = Math.hypot(x, y, z, w) || 1;
  const c = [x / n, y / n, z / n, w / n];
  let big = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(c[i]) > Math.abs(c[big])) big = i;
  const sign = c[big] < 0 ? -1 : 1;
  let k = o;
  for (let i = 0; i < 4; i++) {
    if (i === big) continue;
    out[k++] = Math.max(-Q, Math.min(Q, Math.round(c[i] * sign * SQRT2 * Q)));
  }
  return big;
}

/** Unpack into `out` as [x, y, z, w] (normalised). */
export function unpackQuat(q: Int16Array, o: number, big: number, out: Float32Array | number[], oo: number): void {
  let k = o;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    if (i === big) continue;
    const v = q[k++] / Q / SQRT2;
    out[oo + i] = v;
    sum += v * v;
  }
  out[oo + big] = Math.sqrt(Math.max(0, 1 - sum));
}
