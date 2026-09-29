import * as THREE from 'three';
import type { ShipId } from '../core/contracts';
import type { ShipModel } from './ShipModel';

const MAX_POINTS = 4096;
const MAX_SPARKS = 1024;
const RING_COUNT = 5;

// per-particle scalar layout (points)
const P_STRIDE = 15;
const P_VX = 0,
  P_VY = 1,
  P_VZ = 2,
  P_AGE = 3,
  P_LIFE = 4,
  P_S0 = 5,
  P_S1 = 6,
  P_R0 = 7,
  P_G0 = 8,
  P_B0 = 9,
  P_R1 = 10,
  P_G1 = 11,
  P_B1 = 12,
  P_A0 = 13,
  P_DRAG = 14;

// per-spark scalar layout
const S_STRIDE = 11;
const S_VX = 0,
  S_VY = 1,
  S_VZ = 2,
  S_AGE = 3,
  S_LIFE = 4,
  S_R = 5,
  S_G = 6,
  S_B = 7,
  S_DRAG = 8,
  S_GRAV = 9,
  S_TRAIL = 10;

const POINT_VERT = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aSize * uScale / max(-mv.z, 0.1), 220.0);
  }
`;

const POINT_FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    float f = exp(-r * r * 3.2) * (1.0 - smoothstep(0.85, 1.0, r));
    gl_FragColor = vec4(vColor.rgb, vColor.a * f);
  }
`;

const SPARK_VERT = /* glsl */ `
  attribute vec4 aColor;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SPARK_FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    gl_FragColor = vColor;
  }
`;

interface ShipEmitter {
  prev: [THREE.Vector3, THREE.Vector3];
  havePrev: boolean;
  pitAcc: number;
}

const rnd = Math.random;
const rs = (): number => rnd() * 2 - 1;

/**
 * Pooled GPU-friendly particles: one Points system for glows (exhaust, boost flame,
 * explosion fireball, pit shimmer), one LineSegments system for spark streaks, and a
 * small pool of additive shock rings. Nothing allocates per frame.
 */
export class Effects {
  readonly group = new THREE.Group();

  // glow points
  private readonly pCount = { n: 0 };
  private readonly pPos = new Float32Array(MAX_POINTS * 3);
  private readonly pData = new Float32Array(MAX_POINTS * P_STRIDE);
  private readonly pColorOut = new Float32Array(MAX_POINTS * 4);
  private readonly pSizeOut = new Float32Array(MAX_POINTS);
  private readonly pGeo = new THREE.BufferGeometry();
  private readonly pMat: THREE.ShaderMaterial;
  private readonly points: THREE.Points;

  // sparks
  private sCount = 0;
  private readonly sPos = new Float32Array(MAX_SPARKS * 3);
  private readonly sData = new Float32Array(MAX_SPARKS * S_STRIDE);
  private readonly sVertOut = new Float32Array(MAX_SPARKS * 6);
  private readonly sColorOut = new Float32Array(MAX_SPARKS * 8);
  private readonly sGeo = new THREE.BufferGeometry();
  private readonly sMat: THREE.ShaderMaterial;
  private readonly sparks: THREE.LineSegments;

  // rings
  private readonly ringGeo = new THREE.RingGeometry(0.8, 1, 72);
  private readonly rings: THREE.Mesh[] = [];
  private readonly ringMats: THREE.MeshBasicMaterial[] = [];
  private readonly ringAge = new Float32Array(RING_COUNT);
  private readonly ringLife = new Float32Array(RING_COUNT);
  private readonly ringScale = new Float32Array(RING_COUNT);
  private readonly ringBase = new Float32Array(RING_COUNT);
  private nextRing = 0;

  private readonly emitters = new Map<ShipId, ShipEmitter>();
  private camera: THREE.PerspectiveCamera | null = null;

  // scratch
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();

  constructor() {
    const pPosAttr = new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage);
    const pColAttr = new THREE.BufferAttribute(this.pColorOut, 4).setUsage(THREE.DynamicDrawUsage);
    const pSizeAttr = new THREE.BufferAttribute(this.pSizeOut, 1).setUsage(THREE.DynamicDrawUsage);
    this.pGeo.setAttribute('position', pPosAttr);
    this.pGeo.setAttribute('aColor', pColAttr);
    this.pGeo.setAttribute('aSize', pSizeAttr);
    this.pGeo.setDrawRange(0, 0);
    this.pMat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: { uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.pGeo, this.pMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.group.add(this.points);

    this.sGeo.setAttribute('position', new THREE.BufferAttribute(this.sVertOut, 3).setUsage(THREE.DynamicDrawUsage));
    this.sGeo.setAttribute('aColor', new THREE.BufferAttribute(this.sColorOut, 4).setUsage(THREE.DynamicDrawUsage));
    this.sGeo.setDrawRange(0, 0);
    this.sMat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sparks = new THREE.LineSegments(this.sGeo, this.sMat);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 11;
    this.group.add(this.sparks);

    for (let i = 0; i < RING_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const m = new THREE.Mesh(this.ringGeo, mat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 12;
      this.rings.push(m);
      this.ringMats.push(mat);
      this.group.add(m);
    }
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  addShip(model: ShipModel): void {
    this.emitters.set(model.ship.def.id, {
      prev: [new THREE.Vector3(), new THREE.Vector3()],
      havePrev: false,
      pitAcc: 0,
    });
  }

  reset(): void {
    this.pCount.n = 0;
    this.sCount = 0;
    this.pGeo.setDrawRange(0, 0);
    this.sGeo.setDrawRange(0, 0);
    for (let i = 0; i < RING_COUNT; i++) {
      this.rings[i].visible = false;
      this.ringAge[i] = this.ringLife[i] = 0;
    }
    for (const e of this.emitters.values()) {
      e.havePrev = false;
      e.pitAcc = 0;
    }
  }

  // ------------------------------------------------------------------
  // spawning primitives
  // ------------------------------------------------------------------

  private spawnPoint(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, s0: number, s1: number,
    r0: number, g0: number, b0: number,
    r1: number, g1: number, b1: number,
    a0: number, drag: number,
  ): void {
    const i = this.pCount.n;
    if (i >= MAX_POINTS) return;
    this.pCount.n = i + 1;
    const p = i * 3;
    this.pPos[p] = x;
    this.pPos[p + 1] = y;
    this.pPos[p + 2] = z;
    const d = i * P_STRIDE;
    const a = this.pData;
    a[d + P_VX] = vx;
    a[d + P_VY] = vy;
    a[d + P_VZ] = vz;
    a[d + P_AGE] = 0;
    a[d + P_LIFE] = life;
    a[d + P_S0] = s0;
    a[d + P_S1] = s1;
    a[d + P_R0] = r0;
    a[d + P_G0] = g0;
    a[d + P_B0] = b0;
    a[d + P_R1] = r1;
    a[d + P_G1] = g1;
    a[d + P_B1] = b1;
    a[d + P_A0] = a0;
    a[d + P_DRAG] = drag;
  }

  private spawnSpark(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, r: number, g: number, b: number,
    drag: number, grav: number, trail: number,
  ): void {
    const i = this.sCount;
    if (i >= MAX_SPARKS) return;
    this.sCount = i + 1;
    const p = i * 3;
    this.sPos[p] = x;
    this.sPos[p + 1] = y;
    this.sPos[p + 2] = z;
    const d = i * S_STRIDE;
    const a = this.sData;
    a[d + S_VX] = vx;
    a[d + S_VY] = vy;
    a[d + S_VZ] = vz;
    a[d + S_AGE] = 0;
    a[d + S_LIFE] = life;
    a[d + S_R] = r;
    a[d + S_G] = g;
    a[d + S_B] = b;
    a[d + S_DRAG] = drag;
    a[d + S_GRAV] = grav;
    a[d + S_TRAIL] = trail;
  }

  private spawnRing(pos: THREE.Vector3, quat: THREE.Quaternion, maxScale: number, life: number, r: number, g: number, b: number, opacity: number): void {
    const i = this.nextRing;
    this.nextRing = (i + 1) % RING_COUNT;
    const m = this.rings[i];
    m.position.copy(pos);
    m.quaternion.copy(quat);
    m.scale.setScalar(0.1);
    m.visible = true;
    this.ringMats[i].color.setRGB(r, g, b);
    this.ringMats[i].opacity = opacity;
    this.ringAge[i] = 0;
    this.ringLife[i] = life;
    this.ringScale[i] = maxScale;
    this.ringBase[i] = opacity;
  }

  // ------------------------------------------------------------------
  // event-driven effects
  // ------------------------------------------------------------------

  /** Sparks where a ship scrapes/hits a rail. intensity 0..1. */
  railSparks(point: THREE.Vector3, normal: THREE.Vector3, intensity: number, shipVel: THREE.Vector3 | null): void {
    const n = 3 + Math.floor(intensity * 16);
    const inherit = shipVel ? 0.55 : 0;
    for (let i = 0; i < n; i++) {
      this.v1.set(rs(), rs(), rs()).multiplyScalar(0.9).addScaledVector(normal, 0.5 + rnd() * 1.2).normalize();
      const sp = 5 + rnd() * 24 * (0.4 + intensity);
      const vx = this.v1.x * sp + (shipVel ? shipVel.x * inherit : 0);
      const vy = this.v1.y * sp + (shipVel ? shipVel.y * inherit : 0);
      const vz = this.v1.z * sp + (shipVel ? shipVel.z * inherit : 0);
      const hot = rnd();
      this.spawnSpark(point.x, point.y, point.z, vx, vy, vz, 0.22 + rnd() * 0.45, 3.4, 1.5 + hot * 1.6, 0.35 + hot * 0.8, 1.4, 10, 0.05);
    }
    this.spawnPoint(point.x, point.y, point.z, 0, 0, 0, 0.14, 1.4 + intensity, 0.4, 3.2, 1.9, 0.8, 1.6, 0.5, 0.2, 0.9, 0);
  }

  /** Cyan-white sparks for ship-ship contact. */
  shipHit(point: THREE.Vector3, intensity: number): void {
    const n = 8 + Math.floor(intensity * 22);
    for (let i = 0; i < n; i++) {
      this.v1.set(rs(), rs(), rs()).normalize();
      const sp = 6 + rnd() * 26 * (0.4 + intensity);
      this.spawnSpark(point.x, point.y, point.z, this.v1.x * sp, this.v1.y * sp, this.v1.z * sp, 0.2 + rnd() * 0.4, 1.6, 3.0, 3.4, 1.6, 6, 0.05);
    }
    this.spawnPoint(point.x, point.y, point.z, 0, 0, 0, 0.16, 2.2, 0.6, 2.4, 3.0, 3.6, 0.8, 1.2, 1.8, 0.9, 0);
  }

  /** Flame burst from both nozzles + shock ring + streaming sparks. */
  boostBurst(model: ShipModel): void {
    const g = model.glowColor;
    const ship = model.ship;
    for (let n = 0; n < 2; n++) {
      const np = model.nozzleWorld[n];
      for (let i = 0; i < 18; i++) {
        const sp = 15 + rnd() * 25;
        this.spawnPoint(
          np.x, np.y, np.z,
          ship.velocity.x * 0.4 + model.exhaustDir.x * sp + rs() * 3,
          ship.velocity.y * 0.4 + model.exhaustDir.y * sp + rs() * 3,
          ship.velocity.z * 0.4 + model.exhaustDir.z * sp + rs() * 3,
          0.3 + rnd() * 0.25, 1.7, 0.3, 4.2, 3.4, 2.2, g.r * 0.9, g.g * 0.9, g.b * 0.9, 0.9, 1.5,
        );
      }
      for (let i = 0; i < 8; i++) {
        const sp = 40 + rnd() * 45;
        this.spawnSpark(
          np.x, np.y, np.z,
          model.exhaustDir.x * sp + rs() * 4 + ship.velocity.x * 0.3,
          model.exhaustDir.y * sp + rs() * 4 + ship.velocity.y * 0.3,
          model.exhaustDir.z * sp + rs() * 4 + ship.velocity.z * 0.3,
          0.3 + rnd() * 0.2, g.r * 3 + 1, g.g * 3 + 0.8, g.b * 3 + 0.6, 1.2, 0, 0.06,
        );
      }
    }
    this.v1.copy(model.pos).addScaledVector(model.exhaustDir, 1.8);
    this.spawnRing(this.v1, model.visQuat, 7, 0.35, g.r * 2.5 + 0.4, g.g * 2.5 + 0.4, g.b * 2.5 + 0.4, 0.8);
  }

  /** Dash pad flash: bright bloom at the nose, ring and streaks. */
  dashFlash(model: ShipModel): void {
    const g = model.glowColor;
    this.v1.set(0, 0, -1).applyQuaternion(model.visQuat);
    this.v2.copy(model.pos).addScaledVector(this.v1, 2.2);
    this.spawnPoint(this.v2.x, this.v2.y, this.v2.z, 0, 0, 0, 0.28, 8, 12, 3.5, 3.5, 4, g.r, g.g, g.b, 0.9, 0);
    for (let i = 0; i < 22; i++) {
      this.v3.set(rs() * 0.6, rs() * 0.6, rs() * 0.6).addScaledVector(this.v1, -1).normalize();
      const sp = 25 + rnd() * 55;
      this.spawnSpark(this.v2.x, this.v2.y, this.v2.z, this.v3.x * sp, this.v3.y * sp, this.v3.z * sp, 0.3 + rnd() * 0.25, 1.8, 3.0, 3.6, 1.3, 0, 0.06);
    }
    this.spawnRing(this.v2, model.visQuat, 9, 0.4, 1.6, 2.6, 3.2, 0.9);
  }

  /** Fireball, embers, debris and shock rings at a destroyed ship. */
  explosion(pos: THREE.Vector3, shipVel: THREE.Vector3 | null): void {
    const ix = shipVel ? shipVel.x * 0.5 : 0;
    const iy = shipVel ? shipVel.y * 0.5 : 0;
    const iz = shipVel ? shipVel.z * 0.5 : 0;
    this.spawnPoint(pos.x, pos.y, pos.z, ix, iy, iz, 0.2, 14, 22, 5, 4, 3, 3, 1, 0.5, 0.9, 0);
    for (let i = 0; i < 28; i++) {
      this.v1.set(rs(), rs(), rs()).normalize();
      const sp = 3 + rnd() * 13;
      const life = 0.7 + rnd() * 0.8;
      this.spawnPoint(
        pos.x + this.v1.x * 0.8, pos.y + this.v1.y * 0.8, pos.z + this.v1.z * 0.8,
        this.v1.x * sp + ix, this.v1.y * sp + iy, this.v1.z * sp + iz,
        life, 2.5 + rnd() * 2, 8 + rnd() * 5, 4.5, 2.4 + rnd(), 0.9, 0.5, 0.06, 0.02, 1, 2.2,
      );
    }
    for (let i = 0; i < 22; i++) {
      this.v1.set(rs(), rs(), rs()).normalize();
      const sp = 10 + rnd() * 30;
      this.spawnPoint(
        pos.x, pos.y, pos.z, this.v1.x * sp + ix, this.v1.y * sp + iy, this.v1.z * sp + iz,
        0.9 + rnd() * 1.1, 0.5, 0.15, 3.5, 1.6, 0.5, 1.0, 0.2, 0.05, 1, 0.6,
      );
    }
    for (let i = 0; i < 90; i++) {
      this.v1.set(rs(), rs(), rs()).normalize();
      const sp = 14 + rnd() * 50;
      const hot = rnd();
      this.spawnSpark(pos.x, pos.y, pos.z, this.v1.x * sp + ix, this.v1.y * sp + iy, this.v1.z * sp + iz, 0.7 + rnd() * 1.0, 3.4, 1.3 + hot * 1.6, 0.3 + hot * 0.8, 0.7, 8, 0.05);
    }
    if (this.camera) this.q1.copy(this.camera.quaternion);
    else this.q1.identity();
    this.spawnRing(pos, this.q1, 34, 0.8, 4, 2.4, 1.0, 0.9);
    this.q1.setFromAxisAngle(this.v2.set(1, 0, 0), -Math.PI / 2);
    this.spawnRing(pos, this.q1, 26, 0.7, 3.2, 1.6, 0.7, 0.8);
  }

  // ------------------------------------------------------------------
  // per-frame
  // ------------------------------------------------------------------

  update(dt: number, viewHeightPx: number, models: readonly ShipModel[]): void {
    if (this.camera) {
      const fov = (this.camera.fov * Math.PI) / 180;
      this.pMat.uniforms.uScale.value = viewHeightPx / (2 * Math.tan(fov / 2));
    }
    for (const m of models) this.emitForShip(m, dt);
    this.stepPoints(dt);
    this.stepSparks(dt);
    this.stepRings(dt);
  }

  private emitForShip(m: ShipModel, dt: number): void {
    const em = this.emitters.get(m.ship.def.id);
    if (!em) return;
    if (!m.visible) {
      em.havePrev = false;
      return;
    }
    const ship = m.ship;
    const live = ship.status === 'racing' || ship.status === 'finished';
    const thr = live ? ship.lastControls.throttle : 0;
    const g = m.glowColor;
    const isPlayer = ship.def.isPlayer;

    if (thr > 0.05 || ship.boosting || ship.speed > 25) {
      const intensity = ship.boosting ? 1 : 0.28 + 0.72 * thr;
      const spacing = isPlayer ? 0.32 : 0.55;
      for (let n = 0; n < 2; n++) {
        const cur = m.nozzleWorld[n];
        const prev = em.prev[n];
        let steps = 1;
        if (em.havePrev) {
          const dist = cur.distanceTo(prev);
          steps = dist > 80 ? 1 : Math.min(16, Math.max(1, Math.ceil(dist / spacing)));
          if (dist > 80) prev.copy(cur);
        } else {
          prev.copy(cur);
        }
        for (let s = 1; s <= steps; s++) {
          const f = s / steps;
          const x = prev.x + (cur.x - prev.x) * f;
          const y = prev.y + (cur.y - prev.y) * f;
          const z = prev.z + (cur.z - prev.z) * f;
          const back = 4 + rnd() * 4;
          this.spawnPoint(
            x, y, z,
            ship.velocity.x * 0.1 + m.exhaustDir.x * back + rs() * 0.6,
            ship.velocity.y * 0.1 + m.exhaustDir.y * back + rs() * 0.6,
            ship.velocity.z * 0.1 + m.exhaustDir.z * back + rs() * 0.6,
            0.28 + rnd() * 0.25, 0.55 + rnd() * 0.2, 0.15,
            g.r * 2.2 * intensity + 0.15, g.g * 2.2 * intensity + 0.15, g.b * 2.2 * intensity + 0.15,
            g.r * 0.25, g.g * 0.25, g.b * 0.25,
            (isPlayer ? 0.5 : 0.4) * intensity, 0.8,
          );
        }
        if (ship.boosting) {
          const k = isPlayer ? 3 : 2;
          for (let i = 0; i < k; i++) {
            const sp = 14 + rnd() * 8;
            this.spawnPoint(
              cur.x, cur.y, cur.z,
              ship.velocity.x * 0.75 + m.exhaustDir.x * sp + rs(),
              ship.velocity.y * 0.75 + m.exhaustDir.y * sp + rs(),
              ship.velocity.z * 0.75 + m.exhaustDir.z * sp + rs(),
              0.16 + rnd() * 0.18, 1.0 + rnd() * 0.3, 0.25,
              4.0, 3.2, 2.0, g.r * 1.4, g.g * 1.4, g.b * 1.4, 0.85, 1.0,
            );
          }
        }
        prev.copy(cur);
      }
      em.havePrev = true;
    } else {
      em.havePrev = false;
    }

    // pit recharge shimmer
    if (ship.inPit) {
      em.pitAcc += dt * 60;
      this.v3.set(0, 1, 0).applyQuaternion(m.quat);
      while (em.pitAcc >= 1) {
        em.pitAcc -= 1;
        this.v1.set(rs() * 1.8, -0.9 + rnd() * 0.6, rs() * 2.6).applyQuaternion(m.quat).add(m.pos);
        const up = 2.5 + rnd() * 2.5;
        this.spawnPoint(
          this.v1.x, this.v1.y, this.v1.z,
          ship.velocity.x + this.v3.x * up, ship.velocity.y + this.v3.y * up, ship.velocity.z + this.v3.z * up,
          0.6 + rnd() * 0.5, 0.35 + rnd() * 0.2, 0.08,
          0.4, 3.0, 1.8, 0.2, 1.0, 1.6, 0.85, 0.5,
        );
      }
    } else {
      em.pitAcc = 0;
    }
  }

  private stepPoints(dt: number): void {
    const a = this.pData;
    const pos = this.pPos;
    const colOut = this.pColorOut;
    const sizeOut = this.pSizeOut;
    let n = this.pCount.n;
    for (let i = 0; i < n; ) {
      const d = i * P_STRIDE;
      const age = a[d + P_AGE] + dt;
      const life = a[d + P_LIFE];
      if (age >= life) {
        n--;
        if (i !== n) {
          a.copyWithin(d, n * P_STRIDE, n * P_STRIDE + P_STRIDE);
          pos.copyWithin(i * 3, n * 3, n * 3 + 3);
        }
        continue;
      }
      a[d + P_AGE] = age;
      const drag = Math.max(0, 1 - a[d + P_DRAG] * dt);
      const vx = (a[d + P_VX] *= drag);
      const vy = (a[d + P_VY] *= drag);
      const vz = (a[d + P_VZ] *= drag);
      const p = i * 3;
      pos[p] += vx * dt;
      pos[p + 1] += vy * dt;
      pos[p + 2] += vz * dt;
      const t = age / life;
      const o = i * 4;
      colOut[o] = a[d + P_R0] + (a[d + P_R1] - a[d + P_R0]) * t;
      colOut[o + 1] = a[d + P_G0] + (a[d + P_G1] - a[d + P_G0]) * t;
      colOut[o + 2] = a[d + P_B0] + (a[d + P_B1] - a[d + P_B0]) * t;
      const fadeIn = Math.min(1, age * 14);
      const inv = 1 - t;
      colOut[o + 3] = a[d + P_A0] * inv * Math.sqrt(inv) * fadeIn;
      sizeOut[i] = a[d + P_S0] + (a[d + P_S1] - a[d + P_S0]) * t;
      i++;
    }
    this.pCount.n = n;
    this.pGeo.setDrawRange(0, n);
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.aColor.needsUpdate = true;
    this.pGeo.attributes.aSize.needsUpdate = true;
    this.points.visible = n > 0;
  }

  private stepSparks(dt: number): void {
    const a = this.sData;
    const pos = this.sPos;
    const vOut = this.sVertOut;
    const cOut = this.sColorOut;
    let n = this.sCount;
    for (let i = 0; i < n; ) {
      const d = i * S_STRIDE;
      const age = a[d + S_AGE] + dt;
      const life = a[d + S_LIFE];
      if (age >= life) {
        n--;
        if (i !== n) {
          a.copyWithin(d, n * S_STRIDE, n * S_STRIDE + S_STRIDE);
          pos.copyWithin(i * 3, n * 3, n * 3 + 3);
        }
        continue;
      }
      a[d + S_AGE] = age;
      const drag = Math.max(0, 1 - a[d + S_DRAG] * dt);
      const vx = (a[d + S_VX] *= drag);
      a[d + S_VY] = a[d + S_VY] * drag - a[d + S_GRAV] * dt;
      const vy = a[d + S_VY];
      const vz = (a[d + S_VZ] *= drag);
      const p = i * 3;
      const px = (pos[p] += vx * dt);
      const py = (pos[p + 1] += vy * dt);
      const pz = (pos[p + 2] += vz * dt);
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-3;
      const tl = Math.min(a[d + S_TRAIL], 3.5 / speed);
      const o = i * 6;
      vOut[o] = px;
      vOut[o + 1] = py;
      vOut[o + 2] = pz;
      vOut[o + 3] = px - vx * tl;
      vOut[o + 4] = py - vy * tl;
      vOut[o + 5] = pz - vz * tl;
      const t = age / life;
      const alpha = (1 - t) * (1 - t);
      const c = i * 8;
      cOut[c] = a[d + S_R];
      cOut[c + 1] = a[d + S_G];
      cOut[c + 2] = a[d + S_B];
      cOut[c + 3] = alpha;
      cOut[c + 4] = a[d + S_R];
      cOut[c + 5] = a[d + S_G];
      cOut[c + 6] = a[d + S_B];
      cOut[c + 7] = 0;
      i++;
    }
    this.sCount = n;
    this.sGeo.setDrawRange(0, n * 2);
    this.sGeo.attributes.position.needsUpdate = true;
    this.sGeo.attributes.aColor.needsUpdate = true;
    this.sparks.visible = n > 0;
  }

  private stepRings(dt: number): void {
    for (let i = 0; i < RING_COUNT; i++) {
      if (!this.rings[i].visible) continue;
      const age = this.ringAge[i] + dt;
      const life = this.ringLife[i];
      if (age >= life) {
        this.rings[i].visible = false;
        continue;
      }
      this.ringAge[i] = age;
      const t = age / life;
      const inv = 1 - t;
      this.rings[i].scale.setScalar(0.1 + this.ringScale[i] * (1 - inv * inv * inv));
      this.ringMats[i].opacity = this.ringBase[i] * inv * inv;
    }
  }

  dispose(): void {
    this.pGeo.dispose();
    this.pMat.dispose();
    this.sGeo.dispose();
    this.sMat.dispose();
    this.ringGeo.dispose();
    for (const m of this.ringMats) m.dispose();
    this.group.clear();
  }
}
