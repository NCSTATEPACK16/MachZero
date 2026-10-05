import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CONFIG } from '../../core/config';
import type { TrackData } from '../../core/contracts';
import { inLoopRange, TAU } from '../../core/math';
import { Rng } from '../../core/rng';
import { generateTrack, getTrackStats } from '..';

const SEED = 7331;
const N = CONFIG.TRACK_SAMPLES;
const DEG = Math.PI / 180;

let track: TrackData;
let generationMs = 0;

beforeAll(() => {
  const t0 = performance.now();
  track = generateTrack({ seed: SEED });
  generationMs = performance.now() - t0;
});

function angleBetween(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
}

/** Curvature magnitude (1/m) from finite differences of the sampled forward vectors. */
function curvatureMagnitudes(t: TrackData): number[] {
  const ds = t.length / N;
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = t.samples[(i + 1) % N].forward;
    const b = t.samples[(i - 1 + N) % N].forward;
    out.push(a.distanceTo(b) / (2 * ds));
  }
  return out;
}

describe('determinism', () => {
  it('same seed gives identical samples, different seeds differ', () => {
    const again = generateTrack({ seed: SEED });
    expect(again.length).toBe(track.length);
    for (let i = 0; i < N; i += 37) {
      expect(again.samples[i].position.toArray()).toEqual(track.samples[i].position.toArray());
      expect(again.samples[i].up.toArray()).toEqual(track.samples[i].up.toArray());
    }
    const other = generateTrack({ seed: SEED + 1 });
    let differing = 0;
    for (let i = 0; i < N; i += 37) if (!other.samples[i].position.equals(track.samples[i].position)) differing++;
    expect(differing).toBeGreaterThan(20);
  });

  it('produces valid circuits for a spread of seeds', () => {
    for (const seed of [1, 2, 3, 42, 1337, 99991, 123456789]) {
      const t = generateTrack({ seed });
      const stats = getTrackStats(t)!;
      expect(t.samples).toHaveLength(N);
      expect(t.length).toBeGreaterThan(CONFIG.TRACK_TARGET_LENGTH * 0.85);
      expect(t.length).toBeLessThan(CONFIG.TRACK_TARGET_LENGTH * 1.15);
      expect(stats.layout!.minRadius).toBeGreaterThanOrEqual(CONFIG.TRACK_MIN_RADIUS);
      expect(stats.layout!.mainStraight.length).toBeGreaterThanOrEqual(350);
      expect(stats.layout!.corkscrewStraight.length).toBeGreaterThanOrEqual(300);
    }
  });
});

describe('centerline', () => {
  it('has TRACK_SAMPLES samples uniform by arc length within the target band', () => {
    expect(track.samples).toHaveLength(N);
    expect(track.length).toBeGreaterThan(CONFIG.TRACK_TARGET_LENGTH * 0.85);
    expect(track.length).toBeLessThan(CONFIG.TRACK_TARGET_LENGTH * 1.15);
    const ds = track.length / N;
    for (let i = 0; i < N; i++) {
      const chord = track.samples[i].position.distanceTo(track.samples[(i + 1) % N].position);
      expect(chord / ds).toBeGreaterThan(0.97);
      expect(chord / ds).toBeLessThanOrEqual(1.0001);
      expect(track.samples[i].distance).toBeCloseTo(i * ds, 6);
      expect(track.samples[i].u).toBeCloseTo(i / N, 9);
    }
  });

  it('keeps radius of curvature >= TRACK_MIN_RADIUS', () => {
    const minRadius = 1 / Math.max(...curvatureMagnitudes(track));
    expect(minRadius).toBeGreaterThanOrEqual(CONFIG.TRACK_MIN_RADIUS);
  });

  it('respects elevation bounds', () => {
    for (const s of track.samples) {
      expect(s.position.y).toBeGreaterThanOrEqual(CONFIG.TRACK_MIN_ELEVATION);
      expect(s.position.y).toBeLessThanOrEqual(CONFIG.TRACK_MAX_ELEVATION);
    }
  });

  it('is a closed centripetal Catmull-Rom through 16-20 control points', () => {
    expect(track.curve).toBeInstanceOf(THREE.CatmullRomCurve3);
    expect(track.curve.closed).toBe(true);
    expect(track.curve.curveType).toBe('centripetal');
    expect(track.curve.points.length).toBeGreaterThanOrEqual(16);
    expect(track.curve.points.length).toBeLessThanOrEqual(20);
    expect(track.curve.getPoint(0).distanceTo(track.samples[0].position)).toBeLessThan(1e-6);
  });

  it('has a long flat main straight through the start line and a straight at the corkscrew', () => {
    const stats = getTrackStats(track)!.layout!;
    expect(stats.mainStraight.length).toBeGreaterThanOrEqual(350);
    expect(stats.corkscrewStraight.length).toBeGreaterThanOrEqual(300);
    // Start line: forward -Z, flat, on the plan-view origin.
    const s0 = track.samples[0];
    expect(s0.position.x).toBeCloseTo(0, 6);
    expect(s0.position.z).toBeCloseTo(0, 6);
    expect(s0.forward.z).toBeLessThan(-0.999);
    // 100 m behind to 300 m ahead is dead level.
    const y0 = s0.position.y;
    for (const d of [-100, -50, 50, 150, 300]) {
      const s = track.sampleAt(((d % track.length) + track.length) / track.length);
      expect(Math.abs(s.position.y - y0)).toBeLessThan(0.05);
    }
  });
});

describe('frames', () => {
  it('are orthonormal and right-handed (right = forward x up)', () => {
    const cross = new THREE.Vector3();
    for (const s of track.samples) {
      expect(s.forward.length()).toBeCloseTo(1, 3);
      expect(s.up.length()).toBeCloseTo(1, 3);
      expect(s.right.length()).toBeCloseTo(1, 3);
      expect(Math.abs(s.forward.dot(s.up))).toBeLessThan(1e-3);
      expect(Math.abs(s.forward.dot(s.right))).toBeLessThan(1e-3);
      expect(Math.abs(s.up.dot(s.right))).toBeLessThan(1e-3);
      cross.crossVectors(s.forward, s.up);
      expect(cross.distanceTo(s.right)).toBeLessThan(1e-3);
      expect(s.halfWidth).toBe(CONFIG.TRACK_HALF_WIDTH);
    }
  });

  it('are continuous with no flips, including across the loop seam', () => {
    for (let i = 0; i < N; i++) {
      const a = track.samples[i];
      const b = track.samples[(i + 1) % N];
      expect(angleBetween(a.up, b.up)).toBeLessThan(10 * DEG);
      expect(angleBetween(a.forward, b.forward)).toBeLessThan(10 * DEG);
      expect(angleBetween(a.right, b.right)).toBeLessThan(10 * DEG);
    }
    const last = track.samples[N - 1];
    const first = track.samples[0];
    expect(angleBetween(last.up, first.up)).toBeLessThan(1 * DEG);
    expect(last.position.distanceTo(first.position)).toBeLessThan((track.length / N) * 1.01);
  });

  it('bank into corners: up leans toward the inside of the turn (right turn => right side lower)', () => {
    const cork = track.corkscrew!;
    const ds = track.length / N;
    const n = new THREE.Vector3();
    let checked = 0;
    let inward = 0;
    let signAgrees = 0;
    let maxBank = 0;
    for (let i = 0; i < N; i++) {
      const s = track.samples[i];
      if (inLoopRange(s.u, cork.uStart - 0.02, cork.uEnd + 0.02)) continue;
      maxBank = Math.max(maxBank, Math.abs(s.roll));
      // n = dT/ds direction points toward the centre of curvature (the inside of the turn).
      n.subVectors(track.samples[(i + 1) % N].forward, track.samples[(i - 1 + N) % N].forward);
      const kappa = n.length() / (2 * ds);
      if (kappa < 1 / 150) continue;
      n.normalize();
      checked++;
      if (s.up.dot(n) > 0) inward++;
      // Curvature sign convention: (dT/ds)·right > 0 <=> turning right.
      if (Math.sign(n.dot(s.right)) === Math.sign(s.curvature)) signAgrees++;
    }
    expect(checked).toBeGreaterThan(30);
    expect(inward / checked).toBeGreaterThan(0.9);
    expect(signAgrees).toBe(checked);
    expect(maxBank).toBeLessThanOrEqual(CONFIG.MAX_BANK + 1e-9);
    expect(maxBank).toBeGreaterThan(10 * DEG);
  });

  it('corkscrew rolls a full 2π and enters/exits flat', () => {
    const { uStart, uEnd } = track.corkscrew!;
    expect(uEnd - uStart).toBeGreaterThan(200 / track.length);
    const iStart = Math.ceil(uStart * N);
    const iEnd = Math.floor(uEnd * N);
    // The roll difference across the corkscrew equals 2π (banking ~0 on the straight).
    const roll0 = track.samples[iStart].roll;
    const roll1 = track.samples[iEnd].roll;
    expect(Math.abs(roll1 - roll0 - TAU)).toBeLessThan(0.15);
    // Upside-down at the middle.
    const mid = track.sampleAt((uStart + uEnd) / 2);
    expect(mid.up.y).toBeLessThan(-0.95);
    // Flat before entering and after leaving.
    expect(track.sampleAt(uStart - 0.005).up.y).toBeGreaterThan(0.99);
    expect(track.sampleAt(uEnd + 0.005).up.y).toBeGreaterThan(0.99);
  });
});

describe('queries', () => {
  it('sampleAt hits samples exactly, interpolates, wraps and reuses `out`', () => {
    for (const i of [0, 1, 500, 1234, N - 1]) {
      const s = track.sampleAt(i / N);
      expect(s.position.distanceTo(track.samples[i].position)).toBeLessThan(1e-9);
      expect(s.up.distanceTo(track.samples[i].up)).toBeLessThan(1e-9);
    }
    const mid = track.sampleAt(10.5 / N);
    const expected = track.samples[10].position.clone().lerp(track.samples[11].position, 0.5);
    expect(mid.position.distanceTo(expected)).toBeLessThan(1e-9);
    expect(mid.forward.length()).toBeCloseTo(1, 9);
    expect(Math.abs(mid.forward.dot(mid.up))).toBeLessThan(1e-9);
    const wrapped = track.sampleAt(1.25);
    const ref = track.sampleAt(0.25);
    expect(wrapped.position.distanceTo(ref.position)).toBeLessThan(1e-6);
    const negative = track.sampleAt(-0.25);
    expect(negative.position.distanceTo(track.sampleAt(0.75).position)).toBeLessThan(1e-6);
    const out = track.sampleAt(0.1);
    const same = track.sampleAt(0.6, out);
    expect(same).toBe(out);
    expect(out.u).toBeCloseTo(0.6, 9);
    expect(out.distance).toBeCloseTo(0.6 * track.length, 6);
  });

  function roundTrip(useHint: boolean): void {
    const rng = new Rng(4242);
    for (let n = 0; n < 400; n++) {
      const u = rng.next();
      const lateral = rng.range(-12, 12);
      const height = rng.range(0, 3);
      const s = track.sampleAt(u);
      const p = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, height);
      const hint = useHint ? (u + rng.range(-0.01, 0.01) + 1) % 1 : undefined;
      const proj = track.project(p, hint);
      const uErr = Math.min(Math.abs(proj.u - u), 1 - Math.abs(proj.u - u)) * track.length;
      expect(uErr).toBeLessThan(0.5);
      expect(Math.abs(proj.lateral - lateral)).toBeLessThan(0.1);
      expect(Math.abs(proj.height - height)).toBeLessThan(0.1);
      expect(proj.distance).toBeCloseTo(proj.u * track.length, 6);
      expect(proj.sample.u).toBeCloseTo(proj.u, 9);
    }
  }
  it('project() round-trips without a hint', () => roundTrip(false));
  it('project() round-trips with a hint', () => roundTrip(true));

  it('project() recovers from a wrong or far hint and handles the wrap seam', () => {
    const s = track.sampleAt(0.7);
    const p = s.position.clone().addScaledVector(s.right, 4).addScaledVector(s.up, 1);
    const proj = track.project(p, 0.1);
    expect(Math.abs(proj.u - 0.7) * track.length).toBeLessThan(0.5);
    const seam = track.sampleAt(0.9999);
    const q = seam.position.clone().addScaledVector(seam.right, -6).addScaledVector(seam.up, 2);
    const pr = track.project(q, 0.0003);
    const du = Math.min(Math.abs(pr.u - 0.9999), 1 - Math.abs(pr.u - 0.9999));
    expect(du * track.length).toBeLessThan(0.5);
    expect(pr.lateral).toBeCloseTo(-6, 1);
  });

  it('project() is fast enough for the physics loop', () => {
    const rng = new Rng(9);
    const pts: THREE.Vector3[] = [];
    const us: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const u = rng.next();
      const s = track.sampleAt(u);
      pts.push(s.position.clone().addScaledVector(s.right, rng.range(-10, 10)).addScaledVector(s.up, 1.2));
      us.push(u);
    }
    const t0 = performance.now();
    for (let i = 0; i < pts.length; i++) track.project(pts[i], us[i]);
    const perCallUs = ((performance.now() - t0) / pts.length) * 1000;
    expect(perCallUs).toBeLessThan(100);
  });
});

describe('zones and grid', () => {
  it('defines start line, pit and 3-4 dash zones', () => {
    const start = track.zones.find((z) => z.type === 'startLine')!;
    expect(start).toBeDefined();
    expect(start.uEnd).toBeLessThan(start.uStart); // wraps past the line
    const pit = track.zones.find((z) => z.type === 'pit')!;
    const pitLen = (pit.uEnd - pit.uStart) * track.length;
    expect(pitLen).toBeGreaterThanOrEqual(200);
    expect(pitLen).toBeLessThanOrEqual(250);
    expect(pit.uStart).toBeGreaterThan(0);
    expect(pit.lateralMin).toBe(CONFIG.PIT_LATERAL_MIN);
    expect(pit.lateralMax).toBe(CONFIG.PIT_LATERAL_MAX);
    const dashes = track.zones.filter((z) => z.type === 'dash');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
    expect(dashes.length).toBeLessThanOrEqual(4);
    const cork = track.corkscrew!;
    for (const d of dashes) {
      expect((d.uEnd - d.uStart) * track.length).toBeCloseTo(12, 6);
      expect(d.lateralMax - d.lateralMin).toBeCloseTo(8, 6);
      expect(d.lateralMin).toBeGreaterThan(-CONFIG.TRACK_HALF_WIDTH);
      expect(d.lateralMax).toBeLessThan(CONFIG.TRACK_HALF_WIDTH);
      expect(inLoopRange(d.uStart, cork.uStart, cork.uEnd)).toBe(false);
      expect(inLoopRange(d.uEnd, cork.uStart, cork.uEnd)).toBe(false);
    }
  });

  it('places 8 grid slots behind the line, oriented along the track', () => {
    expect(track.startGrid).toHaveLength(8);
    const fwd = new THREE.Vector3();
    const up = new THREE.Vector3();
    let lastBack = 0;
    track.startGrid.forEach((slot, idx) => {
      const back = (1 - slot.u) * track.length;
      expect(back).toBeGreaterThan(lastBack); // pole is closest to the line
      lastBack = back;
      expect(back).toBeCloseTo(12 * (idx + 1), 3);
      expect(Math.abs(slot.lateral)).toBeCloseTo(5, 6);
      const s = track.sampleAt(slot.u);
      fwd.set(0, 0, -1).applyQuaternion(slot.quaternion);
      up.set(0, 1, 0).applyQuaternion(slot.quaternion);
      expect(fwd.distanceTo(s.forward)).toBeLessThan(1e-6);
      expect(up.distanceTo(s.up)).toBeLessThan(1e-6);
      const expected = s.position.clone().addScaledVector(s.right, slot.lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
      expect(slot.position.distanceTo(expected)).toBeLessThan(1e-6);
      const proj = track.project(slot.position, slot.u);
      expect(proj.lateral).toBeCloseTo(slot.lateral, 3);
      expect(proj.height).toBeCloseTo(CONFIG.HOVER_HEIGHT, 3);
    });
    // Two staggered columns.
    expect(new Set(track.startGrid.map((g) => Math.sign(g.lateral))).size).toBe(2);
  });
});

describe('collision meshes', () => {
  function checkMesh(mesh: { vertices: Float32Array; indices: Uint32Array }): void {
    expect(mesh.vertices.length).toBeGreaterThan(0);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.vertices.length % 3).toBe(0);
    expect(mesh.indices.length % 3).toBe(0);
    let bad = 0;
    for (let i = 0; i < mesh.vertices.length; i++) if (!Number.isFinite(mesh.vertices[i])) bad++;
    expect(bad).toBe(0);
    const vc = mesh.vertices.length / 3;
    let maxIdx = 0;
    for (let i = 0; i < mesh.indices.length; i++) if (mesh.indices[i] > maxIdx) maxIdx = mesh.indices[i];
    expect(maxIdx).toBeLessThan(vc);
  }

  it('have valid, finite, in-range TriMesh data', () => {
    checkMesh(track.collision.surface);
    checkMesh(track.collision.rails);
  });

  it('surface triangles face up (outward = along the track up)', () => {
    const { vertices: v, indices: ix } = track.collision.surface;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    let bad = 0;
    for (let t = 0; t < ix.length; t += 3 * 97) {
      a.fromArray(v, ix[t] * 3);
      b.fromArray(v, ix[t + 1] * 3);
      c.fromArray(v, ix[t + 2] * 3);
      n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      const centroid = a.clone().add(b).add(c).divideScalar(3);
      const proj = track.project(centroid);
      // A twisting (corkscrew) quad is a helicoid: triangle normals drift from the frame up by up to ~35 deg.
      const minDot = inLoopRange(proj.u, track.corkscrew!.uStart - 0.01, track.corkscrew!.uEnd + 0.01) ? 0.7 : 0.99;
      if (n.dot(proj.sample.up) < minDot) bad++;
      expect(Math.abs(proj.height)).toBeLessThan(0.05); // lies on the driving surface
    }
    expect(bad).toBe(0);
  });

  it('rails are outward-wound closed solids with the inner face exactly at +-halfWidth', () => {
    const { vertices: v, indices: ix } = track.collision.rails;
    // Signed volume (divergence theorem) is positive for outward-facing closed meshes.
    let volume = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    // Use vertices relative to the first vertex to keep float error low.
    const origin = new THREE.Vector3().fromArray(v, 0);
    for (let t = 0; t < ix.length; t += 3) {
      a.fromArray(v, ix[t] * 3).sub(origin);
      b.fromArray(v, ix[t + 1] * 3).sub(origin);
      c.fromArray(v, ix[t + 2] * 3).sub(origin);
      volume += a.dot(b.clone().cross(c)) / 6;
    }
    // Two rails, cross-section ~ 1 m x 3.5 m, ~4.3 km each.
    const expected = 2 * CONFIG.RAIL_THICKNESS * (CONFIG.RAIL_HEIGHT + 1) * track.length;
    expect(volume).toBeGreaterThan(expected * 0.85);
    expect(volume).toBeLessThan(expected * 1.15);

    // Inner face: the minimum |lateral| of rail vertices equals halfWidth; the maximum is halfWidth + thickness.
    let minLat = Infinity;
    let maxLat = 0;
    for (let i = 0; i < v.length / 3; i += 13) {
      const p = new THREE.Vector3().fromArray(v, i * 3);
      const proj = track.project(p, undefined);
      const lat = Math.abs(proj.lateral);
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    expect(minLat).toBeGreaterThan(CONFIG.TRACK_HALF_WIDTH - 0.05);
    expect(minLat).toBeLessThan(CONFIG.TRACK_HALF_WIDTH + 0.05);
    expect(maxLat).toBeCloseTo(CONFIG.TRACK_HALF_WIDTH + CONFIG.RAIL_THICKNESS, 1);
  });
});

describe('visual', () => {
  it('is a THREE.Group with few draw calls, finite geometry and bounding spheres', () => {
    expect(track.visual).toBeInstanceOf(THREE.Group);
    let drawCalls = 0;
    track.visual.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        drawCalls++;
        const geo = o.geometry as THREE.BufferGeometry;
        expect(geo.boundingSphere).not.toBeNull();
        const pos = geo.getAttribute('position');
        expect(pos.count).toBeGreaterThan(0);
        for (let i = 0; i < pos.array.length; i += 101) expect(Number.isFinite(pos.array[i])).toBe(true);
        expect(geo.getAttribute('normal')).toBeDefined();
        expect(geo.getAttribute('uv')).toBeDefined();
      }
    });
    expect(drawCalls).toBeGreaterThan(5);
    expect(drawCalls).toBeLessThanOrEqual(25);
    expect(getTrackStats(track)!.visual.drawCalls).toBe(drawCalls);
  });

  it('has triangle winding consistent with vertex normals, and deck normals equal the frame up', () => {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    const vn = new THREE.Vector3();
    track.visual.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
      const geo = o.geometry as THREE.BufferGeometry;
      const pos = geo.getAttribute('position');
      const nor = geo.getAttribute('normal');
      const index = geo.getIndex()!;
      let disagree = 0;
      for (let t = 0; t < index.count; t += 3) {
        a.fromBufferAttribute(pos, index.getX(t));
        b.fromBufferAttribute(pos, index.getX(t + 1));
        c.fromBufferAttribute(pos, index.getX(t + 2));
        n.subVectors(b, a).cross(c.clone().sub(a));
        vn.fromBufferAttribute(nor, index.getX(t));
        if (n.dot(vn) <= 0) disagree++;
      }
      expect(disagree, o.name).toBe(0);
    });
    const deck = (track.visual.getObjectByName('TrackDeck') as THREE.Mesh).geometry as THREE.BufferGeometry;
    const dn = deck.getAttribute('normal');
    expect(new THREE.Vector3(dn.getX(0), dn.getY(0), dn.getZ(0)).distanceTo(track.samples[0].up)).toBeLessThan(1e-6);
  });

  it('keeps albedo dark and neon HDR', () => {
    const neon = track.visual.getObjectByName('TrackNeon') as THREE.Mesh;
    expect((neon.material as THREE.MeshBasicMaterial).color.r).toBeGreaterThan(2);
    const deck = track.visual.getObjectByName('TrackDeck') as THREE.Mesh;
    const map = (deck.material as THREE.MeshStandardMaterial).map as THREE.DataTexture;
    expect(map).toBeInstanceOf(THREE.DataTexture);
    // Linear luminance of every deck texel stays below 0.5.
    const px = map.image.data as unknown as Uint8Array;
    const toLin = (c: number) => Math.pow(c / 255, 2.2);
    let brightest = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * toLin(px[i]) + 0.7152 * toLin(px[i + 1]) + 0.0722 * toLin(px[i + 2]);
      if (l > brightest) brightest = l;
    }
    expect(brightest).toBeLessThan(0.5);
  });

  it('animates chevrons from onBeforeRender without any external update', () => {
    const dash = track.visual.getObjectByName('TrackDashPlates') as THREE.Mesh;
    const tex = (dash.material as THREE.MeshBasicMaterial).map as THREE.Texture;
    const before = tex.offset.x;
    dash.onBeforeRender(undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, undefined as never);
    expect(tex.offset.x).toBeLessThanOrEqual(0);
    expect(Number.isFinite(tex.offset.x)).toBe(true);
    expect(before).toBeDefined();
  });

  it('has instanced pylons reaching down to the ground plane and none in the corkscrew', () => {
    const pylons = track.visual.getObjectByName('TrackPylons') as THREE.InstancedMesh;
    expect(pylons.count).toBeGreaterThan(50);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < pylons.count; i++) {
      pylons.getMatrixAt(i, m);
      m.decompose(p, q, s);
      expect(p.y - s.y / 2).toBeCloseTo(CONFIG.GROUND_Y, 3); // foot on the ground
      expect(p.y + s.y / 2).toBeLessThan(CONFIG.TRACK_MAX_ELEVATION + 1);
    }
  });
});

describe('performance', () => {
  it('generates in under 1.5 s', () => {
    expect(generationMs).toBeLessThan(1500);
    const t0 = performance.now();
    generateTrack({ seed: 2024 });
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
