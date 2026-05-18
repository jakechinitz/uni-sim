// Post-process composer: scene -> bloom -> FXAA -> output.
// Bloom strength is dynamic (driven by current regime + EDE pulse).

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass }     from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader }     from 'three/examples/jsm/shaders/FXAAShader.js';

export class Composer {
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  fxaa: ShaderPass;
  flashAmount = 0;
  private flashPass: ShaderPass;

  constructor(public renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;

    this.composer  = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

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
  }
}
