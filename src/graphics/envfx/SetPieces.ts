/**
 * Drifting set pieces (IMPLEMENTATION §X2): a few instances of a prop from the world's props.glb (airships,
 * shuttles, debris) on a slow path well outside the track corridor. One instanced mesh per prop mesh and
 * role; a handful of matrices are written each frame.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { TrackData } from '../../core/contracts';
import { planBounds, trackPlan, type RoleMaterials } from '../themes/WorldTheme';
import type { SetPieceSpec } from './EnvFxSpec';

interface Piece {
  spec: SetPieceSpec;
  /** Each mesh of the prop, with its transform inside props.glb (it carries meshopt's dequantisation). */
  parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[];
}

export class SetPieces {
  readonly group = new THREE.Group();
  private readonly pieces: Piece[] = [];
  private readonly centre = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly m2 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(specs: readonly SetPieceSpec[], track: TrackData, props: GLTF, materials: RoleMaterials) {
    this.group.name = 'setPieces';
    const plan = trackPlan(track);
    const b = planBounds(plan);
    let y = 0;
    for (let i = 1; i < plan.length; i += 3) y += plan[i];
    this.centre.set(b.cx, y / Math.max(1, plan.length / 3), b.cz);
    props.scene.updateMatrixWorld(true);
    for (const spec of specs) {
      const node = props.scene.getObjectByName(spec.prop);
      if (!node) continue; // an older props.glb without this prop: the world simply has no set piece
      const parts: Piece['parts'] = [];
      node.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const role = (Array.isArray(src.material) ? src.material[0] : src.material).name.replace(/\.\d+$/, '');
        const mesh = new THREE.InstancedMesh(src.geometry, materials(role), spec.count);
        mesh.name = `setPiece:${spec.prop}:${role}`;
        mesh.frustumCulled = false;
        if (role === 'neon' && spec.neon !== undefined) {
          const tint = new THREE.Color(spec.neon);
          for (let i = 0; i < spec.count; i++) mesh.setColorAt(i, tint);
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        this.group.add(mesh);
        parts.push({ mesh, local: src.matrixWorld.clone() });
      });
      if (parts.length) this.pieces.push({ spec, parts });
    }
  }

  /** Instanced meshes in the scene (= draw calls). */
  get meshCount(): number {
    return this.group.children.length;
  }

  update(time: number): void {
    for (const { spec, parts } of this.pieces) {
      const scale = spec.scale ?? 1;
      for (let i = 0; i < spec.count; i++) {
        const offset = i / spec.count;
        let yaw: number;
        if (spec.path === 'orbit') {
          const a = (time * spec.speed) / spec.radius + offset * Math.PI * 2;
          this.p.set(this.centre.x + Math.cos(a) * spec.radius, this.centre.y + spec.height + Math.sin(a * 3 + i) * 12, this.centre.z + Math.sin(a) * spec.radius);
          yaw = Math.PI - a; // props point their nose along -Z (glTF): turn it along the direction of travel
        } else {
          const span = spec.radius * 2;
          const d = (((time * spec.speed + offset * span) % span) + span) % span;
          const heading = 0.6 + i * 1.7;
          const along = d - spec.radius;
          const side = (i - (spec.count - 1) / 2) * 420;
          this.p.set(this.centre.x + Math.sin(heading) * along + Math.cos(heading) * side, this.centre.y + spec.height + i * 40, this.centre.z + Math.cos(heading) * along - Math.sin(heading) * side);
          yaw = heading + Math.PI;
        }
        this.q.setFromAxisAngle(SetPieces.UP, yaw);
        this.s.setScalar(scale);
        this.m.compose(this.p, this.q, this.s);
        for (const part of parts) {
          part.mesh.setMatrixAt(i, this.m2.multiplyMatrices(this.m, part.local));
        }
      }
      for (const part of parts) part.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Geometry belongs to the shared GLTF and materials to the theme; only the instance buffers are ours. */
  dispose(): void {
    for (const { parts } of this.pieces) for (const part of parts) part.mesh.dispose();
    this.group.clear();
  }
}
