/**
 * The touch steering slider as a pure function (IMPLEMENTATION §M7b). The slider's origin is where the thumb landed;
 * `dx` is the thumb's travel from it in CSS points (positive = right). Full lock is SLIDER_LOCK points of travel by
 * sensitivity, with a curved response that is finer near the centre. In the 'slider' air-brake style, pushing past full
 * lock applies that side's air-brake: nothing for the first AIRBRAKE_START points, then a ramp to full over
 * AIRBRAKE_RAMP points. In the 'buttons' style the slider stops at full lock and never air-brakes.
 */
import type { AirbrakeStyle, Step3 } from '../save/schema';

/** Points of travel to full lock, by sensitivity (low, medium, high). */
export const SLIDER_LOCK = [80, 60, 44] as const;
/** Air-brake overdrive: starts this many points past full lock, full strength AIRBRAKE_RAMP points later. */
export const AIRBRAKE_START = 12;
export const AIRBRAKE_RAMP = 20;
/** Exponent of the response curve: steer = sign(x) · |x|^SLIDER_CURVE. */
export const SLIDER_CURVE = 1.5;

export interface SliderOut {
  steer: number;
  airbrakeLeft: number;
  airbrakeRight: number;
}

export function sliderControls(dx: number, sensitivity: Step3, airbrake: AirbrakeStyle, out: SliderOut): SliderOut {
  const lock = SLIDER_LOCK[sensitivity] ?? SLIDER_LOCK[1];
  const d = Number.isFinite(dx) ? dx : 0;
  const x = Math.max(-1, Math.min(1, d / lock));
  out.steer = Math.sign(x) * Math.pow(Math.abs(x), SLIDER_CURVE);
  out.airbrakeLeft = 0;
  out.airbrakeRight = 0;
  if (airbrake === 'slider') {
    const over = Math.max(0, Math.min(1, (Math.abs(d) - lock - AIRBRAKE_START) / AIRBRAKE_RAMP));
    if (d < 0) out.airbrakeLeft = over;
    else out.airbrakeRight = over;
  }
  return out;
}
