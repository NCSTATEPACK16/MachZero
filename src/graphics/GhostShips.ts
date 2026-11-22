/**
 * Time Trial ghosts (IMPLEMENTATION §M8b step 6): for each ghost one mesh, the chassis' hull merged into a single
 * geometry (the path rivals take on Low), with one translucent, unlit `MeshBasicMaterial`: one draw call per
 * ghost, none when it is off, past its end or right at the camera. No parts, trail, shadow or bloom of its own.
 *
 * Colours: the best ghost cyan, the dev ghost gold; in colour-blind mode blue and orange. The dev ghost's "DEV"
 * tag is drawn by the HUD (DOM) at `devTag`. Opacity fades from full at 12 m to 0 at 4 m from the camera.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ShipAssets } from '../assets/AssetLoader';
import type { GhostFrame } from '../core/contracts';
import { STOCK_PARTS, STOCK_VARIANTS } from '../content/parts';
import { CLASS_SCALE, chassisById } from '../content/ships';
import { assembleShip } from './ShipAssembly';

export const GHOST_OPACITY = 0.35;
export const GHOST_COLORS = { best: 0x19f0ff, dev: 0xffc23a } as const;
export const GHOST_COLORS_CB = { best: 0x3d7bff, dev: 0xff8a1f } as const;
/** Opacity is full beyond FADE_FAR metres from the camera and 0 inside FADE_NEAR. */
export const FADE_FAR = 12;
export const FADE_NEAR = 4;

/** 0 at FADE_NEAR or closer, 1 at FADE_FAR or further, smooth between. */
export function ghostFade(distance: number): number {
  const k = Math.min(1, Math.max(0, (distance - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
  return k * k * (3 - 2 * k);
}

/** One position-only geometry of a chassis (stock parts merged in), in ship space; a wedge without ship assets. */
export function ghostGeometry(assets: ShipAssets | null, chassisId: string): THREE.BufferGeometry {
  const assembled = assets ? assembleShip(assets, { chassisId, parts: { ...STOCK_PARTS }, variants: { ...STOCK_VARIANTS }, livery: { primary: 0xffffff, secondary: 0xffffff, glow: 0xffffff, decal: 0 } }, 1, { lite: true, merge: true }) : null;
  if (assembled) {
    const parts: THREE.BufferGeometry[] = [];
    assembled.root.updateWorldMatrix(true, true);
    assembled.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = new THREE.BufferGeometry();
      // Float positions (a source attribute may be quantised), so the transform below is applied exactly.
      const src = m.geometry.getAttribute('position');
      const arr = new Float32Array(src.count * 3);
      for (let i = 0; i < src.count; i++) {
        arr[3 * i] = src.getX(i);
        arr[3 * i + 1] = src.getY(i);
        arr[3 * i + 2] = src.getZ(i);
      }
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      if (m.geometry.index) g.setIndex(m.geometry.index.clone());
      g.applyMatrix4(m.matrixWorld);
      // mergeGeometries needs every part indexed or none: take them all non-indexed.
      if (g.index) {
        parts.push(g.toNonIndexed());
        g.dispose();
      } else parts.push(g);
    });
    assembled.dispose();
    const merged = parts.length ? mergeGeometries(parts, false) : null;
    parts.forEach((g) => g.dispose());
    if (merged) return merged;
  }
  // No ship assets (the procedural v1 ships): a flat wedge the size of a hull, nose along −Z.
  const g = new THREE.ConeGeometry(1.2, 4.4, 3, 1);
  g.rotateX(-Math.PI / 2);
  g.scale(1, 0.35, 1);
  return g;
}

interface GhostMesh {
  frame: GhostFrame;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

export class GhostShips {
  private list: GhostMesh[] = [];
  private cb = false;
  private readonly tmp = new THREE.Vector3();
  /** Where the dev ghost's tag goes, as fractions of the canvas (x right, y down); null when it is hidden. */
  readonly devTag = { x: 0, y: 0, visible: false };

  constructor(private readonly scene: THREE.Scene) {}

  /** The ghosts of this race (frames are read every `update`). */
  set(frames: readonly GhostFrame[], assets: ShipAssets | null): void {
    this.clear();
    for (const frame of frames) {
      const material = new THREE.MeshBasicMaterial({ color: this.colorOf(frame.kind), transparent: true, opacity: GHOST_OPACITY, depthWrite: false, fog: true });
      const mesh = new THREE.Mesh(ghostGeometry(assets, frame.chassisId), material);
      mesh.name = `ghost-${frame.kind}`;
      mesh.castShadow = mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      mesh.renderOrder = 2; // after the opaque ships, before the additive effects
      mesh.visible = false;
      mesh.scale.setScalar(CLASS_SCALE[chassisById(frame.chassisId).cls]);
      this.scene.add(mesh);
      this.list.push({ frame, mesh, material });
    }
  }

  setColorBlind(on: boolean): void {
    if (on === this.cb) return;
    this.cb = on;
    for (const g of this.list) g.material.color.setHex(this.colorOf(g.frame.kind));
  }

  private colorOf(kind: GhostFrame['kind']): number {
    return (this.cb ? GHOST_COLORS_CB : GHOST_COLORS)[kind];
  }

  update(camera: THREE.Camera): void {
    this.devTag.visible = false;
    for (const g of this.list) {
      const f = g.frame;
      const fade = f.visible ? ghostFade(camera.position.distanceTo(f.position)) : 0;
      g.mesh.visible = fade > 0.001;
      if (!g.mesh.visible) continue;
      g.material.opacity = GHOST_OPACITY * fade;
      g.mesh.position.copy(f.position);
      g.mesh.quaternion.copy(f.quaternion);
      if (f.kind === 'dev') {
        // The tag floats 2 m above the ghost.
        this.tmp.copy(f.position).addScaledVector(camera.up, 2).project(camera);
        if (this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1) {
          this.devTag.x = this.tmp.x * 0.5 + 0.5;
          this.devTag.y = 0.5 - this.tmp.y * 0.5;
          this.devTag.visible = true;
        }
      }
    }
  }

  /** How many ghost meshes are drawn this frame (one draw call each). */
  get drawn(): number {
    return this.list.reduce((n, g) => n + (g.mesh.visible ? 1 : 0), 0);
  }

  clear(): void {
    for (const g of this.list) {
      this.scene.remove(g.mesh);
      g.mesh.geometry.dispose();
      g.material.dispose();
    }
    this.list = [];
    this.devTag.visible = false;
  }
}
