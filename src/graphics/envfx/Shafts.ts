/**
 * Light shafts (IMPLEMENTATION §X2): additive cards beside the track, leaning toward the sun, in one
 * instanced draw call. Each card fades at its edges and when seen edge-on, so it reads as a beam of light
 * in haze, not as a plane. Cheap god rays: no screen-space pass.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import type { TrackData } from '../../core/contracts';
import { nearestTrack, planBounds, trackPlan } from '../themes/WorldTheme';
import type { ShaftsSpec } from './EnvFxSpec';

/** Shafts stand at least this far from the centreline (m). */
const CLEAR = 70;

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * vec3(0.0, 0.0, 1.0));
    vFacing = abs(dot(n, normalize(cameraPosition - w.xyz)));
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
    float a = across * across * along * smoothstep(0.1, 0.6, vFacing) * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export class Shafts {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly total: number;

  constructor(spec: ShaftsSpec, drawn: number, track: TrackData, sunDirection: THREE.Vector3) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0); // stands on its base
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color(spec.color) }, uOpacity: { value: spec.opacity } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      toneMapped: false,
    });
    this.total = spec.count;
    this.mesh = new THREE.InstancedMesh(geo, this.mat, spec.count);
    this.mesh.name = 'lightShafts';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;

    // Deterministic per track; placed in random order so a smaller count is a uniform subset.
    const rng = new Rng((track.seed ^ 0x5a17f7) >>> 0);
    const plan = trackPlan(track);
    const b = planBounds(plan);
    const lean = new THREE.Vector3(sunDirection.x, 0, sunDirection.z);
    if (lean.lengthSq() < 1e-6) lean.set(1, 0, 0);
    lean.normalize();
    const yaw = Math.atan2(lean.x, lean.z);
    const q = new THREE.Quaternion();
    const qLean = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    let placed = 0;
    for (let k = 0; k < spec.count * 80 && placed < spec.count; k++) {
      const x = rng.range(b.minX - 260, b.maxX + 260);
      const z = rng.range(b.minZ - 260, b.maxZ + 260);
      const near = nearestTrack(plan, x, z);
      if (near.dist < CLEAR || near.dist > 320) continue;
      // Face across the sun's heading so the lean is in the card's plane; tilt the top toward the sun.
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2 + rng.range(-0.3, 0.3));
      qLean.setFromAxisAngle(new THREE.Vector3(lean.z, 0, -lean.x), spec.angle);
      q.premultiply(qLean);
      pos.set(x, near.y - spec.height * 0.25, z);
      scale.set(spec.width * rng.range(0.7, 1.4), spec.height * rng.range(0.8, 1.2), 1);
      m.compose(pos, q, scale);
      this.mesh.setMatrixAt(placed++, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.placed = placed;
    this.setDrawn(drawn);
  }

  private readonly placed: number;

  setDrawn(n: number): void {
    this.mesh.count = Math.max(0, Math.min(n, this.placed, this.total));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
