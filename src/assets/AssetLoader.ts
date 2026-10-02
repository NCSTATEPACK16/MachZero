/**
 * GLB loading for public/game/ (GLTFLoader + MeshoptDecoder), with a promise cache and aggregate progress
 * for the loading screen. Browser only.
 */
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CHASSIS } from '../content/ships';

export interface ShipAssets {
  ships: ReadonlyMap<string, GLTF>;
  parts: GLTF;
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

  /** Every chassis and the parts bundle (≈ 400 KB in total). */
  async loadShips(): Promise<ShipAssets> {
    const [parts, ...ships] = await Promise.all([this.load('parts/parts.glb'), ...CHASSIS.map((c) => this.load(`ships/${c.id}.glb`))]);
    return { parts, ships: new Map(CHASSIS.map((c, i) => [c.id, ships[i]])) };
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
