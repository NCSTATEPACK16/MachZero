/**
 * The state of the touch controls (IMPLEMENTATION §M7b), with no DOM layout knowledge: game/TouchControls.ts forwards
 * pointer events here, and InputManager merges `read` into the driving controls. One pointer owns the steering slider
 * (a second finger landing in the zone is ignored); the buttons are held or latched like keys.
 */
import type { ControlInput } from '../core/contracts';
import type { AirbrakeStyle, Step3 } from '../save/schema';
import { sliderControls, type SliderOut } from './touchSteer';

export type TouchControl = 'boost' | 'brake' | 'throttle' | 'airLeft' | 'airRight' | 'item' | 'itemNext' | 'pause';

export interface TouchConfig {
  sensitivity: Step3;
  airbrake: AirbrakeStyle;
}

export class TouchInput {
  private config: TouchConfig = { sensitivity: 1, airbrake: 'slider' };
  private steerId: number | null = null;
  private originX = 0;
  private x = 0;
  private readonly held = new Set<TouchControl>();
  private boostLatch = false;
  private fireLatch = false;
  private cycleLatch = 0;
  private pauseLatch = false;
  private readonly slider: SliderOut = { steer: 0, airbrakeLeft: 0, airbrakeRight: 0 };
  /**
   * An external steer (tilt, M7c) in −1..1 that replaces the slider while it is not null. Air-brakes then come from
   * the buttons only.
   */
  externalSteer: number | null = null;
  /** Called on any press or steering start (the device-change signal for InputManager). */
  onActivity: (() => void) | null = null;

  setConfig(c: Readonly<TouchConfig>): void {
    this.config = { sensitivity: c.sensitivity, airbrake: c.airbrake };
  }

  /** Where the steering thumb landed and how far it has travelled (points), or null when no thumb steers. */
  get steerOrigin(): number | null {
    return this.steerId === null ? null : this.originX;
  }

  get steerTravel(): number {
    return this.steerId === null ? 0 : this.x - this.originX;
  }

  /** A pointer lands in the steering zone. False when another pointer already steers (it is ignored). */
  steerStart(pointerId: number, x: number): boolean {
    if (this.steerId !== null && this.steerId !== pointerId) return false;
    this.steerId = pointerId;
    this.originX = x;
    this.x = x;
    this.onActivity?.();
    return true;
  }

  steerMove(pointerId: number, x: number): void {
    if (pointerId === this.steerId && Number.isFinite(x)) this.x = x;
  }

  steerEnd(pointerId: number): void {
    if (pointerId !== this.steerId) return;
    this.steerId = null;
    this.originX = 0;
    this.x = 0;
  }

  /** A button goes down or up. Boost, item, next item and pause latch once per press. */
  press(control: TouchControl, down: boolean): void {
    if (!down) {
      this.held.delete(control);
      return;
    }
    if (this.held.has(control)) return;
    this.held.add(control);
    if (control === 'boost') this.boostLatch = true;
    else if (control === 'item') this.fireLatch = true;
    else if (control === 'itemNext') this.cycleLatch++;
    else if (control === 'pause') this.pauseLatch = true;
    this.onActivity?.();
  }

  isHeld(control: TouchControl): boolean {
    return this.held.has(control);
  }

  /** Everything neutral: pointercancel, blur, pause, a hidden layer. Pending latches are dropped too. */
  releaseAll(): void {
    this.steerId = null;
    this.originX = 0;
    this.x = 0;
    this.held.clear();
    this.boostLatch = false;
    this.fireLatch = false;
    this.cycleLatch = 0;
    this.pauseLatch = false;
  }

  /** True once per pause press. */
  consumePause(): boolean {
    const p = this.pauseLatch;
    this.pauseLatch = false;
    return p;
  }

  /** The touch controls now; the boost, fire and item-cycle latches are cleared by the read. */
  read(out: ControlInput): ControlInput {
    const s = sliderControls(this.steerTravel, this.config.sensitivity, this.config.airbrake, this.slider);
    const ext = this.externalSteer;
    out.steer = ext !== null ? Math.max(-1, Math.min(1, ext)) : s.steer;
    out.throttle = this.held.has('throttle') ? 1 : 0;
    out.brake = this.held.has('brake') ? 1 : 0;
    out.airbrakeLeft = Math.max(this.held.has('airLeft') ? 1 : 0, ext !== null ? 0 : s.airbrakeLeft);
    out.airbrakeRight = Math.max(this.held.has('airRight') ? 1 : 0, ext !== null ? 0 : s.airbrakeRight);
    out.boost = this.boostLatch;
    out.fire = this.fireLatch;
    out.itemCycle = Math.sign(this.cycleLatch);
    this.boostLatch = false;
    this.fireLatch = false;
    this.cycleLatch = 0;
    return out;
  }
}
