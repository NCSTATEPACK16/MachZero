/**
 * Builds a ship from the Blender GLBs: clones the chassis LOD, bolts the loadout's parts onto its sockets and
 * gives it per-ship livery materials (materials are named by role in the GLBs; see blender/lib/common.py).
 * The result is handed to ShipModel, which keeps v1's motion, glow, flames, flaps, pool and shield.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Loadout, PartSlot } from '../core/contracts';
import type { ShipAssets } from '../assets/AssetLoader';

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

function roleOf(m: THREE.Material): string {
  return m.name.replace(/\.\d+$/, '');
}

function makeMaterials(livery: Loadout['livery']) {
  const primary = new THREE.MeshPhysicalMaterial({ color: livery.primary, metalness: 0.55, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.5 });
  const decalColor = new THREE.Color(livery.secondary);
  primary.onBeforeCompile = (shader) => {
    shader.uniforms.uDecal = { value: Math.max(0, Math.min(DECAL_COUNT - 1, livery.decal | 0)) };
    shader.uniforms.uDecalColor = { value: decalColor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n#ifndef USE_COLOR\nattribute vec4 color;\n#endif\nvarying vec3 vBody;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBody = color.rgb;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DECAL_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uDecalColor, mzDecal(vBody));');
  };
  primary.customProgramCacheKey = () => 'mz-livery-decal';
  const glowColor = new THREE.Color(livery.glow);
  return {
    livery_primary: primary,
    livery_secondary: new THREE.MeshPhysicalMaterial({ color: livery.secondary, metalness: 0.5, roughness: 0.35, clearcoat: 0.3, envMapIntensity: 1.3 }),
    glow: new THREE.MeshBasicMaterial({ color: glowColor.clone(), toneMapped: false }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0b4, metalness: 1, roughness: 0.25, envMapIntensity: 1.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1630, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 3, emissive: glowColor, emissiveIntensity: 0.06 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0a0b12, metalness: 0.4, roughness: 0.6 }),
    glowColor,
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

const PART_SOCKET: Record<PartSlot, string[]> = {
  engine: ['socket_engine'],
  booster: ['socket_booster_R', 'socket_booster_L'],
  stabilizer: ['socket_stabilizer'],
  hull: ['socket_hull'],
};

export function assembleShip(assets: ShipAssets, loadout: Loadout, lod: 0 | 1): AssembledShip | null {
  const gltf = assets.ships.get(loadout.chassisId);
  if (!gltf) return null;
  // A multi-material glTF mesh loads as a Group of per-primitive meshes, so clone the node generically.
  const body = gltf.scene.getObjectByName(`${loadout.chassisId}_LOD${lod}`);
  if (!body) return null;
  const sockets = socketsOf(gltf, loadout.chassisId);
  const mats = makeMaterials(loadout.livery);
  const root = new THREE.Group();
  root.name = `assembly-${loadout.chassisId}`;

  // Shares geometry. Keep the node's transform: meshopt quantisation stores the position dequantisation
  // (scale + offset) there, relative to the ship root.
  const bodyClone = body.clone(true);
  root.add(bodyClone);

  const parts: THREE.Object3D[] = [];
  for (const slot of Object.keys(PART_SOCKET) as PartSlot[]) {
    const src = assets.parts.scene.getObjectByName(`${slot}_t${loadout.parts[slot]}`);
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
  partPrimary.onBeforeCompile = () => undefined;
  partPrimary.customProgramCacheKey = () => 'mz-livery-plain';
  const inPart = new Set<THREE.Object3D>();
  for (const p of parts) p.traverse((o) => inPart.add(o));
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pick = (m: THREE.Material) => {
      const role = roleOf(m) as keyof typeof mats;
      if (role === 'livery_primary' && inPart.has(mesh)) return partPrimary;
      return role in mats && role !== 'glowColor' ? (mats[role] as THREE.Material) : mats.metal;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(pick) : pick(mesh.material);
    const onlyGlow = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every((m) => m === mats.glow);
    mesh.castShadow = !onlyGlow;
  });

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
    dispose: () => owned.forEach((m) => m.dispose()), // geometry is shared with the cached GLB
  };
}
