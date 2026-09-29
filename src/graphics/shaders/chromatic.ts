/** Radial chromatic aberration + vignette (applied in linear HDR, before tone mapping). */
export const ChromaticShader = {
  name: 'ChromaticShader',
  uniforms: {
    tDiffuse: { value: null as unknown },
    uAberration: { value: 0 },
    uVignette: { value: 0.4 },
    uAspect: { value: 1 },
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
    uniform float uAberration;
    uniform float uVignette;
    uniform float uAspect;
    varying vec2 vUv;

    void main() {
      vec2 c = vUv - 0.5;
      float r = length(vec2(c.x * uAspect, c.y));
      vec3 col;
      if (uAberration > 0.00005) {
        vec2 off = c * uAberration * (0.35 + r * r * 3.2);
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      float v = smoothstep(0.32, 1.05, r);
      col *= 1.0 - uVignette * v * v;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
