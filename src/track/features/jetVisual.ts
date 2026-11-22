/**
 * Pressure-jet visuals (Abyss Line). Every vent shows on the tube all the time as a dim ring, so a driver can see where
 * the danger is. Over the warning (JET_WARNING × the hazard policy's telegraphScale, so twice as long in Rookie races)
 * the ring brightens with a quickening pulse and a stream of bubbles rises from it, thicker as the jet comes; for the
 * JET_TIME of the jet a column of white water stands straight out of the tube: it shoots out, holds and collapses.
 * Everything is posed from the hazard clock, like the physics.
 *
 * Three instanced meshes (three draw calls for every field of the track). The streams and columns exist from the first
 * frame, scaled to nothing while idle, so the shader warm-up covers their materials.
 */
import * as THREE from 'three';
import { clamp01 } from '../../core/math';
import { type BuiltJet, JET_RADIUS, JET_WARNING, jetActive, jetProgress, jetWarning } from './jet';

export interface JetVisual {
  group: THREE.Group;
  /** Light the vents, raise the bubbles and fire the columns for physics time t (seconds since the race reset). */
  update(t: number): void;
}

const COLUMN_HEIGHT = 11;
const STREAM_HEIGHT = 6;
const DECK_LIFT = 0.08;
/** Share of the jet the column takes to shoot out, and to collapse at the end. */
const RISE = 0.1;
const FALL = 0.3;
const BUBBLES = 18;

/** The vent: a ring with a faint glow inside it, flat in the XZ plane (vertex colours carry the two levels). */
function ventGeometry(): THREE.BufferGeometry {
  const N = 28;
  const inner = JET_RADIUS - 0.45;
  const pos: number[] = [0, 0, 0];
  const col: number[] = [0.4, 0.4, 0.4];
  const idx: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pos.push(c * inner, 0, s * inner, c * inner, 0, s * inner, c * JET_RADIUS, 0, s * JET_RADIUS);
    col.push(0.1, 0.1, 0.1, 1, 1, 1, 1, 1, 1);
  }
  for (let i = 0; i < N; i++) {
    const a = 1 + i * 3;
    const b = 1 + ((i + 1) % N) * 3;
    idx.push(0, b, a);
    idx.push(a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * The bubble stream: BUBBLES small diamonds spiralling up a column from y = 0 to y = 1 (the instance's scale sets the
 * height), fading as they rise. One geometry; the stream rises by moving the instance along its own axis each frame.
 */
function streamGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < BUBBLES; b++) {
    const y = b / BUBBLES;
    const a = b * 2.4;
    const r = JET_RADIUS * (0.25 + 0.45 * ((b * 7) % 5) / 5);
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    // A bubble is wider than it is tall once the instance stretches the column, so keep it flat in y.
    const s = 0.16 + 0.08 * (b % 3);
    const h = 0.025;
    const v = pos.length / 3;
    pos.push(cx, y + h, cz, cx + s, y, cz, cx, y, cz + s, cx - s, y, cz, cx, y, cz - s, cx, y - h, cz);
    const fade = 1 - 0.75 * y;
    for (let k = 0; k < 6; k++) col.push(fade, fade, fade);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3, v, v + 3, v + 4, v, v + 4, v + 1);
    idx.push(v + 5, v + 2, v + 1, v + 5, v + 3, v + 2, v + 5, v + 4, v + 3, v + 5, v + 1, v + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** The column: an open tube from the surface (y = 0) out to y = 1, JET_RADIUS wide, bright at the vent, fanning out and fading at its end. */
function columnGeometry(): THREE.BufferGeometry {
  const N = 14;
  const RINGS = 5;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= RINGS; r++) {
    const y = r / RINGS;
    const radius = JET_RADIUS * (0.7 + 0.6 * y * y);
    const bright = 1 - 0.8 * y;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + r * 0.4;
      pos.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
      col.push(bright, bright, bright);
    }
    if (r === 0) continue;
    for (let i = 0; i < N; i++) {
      const a = (r - 1) * N + i;
      const b = (r - 1) * N + ((i + 1) % N);
      idx.push(a, b, a + N, b, b + N, a + N);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Column length 0..1 through a jet (progress 0..1): out fast, held, then collapsing. */
export function jetColumnLength(progress: number): number {
  if (progress <= 0 || progress >= 1) return 0;
  const out = clamp01(progress / RISE);
  const back = clamp01((1 - progress) / FALL);
  return Math.min(1 - (1 - out) * (1 - out), back);
}

export function buildJetVisual(jets: readonly BuiltJet[], color: number, telegraphScale = 1): JetVisual {
  const group = new THREE.Group();
  group.name = 'jet-fields';
  const warning = JET_WARNING * telegraphScale;
  const n = jets.length;
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, vertexColors: true } as const;

  const ventMat = new THREE.MeshBasicMaterial({ color: 0xffffff, ...additive });
  ventMat.polygonOffset = true;
  ventMat.polygonOffsetFactor = -2;
  const vents = new THREE.InstancedMesh(ventGeometry(), ventMat, Math.max(1, n));
  vents.name = 'jet-vents';
  const streams = new THREE.InstancedMesh(streamGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 1.1, 1.2), ...additive }), Math.max(1, n));
  streams.name = 'jet-streams';
  const columns = new THREE.InstancedMesh(columnGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.45, 1.6), ...additive }), Math.max(1, n));
  columns.name = 'jet-columns';
  for (const mesh of [vents, streams, columns]) {
    mesh.count = n;
    mesh.frustumCulled = false;
  }
  group.add(vents, streams, columns);

  const quats: THREE.Quaternion[] = [];
  const yAxis = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  jets.forEach((j, i) => {
    const q = new THREE.Quaternion().setFromUnitVectors(yAxis, j.up);
    quats.push(q);
    vents.setMatrixAt(i, m.compose(pos.copy(j.position).addScaledVector(j.up, DECK_LIFT), q, one));
  });
  vents.instanceMatrix.needsUpdate = true;

  const base = new THREE.Color(color);
  const bright = new THREE.Color(1.2, 1.5, 1.6);
  const tint = new THREE.Color();
  const scale = new THREE.Vector3();
  const shown: boolean[] = jets.map(() => true);
  const streaming: boolean[] = jets.map(() => true);

  const update = (t: number): void => {
    let columnsMoved = false;
    let streamsMoved = false;
    for (let i = 0; i < n; i++) {
      const j = jets[i];
      const firing = jetActive(j, t);
      const w = jetWarning(j, t, warning);
      if (firing) tint.copy(bright);
      else {
        // Idle: dim. Warning: brighter, with a pulse that quickens as the jet comes (stronger in Rookie races).
        const pulse = w > 0 ? 0.55 + 0.45 * Math.sin(t * (7 + 13 * w)) : 0;
        tint.copy(base).multiplyScalar(0.14 + w * pulse * (1.2 + 0.5 * telegraphScale));
      }
      vents.setColorAt(i, tint);

      // Bubbles over the warning: the stream grows taller and rises (a slide along its own axis that wraps every 0.5 s).
      const bubbling = w > 0 && !firing;
      if (bubbling || streaming[i]) {
        const h = bubbling ? STREAM_HEIGHT * (0.35 + 0.65 * w) : 0;
        const rise = ((t * 2) % 1) * (h / BUBBLES) * 3;
        streams.setMatrixAt(i, m.compose(pos.copy(j.position).addScaledVector(j.up, DECK_LIFT + rise), quats[i], scale.set(1, h, 1)));
        streaming[i] = bubbling;
        streamsMoved = true;
      }
      if (firing || shown[i]) {
        const h = firing ? jetColumnLength(jetProgress(j, t)) : 0;
        columns.setMatrixAt(i, m.compose(j.position, quats[i], scale.set(1, h * COLUMN_HEIGHT, 1)));
        shown[i] = firing;
        columnsMoved = true;
      }
    }
    if (n > 0 && vents.instanceColor) vents.instanceColor.needsUpdate = true;
    if (streamsMoved) streams.instanceMatrix.needsUpdate = true;
    if (columnsMoved) columns.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { group, update };
}
