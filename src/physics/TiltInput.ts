/**
 * Tilt steering from the device's motion sensor (IMPLEMENTATION §M7c). Listens to `devicemotion`, reads
 * `accelerationIncludingGravity` and the screen's orientation, and gives a smoothed steer (physics/tilt.ts) that the
 * App hands to TouchInput as its external steer while the data is fresh.
 *
 * Platform sign (one place, here): the spec has `accelerationIncludingGravity` report the gravity *reaction* (a device
 * upright in portrait reads y ≈ +9.81, as Chrome on Android does), while WebKit on iOS reports the opposite sign
 * (y ≈ −9.81). iOS readings are negated so tilt.ts always sees "up". The device gate proves the direction.
 */
import { Capacitor } from '@capacitor/core';
import { damp } from '../core/math';
import type { Step3 } from '../save/schema';
import { deviceRoll, tiltSteer } from './tilt';

/** Smoothing rate of the steer (per second). */
export const TILT_SMOOTHING = 20;
/** Motion data older than this (ms) is stale: the slider takes over. */
export const TILT_FRESH_MS = 500;

export type TiltPermission = 'granted' | 'denied' | 'unsupported';

interface MotionEventCtor {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

/** Ask for motion data. Must run inside a tap on iOS 13+ (WKWebView asks again after each app launch). */
export async function requestTiltPermission(): Promise<TiltPermission> {
  const ctor = (globalThis as { DeviceMotionEvent?: MotionEventCtor }).DeviceMotionEvent;
  if (!ctor) return 'unsupported';
  if (typeof ctor.requestPermission !== 'function') return 'granted';
  try {
    return (await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export function isIOS(): boolean {
  if (Capacitor.getPlatform() === 'ios') return true;
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function screenAngle(): 0 | 90 | 180 | 270 {
  const raw = typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : ((globalThis as { orientation?: number }).orientation ?? 0);
  const a = ((Math.round(raw / 90) * 90) % 360 + 360) % 360;
  return a as 0 | 90 | 180 | 270;
}

export class TiltInput {
  private gx = 0;
  private gy = 0;
  private lastAt = -Infinity;
  private steer = 0;
  private roll: number | null = null;
  private listening = false;

  constructor(
    private readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
    private readonly now: () => number = () => performance.now(),
    private readonly sign: 1 | -1 = isIOS() ? -1 : 1,
    private readonly angle: () => 0 | 90 | 180 | 270 = screenAngle,
  ) {}

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.target.addEventListener('devicemotion', this.onMotion as EventListener);
  }

  stop(): void {
    if (!this.listening) return;
    this.listening = false;
    this.target.removeEventListener('devicemotion', this.onMotion as EventListener);
    this.lastAt = -Infinity;
    this.steer = 0;
  }

  /** Motion data arrived within the last TILT_FRESH_MS. */
  get fresh(): boolean {
    return this.now() - this.lastAt < TILT_FRESH_MS;
  }

  /** The screen lies too flat to read a roll ("HOLD THE DEVICE UPRIGHT"). */
  get flat(): boolean {
    return this.fresh && this.roll === null;
  }

  /** The current roll (degrees) for CALIBRATE, or null. */
  get currentRoll(): number | null {
    return this.fresh ? deviceRoll(this.gx, this.gy, this.angle()) : null;
  }

  /** One fixed step: the smoothed steer (−1..1). Eases to 0 while the screen is flat. */
  update(dt: number, neutralDeg: number, sensitivity: Step3): number {
    this.roll = deviceRoll(this.gx, this.gy, this.angle());
    const target = this.roll === null ? 0 : tiltSteer(this.roll, neutralDeg, sensitivity);
    this.steer = damp(this.steer, target, TILT_SMOOTHING, dt);
    return this.steer;
  }

  /** Feed one reading (the devicemotion handler; tests call it directly). */
  feed(x: number | null | undefined, y: number | null | undefined): void {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    this.gx = this.sign * x;
    this.gy = this.sign * y;
    this.lastAt = this.now();
  }

  private readonly onMotion = (e: DeviceMotionEvent): void => {
    const g = e.accelerationIncludingGravity;
    if (g) this.feed(g.x, g.y);
  };
}
