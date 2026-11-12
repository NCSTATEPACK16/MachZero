/**
 * Lightning field visuals. Every strike point shows its circle on the deck all the time, dim, so a driver can see
 * where the danger is. Over the warning (STRIKE_WARNING × the hazard policy's telegraphScale, so twice as long in
 * Rookie races) the circle brightens with a quickening pulse; for the STRIKE_TIME of the bolt it is white and a
 * jagged bolt stands on it. Everything is posed from the hazard clock, like the physics.
 *
 * Two instanced meshes (two draw calls for every field of the track). The bolts exist from the first frame, scaled
 * to nothing between strikes, so the shader warm-up covers their material.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { type BuiltStrike, STRIKE_RADIUS, STRIKE_WARNING, strikeActive, strikeWarning } from './lightning';

export interface LightningVisual {
  group: THREE.Group;
  /** Light the circles and raise the bolts for physics time t (seconds since the race reset). */
  update(t: number): void;
}

const BOLT_HEIGHT = 90;
const BOLT_WIDTH = 0.5;
const BOLT_SEGMENTS = 9;
const DECK_LIFT = 0.08;

/** The circle: a bright rim and a faint disc inside it, flat in the XZ plane (vertex colours carry the two levels). */
function circleGeometry(): THREE.BufferGeometry {
  const N = 40;
  const inner = STRIKE_RADIUS - 0.45;
  const pos: number[] = [0, 0, 0];
  const col: number[] = [0.22, 0.22, 0.22];
  const idx: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Disc edge (faint), then the rim's inner and outer edge (bright).
    pos.push(c * inner, 0, s * inner, c * inner, 0, s * inner, c * STRIKE_RADIUS, 0, s * STRIKE_RADIUS);
    col.push(0.22, 0.22, 0.22, 1, 1, 1, 1, 1, 1);
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

/** The bolt: two crossed jagged ribbons from the deck (y = 0) up to y = 1, each BOLT_WIDTH wide at the foot. */
function boltGeometry(): THREE.BufferGeometry {
  const rng = new Rng(0x71e57);
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [ax, az] of [[1, 0], [0, 1]] as const) {
    const base = pos.length / 3;
    let ox = 0;
    let oz = 0;
    for (let k = 0; k <= BOLT_SEGMENTS; k++) {
      const y = k / BOLT_SEGMENTS;
      // The bolt lands on the circle's centre and wanders more the higher it goes.
      if (k > 0) {
        ox += rng.range(-1, 1) * 2.2;
        oz += rng.range(-1, 1) * 2.2;
      }
      const w = (BOLT_WIDTH / 2) * (1 + 0.6 * y);
      pos.push(ox - ax * w, y, oz - az * w, ox + ax * w, y, oz + az * w);
      if (k > 0) {
        const a = base + (k - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function buildLightningVisual(strikes: readonly BuiltStrike[], color: number, telegraphScale = 1): LightningVisual {
  const group = new THREE.Group();
  group.name = 'lightning-fields';
  const warning = STRIKE_WARNING * telegraphScale;
  const n = strikes.length;

  const circleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  circleMat.polygonOffset = true;
  circleMat.polygonOffsetFactor = -2;
  const circles = new THREE.InstancedMesh(circleGeometry(), circleMat, Math.max(1, n));
  circles.name = 'strike-circles';
  circles.count = n;
  circles.frustumCulled = false;
  const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const bolts = new THREE.InstancedMesh(boltGeometry(), boltMat, Math.max(1, n));
  bolts.name = 'strike-bolts';
  bolts.count = n;
  bolts.frustumCulled = false;
  group.add(circles, bolts);

  const basis = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const quats: THREE.Quaternion[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  strikes.forEach((k, i) => {
    quat.setFromUnitVectors(up, k.up);
    quats.push(quat.clone());
    basis.compose(pos.copy(k.position).addScaledVector(k.up, DECK_LIFT), quat, new THREE.Vector3(1, 1, 1));
    circles.setMatrixAt(i, basis);
  });
  circles.instanceMatrix.needsUpdate = true;

  const base = new THREE.Color(color);
  const white = new THREE.Color(1.5, 1.5, 1.3);
  const tint = new THREE.Color();
  const shown = new THREE.Vector3(1, BOLT_HEIGHT, 1);
  const hidden = new THREE.Vector3(1, 0, 1);
  const boltDown: boolean[] = strikes.map(() => true);

  const update = (t: number): void => {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const k = strikes[i];
      const down = strikeActive(k, t);
      const w = strikeWarning(k, t, warning);
      if (down) tint.copy(white);
      else {
        // Idle: dim. Warning: brighter, with a pulse that quickens as the bolt comes (stronger in Rookie races).
        const pulse = w > 0 ? 0.55 + 0.45 * Math.sin(t * (9 + 16 * w)) : 0;
        tint.copy(base).multiplyScalar(0.14 + w * pulse * (1.3 + 0.5 * telegraphScale));
      }
      circles.setColorAt(i, tint);
      if (down !== boltDown[i]) {
        boltDown[i] = down;
        bolts.setMatrixAt(i, m.compose(k.position, quats[i], down ? shown : hidden));
        moved = true;
      }
    }
    if (n > 0 && circles.instanceColor) circles.instanceColor.needsUpdate = true;
    if (moved) bolts.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { group, update };
}
