/**
 * Geyser field visuals. Every vent shows on the deck all the time as a dim ring round a dark throat, so a driver can
 * see where the danger is. Over the warning (GEYSER_WARNING × the hazard policy's telegraphScale, so twice as long
 * in Rookie races) the vent brightens with a quickening pulse; for the GEYSER_TIME of the eruption a column of lava
 * stands on it: it shoots up, holds and falls back. Everything is posed from the hazard clock, like the physics.
 *
 * Two instanced meshes (two draw calls for every field of the track). The columns exist from the first frame, scaled
 * to nothing between eruptions, so the shader warm-up covers their material.
 */
import * as THREE from 'three';
import { clamp01 } from '../../core/math';
import { type BuiltGeyser, GEYSER_RADIUS, GEYSER_WARNING, geyserActive, geyserProgress, geyserWarning } from './geyser';

export interface GeyserVisual {
  group: THREE.Group;
  /** Light the vents and raise the columns for physics time t (seconds since the race reset). */
  update(t: number): void;
}

const COLUMN_HEIGHT = 16;
const DECK_LIFT = 0.08;
/** Share of the eruption the column takes to shoot up, and to fall back at the end. */
const RISE = 0.12;
const FALL = 0.25;

/** The vent: a bright rim and a fainter glow inside it, flat in the XZ plane (vertex colours carry the two levels). */
function ventGeometry(): THREE.BufferGeometry {
  const N = 32;
  const inner = GEYSER_RADIUS - 0.5;
  const pos: number[] = [0, 0, 0];
  const col: number[] = [0.5, 0.5, 0.5];
  const idx: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // The glow's edge (faint), then the rim's inner and outer edge (bright).
    pos.push(c * inner, 0, s * inner, c * inner, 0, s * inner, c * GEYSER_RADIUS, 0, s * GEYSER_RADIUS);
    col.push(0.12, 0.12, 0.12, 1, 1, 1, 1, 1, 1);
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

/** The column: an open tube from the deck (y = 0) up to y = 1, GEYSER_RADIUS wide, hot at the foot and fading to its top. */
function columnGeometry(): THREE.BufferGeometry {
  const N = 14;
  const RINGS = 5;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= RINGS; r++) {
    const y = r / RINGS;
    // A slight waist, then a spread at the top.
    const radius = GEYSER_RADIUS * (0.8 - 0.25 * Math.sin(y * Math.PI) + 0.35 * y * y);
    const heat = 1 - 0.85 * y;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + r * 0.35;
      pos.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
      col.push(heat, heat * heat, heat * heat * heat * 0.6);
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

/** Column height 0..1 through an eruption (progress 0..1): up fast, held, back down. */
export function columnHeight(progress: number): number {
  if (progress <= 0 || progress >= 1) return 0;
  const up = clamp01(progress / RISE);
  const down = clamp01((1 - progress) / FALL);
  return Math.min(1 - (1 - up) * (1 - up), down);
}

export function buildGeyserVisual(geysers: readonly BuiltGeyser[], color: number, telegraphScale = 1): GeyserVisual {
  const group = new THREE.Group();
  group.name = 'geyser-fields';
  const warning = GEYSER_WARNING * telegraphScale;
  const n = geysers.length;

  const ventMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  ventMat.polygonOffset = true;
  ventMat.polygonOffsetFactor = -2;
  const vents = new THREE.InstancedMesh(ventGeometry(), ventMat, Math.max(1, n));
  vents.name = 'geyser-vents';
  vents.count = n;
  vents.frustumCulled = false;
  const columnMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.25, 0.7), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const columns = new THREE.InstancedMesh(columnGeometry(), columnMat, Math.max(1, n));
  columns.name = 'geyser-columns';
  columns.count = n;
  columns.frustumCulled = false;
  group.add(vents, columns);

  const basis = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const quats: THREE.Quaternion[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  geysers.forEach((g, i) => {
    quat.setFromUnitVectors(up, g.up);
    quats.push(quat.clone());
    basis.compose(pos.copy(g.position).addScaledVector(g.up, DECK_LIFT), quat, one);
    vents.setMatrixAt(i, basis);
  });
  vents.instanceMatrix.needsUpdate = true;

  const base = new THREE.Color(color);
  const hot = new THREE.Color(1.6, 1.1, 0.5);
  const tint = new THREE.Color();
  const scale = new THREE.Vector3();
  const standing: boolean[] = geysers.map(() => true);

  const update = (t: number): void => {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const g = geysers[i];
      const erupting = geyserActive(g, t);
      const w = geyserWarning(g, t, warning);
      if (erupting) tint.copy(hot);
      else {
        // Idle: dim. Warning: brighter, with a pulse that quickens as the eruption comes (stronger in Rookie races).
        const pulse = w > 0 ? 0.55 + 0.45 * Math.sin(t * (8 + 14 * w)) : 0;
        tint.copy(base).multiplyScalar(0.16 + w * pulse * (1.3 + 0.5 * telegraphScale));
      }
      vents.setColorAt(i, tint);
      if (erupting || standing[i]) {
        const h = erupting ? columnHeight(geyserProgress(g, t)) : 0;
        columns.setMatrixAt(i, m.compose(g.position, quats[i], scale.set(1, h * COLUMN_HEIGHT, 1)));
        standing[i] = erupting;
        moved = true;
      }
    }
    if (n > 0 && vents.instanceColor) vents.instanceColor.needsUpdate = true;
    if (moved) columns.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { group, update };
}
