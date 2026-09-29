import * as THREE from 'three';
import { clamp01, damp, smoothstep } from '../core/math';

const VERT = /* glsl */ `
  attribute float aFade;
  attribute float aBright;
  varying float vFade;
  void main() {
    vFade = aFade * aBright;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity * vFade);
  }
`;

/**
 * Velocity-scaled streaks in a cylinder around the camera's forward axis.
 * Streaks are world-space, drift opposite to the player's velocity, and are
 * recycled ahead of the camera. One draw call (LineSegments), additive.
 */
export class SpeedLines {
  readonly object: THREE.LineSegments;
  private readonly count: number;
  private readonly center: Float32Array; // world-space streak centre (x,y,z)
  private readonly seed: Float32Array;
  private readonly positions: Float32Array;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private readonly cyan = new THREE.Color(1.0, 1.0, 1.0);
  private readonly amber = new THREE.Color(1.9, 1.05, 0.3);
  private boostBlend = 0;

  // scratch
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(count = 340) {
    this.count = count;
    this.center = new Float32Array(count * 3);
    this.seed = new Float32Array(count * 4);
    this.positions = new Float32Array(count * 6);
    const fade = new Float32Array(count * 2);
    const bright = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      // vertex 0 = near end (bright), vertex 1 = far end (transparent)
      fade[i * 2] = 1;
      fade[i * 2 + 1] = 0;
      const b = 0.35 + Math.random() * 0.65;
      bright[i * 2] = b;
      bright[i * 2 + 1] = b;
      this.seed[i * 4] = Math.random(); // angle
      this.seed[i * 4 + 1] = Math.random(); // radius
      this.seed[i * 4 + 2] = Math.random(); // distance
      this.seed[i * 4 + 3] = 0.6 + Math.random() * 0.8; // length scale
      // start parked far behind so the first update recycles it
      this.center[i * 3 + 1] = -1e5;
    }
    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
    this.geometry.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.object = new THREE.LineSegments(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 20;
    this.object.visible = false;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, velocity: THREE.Vector3, speed: number, boosting: boolean): void {
    const sf = clamp01((speed - 50) / 110);
    this.boostBlend = damp(this.boostBlend, boosting ? 1 : 0, 6, dt);
    if (sf <= 0.001) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;

    const active = Math.max(1, Math.floor(this.count * (0.25 + 0.75 * sf)));
    this.geometry.setDrawRange(0, active * 2);
    const opacity = 0.85 * smoothstep(0, 1, sf) * (1 + 0.25 * this.boostBlend);
    this.material.uniforms.uOpacity.value = opacity;
    (this.material.uniforms.uColor.value as THREE.Color).lerpColors(this.cyan, this.amber, this.boostBlend);

    camera.getWorldDirection(this.fwd);
    this.up.copy(camera.up);
    this.right.crossVectors(this.fwd, this.up).normalize();
    this.up.crossVectors(this.right, this.fwd).normalize();
    if (speed > 1) this.dir.copy(velocity).multiplyScalar(1 / speed);
    else this.dir.copy(this.fwd);

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const drift = speed * 0.35 * dt;
    const len = Math.min(10, speed * 0.05) * (1 + 0.4 * this.boostBlend);

    const c = this.center;
    const s = this.seed;
    const pos = this.positions;
    for (let i = 0; i < active; i++) {
      const i3 = i * 3;
      let x = c[i3] - this.dir.x * drift;
      let y = c[i3 + 1] - this.dir.y * drift;
      let z = c[i3 + 2] - this.dir.z * drift;
      let rx = x - cx;
      let ry = y - cy;
      let rz = z - cz;
      let along = rx * this.fwd.x + ry * this.fwd.y + rz * this.fwd.z;
      if (along < -4 || along > 150) {
        // recycle ahead of the camera in a fresh cylinder position
        const a = Math.random() * Math.PI * 2;
        const rad = 3.6 + Math.random() * 17;
        const d = 25 + Math.random() * 120;
        const ca = Math.cos(a) * rad;
        const sa = Math.sin(a) * rad;
        rx = this.fwd.x * d + this.right.x * ca + this.up.x * sa;
        ry = this.fwd.y * d + this.right.y * ca + this.up.y * sa;
        rz = this.fwd.z * d + this.right.z * ca + this.up.z * sa;
        x = cx + rx;
        y = cy + ry;
        z = cz + rz;
        s[i * 4 + 3] = 0.6 + Math.random() * 0.8;
        along = d;
      }
      c[i3] = x;
      c[i3 + 1] = y;
      c[i3 + 2] = z;
      const l = len * s[i * 4 + 3];
      const o = i * 6;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      pos[o + 3] = x + this.dir.x * l;
      pos[o + 4] = y + this.dir.y * l;
      pos[o + 5] = z + this.dir.z * l;
    }
    this.positionAttr.needsUpdate = true;
  }

  reset(): void {
    this.center.fill(0);
    for (let i = 0; i < this.count; i++) this.center[i * 3 + 1] = -1e5;
    this.boostBlend = 0;
    this.object.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
