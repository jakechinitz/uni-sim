// COSMIC: ~100 galaxies onscreen. Instanced billboard galaxies + filament line segments.
// Visible cosmic-history checkpoints driven by time. Galaxies are draggable; their
// neighbours feel RAR pulls (deep-MOND tail = long-range coupling).

import * as THREE from 'three';
import { Regime, RegimeContext, DragTarget } from './Regime';
import { mulberry32, gauss } from '../core/Rng';
import { radialGlow } from '../render/Glow';
import { Body, accelOnRAR, stepLeapfrog } from '../core/Gravity';
import { hashStr } from '../util/hash';
import { smoothstep, clamp01 } from '../util/lerp';

const N_GAL = 380;
const BOX   = 60;        // sim units

// Sim-internal gravity coupling chosen so visible motion is on order of seconds
const G_SIM  = 0.02;
const A0_SIM = 0.0008;   // tuned so deep-MOND kicks in for visible distances

interface Galaxy {
  id: string;
  body: Body;
  mesh: THREE.Sprite;
  baseColor: THREE.Color;
  size: number;
  fadeIn: number; // 0..1 visibility (based on cosmic time)
  birth: number;  // Gyr when galaxy "lights up"
  halo?: THREE.Sprite;
}

export class CosmicRegime extends Regime {
  private galaxies: Galaxy[] = [];
  private filaments: THREE.LineSegments;
  private galTex: THREE.Texture;
  private edeBreath = 1;
  private group = new THREE.Group();
  private haloGroup = new THREE.Group();
  private filGeom: THREE.BufferGeometry;
  private filPositions: Float32Array;
  private filMaterial: THREE.LineBasicMaterial;
  private radNoiseMesh: THREE.Mesh;

  constructor(aspect: number, seed: number) {
    super(aspect);
    this.scene.fog = null;
    this.camera.position.set(0, 0, BOX * 1.05);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(this.group);
    this.scene.add(this.haloGroup);
    this.haloGroup.visible = false;

    // Pre-recombination radiation glow (fullscreen quad behind everything)
    const radGeom = new THREE.PlaneGeometry(2, 2);
    const radMat  = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      transparent: true,
      uniforms: { intensity: { value: 1 }, time: { value: 0 }, tint: { value: new THREE.Color('#ff8848') } },
      vertexShader:  /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform float intensity;
        uniform float time;
        uniform vec3 tint;
        float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
        float noise(vec2 p){
          vec2 i=floor(p), f=fract(p);
          float a=hash(i), b=hash(i+vec2(1,0));
          float c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
          vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
        }
        float fbm(vec2 p){ float v=0.,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.0+0.13; a*=0.5; } return v; }
        void main(){
          if (intensity <= 0.005) discard;
          vec2 p = vUv * 5.0 + vec2(time*0.08, -time*0.06);
          float n = fbm(p) * 0.7 + 0.3 * fbm(p*3.1 + 7.0);
          float r = length(vUv - 0.5);
          float vignette = 1.0 - smoothstep(0.4, 0.9, r);
          vec3 col = tint * (0.55 + 0.7 * n) * vignette;
          gl_FragColor = vec4(col, intensity * (0.65 + 0.5 * n));
        }
      `
    });
    this.radNoiseMesh = new THREE.Mesh(radGeom, radMat);
    this.radNoiseMesh.frustumCulled = false;
    this.radNoiseMesh.renderOrder = -10;
    this.scene.add(this.radNoiseMesh);

    // Galaxy texture
    this.galTex = radialGlow(256, '#ffffff', '#bcc8ff', 'rgba(60,80,160,0)');

    const rng = mulberry32(hashStr(`cosmic|${seed}`));

    // Build a deterministic galaxy field — light clustering by random walks
    for (let i = 0; i < N_GAL; i++) {
      const x = gauss(rng) * BOX * 0.36;
      const y = gauss(rng) * BOX * 0.36;
      const z = gauss(rng) * BOX * 0.36 * 0.7;
      const mass = 0.5 + Math.pow(rng(), 2) * 3.5;
      const size = (0.16 + 0.05 * Math.sqrt(mass)) * (0.8 + rng() * 0.6);
      const hue  = 200 + rng() * 60;        // mostly bluish-white with warm outliers
      const col  = new THREE.Color().setHSL(hue / 360, 0.45 + rng() * 0.35, 0.62);
      // colder outer-disk galaxies — a few warm reds
      if (rng() < 0.08) col.setHSL((10 + rng() * 30) / 360, 0.8, 0.65);

      const mat = new THREE.SpriteMaterial({
        map: this.galTex,
        color: col,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        opacity: 0
      });
      const s = new THREE.Sprite(mat);
      s.position.set(x, y, z);
      s.scale.setScalar(size);

      const birth = 0.10 + rng() * 0.6; // Gyr — when this galaxy lights up

      const g: Galaxy = {
        id: `gx-${i}`,
        body: {
          id: `gx-${i}`,
          pos: [x, y, z],
          vel: [gauss(rng) * 0.05, gauss(rng) * 0.05, gauss(rng) * 0.03],
          mass
        },
        mesh: s,
        baseColor: col,
        size,
        fadeIn: 0,
        birth
      };

      // Halo (entanglement overlay) — additive sprite at ~4x size
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: radialGlow(256, 'rgba(0,0,0,0)', 'rgba(122,215,255,0.55)', 'rgba(122,215,255,0)'),
        color: 0x7ad7ff,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.18
      }));
      halo.scale.setScalar(size * 4.5);
      halo.position.copy(s.position);
      this.haloGroup.add(halo);
      g.halo = halo;

      this.galaxies.push(g);
      this.group.add(s);
      this.draggable.add(s);
      s.userData = { type: 'galaxy', galaxy: g };
    }

    // Filaments — connect each galaxy to its 2 nearest neighbours
    const pairs: [number, number][] = [];
    for (let i = 0; i < this.galaxies.length; i++) {
      const dists: { j: number; d: number }[] = [];
      for (let j = 0; j < this.galaxies.length; j++) {
        if (j === i) continue;
        const dx = this.galaxies[i].body.pos[0] - this.galaxies[j].body.pos[0];
        const dy = this.galaxies[i].body.pos[1] - this.galaxies[j].body.pos[1];
        const dz = this.galaxies[i].body.pos[2] - this.galaxies[j].body.pos[2];
        dists.push({ j, d: dx * dx + dy * dy + dz * dz });
      }
      dists.sort((a, b) => a.d - b.d);
      for (let k = 0; k < 2; k++) {
        const j = dists[k].j;
        if (i < j) pairs.push([i, j]);
      }
    }
    this.filPositions = new Float32Array(pairs.length * 6);
    this.filGeom = new THREE.BufferGeometry();
    this.filGeom.setAttribute('position', new THREE.BufferAttribute(this.filPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.filMaterial = new THREE.LineBasicMaterial({
      color: 0x6090c0, transparent: true, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.filaments = new THREE.LineSegments(this.filGeom, this.filMaterial);
    this.filaments.userData.pairs = pairs;
    this.scene.add(this.filaments);
  }

  update(ctx: RegimeContext, dt: number): void {
    // Big bang flash and radiation-era visibility
    const t = ctx.time;
    const tinyT = 5e-5;             // ~50 kyr in Gyr
    const recomb = 3.8e-4;
    const radIntensity =
      t < 1e-9          ? 1.0 :
      t < tinyT         ? 1.0 - 0.4 * smoothstep(0, tinyT, t) :
      t < recomb        ? 0.6 - 0.5 * smoothstep(tinyT, recomb, t) :
                          Math.max(0, 0.1 - 0.1 * smoothstep(recomb, 0.01, t));
    const radMat = this.radNoiseMesh.material as THREE.ShaderMaterial;
    radMat.uniforms.intensity.value = radIntensity * (1 + 0.6 * ctx.edePulse);
    // Radiation noise is pure visual ambiance — wall time, never freezes
    radMat.uniforms.time.value += ctx.dtWall;
    radMat.uniforms.tint.value.setRGB(
      1.0, 0.55 + 0.15 * ctx.edePulse, 0.30 + 0.20 * ctx.edePulse
    );

    // "Breath" — visible expansion from EDE pulse
    const breath = 1 + 0.04 * ctx.edePulse;
    this.edeBreath = breath;

    // Drive galaxy visibility
    const galsLit = clamp01((t - 0.05) / 1.5);
    for (const g of this.galaxies) {
      const lit = clamp01((t - g.birth) / 0.4);
      g.fadeIn = lit * galsLit;
      const m = g.mesh.material as THREE.SpriteMaterial;
      m.opacity = g.fadeIn;
      const haloMat = g.halo!.material as THREE.SpriteMaterial;
      haloMat.opacity = ctx.entanglementOn ? 0.22 * g.fadeIn : 0;
    }

    // N-body step with RAR — softened, bounded. Cap visual sim-time per frame
    // so fast-forward doesn't blow up the leapfrog.
    const bodies = this.galaxies.map(g => g.body);
    const substeps = 2;
    const visDt = Math.min(0.04, Math.abs(dt)) * Math.sign(dt || 1);
    const dtSim = visDt / substeps;
    for (let s = 0; s < substeps; s++) {
      stepLeapfrog(bodies, dtSim, (i, all) => accelOnRAR(i, all, G_SIM, A0_SIM));
    }
    // Apply breath to positions (visual cosmic expansion at z~3000)
    for (const g of this.galaxies) {
      g.mesh.position.set(
        g.body.pos[0] * breath,
        g.body.pos[1] * breath,
        g.body.pos[2] * breath
      );
      g.halo!.position.copy(g.mesh.position);
    }

    // Filaments — update endpoints from current galaxy positions
    const pairs = this.filaments.userData.pairs as [number, number][];
    let pi = 0;
    for (const [a, b] of pairs) {
      const ga = this.galaxies[a].mesh.position;
      const gb = this.galaxies[b].mesh.position;
      this.filPositions[pi++] = ga.x; this.filPositions[pi++] = ga.y; this.filPositions[pi++] = ga.z;
      this.filPositions[pi++] = gb.x; this.filPositions[pi++] = gb.y; this.filPositions[pi++] = gb.z;
    }
    (this.filGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    const filOpacity = 0.45 * clamp01((t - 2.0) / 2.5);
    this.filMaterial.opacity = filOpacity;

    this.haloGroup.visible = ctx.entanglementOn;

    // Slow camera drift for cinematic feel
    const phi = ctx.time * 0.02;
    this.camera.position.x = Math.sin(phi) * BOX * 0.05;
    this.camera.lookAt(0, 0, 0);
  }

  bloomStrength(ctx: RegimeContext): number {
    const baseline = 0.95;
    return baseline + 1.5 * ctx.edePulse;
  }

  pick(intersection: THREE.Intersection): DragTarget | null {
    const obj = intersection.object;
    const ud = obj.userData;
    if (!ud || ud.type !== 'galaxy') return null;
    const g = ud.galaxy as Galaxy;
    return {
      id: g.id,
      object: obj,
      worldPos: new THREE.Vector3().copy(obj.position),
      onDragMove: (p: THREE.Vector3) => {
        // Un-breath the world point to get sim-space coords
        g.body.pos[0] = p.x / this.edeBreath;
        g.body.pos[1] = p.y / this.edeBreath;
        g.body.pos[2] = p.z / this.edeBreath;
        // While held, ignore inertia (fixed)
        g.body.fixed = true;
      },
      onDragEnd: (v: THREE.Vector3) => {
        g.body.fixed = false;
        g.body.vel[0] = v.x / this.edeBreath;
        g.body.vel[1] = v.y / this.edeBreath;
        g.body.vel[2] = v.z / this.edeBreath;
      }
    };
  }
}
