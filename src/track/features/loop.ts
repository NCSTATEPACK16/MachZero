/**
 * Loop-the-loop geometry (Orbital Ring).
 *
 * The authoring tool (scripts/track-design.mjs) writes the loop straight into the control points: on a flat straight
 * heading f with right r, the centreline leaves the deck at P0 and follows
 *
 *   P(t) = P0 + f·(A·t + R·sin θ) + up·R·(1 − cos θ) + r·S·σ((t − e) / (1 − 2e)),   θ = 2π·σ(t),   t ∈ [0, 1]
 *
 * (σ = smootherstep, A = forward advance, R = height / 2, S = signed side offset), so it climbs, turns over and comes
 * down beside its entry, S metres to the side. σ has zero first and second derivatives at both ends, so the curvature
 * grows from zero on entry and returns to zero on exit (no jolt where the loop meets the straight). The side shift is
 * eased over the middle of the loop only (e = LOOP_SIDE_EASE): the climbing and descending legs pass each other at the
 * same height, and shifting early would leave them too close there (their rails would cross).
 *
 * Frames: the rotation-minimising frame is wrong here. Its holonomy over a loop with a side offset is a roll of
 * 2π·sin(lean), where lean is the tangent's sideways angle (≈ 100° for this shape), which would leave the deck rolled
 * after the loop. Inside a loop the frame is instead built about the loop's own axis: right = r with its
 * along-track part removed, up = right × forward. That keeps the deck square to the axis like a real loop and gives
 * back the level deck on exit; TrackFrames re-seeds the rotation-minimising transport from it.
 *
 * Constant-lateral lines on this surface are not geodesics (driving "straight" would keep the ship's position along
 * the axis and run it off the side of the shifted deck), so the physics carries ships along their line through the
 * loop (physics/LoopCompensation.ts), as it does for corkscrews and pipes.
 */
import { CONFIG } from '../../core/config';
import { smootherstep } from '../../core/math';

/** Default loop shape: about 30 m tall, entry and exit far enough apart that their rails don't touch. */
export const LOOP_HEIGHT = 30;
export const LOOP_ADVANCE = 40;
/** Fraction of the loop at each end over which it does not move sideways yet (or any more). */
export const LOOP_SIDE_EASE = 0.15;
/** Smallest |side offset| that keeps the entry and exit decks (rails included) apart, plus a 2 m gap. */
export const LOOP_MIN_SIDE = 2 * (CONFIG.TRACK_HALF_WIDTH + CONFIG.RAIL_THICKNESS) + 2;

export interface LoopRange {
  uStart: number;
  uEnd: number;
}

export interface LoopShape {
  advance: number;
  height: number;
  side: number;
}

/** Point t ∈ [0, 1] of the loop in its local (forward, up, right) coordinates, metres from the entry point. */
export function loopLocal(t: number, shape: LoopShape): [number, number, number] {
  const s = smootherstep(0, 1, t);
  const R = shape.height / 2;
  const th = 2 * Math.PI * s;
  const side = smootherstep(LOOP_SIDE_EASE, 1 - LOOP_SIDE_EASE, t);
  return [shape.advance * t + R * Math.sin(th), R * (1 - Math.cos(th)), shape.side * side];
}

/** Arc length of the loop (m), by fine polyline. */
export function loopArcLength(shape: LoopShape, steps = 4000): number {
  let len = 0;
  let prev = loopLocal(0, shape);
  for (let i = 1; i <= steps; i++) {
    const p = loopLocal(i / steps, shape);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
  }
  return len;
}

/**
 * 0..1 weight of a loop at distance d: 1 inside it, easing to 0 over `fade` metres either side. Used to take the
 * bank out round a loop (a loop is never banked).
 */
export function loopWeight(d: number, loop: { dStart: number; dEnd: number }, length: number, fade = 40): number {
  const x = (((d - loop.dStart) % length) + length) % length;
  const span = loop.dEnd - loop.dStart;
  if (x <= span) return 1;
  if (fade <= 0) return 0;
  const after = x - span;
  const before = length - x;
  return Math.max(1 - smootherstep(0, fade, after), 1 - smootherstep(0, fade, before));
}
