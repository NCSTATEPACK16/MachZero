/**
 * Track building: layout (seeded or authored, see TrackSource) -> frames -> queries -> zones/grid ->
 * collision + visual. Runs headless in Node (no DOM/canvas; textures are DataTextures).
 */
import * as THREE from 'three';
import { CONFIG, PALETTE } from '../core/config';
import type { GridSlot, SurfaceKind, TrackData, TrackFeature, TrackJump, TrackZone } from '../core/contracts';
import { inLoopRange, wrap01 } from '../core/math';
import { Rng } from '../core/rng';
import { buildFrames, toTrackSamples, type BankOptions, type CorkscrewRange, type Differentials, type ResampledCurve } from './TrackFrames';
import { createLayout, type LayoutStats } from './TrackLayout';
import { buildTrackCollision, buildTrackVisual, type DashPlate, type TrackPalette, type VisualStats } from './TrackMesh';
import { TrackQuery } from './TrackQuery';
import { curlSamples, type PipeSpan } from './features/pipe';
import { BuiltBranch } from './features/branch';
import { buildGates } from './features/gate';
import { buildGateVisual } from './features/gateVisual';
import type { TrackProjection } from '../core/contracts';

const PIT_START = 30;
const PIT_END = 250;
const START_LINE_HALF_LENGTH = 2;
const GRID_SPACING = 12;
const GRID_LATERAL = 5;
const GRID_SLOTS = 8;
const DASH_COUNT_RANGE: [number, number] = [3, 4];
/** A ship whose last valid position is this far before a jump lip is respawned on the landing side. */
const JUMP_RESPAWN_BEFORE = 200;
const JUMP_RESPAWN_AFTER = 30;

/** v1's neon colours (the Bonus Track and the default for every theme that doesn't override them). */
export const DEFAULT_TRACK_PALETTE: TrackPalette = {
  left: PALETTE.cyan,
  right: PALETTE.magenta,
  accent: PALETTE.amber,
  pit: PALETTE.lime,
};

export interface TrackStats {
  layout: LayoutStats | null;
  visual: VisualStats;
  collision: { surfaceTriangles: number; railTriangles: number };
  generationMs: number;
}

/** Everything buildTrack needs: a resampled closed centerline plus its identity and features (final metres). */
export interface BuiltLayout {
  id: string;
  worldId: string;
  name: string;
  laps: number;
  seed: number;
  curve: THREE.CatmullRomCurve3;
  resampled: ResampledCurve;
  differentials: Differentials;
  features: TrackFeature[];
  bank?: BankOptions;
  airGravityScale: number;
  stats: LayoutStats | null;
  /** Seeded tracks place their dash plates once the curvature is known. */
  placeDashPlates?: (length: number, curvatureAt: (d: number) => number) => DashPlate[];
}

export interface BuildOptions {
  palette?: TrackPalette;
  /** Hazard telegraphing strength (HazardPolicy.telegraphScale): Rookie races pulse ice patches harder. */
  telegraphScale?: number;
}

const statsByTrack = new WeakMap<TrackData, TrackStats>();

/** Diagnostics recorded for a built track (undefined for foreign objects). */
export function getTrackStats(track: TrackData): TrackStats | undefined {
  return statsByTrack.get(track);
}

/** Circular distance between two lap positions in metres. */
function loopGap(a: number, b: number, length: number): number {
  const d = Math.abs(a - b) % length;
  return Math.min(d, length - d);
}

/** v1 dash-plate placement for seeded tracks (deterministic by seed). */
export function placeSeededDashPlates(
  seed: number,
  length: number,
  corkscrew: { dStart: number; dEnd: number },
  curvatureAt: (distance: number) => number,
): DashPlate[] {
  const rng = new Rng((seed ^ 0x5bd1e995) >>> 0);
  const wanted = rng.int(DASH_COUNT_RANGE[0], DASH_COUNT_RANGE[1]);
  const corkMid = (corkscrew.dStart + corkscrew.dEnd) / 2;
  const corkHalf = (corkscrew.dEnd - corkscrew.dStart) / 2 + 60;
  const plates: DashPlate[] = [];
  for (let attempt = 0; attempt < 4000 && plates.length < wanted; attempt++) {
    const relaxed = attempt > 1500;
    const distance = rng.range(0, length);
    const lateral = rng.range(-5, 5);
    // Keep clear of the grid, start line and pit strip, and of the corkscrew.
    if (distance < PIT_END + 60 || distance > length - 100) continue;
    if (loopGap(distance, corkMid, length) < corkHalf) continue;
    if (plates.some((p) => loopGap(p.distance, distance, length) < (relaxed ? 250 : 420))) continue;
    if (!relaxed && Math.abs(curvatureAt(distance)) > 1 / 350) continue;
    plates.push({ distance, lateral });
  }
  if (plates.length < DASH_COUNT_RANGE[0]) {
    throw new Error(`generateTrack: could not place dash plates for seed ${seed}`);
  }
  return plates.sort((a, b) => a.distance - b.distance);
}

/** v1: the seeded random circuit (now the hidden Bonus Track, ?seed=N). */
export function generateTrack(opts: { seed: number }, build: BuildOptions = {}): TrackData {
  return buildTrack(seededLayout(opts.seed), build);
}

export function seededLayout(seed: number): BuiltLayout {
  const layout = createLayout(seed);
  const length = layout.resampled.length;
  const corkscrew = { dStart: layout.corkscrew.uStart * length, dEnd: layout.corkscrew.uEnd * length };
  return {
    id: `bonus-${seed}`,
    worldId: 'neon-bay',
    name: `BONUS TRACK #${seed}`,
    laps: CONFIG.TOTAL_LAPS,
    seed,
    curve: layout.curve,
    resampled: layout.resampled,
    differentials: layout.differentials,
    features: [
      { type: 'corkscrew', dStart: corkscrew.dStart, dEnd: corkscrew.dEnd },
      { type: 'pit', dStart: PIT_START, dEnd: PIT_END, lateralMin: CONFIG.PIT_LATERAL_MIN, lateralMax: CONFIG.PIT_LATERAL_MAX },
    ],
    airGravityScale: 1,
    stats: layout.stats,
    placeDashPlates: (len, curvatureAt) => placeSeededDashPlates(seed, len, corkscrew, curvatureAt),
  };
}

/** Is a projection on the drivable surface of a road of half-width `hw` (not off its edge, not far above/below)? */
function onRoad(lateral: number, height: number, hw: number): boolean {
  return Math.abs(lateral) <= hw + 0.5 && height > -3 && height < 12;
}

/**
 * Projection with split paths: stay on the hinted road while still on it; otherwise move to whichever road the
 * point is on (main first); a point on neither (falling) keeps its hinted road.
 */
function projectWithBranches(
  query: TrackQuery,
  branches: readonly BuiltBranch[],
  length: number,
  pos: THREE.Vector3,
  hintU: number | undefined,
  hintPath: string | null,
): TrackProjection {
  const main = query.project(pos, hintU);
  const mainOk = onRoad(main.lateral, main.height, CONFIG.TRACK_HALF_WIDTH);
  if (hintPath === null && mainOk) return main;
  let hinted: TrackProjection | null = hintPath === null ? main : null;
  let firstOk: TrackProjection | null = null;
  for (const b of branches) {
    const near = hintPath === b.id || inLoopRange(main.u, wrap01(b.uFork - 40 / length), wrap01(b.uMerge + 40 / length));
    if (!near) continue;
    const bp = b.project(pos, hintU !== undefined ? b.sAtProgress(hintU) : undefined);
    const u = b.progressU(bp.s, bp.lateral);
    const proj: TrackProjection = { u, distance: u * length, lateral: bp.lateral, height: bp.height, sample: bp.sample, path: b.id, pathS: bp.s };
    const ok = bp.within && onRoad(bp.lateral, bp.height, b.halfWidth);
    if (hintPath === b.id) {
      if (ok) return proj;
      hinted = proj;
    } else if (ok && !firstOk) firstOk = proj;
  }
  if (mainOk) return main;
  return firstOk ?? hinted ?? main;
}

/** frames -> query -> zones -> grid -> collision -> visual. */
export function buildTrack(layout: BuiltLayout, build: BuildOptions = {}): TrackData {
  const t0 = performance.now();
  const { resampled, differentials } = layout;
  const length = resampled.length;

  const corkscrewFeatures = layout.features.filter((f): f is Extract<TrackFeature, { type: 'corkscrew' }> => f.type === 'corkscrew');
  const rolls: CorkscrewRange[] = corkscrewFeatures.map((f) => ({ uStart: f.dStart / length, uEnd: f.dEnd / length, turns: f.turns }));
  const pipeSpans: PipeSpan[] = layout.features.flatMap((f) => (f.type === 'pipe' ? [{ dStart: f.dStart, dEnd: f.dEnd, transition: f.transition }] : []));
  const curl = curlSamples(resampled.count, resampled.ds, pipeSpans);
  const frames = buildFrames(resampled, differentials, rolls, layout.bank, curl);
  const samples = toTrackSamples(frames);
  const query = new TrackQuery(frames, CONFIG.TRACK_HALF_WIDTH);
  const curvatureAt = (d: number): number => query.sampleAt(d / length).curvature;

  // ---- Features in final metres ----
  const features: TrackFeature[] = [...layout.features];
  if (layout.placeDashPlates) {
    for (const p of layout.placeDashPlates(length, curvatureAt)) {
      features.push({ type: 'dash', dStart: p.distance - 6, dEnd: p.distance + 6, lateralMin: p.lateral - 4, lateralMax: p.lateral + 4 });
    }
  }
  type ZoneFeature = Extract<TrackFeature, { lateralMin: number }>;
  const pitFeature = features.find((f): f is ZoneFeature => f.type === 'pit');
  if (!pitFeature) throw new Error(`buildTrack(${layout.id}): a track needs a pit strip`);
  const pit = { dStart: pitFeature.dStart, dEnd: pitFeature.dEnd };
  const dashPlates: DashPlate[] = features.flatMap((f) =>
    f.type === 'dash' ? [{ distance: (f.dStart + f.dEnd) / 2, lateral: (f.lateralMin + f.lateralMax) / 2 }] : [],
  );

  // Jumps snap to frame samples so the open gap in the geometry and surfaceKindAt agree exactly.
  const n = frames.count;
  const jumps: TrackJump[] = features.flatMap((f) => {
    if (f.type !== 'jump') return [];
    const iT = Math.round(f.dTakeoff / frames.ds) % n;
    const iL = Math.round(f.dLanding / frames.ds) % n;
    return [{ uTakeoff: iT / n, uLanding: iL / n, dTakeoff: iT * frames.ds, dLanding: iL * frames.ds }];
  });

  // ---- Zones ----
  const zones: TrackZone[] = [
    {
      type: 'startLine',
      uStart: wrap01(-START_LINE_HALF_LENGTH / length),
      uEnd: START_LINE_HALF_LENGTH / length,
      lateralMin: -CONFIG.TRACK_HALF_WIDTH,
      lateralMax: CONFIG.TRACK_HALF_WIDTH,
    },
    { type: 'pit', uStart: pit.dStart / length, uEnd: pit.dEnd / length, lateralMin: pitFeature.lateralMin, lateralMax: pitFeature.lateralMax },
    ...features.flatMap((f): TrackZone[] =>
      f.type === 'dash' ? [{ type: 'dash', uStart: wrap01(f.dStart / length), uEnd: wrap01(f.dEnd / length), lateralMin: f.lateralMin, lateralMax: f.lateralMax }] : [],
    ),
  ];

  // ---- Start grid: 8 slots (4 rows × 2 staggered columns) behind the line, index 0 = pole ----
  const basis = new THREE.Matrix4();
  const back = new THREE.Vector3();
  const startGrid: GridSlot[] = [];
  for (let k = 0; k < GRID_SLOTS; k++) {
    const u = wrap01(-(GRID_SPACING * (k + 1)) / length);
    const lateral = k % 2 === 0 ? -GRID_LATERAL : GRID_LATERAL;
    const s = query.sampleAt(u);
    const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
    // Local +X -> right, +Y -> up, -Z -> forward.
    back.copy(s.forward).negate();
    basis.makeBasis(s.right, s.up, back);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
    startGrid.push({ u, lateral, position, quaternion });
  }

  const gaps = jumps.map((j) => ({ dStart: j.dTakeoff, dEnd: j.dLanding }));
  const corkDists = corkscrewFeatures.map((f) => ({ dStart: f.dStart, dEnd: f.dEnd }));
  const branches = features.flatMap((f) => (f.type === 'branch' ? [new BuiltBranch(f, query, length)] : []));
  const collision = buildTrackCollision(frames, gaps, branches);
  const { group, stats: visualStats } = buildTrackVisual({
    frames,
    query,
    corkscrews: corkDists,
    pipes: pipeSpans,
    ice: features.flatMap((f) => (f.type === 'ice' ? [f] : [])),
    telegraphScale: build.telegraphScale ?? 1,
    branches,
    pit,
    dashPlates,
    gaps,
    palette: build.palette ?? DEFAULT_TRACK_PALETTE,
  });

  // Stone gates: their slabs move, so they are posed each frame (animateHazards) from the physics clock.
  const palette = build.palette ?? DEFAULT_TRACK_PALETTE;
  const gateDefs = features.some((f) => f.type === 'gate')
    ? buildGates({ features, branches, length, halfWidth: CONFIG.TRACK_HALF_WIDTH, sampleAt: (u, out) => query.sampleAt(u, out) })
    : [];
  const gateVisual = gateDefs.length > 0 ? buildGateVisual(gateDefs, palette.accent, build.telegraphScale ?? 1) : null;
  if (gateVisual) group.add(gateVisual.group);

  const pipes = pipeSpans.map((p) => ({
    uStart: wrap01(p.dStart / length),
    uEnd: wrap01(p.dEnd / length),
    uClosedStart: wrap01((p.dStart + p.transition) / length),
    uClosedEnd: wrap01((p.dEnd - p.transition) / length),
  }));
  const ice = features.flatMap((f) =>
    f.type === 'ice' ? [{ uStart: wrap01(f.dStart / length), uEnd: wrap01(f.dEnd / length), lateralMin: f.lateralMin, lateralMax: f.lateralMax, grip: f.grip }] : [],
  );
  const gripAt = (u: number, lateral: number, path?: string | null): number => {
    if (path) return 1;
    const uw = wrap01(u);
    for (const z of ice) if (inLoopRange(uw, z.uStart, z.uEnd) && lateral >= z.lateralMin && lateral <= z.lateralMax) return z.grip;
    return 1;
  };
  const surfaceKindAt = (u: number, lateral: number, path?: string | null): SurfaceKind => {
    if (path) return 'road';
    const uw = wrap01(u);
    for (const j of jumps) if (inLoopRange(uw, j.uTakeoff, j.uLanding) && u !== j.uTakeoff && u !== j.uLanding) return 'air';
    for (const z of ice) if (inLoopRange(uw, z.uStart, z.uEnd) && lateral >= z.lateralMin && lateral <= z.lateralMax) return 'ice';
    for (const p of pipes) if (inLoopRange(uw, p.uStart, p.uEnd)) return 'pipe';
    return 'road';
  };
  const safeRespawnU = (u: number): number => {
    const d = wrap01(u) * length;
    for (const j of jumps) {
      const from = j.dTakeoff - JUMP_RESPAWN_BEFORE;
      const rel = (((d - from) % length) + length) % length;
      if (rel <= j.dLanding - from) return wrap01((j.dLanding + JUMP_RESPAWN_AFTER) / length);
    }
    return u;
  };

  const first = rolls[0];
  const track: TrackData = {
    id: layout.id,
    worldId: layout.worldId,
    name: layout.name,
    laps: layout.laps,
    seed: layout.seed,
    length,
    halfWidth: CONFIG.TRACK_HALF_WIDTH,
    railHeight: CONFIG.RAIL_HEIGHT,
    curve: layout.curve,
    samples,
    sampleAt: (u, out) => query.sampleAt(u, out),
    project: branches.length === 0 ? (pos, hintU) => query.project(pos, hintU) : (pos, hintU, hintPath) => projectWithBranches(query, branches, length, pos, hintU, hintPath ?? null),
    surfacePoint: (u, lateral, out, outUp) => query.surfacePoint(u, lateral, out, outUp),
    zones,
    startGrid,
    collision,
    visual: group,
    ...(gateVisual ? { animateHazards: gateVisual.update } : {}),
    corkscrew: first ? { uStart: first.uStart, uEnd: first.uEnd } : null,
    features,
    jumps,
    branches,
    pipes,
    airGravityScale: layout.airGravityScale,
    surfaceKindAt,
    gripAt,
    safeRespawnU,
  };
  statsByTrack.set(track, {
    layout: layout.stats,
    visual: visualStats,
    collision: {
      surfaceTriangles: collision.surface.indices.length / 3,
      railTriangles: collision.rails.indices.length / 3,
    },
    generationMs: performance.now() - t0,
  });
  return track;
}
