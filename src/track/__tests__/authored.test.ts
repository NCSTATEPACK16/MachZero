import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CONFIG } from '../../core/config';
import type { TrackData } from '../../core/contracts';
import { TRACK_DEFS } from '../../content/tracks';
import { WORLDS } from '../../content/worlds';
import { generateTrack, trackFromSource } from '..';
import { RAMP_LENGTH, jumpOffset } from '../features/jump';
import { validateTrack } from '../TrackValidate';

const built = new Map<string, TrackData>();
beforeAll(() => {
  for (const def of Object.values(TRACK_DEFS)) built.set(def.id, trackFromSource({ kind: 'authored', def }));
});

describe.each(Object.keys(TRACK_DEFS))('authored track %s', (id) => {
  it('passes validation (radius, clearance, elevation, features, lap length)', () => {
    const def = TRACK_DEFS[id];
    const report = validateTrack(built.get(id)!, def.elevation);
    console.log(
      `${id}: ${report.length.toFixed(0)} m, ~${report.lapEstimate.toFixed(1)} s/lap, min radius ${report.minRadius.toFixed(0)} m, ` +
        `elevation ${report.elevation.map((e) => e.toFixed(1)).join('..')} m`,
    );
    expect(report.issues).toEqual([]);
  });

  it('is a playable TrackData: identity, pit, 8-slot grid, its world exists', () => {
    const t = built.get(id)!;
    const def = TRACK_DEFS[id];
    expect(t.id).toBe(id);
    expect(t.worldId).toBe(def.worldId);
    expect(WORLDS.some((w) => w.id === def.worldId && w.trackId === id)).toBe(true);
    expect(t.zones.filter((z) => z.type === 'pit')).toHaveLength(1);
    expect(t.startGrid).toHaveLength(8);
    expect(t.samples).toHaveLength(CONFIG.TRACK_SAMPLES);
    // Start line on the first control point.
    const p0 = new THREE.Vector3(...def.points[0]);
    expect(t.samples[0].position.distanceTo(p0)).toBeLessThan(0.5);
  });

  it('is deterministic', () => {
    const again = trackFromSource({ kind: 'authored', def: TRACK_DEFS[id] });
    const a = built.get(id)!;
    for (let i = 0; i < a.samples.length; i += 97) expect(again.samples[i].position.equals(a.samples[i].position)).toBe(true);
  });
});

describe('jumps (Sunset Mesa)', () => {
  const id = 'sunset-mesa';

  it('has two open gaps: no surface or rail triangles between lip and landing', () => {
    const t = built.get(id)!;
    expect(t.jumps).toHaveLength(2);
    for (const j of t.jumps) {
      const mid = t.sampleAt((j.uTakeoff + j.uLanding) / 2);
      const { vertices } = t.collision.surface;
      let nearest = Infinity;
      for (let k = 0; k < vertices.length; k += 3) {
        const d = Math.hypot(vertices[k] - mid.position.x, vertices[k + 1] - mid.position.y, vertices[k + 2] - mid.position.z);
        nearest = Math.min(nearest, d);
      }
      // The nearest surface vertex is at a gap edge: about half the gap away.
      expect(nearest).toBeGreaterThan((j.dLanding - j.dTakeoff) / 2 - 3);
    }
  });

  it('reports air over the gap and road elsewhere; respawns past the jump', () => {
    const t = built.get(id)!;
    for (const j of t.jumps) {
      const L = t.length;
      expect(t.surfaceKindAt((j.dTakeoff + 1) / L, 0)).toBe('air');
      expect(t.surfaceKindAt((j.dLanding - 1) / L, 5)).toBe('air');
      expect(t.surfaceKindAt((j.dTakeoff - 5) / L, 0)).toBe('road');
      expect(t.surfaceKindAt((j.dLanding + 5) / L, 0)).toBe('road');
      const safe = t.safeRespawnU((j.dTakeoff - 50) / L) * L;
      expect(safe).toBeGreaterThan(j.dLanding);
      expect(t.safeRespawnU(0.001)).toBe(0.001);
    }
  });

  it('raises a kicker ramp and bends the centerline along the design flight path', () => {
    const def = TRACK_DEFS[id];
    const spec = def.features.find((f) => f.type === 'jump')!;
    if (spec.type !== 'jump') throw new Error('unreachable');
    expect(jumpOffset(spec, spec.dTakeoff - RAMP_LENGTH - 1, 1)).toBe(0);
    expect(jumpOffset(spec, spec.dTakeoff, 1)).toBeCloseTo(spec.kick, 6);
    // Continuous at the lip and landing edge.
    expect(jumpOffset(spec, spec.dTakeoff + 1e-6, 1)).toBeCloseTo(spec.kick, 4);
    const yL = jumpOffset(spec, spec.dLanding, 1);
    expect(jumpOffset(spec, spec.dLanding + 1e-6, 1)).toBeCloseTo(yL, 4);
  });
});

describe('Bonus Track (seeded) still builds', () => {
  it('generates the v1 seed with its corkscrew, no jumps, road everywhere', () => {
    const t = generateTrack({ seed: CONFIG.TRACK_SEED });
    expect(t.id).toBe(`bonus-${CONFIG.TRACK_SEED}`);
    expect(t.corkscrew).not.toBeNull();
    expect(t.jumps).toEqual([]);
    expect(t.surfaceKindAt(0.5, 0)).toBe('road');
  });
});
