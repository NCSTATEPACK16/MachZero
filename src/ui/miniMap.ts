/** Plan-view outline of a track definition as SVG polyline points in a 120 × 72 box (world cards and the world map). */
import { TRACK_DEFS } from '../content/tracks';

export function miniMap(trackId: string): string | null {
  const def = TRACK_DEFS[trackId];
  if (!def) return null;
  const xs = def.points.map((p) => p[0]);
  const zs = def.points.map((p) => p[2]);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...zs) - minZ;
  const s = Math.min(112 / w, 64 / h);
  const ox = (120 - w * s) / 2;
  const oz = (72 - h * s) / 2;
  return def.points.map((p) => `${(ox + (p[0] - minX) * s).toFixed(1)},${(oz + (p[2] - minZ) * s).toFixed(1)}`).join(' ');
}
