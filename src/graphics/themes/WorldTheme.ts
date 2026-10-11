/**
 * A world's look (IMPLEMENTATION §M3.3): sky, fog, lighting and scenery around the track. GraphicsSystem
 * keeps one active theme; a race on another world swaps it. Scenery combines procedural geometry with the
 * world's Blender props (public/game/worlds/<world>/props.glb), always outside the track corridor.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { TrackData } from '../../core/contracts';
import type { FogUniforms } from '../shaders/fog';

export interface ThemeLighting {
  /** Hemisphere light sky / ground colours and intensity. */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** Shadow-casting key light (moon or sun) colour and intensity; direction toward the light. */
  keyColor: number;
  keyIntensity: number;
  keyDirection: THREE.Vector3;
  /** Coloured fill from the sky's sun/horizon glow. */
  fillColor: number;
  fillIntensity: number;
  fogColor: number;
  /** Base FogExp2 density (scaled by the quality preset). */
  fogDensity: number;
  /** Renderer clear colour behind the sky dome. */
  clearColor: number;
  environmentIntensity: number;
}

export interface WorldTheme {
  readonly id: string;
  readonly group: THREE.Group;
  readonly lighting: ThemeLighting;
  /** Direction of the sky's sun/glow (the fill light comes from here). */
  readonly sunDirection: THREE.Vector3;
  /** Heat-shimmer strength for the post chain (0 = none). Applied on Med/High only, never with reduced motion. */
  readonly shimmer: number;
  /** Build the track-dependent scenery (props may be null if they failed to load: procedural fallback). */
  buildScenery(track: TrackData, props: GLTF | null): void;
  /** Quality: fraction of scenery instances drawn. */
  setDensity(fraction: number): void;
  /** Comfort: stop decorative motion (e.g. Jade Ruins' fireflies). Optional. */
  setReducedMotion?(on: boolean): void;
  update(camera: THREE.Camera, time: number): void;
  dispose(): void;
}

export type ThemeFactory = (fog: FogUniforms) => WorldTheme;

// ---------------------------------------------------------------------------
// Scenery helpers
// ---------------------------------------------------------------------------

/** Plan-view centerline points (every `step` samples, split paths included) for corridor tests. */
export function trackPlan(track: TrackData, step = 4): Float64Array {
  const pts = [...track.samples.filter((_, i) => i % step === 0), ...track.branches.flatMap((b) => b.samples.filter((_, i) => i % step === 0))];
  const out = new Float64Array(pts.length * 3);
  pts.forEach((s, k) => {
    out[k * 3] = s.position.x;
    out[k * 3 + 1] = s.position.y;
    out[k * 3 + 2] = s.position.z;
  });
  return out;
}

/** Distance in plan from (x, z) to the nearest centerline point, and that point's height. */
export function nearestTrack(plan: Float64Array, x: number, z: number): { dist: number; y: number } {
  let best = Infinity;
  let y = 0;
  for (let i = 0; i < plan.length; i += 3) {
    const dx = plan[i] - x;
    const dz = plan[i + 2] - z;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      y = plan[i + 1];
    }
  }
  return { dist: Math.sqrt(best), y };
}

/** Bounds of the track in plan (for scatter areas). */
export function planBounds(plan: Float64Array): { minX: number; maxX: number; minZ: number; maxZ: number; cx: number; cz: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < plan.length; i += 3) {
    minX = Math.min(minX, plan[i]);
    maxX = Math.max(maxX, plan[i]);
    minZ = Math.min(minZ, plan[i + 2]);
    maxZ = Math.max(maxZ, plan[i + 2]);
  }
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

export interface PropInstance {
  /** Top-level prop node name in props.glb (e.g. 'mesa_0'). */
  prop: string;
  matrix: THREE.Matrix4;
  /** Per-instance tint for the neon role (optional). */
  neon?: THREE.Color;
}

/** Materials for the prop roles of one theme. */
export type RoleMaterials = (role: string) => THREE.Material;

/**
 * Instance Blender props. Each prop's meshes become InstancedMeshes (one per mesh and role material);
 * instance i of a prop = placement × the mesh's transform inside props.glb (which carries meshopt's
 * dequantisation, so it must never be reset). Placements should come in random spatial order so that a
 * density fraction drops a uniform subset.
 */
export class PropInstancer {
  readonly group = new THREE.Group();
  private readonly meshes: { mesh: THREE.InstancedMesh; total: number }[] = [];

  constructor(gltf: GLTF, placements: readonly PropInstance[], materials: RoleMaterials) {
    this.group.name = 'props';
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const byProp = new Map<string, PropInstance[]>();
    for (const p of placements) {
      const list = byProp.get(p.prop) ?? [];
      list.push(p);
      byProp.set(p.prop, list);
    }
    const m = new THREE.Matrix4();
    for (const [name, list] of byProp) {
      const node = root.getObjectByName(name);
      if (!node) continue;
      node.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const role = (Array.isArray(src.material) ? src.material[0] : src.material).name.replace(/\.\d+$/, '');
        const mesh = new THREE.InstancedMesh(src.geometry, materials(role), list.length);
        mesh.name = `${name}:${role}`;
        list.forEach((p, i) => {
          m.multiplyMatrices(p.matrix, src.matrixWorld);
          mesh.setMatrixAt(i, m);
          if (role === 'neon' && p.neon) mesh.setColorAt(i, p.neon);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.meshes.push({ mesh, total: list.length });
      });
    }
  }

  /** Prop-space position of a named empty (e.g. a billboard's `screen`). */
  static emptyPosition(gltf: GLTF, name: string): THREE.Vector3 | null {
    const o = gltf.scene.getObjectByName(name);
    if (!o) return null;
    gltf.scene.updateMatrixWorld(true);
    return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  }

  setDensity(fraction: number): void {
    for (const { mesh, total } of this.meshes) mesh.count = Math.round(total * fraction);
  }

  /** Geometry belongs to the shared GLTF; only the instance buffers are ours. */
  dispose(): void {
    for (const { mesh } of this.meshes) mesh.dispose();
    this.group.clear();
  }
}

/** Instance matrix: position, yaw (rad), uniform or per-axis scale. */
export function placement(x: number, y: number, z: number, yaw: number, sx: number, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(sx, sy, sz),
  );
}
