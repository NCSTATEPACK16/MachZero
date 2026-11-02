/**
 * Drifting debris (Orbital Ring): pieces of a broken satellite section floating just above the deck. They are solid
 * (kinematic boxes in the rail group, like the stone gates), drift slowly across the road and sway about the deck
 * normal on the hazard clock, always clear of the field's lane. Physics, graphics and the AI read the same pose.
 */
import * as THREE from 'three';
import { CONFIG } from '../../core/config';
import type { TrackData, TrackFeature } from '../../core/contracts';
import { laneIntervals, spreadLateral } from './mine';

type DebrisFeature = Extract<TrackFeature, { type: 'debris' }>;

/** Sideways drift (m), sway (rad) and their rates (rad/s). */
const DEBRIS_DRIFT = 1.5;
const DEBRIS_SWAY = 0.25;
const DEBRIS_RATE = 0.45;
/** Clearance (m) between a hull on the lane centre and a piece at the widest point of its drift. */
export const DEBRIS_LANE_MARGIN = 1.5;
/** Gap between the deck and the underside of a piece (m). */
const DEBRIS_FLOAT = 0.25;

export interface BuiltDebris {
  index: number;
  d: number;
  progressU: number;
  /** Lateral at the centre of its drift (m). */
  lateral: number;
  drift: number;
  phase: number;
  /** Box size: across the road, height, along the road. */
  width: number;
  height: number;
  length: number;
  /** Road frame at the piece (centre on the deck). */
  center: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

/** Half the width a piece can take up across the road at any sway. */
export function debrisHalfAcross(width: number, length: number): number {
  return (width / 2) * Math.cos(DEBRIS_SWAY) + (length / 2) * Math.sin(DEBRIS_SWAY);
}

export function buildDebris(track: Pick<TrackData, 'features' | 'length' | 'halfWidth' | 'sampleAt'>): BuiltDebris[] {
  const out: BuiltDebris[] = [];
  for (const f of track.features) {
    if (f.type !== 'debris') continue;
    const field = f as DebrisFeature;
    const lane = field.lane ?? 0;
    const span = field.dEnd - field.dStart;
    for (let k = 0; k < field.count; k++) {
      const width = 3 + (k % 3);
      const length = 2.5 + ((k * 2) % 3) * 0.75;
      const height = 2 + (k % 2) * 0.8;
      const half = debrisHalfAcross(width, length);
      const gap = CONFIG.SHIP_WIDTH / 2 + DEBRIS_LANE_MARGIN + half + DEBRIS_DRIFT;
      const intervals = laneIntervals(track.halfWidth, lane, gap, half + DEBRIS_DRIFT + 0.5);
      if (intervals.length === 0) throw new Error(`debris field at ${field.dStart} m leaves no room beside its lane`);
      const d = field.dStart + ((k + 0.5) / field.count) * span;
      const smp = track.sampleAt((((d / track.length) % 1) + 1) % 1);
      out.push({
        index: out.length,
        d,
        progressU: smp.u,
        lateral: spreadLateral(intervals, k),
        drift: DEBRIS_DRIFT,
        phase: out.length * 2.399,
        width,
        height,
        length,
        center: smp.position.clone(),
        forward: smp.forward.clone(),
        right: smp.right.clone(),
        up: smp.up.clone(),
      });
    }
  }
  return out;
}

/** Lateral of a piece's centre at hazard time t. */
export function debrisLateral(b: Pick<BuiltDebris, 'lateral' | 'drift' | 'phase'>, t: number): number {
  return b.lateral + b.drift * Math.sin(DEBRIS_RATE * t + b.phase);
}

/** World pose (box centre and orientation) of a piece at hazard time t. */
export function debrisPose(b: BuiltDebris, t: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  outPos
    .copy(b.center)
    .addScaledVector(b.right, debrisLateral(b, t))
    .addScaledVector(b.up, DEBRIS_FLOAT + b.height / 2);
  scratchM.makeBasis(b.right, b.up, scratchF.copy(b.forward).negate());
  outQuat.setFromRotationMatrix(scratchM);
  outQuat.multiply(scratchQ.setFromAxisAngle(Y, DEBRIS_SWAY * Math.sin(DEBRIS_RATE * 1.3 * t + 2 * b.phase)));
}

const scratchM = new THREE.Matrix4();
const scratchF = new THREE.Vector3();
const scratchQ = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);
