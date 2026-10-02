import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from '../core/config';
import { clamp01, damp } from '../core/math';
import type { QualityProfile } from '../settings/QualityManager';
import { SpeedBlurShader } from './shaders/speedBlur';
import { ChromaticShader } from './shaders/chromatic';

/**
 * Renders the scene into a private MSAA HalfFloat target, then resolves it into the
 * composer's (single-sample) read buffer. Keeping MSAA out of the ping-pong buffers is
 * required: UnrealBloomPass blends additively onto the read buffer, which is broken on
 * multisampled targets.
 */
export class MsaaScenePass extends Pass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly quad: FullScreenQuad;
  private readonly copyMat: THREE.ShaderMaterial;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    samples: number,
  ) {
    super();
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.target.texture.name = 'PostFX.msaa';
    this.copyMat = new THREE.ShaderMaterial({
      name: 'MsaaResolve',
      uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      // Resolve + sanitise: a single NaN/Inf texel would otherwise be smeared over the whole
      // frame by the bloom blur chain; also cap fireflies so bloom stays stable.
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0);
          gl_FragColor = vec4(min(c.rgb, vec3(64.0)), 1.0);
        }
      `,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.copyMat.uniforms['tDiffuse'].value = this.target.texture;
    this.quad = new FullScreenQuad(this.copyMat);
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, width), Math.max(1, height));
  }

  /** Change the MSAA sample count (the target is rebuilt on its next use). */
  setSamples(samples: number): void {
    if (this.target.samples === samples) return;
    this.target.samples = samples;
    this.target.dispose();
  }

  override render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(readBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.target.dispose();
    this.copyMat.dispose();
    this.quad.dispose();
  }
}

/** UnrealBloom whose input resolution is scaled (1 = its native half resolution, 0.5 = quarter). */
export class ScaledBloomPass extends UnrealBloomPass {
  private scale = 1;
  private w = 1;
  private h = 1;

  setScale(scale: number): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.setSize(this.w, this.h);
  }

  override setSize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    super.setSize(Math.max(2, Math.round(width * this.scale)), Math.max(2, Math.round(height * this.scale)));
  }
}

/** Radial zoom blur pass; keeps its aspect uniform in sync with the target size. */
export class SpeedBlurPass extends ShaderPass {
  constructor() {
    super(SpeedBlurShader);
  }

  override setSize(width: number, height: number): void {
    super.setSize(width, height);
    this.uniforms['uAspect'].value = width / Math.max(1, height);
  }
}

/** Chromatic aberration + vignette pass. */
export class ChromaticPass extends ShaderPass {
  constructor() {
    super(ChromaticShader);
  }

  override setSize(width: number, height: number): void {
    super.setSize(width, height);
    this.uniforms['uAspect'].value = width / Math.max(1, height);
  }
}

export interface PostFxParams {
  /** Player speed in m/s. */
  speed: number;
  boosting: boolean;
  /** Screen-space (0..1) focus of the motion blur. */
  centerU: number;
  centerV: number;
}

/**
 * Pipeline: MsaaScenePass (private MSAA HalfFloat target, resolved) -> UnrealBloom (internally half-res) ->
 * SpeedBlur -> Chromatic+Vignette -> OutputPass (ACES + sRGB).
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly renderPass: MsaaScenePass;
  readonly bloomPass: ScaledBloomPass;
  readonly speedBlurPass: SpeedBlurPass;
  readonly chromaticPass: ChromaticPass;
  readonly outputPass: OutputPass;

  private blur = 0;
  private blurAllowed = true;
  private readonly msaaSupported: boolean;
  /** Comfort: no radial speed blur and no chromatic aberration (the vignette stays). */
  reducedMotion = false;
  private kick = 0;
  private vignette = 0.42;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    // MSAA on a float target needs EXT_color_buffer_float (WebGL2 desktop: universal).
    const msaa = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.msaaSupported = msaa;
    this.composer = new EffectComposer(renderer);

    this.renderPass = new MsaaScenePass(scene, camera, msaa ? 4 : 0);
    this.bloomPass = new ScaledBloomPass(new THREE.Vector2(width, height), CONFIG.BLOOM_STRENGTH, CONFIG.BLOOM_RADIUS, CONFIG.BLOOM_THRESHOLD);
    this.speedBlurPass = new SpeedBlurPass();
    this.chromaticPass = new ChromaticPass();
    this.outputPass = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.speedBlurPass);
    this.composer.addPass(this.chromaticPass);
    this.composer.addPass(this.outputPass);

    this.speedBlurPass.enabled = false;
    this.setSize(width, height);
  }

  /** CSS-pixel size; the composer multiplies by the renderer's pixel ratio. */
  setSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  /** Quality preset: MSAA samples, bloom resolution, blur taps, chromatic pass. */
  setQuality(q: QualityProfile): void {
    this.renderPass.setSamples(this.msaaSupported ? q.msaa : 0);
    this.bloomPass.setScale(q.bloomScale);
    this.blurAllowed = q.blurTaps > 0;
    if (q.blurTaps > 0 && this.speedBlurPass.material.defines.TAPS !== q.blurTaps) {
      this.speedBlurPass.material.defines.TAPS = q.blurTaps;
      this.speedBlurPass.material.needsUpdate = true;
    }
    this.chromaticPass.enabled = q.chromatic;
  }

  /** Add a chromatic-aberration kick (0..1) that decays over ~0.4 s. */
  kickAberration(amount: number): void {
    this.kick = Math.min(1.6, this.kick + amount);
  }

  reset(): void {
    this.blur = 0;
    this.kick = 0;
    this.speedBlurPass.enabled = false;
  }

  update(dt: number, p: PostFxParams): void {
    const sf = clamp01((p.speed - 40) / (CONFIG.BOOST_TOP_SPEED - 40));
    const targetBlur = sf <= 0 || this.reducedMotion || !this.blurAllowed ? 0 : 0.15 * Math.pow(sf, 1.15) + (p.boosting ? 0.07 * Math.min(1, sf * 2) : 0);
    this.blur = damp(this.blur, targetBlur, 6, dt);
    if (targetBlur === 0 && this.blur < 0.0006) this.blur = 0;
    this.speedBlurPass.enabled = this.blur > 0.0008;
    this.speedBlurPass.uniforms['uStrength'].value = this.blur;
    (this.speedBlurPass.uniforms['uCenter'].value as THREE.Vector2).set(p.centerU, p.centerV);

    this.kick = damp(this.kick, 0, 4.5, dt);
    if (this.kick < 0.001) this.kick = 0;
    const base = 0.0007 * sf + (p.boosting ? 0.0018 : 0);
    this.chromaticPass.uniforms['uAberration'].value = this.reducedMotion ? 0 : base + this.kick * 0.011;
    this.vignette = damp(this.vignette, 0.42 + 0.24 * sf + this.kick * 0.1, 5, dt);
    this.chromaticPass.uniforms['uVignette'].value = this.vignette;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
  }
}
