/**
 * Full-pipe geometry (Cryo Station). The road's cross-section curls up into a closed tube: a profile point at
 * lateral x (metres from the centreline along the deck) and height y (along the deck normal) is bent onto a
 * circular arc of curvature κ = curl · π / W, where W is the track half-width and curl ∈ [0, 1]:
 *
 *   φ = κ·x,  point = (sin φ / κ, (1 − cos φ) / κ) + y · (−sin φ, cos φ)      in (right, up)
 *
 * curl 0 is the flat deck; curl 1 closes the deck into a tube of circumference 2W (radius W/π ≈ 4.46 m), so
 * the deck edges ±W meet at the top. Arc length along the deck is preserved, which keeps `lateral` meaningful
 * everywhere: inside the tube it is the position around the circumference. The bend is centred on the
 * centreline, so lateral 0 (the tube floor) never moves.
 *
 * **The curl is signed.** A negative curl is the Spine (Abyss Line): κ < 0 bends the deck *down* round a tube of the
 * same circumference below the centreline, the same formula with the circle's centre at (0, 1/κ). The deck normal
 * (−sin φ, cos φ) then points away from the tube's axis, so ships ride the outside; lateral 0 is the crown and ±W
 * the bottom seam. Everything that reads the curl takes its magnitude for "how closed" and its sign for which way.
 */
import { CONFIG } from '../../core/config';
import { smootherstep } from '../../core/math';

/** Curvature (1/m) of the fully closed tube. */
export const PIPE_FULL_KAPPA = Math.PI / CONFIG.TRACK_HALF_WIDTH;
/** Radius (m) of the fully closed tube. */
export const PIPE_RADIUS = 1 / PIPE_FULL_KAPPA;
/** Below this curl the cross-section is treated as flat (avoids dividing by a vanishing κ). */
export const CURL_EPS = 1e-4;
/** Curl above which the rails have ended: the deck edges are near enough to meet. */
export const RAIL_END_CURL = 0.85;

export interface PipeSpan {
  dStart: number;
  dEnd: number;
  transition: number;
}

/** Is the cross-section flat at this curl (either sign)? */
export function isFlatCurl(curl: number): boolean {
  return Math.abs(curl) < CURL_EPS;
}

/** Curl at distance d (metres along the lap) for one pipe; 0 outside it. Handles spans that wrap the start line. */
export function pipeCurlAt(d: number, pipe: PipeSpan, length: number): number {
  let x = d - pipe.dStart;
  x = ((x % length) + length) % length;
  const span = pipe.dEnd - pipe.dStart;
  if (x > span) return 0;
  const t = Math.min(pipe.transition, span / 2);
  return smootherstep(0, t, x) * (1 - smootherstep(span - t, span, x));
}

/** Per-sample signed curl for `count` samples spaced `ds` metres apart: pipes curl up (+), spines curl down (−). */
export function curlSamples(count: number, ds: number, pipes: readonly PipeSpan[], spines: readonly PipeSpan[] = []): Float64Array {
  const curl = new Float64Array(count);
  if (pipes.length === 0 && spines.length === 0) return curl;
  const length = count * ds;
  for (let i = 0; i < count; i++) {
    let up = 0;
    let down = 0;
    for (const p of pipes) up = Math.max(up, pipeCurlAt(i * ds, p, length));
    for (const p of spines) down = Math.max(down, pipeCurlAt(i * ds, p, length));
    curl[i] = up - down;
  }
  return curl;
}

/** Result of `curlPoint`: the bent (x, y) and the cross-section rotation φ at that lateral. */
export interface CurledPoint {
  x: number;
  y: number;
  /** Rotation (rad) of the local deck frame: the surface normal is (−sin φ, cos φ) in (right, up). */
  phi: number;
}

/** Bend profile point (x, y) by `curl` (signed; writes `out`). */
export function curlPoint(x: number, y: number, curl: number, out: CurledPoint): CurledPoint {
  if (isFlatCurl(curl)) {
    out.x = x;
    out.y = y;
    out.phi = 0;
    return out;
  }
  const k = curl * PIPE_FULL_KAPPA;
  const phi = k * x;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  out.x = s / k - y * s;
  out.y = (1 - c) / k + y * c;
  out.phi = phi;
  return out;
}

/** Inverse of `curlPoint`: local (x, y) in the (right, up) plane → lateral (arc position), height and φ. */
export function uncurlPoint(x: number, y: number, curl: number, out: { lateral: number; height: number; phi: number }): void {
  if (isFlatCurl(curl)) {
    out.lateral = x;
    out.height = y;
    out.phi = 0;
    return;
  }
  const k = curl * PIPE_FULL_KAPPA;
  const r0 = 1 / k;
  // Centre of the bend circle is (0, r0); the deck at angle φ sits at centre + r0·(sin φ, −cos φ). With κ < 0 (a
  // spine) r0 is negative, the centre is below the deck and the normal points away from it: flip both components.
  const sg = Math.sign(k);
  const phi = Math.atan2(sg * x, sg * (r0 - y));
  out.phi = phi;
  out.lateral = phi * r0;
  out.height = sg * (Math.abs(r0) - Math.hypot(x, r0 - y));
}
