// Post-process composer: scene -> lens -> bloom -> flash -> FXAA -> output.
//
// The lens pass simulates gravitational lensing around black holes.
// It's NOT a real null-geodesic solver — we do a per-pixel screen-space
// radial UV warp around each BH's projected position. Strength scales
// with apparent angular size (≈ Schwarzschild radius / distance), so
// distant BHs warp tiny regions and close-up SMBHs make obvious
// Einstein-ring distortions. Paper §15: lensing potential = matter
// potential (Φ = Ψ), so we don't have a slip term — the deflection
// here is simply tied to the same mass that drives gravity.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass }     from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader }     from 'three/examples/jsm/shaders/FXAAShader.js';

export const MAX_LENS = 8;   // max BHs we lens per frame

export class Composer {
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  fxaa: ShaderPass;
  lens: ShaderPass;
  flashAmount = 0;
  private flashPass: ShaderPass;
  private lensCenters = new Array(MAX_LENS).fill(0).map(() => new THREE.Vector2(0, 0));
  private lensRadii   = new Float32Array(MAX_LENS);
  private lensCount   = 0;

  constructor(public renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;

    this.composer  = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // Lens pass — screen-space radial UV warp around each BH center
    this.lens = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        nBH:      { value: 0 },
        bhCenters: { value: this.lensCenters },     // vec2[MAX_LENS], NDC ∈ [0,1]
        bhRadii:   { value: this.lensRadii },       // float[MAX_LENS], NDC units
        aspect:    { value: w / h }
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform int   nBH;
        uniform vec2  bhCenters[${MAX_LENS}];
        uniform float bhRadii[${MAX_LENS}];
        uniform float aspect;
        varying vec2 vUv;

        void main(){
          // Work in aspect-corrected UV so the warp is circular on screen
          vec2 uv = vUv;
          // Per-BH: deflect uv outward (positive lens). Einstein-ring-like
          // approximation: deflection magnitude ≈ R_E² / d, where R_E is
          // the effective Einstein-radius (per uniform).
          for (int i = 0; i < ${MAX_LENS}; i++) {
            if (i >= nBH) break;
            vec2 c = bhCenters[i];
            vec2 d = vec2((uv.x - c.x) * aspect, uv.y - c.y);
            float r = length(d);
            float R = bhRadii[i];
            // Subtle warp — only within ~2·R, deflection capped at 0.35·R,
            // so the lensing is a clear visual cue without obscuring the
            // scene. (Earlier 0.8·R cap was overwhelming.)
            if (r > 1e-4 && r < R * 2.0) {
              float taper = 1.0 - smoothstep(R * 1.2, R * 2.0, r);
              float defl = clamp(R * R / r, 0.0, R * 0.35) * taper;
              vec2 off = (d / r) * defl;
              uv.x -= off.x / aspect;
              uv.y -= off.y;
            }
          }
          gl_FragColor = texture2D(tDiffuse, clamp(uv, 0.0, 1.0));
        }
      `
    });
    this.composer.addPass(this.lens);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.95, 0.85, 0.05);
    this.composer.addPass(this.bloom);

    // Flash pass for big bang / regime transitions
    this.flashPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        amount:   { value: 0.0 },
        tint:     { value: new THREE.Color(1.0, 0.92, 0.78) }
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float amount;
        uniform vec3 tint;
        varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          c.rgb = mix(c.rgb, tint, clamp(amount, 0.0, 1.0));
          c.rgb += tint * amount * 0.7;
          gl_FragColor = c;
        }
      `
    });
    this.composer.addPass(this.flashPass);

    this.fxaa = new ShaderPass(FXAAShader);
    this.fxaa.uniforms['resolution'].value.set(1 / w, 1 / h);
    this.composer.addPass(this.fxaa);

    this.resize();
  }

  setScene(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  setBloom(strength: number, radius = 0.85, threshold = 0.05) {
    this.bloom.strength = strength;
    this.bloom.radius = radius;
    this.bloom.threshold = threshold;
  }

  enableBloom(on: boolean) {
    this.bloom.enabled = on;
  }

  // Update the lens pass with the current frame's BH screen-positions.
  // App passes world positions + radii; we project to NDC ∈ [0,1].
  setLensSources(camera: THREE.Camera, sources: { worldPos: THREE.Vector3; radius: number }[]) {
    const v = new THREE.Vector3();
    let n = 0;
    for (const s of sources) {
      if (n >= MAX_LENS) break;
      v.copy(s.worldPos).project(camera);
      // Cull behind camera or far off-screen
      if (v.z < -1 || v.z > 1) continue;
      if (v.x < -1.5 || v.x > 1.5 || v.y < -1.5 || v.y > 1.5) continue;
      // map NDC [-1,1] → uv [0,1]
      this.lensCenters[n].set(0.5 + 0.5 * v.x, 0.5 + 0.5 * v.y);
      this.lensRadii[n] = s.radius;
      n++;
    }
    this.lensCount = n;
    const u = this.lens.material.uniforms as any;
    u.nBH.value = n;
    u.bhCenters.value = this.lensCenters;
    u.bhRadii.value   = this.lensRadii;
    u.aspect.value    = this.renderer.domElement.clientWidth / this.renderer.domElement.clientHeight;
  }

  enableLens(on: boolean) {
    this.lens.enabled = on;
  }

  flash(amount = 1.0) {
    this.flashAmount = Math.max(this.flashAmount, amount);
  }

  tick(dt: number) {
    this.flashAmount = Math.max(0, this.flashAmount - dt * 1.5);
    (this.flashPass.material as THREE.ShaderMaterial).uniforms.amount.value = this.flashAmount;
  }

  render(dt: number) {
    this.tick(dt);
    this.composer.render(dt);
  }

  resize() {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    this.composer.setSize(w, h);
    this.bloom.setSize(w / 2, h / 2);
    this.fxaa.uniforms['resolution'].value.set(1 / w, 1 / h);
    (this.lens.material.uniforms as any).aspect.value = w / h;
  }
}
