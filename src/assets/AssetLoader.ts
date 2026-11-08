/**
 * GLB loading for public/game/ (GLTFLoader + MeshoptDecoder), with a promise cache and aggregate progress
 * for the loading screen. Browser only.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CHASSIS } from '../content/ships';

/** The shared ship trim sheet (§V.1): tangent-space normals and glTF ORM (R AO, G roughness, B metalness). */
export interface TrimMaps {
  normal: THREE.Texture;
  orm: THREE.Texture;
}

export interface ShipAssets {
  ships: ReadonlyMap<string, GLTF>;
  parts: GLTF;
  /** null when the trim textures failed to load: ships then render without surface detail. */
  trim: TrimMaps | null;
}

const BASE = `${import.meta.env.BASE_URL}game/`;

export class AssetLoader {
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly cache = new Map<string, Promise<GLTF>>();
  private readonly bytes = new Map<string, { loaded: number; total: number }>();
  /** 0..1 across every request made so far. */
  onProgress: ((fraction: number) => void) | null = null;

  load(path: string): Promise<GLTF> {
    let p = this.cache.get(path);
    if (!p) {
      this.bytes.set(path, { loaded: 0, total: 1 });
      p = this.loader.loadAsync(BASE + path, (e) => {
        this.bytes.set(path, { loaded: e.loaded, total: e.total || Math.max(e.loaded, 1) });
        this.report();
      });
      p.then(() => {
        const b = this.bytes.get(path)!;
        this.bytes.set(path, { loaded: b.total, total: b.total });
        this.report();
      }).catch(() => this.cache.delete(path)); // allow a retry later
      this.cache.set(path, p);
    }
    return p;
  }

  /** Every chassis, the parts bundle and the trim sheet (≈ 600 KB in total). */
  async loadShips(): Promise<ShipAssets> {
    const [trim, parts, ...ships] = await Promise.all([this.loadTrim(), this.load('parts/parts.glb'), ...CHASSIS.map((c) => this.load(`ships/${c.id}.glb`))]);
    return { trim, parts, ships: new Map(CHASSIS.map((c, i) => [c.id, ships[i]])) };
  }

  /**
   * The trim sheet, set up like a glTF texture (flipY off, so it matches the GLBs' TEXCOORD_0). u tiles; v is
   * clamped so strips never wrap into each other, and UV (0, 0) (meshes without UVs) samples the neutral strip.
   */
  private async loadTrim(): Promise<TrimMaps | null> {
    const loader = new THREE.TextureLoader();
    const one = async (name: string): Promise<THREE.Texture> => {
      const t = await loader.loadAsync(`${BASE}ships/${name}.webp`);
      t.flipY = false;
      t.colorSpace = THREE.NoColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    };
    try {
      const [normal, orm] = await Promise.all([one('trim_normal'), one('trim_orm')]);
      return { normal, orm };
    } catch (e) {
      console.warn('MachZero: ship trim textures failed to load; ships render without surface detail.', e);
      return null;
    }
  }

  private report(): void {
    let loaded = 0;
    let total = 0;
    for (const b of this.bytes.values()) {
      loaded += b.loaded;
      total += b.total;
    }
    this.onProgress?.(total > 0 ? loaded / total : 1);
  }
}
