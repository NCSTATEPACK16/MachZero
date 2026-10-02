import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../core/config';
import type { ShipState } from '../core/contracts';
import { clamp, clamp01, damp } from '../core/math';
import { CLASS_SCALE, chassisById } from '../content/ships';
import type { AssembledShip, ShipLayout } from './ShipAssembly';

// ---------------------------------------------------------------------------
// Design table: six silhouettes (one per chassis; the v1 roster uses the first four by id).
// ---------------------------------------------------------------------------

interface Design {
  hullHW: number;
  hullTop: number;
  podX: number;
  podR: number;
  podZ0: number;
  podZ1: number;
  wingSweep: number;
  wingRoot: [number, number];
  finH: number;
  finLen: number;
  centerFin: number;
  canards: boolean;
  canopy: { w: number; h: number; l: number; z: number };
  stripes: 0 | 1 | 2 | 3;
}

const DESIGNS: readonly Design[] = [
  // BLUE COMET: balanced racer
  { hullHW: 0.6, hullTop: 0.12, podX: 0.98, podR: 0.3, podZ0: -0.9, podZ1: 2.2, wingSweep: 0.9, wingRoot: [-0.35, 1.2], finH: 0.5, finLen: 1.1, centerFin: 0, canards: false, canopy: { w: 0.34, h: 0.3, l: 0.95, z: -0.4 }, stripes: 0 },
  // CRIMSON FANG: aggressive, long forward pods and canards
  { hullHW: 0.55, hullTop: 0.1, podX: 1.02, podR: 0.27, podZ0: -1.55, podZ1: 2.25, wingSweep: 1.35, wingRoot: [-0.2, 1.3], finH: 0.68, finLen: 1.3, centerFin: 0, canards: true, canopy: { w: 0.3, h: 0.25, l: 1.0, z: -0.2 }, stripes: 1 },
  // GOLDEN ARROW: slender needle with a tall centre fin
  { hullHW: 0.47, hullTop: 0.12, podX: 0.86, podR: 0.22, podZ0: -0.4, podZ1: 2.15, wingSweep: 0.55, wingRoot: [0.0, 1.0], finH: 0.3, finLen: 0.8, centerFin: 0.72, canards: false, canopy: { w: 0.27, h: 0.28, l: 1.25, z: -0.55 }, stripes: 2 },
  // VIOLET WISP: fat rounded hull, big winglets
  { hullHW: 0.66, hullTop: 0.14, podX: 1.0, podR: 0.34, podZ0: -0.6, podZ1: 2.1, wingSweep: 0.45, wingRoot: [-0.5, 1.5], finH: 0.85, finLen: 1.0, centerFin: 0, canards: false, canopy: { w: 0.4, h: 0.36, l: 0.9, z: -0.3 }, stripes: 3 },
  // TITAN: heavy brawler, wide hull, fat full-length pods and a short centre fin
  { hullHW: 0.74, hullTop: 0.16, podX: 1.1, podR: 0.4, podZ0: -1.2, podZ1: 2.25, wingSweep: 0.7, wingRoot: [-0.3, 1.4], finH: 0.45, finLen: 1.2, centerFin: 0.4, canards: true, canopy: { w: 0.42, h: 0.28, l: 0.8, z: -0.1 }, stripes: 1 },
  // BASTION: armoured hauler, tall hull, stubby pods, low twin fins
  { hullHW: 0.78, hullTop: 0.2, podX: 1.04, podR: 0.38, podZ0: -0.3, podZ1: 2.2, wingSweep: 0.35, wingRoot: [-0.45, 1.6], finH: 0.35, finLen: 1.4, centerFin: 0, canards: false, canopy: { w: 0.44, h: 0.34, l: 0.85, z: -0.5 }, stripes: 2 },
];

/** Procedural stand-in design per chassis until the GLB ships of M2. */
const CHASSIS_DESIGN: Readonly<Record<string, number>> = { comet: 0, dart: 1, arrow: 2, wisp: 3, titan: 4, bastion: 5 };

const POD_Y = -0.16;

interface Section {
  z: number;
  hw: number;
  y0: number;
  y1: number;
}

/** Loft superellipse cross-sections along Z. Faces outward; optional flat tail cap. */
function loft(sections: Section[], ring: number, power: number, capTail: boolean): THREE.BufferGeometry {
  const n = sections.length;
  const stride = ring + 1;
  const vCount = n * stride + (capTail ? stride + 1 : 0);
  const pos = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx: number[] = [];
  const e = 2 / power;
  for (let i = 0; i < n; i++) {
    const s = sections[i];
    const yc = (s.y0 + s.y1) / 2;
    const hh = (s.y1 - s.y0) / 2;
    for (let j = 0; j <= ring; j++) {
      const a = (j / ring) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const o = i * stride + j;
      pos[o * 3] = s.hw * Math.sign(c) * Math.pow(Math.abs(c), e);
      pos[o * 3 + 1] = yc + hh * Math.sign(sn) * Math.pow(Math.abs(sn), e);
      pos[o * 3 + 2] = s.z;
      uv[o * 2] = j / ring;
      uv[o * 2 + 1] = i / (n - 1);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (capTail) {
    const last = sections[n - 1];
    const base = n * stride;
    pos[base * 3] = 0;
    pos[base * 3 + 1] = (last.y0 + last.y1) / 2;
    pos[base * 3 + 2] = last.z;
    uv[base * 2] = 0.5;
    uv[base * 2 + 1] = 1;
    for (let j = 0; j <= ring; j++) {
      const src = (n - 1) * stride + j;
      const o = base + 1 + j;
      pos[o * 3] = pos[src * 3];
      pos[o * 3 + 1] = pos[src * 3 + 1];
      pos[o * 3 + 2] = pos[src * 3 + 2];
      uv[o * 2] = j / ring;
      uv[o * 2 + 1] = 1;
    }
    for (let j = 0; j < ring; j++) idx.push(base, base + 1 + j, base + 2 + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the UV seam normals
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const a = i * stride;
    const b = a + ring;
    const x = nrm.getX(a) + nrm.getX(b);
    const y = nrm.getY(a) + nrm.getY(b);
    const z = nrm.getZ(a) + nrm.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(a, x / l, y / l, z / l);
    nrm.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

/** Flat plate from an XZ polygon, extruded downward by `depth`, top face at `y`. */
function extrudeXZ(points: ReadonlyArray<readonly [number, number]>, depth: number, y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** Vertical fin from a (z, y) polygon, extruded `thickness` centred on world x. */
function extrudeFin(points: ReadonlyArray<readonly [number, number]>, thickness: number, x: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(-points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(x - thickness / 2, 0, 0);
  return g;
}

/** Normalise a geometry for merging: non-indexed, position/normal/uv + per-vertex colour. */
function forMerge(geo: THREE.BufferGeometry, color: THREE.Color, scale = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  g.clearGroups();
  const count = g.getAttribute('position').count;
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    col[i * 3] = color.r * scale;
    col[i * 3 + 1] = color.g * scale;
    col[i * 3 + 2] = color.b * scale;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function makeLiveryTexture(primary: number, secondary: number, glow: number, variant: number, stripes: number): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const X = (u: number) => u * W;
  const Y = (v: number) => (1 - v) * H;

  ctx.fillStyle = css(primary);
  ctx.fillRect(0, 0, W, H);
  // longitudinal shading: darker toward the tail
  const grad = ctx.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // belly and flanks darker
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(X(0.58), 0, X(0.34), H);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(X(0), 0, X(0.05), H);
  ctx.fillRect(X(0.45), 0, X(0.1), H);
  ctx.fillRect(X(0.95), 0, X(0.05), H);

  // nose tip
  ctx.fillStyle = css(secondary);
  ctx.fillRect(0, Y(0.13), W, Y(0) - Y(0.13));

  // main racing stripe (top centre is u = 0.25)
  ctx.fillStyle = css(secondary);
  const sw = stripes === 3 ? 0.16 : stripes === 2 ? 0.035 : 0.09;
  ctx.fillRect(X(0.25 - sw / 2), Y(1), X(sw), Y(0.12) - Y(1));
  if (stripes === 2) {
    ctx.fillRect(X(0.25 - 0.09), Y(1), X(0.03), Y(0.2) - Y(1));
    ctx.fillRect(X(0.25 + 0.06), Y(1), X(0.03), Y(0.2) - Y(1));
  }
  if (stripes === 1) {
    // chevrons
    ctx.strokeStyle = css(secondary);
    ctx.lineWidth = 12;
    for (let k = 0; k < 3; k++) {
      const v0 = 0.3 + k * 0.17;
      ctx.beginPath();
      ctx.moveTo(X(0.25), Y(v0));
      ctx.lineTo(X(0.25 - 0.2), Y(v0 + 0.1));
      ctx.moveTo(X(0.25), Y(v0));
      ctx.lineTo(X(0.25 + 0.2), Y(v0 + 0.1));
      ctx.stroke();
    }
  }
  if (stripes === 3) {
    ctx.fillStyle = css(glow);
    for (let k = 0; k < 4; k++) ctx.fillRect(X(0.25 - 0.3), Y(0.3 + k * 0.16), X(0.6), 6);
  }
  // neon hairlines
  ctx.fillStyle = css(glow);
  ctx.fillRect(X(0.25 - 0.1), Y(0.98), 3, Y(0.16) - Y(0.98));
  ctx.fillRect(X(0.25 + 0.1), Y(0.98), 3, Y(0.16) - Y(0.98));
  // panel lines
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let k = 1; k < 8; k++) ctx.fillRect(0, Y(k / 8) - 1, W, 2);
  // ship number decal
  ctx.fillStyle = css(secondary);
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(variant + 1), X(0.1), Y(0.62));
  ctx.fillText(String(variant + 1), X(0.4), Y(0.62));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------
// Shaders for additive glow bits
// ---------------------------------------------------------------------------

const FLAME_VERT = /* glsl */ `
  uniform float uBaseZ;
  uniform float uLen;
  uniform float uRad;
  uniform float uPodX;
  uniform float uNy;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec3 p = position;
    float cx = sign(p.x) * uPodX;
    p.z = uBaseZ + (p.z - uBaseZ) * uLen;
    p.x = cx + (p.x - cx) * uRad;
    p.y = uNy + (p.y - uNy) * uRad;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FLAME_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float along = vUv.y;
    float fres = abs(dot(normalize(vN), normalize(vV)));
    float flick = 0.88 + 0.12 * sin(uTime * 60.0 + along * 9.0);
    float a = pow(1.0 - along, 1.3) * pow(fres, 1.1) * flick;
    vec3 col = mix(uCore, uColor, smoothstep(0.0, 0.65, along));
    gl_FragColor = vec4(col * uIntensity * 1.6, a * clamp(uIntensity, 0.0, 1.0));
  }
`;

const POOL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const POOL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float a = pow(clamp(1.0 - r, 0.0, 1.0), 2.0);
    float rings = 0.85 + 0.15 * sin(r * 14.0 - uTime * 8.0);
    gl_FragColor = vec4(uColor * uIntensity * (0.5 + 0.9 * a) * rings, a * clamp(uIntensity, 0.0, 1.0));
  }
`;

const SHIELD_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const SHIELD_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float band = 0.75 + 0.25 * sin(uTime * 40.0 + vN.y * 12.0);
    gl_FragColor = vec4(uColor * 2.2 * band, f * uOpacity);
  }
`;

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const NOZZLE_Y = POD_Y;

/** A ship's render representation: mesh hierarchy, interpolated pose, engine state. */
export class ShipModel {
  readonly root = new THREE.Group();
  readonly ship: ShipState;
  /** Interpolated world position (no bob). */
  readonly pos = new THREE.Vector3();
  /** Interpolated body orientation (track-aligned, no visual bank). */
  readonly quat = new THREE.Quaternion();
  /** Interpolated orientation including visual bank. */
  readonly visQuat = new THREE.Quaternion();
  /** World-space exhaust positions (left, right). */
  readonly nozzleWorld: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  /** World-space unit vector pointing out of the nozzles (ship rear). */
  readonly exhaustDir = new THREE.Vector3();
  readonly glowColor: THREE.Color;
  /** Engine level: ~0.4 idle, ~1 full throttle, ~2.3 boosting. */
  engine = 0.4;
  destroyed = false;
  /** True when rendered this frame. */
  get visible(): boolean {
    return this.root.visible;
  }

  private readonly bankGroup = new THREE.Group();
  private readonly bankQ = new THREE.Quaternion();
  private readonly flapL: THREE.Group;
  private readonly flapR: THREE.Group;
  private readonly flapMat: THREE.MeshStandardMaterial;
  private readonly pool: THREE.Mesh;
  private readonly shield: THREE.Mesh;
  private readonly glowMat: THREE.MeshBasicMaterial;
  /** GLB ship: glow tint (the procedural ship tints glow through vertex colours instead). */
  private readonly glowBase: THREE.Color | null;
  private readonly layout: ShipLayout;
  private readonly flameMat: THREE.ShaderMaterial;
  private readonly poolMat: THREE.ShaderMaterial;
  private readonly shieldMat: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  /** Class size (content/ships CLASS_SCALE), matching the physics collider. */
  private readonly scale: number;
  private readonly phase: number;
  private flickerTime = 0;
  private openL = 0;
  private openR = 0;
  private readonly nozzleLocal: [THREE.Vector3, THREE.Vector3];
  private poseInit = false;

  /** `assembled`: a GLB ship from ShipAssembly; without it the v1 procedural ship is built (fallback). */
  constructor(ship: ShipState, assembled: AssembledShip | null = null) {
    this.ship = ship;
    // v1 roster (no loadout): the four original designs by id.
    const loadout = ship.def.loadout;
    const variant = loadout ? (CHASSIS_DESIGN[loadout.chassisId] ?? 0) : ship.def.id % 4;
    const d = DESIGNS[variant];
    this.scale = loadout ? CLASS_SCALE[chassisById(loadout.chassisId).cls] : 1;
    this.root.scale.setScalar(this.scale);
    this.layout = assembled ? assembled.layout : { podX: d.podX, podR: d.podR, podZ1: d.podZ1, nozzleY: NOZZLE_Y, hullHW: d.hullHW };
    const lay = this.layout;
    this.phase = ship.def.id * 1.7;
    const livery = ship.def.livery;
    const primary = new THREE.Color(livery.primary);
    const secondary = new THREE.Color(livery.secondary);
    this.glowColor = new THREE.Color(livery.glow);
    const glow = this.glowColor;

    this.root.name = `ship-${ship.def.id}`;
    this.root.add(this.bankGroup);

    if (assembled) {
      this.bankGroup.add(assembled.root);
      this.glowMat = assembled.glowMaterial;
      this.glowBase = assembled.glowColor.clone();
      this.disposables.push(assembled);
    } else {
      this.glowBase = null;
      // ---------------- hull ----------------
      const top = d.hullTop;
      const hw = d.hullHW;
      const prof: Array<[number, number, number, number]> = [
        [0.0, 0.0, -0.14, -0.14],
        [0.05, 0.16, -0.3, -0.02],
        [0.18, 0.42, -0.38, 0.05],
        [0.38, 0.72, -0.42, top],
        [0.58, 0.9, -0.42, top + 0.02],
        [0.78, 0.96, -0.4, top],
        [0.92, 0.86, -0.34, top - 0.05],
        [1.0, 0.72, -0.3, top - 0.1],
      ];
      const z0 = -2.25;
      const z1 = 2.15;
      const sections: Section[] = prof.map(([s, w, y0, y1]) => ({ z: z0 + s * (z1 - z0), hw: w * hw, y0, y1 }));
      const hullGeo = loft(sections, 16, 2.6, true);
      const liveryTex = makeLiveryTexture(livery.primary, livery.secondary, livery.glow, variant, d.stripes);
      const hullMat = new THREE.MeshStandardMaterial({ map: liveryTex, metalness: 0.55, roughness: 0.3, envMapIntensity: 1.5 });
      const hull = new THREE.Mesh(hullGeo, hullMat);
      hull.castShadow = true;
      this.bankGroup.add(hull);
      this.disposables.push(hullGeo, hullMat, liveryTex);

      // ---------------- accent parts (pods, wings, fins, nozzle tubes) merged with vertex colours ----------------
      const accent: THREE.BufferGeometry[] = [];
      const dark = new THREE.Color(0x0a0b12);
      const podColor = primary.clone().multiplyScalar(0.8);
      const wingColor = secondary.clone();
      const trimGeos: THREE.BufferGeometry[] = [];
      const podLen = d.podZ1 - d.podZ0;
      for (const sign of [-1, 1]) {
        // pod
        const podSections: Section[] = [
          [0.0, 0.05],
          [0.08, 0.55],
          [0.28, 0.92],
          [0.75, 1.0],
          [1.0, 0.86],
        ].map(([s, r]) => ({ z: d.podZ0 + s * podLen, hw: r * d.podR, y0: POD_Y - r * d.podR, y1: POD_Y + r * d.podR }));
        const pod = loft(podSections, 14, 2, true);
        pod.translate(sign * d.podX, 0, 0);
        accent.push(forMerge(pod, podColor));

        // wing joining hull and pod
        const x0 = sign * d.hullHW * 0.75;
        const xt = sign * d.podX;
        const [r0, r1] = d.wingRoot;
        const wing = extrudeXZ(
          [
            [x0, r0],
            [xt, r0 + d.wingSweep],
            [xt, r1 + d.wingSweep * 0.3],
            [x0, r1],
          ],
          0.05,
          -0.11,
        );
        accent.push(forMerge(wing, wingColor));

        // tail fin on the pod
        const yb = POD_Y + d.podR * 0.8;
        const fz1 = d.podZ1 - 0.05;
        const fz0 = fz1 - d.finLen;
        const fin = extrudeFin(
          [
            [fz0, yb],
            [fz1, yb],
            [fz1 + 0.06, yb + d.finH],
            [fz1 - d.finLen * 0.55, yb + d.finH],
          ],
          0.05,
          sign * d.podX,
        );
        accent.push(forMerge(fin, wingColor));

        // canards
        if (d.canards) {
          const cn = extrudeXZ(
            [
              [sign * 0.28, -1.55],
              [sign * 1.0, -1.05],
              [sign * 1.0, -0.8],
              [sign * 0.28, -0.65],
            ],
            0.04,
            -0.12,
          );
          accent.push(forMerge(cn, wingColor));
        }

        // nozzle tube
        const nr = d.podR * 0.85;
        const tube = new THREE.CylinderGeometry(nr * 0.88, nr, 0.42, 18, 1, true);
        tube.rotateX(Math.PI / 2);
        tube.translate(sign * d.podX, NOZZLE_Y, d.podZ1 - 0.08);
        accent.push(forMerge(tube, dark));

        // emissive trims: pod side strip, wing edge, nozzle disc
        const strip = new THREE.BoxGeometry(0.03, 0.05, podLen * 0.55);
        strip.translate(sign * (d.podX + d.podR * 0.93), POD_Y + 0.02, d.podZ0 + podLen * 0.55);
        trimGeos.push(forMerge(strip, glow, 0.9));
        const edge = new THREE.BoxGeometry(0.62, 0.02, 0.04);
        edge.translate(sign * (d.hullHW * 0.75 + d.podX) * 0.5, -0.115, r0 + d.wingSweep * 0.5 + 0.02);
        trimGeos.push(forMerge(edge, glow, 0.9));
        const disc = new THREE.CircleGeometry(nr * 0.78, 20);
        disc.translate(sign * d.podX, NOZZLE_Y, d.podZ1 + 0.04);
        trimGeos.push(forMerge(disc, glow, 2.4));
      }
      if (d.centerFin > 0) {
        const yb = top - 0.03;
        const cf = extrudeFin(
          [
            [0.6, yb],
            [2.1, yb],
            [2.2, yb + d.centerFin],
            [1.45, yb + d.centerFin],
          ],
          0.05,
          0,
        );
        accent.push(forMerge(cf, wingColor));
      }
      const belly = new THREE.BoxGeometry(0.44 * (d.hullHW / 0.6), 0.02, 2.2);
      belly.translate(0, -0.435, 0.2);
      trimGeos.push(forMerge(belly, glow, 1.1));

      const accentGeo = mergeGeometries(accent)!;
      const accentMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.34, envMapIntensity: 1.4, side: THREE.DoubleSide });
      const accentMesh = new THREE.Mesh(accentGeo, accentMat);
      accentMesh.castShadow = true;
      this.bankGroup.add(accentMesh);
      this.disposables.push(accentGeo, accentMat);
      for (const g of accent) g.dispose();

      const trimGeo = mergeGeometries(trimGeos)!;
      this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      const trimMesh = new THREE.Mesh(trimGeo, this.glowMat);
      this.bankGroup.add(trimMesh);
      this.disposables.push(trimGeo, this.glowMat);
      for (const g of trimGeos) g.dispose();

      // ---------------- canopy ----------------
      const canopyGeo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
      const canopyMat = new THREE.MeshPhysicalMaterial({
        color: 0x0a1630,
        metalness: 0.2,
        roughness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMapIntensity: 3,
        emissive: glow,
        emissiveIntensity: 0.06,
      });
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.scale.set(d.canopy.w, d.canopy.h, d.canopy.l);
      canopy.position.set(0, top - 0.05, d.canopy.z);
      canopy.castShadow = true;
      this.bankGroup.add(canopy);
      this.disposables.push(canopyGeo, canopyMat);
    }

    // ---------------- flames (one merged draw call) ----------------
    const coneGeos: THREE.BufferGeometry[] = [];
    const nr = lay.podR * 0.85;
    for (const sign of [-1, 1]) {
      const cone = new THREE.ConeGeometry(nr * 0.8, 1, 16, 1, true);
      cone.translate(0, 0.5, 0);
      cone.rotateX(Math.PI / 2);
      cone.translate(sign * lay.podX, lay.nozzleY, lay.podZ1 + 0.02);
      coneGeos.push(cone);
    }
    const flameGeo = mergeGeometries(coneGeos)!;
    for (const g of coneGeos) g.dispose();
    this.flameMat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      uniforms: {
        uColor: { value: glow.clone() },
        uCore: { value: new THREE.Color(1, 0.95, 0.85) },
        uIntensity: { value: 0.5 },
        uTime: { value: 0 },
        uBaseZ: { value: lay.podZ1 + 0.02 },
        uLen: { value: 1 },
        uRad: { value: 1 },
        uPodX: { value: lay.podX },
        uNy: { value: lay.nozzleY },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const flames = new THREE.Mesh(flameGeo, this.flameMat);
    flames.frustumCulled = false;
    this.bankGroup.add(flames);
    this.disposables.push(flameGeo, this.flameMat);

    // ---------------- air-brake flaps ----------------
    this.flapMat = new THREE.MeshStandardMaterial({ color: secondary, metalness: 0.6, roughness: 0.35, emissive: glow, emissiveIntensity: 0, side: THREE.DoubleSide });
    const flapGeo = new THREE.BoxGeometry(0.42, 0.025, 0.9);
    flapGeo.translate(0.21, 0, 0);
    this.disposables.push(flapGeo, this.flapMat);
    const flapY = lay.nozzleY + lay.podR * 0.78;
    const flapZ = lay.podZ1 - 1.45;
    this.flapR = new THREE.Group();
    this.flapR.position.set(lay.podX + lay.podR * 0.35, flapY, flapZ);
    this.flapR.add(new THREE.Mesh(flapGeo, this.flapMat));
    this.flapL = new THREE.Group();
    this.flapL.position.set(-(lay.podX + lay.podR * 0.35), flapY, flapZ);
    const flapMeshL = new THREE.Mesh(flapGeo, this.flapMat);
    flapMeshL.scale.x = -1;
    this.flapL.add(flapMeshL);
    this.bankGroup.add(this.flapL, this.flapR);

    // ---------------- underside hover pool (follows body orientation, not bank) ----------------
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(Math.PI / 2);
    this.poolMat = new THREE.ShaderMaterial({
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      uniforms: { uColor: { value: glow.clone() }, uIntensity: { value: 1 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.pool = new THREE.Mesh(poolGeo, this.poolMat);
    this.pool.scale.set(3.6 * (0.9 + lay.hullHW * 0.2), 1, 6.4);
    this.pool.position.set(0, -(CONFIG.HOVER_HEIGHT - 0.07), 0.2);
    this.pool.renderOrder = 5;
    this.pool.frustumCulled = false;
    this.root.add(this.pool);
    this.disposables.push(poolGeo, this.poolMat);

    // ---------------- respawn shield ----------------
    const shieldGeo = new THREE.IcosahedronGeometry(1, 2);
    this.shieldMat = new THREE.ShaderMaterial({
      vertexShader: SHIELD_VERT,
      fragmentShader: SHIELD_FRAG,
      uniforms: { uColor: { value: glow.clone() }, uOpacity: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shield = new THREE.Mesh(shieldGeo, this.shieldMat);
    this.shield.scale.set(1.75, 0.85, 2.9);
    this.shield.visible = false;
    this.bankGroup.add(this.shield);
    this.disposables.push(shieldGeo, this.shieldMat);

    this.nozzleLocal = [
      new THREE.Vector3(-lay.podX, lay.nozzleY, lay.podZ1 + 0.12).multiplyScalar(this.scale),
      new THREE.Vector3(lay.podX, lay.nozzleY, lay.podZ1 + 0.12).multiplyScalar(this.scale),
    ];
  }

  /** Local-space hull dimensions used by camera/effects for scale reasoning. */
  get podHalfWidth(): number {
    return this.layout.podX * this.scale;
  }

  /** Interpolate the render pose from the physics state (does not mutate the state). */
  updatePose(alpha: number): void {
    const s = this.ship;
    if (!this.poseInit || s.prevPosition.distanceToSquared(s.position) > 400) {
      this.pos.copy(s.position);
      this.quat.copy(s.quaternion);
      this.poseInit = true;
    } else {
      this.pos.copy(s.prevPosition).lerp(s.position, alpha);
      this.quat.copy(s.prevQuaternion).slerp(s.quaternion, alpha);
    }
    this.bankQ.setFromAxisAngle(Z_AXIS, -s.bank);
    this.visQuat.copy(this.quat).multiply(this.bankQ);
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    this.bankGroup.quaternion.copy(this.bankQ);

    for (let i = 0; i < 2; i++) this.nozzleWorld[i].copy(this.nozzleLocal[i]).applyQuaternion(this.visQuat).add(this.pos);
    this.exhaustDir.set(0, 0, 1).applyQuaternion(this.visQuat);
  }

  /** Engine glow, flaps, bob, respawn flicker, hidden-when-retired. */
  updateVisuals(dt: number, time: number): void {
    const s = this.ship;
    const controls = s.lastControls;
    const live = s.status === 'racing' || s.status === 'finished';
    const hidden = this.destroyed || s.status === 'retired';

    // respawn flicker
    let show = !hidden;
    if (this.flickerTime > 0) {
      this.flickerTime = Math.max(0, this.flickerTime - dt);
      const on = Math.floor(this.flickerTime * 22) % 2 === 0 || this.flickerTime < 0.2;
      show = show && on;
      this.shield.visible = show;
      this.shieldMat.uniforms.uOpacity.value = clamp01(this.flickerTime * 1.6);
      this.shieldMat.uniforms.uTime.value = time;
    } else if (this.shield.visible) {
      this.shield.visible = false;
    }
    this.root.visible = show;
    if (!show) return;

    const throttle = live ? clamp01(controls.throttle) : 0;
    const target = s.boosting ? 2.3 : 0.42 + 0.58 * throttle + (live ? 0.1 : 0);
    this.engine = damp(this.engine, target, 9, dt);
    const glowK = 0.55 + this.engine * 0.75;
    if (this.glowBase) this.glowMat.color.copy(this.glowBase).multiplyScalar(glowK);
    else this.glowMat.color.setScalar(glowK);

    const boostK = clamp01((this.engine - 1.0) / 1.3);
    const fu = this.flameMat.uniforms;
    fu.uIntensity.value = clamp(0.25 + this.engine * 0.55, 0, 1.6);
    fu.uLen.value = 0.35 + 1.1 * throttle + 3.4 * boostK + Math.sin(time * 40 + this.phase) * 0.06;
    fu.uRad.value = 1 + 0.5 * boostK;
    fu.uTime.value = time;
    (fu.uColor.value as THREE.Color).copy(this.glowColor);
    (fu.uCore.value as THREE.Color).setRGB(1, 0.95 - 0.2 * boostK, 0.85 - 0.4 * boostK);

    // hover pool
    const lift = clamp01(1.6 - Math.max(0, s.heightAboveTrack - CONFIG.HOVER_HEIGHT) / 2.5);
    const pulse = 0.85 + 0.15 * Math.sin(time * 6 + this.phase) + 0.05 * Math.sin(time * 23 + this.phase * 3);
    this.pool.visible = lift > 0.02;
    this.poolMat.uniforms.uIntensity.value = pulse * lift * (0.75 + 0.35 * Math.min(1.5, this.engine));
    this.poolMat.uniforms.uTime.value = time;

    // air-brake flaps
    this.openL = damp(this.openL, clamp01(controls.airbrakeLeft), 14, dt);
    this.openR = damp(this.openR, clamp01(controls.airbrakeRight), 14, dt);
    this.flapL.rotation.z = -this.openL * 1.25;
    this.flapR.rotation.z = this.openR * 1.25;
    this.flapMat.emissiveIntensity = Math.max(this.openL, this.openR) * 1.2;

    // hover bob + shimmer (visual only)
    const t = time + this.phase;
    this.bankGroup.position.y = Math.sin(t * 2.1) * 0.025 + Math.sin(t * 5.3) * 0.01;
    this.bankGroup.rotation.x = Math.sin(t * 1.3) * 0.008 - throttle * 0.006;
  }

  /** Start a brief shield flicker (respawn). */
  flicker(duration: number): void {
    this.flickerTime = duration;
  }

  /** Clear destroyed/flicker state (race restart). */
  reset(): void {
    this.destroyed = false;
    this.flickerTime = 0;
    this.shield.visible = false;
    this.engine = 0.4;
    this.openL = 0;
    this.openR = 0;
    this.poseInit = false;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.root.clear();
  }
}
