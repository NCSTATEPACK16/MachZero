import * as THREE from 'three';

/**
 * Radial "zoom" blur about the projected motion focus point. The centre of the
 * screen stays sharp (uInner) and blur ramps up towards the edges. 10 taps with
 * per-pixel interleaved-gradient jitter to hide banding.
 */
export const SpeedBlurShader = {
  name: 'SpeedBlurShader',
  uniforms: {
    tDiffuse: { value: null as unknown },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0 },
    uAspect: { value: 1 },
    uInner: { value: 0.14 },
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
    uniform vec2 uCenter;
    uniform float uStrength;
    uniform float uAspect;
    uniform float uInner;
    varying vec2 vUv;

    float ign(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      vec2 d = uCenter - vUv;
      float r = length(vec2(d.x * uAspect, d.y));
      float mask = smoothstep(uInner, 0.8, r);
      float k = uStrength * mask;
      if (k < 0.0004) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      const int TAPS = 10;
      float jitter = ign(gl_FragCoord.xy);
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < TAPS; i++) {
        float t = (float(i) + jitter) / float(TAPS);
        float w = 1.0 - t * 0.55;
        acc += texture2D(tDiffuse, vUv + d * (k * t)).rgb * w;
        wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, 1.0);
    }
  `,
};
