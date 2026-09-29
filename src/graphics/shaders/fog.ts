import * as THREE from 'three';

/** Uniforms shared by every custom (non-lit) scenery shader so fog matches scene.fog exactly. */
export interface FogUniforms {
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogDensity: THREE.IUniform<number>;
}

export function createFogUniforms(color: number, density: number): FogUniforms {
  return {
    uFogColor: { value: new THREE.Color(color) },
    uFogDensity: { value: density },
  };
}

/** GLSL helpers matching THREE.FogExp2: factor = 1 - exp(-(density * depth)^2). */
export const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
float mzFogFactor(float depth, float scale) {
  float f = uFogDensity * scale * depth;
  return 1.0 - exp(-f * f);
}
`;
