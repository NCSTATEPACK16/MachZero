/**
 * Weather particles (IMPLEMENTATION §X2): rain, snow, embers, spores, dust, bubbles, meteors. One instanced
 * quad mesh in a box that follows the camera. Each particle's position is a pure function of its seed and the
 * time, wrapped into the box in the vertex shader, so there is no per-frame CPU work and one draw call.
 * Streaks stretch along the particle's motion relative to the camera, so rain rushes past at speed.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import type { WeatherSpec } from './EnvFxSpec';

/** Box the particles live in, centred on the camera (m). */
const BOX = new THREE.Vector3(90, 50, 90);

const VERT = /* glsl */ `
  attribute vec3 aSeed;
  attribute float aPhase;
  uniform float uTime;
  uniform vec3 uBox;
  uniform vec3 uVel;      // world velocity of the weather (wind.x, -fall, wind.z)
  uniform vec3 uCamVel;   // camera velocity, for the streak direction
  uniform float uSize;
  uniform float uStreak;
  uniform float uSway;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    // World position: seed + drift, wrapped into the box around the camera.
    vec3 p = aSeed * uBox + uVel * uTime;
    p.x += sin(uTime * (0.6 + aPhase) + aPhase * 40.0) * uSway;
    p.z += cos(uTime * (0.5 + aPhase * 0.7) + aPhase * 23.0) * uSway;
    p = mod(p - cameraPosition + 0.5 * uBox, uBox) - 0.5 * uBox + cameraPosition;

    vec3 rel = uVel - uCamVel;
    float sp = length(rel);
    vec3 dir = sp > 0.001 ? rel / sp : vec3(0.0, -1.0, 0.0);
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = cross(dir, toCam);
    float sl = length(side);
    side = sl > 0.001 ? side / sl : vec3(1.0, 0.0, 0.0);
    // Round sprite when there is no streak: a camera-facing square.
    float len = uStreak > 0.0 ? clamp(sp * uStreak, uSize, 3.5) : uSize;
    vec3 up = uStreak > 0.0 ? dir : normalize(cross(toCam, side));
    vec3 world = p + side * position.x * uSize + up * position.y * len;

    vUv = position.xy;
    vec3 d = (p - cameraPosition) / (0.5 * uBox);
    // Fade toward the box faces (no popping at the wrap) and just in front of the lens.
    float edge = 1.0 - smoothstep(0.7, 1.0, max(abs(d.x), max(abs(d.y), abs(d.z))));
    float near = smoothstep(1.5, 5.0, distance(p, cameraPosition));
    vFade = edge * near;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    // Soft across, and soft at both ends along.
    float a = (1.0 - smoothstep(0.2, 1.0, abs(vUv.x) * 2.0)) * (1.0 - smoothstep(0.3, 0.5, abs(vUv.y)));
    a *= vFade * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export class Weather {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly camVel = new THREE.Vector3();
  private readonly lastCam = new THREE.Vector3();
  private haveLast = false;

  constructor(spec: WeatherSpec, drawn: number) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const rng = new Rng(0x57ea7e42);
    const seeds = new Float32Array(spec.count * 3);
    const phase = new Float32Array(spec.count);
    for (let i = 0; i < spec.count; i++) {
      seeds[i * 3] = rng.next();
      seeds[i * 3 + 1] = rng.next();
      seeds[i * 3 + 2] = rng.next();
      phase[i] = rng.next();
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.instanceCount = Math.min(drawn, spec.count);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: BOX.clone() },
        uVel: { value: new THREE.Vector3(spec.wind[0], -spec.fall, spec.wind[1]) },
        uCamVel: { value: this.camVel },
        uSize: { value: spec.size },
        uStreak: { value: spec.streak },
        uSway: { value: spec.sway ?? 0 },
        uColor: { value: new THREE.Color(spec.color) },
        uOpacity: { value: spec.opacity },
      },
      transparent: true,
      depthWrite: false,
      // Premultiplied additive: bright against dark skies, never darkens the scene.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = `weather:${spec.kind}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  /** Particles drawn (quality). */
  setDrawn(n: number): void {
    this.geo.instanceCount = Math.max(0, Math.min(n, this.geo.getAttribute('aSeed').count));
  }

  setStreak(seconds: number): void {
    this.mat.uniforms.uStreak.value = seconds;
  }

  /** Horizontal drift (m/s): a track's wind zone slants the rain with its gust. */
  setWind(x: number, z: number): void {
    const v = this.mat.uniforms.uVel.value as THREE.Vector3;
    v.x = x;
    v.z = z;
  }

  update(camera: THREE.Camera, time: number, dt: number): void {
    this.mat.uniforms.uTime.value = time;
    if (this.haveLast && dt > 1e-4) {
      // Smoothed camera velocity; a teleport (respawn, new race) is ignored.
      const vx = (camera.position.x - this.lastCam.x) / dt;
      const vy = (camera.position.y - this.lastCam.y) / dt;
      const vz = (camera.position.z - this.lastCam.z) / dt;
      if (vx * vx + vy * vy + vz * vz < 400 * 400) {
        const k = Math.min(1, dt * 8);
        this.camVel.x += (vx - this.camVel.x) * k;
        this.camVel.y += (vy - this.camVel.y) * k;
        this.camVel.z += (vz - this.camVel.z) * k;
      }
    }
    this.lastCam.copy(camera.position);
    this.haveLast = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
