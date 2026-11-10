/**
 * Radial chromatic aberration + vignette + the world's colour grade (applied in linear HDR, before tone
 * mapping). The grade is lift / gamma / gain and saturation (IMPLEMENTATION §X2): no extra pass and no LUT
 * texture. `uFlash` adds a lightning flash to the whole frame.
 */
export const ChromaticShader = {
  name: 'ChromaticShader',
  uniforms: {
    tDiffuse: { value: null as unknown },
    uAberration: { value: 0 },
    uVignette: { value: 0.4 },
    uAspect: { value: 1 },
    uLift: { value: [0, 0, 0] as number[] },
    uGamma: { value: [1, 1, 1] as number[] },
    uGain: { value: [1, 1, 1] as number[] },
    uSaturation: { value: 1 },
    uFlash: { value: [0, 0, 0] as number[] },
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
    uniform vec3 uLift;
    uniform vec3 uGamma;
    uniform vec3 uGain;
    uniform float uSaturation;
    uniform vec3 uFlash;
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
      #ifdef GRADE
        col = pow(max(col * uGain + uLift, 0.0), 1.0 / uGamma);
        col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uSaturation);
      #endif
      col += uFlash * (0.35 + 0.65 * dot(col, vec3(0.3333)));
      float v = smoothstep(0.32, 1.05, r);
      col *= 1.0 - uVignette * v * v;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
