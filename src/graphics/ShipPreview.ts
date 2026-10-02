/**
 * Garage turntable: one ship (a ShipModel, so it looks exactly as it races) in its own small scene,
 * drawn by GraphicsSystem into a scissored viewport of the shared renderer over the menu backdrop.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { Loadout, ShipDefinition, ShipState } from '../core/contracts';
import { resolveStats } from '../physics/ShipStatsResolver';
import type { ShipAssets } from '../assets/AssetLoader';
import { assembleShip } from './ShipAssembly';
import { ShipModel } from './ShipModel';

const BACKGROUND = 0x0b1024;
const SPIN = 0.55; // rad/s

/** The few fields ShipModel reads from a ship, for a ship that isn't racing. */
function displayShip(loadout: Loadout): ShipState {
  const def: ShipDefinition = {
    id: 0,
    name: 'PREVIEW',
    isPlayer: true,
    livery: { primary: loadout.livery.primary, secondary: loadout.livery.secondary, glow: loadout.livery.glow },
    gridIndex: 0,
    stats: resolveStats(loadout),
    loadout,
  };
  return {
    def,
    status: 'grid',
    boosting: false,
    heightAboveTrack: CONFIG.HOVER_HEIGHT,
    lastControls: { throttle: 0, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, boost: false },
  } as unknown as ShipState;
}

export class ShipPreview {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  private readonly turntable = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private model: ShipModel | null = null;
  /**
   * Replaced models, disposed only after the new one has rendered: its materials then already hold the
   * shared shader programs, so switching ships never releases and recompiles them (a hitch per hover).
   */
  private readonly retired: ShipModel[] = [];
  /** chassis + parts (+ livery for procedural ships): a change of key rebuilds the model. */
  private key = '';
  private yaw = 0.6;
  private last = 0;

  constructor(environment: THREE.Texture) {
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.9;
    this.scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x1a0a38, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 5);
    const rim = new THREE.DirectionalLight(0xff4fd8, 1.6);
    rim.position.set(-5, 2, -6);
    this.scene.add(key, rim);

    // Glowing plinth ring under the ship.
    const ringGeo = new THREE.RingGeometry(2.7, 2.9, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2bd9ff, toneMapped: false, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.55;
    const discGeo = new THREE.CircleGeometry(2.7, 64);
    const discMat = new THREE.MeshStandardMaterial({ color: 0x111633, metalness: 0.6, roughness: 0.35 });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.56;
    this.scene.add(ring, disc, this.turntable);
    this.owned.push(ringGeo, ringMat, discGeo, discMat);

    this.camera.position.set(0, 3.6, 11.5);
    this.camera.lookAt(0, -0.35, 0);
  }

  setLoadout(loadout: Loadout, assets: ShipAssets | null): void {
    const procedural = !assets?.ships.has(loadout.chassisId);
    const key = JSON.stringify([loadout.chassisId, loadout.parts, procedural ? loadout.livery : null]);
    if (this.model && key === this.key) {
      this.model.setLivery(loadout.livery);
      return;
    }
    if (this.model) {
      this.turntable.remove(this.model.root);
      this.retired.push(this.model);
    }
    this.key = key;
    const assembled = assets ? assembleShip(assets, loadout, 0) : null;
    this.model = new ShipModel(displayShip(loadout), assembled);
    this.turntable.add(this.model.root);
  }

  /** Spin by a drag (radians). */
  nudge(radians: number): void {
    this.yaw += radians;
  }

  /** Draw into the CSS-pixel rectangle (x from the left, y from the bottom of the canvas). */
  render(renderer: THREE.WebGLRenderer, x: number, y: number, w: number, h: number, timeSec: number): void {
    if (!this.model || w < 2 || h < 2) return;
    const dt = this.last > 0 ? Math.min(0.1, timeSec - this.last) : 0;
    this.last = timeSec;
    this.yaw += SPIN * dt;
    this.turntable.rotation.y = this.yaw;
    this.model.updateVisuals(dt, timeSec);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(true);
    renderer.setClearColor(BACKGROUND, 1);
    renderer.render(this.scene, this.camera);
    this.disposeRetired();
    renderer.setScissorTest(false);
    renderer.setClearColor(clear, alpha);
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setViewport(0, 0, size.x, size.y);
  }

  private disposeRetired(): void {
    for (const m of this.retired) m.dispose();
    this.retired.length = 0;
  }

  private clearModel(): void {
    this.disposeRetired();
    if (!this.model) return;
    this.turntable.remove(this.model.root);
    this.model.dispose();
    this.model = null;
    this.key = '';
  }

  /** Drop the ship (leaving the garage); the scene stays for next time. */
  hide(): void {
    this.clearModel();
    this.last = 0;
  }

  dispose(): void {
    this.clearModel();
    for (const d of this.owned) d.dispose();
  }
}
