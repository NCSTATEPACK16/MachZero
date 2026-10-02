import * as THREE from 'three';
import { CONFIG, PALETTE, readUrlFlags } from '../core/config';
import type { FrameContext, IGraphicsSystem, ShipId, ShipState, TrackData } from '../core/contracts';
import type { GameBus } from '../core/events';
import { clamp } from '../core/math';
import { ChaseCamera } from './ChaseCamera';
import { DebugOverlay } from './DebugOverlay';
import { Effects } from './Effects';
import { Environment } from './Environment';
import { PostFX } from './PostFX';
import { ShipModel } from './ShipModel';
import { SpeedLines } from './SpeedLines';
import { createFogUniforms, type FogUniforms } from './shaders/fog';
import { QUALITY_PROFILES, type QualityProfile } from '../settings/QualityManager';
import type { ShipAssets } from '../assets/AssetLoader';
import { assembleShip } from './ShipAssembly';
import { ShipPreview } from './ShipPreview';
import type { Loadout } from '../core/contracts';

const FOG_COLOR = 0x1a0a38;
const FOG_DENSITY = 0.0006;

/** Procedural neon "studio": gradient dome + emissive light strips, prefiltered with PMREM. */
function buildEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const envScene = new THREE.Scene();
  const domeGeo = new THREE.SphereGeometry(40, 32, 16);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vD;
      void main() {
        vD = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vD;
      void main() {
        vec3 d = normalize(vD);
        float e = d.y;
        vec3 top = vec3(0.06, 0.03, 0.24);
        vec3 hor = vec3(0.85, 0.2, 0.62);
        vec3 bot = vec3(0.015, 0.008, 0.05);
        vec3 c = e > 0.0 ? mix(hor, top, pow(clamp(e, 0.0, 1.0), 0.5)) : mix(hor * 0.25, bot, clamp(-e * 2.0, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  envScene.add(new THREE.Mesh(domeGeo, domeMat));

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const mats: THREE.Material[] = [];
  const panel = (sx: number, sy: number, sz: number, x: number, y: number, z: number, hex: number, k: number): void => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
    mats.push(mat);
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    envScene.add(m);
  };
  panel(0.9, 0.9, 32, -15, 10, 0, PALETTE.cyan, 10);
  panel(0.9, 0.9, 32, 15, 10, 0, PALETTE.cyan, 10);
  panel(32, 0.9, 0.9, 0, 7, -17, PALETTE.magenta, 9);
  panel(32, 0.9, 0.9, 0, 7, 17, PALETTE.magenta, 9);
  panel(24, 0.6, 24, 0, 33, 0, 0x8fa8ff, 3.2);
  panel(0.9, 12, 0.9, 20, 0, -20, PALETTE.amber, 7);
  panel(0.9, 12, 0.9, -20, 0, 20, PALETTE.violet, 7);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  domeGeo.dispose();
  domeMat.dispose();
  boxGeo.dispose();
  for (const m of mats) m.dispose();
  return target;
}

/**
 * Owns the renderer, scene and every visual subsystem. Subscribes to game events
 * (never emits) and renders through the post-processing chain.
 */
export class GraphicsSystem implements IGraphicsSystem {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly post: PostFX;
  private readonly env: Environment;
  private readonly fx: Effects;
  private readonly speedLines: SpeedLines;
  private readonly chase: ChaseCamera;
  private readonly debug: DebugOverlay | null;
  private readonly envTarget: THREE.WebGLRenderTarget;

  private readonly moon: THREE.DirectionalLight;
  private readonly moonDir = new THREE.Vector3(-0.35, 0.85, 0.4).normalize();
  private readonly models = new Map<ShipId, ShipModel>();
  private readonly modelList: ShipModel[] = [];
  private readonly unsubs: Array<() => void> = [];
  private trackVisual: THREE.Object3D | null = null;
  private quality: QualityProfile = QUALITY_PROFILES.high;
  private fogUniforms!: FogUniforms;
  private hasRace = false;
  private shipAssets: ShipAssets | null = null;
  private preview: ShipPreview | null = null;
  /** The garage element the turntable is drawn into (null = no preview). */
  private previewEl: HTMLElement | null = null;

  private playerId: ShipId = 0;
  private width: number;
  private height: number;
  private lastDt = 1 / 60;
  private disposed = false;

  // scratch
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();

  /** A bus given here is attached at once (v1 style); the App attaches one per race via attachBus(). */
  constructor(container: HTMLElement, bus?: GameBus) {
    this.width = container.clientWidth || window.innerWidth;
    this.height = container.clientHeight || window.innerHeight;

    const debugFlag = readUrlFlags().debug;
    // preserveDrawingBuffer only in ?debug=1 so external screenshot tooling can read the canvas
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: debugFlag });
    renderer.setPixelRatio(this.pixelRatio());
    renderer.setSize(this.width, this.height);
    renderer.setClearColor(PALETTE.night, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // the composer issues several renders per frame; accumulate stats across all of them
    renderer.info.autoReset = false;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(CONFIG.FOV_MIN, this.width / this.height, 0.1, 9000);
    this.camera.position.set(0, 60, 0);

    // ---- fog / lighting / reflections ----
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    const fogUniforms = createFogUniforms(FOG_COLOR, FOG_DENSITY);
    this.fogUniforms = fogUniforms;

    const hemi = new THREE.HemisphereLight(0x6a55d8, 0x1a0b33, 0.85);
    this.scene.add(hemi);

    this.moon = new THREE.DirectionalLight(0xa9bcff, 1.5);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(1024, 1024);
    const sc = this.moon.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 14;
    sc.bottom = -14;
    sc.near = 1;
    sc.far = 130;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.06;
    this.scene.add(this.moon, this.moon.target);

    this.env = new Environment(fogUniforms);
    const sunLight = new THREE.DirectionalLight(0xff4fa0, 0.7);
    sunLight.position.copy(this.env.sunDirection).multiplyScalar(100);
    this.scene.add(sunLight);

    this.envTarget = buildEnvironmentMap(renderer);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.85;

    this.scene.add(this.env.group);

    this.fx = new Effects();
    this.fx.setCamera(this.camera);
    this.scene.add(this.fx.group);

    this.speedLines = new SpeedLines();
    this.scene.add(this.speedLines.object);

    this.chase = new ChaseCamera(this.camera);
    this.post = new PostFX(renderer, this.scene, this.camera, this.width, this.height);
    this.debug = debugFlag ? new DebugOverlay(document.body) : null;

    if (bus) this.attachBus(bus);
    if (debugFlag) {
      (window as unknown as Record<string, unknown>).__machzeroGfx = {
        renderer: this.renderer,
        scene: this.scene,
        camera: this.camera,
        post: this.post,
        fx: this.fx,
        chase: this.chase,
        models: this.modelList,
      };
    }
  }

  /** Listen to one race's events (replaces any previous race's subscriptions). */
  attachBus(bus: GameBus): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.unsubs.push(
      bus.on('ship:railHit', (e) => {
        const model = this.models.get(e.shipId);
        this.fx.railSparks(e.point, e.normal, e.intensity, model ? model.ship.velocity : null);
        if (e.shipId === this.playerId) {
          this.chase.addImpact(0.03 + e.intensity * e.intensity * 0.5);
          this.post.kickAberration(e.intensity * 0.45);
        }
      }),
      bus.on('ship:shipHit', (e) => {
        this.fx.shipHit(e.point, e.intensity);
        if (e.a === this.playerId || e.b === this.playerId) {
          this.chase.addImpact(0.06 + e.intensity * 0.3);
          this.post.kickAberration(e.intensity * 0.3);
        }
      }),
      bus.on('ship:boost', (e) => {
        const model = this.models.get(e.shipId);
        if (model) this.fx.boostBurst(model);
        if (e.shipId === this.playerId) {
          this.chase.punchFov(7);
          this.chase.addImpact(0.1);
          this.post.kickAberration(0.9);
        }
      }),
      bus.on('ship:dash', (e) => {
        const model = this.models.get(e.shipId);
        if (model) this.fx.dashFlash(model);
        if (e.shipId === this.playerId) {
          this.chase.punchFov(4);
          this.post.kickAberration(0.5);
        }
      }),
      bus.on('ship:destroyed', (e) => {
        const model = this.models.get(e.shipId);
        this.fx.explosion(e.position, model ? model.ship.velocity : null);
        if (model) model.destroyed = true;
        if (e.shipId === this.playerId) {
          this.chase.addImpact(1);
          this.post.kickAberration(1.2);
        }
      }),
      bus.on('ship:respawn', (e) => {
        const model = this.models.get(e.shipId);
        if (model) {
          model.destroyed = false;
          model.flicker(1.2);
        }
      }),
      bus.on('race:state', (e) => {
        if (e.state === 'countdown' || e.state === 'title') this.resetEffects();
      }),
    );
  }

  private resetEffects(): void {
    for (const m of this.modelList) m.reset();
    this.fx.reset();
    this.post.reset();
    this.speedLines.reset();
    this.chase.snap();
  }

  /**
   * Remove everything that belongs to the current race: bus subscriptions, ship models (disposed), effect
   * emitters and the track visual (disposed by its owner, RaceSession). Renderer, post chain, environment
   * map and sky stay alive for the next race.
   */
  clearRace(): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    for (const m of this.modelList) {
      this.scene.remove(m.root);
      m.dispose();
    }
    this.modelList.length = 0;
    this.models.clear();
    this.fx.clearShips();
    this.fx.reset();
    this.speedLines.reset();
    this.post.reset();
    if (this.trackVisual) this.scene.remove(this.trackVisual);
    this.trackVisual = null;
    this.hasRace = false;
  }

  /** Quality preset (IMPLEMENTATION §M1.6). Reduced motion stays applied on top. */
  setQuality(q: QualityProfile): void {
    this.quality = q;
    this.post.setQuality(q);
    this.moon.castShadow = q.shadowMap > 0;
    if (q.shadowMap > 0 && this.moon.shadow.mapSize.x !== q.shadowMap) {
      this.moon.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
    this.env.setDensity(q.scenery);
    this.fx.setBudget(q.particles);
    this.speedLines.budget = q.particles;
    const density = FOG_DENSITY * q.fog;
    (this.scene.fog as THREE.FogExp2).density = density;
    this.fogUniforms.uFogDensity.value = density;
    this.resize(this.width, this.height);
  }

  get qualityLevel(): QualityProfile['level'] {
    return this.quality.level;
  }

  /** Comfort settings (SPEC §2). Applied on top of any quality preset. */
  setComfort(opts: { reducedMotion: boolean }): void {
    this.chase.reducedMotion = opts.reducedMotion;
    this.post.reducedMotion = opts.reducedMotion;
    this.speedLines.disabled = opts.reducedMotion;
  }

  /** Renderer memory counters (leak checks). */
  get memoryInfo(): { geometries: number; textures: number } {
    return { geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures };
  }

  setTrack(track: TrackData): void {
    this.hasRace = true;
    if (this.trackVisual) this.scene.remove(this.trackVisual);
    this.trackVisual = track.visual;
    track.visual.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
    });
    this.scene.add(track.visual);
    this.env.buildSkyline(track);
  }

  /** Blender GLB ships for the next races (null = v1 procedural ships). */
  setShipAssets(assets: ShipAssets | null): void {
    this.shipAssets = assets;
  }

  /** Show `loadout` on the garage turntable inside `el` (its on-screen rectangle), or hide it with null. */
  showPreview(el: HTMLElement | null, loadout: Loadout | null): void {
    if (!el || !loadout) {
      this.previewEl = null;
      this.preview?.hide();
      return;
    }
    this.preview ??= new ShipPreview(this.envTarget.texture);
    this.preview.setLoadout(loadout, this.shipAssets);
    this.previewEl = el;
  }

  nudgePreview(radians: number): void {
    this.preview?.nudge(radians);
  }

  addShip(ship: ShipState): void {
    if (this.models.has(ship.def.id)) return;
    // Ship LOD per preset: High LOD0; Med LOD0 for the player, LOD1 for rivals; Low LOD1.
    const q = this.quality.level;
    const lod: 0 | 1 = q === 'high' || (q === 'med' && ship.def.isPlayer) ? 0 : 1;
    const assembled = this.shipAssets && ship.def.loadout ? assembleShip(this.shipAssets, ship.def.loadout, lod) : null;
    const model = new ShipModel(ship, assembled);
    this.models.set(ship.def.id, model);
    this.modelList.push(model);
    this.scene.add(model.root);
    this.fx.addShip(model);
    if (ship.def.isPlayer) this.playerId = ship.def.id;
    model.updatePose(1);
    model.updateVisuals(0, 0);
  }

  update(ctx: FrameContext): void {
    const state = ctx.race.state;
    // paused: freeze ships, camera and particles entirely (physics is not stepping)
    if (state === 'paused') return;

    const dt = Math.min(ctx.dt, CONFIG.MAX_FRAME_DT);
    this.lastDt = dt;
    const time = ctx.time;
    const player = ctx.player;

    for (const m of this.modelList) m.updatePose(ctx.alpha);
    const pm = this.models.get(player.def.id);
    if (pm) {
      this.chase.update(dt, time, state, ctx.race.countdown, pm, ctx.track);
    }
    this.camera.updateMatrixWorld();

    for (const m of this.modelList) m.updateVisuals(dt, time);
    this.fx.update(dt, this.height * this.renderer.getPixelRatio(), this.modelList);
    this.speedLines.update(dt, this.camera, player.velocity, state === 'results' ? 0 : player.speed, player.boosting);
    this.env.update(this.camera, time);

    if (pm) {
      // tight shadow frustum following the player
      this.moon.target.position.copy(pm.pos);
      this.moon.position.copy(pm.pos).addScaledVector(this.moonDir, 70);
    }

    // motion-blur focus: where the player is heading, projected on screen
    const speed = player.speed;
    if (speed > 5) this.tmpDir.copy(player.velocity).multiplyScalar(1 / speed);
    else this.camera.getWorldDirection(this.tmpDir);
    this.tmpV.copy(this.camera.position).addScaledVector(this.tmpDir, 100).project(this.camera);
    let cu = 0.5;
    let cv = 0.5;
    if (this.tmpV.z < 1) {
      cu = clamp(this.tmpV.x * 0.5 + 0.5, 0.2, 0.8);
      cv = clamp(this.tmpV.y * 0.5 + 0.5, 0.2, 0.8);
    }
    this.post.update(dt, { speed: state === 'results' ? 0 : speed, boosting: player.boosting && state !== 'results', centerU: cu, centerV: cv });
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.info.reset();
    if (this.previewEl && this.preview) {
      // The garage covers the backdrop, so draw only its turntable on a cleared canvas (half the GPU cost).
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.renderPreview(this.previewEl, this.preview);
      return;
    }
    if (!this.hasRace) return;
    this.post.render(this.lastDt);
    if (this.debug) {
      const pm = this.models.get(this.playerId);
      this.debug.update(this.lastDt, this.renderer, pm ? pm.ship : null);
    }
  }

  private renderPreview(el: HTMLElement, preview: ShipPreview): void {
    const r = el.getBoundingClientRect();
    const c = this.renderer.domElement.getBoundingClientRect();
    const x = Math.max(0, r.left - c.left);
    const y = Math.max(0, c.bottom - r.bottom);
    const w = Math.min(r.width, c.width - x);
    const h = Math.min(r.height, c.height - y);
    preview.render(this.renderer, x, y, w, h, performance.now() / 1000);
  }

  private pixelRatio(): number {
    const q = this.quality ?? QUALITY_PROFILES.high;
    return Math.min(window.devicePixelRatio || 1, q.pixelRatioCap) * q.renderScale;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.post.setSize(this.width, this.height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    for (const m of this.modelList) {
      this.scene.remove(m.root);
      m.dispose();
    }
    this.modelList.length = 0;
    this.models.clear();
    this.fx.dispose();
    this.speedLines.dispose();
    this.env.dispose();
    this.post.dispose();
    this.preview?.dispose();
    this.envTarget.dispose();
    this.moon.shadow.map?.dispose();
    this.debug?.dispose();
    if (this.trackVisual) this.scene.remove(this.trackVisual);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
