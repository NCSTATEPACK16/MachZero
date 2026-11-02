/**
 * Debris visuals: each piece is a chunk of a broken satellite section, a foil-wrapped bus the size of its collision
 * box with a torn solar wing and a stub of truss, posed from the same timeline as the physics (`debrisPose`) and
 * with a slow red beacon on top so it reads at speed. The wing and truss stay inside the box's footprint across the
 * road, so what you see is what you hit.
 */
import * as THREE from 'three';
import { type BuiltDebris, debrisPose } from './debris';

export interface DebrisVisual {
  group: THREE.Group;
  /** Pose the pieces for physics time t (seconds since the race reset). */
  update(t: number): void;
}

export function buildDebrisVisual(debris: readonly BuiltDebris[]): DebrisVisual {
  const group = new THREE.Group();
  group.name = 'debris';
  const foil = new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.35, metalness: 0.95 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x1b2a55, roughness: 0.25, metalness: 0.6, emissive: 0x0a1a44, emissiveIntensity: 0.4 });
  const truss = new THREE.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.5, metalness: 0.85 });
  const beacon = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.15), toneMapped: false });
  const pieces: { mesh: THREE.Group; piece: BuiltDebris }[] = [];

  for (const b of debris) {
    const mesh = new THREE.Group();
    // The bus fills most of the box; the torn wing hangs off one end, inside the box.
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.62, b.height * 0.9, b.length * 0.9), foil);
    body.position.x = -b.width * 0.19;
    body.rotation.z = 0.06 * (b.index % 2 ? 1 : -1);
    mesh.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.36, 0.08, b.length * 0.8), panel);
    wing.position.set(b.width * 0.3, b.height * 0.1, 0);
    wing.rotation.x = 0.3 * (b.index % 3 === 0 ? 1 : -1);
    wing.rotation.z = -0.35;
    mesh.add(wing);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, b.width * 0.3, 5), truss);
    strut.rotation.z = Math.PI / 2;
    strut.position.set(b.width * 0.08, b.height * 0.05, 0);
    mesh.add(strut);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), beacon);
    light.position.set(-b.width * 0.19, b.height * 0.47, 0);
    mesh.add(light);
    group.add(mesh);
    pieces.push({ mesh, piece: b });
  }

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const update = (t: number): void => {
    for (const p of pieces) {
      debrisPose(p.piece, t, pos, quat);
      p.mesh.position.copy(pos);
      p.mesh.quaternion.copy(quat);
    }
    // One slow blink for every beacon.
    const on = Math.sin(t * 4) > 0.6;
    beacon.color.setRGB(on ? 3 : 0.5, on ? 0.2 : 0.03, on ? 0.15 : 0.02);
  };
  update(0);
  return { group, update };
}
