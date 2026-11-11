/**
 * Wet-look deck (IMPLEMENTATION §X2): the driving surface turns glossy and the rail neon stretches along it
 * at grazing angles. A change to the deck's own material, so it costs no pass and no draw call. It is not a
 * real reflection.
 */
import * as THREE from 'three';
import type { WetDeckSpec } from './EnvFxSpec';

/** Deck meshes of the track visual (the main road and split paths). */
const DECK_NAMES = /^(TrackDeck|TrackBranchDeck)/;

export function applyWetDeck(trackVisual: THREE.Object3D, spec: WetDeckSpec, leftNeon: number, rightNeon: number): number {
  let changed = 0;
  const done = new Set<THREE.Material>();
  trackVisual.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !DECK_NAMES.test(mesh.name)) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat.isMeshStandardMaterial || done.has(mat)) return;
    done.add(mat);
    changed++;
    mat.roughness = THREE.MathUtils.lerp(mat.roughness, 0.08, spec.gloss);
    mat.metalness = THREE.MathUtils.lerp(mat.metalness, 0.85, spec.gloss);
    mat.envMapIntensity = 1 + spec.gloss * 0.8;
    const uniforms = {
      uStreak: { value: spec.streak },
      uStreakL: { value: new THREE.Color(leftNeon) },
      uStreakR: { value: new THREE.Color(rightNeon) },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uStreak;\nuniform vec3 uStreakL;\nuniform vec3 uStreakR;')
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          {
            // Across the deck: 0 at the centre line, 1 at the rails. The deck's v coordinate runs rail to rail.
            float wetE = abs(vMapUv.y - 0.5) * 2.0;
            vec3 wetC = vMapUv.y < 0.5 ? uStreakL : uStreakR;
            float wetF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 3.0);
            totalEmissiveRadiance += wetC * uStreak * wetF * smoothstep(0.45, 1.0, wetE);
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'mz-wetdeck';
    mat.needsUpdate = true;
  });
  return changed;
}
