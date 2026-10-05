/**
 * World 3, Cryo Station: an ice-planet research station under an aurora. Night sky dome with stars and slowly
 * drifting aurora curtains (green into violet), a moonlit snowfield with wind ripples, a ring of jagged ice
 * mountains on the horizon, and Blender props: crystal ice spires, glacier shelves, CRT control towers,
 * research domes and neon radio masts along the track. The frosted-glass pipe itself is part of the track.
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

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  // One aurora curtain: a wavy band in elevation with fine vertical rays, green at its foot, violet above.
  vec3 curtain(float az, float e, float base, float amp, float speed, float phase) {
    float y = base + amp * sin(az * 3.0 + uTime * speed + phase) + amp * 0.5 * sin(az * 7.0 - uTime * speed * 1.7 + phase * 2.0);
    float rel = e - y;
    float body = exp(-rel * rel / 0.004) * step(-0.08, rel) + exp(-max(rel, 0.0) / 0.09) * step(0.0, rel) * 0.55;
    float rays = 0.55 + 0.45 * sin(az * 140.0 + sin(az * 11.0 + uTime * 0.25 + phase) * 6.0);
    float fadeAz = 0.5 + 0.5 * sin(az * 1.3 + phase + uTime * 0.03);
    vec3 green = vec3(0.15, 1.0, 0.55);
    vec3 violet = vec3(0.62, 0.32, 1.0);
    vec3 col = mix(green, violet, smoothstep(0.0, 0.16, rel));
    return col * body * rays * fadeAz;
  }

  void main() {
    vec3 d = normalize(vDir);
    float e = d.y;
    float t = clamp(e, 0.0, 1.0);
    // Night: deep navy at the zenith, a cold blue glow along the horizon.
    vec3 col = mix(vec3(0.07, 0.12, 0.24), vec3(0.012, 0.02, 0.06), smoothstep(0.0, 0.55, t));

    // Stars.
    vec3 sp = d * 140.0;
    vec3 cell = floor(sp);
    float h = hash13(cell);
    float star = step(0.982, h) * (1.0 - smoothstep(0.0, 0.18, length(fract(sp) - 0.5)));
    col += vec3(0.85, 0.92, 1.0) * star * smoothstep(0.05, 0.3, e) * (0.65 + 0.35 * sin(uTime * 1.7 + h * 60.0));

    // Aurora: two curtains around the sky.
    float az = atan(d.z, d.x);
    vec3 aur = curtain(az, e, 0.26, 0.06, 0.05, 0.0) + 0.7 * curtain(az, e, 0.4, 0.05, -0.04, 2.3);
    col += aur * 0.55 * smoothstep(0.04, 0.2, e);

    col = mix(col, uFog, 1.0 - smoothstep(-0.03, 0.02, e));
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
    // Wind-carved snow ripples (sastrugi) and broad drifts under moonlight.
    float w = sin(p.x * 0.03 + p.y * 0.012 + sin(p.y * 0.004) * 4.0);
    float ripple = smoothstep(0.6, 1.0, w) * 0.35;
    float drift = 0.5 + 0.5 * sin(p.x * 0.0019 + 0.8) * sin(p.y * 0.0023 + 2.1);
    vec3 snow = mix(vec3(0.16, 0.22, 0.34), vec3(0.32, 0.42, 0.58), drift);
    vec3 col = snow * (0.85 + ripple);
    // Faint crevasse lines.
    float crev = 1.0 - smoothstep(0.0, 0.02, abs(sin(p.x * 0.0071 + sin(p.y * 0.003) * 2.0)));
    col = mix(col, vec3(0.05, 0.12, 0.24), crev * 0.6 * (1.0 - smoothstep(400.0, 1600.0, vDepth)));
    col = mix(col, uFogColor, mzFogFactor(vDepth, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const PEAK_VERT = /* glsl */ `
  attribute float aH;
  varying float vH;
  varying float vDepth;
  void main() {
    vH = aH;
    vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const PEAK_FRAG = /* glsl */ `
  varying float vH;
  varying float vDepth;
  ${FOG_GLSL}
  void main() {
    vec3 rock = vec3(0.04, 0.07, 0.14);
    vec3 snow = vec3(0.55, 0.68, 0.86);
    vec3 col = mix(rock, snow, smoothstep(0.55, 0.8, vH));
    col = mix(col, uFogColor, mzFogFactor(vDepth, 0.3));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const NEON_TINTS = [0x7fe8ff, 0xb98cff, 0x4dffb0, 0xf4f7ff];

export class CryoStationTheme implements WorldTheme {
  readonly id = 'cryo-station';
  readonly group = new THREE.Group();
  /** The aurora's brightest arc (the fill light comes from it). */
  readonly sunDirection = new THREE.Vector3(0.2, 0.35, -0.9).normalize();
  readonly shimmer = 0;
  readonly lighting: ThemeLighting = {
    hemiSky: 0x8fb8ff,
    hemiGround: 0x1a2440,
    hemiIntensity: 0.85,
    keyColor: 0xd6e8ff,
    keyIntensity: 1.5,
    keyDirection: new THREE.Vector3(0.35, 0.62, 0.7).normalize(),
    fillColor: 0x4dffb0,
    fillIntensity: 0.55,
    fogColor: 0x14223c,
    fogDensity: 0.0003,
    clearColor: 0x050a18,
    environmentIntensity: 0.85,
  };

  private readonly sky: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly peaks: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  private props: PropInstancer | null = null;
  private readonly propMaterials = new Map<string, THREE.Material>();
  private density = 1;

  constructor(fog: FogUniforms) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uTime: { value: 0 }, uFog: fog.uFogColor },
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

    const peakMat = new THREE.ShaderMaterial({
      vertexShader: PEAK_VERT,
      fragmentShader: PEAK_FRAG,
      uniforms: { uFogColor: fog.uFogColor, uFogDensity: fog.uFogDensity },
      side: THREE.DoubleSide,
    });
    const peakGeo = this.buildPeaks();
    this.peaks = new THREE.Mesh(peakGeo, peakMat);
    this.peaks.frustumCulled = false;
    this.peaks.name = 'ice-peaks';
    this.group.add(this.peaks);
    this.disposables.push(peakGeo, peakMat);
  }

  /** Two rings of jagged peaks on the horizon (sawtooth silhouettes with snow above ~60% height). */
  private buildPeaks(): THREE.BufferGeometry {
    const layers = [
      { radius: 3300, height: 380, seed: 7, teeth: 140 },
      { radius: 4600, height: 620, seed: 29, teeth: 90 },
    ];
    const positions: number[] = [];
    const aH: number[] = [];
    const indices: number[] = [];
    let base = 0;
    for (const L of layers) {
      const rng = new Rng(L.seed * 7919);
      const pts = L.teeth * 2;
      for (let j = 0; j <= pts; j++) {
        const a = (j / pts) * Math.PI * 2;
        const peak = j % 2 === 1;
        const h = j === pts ? 0 : peak ? L.height * rng.range(0.35, 1) : L.height * rng.range(0.05, 0.3);
        const cx = Math.cos(a) * L.radius;
        const cz = Math.sin(a) * L.radius;
        positions.push(cx, CONFIG.GROUND_Y - 150, cz, cx, CONFIG.GROUND_Y + h, cz);
        aH.push(0, h / L.height);
      }
      for (let j = 0; j < pts; j++) {
        const b0 = base + j * 2;
        indices.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
      }
      base += (pts + 1) * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
    geo.setIndex(indices);
    return geo;
  }

  buildScenery(track: TrackData, props: GLTF | null): void {
    this.clearScenery();
    if (!props) return; // the sky, snowfield and peaks still carry the look
    this.props = new PropInstancer(props, this.layout(track), (role) => this.propMaterial(role));
    this.group.add(this.props.group);
    this.props.setDensity(this.density);
  }

  /** Deterministic scenery layout for a track. */
  private layout(track: TrackData): PropInstance[] {
    const rng = new Rng((track.seed ^ 0x2545f491) >>> 0);
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
    scatter('glacier_0', 7, 100, 900, [0.8, 1.3], 90, [1, 1.5]);
    scatter('glacier_1', 6, 140, 1000, [0.8, 1.2], 140);
    scatter('spire_0', 12, 55, 700, [0.7, 1.3], 12);
    scatter('spire_1', 14, 45, 600, [0.8, 1.5], 9);
    scatter('spire_2', 8, 80, 900, [0.8, 1.2], 16);
    scatter('dome_0', 5, 70, 500, [0.8, 1.3], 28);
    scatter('tower_0', 5, 60, 450, [0.9, 1.2], 8, [0.9, 1.4]);

    // Neon radio masts lining the track (pairs every ~260 m), rising ~16 m above the deck.
    const L = track.length;
    for (let d = 320; d < L - 150; d += 260) {
      const u = d / L;
      const s = track.sampleAt(u);
      if (s.up.y < 0.8) continue;
      for (const side of [-1, 1]) {
        const lat = side * rng.range(30, 38);
        const x = s.position.x + s.right.x * lat;
        const z = s.position.z + s.right.z * lat;
        const height = s.position.y + 16 - CONFIG.GROUND_Y;
        tint.setHex(NEON_TINTS[Math.floor(rng.next() * NEON_TINTS.length)]);
        out.push({ prop: 'mast_0', matrix: placement(x, CONFIG.GROUND_Y, z, rng.range(0, Math.PI), 1, height / 37, 1), neon: tint.clone() });
      }
    }

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
        m = new THREE.MeshStandardMaterial({ color: 0xdfeeff, metalness: 1, roughness: 0.14 });
        break;
      case 'ice':
        m = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.12,
          metalness: 0.15,
          emissive: new THREE.Color(0x0c2a4a),
          flatShading: true,
        });
        break;
      default:
        m = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x4a5a7a, roughness: 0.45, metalness: 0.6 });
    }
    this.propMaterials.set(role, m);
    return m;
  }

  private clearScenery(): void {
    this.props?.dispose();
    this.props = null;
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
    this.peaks.position.set(p.x, 0, p.z);
    this.skyMat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.clearScenery();
    for (const m of this.propMaterials.values()) m.dispose();
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}
