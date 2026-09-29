import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { RaceState, ShipState, TrackData } from '../core/contracts';
import { clamp01, damp, lerp, smootherstep } from '../core/math';

type Mode = 'title' | 'countdown' | 'racing' | 'results';

/** Interpolated player pose handed to the camera each frame. */
export interface CameraPose {
  pos: THREE.Vector3;
  /** Body orientation (track-aligned, no visual bank). */
  quat: THREE.Quaternion;
  ship: ShipState;
}

/** Minimum camera clearance above the track surface, metres. */
const MIN_CLEARANCE = 1.5;

/**
 * Damped chase camera working in the ship/track-up frame: the camera's `up` is the
 * smoothed ship up so the 360-degree corkscrew rolls the view. Also owns the
 * title orbit, the countdown swoop (ends exactly on the chase pose at GO) and the
 * results orbit, cross-fading between them.
 */
export class ChaseCamera {
  private mode: Mode = 'title';
  private hasFinal = false;
  private snapNext = true;

  private readonly camQuat = new THREE.Quaternion();
  private readonly lastShipPos = new THREE.Vector3();

  // current final (pre-clamp, ship-relative) camera description
  private readonly offset = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private fov: number = CONFIG.FOV_MIN;

  // transition
  private blend = 1;
  private blendDur = 0.5;
  private readonly fromOffset = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private readonly fromUp = new THREE.Vector3(0, 1, 0);
  private fromFov: number = CONFIG.FOV_MIN;

  // dynamic state
  private countdownElapsed = 0;
  private fovSpeed = 0;
  private fovBoost = 0;
  private fovPunch = 0;
  private impact = 0;

  // scratch (no per-frame allocation)
  private readonly tOffset = new THREE.Vector3();
  private readonly tLook = new THREE.Vector3();
  private readonly tUp = new THREE.Vector3();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly fwdV = new THREE.Vector3();
  private readonly rightV = new THREE.Vector3();
  private readonly upV = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Brief FOV widening (degrees), decays over ~0.5 s. */
  punchFov(deg: number): void {
    this.fovPunch = Math.min(14, this.fovPunch + deg);
  }

  /** Camera shake impulse (0..1). */
  addImpact(amount: number): void {
    this.impact = Math.min(1.2, this.impact + amount);
  }

  /** Re-seed the smoothed state from the ship pose on the next update (restart / teleport). */
  snap(): void {
    this.snapNext = true;
    this.impact = 0;
    this.fovPunch = 0;
    this.fovBoost = 0;
    this.fovSpeed = 0;
  }

  update(dt: number, time: number, state: RaceState, countdownValue: number, pose: CameraPose, track: TrackData): void {
    if (state === 'paused') return; // frozen

    const mode: Mode = state;
    if (mode !== this.mode) this.beginTransition(mode);

    const ship = pose.ship;
    const speed = ship.speed;
    const sf = clamp01(speed / CONFIG.BOOST_TOP_SPEED);
    const sfFov = clamp01(speed / CONFIG.TOP_SPEED);

    // teleport / restart -> re-seed smoothing so the camera never streaks across the map
    if (this.snapNext || this.lastShipPos.distanceToSquared(pose.pos) > 60 * 60) {
      this.camQuat.copy(pose.quat);
      this.fovSpeed = sfFov;
      this.snapNext = false;
      if (!this.hasFinal) this.blend = 1;
    }
    this.lastShipPos.copy(pose.pos);

    // smoothed orientation frame
    if (mode === 'racing') this.camQuat.slerp(pose.quat, 1 - Math.exp(-9 * dt));
    else if (mode === 'results') this.camQuat.slerp(pose.quat, 1 - Math.exp(-3 * dt));
    else this.camQuat.copy(pose.quat);

    this.fovSpeed = damp(this.fovSpeed, sfFov, 6, dt);
    this.fovBoost = damp(this.fovBoost, ship.boosting ? 4 : 0, 5, dt);
    this.fovPunch = damp(this.fovPunch, 0, 5.5, dt);
    this.impact = damp(this.impact, 0, 5, dt);

    let tFov: number;
    switch (mode) {
      case 'racing':
        tFov = this.chaseTarget(sf, speed);
        break;
      case 'countdown':
        tFov = this.countdownTarget(dt, countdownValue, pose);
        break;
      case 'title':
        tFov = this.orbitTarget(time * 0.16, 15 + 2 * Math.sin(time * 0.11), 4.2 + 0.8 * Math.sin(time * 0.17), pose, true);
        break;
      default:
        tFov = this.orbitTarget(time * 0.22, 14, 4.6 + 0.6 * Math.sin(time * 0.2), pose, false);
        break;
    }

    // cross-fade between modes
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const e = smootherstep(0, 1, this.blend);
      this.offset.lerpVectors(this.fromOffset, this.tOffset, e);
      this.look.lerpVectors(this.fromLook, this.tLook, e);
      this.up.lerpVectors(this.fromUp, this.tUp, e).normalize();
      this.fov = lerp(this.fromFov, tFov, e);
    } else {
      this.offset.copy(this.tOffset);
      this.look.copy(this.tLook);
      this.up.copy(this.tUp);
      this.fov = tFov;
    }
    this.hasFinal = true;

    // world-space pose
    this.camPos.copy(pose.pos).add(this.offset);
    this.lookAt.copy(pose.pos).add(this.look);
    if (ship.heightAboveTrack < 9 || mode !== 'racing') this.clampToTrack(this.camPos, ship.trackU, track);

    // shake
    const boostShake = ship.boosting ? 0.012 : 0;
    const amp = 0.008 * sf * sf + boostShake * sf + this.impact * 0.32;
    let roll = 0;
    if (amp > 0.0005) {
      this.fwdV.subVectors(this.lookAt, this.camPos).normalize();
      this.rightV.crossVectors(this.fwdV, this.up).normalize();
      this.upV.crossVectors(this.rightV, this.fwdV);
      const sx = Math.sin(time * 53.1) * 0.6 + Math.sin(time * 37.7 + 2.0) * 0.4;
      const sy = Math.sin(time * 47.3 + 1.1) * 0.6 + Math.sin(time * 29.9 + 4.0) * 0.4;
      this.camPos.addScaledVector(this.rightV, sx * amp).addScaledVector(this.upV, sy * amp);
      roll = Math.sin(time * 33.3 + 0.7) * amp * 0.03;
    }

    this.camera.position.copy(this.camPos);
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.lookAt);
    if (roll !== 0) this.camera.rotateZ(roll);

    const fov = Math.min(110, this.fov + this.fovPunch);
    if (Math.abs(this.camera.fov - fov) > 0.005) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private beginTransition(mode: Mode): void {
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'countdown') this.countdownElapsed = 0;
    if (!this.hasFinal) {
      this.blend = 1;
      return;
    }
    this.fromOffset.copy(this.offset);
    this.fromLook.copy(this.look);
    this.fromUp.copy(this.up);
    this.fromFov = this.fov;
    this.blend = 0;
    if (mode === 'racing') this.blendDur = prev === 'countdown' ? 0.25 : 0.9;
    else if (mode === 'results') this.blendDur = 1.8;
    else this.blendDur = 0.9;
  }

  /** Chase pose: behind/above along the smoothed frame, look-ahead target in front. Returns FOV. */
  private chaseTarget(sf: number, speed: number): number {
    const dist = CONFIG.CAMERA_DISTANCE + 3.2 * sf;
    const height = CONFIG.CAMERA_HEIGHT + 0.6 * sf;
    this.tOffset.set(0, height, dist).applyQuaternion(this.camQuat);
    this.tLook.set(0, 1.0, -(14 + speed * 0.14)).applyQuaternion(this.camQuat);
    this.tUp.set(0, 1, 0).applyQuaternion(this.camQuat);
    return lerp(CONFIG.FOV_MIN, CONFIG.FOV_MAX, Math.pow(this.fovSpeed, 0.85)) + this.fovBoost;
  }

  /** Swoop from front/side into the chase pose; identical to chaseTarget at speed 0 when finished. */
  private countdownTarget(dt: number, countdownValue: number, pose: CameraPose): number {
    this.countdownElapsed += dt;
    if (countdownValue >= 0 && countdownValue <= 3) {
      this.countdownElapsed = Math.max(this.countdownElapsed, (3 - countdownValue) * CONFIG.COUNTDOWN_STEP);
    }
    const p = clamp01(this.countdownElapsed / (3 * CONFIG.COUNTDOWN_STEP));
    const e = smootherstep(0, 1, p);
    const theta = lerp(2.6, 0, e);
    const r = lerp(15, CONFIG.CAMERA_DISTANCE, e);
    const h = lerp(5.2, CONFIG.CAMERA_HEIGHT, e);
    this.tOffset.set(Math.sin(theta) * r, h, Math.cos(theta) * r).applyQuaternion(pose.quat);
    // look target slides from the ship's centre to the chase look-ahead point
    this.v1.set(0, 0.7, -1.0);
    this.v2.set(0, 1.0, -14);
    this.tLook.lerpVectors(this.v1, this.v2, e).applyQuaternion(pose.quat);
    this.tUp.set(0, 1, 0).applyQuaternion(pose.quat);
    return lerp(54, CONFIG.FOV_MIN, e);
  }

  /** Slow orbit about the ship (title: about a point just ahead of the player so the grid is in shot). */
  private orbitTarget(angle: number, radius: number, height: number, pose: CameraPose, ahead: boolean): number {
    const cz = ahead ? -5 : 0;
    this.tOffset.set(Math.sin(angle) * radius, height, cz + Math.cos(angle) * radius).applyQuaternion(pose.quat);
    this.tLook.set(0, 0.6, cz).applyQuaternion(pose.quat);
    this.tUp.set(0, 1, 0).applyQuaternion(pose.quat);
    return ahead ? 58 : 62;
  }

  /** Keep the camera above the driving surface and out of the rails. */
  private clampToTrack(p: THREE.Vector3, hintU: number, track: TrackData): void {
    const pr = track.project(p, hintU);
    const hw = track.halfWidth;
    const alat = Math.abs(pr.lateral);
    if (alat > hw + 2.5) return;
    const s = pr.sample;
    if (alat > hw - 0.7 && alat < hw + 1.3 && pr.height < track.railHeight + 0.4 && pr.height > -1) {
      const target = Math.sign(pr.lateral) * (hw - 0.9);
      p.addScaledVector(s.right, target - pr.lateral);
    }
    if (pr.height < MIN_CLEARANCE && pr.height > -6) {
      p.addScaledVector(s.up, MIN_CLEARANCE - pr.height);
    }
  }
}
