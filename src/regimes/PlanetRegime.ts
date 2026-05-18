// PLANET: textured sphere + atmosphere rim. Camera-only (drag the sky = orbit).

import * as THREE from 'three';
import { Regime, RegimeContext, DragTarget } from './Regime';
import { mulberry32 } from '../core/Rng';
import { hashStr } from '../util/hash';

export class PlanetRegime extends Regime {
  private planet: THREE.Mesh;
  private atmosphere: THREE.Mesh;
  private cloudShader: THREE.ShaderMaterial;
  private time = 0;
  private wallTime = 0;

  constructor(aspect: number, seed: number) {
    super(aspect);
    this.camera.position.set(0, 0.6, 3.0);
    this.camera.lookAt(0, 0, 0);

    const rng = mulberry32(hashStr(`planet|${seed}`));
    const seedF = rng();

    // Planet surface
    this.cloudShader = new THREE.ShaderMaterial({
      uniforms: {
        time:    { value: 0 },
        seed:    { value: seedF * 100 },
        landColor: { value: new THREE.Color('#4ea060') },
        seaColor:  { value: new THREE.Color('#1a4a82') },
        iceColor:  { value: new THREE.Color('#e8f4ff') },
        sunDir:    { value: new THREE.Vector3(1, 0.3, 0.5).normalize() }
      },
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vP;
        void main(){
          vN = normalize(normalMatrix * normal);
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float time, seed;
        uniform vec3 landColor, seaColor, iceColor, sunDir;
        varying vec3 vN; varying vec3 vP;

        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.989, 78.233, 53.539)) + seed) * 43758.5453); }
        float noise(vec3 p){
          vec3 i = floor(p), f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i),               hash(i+vec3(1,0,0)), u.x),
                mix(hash(i+vec3(0,1,0)),    hash(i+vec3(1,1,0)), u.x), u.y),
            mix(mix(hash(i+vec3(0,0,1)),    hash(i+vec3(1,0,1)), u.x),
                mix(hash(i+vec3(0,1,1)),    hash(i+vec3(1,1,1)), u.x), u.y),
            u.z);
        }
        float fbm(vec3 p){ float v=0., a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.05; a*=0.5; } return v; }

        void main(){
          vec3 n = normalize(vP);
          float h = fbm(n * 2.4 + vec3(seed));
          float land = smoothstep(0.45, 0.5, h);
          float ice  = smoothstep(0.85, 0.93, abs(n.y));
          vec3 col = mix(seaColor, landColor, land);
          col = mix(col, iceColor, ice);
          // shading
          float diff = clamp(dot(normalize(vN), normalize(sunDir)), 0.0, 1.0);
          float wrap = clamp((dot(normalize(vN), normalize(sunDir)) + 0.3) / 1.3, 0.0, 1.0);
          col *= 0.18 + wrap * 0.95;
          // cloud band
          float cloud = smoothstep(0.55, 0.72, fbm(n * 3.5 + vec3(time * 0.05, 0.0, 0.0)));
          col = mix(col, vec3(1.0), cloud * 0.3);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.cloudShader);
    this.scene.add(this.planet);

    // Atmosphere rim
    const atmGeom = new THREE.SphereGeometry(1.05, 96, 64);
    const atmMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.BackSide,
      uniforms: { sunDir: { value: new THREE.Vector3(1, 0.3, 0.5).normalize() } },
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vV;
        void main(){
          vN = normalize(normalMatrix * normal);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-p.xyz);
          gl_Position = projectionMatrix * p;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 sunDir;
        varying vec3 vN; varying vec3 vV;
        void main(){
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float rim = pow(f, 2.4);
          vec3 col = mix(vec3(0.2, 0.4, 0.9), vec3(0.6, 0.9, 1.0), rim);
          gl_FragColor = vec4(col, rim);
        }
      `
    });
    this.atmosphere = new THREE.Mesh(atmGeom, atmMat);
    this.scene.add(this.atmosphere);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  }

  update(ctx: RegimeContext, dt: number): void {
    // dt is sim seconds. Clamp the visual step so fast-forward doesn't yeet
    // the rotation. Wall-time drives the camera so it stays alive when paused.
    const visDt = Math.min(0.5, Math.abs(dt)) * Math.sign(dt || 1);
    this.time += visDt;
    this.wallTime += ctx.dtWall;
    this.cloudShader.uniforms.time.value = this.time;
    this.planet.rotation.y += visDt * 0.05;
    this.atmosphere.rotation.y = this.planet.rotation.y;
    const phi = this.wallTime * 0.06;
    this.camera.position.set(Math.sin(phi) * 3.0, 0.6, Math.cos(phi) * 3.0);
    this.camera.lookAt(0, 0, 0);
  }

  bloomStrength(_ctx: RegimeContext): number { return 0.5; }

  pick(_intersection: THREE.Intersection): DragTarget | null { return null; }
}
