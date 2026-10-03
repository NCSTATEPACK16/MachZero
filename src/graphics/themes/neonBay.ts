/**
 * World 1, Neon Bay: v1's synthwave look (sky dome with the striped sun and a ringed planet, neon grid
 * sea, distant mountains, instanced procedural skyline) plus Blender landmarks: stepped neon towers,
 * pyramids and giant palm silhouettes.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG, PALETTE } from '../../core/config';
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
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uGlowA;
  uniform vec3 uGlowB;
  uniform vec3 uFog;
  uniform vec3 uSunDir;
  uniform vec3 uSunRight;
  uniform vec3 uSunUp;
  uniform vec3 uPlanetDir;
  uniform vec3 uPlanetRight;
  uniform vec3 uPlanetUp;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 d = normalize(vDir);
    float e = d.y;
    float t = clamp(e, 0.0, 1.0);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, t));
    col = mix(col, uZenith, smoothstep(0.12, 0.8, t));

    // ---- stars (cell noise on a sphere) ----
    vec3 sp = d * 105.0;
    vec3 cell = floor(sp);
    vec3 f = fract(sp) - 0.5;
    float h = hash13(cell);
    float h2 = hash13(cell + 17.31);
    vec3 jit = (vec3(hash13(cell + 3.1), hash13(cell + 7.7), hash13(cell + 11.3)) - 0.5) * 0.6;
    float dist = length(f - jit);
    float star = step(0.972, h) * (1.0 - smoothstep(0.0, 0.17, dist));
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h2 * 3.0) + h * 40.0);
    float starFade = smoothstep(0.02, 0.3, e);
    vec3 starCol = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.8, 0.9), h2) * (1.4 + h2 * 2.6);
    col += starCol * star * tw * starFade;

    // ---- synthwave sun ----
    float sd = dot(d, uSunDir);
    if (sd > 0.2) {
      vec2 q = vec2(dot(d, uSunRight), dot(d, uSunUp));
      float R = 0.13;
      float r = length(q);
      float halo = exp(-max(r - R, 0.0) * 7.0) * 0.55;
      col += vec3(1.0, 0.22, 0.55) * halo * 0.55 + vec3(1.0, 0.55, 0.2) * exp(-r * 3.0) * 0.12;
      float disc = 1.0 - smoothstep(R - 0.003, R, r);
      float y = q.y / R;
      float cut = 1.0;
      if (y < 0.15) {
        float th = smoothstep(-0.95, 0.15, -y) * 0.75;
        float fr = fract(y * 7.0);
        cut = smoothstep(th, th + 0.05, fr);
      }
      vec3 sunCol = mix(vec3(1.0, 0.12, 0.5), vec3(1.0, 0.85, 0.2), smoothstep(-0.9, 0.7, y)) * 0.95;
      col = mix(col, sunCol, disc * cut);
    }

    // ---- ringed planet ----
    float pd = dot(d, uPlanetDir);
    if (pd > 0.2) {
      vec2 q = vec2(dot(d, uPlanetRight), dot(d, uPlanetUp));
      float R = 0.085;
      float r = length(q);
      float rr = length(vec2(q.x, q.y / 0.22)) / R;
      float ring = smoothstep(1.45, 1.5, rr) * (1.0 - smoothstep(2.05, 2.1, rr));
      ring *= 0.55 + 0.45 * sin(rr * 38.0);
      float inDisc = 1.0 - smoothstep(R - 0.002, R, r);
      vec2 n2 = q / R;
      float nz = sqrt(max(1.0 - dot(n2, n2), 0.0));
      vec3 nrm = vec3(n2, nz);
      float lit = clamp(dot(nrm, normalize(vec3(-0.6, 0.4, 0.7))), 0.0, 1.0);
      vec3 pcol = mix(vec3(0.10, 0.04, 0.30), vec3(0.65, 0.25, 0.95), lit);
      pcol += vec3(0.1, 0.7, 1.0) * pow(1.0 - nz, 3.0) * 0.9;
      pcol *= 0.85 + 0.15 * sin(n2.y * 22.0 + n2.x * 3.0);
      vec3 ringCol = vec3(0.6, 0.5, 1.0) * 1.1;
      if (q.y >= 0.0) col = mix(col, ringCol, ring * 0.6 * (1.0 - inDisc));
      col = mix(col, pcol * 1.2, inDisc);
      if (q.y < 0.0) col = mix(col, ringCol, ring * 0.7);
      col += vec3(0.4, 0.2, 0.9) * exp(-max(r - R, 0.0) * 25.0) * 0.35;
    }

    // ---- horizon glow ----
    float g = exp(-pow((e - 0.03) / 0.09, 2.0));
    float az = 0.5 + 0.5 * clamp(dot(normalize(d.xz + vec2(1e-4)), normalize(uSunDir.xz)), -1.0, 1.0);
    col += mix(uGlowA, uGlowB, az) * g * (0.35 + 0.9 * az);
    col += uGlowB * exp(-abs(e - 0.004) * 220.0) * 0.55;

    // below the horizon = fog colour so the far ground plane blends seamlessly
    col = mix(col, uFog, 1.0 - smoothstep(-0.02, 0.0, e));
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
  uniform float uTime;
  uniform vec3 uBase;
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  ${FOG_GLSL}

  float gridLine(vec2 p, float cell, out float footprint) {
    vec2 c = p / cell;
    vec2 gw = max(fwidth(c), vec2(1e-5));
    vec2 gl = abs(fract(c - 0.5) - 0.5) / gw;
    footprint = max(gw.x, gw.y);
    return 1.0 - min(min(gl.x, gl.y), 1.0);
  }

  void main() {
    vec2 p = vWorld.xz;
    float fp1;
    float fp2;
    float minor = gridLine(p, 24.0, fp1) * (1.0 - smoothstep(0.25, 0.7, fp1));
    float major = gridLine(p, 120.0, fp2) * (1.0 - smoothstep(0.3, 0.8, fp2));
    float dist = length(vWorld.xz - cameraPosition.xz);
    float wave = pow(0.5 + 0.5 * sin(dist * 0.011 - uTime * 1.1), 10.0);
    vec3 col = uBase + uBase * 0.6 * smoothstep(0.0, 900.0, dist);
    col += uMinor * minor * 0.55;
    col += uMajor * major * (1.6 + 1.6 * wave);
    col += uMinor * minor * wave * 0.9;
    col = mix(col, uFogColor, mzFogFactor(vDepth, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const MOUNTAIN_VERT = /* glsl */ `
  attribute float aH;
  attribute float aLayer;
  varying float vH;
  varying float vLayer;
  varying float vDepth;
  void main() {
    vH = aH;
    vLayer = aLayer;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const MOUNTAIN_FRAG = /* glsl */ `
  varying float vH;
  varying float vLayer;
  varying float vDepth;
  uniform vec3 uGlow;
  ${FOG_GLSL}
  void main() {
    vec3 base = mix(vec3(0.030, 0.012, 0.075), vec3(0.075, 0.028, 0.15), vLayer);
    float rim = smoothstep(0.72, 1.0, vH);
    vec3 col = base + uGlow * rim * 0.32 * (1.0 - vLayer * 0.35);
    col += vec3(0.045, 0.02, 0.09) * vH;
    col = mix(col, uFogColor, mzFogFactor(vDepth, 0.4));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const TOWER_VERT = /* glsl */ `
  attribute vec3 aTint;
  attribute float aSeed;
  varying vec3 vMetric;
  varying vec3 vN;
  varying vec3 vTint;
  varying float vSeed;
  varying float vDepth;
  varying float vHeight;
  void main() {
    vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vMetric = position * sc;
    vHeight = sc.y;
    vN = normal;
    vTint = aTint;
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const TOWER_FRAG = /* glsl */ `
  varying vec3 vMetric;
  varying vec3 vN;
  varying vec3 vTint;
  varying float vSeed;
  varying float vDepth;
  varying float vHeight;
  uniform float uTime;
  ${FOG_GLSL}

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec3 n = normalize(vN);
    float hN = clamp(vMetric.y / max(vHeight, 1.0), 0.0, 1.0);
    vec3 col = vec3(0.022, 0.012, 0.05) + vTint * 0.022 * hN;
    if (n.y < 0.5) {
      bool xFace = abs(n.x) > 0.5;
      float horiz = xFace ? vMetric.z : vMetric.x;
      float faceId = xFace ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
      vec2 wc = vec2(horiz / 3.4, vMetric.y / 4.4);
      vec2 id = floor(wc);
      vec2 f = fract(wc);
      float rnd = hash12(id + vec2(vSeed * 91.7, faceId * 13.1));
      float rowRnd = hash12(vec2(id.y, vSeed * 53.3 + faceId));
      float litP = mix(rnd, rowRnd, 0.45);
      float lit = step(0.56, litP);
      float pane = step(0.16, f.x) * step(f.x, 0.84) * step(0.2, f.y) * step(f.y, 0.8);
      float flick = 1.0 - 0.6 * step(0.985, rnd) * step(0.5, sin(uTime * 2.0 + rnd * 60.0));
      float pick = hash12(id * 1.7 + vSeed * 7.0);
      vec3 warm = vec3(1.0, 0.72, 0.38);
      vec3 winCol = mix(warm, vTint, step(0.45, pick)) * (1.3 + pick * 1.5) * flick;
      float winFade = 1.0 - smoothstep(350.0, 1200.0, vDepth);
      float avg = 0.44 * 0.48;
      vec3 window = winCol * mix(avg, lit * pane, winFade);
      col += window;

      // neon crown + corner accent strips
      float crown = smoothstep(vHeight - 1.3, vHeight - 0.9, vMetric.y);
      col += vTint * crown * 2.6;
      float band = step(0.82, vSeed) * step(mod(vMetric.y, 42.0), 1.1) * 1.8;
      col += vTint * band * (1.0 - smoothstep(600.0, 1800.0, vDepth));
    } else {
      col += vTint * 0.35;
    }
    col = mix(col, uFogColor, mzFogFactor(vDepth, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const TINTS: readonly number[] = [0x19f0ff, 0xff2bd6, 0x8a4dff, 0xffb319, 0x19f0ff, 0xff2bd6, 0x7dff3a];

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const NEON_TINTS = [PALETTE.cyan, PALETTE.magenta, PALETTE.violet, PALETTE.amber];

/** Sky dome, neon grid ground, distant mountains, an instanced procedural skyline and Blender landmarks. */
export class NeonBayTheme implements WorldTheme {
  readonly id = 'neon-bay';
  readonly group = new THREE.Group();
  readonly sunDirection = new THREE.Vector3(0.28, 0.1, -0.95).normalize();
  readonly shimmer = 0;
  readonly lighting: ThemeLighting = {
    hemiSky: 0x6a55d8,
    hemiGround: 0x1a0b33,
    hemiIntensity: 0.85,
    keyColor: 0xa9bcff,
    keyIntensity: 1.5,
    keyDirection: new THREE.Vector3(-0.35, 0.85, 0.4).normalize(),
    fillColor: 0xff4fa0,
    fillIntensity: 0.7,
    fogColor: 0x1a0a38,
    fogDensity: 0.0006,
    clearColor: PALETTE.night,
    environmentIntensity: 0.85,
  };
  private props: PropInstancer | null = null;
  private readonly propMaterials = new Map<string, THREE.Material>();

  private readonly sky: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly mountains: THREE.Mesh;
  private towers: THREE.InstancedMesh | null = null;
  private towerTotal = 0;
  /** Quality: fraction of skyline towers drawn (towers are generated in random spatial order). */
  private density = 1;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly groundMat: THREE.ShaderMaterial;
  private readonly towerMat: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(fog: FogUniforms) {
    // ---- sky ----
    const sunRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.sunDirection).normalize();
    const sunUp = new THREE.Vector3().crossVectors(this.sunDirection, sunRight).normalize();
    const planetDir = new THREE.Vector3(-0.62, 0.3, 0.72).normalize();
    const planetRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), planetDir).normalize();
    const planetUp = new THREE.Vector3().crossVectors(planetDir, planetRight).normalize();

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uZenith: { value: new THREE.Color(0x030209) },
        uMid: { value: new THREE.Color(0x120636) },
        uHorizon: { value: new THREE.Color(0x2a0d55) },
        uGlowA: { value: new THREE.Color(0x7a1bd6) },
        uGlowB: { value: new THREE.Color(0xff2f9e) },
        uFog: fog.uFogColor,
        uSunDir: { value: this.sunDirection },
        uSunRight: { value: sunRight },
        uSunUp: { value: sunUp },
        uPlanetDir: { value: planetDir },
        uPlanetRight: { value: planetRight },
        uPlanetUp: { value: planetUp },
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

    // ---- ground grid ----
    this.groundMat = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBase: { value: new THREE.Color(0x06021a) },
        uMinor: { value: new THREE.Color(0x7d2bff) },
        uMajor: { value: new THREE.Color(0xff2bd6) },
        uFogColor: fog.uFogColor,
        uFogDensity: fog.uFogDensity,
      },
    });
    const groundGeo = new THREE.PlaneGeometry(26000, 26000, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(groundGeo, this.groundMat);
    this.ground.position.y = CONFIG.GROUND_Y;
    this.ground.frustumCulled = false;
    this.ground.name = 'ground';
    this.group.add(this.ground);
    this.disposables.push(groundGeo, this.groundMat);

    // ---- mountains ----
    const mountainGeo = this.buildMountainGeometry();
    const mountainMat = new THREE.ShaderMaterial({
      vertexShader: MOUNTAIN_VERT,
      fragmentShader: MOUNTAIN_FRAG,
      uniforms: {
        uGlow: { value: new THREE.Color(0xff3aa8) },
        uFogColor: fog.uFogColor,
        uFogDensity: fog.uFogDensity,
      },
      side: THREE.DoubleSide,
    });
    this.mountains = new THREE.Mesh(mountainGeo, mountainMat);
    this.mountains.frustumCulled = false;
    this.mountains.name = 'mountains';
    this.group.add(this.mountains);
    this.disposables.push(mountainGeo, mountainMat);

    // ---- towers material (mesh built once the track is known) ----
    this.towerMat = new THREE.ShaderMaterial({
      vertexShader: TOWER_VERT,
      fragmentShader: TOWER_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uFogColor: fog.uFogColor,
        uFogDensity: fog.uFogDensity,
      },
    });
    this.disposables.push(this.towerMat);
  }

  private buildMountainGeometry(): THREE.BufferGeometry {
    const seg = 720;
    const layers = [
      { radius: 3300, height: 430, seed: 11 },
      { radius: 4300, height: 640, seed: 47 },
    ];
    const freqs = [3, 5, 9, 17, 31, 57, 101];
    const amps = [1, 0.75, 0.5, 0.32, 0.2, 0.12, 0.07];
    const ampSum = amps.reduce((a, b) => a + b, 0);
    const positions: number[] = [];
    const aH: number[] = [];
    const aLayer: number[] = [];
    const indices: number[] = [];
    let base = 0;
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      const rng = new Rng(L.seed * 7919);
      const phases = freqs.map(() => rng.range(0, Math.PI * 2));
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        let v = 0;
        for (let k = 0; k < freqs.length; k++) v += amps[k] * (1 - Math.abs(Math.sin(a * freqs[k] + phases[k])));
        v /= ampSum;
        const h = L.height * (0.18 + 0.95 * Math.pow(v, 1.6));
        const cx = Math.cos(a) * L.radius;
        const cz = Math.sin(a) * L.radius;
        positions.push(cx, CONFIG.GROUND_Y - 150, cz, cx, CONFIG.GROUND_Y + h, cz);
        aH.push(0, 1);
        aLayer.push(li, li);
      }
      for (let i = 0; i < seg; i++) {
        const b0 = base + i * 2;
        indices.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
      }
      base += (seg + 1) * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
    geo.setAttribute('aLayer', new THREE.Float32BufferAttribute(aLayer, 1));
    geo.setIndex(indices);
    return geo;
  }

  buildScenery(track: TrackData, props: GLTF | null): void {
    this.buildSkyline(track);
    this.props?.dispose();
    this.props = null;
    if (props) {
      this.props = new PropInstancer(props, this.landmarks(track), (role) => this.propMaterial(role));
      this.group.add(this.props.group);
      this.props.setDensity(this.density);
    }
  }

  /** Landmark towers and pyramids among the skyline, palms closer in; deterministic per track. */
  private landmarks(track: TrackData): PropInstance[] {
    const rng = new Rng((track.seed ^ 0x2c1b3c6d) >>> 0);
    const plan = trackPlan(track);
    const b = planBounds(plan);
    const out: PropInstance[] = [];
    const tint = new THREE.Color();
    const tryPlace = (prop: string, count: number, minClear: number, maxClear: number, scale: [number, number], footprint: number) => {
      for (let k = 0, placed = 0; k < count * 60 && placed < count; k++) {
        const x = rng.range(b.minX - maxClear, b.maxX + maxClear);
        const z = rng.range(b.minZ - maxClear, b.maxZ + maxClear);
        const s = rng.range(scale[0], scale[1]);
        const { dist } = nearestTrack(plan, x, z);
        if (dist < minClear + footprint * s || dist > maxClear) continue;
        if (out.some((o) => o.matrix.elements[12] !== undefined && Math.hypot(o.matrix.elements[12] - x, o.matrix.elements[14] - z) < footprint * s + 30)) continue;
        tint.setHex(NEON_TINTS[Math.floor(rng.next() * NEON_TINTS.length)]);
        out.push({ prop, matrix: placement(x, CONFIG.GROUND_Y - 1, z, rng.range(0, Math.PI * 2), s), neon: tint.clone() });
        placed++;
      }
    };
    tryPlace('tower_0', 8, 140, 1100, [0.8, 1.3], 30);
    tryPlace('tower_1', 8, 140, 1100, [0.8, 1.3], 25);
    tryPlace('tower_2', 6, 220, 1400, [0.9, 1.4], 35);
    tryPlace('pyramid_0', 3, 300, 1500, [1, 1.8], 60);
    for (const palm of ['palm_0', 'palm_1', 'palm_2']) tryPlace(palm, 14, 40, 260, [2.6, 3.8], 4);
    // Random order so a density fraction keeps a spatially even subset.
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
        m = new THREE.MeshStandardMaterial({ color: 0xc8d0ff, metalness: 1, roughness: 0.18 });
        break;
      case 'foliage':
        m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, emissive: 0x12051e });
        break;
      default:
        m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.6 });
    }
    this.propMaterials.set(role, m);
    return m;
  }

  /** Scatter towers outside the track footprint (>= 80 m from any centerline sample). */
  private buildSkyline(track: TrackData): void {
    if (this.towers) {
      this.group.remove(this.towers);
      this.towers.geometry.dispose();
      this.towers.dispose();
      this.towers = null;
    }
    const rng = new Rng((track.seed * 2654435761) ^ 0x51ed270b);
    const step = 4;
    const pts: number[] = [];
    for (let i = 0; i < track.samples.length; i += step) pts.push(track.samples[i].position.x, track.samples[i].position.z);
    const n = pts.length / 2;

    const maxTowers = 950;
    const attempts = 9000;
    const spread = 3000;
    const matrices: THREE.Matrix4[] = [];
    const tints: number[] = [];
    const seeds: number[] = [];
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();

    for (let k = 0; k < attempts && matrices.length < maxTowers; k++) {
      const x = rng.range(-spread, spread);
      const z = rng.range(-spread, spread);
      const w = rng.range(12, 44);
      const d = rng.range(12, 44);
      const clear = 80 + 0.75 * Math.max(w, d);
      let dMin2 = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = pts[i * 2] - x;
        const dz = pts[i * 2 + 1] - z;
        const dd = dx * dx + dz * dz;
        if (dd < dMin2) dMin2 = dd;
      }
      const dMin = Math.sqrt(dMin2);
      if (dMin < clear) continue;
      // "districts": towers cluster where a smooth field is high
      const field = 0.5 + 0.5 * (Math.sin(x * 0.0021 + 1.3) * Math.sin(z * 0.0019 + 0.7) + 0.5 * Math.sin((x + z) * 0.004 + 2.1)) / 1.5;
      if (rng.next() > 0.2 + 0.85 * field) continue;
      const prox = smooth01(clear, clear + 650, dMin);
      const h = (26 + Math.pow(rng.next(), 2.1) * 290) * (0.22 + 0.78 * prox) * (0.6 + 0.6 * field);
      pos.set(x, CONFIG.GROUND_Y - 1, z);
      quat.setFromAxisAngle(yAxis, rng.range(0, Math.PI));
      scl.set(w, h, d);
      matrices.push(new THREE.Matrix4().compose(pos, quat, scl));
      color.setHex(TINTS[Math.floor(rng.next() * TINTS.length)]);
      tints.push(color.r, color.g, color.b);
      seeds.push(rng.next());
    }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, this.towerMat, Math.max(1, matrices.length));
    mesh.count = matrices.length;
    for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(tints), 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
    mesh.frustumCulled = false;
    mesh.name = 'skyline';
    this.group.add(mesh);
    this.towers = mesh;
    this.towerTotal = matrices.length;
    this.setDensity(this.density);
  }

  setDensity(fraction: number): void {
    this.density = Math.min(1, Math.max(0, fraction));
    if (this.towers) this.towers.count = Math.round(this.towerTotal * this.density);
    this.props?.setDensity(this.density);
  }

  update(camera: THREE.Camera, time: number): void {
    const p = camera.position;
    this.sky.position.copy(p);
    this.ground.position.x = p.x;
    this.ground.position.z = p.z;
    this.mountains.position.set(p.x, 0, p.z);
    this.skyMat.uniforms.uTime.value = time;
    this.groundMat.uniforms.uTime.value = time;
    this.towerMat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.props?.dispose();
    for (const m of this.propMaterials.values()) m.dispose();
    if (this.towers) {
      this.towers.geometry.dispose();
      this.towers.dispose();
    }
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}
