/**
 * Stone gate visuals: a temple doorway (two pillars outside the rails and a lintel high above the road) with its
 * slab, posed from the same timeline as the physics (`gatePose`), and a glyph band on both faces that glows in the
 * gate's warning before it closes and stays lit while it is shut. The warning lasts GATE_WARNING × the hazard
 * policy's telegraphScale (twice as long in Rookie races).
 */
import * as THREE from 'three';
import { CONFIG } from '../../core/config';
import { type BuiltGate, GATE_WARNING, gateClosure, gatePose, gateWarning } from './gate';

export interface GateVisual {
  group: THREE.Group;
  /** Pose the slabs and set their glow for physics time t (seconds since the race reset). */
  update(t: number): void;
}

const PILLAR = 2.6;
/** Height of the lintel's underside above the deck (clears a raised portcullis). */
const LINTEL_CLEAR = 15;

export function buildGateVisual(gates: readonly BuiltGate[], accent: number, telegraphScale = 1): GateVisual {
  const group = new THREE.Group();
  group.name = 'stone-gates';
  const stone = new THREE.MeshStandardMaterial({ color: 0x48584c, roughness: 0.92, metalness: 0.02 });
  const frameStone = new THREE.MeshStandardMaterial({ color: 0x5b6655, roughness: 0.95, metalness: 0 });
  const slabs: { mesh: THREE.Group; glow: THREE.MeshStandardMaterial; gate: BuiltGate }[] = [];
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const warning = GATE_WARNING * telegraphScale;

  for (const g of gates) {
    // Doorway frame, fixed: pillars just outside the rails, lintel above.
    const basis = new THREE.Matrix4().makeBasis(g.right, g.up, g.forward.clone().negate());
    const frameQuat = new THREE.Quaternion().setFromRotationMatrix(basis);
    const outer = g.roadHalfWidth + CONFIG.RAIL_THICKNESS + PILLAR / 2 + 0.4;
    const pillarH = LINTEL_CLEAR + 2;
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(PILLAR, pillarH, PILLAR * 1.3), frameStone);
      pillar.position.copy(g.center).addScaledVector(g.right, side * outer).addScaledVector(g.up, pillarH / 2 - 1);
      pillar.quaternion.copy(frameQuat);
      group.add(pillar);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2 * outer + PILLAR, 2.2, PILLAR * 1.5), frameStone);
    lintel.position.copy(g.center).addScaledVector(g.up, LINTEL_CLEAR + 1.1);
    lintel.quaternion.copy(frameQuat);
    group.add(lintel);

    // The slab and its glyph bands (front and back faces).
    const slab = new THREE.Group();
    slab.add(new THREE.Mesh(new THREE.BoxGeometry(g.width, g.height, g.thickness), stone));
    const glow = new THREE.MeshStandardMaterial({ color: 0x101010, emissive: accent, emissiveIntensity: 0.2, roughness: 0.6 });
    for (const face of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(g.width * 0.86, 0.5, 0.08), glow);
      band.position.set(0, g.height * 0.15, face * (g.thickness / 2 + 0.04));
      slab.add(band);
      const glyphs = new THREE.Mesh(new THREE.BoxGeometry(g.width * 0.6, 0.22, 0.08), glow);
      glyphs.position.set(0, g.height * 0.15 + 0.75, face * (g.thickness / 2 + 0.04));
      slab.add(glyphs);
    }
    group.add(slab);
    slabs.push({ mesh: slab, glow, gate: g });
  }

  const update = (t: number): void => {
    for (const s of slabs) {
      gatePose(s.gate, gateClosure(s.gate, t), pos, quat);
      s.mesh.position.copy(pos);
      s.mesh.quaternion.copy(quat);
      const w = gateWarning(s.gate, t, warning);
      // Warning: a quickening pulse; shut: solid.
      const shut = gateClosure(s.gate, t) > 0.98;
      const pulse = shut ? 1 : w > 0 ? 0.5 + 0.5 * Math.sin(t * (8 + 10 * w)) : 0;
      s.glow.emissiveIntensity = 0.2 + (shut ? 2.4 : 2.2 * w * pulse);
    }
  };
  update(0);
  return { group, update };
}
