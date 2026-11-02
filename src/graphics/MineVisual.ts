/**
 * Mines on screen: a dark spiked sphere with a red light band that spins and pulses (faster as the player closes
 * in), drawn as instanced meshes from FrameContext.mines. A mine that has gone off is hidden until it re-arms, then
 * grows back in. Track mines and the Drop Mine item share it; a dropped mine's band is the dropper's warning amber.
 */
import * as THREE from 'three';
import type { MineView } from '../core/contracts';
import { clamp01 } from '../core/math';
import { MINE_RADIUS } from '../track/features/mine';

const MAX_MINES = 24;
/** Distance (m) inside which a mine pulses faster as the player approaches. */
const ALERT_RANGE = 80;
const RED = new THREE.Color(3.2, 0.25, 0.15);
const AMBER = new THREE.Color(3.2, 1.4, 0.2);

export class MineVisual {
  readonly group = new THREE.Group();
  private readonly cores: THREE.InstancedMesh;
  private readonly bands: THREE.InstancedMesh;
  private readonly grow = new Float32Array(MAX_MINES);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly color = new THREE.Color();

  constructor() {
    this.group.name = 'mines';
    const core = new THREE.IcosahedronGeometry(MINE_RADIUS * 0.72, 0);
    // Spikes: small cones on the icosahedron's vertices, merged into the core geometry's instance.
    const spikes = new THREE.ConeGeometry(0.12, 0.45, 5);
    spikes.translate(0, MINE_RADIUS * 0.72 + 0.18, 0);
    const parts: THREE.BufferGeometry[] = [core.toNonIndexed()];
    const pos = core.getAttribute('position');
    const seen = new Set<string>();
    const dir = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      dir.fromBufferAttribute(pos, i).normalize();
      const key = `${dir.x.toFixed(2)},${dir.y.toFixed(2)},${dir.z.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const g = spikes.clone().applyQuaternion(this.q.setFromUnitVectors(this.axis, dir));
      parts.push(g.toNonIndexed());
    }
    const merged = mergeNonIndexed(parts);
    for (const p of parts) p.dispose();
    core.dispose();
    spikes.dispose();
    this.cores = new THREE.InstancedMesh(merged, new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.35, metalness: 0.85, emissive: 0x3a0806 }), MAX_MINES);
    this.cores.name = 'MineCore';
    const band = new THREE.TorusGeometry(MINE_RADIUS * 0.82, 0.09, 6, 24);
    band.rotateX(Math.PI / 2);
    this.bands = new THREE.InstancedMesh(band, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX_MINES);
    this.bands.name = 'MineBand';
    for (const im of [this.cores, this.bands]) {
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    this.bands.setColorAt(0, RED);
  }

  /** Pose the mines for this frame. `player` is the player's position (the closer, the faster the pulse). */
  update(mines: readonly MineView[] | undefined, player: THREE.Vector3, time: number, dt: number): void {
    const n = Math.min(mines?.length ?? 0, MAX_MINES);
    for (let i = 0; i < n; i++) {
      const mine = mines![i];
      // Re-armed mines grow back in over a third of a second; spent ones vanish at once.
      this.grow[i] = mine.armed ? Math.min(1, this.grow[i] + dt * 3) : 0;
      const near = clamp01(1 - mine.position.distanceTo(player) / ALERT_RANGE);
      const rate = 4 + 14 * near;
      const pulse = 0.55 + 0.45 * Math.sin(time * rate + i * 1.7);
      const scale = this.grow[i] * (1 + 0.05 * pulse);
      this.q.setFromAxisAngle(this.axis, time * (1.2 + i * 0.13));
      this.s.setScalar(scale);
      this.m.compose(mine.position, this.q, this.s);
      this.cores.setMatrixAt(i, this.m);
      this.q.setFromAxisAngle(this.axis, -time * 3);
      this.m.compose(mine.position, this.q, this.s);
      this.bands.setMatrixAt(i, this.m);
      this.color.copy(mine.owner === null ? RED : AMBER).multiplyScalar(0.35 + 0.65 * pulse);
      this.bands.setColorAt(i, this.color);
    }
    this.cores.count = n;
    this.bands.count = n;
    this.cores.instanceMatrix.needsUpdate = true;
    this.bands.instanceMatrix.needsUpdate = true;
    if (this.bands.instanceColor) this.bands.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const im of [this.cores, this.bands]) {
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      im.dispose();
    }
  }
}

/** Concatenate non-indexed geometries with position and normal attributes. */
function mergeNonIndexed(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const p of parts) count += p.getAttribute('position').count;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    p.computeVertexNormals();
    position.set(p.getAttribute('position').array as Float32Array, o * 3);
    normal.set(p.getAttribute('normal').array as Float32Array, o * 3);
    o += p.getAttribute('position').count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  return g;
}
