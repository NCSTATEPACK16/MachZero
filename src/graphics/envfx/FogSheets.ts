/**
 * Height fog (IMPLEMENTATION §X2): up to three large horizontal sheets of drifting mist at a world height,
 * in one instanced draw call. They follow the camera in plan, thin out with distance and fade as the eye
 * comes level with them, so a sheet never shows as a hard plane.
 *
 * Deviation from the plan, recorded in §X2's as-built notes: this is drawn geometry, not a height term in
 * every material's fog (that would mean patching every lit and custom shader in the scene).
 */
import * as THREE from 'three';
import type { HeightFogSpec } from './EnvFxSpec';

const SIZE = 5000;

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uDensity;
  uniform float uFalloff;
  uniform float uScale;
  uniform vec2 uDrift;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec2 q = (vWorld.xz + uDrift) / uScale;
    float n = noise(q) * 0.6 + noise(q * 2.3 + 7.1) * 0.4;
    float banks = smoothstep(0.25, 0.8, n);
    float dist = distance(vWorld.xz, cameraPosition.xz);
    float far = 1.0 - smoothstep(${(SIZE * 0.3).toFixed(1)}, ${(SIZE * 0.48).toFixed(1)}, dist);
    // Fade as the eye nears the sheet's height, and close to the camera (no plane edge cutting the view).
    float level = smoothstep(0.0, uFalloff, abs(cameraPosition.y - vWorld.y));
    float near = smoothstep(20.0, 160.0, dist);
    float a = uDensity * banks * far * level * near;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class FogSheets {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly drift = new THREE.Vector2();
  private readonly speed: number;
  private moving: boolean;
  private readonly base: number;
  private readonly falloff: number;
  private readonly m = new THREE.Matrix4();

  constructor(spec: HeightFogSpec, sheets: number, moving: boolean) {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(spec.color) },
        uDensity: { value: spec.density },
        uFalloff: { value: Math.max(1, spec.falloff) },
        uScale: { value: spec.bankScale ?? 600 },
        uDrift: { value: this.drift },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, 3);
    this.mesh.name = 'heightFog';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.base = spec.base;
    this.falloff = Math.max(1, spec.falloff);
    this.speed = spec.bankSpeed ?? 4;
    this.moving = moving;
    this.setSheets(sheets);
  }

  setSheets(n: number): void {
    this.mesh.count = Math.max(1, Math.min(3, n));
  }

  setMoving(on: boolean): void {
    this.moving = on;
  }

  update(camera: THREE.Camera, time: number): void {
    if (this.moving) this.drift.set(time * this.speed, time * this.speed * 0.4);
    for (let i = 0; i < this.mesh.count; i++) {
      this.m.makeTranslation(camera.position.x, this.base - i * this.falloff * 0.6, camera.position.z);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
