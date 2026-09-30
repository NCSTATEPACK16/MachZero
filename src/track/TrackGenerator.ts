/**
 * Track generation orchestrator: layout -> frames -> queries -> zones/grid -> collision + visual.
 * Runs headless in Node (no DOM/canvas; textures are DataTextures).
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { GridSlot, TrackData, TrackZone } from '../core/contracts';
import { wrap01 } from '../core/math';
import { Rng } from '../core/rng';
import { buildFrames, toTrackSamples } from './TrackFrames';
import { createLayout, type LayoutStats } from './TrackLayout';
import { buildTrackCollision, buildTrackVisual, type DashPlate, type VisualStats } from './TrackMesh';
import { TrackQuery } from './TrackQuery';

const PIT_START = 30;
const PIT_END = 250;
const START_LINE_HALF_LENGTH = 2;
const GRID_SPACING = 12;
const GRID_LATERAL = 5;
const GRID_SLOTS = 8;
const DASH_COUNT_RANGE: [number, number] = [3, 4];

export interface TrackStats {
  layout: LayoutStats;
  visual: VisualStats;
  collision: { surfaceTriangles: number; railTriangles: number };
  generationMs: number;
}

const statsByTrack = new WeakMap<TrackData, TrackStats>();

/** Diagnostics recorded for a track produced by `generateTrack` (undefined for foreign objects). */
export function getTrackStats(track: TrackData): TrackStats | undefined {
  return statsByTrack.get(track);
}

/** Circular distance between two lap positions in metres. */
function loopGap(a: number, b: number, length: number): number {
  const d = Math.abs(a - b) % length;
  return Math.min(d, length - d);
}

function placeDashPlates(
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

export function generateTrack(opts: { seed: number }): TrackData {
  const t0 = performance.now();
  const seed = opts.seed;
  const layout = createLayout(seed);
  const { resampled, differentials } = layout;
  const length = resampled.length;

  const corkscrew = { uStart: layout.corkscrew.uStart, uEnd: layout.corkscrew.uEnd };
  const frames = buildFrames(resampled, differentials, corkscrew);
  const samples = toTrackSamples(frames);
  const query = new TrackQuery(frames, CONFIG.TRACK_HALF_WIDTH);

  // ---- Zones ----
  const corkDist = { dStart: corkscrew.uStart * length, dEnd: corkscrew.uEnd * length };
  const pit = { dStart: PIT_START, dEnd: PIT_END };
  const curvatureAt = (d: number): number => query.sampleAt(d / length).curvature;
  const dashPlates = placeDashPlates(seed, length, corkDist, curvatureAt);

  const zones: TrackZone[] = [
    {
      type: 'startLine',
      uStart: wrap01(-START_LINE_HALF_LENGTH / length),
      uEnd: START_LINE_HALF_LENGTH / length,
      lateralMin: -CONFIG.TRACK_HALF_WIDTH,
      lateralMax: CONFIG.TRACK_HALF_WIDTH,
    },
    {
      type: 'pit',
      uStart: pit.dStart / length,
      uEnd: pit.dEnd / length,
      lateralMin: CONFIG.PIT_LATERAL_MIN,
      lateralMax: CONFIG.PIT_LATERAL_MAX,
    },
    ...dashPlates.map(
      (p): TrackZone => ({
        type: 'dash',
        uStart: (p.distance - 6) / length,
        uEnd: (p.distance + 6) / length,
        lateralMin: p.lateral - 4,
        lateralMax: p.lateral + 4,
      }),
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

  const collision = buildTrackCollision(frames);
  const { group, stats: visualStats } = buildTrackVisual({ frames, query, corkscrew: corkDist, pit, dashPlates });

  const track: TrackData = {
    seed,
    length,
    halfWidth: CONFIG.TRACK_HALF_WIDTH,
    railHeight: CONFIG.RAIL_HEIGHT,
    curve: layout.curve,
    samples,
    sampleAt: (u, out) => query.sampleAt(u, out),
    project: (pos, hintU) => query.project(pos, hintU),
    zones,
    startGrid,
    collision,
    visual: group,
    corkscrew,
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
