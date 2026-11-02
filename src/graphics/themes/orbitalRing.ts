/**
 * World 5, Orbital Ring: a racing ring on a space station, high above the Earth. The sky dome is all of space: a
 * dense starfield with the Milky Way across it, a white sun, and the Earth filling the lower sky, drawn in the sky
 * shader as a ray-traced sphere (camera-relative, so it never clips): oceans, continents and drifting clouds lit by
 * the sun, city lights on the night side and a blue atmosphere glowing round the limb. No ground: the track floats.
 * Blender props: chrome station ribs the track runs through (on the level straights, clear of the loop and the
 * jumps), and trusses, solar arrays, habitat modules and comms dishes drifting around it.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { TrackData } from '../../core/contracts';
import { wrap01 } from '../../core/math';
import { Rng } from '../../core/rng';
import type { FogUniforms } from '../shaders/fog';
import { PropInstancer, nearestTrack, planBounds, trackPlan, type PropInstance, type ThemeLighting, type WorldTheme } from './WorldTheme';

const SKY_RADIUS = 6000;
/** Station ribs: spacing along the track (m), and the stretch kept clear round loops and jump gaps. */
const RIB_SPACING = 180;
const RIB_CLEAR = 120;

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
  uniform vec3 uSun;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * noise3(p);
      p *= 2.03;
      a *= 0.5;
    }
    return s;
  }
  vec3 stars(vec3 d, float scale, float density) {
    vec3 sp = d * scale;
    vec3 cell = floor(sp);
    float h = hash13(cell);
    float s = step(density, h) * (1.0 - smoothstep(0.0, 0.22, length(fract(sp) - 0.5)));
    vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), fract(h * 37.0));
    return tint * s * (0.75 + 0.25 * sin(uTime * 2.1 + h * 80.0));
  }

  // Earth: radius 1, the camera ALT radii above the surface (the horizon dips acos(1 / (1 + ALT)), about 8°, below
  // the plane square to the nadir).
  const float ALT = 0.01;

  vec3 earthSurface(vec3 n, vec3 sun) {
    // Spin slowly about the planet's axis.
    float a = uTime * 0.004;
    vec3 q = vec3(n.x * cos(a) - n.z * sin(a), n.y, n.x * sin(a) + n.z * cos(a));
    float land = smoothstep(0.5, 0.53, fbm(q * 26.0 + vec3(4.1, 0.0, 1.7)));
    vec3 ocean = mix(vec3(0.005, 0.04, 0.16), vec3(0.02, 0.12, 0.3), fbm(q * 70.0));
    vec3 ground = mix(vec3(0.05, 0.13, 0.05), vec3(0.24, 0.19, 0.1), fbm(q * 60.0 + 3.0));
    vec3 col = mix(ocean, ground, land);
    float clouds = smoothstep(0.6, 0.8, fbm(q * 40.0 + vec3(uTime * 0.02, 0.0, 0.0)) + 0.25 * (noise3(q * 300.0) - 0.5));
    float day = clamp(dot(n, sun) * 1.4 + 0.15, 0.0, 1.0);
    col = mix(col, vec3(1.0), clouds * 0.8) * day;
    // City lights on the night side, on land, under thin cloud.
    float city = step(0.8, noise3(q * 900.0)) * land * (1.0 - clouds) * smoothstep(0.1, -0.15, dot(n, sun));
    col += vec3(1.0, 0.7, 0.35) * city * 0.9;
    // Sun glint on the oceans.
    vec3 h = normalize(sun + n);
    col += vec3(1.0, 0.9, 0.75) * pow(max(dot(n, h), 0.0), 60.0) * (1.0 - land) * (1.0 - clouds) * day * 0.6;
    return col;
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 sun = normalize(uSun);

    // Space: black with stars at two scales and the Milky Way band.
    vec3 col = vec3(0.004, 0.006, 0.014);
    col += stars(d, 180.0, 0.985) + 0.6 * stars(d, 420.0, 0.97);
    vec3 gal = normalize(vec3(0.35, 0.82, -0.45));
    float band = exp(-pow(dot(d, gal), 2.0) / 0.018);
    float dust = fbm(d * 7.0);
    col += vec3(0.35, 0.32, 0.45) * band * (0.25 + 0.75 * dust) * 0.2;
    col += stars(d, 900.0, 0.94) * band * 0.8;

    // Sun: a white disc with a soft glow.
    float sd = dot(d, sun);
    col += vec3(1.0, 0.95, 0.85) * (smoothstep(0.9993, 0.9997, sd) * 3.0 + pow(max(sd, 0.0), 600.0) * 0.5 + pow(max(sd, 0.0), 30.0) * 0.04);

    // Earth below: ray from the camera, ALT above a unit sphere at the origin. The station orbits tilted, so the
    // planet lies below and off to one side: its horizon rises above eye level there (seen past the deck from the
    // chase camera) and drops away on the other.
    vec3 o = (1.0 + ALT) * normalize(vec3(-0.38, 1.0, 0.12));
    float b = dot(o, d);
    float c = dot(o, o) - 1.0;
    float disc = b * b - c;
    float closest = sqrt(max(dot(o, o) - b * b, 0.0));
    if (disc > 0.0 && b < 0.0) {
      float t = -b - sqrt(disc);
      vec3 n = normalize(o + d * t);
      vec3 surf = earthSurface(n, sun);
      // Atmosphere seen against the planet: haze grows as the view grazes the surface towards the horizon.
      float graze = exp(-max(dot(n, -d), 0.0) / 0.06);
      float lit = clamp(dot(n, sun) + 0.3, 0.0, 1.0);
      col = mix(surf, vec3(0.25, 0.5, 1.0) * lit * 0.8, graze * 0.75);
    } else {
      // The thin blue line above the horizon, brightest on the day side. Rays heading away from the planet
      // (b ≥ 0) pass closest at the camera itself.
      float h = max((b < 0.0 ? closest : length(o)) - 1.0, 0.0);
      vec3 limbN = normalize(o + d * max(-b, 0.0));
      float lit = clamp(dot(limbN, sun) + 0.35, 0.0, 1.0);
      col += vec3(0.25, 0.5, 1.0) * exp(-h / 0.0015) * lit * 1.4;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const NEON_TINTS = [0x6fd8ff, 0xffffff, 0xff4a5a, 0x9fb8ff];
/** Rib strips alternate the world's electric blue and red, dimmed: dozens of them line the straights. */
const RIB_TINTS = [new THREE.Color(0x2b8cff).multiplyScalar(0.45), new THREE.Color(0xff3344).multiplyScalar(0.4)];

export class OrbitalRingTheme implements WorldTheme {
  readonly id = 'orbital-ring';
  readonly group = new THREE.Group();
  /** The sun, low over the Earth's limb ahead of the start. */
  readonly sunDirection = new THREE.Vector3(-0.55, 0.22, -0.8).normalize();
  readonly shimmer = 0;
  readonly lighting: ThemeLighting = {
    hemiSky: 0x9fb8ff,
    hemiGround: 0x1d3a6e,
    hemiIntensity: 0.75,
    keyColor: 0xfff4e6,
    keyIntensity: 1.7,
    keyDirection: this.sunDirection.clone(),
    fillColor: 0x3d7dff,
    fillIntensity: 0.6,
    fogColor: 0x04070f,
    fogDensity: 0.00012,
    clearColor: 0x010204,
    environmentIntensity: 0.8,
  };

  private readonly sky: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  private props: PropInstancer | null = null;
  private readonly propMaterials = new Map<string, THREE.Material>();
  private density = 1;

  constructor(_fog: FogUniforms) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uTime: { value: 0 }, uSun: { value: this.sunDirection } },
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    const skyGeo = new THREE.SphereGeometry(1, 64, 40);
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.scale.setScalar(SKY_RADIUS);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    this.sky.name = 'sky';
    this.group.add(this.sky);
    this.disposables.push(skyGeo, this.skyMat);
  }

  buildScenery(track: TrackData, props: GLTF | null): void {
    this.clearScenery();
    if (!props) return; // space and the Earth still carry the look
    this.props = new PropInstancer(props, this.layout(track), (role) => this.propMaterial(role));
    this.group.add(this.props.group);
    this.props.setDensity(this.density);
  }

  /** Deterministic scenery layout for a track. */
  private layout(track: TrackData): PropInstance[] {
    const rng = new Rng((track.seed ^ 0x51ed270b) >>> 0);
    const out: PropInstance[] = [];
    const tint = new THREE.Color();
    const L = track.length;

    // Ribs round the level straights: every RIB_SPACING m, square to the road, clear of loops and jump gaps.
    const busy = [
      ...track.loops.map((l) => [l.uStart * L, wrap01(l.uEnd - l.uStart) * L] as const),
      ...track.jumps.map((j) => [j.dTakeoff, j.dLanding - j.dTakeoff] as const),
    ];
    const clear = (d: number): boolean =>
      busy.every(([start, span]) => {
        const rel = (((d - start + RIB_CLEAR) % L) + L) % L;
        return rel > span + 2 * RIB_CLEAR;
      });
    const basis = new THREE.Matrix4();
    const back = new THREE.Vector3();
    for (let d = 90; d < L - 60; d += RIB_SPACING) {
      const s = track.sampleAt(d / L);
      if (s.up.y < 0.97 || !clear(d)) continue;
      basis.makeBasis(s.right, s.up, back.copy(s.forward).negate()).setPosition(s.position);
      out.push({ prop: 'rib_0', matrix: basis.clone(), neon: RIB_TINTS[out.length % 2].clone() });
    }

    // Drifting station hardware: well clear of the road, above and below it, at any attitude.
    const plan = trackPlan(track);
    const b = planBounds(plan);
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const scatter = (prop: string, count: number, minClear: number, maxClear: number, scale: [number, number], footprint: number) => {
      for (let k = 0, placed = 0; k < count * 80 && placed < count; k++) {
        const x = rng.range(b.minX - maxClear, b.maxX + maxClear);
        const z = rng.range(b.minZ - maxClear, b.maxZ + maxClear);
        const sc = rng.range(scale[0], scale[1]);
        const r = footprint * sc;
        const { dist, y } = nearestTrack(plan, x, z);
        if (dist < minClear + r || dist > maxClear + r) continue;
        const height = y + rng.range(-160, 90);
        e.set(rng.range(-0.6, 0.6), rng.range(0, Math.PI * 2), rng.range(-0.6, 0.6));
        q.setFromEuler(e);
        tint.setHex(NEON_TINTS[Math.floor(rng.next() * NEON_TINTS.length)]);
        out.push({ prop, matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, height, z), q, new THREE.Vector3(sc, sc, sc)), neon: tint.clone() });
        placed++;
      }
    };
    scatter('truss_0', 10, 120, 900, [0.8, 1.6], 60);
    scatter('solar_0', 12, 90, 800, [0.9, 1.6], 40);
    scatter('module_0', 10, 70, 700, [0.8, 1.4], 20);
    scatter('dish_0', 8, 60, 600, [0.8, 1.3], 12);

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
        m = new THREE.MeshStandardMaterial({ color: 0xe8eef8, metalness: 1, roughness: 0.16 });
        break;
      default:
        m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.6 });
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
    this.sky.position.copy(camera.position);
    this.skyMat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.clearScenery();
    for (const m of this.propMaterials.values()) m.dispose();
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}
