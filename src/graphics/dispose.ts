import type * as THREE from 'three';

/** Dispose every geometry, material and texture under `root` (for objects owned by one race, e.g. a track). */
export function disposeObject3D(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => materials.add(x));
    else if (mat) materials.add(mat);
  });
  for (const mat of materials) {
    for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
    const uniforms = (mat as THREE.ShaderMaterial).uniforms;
    if (uniforms) for (const u of Object.values(uniforms)) if (u.value && (u.value as THREE.Texture).isTexture) (u.value as THREE.Texture).dispose();
    mat.dispose();
  }
  root.removeFromParent();
}
