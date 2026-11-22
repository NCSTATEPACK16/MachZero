/**
 * Placeholder theme for a world whose look is not built yet (IMPLEMENTATION §X: a world's look is never built
 * without its concept image, assets/reference/worlds/<id>/chosen.jpg). It lets the track, gimmick, hazards and AI be
 * played and tested: a flat two-colour sky from the world's palette, plain lights, no ground, no props and no
 * environment effects. It is replaced by the world's own theme in themes/index.ts.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { TrackData } from '../../core/contracts';
import { worldById } from '../../content/worlds';
import type { FogUniforms } from '../shaders/fog';
import type { ThemeLighting, WorldTheme } from './WorldTheme';

const SKY_RADIUS = 6000;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A plain vertical gradient: dark overhead, the horizon colour in a band at eye level, darker again below.
const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  void main() {
    float h = normalize(vDir).y;
    float band = 1.0 - smoothstep(0.0, 0.45, abs(h));
    gl_FragColor = vec4(mix(uTop, uHorizon, band * band), 1.0);
  }
`;

export class PlaceholderTheme implements WorldTheme {
  readonly group = new THREE.Group();
  readonly sunDirection = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
  readonly shimmer = 0;
  readonly lighting: ThemeLighting;

  private readonly skyGeo: THREE.SphereGeometry;
  private readonly skyMat: THREE.ShaderMaterial;

  constructor(
    readonly id: string,
    _fog: FogUniforms,
  ) {
    const palette = worldById(id)?.palette;
    // The sky takes a dim tint of the left rail colour, so two placeholder worlds do not look the same.
    const tint = new THREE.Color(palette?.left ?? 0x6677aa);
    const top = tint.clone().multiplyScalar(0.035);
    const horizon = tint.clone().multiplyScalar(0.22);
    this.lighting = {
      hemiSky: 0xb9c2e6,
      hemiGround: 0x1a1830,
      hemiIntensity: 0.8,
      keyColor: 0xf2f0ff,
      keyIntensity: 1.3,
      keyDirection: this.sunDirection.clone(),
      fillColor: tint.getHex(),
      fillIntensity: 0.4,
      fogColor: horizon.getHex(),
      fogDensity: 0.00035,
      clearColor: top.getHex(),
      environmentIntensity: 0.7,
    };
    this.group.name = `theme:${id} (placeholder)`;
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uTop: { value: top }, uHorizon: { value: horizon } },
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    this.skyGeo = new THREE.SphereGeometry(1, 32, 16);
    const sky = new THREE.Mesh(this.skyGeo, this.skyMat);
    sky.scale.setScalar(SKY_RADIUS);
    sky.frustumCulled = false;
    sky.renderOrder = -100;
    sky.name = 'sky';
    this.group.add(sky);
  }

  /** No scenery: the look waits for the world's concept image. */
  buildScenery(_track: TrackData, _props: GLTF | null): void {}

  setDensity(_fraction: number): void {}

  /** The sky dome follows the camera, so it never clips. */
  update(camera: THREE.Camera, _time: number): void {
    this.group.position.copy(camera.position);
  }

  dispose(): void {
    this.skyGeo.dispose();
    this.skyMat.dispose();
    this.group.clear();
  }
}
