import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { describe, expect, it } from 'vitest';
import type { Loadout } from '../../core/contracts';
import type { ShipAssets } from '../../assets/AssetLoader';
import { CHASSIS } from '../../content/ships';
import { assembleShip, mergeByMaterial } from '../ShipAssembly';

const root = resolve(import.meta.dirname, '../../..');

async function loadGlb(path: string): Promise<GLTF> {
  const buf = readFileSync(resolve(root, 'public/game', path));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(ab, '');
}

let assetsP: Promise<ShipAssets> | null = null;
function assets(): Promise<ShipAssets> {
  assetsP ??= (async () => {
    await MeshoptDecoder.ready;
    const parts = await loadGlb('parts/parts.glb');
    const ships = new Map<string, GLTF>();
    for (const c of CHASSIS) ships.set(c.id, await loadGlb(`ships/${c.id}.glb`));
    return { parts, ships, trim: null };
  })();
  return assetsP;
}

function stats(obj: THREE.Object3D) {
  obj.updateWorldMatrix(true, true);
  let meshes = 0;
  let tris = 0;
  const box = new THREE.Box3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    box.expandByObject(m, true);
  });
  return { meshes, tris, box };
}

const loadout = (chassisId: string, t: 0 | 1 | 2 | 3): Loadout => ({
  chassisId,
  parts: { engine: t, booster: t, stabilizer: t, hull: t },
  livery: { primary: 0x2266ff, secondary: 0xffffff, glow: 0x22ffff, decal: 0 },
});

describe('ShipAssembly merge (§V.7 step 1: rivals bake their parts into the chassis)', () => {
  it('mergeByMaterial dequantises, transforms and flips mirrored winding', () => {
    const mat = new THREE.MeshBasicMaterial();
    const geo = new THREE.BufferGeometry();
    // a normalised Int16 position attribute, like meshopt quantisation leaves
    geo.setAttribute('position', new THREE.BufferAttribute(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    geo.setIndex([0, 1, 2]);
    const a = new THREE.Mesh(geo, mat);
    const b = new THREE.Mesh(geo, mat);
    const mirror = new THREE.Matrix4().makeScale(-2, 2, 2);
    const out = mergeByMaterial([
      { mesh: a, matrix: new THREE.Matrix4(), part: false },
      { mesh: b, matrix: mirror, part: true },
    ]);
    const g = out.get(mat)!;
    expect(g.attributes.position.count).toBe(6);
    expect(g.attributes.position.getX(4)).toBeCloseTo(-2, 3);
    expect(Array.from(g.index!.array)).toEqual([0, 1, 2, 3, 5, 4]);
    // part vertices carry body coordinates outside every decal mask
    expect(g.attributes.color.getX(3)).toBe(0);
    expect(g.attributes.color.getZ(3)).toBeCloseTo(0.51);
    expect(g.attributes.color.getW(3)).toBe(1);
  });

  it.each(CHASSIS.map((c) => c.id))('%s: the merged rival has ≤ 6 meshes and the same triangles and bounds', async (id) => {
    const a = await assets();
    for (const t of [0, 3] as const) {
      for (const lod of [0, 1] as const) {
        const plain = assembleShip(a, loadout(id, t), lod)!;
        const merged = assembleShip(a, loadout(id, t), lod, { merge: true })!;
        const s0 = stats(plain.root);
        const s1 = stats(merged.root);
        expect(s1.meshes).toBeLessThanOrEqual(6);
        expect(s1.tris).toBe(s0.tris);
        expect(s1.box.min.distanceTo(s0.box.min)).toBeLessThan(1e-3);
        expect(s1.box.max.distanceTo(s0.box.max)).toBeLessThan(1e-3);
        plain.dispose();
        merged.dispose();
      }
    }
  });
});
