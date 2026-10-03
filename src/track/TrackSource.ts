/**
 * Where a track's centerline comes from: v1's seeded random layout (the Bonus Track) or an authored
 * TrackDefinition (content/tracks/*.json). Both end as a BuiltLayout that buildTrack turns into TrackData.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { TrackData, TrackDefinition, TrackFeature } from '../core/contracts';
import { jumpDisplacement } from './features/jump';
import { computeDifferentials, resampleCurve } from './TrackFrames';
import { buildTrack, seededLayout, type BuildOptions, type BuiltLayout } from './TrackGenerator';

export type TrackLayoutSource = { kind: 'seeded'; seed: number } | { kind: 'authored'; def: TrackDefinition };

/** Stable 32-bit hash of a track id (authored tracks' RNG seed). */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Shift every distance field of a feature through `map` (authored metres -> final metres). */
function remapFeature(f: TrackFeature, map: (d: number) => number): TrackFeature {
  switch (f.type) {
    case 'jump':
      return { ...f, dTakeoff: map(f.dTakeoff), dLanding: map(f.dLanding) };
    case 'gate':
      return { ...f, d: map(f.d) };
    case 'branch':
      return { ...f, dFork: map(f.dFork), dMerge: map(f.dMerge) };
    default:
      return { ...f, dStart: map(f.dStart), dEnd: map(f.dEnd) };
  }
}

export function authoredLayout(def: TrackDefinition): BuiltLayout {
  if (def.points.length < 4) throw new Error(`track ${def.id}: needs at least 4 control points`);
  const curve = new THREE.CatmullRomCurve3(
    def.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    true,
    'centripetal',
  );
  curve.arcLengthDivisions = 8192;
  const airGravityScale = def.airGravityScale ?? 1;
  const jumps = def.features.flatMap((f) => (f.type === 'jump' ? [f] : []));
  const resampled = resampleCurve(curve, CONFIG.TRACK_SAMPLES, 16384, jumps.length ? jumpDisplacement(jumps, airGravityScale) : undefined);
  const differentials = computeDifferentials(resampled.pos, resampled.count, resampled.ds);
  return {
    id: def.id,
    worldId: def.worldId,
    name: def.name,
    laps: def.laps,
    seed: hashId(def.id),
    curve,
    resampled,
    differentials,
    features: def.features.map((f) => remapFeature(f, resampled.remapDistance)),
    bank: { bankFactor: def.bankFactor ?? CONFIG.BANK_FACTOR, maxBank: def.maxBank ?? CONFIG.MAX_BANK },
    airGravityScale,
    stats: null,
  };
}

export function layoutFrom(source: TrackLayoutSource): BuiltLayout {
  return source.kind === 'seeded' ? seededLayout(source.seed) : authoredLayout(source.def);
}

export function trackFromSource(source: TrackLayoutSource, build: BuildOptions = {}): TrackData {
  return buildTrack(layoutFrom(source), build);
}
