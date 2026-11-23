/**
 * Wet-look deck (IMPLEMENTATION §X2): the driving surface turns glossy and the rail neon stretches along it
 * at grazing angles. A change to the deck's own material, so it costs no pass and no draw call. It is not a
 * real reflection. With `glitter` (§X7, Cryo Station) sparse half-metre cells of the deck catch the light and
 * twinkle as the view direction changes: ice crystals, not a texture.
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
    const glitter = spec.glitter ?? 0;
    const uniforms = {
      uStreak: { value: spec.streak },
      uStreakL: { value: new THREE.Color(leftNeon) },
      uStreakR: { value: new THREE.Color(rightNeon) },
      uGlitter: { value: glitter },
      uGlitterColor: { value: new THREE.Color(spec.glitterColor ?? 0xe6f4ff) },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uStreak;\nuniform vec3 uStreakL;\nuniform vec3 uStreakR;\nuniform float uGlitter;\nuniform vec3 uGlitterColor;')
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          {
            // Across the deck: 0 at the centre line, 1 at the rails. The deck's v coordinate runs rail to rail.
            float wetE = abs(vMapUv.y - 0.5) * 2.0;
            vec3 wetC = vMapUv.y < 0.5 ? uStreakL : uStreakR;
            float wetF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 3.0);
            totalEmissiveRadiance += wetC * uStreak * wetF * smoothstep(0.45, 1.0, wetE);
          }${
            glitter > 0
              ? /* glsl */ `
          {
            // Ice glitter: the deck in half-metre cells (u runs one 56 m tile per unit, v rail to rail over
            // 28 m); about one cell in 30 holds a crystal, which flashes when the view direction lines up with
            // its own random facet, so the sparkles come and go as the ship moves.
            vec2 gCell = floor(vMapUv * vec2(112.0, 56.0));
            vec2 gIn = fract(vMapUv * vec2(112.0, 56.0)) - 0.5;
            float gH = fract(sin(dot(gCell, vec2(12.9898, 78.233))) * 43758.5453);
            vec3 gFacet = normalize(vec3(fract(gH * 17.31) - 0.5, fract(gH * 31.77) - 0.5, 1.0));
            float gAlign = abs(dot(normalize(vViewPosition), gFacet));
            float gTwinkle = smoothstep(0.9, 1.0, fract(gAlign * 9.0 + gH * 5.0));
            float gDot = 1.0 - smoothstep(0.08, 0.3, length(gIn));
            totalEmissiveRadiance += uGlitterColor * uGlitter * step(0.967, gH) * gTwinkle * gDot * 3.0;
          }`
              : ''
          }`,
        );
    };
    mat.customProgramCacheKey = () => (glitter > 0 ? 'mz-wetdeck-glitter' : 'mz-wetdeck');
    mat.needsUpdate = true;
  });
  return changed;
}
