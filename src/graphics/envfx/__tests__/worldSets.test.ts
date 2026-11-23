/**
 * The effect sets of the five 2.0 worlds (SPEC §10.3, IMPLEMENTATION §X2 for Neon Bay and §X7 for the rest): each
 * world declares the set the design names, stays inside the draw-call budget on every preset (its set pieces
 * counted from its own props.glb), and keeps its drifting set pieces well clear of the track corridor.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../../core/config';
import { TRACK_DEFS } from '../../../content/tracks';
import { trackFromSource } from '../../../track';
import { createFogUniforms } from '../../shaders/fog';
import { createTheme } from '../../themes';
import { nearestTrack, planBounds, trackPlan } from '../../themes/WorldTheme';
import { ENVFX_MAX_DRAW_CALLS, resolveEnvFx, type EnvFxSpec } from '../EnvFxSpec';

/** The track corridor (m from the centre line) that scenery stays out of. */
const CORRIDOR = 80;

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface Gltf {
  nodes: GltfNode[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { min?: number[]; max?: number[]; componentType: number; normalized?: boolean }[];
}

/** The JSON chunk of a GLB (no decoding needed: names, meshes, primitives and accessor bounds). */
function readGlb(world: string): Gltf {
  const buf = readFileSync(`public/game/worlds/${world}/props.glb`);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as Gltf;
}

/** Draw calls of one instance of a prop (one per primitive, i.e. per role) and its half-width in plan (m). */
function propInfo(gltf: Gltf, name: string): { meshes: number; halfWidth: number } {
  const root = gltf.nodes.findIndex((n) => n.name === name);
  expect(root, `props.glb has "${name}"`).toBeGreaterThanOrEqual(0);
  let meshes = 0;
  let half = 0;
  const visit = (i: number, parent: THREE.Matrix4) => {
    const n = gltf.nodes[i];
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...((n.translation ?? [0, 0, 0]) as [number, number, number])),
      new THREE.Quaternion(...((n.rotation ?? [0, 0, 0, 1]) as [number, number, number, number])),
      new THREE.Vector3(...((n.scale ?? [1, 1, 1]) as [number, number, number])),
    );
    // The prop's own placement at the root is the set piece's to choose: measure from its origin.
    const m = i === root ? new THREE.Matrix4() : parent.clone().multiply(local);
    if (n.mesh !== undefined) {
      for (const prim of gltf.meshes[n.mesh].primitives) {
        meshes++;
        const a = gltf.accessors[prim.attributes.POSITION];
        // Quantised positions (KHR_mesh_quantization) are normalised integers: the node's scale undoes the rest.
        const k = a.normalized ? 1 / ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 } as Record<number, number>)[a.componentType] : 1;
        for (const x of [a.min![0] * k, a.max![0] * k])
          for (const y of [a.min![1] * k, a.max![1] * k])
            for (const z of [a.min![2] * k, a.max![2] * k]) {
              const p = new THREE.Vector3(x, y, z).applyMatrix4(m);
              half = Math.max(half, Math.hypot(p.x, p.z));
            }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  visit(root, new THREE.Matrix4());
  return { meshes, halfWidth: half };
}

const WORLDS = ['neon-bay', 'sunset-mesa', 'cryo-station', 'jade-ruins', 'orbital-ring'] as const;
const fog = createFogUniforms(0, 0.001);
const spec = (world: string): EnvFxSpec => createTheme(world, fog).envfx ?? {};

describe('the 2.0 worlds each have their effect set (SPEC §10.3)', () => {
  it('Neon Bay: rain, a wet-look deck, drifting airships', () => {
    const s = spec('neon-bay');
    expect(s.weather?.kind).toBe('rain');
    expect(s.wetDeck).toBeTruthy();
    expect(s.setPieces?.map((p) => p.prop)).toEqual(['airship_0']);
  });

  it('Sunset Mesa: blowing dust, light shafts, dust behind ships, dust devils on the desert floor', () => {
    const s = spec('sunset-mesa');
    expect(s.weather?.kind).toBe('dust');
    expect(s.weather!.wind[0] ** 2 + s.weather!.wind[1] ** 2).toBeGreaterThan(25); // it blows
    expect(s.shafts).toBeTruthy();
    expect(s.surface?.kind).toBe('dust');
    const devils = s.setPieces?.find((p) => p.prop === 'dustdevil_0');
    expect(devils?.spin).toBeGreaterThan(0);
    expect(devils?.bob).toBe(0);
    // Standing on the desert floor: the orbit's height is relative to the track's mean height.
    const track = trackFromSource({ kind: 'authored', def: TRACK_DEFS['sunset-mesa'] });
    const plan = trackPlan(track);
    let y = 0;
    for (let i = 1; i < plan.length; i += 3) y += plan[i];
    const base = y / (plan.length / 3) + devils!.height;
    expect(base).toBeGreaterThan(CONFIG.GROUND_Y - 8);
    expect(base).toBeLessThan(CONFIG.GROUND_Y + 1);
  });
});

describe.each(WORLDS)('%s: budget and clearance', (world) => {
  const s = spec(world);
  const gltf = readGlb(world);
  const pieces = (s.setPieces ?? []).map((p) => ({ p, ...propInfo(gltf, p.prop) }));

  it.each(['high', 'med', 'low'] as const)('%s: within the draw-call budget, counting each set piece from props.glb', (level) => {
    const plan = resolveEnvFx(s, level, false);
    const fixed = (plan.weather ? 1 : 0) + (plan.heightFog ? 1 : 0) + (plan.shafts ? 1 : 0);
    const setPieces = plan.setPieces.reduce((a, p) => a + pieces.find((x) => x.p.prop === p.prop)!.meshes, 0);
    expect(fixed + setPieces).toBeLessThanOrEqual(ENVFX_MAX_DRAW_CALLS);
  });

  it('every orbiting set piece stays well outside the track corridor', () => {
    const track = trackFromSource({ kind: 'authored', def: TRACK_DEFS[world] });
    const plan = trackPlan(track);
    const b = planBounds(plan);
    for (const { p, halfWidth } of pieces) {
      expect(p.path).toBe('orbit');
      let closest = Infinity;
      for (let k = 0; k < 720; k++) {
        const a = (k / 720) * Math.PI * 2;
        closest = Math.min(closest, nearestTrack(plan, b.cx + Math.cos(a) * p.radius, b.cz + Math.sin(a) * p.radius).dist);
      }
      expect(closest - halfWidth * (p.scale ?? 1), `${p.prop}: ${closest.toFixed(0)} m from the centre line, ${halfWidth.toFixed(0)} m wide`).toBeGreaterThan(CORRIDOR);
    }
  });
});
