/**
 * Heat shimmer (Sunset Mesa, Med/High): a small, animated horizontal UV wobble concentrated in a band just
 * above and below the horizon line, where hot air over the desert would bend the light.
 */
export const HeatShimmerShader = {
  name: 'HeatShimmer',
  uniforms: {
    tDiffuse: { value: null as unknown },
    uTime: { value: 0 },
    /** Screen-space v of the horizon (0 bottom .. 1 top). */
    uHorizon: { value: 0.5 },
    uStrength: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uHorizon;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      float band = exp(-pow((vUv.y - uHorizon) / 0.07, 2.0));
      float w = sin(vUv.y * 420.0 + uTime * 7.0) * 0.6 + sin(vUv.y * 173.0 - uTime * 4.3 + vUv.x * 9.0) * 0.4;
      vec2 uv = vUv + vec2(w * 0.0011 * band * uStrength, 0.0);
      gl_FragColor = texture2D(tDiffuse, uv);
    }
  `,
};
