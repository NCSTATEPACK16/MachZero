/**
 * Tilt steering as pure functions (IMPLEMENTATION §M7c). Steering is the device's roll about the axis out of the
 * screen, like turning a wheel, measured against real gravity only (the game's camera roll never enters it), so on the
 * corkscrew, in the pipe and on the Spine tilting right steers right on the screen, exactly as the slider does.
 *
 * Inputs are the gravity *reaction* in the device's frame (the "up" vector, m/s²): x to the device's right and y to
 * its top, both as held in its natural (portrait) orientation. physics/TiltInput.ts normalises the platforms' signs.
 */
import type { Step3 } from '../save/schema';

/** Full lock (degrees of roll past the neutral angle), by sensitivity (low, medium, high). */
export const TILT_LOCK_DEG = [35, 25, 18] as const;
export const TILT_DEADZONE_DEG = 3;
/** Under this much gravity (m/s²) in the screen's plane the screen lies too flat to read a roll. */
export const TILT_MIN_GRAVITY = 3;
/** The neutral angle is kept within ±this (degrees). */
export const TILT_NEUTRAL_MAX = 20;

/**
 * Roll in degrees (positive = turned clockwise as the player sees it), or null when the screen is too flat.
 * `screenAngle` is `screen.orientation.angle`: the content's rotation counter-clockwise from the natural orientation
 * (90 = landscape with the device's top to the left).
 */
export function deviceRoll(gx: number, gy: number, screenAngle: 0 | 90 | 180 | 270): number | null {
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return null;
  const a = (screenAngle * Math.PI) / 180;
  const c = Math.round(Math.cos(a));
  const s = Math.round(Math.sin(a));
  // "Up" in the screen's frame: x to the screen's right, y to its top.
  const sx = gx * c - gy * s;
  const sy = gx * s + gy * c;
  if (Math.hypot(sx, sy) < TILT_MIN_GRAVITY) return null;
  // Turning the device clockwise makes real up lean to the screen's left.
  return (Math.atan2(-sx, sy) * 180) / Math.PI;
}

/** Steer −1..1 (positive = right): a 3° deadzone round the neutral angle, then linear to full lock. */
export function tiltSteer(rollDeg: number, neutralDeg: number, sensitivity: Step3): number {
  let d = rollDeg - neutralDeg;
  d = ((((d + 180) % 360) + 360) % 360) - 180; // wrap to −180..180
  const lock = TILT_LOCK_DEG[sensitivity] ?? TILT_LOCK_DEG[1];
  const m = Math.abs(d);
  if (m <= TILT_DEADZONE_DEG) return 0;
  return Math.sign(d) * Math.min(1, (m - TILT_DEADZONE_DEG) / (lock - TILT_DEADZONE_DEG));
}

/** The neutral angle a CALIBRATE press sets: the roll now, kept within ±TILT_NEUTRAL_MAX. */
export function calibratedNeutral(rollDeg: number | null): number {
  if (rollDeg === null) return 0;
  return Math.max(-TILT_NEUTRAL_MAX, Math.min(TILT_NEUTRAL_MAX, rollDeg));
}
