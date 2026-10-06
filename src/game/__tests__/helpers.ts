import * as THREE from 'three';
import type {
  ShipDefinition,
  ShipId,
  ShipState,
  TrackData,
  TrackProjection,
  TrackSample,
  TrackZone,
} from '../../core/contracts';
import { CLASSIC_STATS } from '../../core/config';
import { neutralControls } from '../../core/controls';
import { EventBus, type GameEvents } from '../../core/events';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Synthetic flat circular track in the XZ plane. Viewed from +Y the centerline runs
 * clockwise-in-math-terms such that the driver's right points at the circle centre
 * (curvature +1/R). `direction = -1` mirrors it (left-hand circle, curvature -1/R).
 */
export function makeCircleTrack(radius = 400, direction: 1 | -1 = 1, options: { pit?: boolean } = {}): TrackData {
  const N = 720;
  const length = 2 * Math.PI * radius;
  const halfWidth = 14;

  const frameAt = (u: number, out: TrackSample): TrackSample => {
    const a = direction * 2 * Math.PI * (u - Math.floor(u));
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.u = u - Math.floor(u);
    out.distance = out.u * length;
    out.position.set(radius * c, 0, radius * s);
    out.forward.set(-s * direction, 0, c * direction);
    out.up.copy(UP);
    out.right.crossVectors(out.forward, out.up);
    out.roll = 0;
    out.curvature = 1 / radius * direction;
    out.halfWidth = halfWidth;
    return out;
  };
  const blank = (): TrackSample => ({
    u: 0,
    distance: 0,
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    up: new THREE.Vector3(),
    right: new THREE.Vector3(),
    roll: 0,
    curvature: 0,
    halfWidth,
  });
  const samples: TrackSample[] = [];
  for (let i = 0; i < N; i++) samples.push(frameAt(i / N, blank()));

  const zones: TrackZone[] = [{ type: 'startLine', uStart: 0.995, uEnd: 0.005, lateralMin: -halfWidth, lateralMax: halfWidth }];
  if (options.pit) zones.push({ type: 'pit', uStart: 0.9, uEnd: 0.05, lateralMin: -13, lateralMax: -7 });

  const track: TrackData = {
    id: 'test-circle',
    worldId: 'test',
    name: 'TEST CIRCLE',
    laps: 3,
    seed: 1,
    length,
    halfWidth,
    railHeight: 2.5,
    curve: new THREE.CatmullRomCurve3(samples.filter((_, i) => i % 60 === 0).map((s) => s.position.clone()), true),
    samples,
    sampleAt(u, out) {
      return frameAt(u, out ?? blank());
    },
    project(pos, hintU): TrackProjection {
      void hintU;
      let a = Math.atan2(pos.z, pos.x) * direction;
      if (a < 0) a += 2 * Math.PI;
      const u = a / (2 * Math.PI);
      const sample = frameAt(u, blank());
      const rel = pos.clone().sub(sample.position);
      return { u, distance: u * length, lateral: rel.dot(sample.right), height: rel.dot(sample.up), sample, path: null };
    },
    zones,
    startGrid: [],
    collision: { surface: { vertices: new Float32Array(0), indices: new Uint32Array(0) }, rails: { vertices: new Float32Array(0), indices: new Uint32Array(0) } },
    visual: new THREE.Group(),
    corkscrew: { uStart: 0.5, uEnd: 0.55 },
    features: [],
    jumps: [],
    airGravityScale: 1,
    pipes: [],
    branches: [],
    surfaceKindAt: () => 'road',
    gripAt: () => 1,
    surfacePoint(u, lateral, out, outUp) {
      const smp = this.sampleAt(u);
      if (outUp) outUp.copy(smp.up);
      return out.copy(smp.position).addScaledVector(smp.right, lateral);
    },
    safeRespawnU: (u) => u,
  };
  return track;
}

export function makeShip(id: ShipId, isPlayer = id === 0, personality?: ShipDefinition['personality']): ShipState {
  const def: ShipDefinition = {
    id,
    name: `SHIP ${id}`,
    isPlayer,
    livery: { primary: 0xffffff, secondary: 0x000000, glow: 0xffffff },
    personality,
    gridIndex: id,
    stats: CLASSIC_STATS,
  };
  return {
    def,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    path: null,
    prevPosition: new THREE.Vector3(),
    prevQuaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    speed: 0,
    forwardSpeed: 0,
    bank: 0,
    grounded: true,
    energy: 100,
    boosting: false,
    boostTimer: 0,
    inPit: false,
    onDash: false,
    trackU: 0.99,
    lateral: 0,
    heightAboveTrack: 1.2,
    airborne: false,
    lastControls: neutralControls(),
    status: 'grid',
    boostUnlocked: false,
    thrustScale: 1,
  };
}

/** Place a ship on the track at (u, lateral) facing along the track, `yaw` radians left of forward. */
export function placeShip(ship: ShipState, track: TrackData, u: number, lateral = 0, yaw = 0): void {
  const s = track.sampleAt(u);
  ship.position.copy(s.position).addScaledVector(s.right, lateral).addScaledVector(s.up, 1.2);
  const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
  ship.quaternion.setFromRotationMatrix(m);
  if (yaw !== 0) ship.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
  ship.trackU = u - Math.floor(u);
  ship.lateral = lateral;
}

export interface Recorded {
  type: keyof GameEvents;
  payload: unknown;
}

export function makeBus(): { bus: EventBus<GameEvents>; events: Recorded[] } {
  const bus = new EventBus<GameEvents>();
  const events: Recorded[] = [];
  const keys: (keyof GameEvents)[] = [
    'race:state',
    'race:countdown',
    'race:lap',
    'race:finish',
    'race:results',
    'ship:destroyed',
  ];
  for (const k of keys) bus.on(k, (payload: unknown) => events.push({ type: k, payload }));
  return { bus, events };
}
