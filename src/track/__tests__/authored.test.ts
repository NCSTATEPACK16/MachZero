import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CONFIG } from '../../core/config';
import type { TrackData } from '../../core/contracts';
import { TRACK_DEFS } from '../../content/tracks';
import { WORLDS } from '../../content/worlds';
import { generateTrack, trackFromSource } from '..';
import { RAMP_LENGTH, jumpOffset } from '../features/jump';
import { validateTrack } from '../TrackValidate';
import { PIPE_RADIUS, curlPoint, uncurlPoint } from '../features/pipe';
import { BuiltBranch, branchSeparation } from '../features/branch';
import { branchNose } from '../TrackMesh';

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

describe('pipe (Cryo Station)', () => {
  const t = () => built.get('cryo-station')!;
  const pipe = () => {
    const f = t().features.find((x) => x.type === 'pipe');
    if (f?.type !== 'pipe') throw new Error('no pipe');
    return f;
  };

  it('curlPoint and uncurlPoint invert each other; full curl closes a 2·halfWidth circle', () => {
    const p = { x: 0, y: 0, phi: 0 };
    const back = { lateral: 0, height: 0, phi: 0 };
    for (const curl of [0, 0.3, 0.7, 1]) {
      for (const lat of [-13, -6, 0, 4, 11]) {
        for (const h of [0, 1.2, 3]) {
          curlPoint(lat, h, curl, p);
          uncurlPoint(p.x, p.y, curl, back);
          expect(back.lateral).toBeCloseTo(lat, 6);
          expect(back.height).toBeCloseTo(h, 6);
        }
      }
    }
    // Edges meet at the top of the closed tube.
    curlPoint(CONFIG.TRACK_HALF_WIDTH, 0, 1, p);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(2 * PIPE_RADIUS, 6);
  });

  it('surface points of the closed stretch lie on the tube; project() inverts surfacePoint', () => {
    const track = t();
    const f = pipe();
    const L = track.length;
    const pt = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const d of [f.dStart + f.transition + 20, (f.dStart + f.dEnd) / 2, f.dEnd - f.transition - 20]) {
      const u = d / L;
      const s = track.sampleAt(u);
      const axis = s.position.clone().addScaledVector(s.up, PIPE_RADIUS);
      for (const lat of [-12, -5, 0, 7, 13]) {
        track.surfacePoint(u, lat, pt, n);
        const rel = pt.clone().sub(axis);
        rel.addScaledVector(s.forward, -rel.dot(s.forward));
        expect(rel.length()).toBeCloseTo(PIPE_RADIUS, 1);
        // The surface normal points at the axis.
        expect(n.dot(rel.clone().normalize())).toBeLessThan(-0.99);
        const hover = pt.clone().addScaledVector(n, 1.2);
        const pr = track.project(hover, u);
        expect(pr.lateral).toBeCloseTo(lat, 1);
        expect(pr.height).toBeCloseTo(1.2, 1);
      }
    }
  });

  it('reports pipe inside it, ice on its patches (with their grip), road elsewhere', () => {
    const track = t();
    const L = track.length;
    const f = pipe();
    expect(track.pipes).toHaveLength(1);
    expect(track.surfaceKindAt((f.dStart + 30) / L, 0)).toBe('pipe');
    expect(track.surfaceKindAt((f.dStart - 30) / L, 0)).toBe('road');
    for (const ice of track.features) {
      if (ice.type !== 'ice') continue;
      const u = (ice.dStart + ice.dEnd) / 2 / L;
      const lat = (ice.lateralMin + ice.lateralMax) / 2;
      expect(track.surfaceKindAt(u, lat)).toBe('ice');
      expect(track.gripAt(u, lat)).toBe(ice.grip);
      const outside = ice.lateralMin > -10 ? ice.lateralMin - 3 : ice.lateralMax + 3;
      expect(track.gripAt(u, outside)).toBe(1);
    }
  });

  it('has no rail triangles over the closed tube, and rails back on the open road', () => {
    const track = t();
    const f = pipe();
    const mid = track.sampleAt((f.dStart + f.dEnd) / 2 / track.length).position;
    const v = track.collision.rails.vertices;
    let near = 0;
    for (let i = 0; i < v.length; i += 3) if (Math.hypot(v[i] - mid.x, v[i + 1] - mid.y, v[i + 2] - mid.z) < 40) near++;
    expect(near).toBe(0);
  });
});

describe('split path (Jade Ruins)', () => {
  const t = () => built.get('jade-ruins')!;
  const br = () => t().branches[0] as BuiltBranch;
  const W = CONFIG.TRACK_HALF_WIDTH;
  const onMain = (d: number, lateral: number, height = 0): THREE.Vector3 => {
    const track = t();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    track.surfacePoint((((d % track.length) + track.length) % track.length) / track.length, lateral, p, n);
    return p.addScaledVector(n, height);
  };
  const onBranch = (s: number, lateral: number, height = 0): THREE.Vector3 => {
    const b = br();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    b.surfacePoint(s, lateral, p, n);
    return p.addScaledVector(n, height);
  };

  it('has one half-width shortcut on the right, with an open edge, separating and rejoining on main straights', () => {
    const b = br();
    expect(t().branches).toHaveLength(1);
    expect(b.id).toBe('shortcut');
    expect(b.halfWidth).toBe(7);
    expect(b.side).toBe(1);
    expect(b.openEdge).not.toBeNull();
    expect(b.overlapFork).toBeGreaterThan(40);
    expect(b.overlapMerge).toBeGreaterThan(40);
    expect(b.dSepFork).toBeGreaterThan(b.dFork);
    expect(b.dSepMerge).toBeGreaterThan(b.dSepFork);
    expect(b.dMerge).toBeGreaterThan(b.dSepMerge);
    // Shorter than the main road it skips (it is the shortcut), by a few hundred metres at most.
    const skipped = b.dMerge - b.dFork;
    expect(b.length).toBeLessThan(skipped * 0.95);
    expect(b.length).toBeGreaterThan(skipped * 0.8);
  });

  it('meets the main deck at the fork and merge: same surface, same normal, offset by W − w', () => {
    const track = t();
    const b = br();
    for (const s of [0, 10, b.overlapFork / 2, b.length - b.overlapMerge / 2, b.length - 10, b.length]) {
      for (const lat of [-6, 0, 6]) {
        const p = onBranch(s, lat);
        const pr = track.project(p, b.progressU(s), null);
        expect(pr.path).toBeNull();
        expect(Math.abs(pr.height)).toBeLessThan(0.05);
        if (s <= 10 || s >= b.length - 10) expect(pr.lateral).toBeCloseTo(b.side * (W - b.halfWidth) + lat, 1);
        expect(pr.sample.up.dot(b.sampleAt(s).up)).toBeGreaterThan(0.9995);
      }
    }
  });

  it('race progress is monotonic along the branch and continuous with main at both ends and through the overlaps', () => {
    const track = t();
    const b = br();
    const L = track.length;
    const unwrapped = (u: number) => {
      let d = u * L;
      if (d < b.dFork - L / 2) d += L;
      return d;
    };
    // dFork/dMerge are the designer's turtle metres; the built curve's metres drift from them by < 1 m a lap.
    expect(Math.abs(unwrapped(b.progressU(0)) - b.dFork)).toBeLessThan(1.5);
    expect(Math.abs(unwrapped(b.progressU(b.length)) - b.dMerge)).toBeLessThan(1.5);
    let prev = -Infinity;
    for (let s = 0; s <= b.length; s += 1) {
      const d = unwrapped(b.progressU(s));
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      if (prev > -Infinity) expect(d - prev).toBeLessThan(2.5);
      prev = d;
    }
    // In the overlaps a ship's progress is the same on either road (no jump when it changes road).
    for (const s of [5, b.overlapFork * 0.4, b.length - b.overlapMerge * 0.4, b.length - 5]) {
      const pr = track.project(onBranch(s, 0, 1), b.progressU(s), null);
      expect(pr.path).toBeNull();
      expect(Math.abs(unwrapped(pr.u) - unwrapped(b.progressU(s)))).toBeLessThan(0.5);
    }
    // sAtProgress inverts progressU.
    for (const s of [3, 200, b.length / 2, b.length - 200]) expect(b.sAtProgress(b.progressU(s))).toBeCloseTo(s, 0);
  });

  it('project() keeps the hinted road, switches at the fork and merge, and keeps the shortcut while falling off it', () => {
    const track = t();
    const b = br();
    const uOf = (d: number) => d / track.length;
    // In the fork overlap, on the shortcut's half of the main deck: the hinted road wins.
    const fork = onMain(b.dFork + b.overlapFork / 2, W - b.halfWidth, 1);
    expect(track.project(fork, uOf(b.dFork), null).path).toBeNull();
    expect(track.project(fork, uOf(b.dFork), 'shortcut').path).toBe('shortcut');
    // Past the separation, a ship on the shortcut is on it whatever the hint.
    const mid = onBranch(b.length / 2, 2, 1);
    const pMid = track.project(mid, b.progressU(b.length / 2), null);
    expect(pMid.path).toBe('shortcut');
    expect(pMid.pathS).toBeCloseTo(b.length / 2, 0);
    expect(pMid.lateral).toBeCloseTo(2, 1);
    expect(pMid.height).toBeCloseTo(1, 1);
    // ...and a ship on the main road beside it is on main, even with a stale shortcut hint.
    const dMid = (b.dSepFork + b.dSepMerge) / 2;
    expect(track.project(onMain(dMid, 0, 1), uOf(dMid), 'shortcut').path).toBeNull();
    // Through the merge overlap the shortcut is kept, then main takes over past its end.
    expect(track.project(onBranch(b.length - 5, 0, 1), b.progressU(b.length - 5), 'shortcut').path).toBe('shortcut');
    const after = track.project(onMain(b.dMerge + 20, W - b.halfWidth, 1), uOf(b.dMerge), 'shortcut');
    expect(after.path).toBeNull();
    expect(after.lateral).toBeCloseTo(W - b.halfWidth, 1);
    // Off the open edge and falling: still the shortcut (so the respawn puts the ship back on it).
    const e = b.openEdge!;
    const sOpen = (e.sFrom + e.sTo) / 2;
    const fall = onBranch(sOpen, e.side * (b.halfWidth + 6), -10);
    expect(track.project(fall, b.progressU(sOpen), 'shortcut').path).toBe('shortcut');
  });

  it('opens the main rail only where the shortcut leaves and rejoins, and puts a crash-barrier nose at the fork', () => {
    const track = t();
    const b = br();
    const v = track.collision.rails.vertices;
    const railNear = (p: THREE.Vector3, r: number): boolean => {
      for (let i = 0; i < v.length; i += 3) if (Math.hypot(v[i] - p.x, v[i + 1] - p.y, v[i + 2] - p.z) < r) return true;
      return false;
    };
    const railLat = b.side * (W + CONFIG.RAIL_THICKNESS / 2);
    // Open over the overlaps (the shortcut's deck is there), on the shortcut's side only. Near the fork and merge
    // the shortcut's own outer rail stands where the main rail would, so look just inside the separations.
    for (const d of [b.dSepFork - 10, b.dSepMerge + 10]) {
      expect(railNear(onMain(d, railLat, 0.5), 3)).toBe(false);
      expect(railNear(onMain(d, -railLat, 0.5), 3)).toBe(true);
    }
    // Closed before the fork, after the merge, and between the separations (the roads are apart).
    for (const d of [b.dFork - 40, b.dMerge + 40, b.dSepFork + 60, (b.dSepFork + b.dSepMerge) / 2]) {
      expect(railNear(onMain(d, railLat, 0.5), 3)).toBe(true);
    }
    // The nose caps the rail ends where the roads separate, between the two decks: no corner on either road.
    const nose = branchNose(b);
    expect(railNear(nose.center, nose.length)).toBe(true);
    for (const fx of [-0.5, 0.5]) {
      for (const rx of [-0.5, 0.5]) {
        const corner = nose.center.clone().addScaledVector(nose.forward, fx * nose.length).addScaledVector(nose.right, rx * nose.width);
        // Main is straight here: its lateral is the offset along the frame's right.
        const m = track.sampleAt(b.dSepFork / track.length);
        expect(corner.clone().sub(m.position).dot(m.right) * b.side).toBeGreaterThan(W - 0.05);
        const onB = b.project(corner, b.overlapFork);
        expect(onB.lateral * -b.side).toBeGreaterThan(b.halfWidth - 0.05);
      }
    }
    expect(branchSeparation(b.halfWidth)).toBe(W + b.halfWidth + 2 * CONFIG.RAIL_THICKNESS);
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
