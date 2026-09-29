import type { ControlInput } from './contracts';

/** A fresh all-zero control input. */
export function neutralControls(): ControlInput {
  return { throttle: 0, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false };
}

export function copyControls(src: ControlInput, out: ControlInput): ControlInput {
  out.throttle = src.throttle;
  out.brake = src.brake;
  out.steer = src.steer;
  out.airbrakeLeft = src.airbrakeLeft;
  out.airbrakeRight = src.airbrakeRight;
  out.boost = src.boost;
  return out;
}
