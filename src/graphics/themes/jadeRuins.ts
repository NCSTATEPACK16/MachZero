/**
 * World 4, Jade Ruins: a neon temple deep in the jungle at dusk. A misty violet-to-amber sky with a low sun
 * behind the haze, a dark jungle floor far below the track, giant trees whose canopy (instanced leaf cards)
 * rises to the track's height, holographic glyph panels hovering beside the road, fireflies drifting over the
 * canopy (off with reduced motion), and Blender props: stepped temples, ruined columns, guardian statues and
 * giant ferns. The stone gates and their doorways are part of the track.
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
  uniform vec3 uSun;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }

  void main() {
    vec3 d = normalize(vDir);
    float e = d.y;
    float t = clamp(e, 0.0, 1.0);
    // Dusk: amber haze at the horizon, rose, then deep violet overhead.
    vec3 col = mix(vec3(0.95, 0.52, 0.28), vec3(0.62, 0.24, 0.46), smoothstep(0.0, 0.16, t));
    col = mix(col, vec3(0.16, 0.07, 0.3), smoothstep(0.12, 0.6, t));
    // Low sun glowing through the mist.
    float s = max(dot(d, uSun), 0.0);
    col += vec3(1.0, 0.62, 0.3) * (pow(s, 900.0) * 1.1 + pow(s, 24.0) * 0.12);
    // Drifting mist banks low in the sky.
    vec2 q = vec2(atan(d.z, d.x) * 6.0, e * 18.0);
    float m = noise(q + vec2(uTime * 0.01, 0.0)) * 0.6 + noise(q * 2.3 - vec2(uTime * 0.017, 0.0)) * 0.4;
    col = mix(col, vec3(0.78, 0.62, 0.66), m * 0.35 * (1.0 - smoothstep(0.02, 0.3, e)));
    // A few early stars overhead.
    vec2 sp = d.xz / max(d.y, 0.05) * 60.0;
    float star = step(0.995, hash12(floor(sp))) * smoothstep(0.35, 0.8, e);
    col += vec3(0.9, 0.85, 1.0) * star * 0.6;
    col = mix(col, uFog, 1.0 - smoothstep(-0.03, 0.03, e));
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
    // Jungle floor seen through the canopy: dark greens in blotches, a river's sheen in winding bands.
    float a = 0.5 + 0.5 * sin(p.x * 0.011 + sin(p.y * 0.007) * 2.0) * sin(p.y * 0.013 + 1.3);
    vec3 col = mix(vec3(0.02, 0.07, 0.04), vec3(0.06, 0.16, 0.07), a);
    float river = 1.0 - smoothstep(0.0, 0.035, abs(sin(p.x * 0.0021 + sin(p.y * 0.0017) * 2.5)));
    col = mix(col, vec3(0.32, 0.22, 0.3), river * 0.5);
    col = mix(col, uFogColor, mzFogFactor(vDepth, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Leaf cards: alpha-tested clusters of leaf blobs, darker toward the card's foot, lit by the dusk. */
const LEAF_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  varying float vShade;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vShade = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const LEAF_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  varying float vShade;
  ${FOG_GLSL}
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  void main() {
    vec2 c = vUv - 0.5;
    // Rounded crown silhouette broken into leaf blobs.
    vec2 g = vUv * 7.0;
    float blob = hash12(floor(g));
    float inBlob = 1.0 - smoothstep(0.25, 0.5, length(fract(g) - 0.5));
    float crown = 1.0 - smoothstep(0.32, 0.5, length(c * vec2(1.0, 1.3)));
    if (crown * (0.55 + 0.45 * inBlob) < 0.45 + 0.2 * blob) discard;
    vec3 dark = vec3(0.02, 0.09, 0.05);
    vec3 lit = mix(vec3(0.1, 0.3, 0.12), vec3(0.32, 0.36, 0.14), vShade);
    vec3 col = mix(dark, lit, smoothstep(0.1, 0.9, vUv.y) * (0.6 + 0.4 * blob));
    col = mix(col, uFogColor, mzFogFactor(vDepth, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Holographic glyph panels: rows of flickering glyph blocks with scanlines, additive. */
const GLYPH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv;
    vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(7.13, 3.71))) * 9137.1);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const GLYPH_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying float vSeed;
  uniform float uTime;
  uniform vec3 uColA;
  uniform vec3 uColB;
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  void main() {
    vec2 g = vUv * vec2(4.0, 6.0);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float on = step(0.35, hash12(cell + vSeed * 17.0));
    // A glyph: a few strokes inside the cell.
    float h = hash12(cell * 3.1 + vSeed);
    float strokes = step(abs(f.x - 0.5), 0.08) * step(0.2, f.y) * step(f.y, 0.8);
    strokes = max(strokes, step(abs(f.y - (0.3 + 0.4 * h)), 0.07) * step(0.2, f.x) * step(f.x, 0.8));
    strokes = max(strokes, step(abs(f.x - f.y), 0.07) * step(0.5, h));
    float frame = 1.0 - step(0.03, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
    float scan = 0.75 + 0.25 * sin(vUv.y * 120.0 - uTime * 6.0);
    float flicker = 0.85 + 0.15 * sin(uTime * 23.0 + vSeed * 40.0);
    vec3 col = mix(uColA, uColB, vUv.y) * (strokes * on + frame * 0.8) * scan * flicker;
    float a = max(strokes * on, frame) * 0.9 + 0.06;
    gl_FragColor = vec4(col * a, 1.0);
  }
`;

/** Fireflies: points drifting on slow loops and blinking. */
const FLY_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  varying float vBlink;
  void main() {
    vec3 p = position;
    float t = uTime * (0.3 + 0.4 * aSeed);
    p += vec3(sin(t + aSeed * 40.0) * 4.0, sin(t * 1.3 + aSeed * 13.0) * 2.0, cos(t * 0.9 + aSeed * 27.0) * 4.0);
    vBlink = smoothstep(0.55, 1.0, sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 60.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uScale * (0.6 + vBlink) / max(-mv.z, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FLY_FRAG = /* glsl */ `
  varying float vBlink;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = (1.0 - smoothstep(0.1, 0.5, r)) * vBlink;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * a * 1.6, 1.0);
  }
`;

const NEON_TINTS = [0x2bffa8, 0xffd23a, 0xb04dff, 0x7dff3a];
/** Canopy trees: crowns of three crossed leaf cards on dark trunks. */
const TREE_COUNT = 420;
const GLYPH_COUNT = 34;
const FIREFLY_COUNT = 1800;

export class JadeRuinsTheme implements WorldTheme {
  readonly id = 'jade-ruins';
  readonly group = new THREE.Group();
  readonly sunDirection = new THREE.Vector3(-0.75, 0.08, 0.66).normalize();
  readonly shimmer = 0;
  readonly lighting: ThemeLighting = {
    hemiSky: 0xd9a0c0,
    hemiGround: 0x123018,
    hemiIntensity: 0.9,
    keyColor: 0xffc58a,
    keyIntensity: 1.6,
    keyDirection: new THREE.Vector3(-0.6, 0.45, 0.66).normalize(),
    fillColor: 0xb04dff,
    fillIntensity: 0.5,
    fogColor: 0x5a3a58,
    fogDensity: 0.00042,
    clearColor: 0x1a0c24,
    environmentIntensity: 0.8,
  };

  private readonly sky: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly glyphMat: THREE.ShaderMaterial;
  private readonly flyMat: THREE.ShaderMaterial;
  private readonly leafMat: THREE.ShaderMaterial;
  private readonly trunkMat = new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 0.95 });
  private readonly cardGeo: THREE.BufferGeometry;
  private readonly trunkGeo = new THREE.CylinderGeometry(0.6, 1.4, 1, 6, 1, true).translate(0, 0.5, 0);
  private readonly glyphGeo = new THREE.PlaneGeometry(1, 1);
  /** Karst rock pillars carrying the ruins up out of the jungle to near the track's level. */
  private readonly rockGeo = new THREE.CylinderGeometry(0.75, 1, 1, 7, 1).translate(0, 0.5, 0);
  private readonly rockMat = new THREE.MeshStandardMaterial({ color: 0x3a4436, roughness: 1, flatShading: true });
  private rocks: THREE.InstancedMesh | null = null;
  private outcrops: { x: number; z: number; top: number; r: number }[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private props: PropInstancer | null = null;
  private readonly propMaterials = new Map<string, THREE.Material>();
  /** Track-dependent procedural scenery (canopy, glyphs, fireflies). */
  private scenery: THREE.Group | null = null;
  private crowns: THREE.InstancedMesh | null = null;
  private trunks: THREE.InstancedMesh | null = null;
  private glyphs: THREE.InstancedMesh | null = null;
  private flies: THREE.Points | null = null;
  private density = 1;
  private reducedMotion = false;

  constructor(fog: FogUniforms) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uTime: { value: 0 }, uFog: fog.uFogColor, uSun: { value: this.sunDirection } },
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

    this.leafMat = new THREE.ShaderMaterial({
      vertexShader: LEAF_VERT,
      fragmentShader: LEAF_FRAG,
      uniforms: { uFogColor: fog.uFogColor, uFogDensity: fog.uFogDensity },
      side: THREE.DoubleSide,
    });
    // Three crossed vertical cards plus one flat card on top: a crown that reads from any side and from above.
    const cards: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) cards.push(new THREE.PlaneGeometry(1, 0.8).translate(0, 0.4, 0).rotateY((k * Math.PI) / 3));
    cards.push(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.62, 0));
    this.cardGeo = mergeGeometries(cards);
    for (const c of cards) c.dispose();
    this.glyphMat = new THREE.ShaderMaterial({
      vertexShader: GLYPH_VERT,
      fragmentShader: GLYPH_FRAG,
      uniforms: { uTime: { value: 0 }, uColA: { value: new THREE.Color(0x2bffa8) }, uColB: { value: new THREE.Color(0xb04dff) } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flyMat = new THREE.ShaderMaterial({
      vertexShader: FLY_VERT,
      fragmentShader: FLY_FRAG,
      uniforms: { uTime: { value: 0 }, uScale: { value: 900 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(this.leafMat, this.cardGeo, this.trunkGeo, this.trunkMat, this.glyphGeo, this.glyphMat, this.flyMat, this.rockGeo, this.rockMat);
  }

  buildScenery(track: TrackData, props: GLTF | null): void {
    this.clearScenery();
    this.buildProcedural(track);
    if (props) {
      this.props = new PropInstancer(props, this.layout(track), (role) => this.propMaterial(role));
      this.group.add(this.props.group);
      const rocks = new THREE.InstancedMesh(this.rockGeo, this.rockMat, Math.max(1, this.outcrops.length));
      this.outcrops.forEach((o, i) => rocks.setMatrixAt(i, placement(o.x, CONFIG.GROUND_Y - 2, o.z, i * 1.7, o.r, o.top - CONFIG.GROUND_Y + 2, o.r)));
      rocks.count = this.outcrops.length;
      rocks.userData.total = this.outcrops.length;
      rocks.frustumCulled = false;
      rocks.name = 'outcrops';
      this.rocks = rocks;
      this.group.add(rocks);
    }
    this.applyDensity();
  }

  /** Canopy trees, glyph panels and fireflies around the track (deterministic per track). */
  private buildProcedural(track: TrackData): void {
    const rng = new Rng((track.seed ^ 0x6a09e667) >>> 0);
    const plan = trackPlan(track);
    const b = planBounds(plan);
    const g = new THREE.Group();
    g.name = 'jungle';

    // Trees: trunks from the floor, crowns up to around the track's height; never in the track corridor.
    const crowns = new THREE.InstancedMesh(this.cardGeo, this.leafMat, TREE_COUNT);
    const trunks = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, TREE_COUNT);
    let n = 0;
    for (let k = 0; k < TREE_COUNT * 40 && n < TREE_COUNT; k++) {
      const x = rng.range(b.minX - 700, b.maxX + 700);
      const z = rng.range(b.minZ - 700, b.maxZ + 700);
      const crownW = rng.range(26, 46);
      const { dist, y } = nearestTrack(plan, x, z);
      if (dist < 34 + crownW / 2 || dist > 900) continue;
      // Near the road the crowns stay below the deck; further out they may tower over it.
      const top = (dist < 120 ? y - 6 : y + rng.range(-10, 28)) - CONFIG.GROUND_Y;
      const yaw = rng.range(0, Math.PI * 2);
      crowns.setMatrixAt(n, placement(x, CONFIG.GROUND_Y + top - crownW * 0.55, z, yaw, crownW, crownW * 0.8, crownW));
      trunks.setMatrixAt(n, placement(x, CONFIG.GROUND_Y, z, yaw, rng.range(0.8, 1.4), top - crownW * 0.3, rng.range(0.8, 1.4)));
      n++;
    }
    crowns.count = trunks.count = n;
    crowns.userData.total = trunks.userData.total = n;
    crowns.frustumCulled = trunks.frustumCulled = false;
    crowns.name = 'canopy';
    g.add(crowns, trunks);

    // Holographic glyph panels hovering beside the road, evenly round the lap on alternate sides.
    const glyphs = new THREE.InstancedMesh(this.glyphGeo, this.glyphMat, GLYPH_COUNT);
    let m = 0;
    for (let i = 0; i < GLYPH_COUNT; i++) {
      const s = track.sampleAt(((i + 0.5) / GLYPH_COUNT) % 1);
      if (s.up.y < 0.85) continue;
      const side = i % 2 ? 1 : -1;
      const lat = side * rng.range(22, 30);
      const w = rng.range(6, 10);
      const pos = s.position.clone().addScaledVector(s.right, lat).addScaledVector(s.up, rng.range(8, 14));
      const yaw = Math.atan2(s.forward.x, s.forward.z) + side * 0.6;
      glyphs.setMatrixAt(m++, placement(pos.x, pos.y, pos.z, yaw, w, w * 1.4, 1));
    }
    glyphs.count = m;
    glyphs.userData.total = m;
    glyphs.frustumCulled = false;
    glyphs.name = 'glyphs';
    g.add(glyphs);

    // Fireflies over the canopy near the track.
    const pos: number[] = [];
    const seed: number[] = [];
    for (let k = 0; k < FIREFLY_COUNT * 20 && seed.length < FIREFLY_COUNT; k++) {
      const x = rng.range(b.minX - 300, b.maxX + 300);
      const z = rng.range(b.minZ - 300, b.maxZ + 300);
      const { dist, y } = nearestTrack(plan, x, z);
      if (dist < 18 || dist > 300) continue;
      pos.push(x, y + rng.range(-25, 12), z);
      seed.push(rng.next());
    }
    const flyGeo = new THREE.BufferGeometry();
    flyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    flyGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    const flies = new THREE.Points(flyGeo, this.flyMat);
    flies.frustumCulled = false;
    flies.name = 'fireflies';
    flies.userData.total = seed.length;
    g.add(flies);

    this.crowns = crowns;
    this.trunks = trunks;
    this.glyphs = glyphs;
    this.flies = flies;
    this.scenery = g;
    this.group.add(g);
  }

  /** Deterministic Blender-prop layout for a track. */
  private layout(track: TrackData): PropInstance[] {
    const rng = new Rng((track.seed ^ 0x3c6ef372) >>> 0);
    const plan = trackPlan(track);
    const b = planBounds(plan);
    const out: PropInstance[] = [];
    const taken: { x: number; z: number; r: number }[] = [];
    const tint = new THREE.Color();
    this.outcrops = [];
    const scatter = (prop: string, count: number, minClear: number, maxClear: number, scale: [number, number], footprint: number, lift = 0) => {
      for (let k = 0, placed = 0; k < count * 80 && placed < count; k++) {
        const x = rng.range(b.minX - maxClear, b.maxX + maxClear);
        const z = rng.range(b.minZ - maxClear, b.maxZ + maxClear);
        const s = rng.range(scale[0], scale[1]);
        const r = footprint * s;
        const { dist, y } = nearestTrack(plan, x, z);
        if (dist < minClear + r || dist > maxClear + r) continue;
        if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r + 15)) continue;
        taken.push({ x, z, r });
        tint.setHex(NEON_TINTS[Math.floor(rng.next() * NEON_TINTS.length)]);
        // Temples stand on the jungle floor; the smaller ruins sit on karst pillars a little below the deck.
        const base = lift > 0 ? y - lift : CONFIG.GROUND_Y - 2;
        if (lift > 0) this.outcrops.push({ x, z, top: base, r: r * 1.25 });
        out.push({ prop, matrix: placement(x, base, z, rng.range(0, Math.PI * 2), s), neon: tint.clone() });
        placed++;
      }
    };
    scatter('temple_0', 4, 160, 900, [1.4, 2.2], 70);
    scatter('temple_1', 6, 110, 800, [1.3, 2], 45);
    scatter('column_0', 14, 30, 160, [1, 1.4], 4, 12);
    scatter('column_1', 16, 30, 200, [1, 1.5], 6, 12);
    scatter('column_2', 12, 30, 200, [0.9, 1.4], 6, 12);
    scatter('statue_0', 10, 32, 180, [1, 1.6], 6, 10);
    scatter('fern_0', 30, 26, 260, [1.2, 2.2], 10, 6);
    scatter('fern_1', 24, 30, 320, [1.2, 2], 14, 8);
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  private propMaterial(role: string): THREE.Material {
    let m = this.propMaterials.get(role);
    if (m) return m;
    switch (role) {
      case 'neon':
        m = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3) });
        break;
      case 'chrome':
        m = new THREE.MeshStandardMaterial({ color: 0xd8f0e0, metalness: 1, roughness: 0.2 });
        break;
      case 'foliage':
        m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
        break;
      case 'sandstone':
        m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
        break;
      default:
        m = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x303830, roughness: 0.7, metalness: 0.2 });
    }
    this.propMaterials.set(role, m);
    return m;
  }

  private clearScenery(): void {
    this.props?.dispose();
    this.props = null;
    if (this.rocks) {
      this.rocks.dispose();
      this.group.remove(this.rocks);
      this.rocks = null;
    }
    if (this.scenery) {
      this.crowns?.dispose();
      this.trunks?.dispose();
      this.glyphs?.dispose();
      this.flies?.geometry.dispose();
      this.group.remove(this.scenery);
    }
    this.scenery = this.crowns = this.trunks = this.glyphs = this.flies = null;
  }

  private applyDensity(): void {
    this.props?.setDensity(this.density);
    for (const mesh of [this.crowns, this.trunks, this.glyphs]) if (mesh) mesh.count = Math.round(mesh.userData.total * this.density);
    if (this.flies) {
      this.flies.visible = !this.reducedMotion;
      this.flies.geometry.setDrawRange(0, Math.round(this.flies.userData.total * this.density));
    }
  }

  setDensity(fraction: number): void {
    this.density = Math.min(1, Math.max(0, fraction));
    this.applyDensity();
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.applyDensity();
  }

  update(camera: THREE.Camera, time: number): void {
    const p = camera.position;
    this.sky.position.copy(p);
    this.ground.position.x = p.x;
    this.ground.position.z = p.z;
    this.skyMat.uniforms.uTime.value = time;
    this.glyphMat.uniforms.uTime.value = this.reducedMotion ? 0 : time;
    this.flyMat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.clearScenery();
    for (const m of this.propMaterials.values()) m.dispose();
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}

/** Merge non-indexed-compatible plane geometries (position, normal, uv; indexed). */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t.getX(i), t.getY(i));
    }
    const index = g.getIndex()!;
    for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
