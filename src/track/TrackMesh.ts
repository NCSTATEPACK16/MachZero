/**
 * Visual and collision geometry for the circuit, built from the same swept frames.
 *
 * Visual draw calls (merged per material): deck, slab body, rails, neon (vertex-coloured HDR:
 * rail strips + start gate bars), dash plates, pit strip, start-line decal, gate steelwork,
 * instanced pylons, instanced corkscrew rings.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { TrackCollisionData, TriMesh } from '../core/contracts';
import { smoothstep } from '../core/math';
import type { FrameSet } from './TrackFrames';
import {
  GeometryAccumulator,
  framesFromRange,
  roadSections,
  sectionColors,
  splitByCurl,
  type BendOptions,
  type GapRange,
  type SweepFrames,
  mirrorProfile,
  profileFromShape,
  sweepProfile,
  sweepWelded,
  type ProfilePoint,
} from './TrackSweep';
import {
  ASPHALT_TILE_METRES,
  createAsphaltTexture,
  createChevronTexture,
  createCheckerTexture,
  createPitTexture,
  createRailTexture,
  createFrostTexture,
  FROST_TILE_METRES,
} from './TrackTextures';
import type { TrackQuery } from './TrackQuery';
import { CURL_EPS, PIPE_RADIUS, RAIL_END_CURL, type PipeSpan } from './features/pipe';

const W = CONFIG.TRACK_HALF_WIDTH;
const T = CONFIG.RAIL_THICKNESS;
const H = CONFIG.RAIL_HEIGHT;
const WO = W + T; // outer edge of the rails

/** HDR multiplier applied to neon vertex colors (bloom threshold ~0.8 on HDR values). */
const NEON_HDR = 3.5;
const DASH_LENGTH = 12;
const DASH_WIDTH = 8;
const PYLON_SPACING = 40;
const CORKSCREW_MARGIN = 30;
/**
 * Rails (and their neon) sink into the deck as a pipe closes and end flush with it at RAIL_END_CURL, so a ship
 * meets a low ramp, never a blunt rail end, where they come back as the pipe opens.
 */
const RAIL_BEND: BendOptions = { heightScale: (c) => 1 - smoothstep(0.35, RAIL_END_CURL, c) };
/** Spacing (m) of the light rings around a closed pipe. */
const PIPE_RING_SPACING = 16;

export interface DashPlate {
  /** Centre distance along the lap, metres. */
  distance: number;
  /** Centre lateral offset, metres. */
  lateral: number;
}

/** Neon colours of a world's track (hex). */
export interface TrackPalette {
  /** Left and right rail strips. */
  left: number;
  right: number;
  /** Gimmick highlight: corkscrews, jump ramps, corkscrew rings, start-gate centre bar. */
  accent: number;
  /** Pit strip (and the left rail beside it). */
  pit: number;
}

export interface VisualInput {
  frames: FrameSet;
  query: TrackQuery;
  /** Corkscrew extents in metres along the lap. */
  corkscrews: { dStart: number; dEnd: number }[];
  pit: { dStart: number; dEnd: number };
  dashPlates: DashPlate[];
  /** Jump gaps: no deck, slab or rails between dStart (lip) and dEnd (landing edge). */
  gaps: GapRange[];
  /** Full-pipe sections (the deck curls into a frosted-glass tube). */
  pipes?: PipeSpan[];
  /** Ice patches (glossy decals). */
  ice?: { dStart: number; dEnd: number; lateralMin: number; lateralMax: number }[];
  palette: TrackPalette;
}

/** Length of the chevron-marked ramp before a jump lip (matches features/jump RAMP_LENGTH). */
const RAMP_MARK_LENGTH = 60;

export interface VisualStats {
  drawCalls: number;
  triangles: number;
  vertices: number;
}

function polygonShape(pts: readonly [number, number][]): THREE.Shape {
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}

/** Tile length that divides the lap exactly so textures wrap seamlessly at the start line. */
function seamlessTile(length: number, target: number): number {
  return length / Math.max(1, Math.round(length / target));
}

function linear(hex: number): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

interface NeonTheme {
  base: [number, number, number];
  amber: [number, number, number];
  lime: [number, number, number] | null;
}

/** Per-ring neon color: side color, accent through corkscrews and jump ramps, pit colour along the pit (left only). */
function neonRingColors(
  frames: FrameSet,
  theme: NeonTheme,
  accents: readonly { dStart: number; dEnd: number }[],
  pit: { dStart: number; dEnd: number },
  scale: number,
): Float32Array {
  const out = new Float32Array(frames.count * 3);
  for (let i = 0; i < frames.count; i++) {
    const d = i * frames.ds;
    let amberW = 0;
    for (const a of accents) amberW = Math.max(amberW, smoothstep(a.dStart - 28, a.dStart, d) * (1 - smoothstep(a.dEnd, a.dEnd + 28, d)));
    let r = theme.base[0] + (theme.amber[0] - theme.base[0]) * amberW;
    let g = theme.base[1] + (theme.amber[1] - theme.base[1]) * amberW;
    let b = theme.base[2] + (theme.amber[2] - theme.base[2]) * amberW;
    if (theme.lime) {
      const limeW = smoothstep(pit.dStart - 12, pit.dStart + 4, d) * (1 - smoothstep(pit.dEnd - 4, pit.dEnd + 12, d));
      r += (theme.lime[0] - r) * limeW;
      g += (theme.lime[1] - g) * limeW;
      b += (theme.lime[2] - b) * limeW;
    }
    out[i * 3] = r * scale;
    out[i * 3 + 1] = g * scale;
    out[i * 3 + 2] = b * scale;
  }
  return out;
}

function orientedBox(
  center: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  forward: THREE.Vector3,
  sx: number,
  sy: number,
  sz: number,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  // right × up = -forward, so (right, up, -forward) is a proper right-handed basis.
  const m = new THREE.Matrix4().makeBasis(right, up, forward.clone().negate());
  m.setPosition(center);
  geo.applyMatrix4(m);
  return geo;
}

interface GateBoxSpec {
  lateral: number;
  height: number;
  depth: number;
  sx: number;
  sy: number;
  sz: number;
}

function buildGate(
  query: TrackQuery,
  metal: GeometryAccumulator,
  neon: GeometryAccumulator,
  palette: TrackPalette,
): void {
  const s = query.sampleAt(0);
  const at = (b: GateBoxSpec): THREE.BufferGeometry => {
    const c = s.position
      .clone()
      .addScaledVector(s.right, b.lateral)
      .addScaledVector(s.up, b.height)
      .addScaledVector(s.forward, b.depth);
    return orientedBox(c, s.right, s.up, s.forward, b.sx, b.sy, b.sz);
  };
  const pillarX = WO + 1.4;
  // Steelwork: two pillars and a cross beam.
  metal.addGeometry(at({ lateral: -pillarX, height: 4.75, depth: 0, sx: 1.6, sy: 21.5, sz: 1.6 }));
  metal.addGeometry(at({ lateral: pillarX, height: 4.75, depth: 0, sx: 1.6, sy: 21.5, sz: 1.6 }));
  metal.addGeometry(at({ lateral: 0, height: 15.2, depth: 0, sx: 2 * pillarX + 1.6, sy: 2.4, sz: 2.2 }));
  // Emissive bars on both faces of the beam and pillar edges.
  const cyan = linear(palette.left);
  const magenta = linear(palette.right);
  const white = linear(0xf4f7ff);
  for (const face of [-1.13, 1.13]) {
    neon.addGeometry(at({ lateral: 0, height: 14.35, depth: face, sx: 2 * pillarX - 1.6, sy: 0.3, sz: 0.16 }), cyan);
    neon.addGeometry(at({ lateral: 0, height: 15.95, depth: face, sx: 2 * pillarX - 1.6, sy: 0.3, sz: 0.16 }), magenta);
    neon.addGeometry(at({ lateral: 0, height: 15.15, depth: face, sx: 6, sy: 0.9, sz: 0.16 }), white);
    neon.addGeometry(at({ lateral: -pillarX + 0.8, height: 6.5, depth: face * 0.75, sx: 0.28, sy: 13, sz: 0.2 }), cyan);
    neon.addGeometry(at({ lateral: pillarX - 0.8, height: 6.5, depth: face * 0.75, sx: 0.28, sy: 13, sz: 0.2 }), magenta);
  }
}

function buildPylons(frames: FrameSet, skip: readonly { dStart: number; dEnd: number }[]): THREE.InstancedMesh {
  const step = Math.max(1, Math.round(PYLON_SPACING / frames.ds));
  const matrices: THREE.Matrix4[] = [];
  const bottomDrop = 1.6;
  for (let i = 0; i < frames.count; i += step) {
    const d = i * frames.ds;
    if (skip.some((r) => d > r.dStart - CORKSCREW_MARGIN && d < r.dEnd + CORKSCREW_MARGIN)) continue;
    const i3 = i * 3;
    const upY = frames.up[i3 + 1];
    if (upY < 0.55) continue;
    // Anchor under the centre of the slab underside.
    const ax = frames.pos[i3] - frames.up[i3] * bottomDrop;
    const ay = frames.pos[i3 + 1] - upY * bottomDrop + 0.3;
    const az = frames.pos[i3 + 2] - frames.up[i3 + 2] * bottomDrop;
    const height = ay - CONFIG.GROUND_Y;
    if (height < 1) continue;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(ax, CONFIG.GROUND_Y + height / 2, az),
      new THREE.Quaternion(),
      new THREE.Vector3(1, height, 1),
    );
    matrices.push(m);
  }
  const geo = new THREE.CylinderGeometry(0.9, 1.6, 1, 10, 1, false);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a3042, roughness: 0.55, metalness: 0.75 });
  const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  mesh.name = 'TrackPylons';
  return mesh;
}

function buildCorkscrewRings(
  query: TrackQuery,
  length: number,
  cork: { dStart: number; dEnd: number },
  accent: number,
): THREE.InstancedMesh {
  const spacing = 26;
  const count = Math.max(1, Math.floor((cork.dEnd - cork.dStart) / spacing));
  const geo = new THREE.TorusGeometry(19.5, 0.22, 6, 72);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(3) });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const back = new THREE.Vector3();
  const start = cork.dStart + (cork.dEnd - cork.dStart - (count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    const s = query.sampleAt((start + i * spacing) / length);
    back.copy(s.forward).negate();
    m.makeBasis(s.right, s.up, back);
    q.setFromRotationMatrix(m);
    m.compose(s.position, q, one);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  mesh.name = 'TrackCorkscrewRings';
  return mesh;
}

/** Flat strip from xMin to xMax at height y, split into ≤ 1.5 m pieces so it can follow a curled pipe deck. */
function ribbonProfile(xMin: number, xMax: number, y: number): ProfilePoint[] {
  const n = Math.max(1, Math.ceil((xMax - xMin) / 1.5));
  const pts: ProfilePoint[] = [];
  for (let k = 0; k <= n; k++) pts.push({ x: xMax - ((xMax - xMin) * k) / n, y, v: 1 - k / n });
  return pts;
}

/** Light rings around the closed stretch of each pipe (just outside the glass). */
function buildPipeRings(query: TrackQuery, length: number, pipes: readonly PipeSpan[], accent: number): THREE.InstancedMesh {
  const centres: number[] = [];
  for (const p of pipes) {
    const from = p.dStart + p.transition;
    const to = p.dEnd - p.transition;
    for (let d = from; d <= to; d += PIPE_RING_SPACING) centres.push(d);
  }
  const geo = new THREE.TorusGeometry(PIPE_RADIUS + 0.12, 0.09, 6, 48);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(2.6) });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, centres.length));
  mesh.count = centres.length;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const back = new THREE.Vector3();
  const centre = new THREE.Vector3();
  centres.forEach((d, i) => {
    const s = query.sampleAt((((d % length) + length) % length) / length);
    back.copy(s.forward).negate();
    m.makeBasis(s.right, s.up, back);
    q.setFromRotationMatrix(m);
    centre.copy(s.position).addScaledVector(s.up, PIPE_RADIUS);
    m.compose(centre, q, one);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  mesh.name = 'TrackPipeRings';
  return mesh;
}

function meshOf(
  acc: GeometryAccumulator,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(acc.toGeometry(), material);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/**
 * Flat end caps where a road section is cut by a jump gap: slab + rails cross-section, facing into the gap,
 * plus a bright accent bar across the deck edge (the lip / landing lights).
 */
function addGapCaps(
  sections: SweepFrames[],
  slab: GeometryAccumulator,
  rail: GeometryAccumulator,
  neon: GeometryAccumulator,
  accent: [number, number, number],
): void {
  const slabShape = polygonShape([
    [-WO, 0],
    [-WO, -0.7],
    [-(WO - 2.2), -1.6],
    [WO - 2.2, -1.6],
    [WO, -0.7],
    [WO, 0],
  ]);
  const railShape = (sx: number): THREE.Shape =>
    polygonShape(
      sx > 0
        ? [
            [W, -0.3],
            [WO, -0.3],
            [WO, H],
            [W, H],
          ]
        : [
            [-WO, -0.3],
            [-W, -0.3],
            [-W, H],
            [-WO, H],
          ],
    );
  const pos = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const m = new THREE.Matrix4();
  for (const sec of sections) {
    for (const end of [0, sec.count - 1]) {
      const i3 = end * 3;
      pos.set(sec.pos[i3], sec.pos[i3 + 1], sec.pos[i3 + 2]);
      right.set(sec.right[i3], sec.right[i3 + 1], sec.right[i3 + 2]);
      up.set(sec.up[i3], sec.up[i3 + 1], sec.up[i3 + 2]);
      fwd.crossVectors(up, right); // right = fwd × up  =>  fwd = up × right
      // Cap faces into the gap: +forward at the lip (section end), -forward at the landing edge (section start).
      const outward = end === 0 ? -1 : 1;
      // Proper rotation with local +Z = outward: (right·s, up, fwd·s) where s = outward keeps det = +1.
      const zAxis = fwd.clone().multiplyScalar(outward);
      const xAxis = right.clone().multiplyScalar(outward);
      m.makeBasis(xAxis, up, zAxis).setPosition(pos);
      const place = (shape: THREE.Shape, mirror: boolean): THREE.BufferGeometry => {
        const g = new THREE.ShapeGeometry(shape);
        if (mirror) {
          // Local x is mirrored when outward = -1: flip the shape so it lands on the right side, keep winding.
          g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
          const idx = g.getIndex()!;
          for (let k = 0; k < idx.count; k += 3) {
            const t = idx.getX(k + 1);
            idx.setX(k + 1, idx.getX(k + 2));
            idx.setX(k + 2, t);
          }
        }
        g.applyMatrix4(m);
        g.computeVertexNormals();
        return g;
      };
      const mirror = outward < 0;
      slab.addGeometry(place(slabShape, mirror));
      rail.addGeometry(place(railShape(1), mirror));
      rail.addGeometry(place(railShape(-1), mirror));
      // Lip lights: a thin glowing bar along the deck edge, just inside the cut.
      const c = pos.clone().addScaledVector(fwd, -outward * 0.5).addScaledVector(up, 0.06);
      neon.addGeometry(orientedBox(c, right, up, fwd, 2 * W, 0.12, 0.8), accent);
    }
  }
}

export function buildTrackVisual(input: VisualInput): { group: THREE.Group; stats: VisualStats } {
  const { frames, query, corkscrews, pit, dashPlates, gaps, palette } = input;
  const pipes = input.pipes ?? [];
  const length = frames.length;
  const sections = roadSections(frames, gaps);
  // Pipes: the flat deck (asphalt + slab) stops where the deck starts to curl; the curled stretch is frosted
  // glass; rails run until the tube has nearly closed.
  const flatSections = sections.flatMap((sec) => splitByCurl(sec, (c) => c < CURL_EPS));
  const curledSections = sections.flatMap((sec) => splitByCurl(sec, (c) => c >= CURL_EPS, true));
  const railSections = sections.flatMap((sec) => splitByCurl(sec, (c) => c < RAIL_END_CURL));
  type Uv = { uTile: number; vScale?: number };
  const sweepOn = (list: SweepFrames[], acc: GeometryAccumulator, points: ProfilePoint[], closedProfile: boolean, uv: Uv, colors?: Float32Array, bend?: BendOptions): GeometryAccumulator => {
    for (const sec of list) acc.add(sweepProfile(sec, points, closedProfile, uv, colors ? sectionColors(colors, sec) : undefined, bend));
    return acc;
  };
  const sweepAll = (acc: GeometryAccumulator, points: ProfilePoint[], closedProfile: boolean, uv: Uv, colors?: Float32Array): GeometryAccumulator =>
    sweepOn(railSections, acc, points, closedProfile, uv, colors, RAIL_BEND);
  const asphaltTile = seamlessTile(length, ASPHALT_TILE_METRES);
  const railTile = seamlessTile(length, 8);
  const group = new THREE.Group();
  group.name = 'TrackVisual';

  // ---- Deck (textured driving surface) ----
  const deckShape = polygonShape([
    [W, 0],
    [-W, 0],
  ]);
  const deckProfile = profileFromShape(deckShape, (p) => (p.x + W) / (2 * W));
  const deckAcc = sweepOn(flatSections, new GeometryAccumulator(), deckProfile, false, { uTile: asphaltTile });
  const deckTexture = createAsphaltTexture();
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture, color: 0xffffff, roughness: 0.55, metalness: 0.5 });
  group.add(meshOf(deckAcc, deckMat, 'TrackDeck'));
  if (curledSections.length > 0) {
    // Frosted glass: the deck subdivided 1 m across so it can curl into the tube; seen from both sides.
    const glassProfile = ribbonProfile(-W, W, 0);
    const glassAcc = sweepOn(curledSections, new GeometryAccumulator(), glassProfile, false, { uTile: seamlessTile(length, FROST_TILE_METRES) });
    const glassMat = new THREE.MeshStandardMaterial({
      map: createFrostTexture(),
      color: 0xd8f2ff,
      emissive: new THREE.Color(palette.left).multiplyScalar(0.08),
      roughness: 0.18,
      metalness: 0.1,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const glass = meshOf(glassAcc, glassMat, 'TrackPipeGlass');
    glass.renderOrder = 1;
    group.add(glass);
    group.add(buildPipeRings(query, length, pipes, palette.left));
  }

  // ---- Slab body: sides and underside ----
  const bodyShape = polygonShape([
    [-WO, 0],
    [-WO, -0.7],
    [-(WO - 2.2), -1.6],
    [WO - 2.2, -1.6],
    [WO, -0.7],
    [WO, 0],
  ]);
  const bodyAcc = sweepOn(flatSections, new GeometryAccumulator(), profileFromShape(bodyShape), false, { uTile: railTile, vScale: 0.25 });

  // ---- Rails (wall shape: vertical inner face, top lip) ----
  const railShape = polygonShape([
    [W, -0.3],
    [WO, -0.3],
    [WO, H],
    [W - 0.25, H],
    [W - 0.25, H - 0.4],
    [W, H - 0.75],
  ]);
  const railRight = profileFromShape(railShape);
  const railLeft = mirrorProfile(railRight);
  const railUv = { uTile: railTile, vScale: 0.25 };
  const railAcc = new GeometryAccumulator();
  sweepAll(railAcc, railLeft, true, railUv);
  sweepAll(railAcc, railRight, true, railUv);

  // ---- Neon: rail-top strips, inner-wall strips, start gate bars (single vertex-coloured HDR mesh) ----
  const accent = linear(palette.accent);
  const accents = [
    ...corkscrews,
    ...gaps.map((g) => ({ dStart: g.dStart - RAMP_MARK_LENGTH, dEnd: g.dEnd + 30 })),
  ];
  const leftTheme: NeonTheme = { base: linear(palette.left), amber: accent, lime: linear(palette.pit) };
  const rightTheme: NeonTheme = { base: linear(palette.right), amber: accent, lime: null };
  const leftTop = neonRingColors(frames, leftTheme, accents, pit, 1);
  const rightTop = neonRingColors(frames, rightTheme, accents, pit, 1);
  const leftInner = neonRingColors(frames, leftTheme, accents, pit, 0.7);
  const rightInner = neonRingColors(frames, rightTheme, accents, pit, 0.7);
  const topY = H + 0.02;
  const topStripRight: ProfilePoint[] = [
    { x: W + 0.725, y: topY },
    { x: W + 0.275, y: topY },
  ];
  const innerStripRight: ProfilePoint[] = [
    { x: W - 0.03, y: 1.2 },
    { x: W - 0.03, y: 0.9 },
  ];
  const stripUv = { uTile: railTile };
  const neonAcc = new GeometryAccumulator();
  sweepAll(neonAcc, mirrorProfile(topStripRight), false, stripUv, leftTop);
  sweepAll(neonAcc, topStripRight, false, stripUv, rightTop);
  sweepAll(neonAcc, mirrorProfile(innerStripRight), false, stripUv, leftInner);
  sweepAll(neonAcc, innerStripRight, false, stripUv, rightInner);
  const metalGateAcc = new GeometryAccumulator();
  buildGate(query, metalGateAcc, neonAcc, palette);
  if (gaps.length > 0) addGapCaps(sections, bodyAcc, railAcc, neonAcc, accent);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b1f2c, roughness: 0.6, metalness: 0.7 });
  group.add(meshOf(bodyAcc, bodyMat, 'TrackSlab'));
  const railTexture = createRailTexture();
  const railMat = new THREE.MeshStandardMaterial({ map: railTexture, color: 0xffffff, roughness: 0.38, metalness: 0.85 });
  group.add(meshOf(railAcc, railMat, 'TrackRails'));
  const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  neonMat.color.setRGB(NEON_HDR, NEON_HDR, NEON_HDR);
  group.add(meshOf(neonAcc, neonMat, 'TrackNeon'));

  // ---- Overlays: additive chevron dash plates and jump ramps, pit strip; checkered start line ----
  const chevronTexture = createChevronTexture();
  const pitTexture = createPitTexture();
  // Animate from wall-clock time so the track stays self-contained (no external update calls).
  const animateOverlays = (): void => {
    const t = performance.now() * 0.001;
    chevronTexture.offset.x = -((t * 1.2) % 1);
    pitTexture.offset.x = -((t * 0.7) % 1);
  };
  const overlayOffset = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } as const;
  const chevronMaterial = (hex: number, k = 3): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({
      map: chevronTexture,
      color: new THREE.Color(hex).multiplyScalar(k),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      ...overlayOffset,
    });
  if (dashPlates.length > 0) {
    const dashAcc = new GeometryAccumulator();
    for (const plate of dashPlates) {
      const fr = framesFromRange(query, length, plate.distance - DASH_LENGTH / 2, plate.distance + DASH_LENGTH / 2, 1.5);
      dashAcc.add(
        sweepProfile(
          fr,
          ribbonProfile(plate.lateral - DASH_WIDTH / 2, plate.lateral + DASH_WIDTH / 2, 0.04),
          false,
          { uTile: DASH_LENGTH / 3 },
        ),
      );
    }
    const dashMesh = meshOf(dashAcc, chevronMaterial(0xffb319), 'TrackDashPlates');
    dashMesh.renderOrder = 2;
    dashMesh.onBeforeRender = animateOverlays;
    group.add(dashMesh);
  }
  if (gaps.length > 0) {
    // Jump ramps: two chevron lanes along the kicker, in the world's accent colour (dash plates stay amber).
    const rampAcc = new GeometryAccumulator();
    for (const g of gaps) {
      const fr = framesFromRange(query, length, g.dStart - RAMP_MARK_LENGTH, g.dStart - 0.5, 1.5);
      for (const lat of [-7, 7]) rampAcc.add(sweepProfile(fr, ribbonProfile(lat - 2.2, lat + 2.2, 0.04), false, { uTile: 4.4 }));
    }
    // Dimmer than dash plates: the ramp is long and fills the view on the approach.
    const rampMesh = meshOf(rampAcc, chevronMaterial(palette.accent, 1.1), 'TrackJumpRamps');
    rampMesh.renderOrder = 2;
    rampMesh.onBeforeRender = animateOverlays;
    group.add(rampMesh);
  }
  if (input.ice && input.ice.length > 0) {
    // Ice patches: glossy, faintly glowing sheets just above the deck (they follow a pipe's curl).
    const iceAcc = new GeometryAccumulator();
    for (const z of input.ice) {
      const fr = framesFromRange(query, length, z.dStart, z.dEnd, 2);
      iceAcc.add(sweepProfile(fr, ribbonProfile(z.lateralMin, z.lateralMax, 0.05), false, { uTile: 6 }));
    }
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0xcff4ff,
      emissive: new THREE.Color(0x6fdcff).multiplyScalar(0.35),
      roughness: 0.04,
      metalness: 0.3,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...overlayOffset,
    });
    const iceMesh = meshOf(iceAcc, iceMat, 'TrackIce');
    iceMesh.renderOrder = 2;
    group.add(iceMesh);
  }
  {
    const fr = framesFromRange(query, length, pit.dStart, pit.dEnd, 3);
    const pitAcc = new GeometryAccumulator().add(
      sweepProfile(fr, ribbonProfile(CONFIG.PIT_LATERAL_MIN, CONFIG.PIT_LATERAL_MAX, 0.04), false, { uTile: 8 }),
    );
    const pitMat = new THREE.MeshBasicMaterial({
      map: pitTexture,
      color: new THREE.Color(palette.pit).multiplyScalar(2.4),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      ...overlayOffset,
    });
    const pitMesh = meshOf(pitAcc, pitMat, 'TrackPitStrip');
    pitMesh.renderOrder = 2;
    pitMesh.onBeforeRender = animateOverlays;
    group.add(pitMesh);
  }
  {
    const fr = framesFromRange(query, length, -2, 2, 1);
    const lineAcc = new GeometryAccumulator().add(
      sweepProfile(
        fr,
        ribbonProfile(-W, W, 0.03),
        false,
        { uTile: 4 },
      ),
    );
    const lineMat = new THREE.MeshStandardMaterial({
      map: createCheckerTexture(),
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.2,
      ...overlayOffset,
    });
    group.add(meshOf(lineAcc, lineMat, 'TrackStartLine'));
  }

  // ---- Start gate steelwork ----
  group.add(
    meshOf(metalGateAcc, new THREE.MeshStandardMaterial({ color: 0x252a3a, roughness: 0.45, metalness: 0.85 }), 'TrackStartGate'),
  );

  // ---- Pylons (instanced) and corkscrew light rings (instanced) ----
  group.add(buildPylons(frames, [...corkscrews, ...pipes, ...gaps.map((g) => ({ dStart: g.dStart - 10, dEnd: g.dEnd + 10 }))]));
  for (const cork of corkscrews) group.add(buildCorkscrewRings(query, length, cork, palette.accent));

  let drawCalls = 0;
  let triangles = 0;
  let vertices = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      drawCalls += 1;
      const geo = o.geometry as THREE.BufferGeometry;
      const instances = o instanceof THREE.InstancedMesh ? o.count : 1;
      const idx = geo.getIndex();
      triangles += ((idx ? idx.count : geo.getAttribute('position').count) / 3) * instances;
      vertices += geo.getAttribute('position').count * instances;
    }
  });
  return { group, stats: { drawCalls, triangles, vertices } };
}

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

function mergeTriMeshes(a: TriMesh, b: TriMesh): TriMesh {
  const vertices = new Float32Array(a.vertices.length + b.vertices.length);
  vertices.set(a.vertices, 0);
  vertices.set(b.vertices, a.vertices.length);
  const indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices, 0);
  const offset = a.vertices.length / 3;
  for (let i = 0; i < b.indices.length; i++) indices[a.indices.length + i] = b.indices[i] + offset;
  return { vertices, indices };
}

/** World-space TriMeshes for physics: drivable surface (hover raycasts) and closed rail solids. */
export function buildTrackCollision(frames: FrameSet, gaps: readonly GapRange[] = []): TrackCollisionData {
  const sections = roadSections(frames, gaps);
  // Surface: 8 lateral segments spanning +-(W + rail thickness), listed +x -> -x so normals face up.
  const lateralSegments = 8;
  const half = W + T;
  const surfacePts: { x: number; y: number }[] = [];
  for (let k = 0; k <= lateralSegments; k++) surfacePts.push({ x: half - (2 * half * k) / lateralSegments, y: 0 });
  // Inside a pipe the surface is 40 pieces across (≈ 0.73 m, so the curled tube is accurate to ~1.5 cm).
  const curledPts: { x: number; y: number }[] = [];
  for (let k = 0; k <= 40; k++) curledPts.push({ x: half - (2 * half * k) / 40, y: 0 });
  const flat = sections.flatMap((sec) => splitByCurl(sec, (c) => c < CURL_EPS));
  const curled = sections.flatMap((sec) => splitByCurl(sec, (c) => c >= CURL_EPS, true));
  const surface = [...flat.map((sec) => sweepWelded(sec, surfacePts, false)), ...curled.map((sec) => sweepWelded(sec, curledPts, false))].reduce((a, b) =>
    mergeTriMeshes(a, b),
  );
  const railSecs = sections.flatMap((sec) => splitByCurl(sec, (c) => c < RAIL_END_CURL));

  // Rails: solid boxes, inner face exactly at +-W, 0.5 m taller than the visual rail and 0.5 m below the deck.
  const rightRail: ProfilePoint[] = [
    { x: W, y: -0.5 },
    { x: WO, y: -0.5 },
    { x: WO, y: H + 0.5 },
    { x: W, y: H + 0.5 },
  ];
  const rails = railSecs
    .map((sec) => mergeTriMeshes(sweepWelded(sec, mirrorProfile(rightRail), true, RAIL_BEND), sweepWelded(sec, rightRail, true, RAIL_BEND)))
    .reduce((a, b) => mergeTriMeshes(a, b));
  return { surface, rails };
}
