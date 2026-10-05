/**
 * World 2, Sunset Mesa: a chrome-and-sandstone canyon under an 80s airbrushed sunset. Sky dome with soft
 * horizontal colour bands and a striped sun on the horizon, a dune-rippled desert floor, plateau silhouettes
 * on the horizon, and Blender props: sandstone mesas and hoodoo spires, chrome obelisk pylons lining the
 * track, giant retro cacti and neon roadside billboards (signs drawn on a canvas at runtime).
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from '../../core/config';
import type { TrackData } from '../../core/contracts';
import { Rng } from '../../core/rng';
import { FOG_GLSL, type FogUniforms } from '../shaders/fog';
import { PropInstancer, nearestTrack, placement, planBounds, trackPlan, type PropInstance, type ThemeLighting, type WorldTheme } from './WorldTheme';

const SKY_RADIUS = 6000;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform float uTime;
  uniform vec3 uFog;
  uniform vec3 uSunDir;
  uniform vec3 uSunRight;
  uniform vec3 uSunUp;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 d = normalize(vDir);
    float e = d.y;
    float t = clamp(e, 0.0, 1.0);
    // Airbrushed gradient: horizon gold -> tangerine -> coral -> magenta -> violet -> indigo.
    vec3 c0 = vec3(0.92, 0.62, 0.30);
    vec3 c1 = vec3(0.90, 0.36, 0.14);
    vec3 c2 = vec3(0.95, 0.24, 0.30);
    vec3 c3 = vec3(0.62, 0.12, 0.42);
    vec3 c4 = vec3(0.24, 0.07, 0.36);
    vec3 c5 = vec3(0.05, 0.03, 0.14);
    // Soft "airbrush" banding: the ramp position is nudged toward band centres.
    float bands = 9.0;
    float q = t * bands;
    float tb = (floor(q) + smoothstep(0.25, 0.75, fract(q))) / bands;
    float s = mix(t, tb, 0.55);
    vec3 col = mix(c0, c1, smoothstep(0.0, 0.05, s));
    col = mix(col, c2, smoothstep(0.04, 0.12, s));
    col = mix(col, c3, smoothstep(0.1, 0.24, s));
    col = mix(col, c4, smoothstep(0.2, 0.42, s));
    col = mix(col, c5, smoothstep(0.38, 0.85, s));

    // Thin brighter streaks of cloud close to the horizon.
    float streak = smoothstep(0.0, 1.0, sin((e + 0.004 * sin(d.x * 7.0 + d.z * 5.0)) * 260.0) * 0.5 + 0.5);
    col += vec3(1.0, 0.55, 0.45) * pow(streak, 18.0) * (1.0 - smoothstep(0.02, 0.16, e)) * 0.35;

    // Stars only high up, faint.
    vec3 sp = d * 110.0;
    vec3 cell = floor(sp);
    float h = hash13(cell);
    float star = step(0.985, h) * (1.0 - smoothstep(0.0, 0.16, length(fract(sp) - 0.5)));
    col += vec3(1.0, 0.9, 1.0) * star * smoothstep(0.35, 0.7, e) * (0.6 + 0.4 * sin(uTime * 2.0 + h * 50.0));

    // Big striped sun sitting on the horizon.
    float sd = dot(d, uSunDir);
    if (sd > 0.3) {
      vec2 qq = vec2(dot(d, uSunRight), dot(d, uSunUp));
      float R = 0.17;
      float r = length(qq);
      col += vec3(1.0, 0.45, 0.25) * exp(-max(r - R, 0.0) * 9.0) * 0.3;
      float disc = 1.0 - smoothstep(R - 0.003, R, r);
      float y = qq.y / R;
      float cut = 1.0;
      if (y < 0.3) {
        float th = smoothstep(-0.9, 0.3, -y) * 0.8;
        cut = smoothstep(th, th + 0.06, fract(y * 6.0));
      }
      vec3 sunCol = mix(vec3(1.0, 0.25, 0.45), vec3(1.0, 0.95, 0.55), smoothstep(-0.8, 0.8, y));
      col = mix(col, sunCol * 0.95, disc * cut);
    }

    col = mix(col, uFog, 1.0 - smoothstep(-0.03, 0.0, e));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const GROUND_VERT = /* glsl */ `
  varying vec3 vWorld;
  varying float vDepth;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const GROUND_FRAG = /* glsl */ `
  varying vec3 vWorld;
  varying float vDepth;
  ${FOG_GLSL}
  void main() {
    vec2 p = vWorld.xz;
    // Long dune ripples with a slow meander, plus broad patches.
    float w = sin(p.x * 0.021 + sin(p.y * 0.006) * 3.0 + p.y * 0.008);
    float ripple = smoothstep(0.55, 1.0, w) * 0.5 + smoothstep(-0.2, 0.4, sin(p.x * 0.11 + p.y * 0.035)) * 0.12;
    float patches = 0.5 + 0.5 * sin(p.x * 0.0021 + 1.7) * sin(p.y * 0.0017 + 0.4);
    vec3 sand = mix(vec3(0.34, 0.13, 0.07), vec3(0.62, 0.30, 0.14), patches);
    vec3 col = sand * (0.75 + 0.45 * ripple);
    // A faint retro grid etched into the sand near the track area.
    vec2 g = abs(fract(p / 80.0 - 0.5) - 0.5) / max(fwidth(p / 80.0), vec2(1e-5));
    float line = (1.0 - min(min(g.x, g.y), 1.0)) * (1.0 - smoothstep(300.0, 1400.0, vDepth));
    col += vec3(1.0, 0.35, 0.5) * line * 0.25;
    col = mix(col, uFogColor, mzFogFactor(vDepth, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const RIDGE_VERT = /* glsl */ `
  attribute float aH;
  varying float vH;
  varying float vDepth;
  varying vec3 vWorld;
  void main() {
    vH = aH;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const RIDGE_FRAG = /* glsl */ `
  varying float vH;
  varying float vDepth;
  varying vec3 vWorld;
  uniform vec3 uSunDir;
  ${FOG_GLSL}
  void main() {
    vec3 base = vec3(0.16, 0.05, 0.10);
    vec3 lit = vec3(0.75, 0.28, 0.16);
    float facing = 0.5 + 0.5 * dot(normalize(vWorld.xz), normalize(uSunDir.xz));
    vec3 col = mix(base, lit, smoothstep(0.55, 1.0, vH) * facing * 0.8);
    col = mix(col, uFogColor, mzFogFactor(vDepth, 0.35));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const NEON_TINTS = [0xff4f6e, 0xffa13a, 0xff2bd6, 0xfff06a];
const SIGNS: readonly { text: string; sub: string; a: string; b: string }[] = [
  { text: 'MACHZERO', sub: 'ANTI-GRAVITY RACING', a: '#ff4fd0', b: '#ffd23a' },
  { text: 'TURBO COLA', sub: 'ICE COLD · 2 CREDITS', a: '#19f0ff', b: '#ff4f6e' },
  { text: 'MESA MOTEL', sub: 'VACANCY · POOL · HOVER PARKING', a: '#ffa13a', b: '#ff2bd6' },
  { text: 'HYPER GAS', sub: 'LAST STOP FOR 900 MILES', a: '#7dff3a', b: '#19f0ff' },
];

/** A neon billboard sign drawn on a canvas (gradient backdrop, glowing title, subtitle, border). */
function signTexture(sign: (typeof SIGNS)[number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 216;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, c.height);
  bg.addColorStop(0, '#1a0626');
  bg.addColorStop(1, '#3a0b2c');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  // Sun stripes behind the title.
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,120,80,0.10)' : 'rgba(255,60,140,0.10)';
    g.fillRect(0, 120 + i * 14, c.width, 7);
  }
  g.strokeStyle = sign.b;
  g.lineWidth = 6;
  g.shadowColor = sign.b;
  g.shadowBlur = 18;
  g.strokeRect(10, 10, c.width - 20, c.height - 20);
  g.font = 'italic 900 82px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = sign.a;
  g.shadowBlur = 24;
  g.fillStyle = sign.a;
  g.fillText(sign.text, c.width / 2, 92, c.width - 50);
  g.shadowBlur = 10;
  g.fillStyle = '#ffffff';
  g.font = 'bold 26px "Arial Black", Arial, sans-serif';
  g.fillText(sign.sub, c.width / 2, 168, c.width - 60);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class SunsetMesaTheme implements WorldTheme {
  readonly id = 'sunset-mesa';
  readonly group = new THREE.Group();
  readonly sunDirection = new THREE.Vector3(-0.55, 0.05, -0.83).normalize();
  readonly shimmer = 1;
  readonly lighting: ThemeLighting = {
    hemiSky: 0xffa070,
    hemiGround: 0x40182a,
    hemiIntensity: 0.95,
    keyColor: 0xffc18a,
    keyIntensity: 1.9,
    keyDirection: new THREE.Vector3(-0.5, 0.45, -0.74).normalize(),
    fillColor: 0xff4f8a,
    fillIntensity: 0.65,
    fogColor: 0x7a2c52,
    fogDensity: 0.00034,
    clearColor: 0x2a0f2a,
    environmentIntensity: 0.9,
  };

  private readonly sky: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly ridges: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  private props: PropInstancer | null = null;
  private readonly propMaterials = new Map<string, THREE.Material>();
  private signs: THREE.Group | null = null;
  private readonly signDisposables: { dispose(): void }[] = [];
  private density = 1;

  constructor(fog: FogUniforms) {
    const sunRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.sunDirection).normalize();
    const sunUp = new THREE.Vector3().crossVectors(this.sunDirection, sunRight).normalize();
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uFog: fog.uFogColor,
        uSunDir: { value: this.sunDirection },
        uSunRight: { value: sunRight },
        uSunUp: { value: sunUp },
      },
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    const skyGeo = new THREE.SphereGeometry(1, 48, 32);
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.scale.setScalar(SKY_RADIUS);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    this.sky.name = 'sky';
    this.group.add(this.sky);
    this.disposables.push(skyGeo, this.skyMat);

    const groundMat = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      uniforms: { uFogColor: fog.uFogColor, uFogDensity: fog.uFogDensity },
    });
    const groundGeo = new THREE.PlaneGeometry(26000, 26000, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.position.y = CONFIG.GROUND_Y;
    this.ground.frustumCulled = false;
    this.ground.name = 'ground';
    this.group.add(this.ground);
    this.disposables.push(groundGeo, groundMat);

    const ridgeMat = new THREE.ShaderMaterial({
      vertexShader: RIDGE_VERT,
      fragmentShader: RIDGE_FRAG,
      uniforms: { uFogColor: fog.uFogColor, uFogDensity: fog.uFogDensity, uSunDir: { value: this.sunDirection } },
      side: THREE.DoubleSide,
    });
    const ridgeGeo = this.buildRidges();
    this.ridges = new THREE.Mesh(ridgeGeo, ridgeMat);
    this.ridges.frustumCulled = false;
    this.ridges.name = 'mesa-ridges';
    this.group.add(this.ridges);
    this.disposables.push(ridgeGeo, ridgeMat);
  }

  /** Two rings of flat-topped plateaus on the horizon (stepped silhouette = quantised noise). */
  private buildRidges(): THREE.BufferGeometry {
    const seg = 900;
    const layers = [
      { radius: 3200, height: 260, seed: 5 },
      { radius: 4400, height: 420, seed: 19 },
    ];
    const positions: number[] = [];
    const aH: number[] = [];
    const indices: number[] = [];
    let base = 0;
    for (const L of layers) {
      const rng = new Rng(L.seed * 104729);
      // Plateaus: runs of constant height separated by steep walls.
      let i = 0;
      const heights: number[] = new Array(seg + 1);
      while (i <= seg) {
        const run = rng.int(8, 40);
        const plateau = rng.next() < 0.55;
        const h = plateau ? L.height * rng.range(0.45, 1) : L.height * rng.range(0.04, 0.15);
        for (let k = 0; k < run && i <= seg; k++, i++) heights[i] = h;
      }
      heights[seg] = heights[0];
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const cx = Math.cos(a) * L.radius;
        const cz = Math.sin(a) * L.radius;
        positions.push(cx, CONFIG.GROUND_Y - 150, cz, cx, CONFIG.GROUND_Y + heights[j], cz);
        aH.push(0, heights[j] / L.height);
      }
      for (let j = 0; j < seg; j++) {
        const b0 = base + j * 2;
        indices.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
      }
      base += (seg + 1) * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
    geo.setIndex(indices);
    return geo;
  }

  buildScenery(track: TrackData, props: GLTF | null): void {
    this.clearScenery();
    if (!props) return; // the sky, desert and horizon plateaus still carry the look
    const { instances, billboards } = this.layout(track);
    this.props = new PropInstancer(props, instances, (role) => this.propMaterial(role));
    this.group.add(this.props.group);
    this.props.setDensity(this.density);
    const screen = PropInstancer.emptyPosition(props, 'screen');
    if (screen) this.buildSigns(billboards, screen);
  }

  /** Deterministic scenery layout for a track. */
  private layout(track: TrackData): { instances: PropInstance[]; billboards: THREE.Matrix4[] } {
    const rng = new Rng((track.seed ^ 0x6d2b79f5) >>> 0);
    const plan = trackPlan(track);
    const b = planBounds(plan);
    const out: PropInstance[] = [];
    const taken: { x: number; z: number; r: number }[] = [];
    const tint = new THREE.Color();
    const scatter = (prop: string, count: number, minClear: number, maxClear: number, scale: [number, number], footprint: number, yScale: [number, number] = [1, 1]) => {
      for (let k = 0, placed = 0; k < count * 80 && placed < count; k++) {
        const x = rng.range(b.minX - maxClear, b.maxX + maxClear);
        const z = rng.range(b.minZ - maxClear, b.maxZ + maxClear);
        const s = rng.range(scale[0], scale[1]);
        const r = footprint * s;
        const { dist } = nearestTrack(plan, x, z);
        if (dist < minClear + r || dist > maxClear + r) continue;
        if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r + 20)) continue;
        taken.push({ x, z, r });
        tint.setHex(NEON_TINTS[Math.floor(rng.next() * NEON_TINTS.length)]);
        out.push({ prop, matrix: placement(x, CONFIG.GROUND_Y - 2, z, rng.range(0, Math.PI * 2), s, s * rng.range(yScale[0], yScale[1]), s), neon: tint.clone() });
        placed++;
      }
    };
    // Mesas close enough to frame the track (their tops near deck height), more further out.
    scatter('mesa_0', 7, 90, 700, [0.8, 1.3], 75, [1, 1.3]);
    scatter('mesa_1', 7, 90, 900, [0.8, 1.4], 100, [1.1, 1.6]);
    scatter('mesa_2', 6, 120, 1000, [0.8, 1.2], 60);
    scatter('spire_0', 10, 60, 700, [0.8, 1.4], 14);
    scatter('spire_1', 10, 50, 600, [0.9, 1.6], 10);
    scatter('cactus_0', 18, 50, 500, [2.2, 3.4], 3);
    scatter('cactus_1', 18, 50, 500, [2.2, 3.4], 3);

    // Chrome obelisks lining the track: pairs every ~240 m, 34 m beside the centerline, tall enough to
    // rise ~18 m above the deck from the desert floor. Not on jump gaps or the start straight.
    const L = track.length;
    for (let d = 300; d < L - 150; d += 240) {
      const u = d / L;
      if (track.surfaceKindAt(u, 0) === 'air') continue;
      const s = track.sampleAt(u);
      if (s.up.y < 0.8) continue;
      for (const side of [-1, 1]) {
        const lat = side * rng.range(32, 40);
        const x = s.position.x + s.right.x * lat;
        const z = s.position.z + s.right.z * lat;
        const height = s.position.y + 18 - CONFIG.GROUND_Y;
        tint.setHex(NEON_TINTS[Math.floor(rng.next() * NEON_TINTS.length)]);
        out.push({ prop: 'pylon_0', matrix: placement(x, CONFIG.GROUND_Y, z, rng.range(0, Math.PI), 1.3, height / 37, 1.3), neon: tint.clone() });
      }
    }

    // Billboards: on stilts beside long straights, panel facing the oncoming ships.
    const billboards: THREE.Matrix4[] = [];
    for (let k = 0, tries = 0; billboards.length < 8 && tries < 400; tries++, k++) {
      const d = rng.range(0, L);
      const s = track.sampleAt(d / L);
      if (Math.abs(s.curvature) > 1 / 900 || track.surfaceKindAt(d / L, 0) === 'air') continue;
      if (billboards.some((m) => Math.hypot(m.elements[12] - s.position.x, m.elements[14] - s.position.z) < 450)) continue;
      const side = rng.next() < 0.5 ? -1 : 1;
      const lat = side * rng.range(62, 80);
      const x = s.position.x + s.right.x * lat;
      const z = s.position.z + s.right.z * lat;
      if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 30)) continue;
      // Face the ships coming toward it: the panel normal (prop +Z) points back down the track, angled in.
      const face = new THREE.Vector3().copy(s.forward).multiplyScalar(-1).addScaledVector(s.right, -side * 0.6).setY(0).normalize();
      const yaw = Math.atan2(face.x, face.z);
      const baseY = s.position.y - 6;
      billboards.push(placement(x, baseY, z, yaw, 1));
      out.push({ prop: 'billboard_0', matrix: placement(x, baseY, z, yaw, 1), neon: tint.setHex(NEON_TINTS[billboards.length % NEON_TINTS.length]).clone() });
      // Stilt from the desert floor to the billboard's feet (chrome obelisk, squashed wide).
      out.push({ prop: 'pylon_0', matrix: placement(x, CONFIG.GROUND_Y, z, yaw, 2.2, (baseY - CONFIG.GROUND_Y) / 37, 1.2), neon: tint.clone() });
    }

    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return { instances: out, billboards };
  }

  private buildSigns(billboards: THREE.Matrix4[], screen: THREE.Vector3): void {
    const group = new THREE.Group();
    group.name = 'billboard-signs';
    const geo = new THREE.PlaneGeometry(25.4, 10.6);
    geo.translate(screen.x, screen.y, screen.z + 0.08);
    this.signDisposables.push(geo);
    const mats = SIGNS.map((sign) => {
      const tex = signTexture(sign);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5) });
      this.signDisposables.push(tex, mat);
      return mat;
    });
    billboards.forEach((m, i) => {
      const mesh = new THREE.Mesh(geo, mats[i % mats.length]);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m);
      group.add(mesh);
    });
    this.signs = group;
    this.group.add(group);
  }

  private propMaterial(role: string): THREE.Material {
    let m = this.propMaterials.get(role);
    if (m) return m;
    switch (role) {
      case 'neon':
        m = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3) });
        break;
      case 'chrome':
        m = new THREE.MeshStandardMaterial({ color: 0xffe6d6, metalness: 1, roughness: 0.12 });
        break;
      case 'sandstone':
        m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
        break;
      case 'foliage':
        m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true });
        break;
      default:
        m = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x6a5a7a, roughness: 0.5, metalness: 0.6 });
    }
    this.propMaterials.set(role, m);
    return m;
  }

  private clearScenery(): void {
    this.props?.dispose();
    this.props = null;
    if (this.signs) this.group.remove(this.signs);
    this.signs = null;
    for (const d of this.signDisposables) d.dispose();
    this.signDisposables.length = 0;
  }

  setDensity(fraction: number): void {
    this.density = Math.min(1, Math.max(0, fraction));
    this.props?.setDensity(this.density);
  }

  update(camera: THREE.Camera, time: number): void {
    const p = camera.position;
    this.sky.position.copy(p);
    this.ground.position.x = p.x;
    this.ground.position.z = p.z;
    this.ridges.position.set(p.x, 0, p.z);
    this.skyMat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.clearScenery();
    for (const m of this.propMaterials.values()) m.dispose();
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}
