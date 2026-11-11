/**
 * Builds a ship from the Blender GLBs: clones the chassis LOD, bolts the loadout's parts onto its sockets and
 * gives it per-ship livery materials (materials are named by role in the GLBs; see blender/lib/common.py).
 * The result is handed to ShipModel, which keeps v1's motion, glow, flames, flaps, pool and shield.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Loadout, PartSlot, PartTier, PartVariant } from '../core/contracts';
import { variantOf } from '../content/parts';
import type { ShipAssets, TrimMaps } from '../assets/AssetLoader';

/** Where v1's procedural effects attach, measured from the GLB sockets (ship-local, unscaled). */
export interface ShipLayout {
  podX: number;
  podR: number;
  /** Pod tail (three z, +Z = rear). */
  podZ1: number;
  nozzleY: number;
  hullHW: number;
}

export interface AssembledShip {
  root: THREE.Group;
  /** Glow meshes share this material; ShipModel drives its brightness. */
  glowMaterial: THREE.MeshBasicMaterial;
  glowColor: THREE.Color;
  layout: ShipLayout;
  /** Recolour in place (livery editor); the decal pattern included. */
  setLivery(livery: Loadout['livery']): void;
  dispose(): void;
}

export const DECAL_COUNT = 6;

/**
 * Decal masks from the body coordinates baked into COLOR_0 (R along 0 tail..1 nose, G across 0..1, B up 0..1):
 * 0 twin stripes · 1 chevrons · 2 two-tone split · 3 flame tongues · 4 checker band · 5 lightning bolt.
 */
const DECAL_GLSL = /* glsl */ `
uniform int uDecal;
uniform vec3 uDecalColor;
varying vec3 vBody;
float mzDecal(vec3 b) {
  float u = b.x, v = b.y - 0.5, w = b.z, av = abs(v);
  if (uDecal == 0) return step(0.045, av) * step(av, 0.1) * step(0.55, w);
  if (uDecal == 1) return step(0.5, fract(u * 7.0 + av * 5.0)) * step(0.62, w) * step(0.2, u) * step(u, 0.85);
  if (uDecal == 2) return step(w, 0.5);
  if (uDecal == 3) {
    float tongue = 0.62 + 0.08 * sin(av * 38.0) + 0.05 * sin(av * 91.0 + 1.3);
    return step(tongue, u);
  }
  if (uDecal == 4) {
    float band = step(0.64, u) * step(u, 0.74);
    return band * step(0.5, fract(floor(u * 60.0) * 0.5 + floor((v + 1.0) * 24.0) * 0.5));
  }
  float zig = abs(fract(u * 5.0) - 0.5) * 0.16 - 0.04;
  return step(abs(v - zig), 0.028) * step(0.5, w);
}
`;

/**
 * Large-scale ambient occlusion baked per vertex into COLOR_0.a (§V.1; 1 where nothing was baked): it darkens the
 * indirect light fully and the direct light by half, so cavities read without a texture.
 */
const AO_VERTEX = /* glsl */ `#include <common>
#ifndef USE_COLOR
attribute vec4 color;
#endif
varying vec3 vBody;
varying float vMzAO;`;
const AO_FRAGMENT = /* glsl */ `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= vMzAO;
reflectedLight.indirectSpecular *= mix(1.0, vMzAO, 0.7);
reflectedLight.directDiffuse *= mix(1.0, vMzAO, 0.5);`;

/** Add the vertex AO (and the body coordinates the decal uses) to a lit material's shader. */
function withVertexAO(mat: THREE.MeshStandardMaterial, key: string, extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', AO_VERTEX)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBody = color.rgb;\nvMzAO = color.a;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMzAO;')
      .replace('#include <aomap_fragment>', AO_FRAGMENT);
    extra?.(shader);
  };
  mat.customProgramCacheKey = () => key;
}

/**
 * Trim-sheet surface detail on a role material. `lite` (rivals on the Low preset) keeps AO and roughness but
 * drops the normal map and clearcoat, which cost the most per pixel.
 */
function applyTrim(mat: THREE.MeshStandardMaterial, trim: TrimMaps | null, lite: boolean, normalStrength = 1): void {
  if (trim) {
    mat.aoMap = trim.orm;
    mat.roughnessMap = trim.orm;
    mat.metalnessMap = trim.orm;
    if (!lite) {
      mat.normalMap = trim.normal;
      // No tangents in the GLBs: three derives them from UV derivatives, which needs a flipped Y (as GLTFLoader does).
      mat.normalScale.set(normalStrength, -normalStrength);
    }
  }
  if (lite && mat instanceof THREE.MeshPhysicalMaterial) mat.clearcoat = 0;
}

function roleOf(m: THREE.Material): string {
  return m.name.replace(/\.\d+$/, '');
}

const decalIndex = (d: number) => Math.max(0, Math.min(DECAL_COUNT - 1, d | 0));

function makeMaterials(livery: Loadout['livery'], trim: TrimMaps | null, lite: boolean) {
  const primary = new THREE.MeshPhysicalMaterial({ color: livery.primary, metalness: 0.55, roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.5 });
  // Shared with the compiled shader, so the livery editor can change them without a rebuild.
  const decal = { value: decalIndex(livery.decal) };
  const decalColor = { value: new THREE.Color(livery.secondary) };
  withVertexAO(primary, 'mz-livery-decal', (shader) => {
    shader.uniforms.uDecal = decal;
    shader.uniforms.uDecalColor = decalColor;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DECAL_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uDecalColor, mzDecal(vBody));');
  });
  const glowColor = new THREE.Color(livery.glow);
  const secondary = new THREE.MeshPhysicalMaterial({ color: livery.secondary, metalness: 0.45, roughness: 0.4, clearcoat: 0.3, envMapIntensity: 1.3 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0b4, metalness: 1, roughness: 0.32, envMapIntensity: 1.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161f, metalness: 0.45, roughness: 0.55 });
  withVertexAO(secondary, 'mz-ao');
  withVertexAO(metal, 'mz-ao');
  withVertexAO(dark, 'mz-ao');
  applyTrim(primary, trim, lite, 0.8);
  applyTrim(secondary, trim, lite, 0.9);
  applyTrim(metal, trim, lite, 1);
  applyTrim(dark, trim, lite, 1.2);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1630, metalness: 0.2, roughness: 0.05, clearcoat: lite ? 0 : 1, clearcoatRoughness: 0.03, envMapIntensity: 3, emissive: glowColor, emissiveIntensity: 0.06 });
  return {
    livery_primary: primary,
    livery_secondary: secondary,
    glow: new THREE.MeshBasicMaterial({ color: glowColor.clone(), toneMapped: false }),
    metal,
    glass,
    dark,
    glowColor,
    decal,
    decalColor,
  };
}

/** Socket transforms of a ship GLB relative to its root node, cached per GLB. */
const socketCache = new WeakMap<GLTF, Map<string, THREE.Matrix4>>();
function socketsOf(gltf: GLTF, chassisId: string): Map<string, THREE.Matrix4> {
  let map = socketCache.get(gltf);
  if (map) return map;
  map = new Map();
  const root = gltf.scene.getObjectByName(chassisId) ?? gltf.scene;
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  root.traverse((o) => {
    if (o.name.startsWith('socket_')) map!.set(o.name, inv.clone().multiply(o.matrixWorld));
  });
  socketCache.set(gltf, map);
  return map;
}

const ROLE_NAMES = { livery_primary: 1, livery_secondary: 1, glow: 1, metal: 1, glass: 1, dark: 1 } as const;

const PART_SOCKET: Record<PartSlot, string[]> = {
  engine: ['socket_engine'],
  booster: ['socket_booster_R', 'socket_booster_L'],
  stabilizer: ['socket_stabilizer'],
  hull: ['socket_hull'],
  aero: ['socket_aero'],
};

/** Node name of a part in parts.glb: `<slot>_t<tier>` for variant A, `<slot>_t<tier>b` for variant B. */
export function partNodeName(slot: PartSlot, tier: PartTier, variant: PartVariant | undefined): string {
  return `${slot}_t${tier}${variantOf(slot, tier, variant) === 'b' ? 'b' : ''}`;
}

export interface AssembleOptions {
  /** Cheaper materials (rivals on the Low preset, §V.2): no normal map or clearcoat. */
  lite?: boolean;
  /**
   * Bake the parts into the chassis: one mesh per material role (≤ 6 draw calls for the whole ship instead of
   * ≈ 18). For rivals (§V.7 step 1); the player's ship and the Garage stay separate so part previews can swap.
   */
  merge?: boolean;
}

/**
 * Body coordinates for merged part vertices that every decal mask maps to 0 (parts are decal-free, see
 * DECAL_GLSL): u = 0 is behind every along-the-ship mask, w = 0.51 is under the top masks and over the split.
 */
const NO_DECAL_BODY = [0, 0.5, 0.51] as const;

interface MergeSource {
  mesh: THREE.Mesh;
  /** Mesh space → assembly root space. */
  matrix: THREE.Matrix4;
  part: boolean;
}

/**
 * One geometry per material from many meshes (positions and normals in root space, COLOR_0 and TEXCOORD_0 kept;
 * a mesh without UVs gets (0, 0), the neutral strip, as when drawn on its own). Quantised or interleaved
 * attributes are read through getX..getW, so meshopt's normalised ints dequantise; mirrored meshes (the left
 * booster) get their winding flipped, which the renderer otherwise does from the negative determinant.
 */
export function mergeByMaterial(sources: MergeSource[]): Map<THREE.Material, THREE.BufferGeometry> {
  const groups = new Map<THREE.Material, { src: MergeSource; start: number; count: number }[]>();
  for (const src of sources) {
    const geo = src.mesh.geometry;
    const mats = Array.isArray(src.mesh.material) ? src.mesh.material : [src.mesh.material];
    const ranges = geo.groups.length > 0 && Array.isArray(src.mesh.material) ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count, materialIndex: 0 }];
    for (const r of ranges) {
      const mat = mats[r.materialIndex ?? 0];
      if (!mat) continue;
      if (!groups.has(mat)) groups.set(mat, []);
      groups.get(mat)!.push({ src, start: r.start, count: r.count });
    }
  }
  const out = new Map<THREE.Material, THREE.BufferGeometry>();
  const p = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const [mat, list] of groups) {
    let verts = 0;
    let idx = 0;
    for (const g of list) {
      verts += g.src.mesh.geometry.attributes.position.count;
      idx += g.count;
    }
    const pos = new Float32Array(verts * 3);
    const nor = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 4);
    const uv = new Float32Array(verts * 2);
    const index = new Uint32Array(idx);
    let vo = 0;
    let io = 0;
    for (const { src, start, count } of list) {
      const geo = src.mesh.geometry;
      const P = geo.attributes.position;
      const N = geo.attributes.normal as THREE.BufferAttribute | undefined;
      const C = geo.attributes.color as THREE.BufferAttribute | undefined;
      const T = geo.attributes.uv as THREE.BufferAttribute | undefined;
      nm.getNormalMatrix(src.matrix);
      for (let i = 0; i < P.count; i++) {
        p.fromBufferAttribute(P, i).applyMatrix4(src.matrix).toArray(pos, (vo + i) * 3);
        if (N) p.fromBufferAttribute(N, i).applyMatrix3(nm).normalize().toArray(nor, (vo + i) * 3);
        const c = (vo + i) * 4;
        if (src.part) {
          col[c] = NO_DECAL_BODY[0];
          col[c + 1] = NO_DECAL_BODY[1];
          col[c + 2] = NO_DECAL_BODY[2];
        } else if (C) {
          col[c] = C.getX(i);
          col[c + 1] = C.getY(i);
          col[c + 2] = C.getZ(i);
        }
        col[c + 3] = C && C.itemSize > 3 ? C.getW(i) : 1;
        if (T) {
          uv[(vo + i) * 2] = T.getX(i);
          uv[(vo + i) * 2 + 1] = T.getY(i);
        }
      }
      const flip = src.matrix.determinant() < 0;
      const I = geo.index;
      for (let k = 0; k < count; k += 3) {
        const a = I ? I.getX(start + k) : start + k;
        const b = I ? I.getX(start + k + 1) : start + k + 1;
        const c = I ? I.getX(start + k + 2) : start + k + 2;
        index[io++] = vo + a;
        index[io++] = vo + (flip ? c : b);
        index[io++] = vo + (flip ? b : c);
      }
      vo += P.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    out.set(mat, geo);
  }
  return out;
}

export function assembleShip(assets: ShipAssets, loadout: Loadout, lod: 0 | 1, opts: AssembleOptions = {}): AssembledShip | null {
  const gltf = assets.ships.get(loadout.chassisId);
  if (!gltf) return null;
  // A multi-material glTF mesh loads as a Group of per-primitive meshes, so clone the node generically.
  const body = gltf.scene.getObjectByName(`${loadout.chassisId}_LOD${lod}`);
  if (!body) return null;
  const sockets = socketsOf(gltf, loadout.chassisId);
  const mats = makeMaterials(loadout.livery, assets.trim ?? null, opts.lite === true);
  const root = new THREE.Group();
  root.name = `assembly-${loadout.chassisId}`;

  // Shares geometry. Keep the node's transform: meshopt quantisation stores the position dequantisation
  // (scale + offset) there, relative to the ship root.
  const bodyClone = body.clone(true);
  root.add(bodyClone);

  const parts: THREE.Object3D[] = [];
  for (const slot of Object.keys(PART_SOCKET) as PartSlot[]) {
    const src = assets.parts.scene.getObjectByName(partNodeName(slot, loadout.parts[slot] ?? 0, loadout.variants?.[slot]));
    if (!src) continue;
    for (const socketName of PART_SOCKET[slot]) {
      const m = sockets.get(socketName);
      if (!m) continue;
      const part = src.clone(true);
      part.matrixAutoUpdate = true;
      m.decompose(part.position, part.quaternion, part.scale);
      if (socketName.endsWith('_L')) part.scale.x *= -1; // boosters are modelled for the right side
      root.add(part);
      parts.push(part);
    }
  }

  // Parts use a decal-free primary (the decal masks are laid out in hull body coordinates).
  const partPrimary = new THREE.MeshPhysicalMaterial().copy(mats.livery_primary);
  withVertexAO(partPrimary, 'mz-ao');
  const inPart = new Set<THREE.Object3D>();
  for (const p of parts) p.traverse((o) => inPart.add(o));
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pick = (m: THREE.Material) => {
      const role = roleOf(m) as keyof typeof ROLE_NAMES;
      if (role === 'livery_primary' && inPart.has(mesh)) return partPrimary;
      return role in ROLE_NAMES ? (mats[role] as THREE.Material) : mats.metal;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(pick) : pick(mesh.material);
    const onlyGlow = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every((m) => m === mats.glow);
    mesh.castShadow = !onlyGlow;
  });

  // Rivals: bake chassis + parts into one mesh per role (the part primary joins the decal primary: merged part
  // vertices carry body coordinates no decal covers).
  const merged: THREE.BufferGeometry[] = [];
  if (opts.merge) {
    root.updateWorldMatrix(true, true);
    const sources: MergeSource[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => (m === partPrimary ? mats.livery_primary : m));
      else if (mesh.material === partPrimary) mesh.material = mats.livery_primary;
      sources.push({ mesh, matrix: mesh.matrixWorld.clone(), part: inPart.has(mesh) });
    });
    root.clear();
    for (const [mat, geo] of mergeByMaterial(sources)) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${loadout.chassisId}_merged_${(Object.keys(ROLE_NAMES) as (keyof typeof ROLE_NAMES)[]).find((k) => mats[k] === mat) ?? 'part'}`;
      mesh.castShadow = mat !== mats.glow;
      root.add(mesh);
      merged.push(geo);
    }
  }

  const pos = (name: string, fallback: THREE.Vector3) => {
    const m = sockets.get(name);
    return m ? new THREE.Vector3().setFromMatrixPosition(m) : fallback;
  };
  const exhaust = pos('socket_exhaust_R', new THREE.Vector3(0.98, -0.16, 2.3));
  const booster = pos('socket_booster_R', new THREE.Vector3(1.26, -0.16, 1.0));
  const layout: ShipLayout = {
    podX: Math.abs(exhaust.x),
    podR: Math.max(0.15, Math.abs(booster.x) - Math.abs(exhaust.x) + 0.02),
    podZ1: exhaust.z - 0.08,
    nozzleY: exhaust.y,
    hullHW: Math.max(0.4, Math.abs(exhaust.x) - 0.35),
  };

  const owned = [mats.livery_primary, partPrimary, mats.livery_secondary, mats.glow, mats.metal, mats.glass, mats.dark];
  return {
    root,
    glowMaterial: mats.glow,
    glowColor: mats.glowColor,
    layout,
    setLivery: (l) => {
      mats.livery_primary.color.set(l.primary);
      partPrimary.color.set(l.primary);
      mats.livery_secondary.color.set(l.secondary);
      mats.decalColor.value.set(l.secondary);
      mats.decal.value = decalIndex(l.decal);
      mats.glowColor.set(l.glow);
      mats.glow.color.set(l.glow);
      mats.glass.emissive.set(l.glow);
    },
    dispose: () => {
      owned.forEach((m) => m.dispose());
      merged.forEach((g) => g.dispose()); // other geometry is shared with the cached GLB
    },
  };
}
