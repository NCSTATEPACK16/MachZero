/**
 * Stone gates (Jade Ruins). A gate is a stone slab on a deterministic timeline in physics seconds since the race
 * reset (never wall-clock, so races and sims are reproducible): in each `period` it is shut for
 * `closedFraction · period` seconds, offset by `phase`, sliding in and out over GATE_SLIDE seconds at either end
 * of that window. Half-width gates on the main road slide across one half from out of the temple wall on their
 * side, so the other half is always open; the full-width gate on a shortcut drops from above like a portcullis.
 *
 * Physics, graphics and the AI all read the same pose from here.
 */
import * as THREE from 'three';
import { CONFIG } from '../../core/config';
import type { TrackData, TrackFeature } from '../../core/contracts';
import { clamp01, smoothstep } from '../../core/math';

type GateFeature = Extract<TrackFeature, { type: 'gate' }>;

/** Seconds a gate takes to slide shut or open. */
export const GATE_SLIDE = 0.6;
/** Seconds of warning glow before a gate starts to close (× the hazard policy's telegraphScale). */
export const GATE_WARNING = 1.5;
/** Slab size: thickness along the road and height above the deck (m). */
export const GATE_THICKNESS = 2.4;
export const GATE_HEIGHT = 5;
/** How far beyond its closed position a retracted slab sits (clear of ships and rails). */
const RETRACT_EXTRA = 2;

export interface BuiltGate {
  index: number;
  /** null on the main loop, else the split path's id. */
  branch: string | null;
  /** Main metres, or branch metres when on a branch. */
  d: number;
  /** Race progress (main-loop u) at the gate. */
  progressU: number;
  span: GateFeature['span'];
  period: number;
  phase: number;
  closedFraction: number;
  /** Road half-width at the gate. */
  roadHalfWidth: number;
  /** Road frame at the gate (centre on the deck). */
  center: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** Slab dimensions (across the road, height, along the road). */
  width: number;
  height: number;
  thickness: number;
}

export function buildGates(track: Pick<TrackData, 'features' | 'branches' | 'length' | 'halfWidth' | 'sampleAt'>): BuiltGate[] {
  const gates: BuiltGate[] = [];
  for (const f of track.features) {
    if (f.type !== 'gate') continue;
    const br = f.branch ? track.branches.find((b) => b.id === f.branch) : undefined;
    if (f.branch && !br) throw new Error(`gate on unknown branch ${f.branch}`);
    const smp = br ? br.sampleAt(f.d) : track.sampleAt((((f.d / track.length) % 1) + 1) % 1);
    const hw = br ? br.halfWidth : track.halfWidth;
    gates.push({
      index: gates.length,
      branch: br ? br.id : null,
      d: f.d,
      progressU: br ? br.progressU(f.d) : smp.u,
      span: f.span,
      period: f.period,
      phase: f.phase,
      closedFraction: f.closedFraction,
      roadHalfWidth: hw,
      center: smp.position.clone(),
      forward: smp.forward.clone(),
      right: smp.right.clone(),
      up: smp.up.clone(),
      width: f.span === 'full' ? 2 * hw : hw,
      height: GATE_HEIGHT,
      thickness: GATE_THICKNESS,
    });
  }
  return gates;
}

/** Seconds into the gate's current cycle. */
function cycleTime(g: Pick<BuiltGate, 'period' | 'phase'>, t: number): number {
  return (((t + g.phase) % g.period) + g.period) % g.period;
}

/** How far the slab is in at time t: 0 = open (retracted), 1 = shut. */
export function gateClosure(g: Pick<BuiltGate, 'period' | 'phase' | 'closedFraction'>, t: number): number {
  const c = cycleTime(g, t);
  const shut = g.closedFraction * g.period;
  if (c >= shut) return 0;
  return smoothstep(0, GATE_SLIDE, c) * (1 - smoothstep(shut - GATE_SLIDE, shut, c));
}

/** Warning glow 0..1 over the `warning` seconds before the gate starts to close (stays lit while it is shut). */
export function gateWarning(g: Pick<BuiltGate, 'period' | 'phase' | 'closedFraction'>, t: number, warning = GATE_WARNING): number {
  const c = cycleTime(g, t);
  const shut = g.closedFraction * g.period;
  if (c < shut) return 1;
  const toClose = g.period - c;
  return toClose <= warning ? clamp01(1 - toClose / warning) : 0;
}

/** Is any part of the slab in the road during [t0, t1]? (Sampled every 0.05 s; the AI's arrival check.) */
export function gateBlocksDuring(g: Pick<BuiltGate, 'period' | 'phase' | 'closedFraction'>, t0: number, t1: number): boolean {
  for (let t = t0; t <= t1; t += 0.05) if (gateClosure(g, t) > 0.02) return true;
  return gateClosure(g, t1) > 0.02;
}

/** Seconds from t until the gate is fully open again (0 if open now). */
export function gateOpensIn(g: Pick<BuiltGate, 'period' | 'phase' | 'closedFraction'>, t: number): number {
  const c = cycleTime(g, t);
  const shut = g.closedFraction * g.period;
  return c < shut ? shut - c : 0;
}

/** The lateral band [min, max] of the road the slab covers when shut. */
export function gateBand(g: Pick<BuiltGate, 'span' | 'roadHalfWidth'>): [number, number] {
  const hw = g.roadHalfWidth;
  return g.span === 'full' ? [-hw, hw] : g.span === 'left' ? [-hw, 0] : [0, hw];
}

/** World pose (centre + orientation) of the slab at closure c. */
export function gatePose(g: BuiltGate, c: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  const [lo, hi] = gateBand(g);
  let lateral = (lo + hi) / 2;
  let lift = g.height / 2;
  if (g.span === 'full') {
    // Portcullis: raised clear above the ships when open.
    lift += (1 - c) * (g.height + CONFIG.SHIP_HEIGHT + RETRACT_EXTRA);
  } else {
    // Slides out of the temple wall on its side: fully beyond the rail when open.
    const side = g.span === 'left' ? -1 : 1;
    lateral += side * (1 - c) * (g.width + CONFIG.RAIL_THICKNESS + RETRACT_EXTRA);
  }
  outPos.copy(g.center).addScaledVector(g.right, lateral).addScaledVector(g.up, lift);
  scratchM.makeBasis(g.right, g.up, scratchF.copy(g.forward).negate());
  outQuat.setFromRotationMatrix(scratchM);
}

const scratchM = new THREE.Matrix4();
const scratchF = new THREE.Vector3();
