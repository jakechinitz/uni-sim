// COSMIC: ~100 galaxies onscreen. Instanced billboard galaxies + filament line segments.
// Visible cosmic-history checkpoints driven by time. Galaxies are draggable; their
// neighbours feel RAR pulls (deep-MOND tail = long-range coupling).

import * as THREE from 'three';
import { Regime, RegimeContext, DragTarget, FocusState } from './Regime';
import { mulberry32, gauss } from '../core/Rng';
import { radialGlow } from '../render/Glow';
import { Body, accelOnRAR, stepLeapfrog } from '../core/Gravity';
import { hashStr } from '../util/hash';
import { smoothstep, clamp01 } from '../util/lerp';
import { a as scaleFactor } from '../core/Cosmology';
import { ManyPasts } from '../render/ManyPasts';

// N_GAL drives the dominant CPU cost: O(N²) per-pair RAR integration per
// substep. 220 keeps the cosmic-web looking dense without choking the CPU.
const N_GAL = 220;
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
  private focusReticle!: THREE.Sprite;
  private _nbodyTick = 0;
  private wallTime = 0;
  private manyPasts = new ManyPasts(new THREE.Color(0x9b8dff), 3.5);
  // Inflation flash: tracks seconds since the last "Big Bang event" so
  // the radiation-noise quad visibly inflates from a point.
  private wallSinceBang = 999;
  private prevCosmicT = 1;

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
      uniforms: {
        intensity:  { value: 1 },
        time:       { value: 0 },
        tint:       { value: new THREE.Color('#ff8848') },
        // Inflation factor — when > 1 the noise is "zoomed in" around center
        // so only a tiny dot is visible. Decays to 1 over ~1 wall-second
        // after the Big Bang, giving the universe a visible inflationary
        // expansion at t = 0.
        inflate:    { value: 1.0 }
      },
      vertexShader:  /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform float intensity;
        uniform float time;
        uniform vec3 tint;
        uniform float inflate;
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
          // Inflation: as inflate increases the UV is contracted toward
          // (0.5, 0.5), so the visible noise pattern shrinks to a tiny
          // central dot and rapidly expands as inflate decays to 1.
          vec2 cuv = (vUv - 0.5) * inflate + 0.5;
          vec2 p = cuv * 5.0 + vec2(time*0.08, -time*0.06);
          float n = fbm(p) * 0.7 + 0.3 * fbm(p*3.1 + 7.0);
          float r = length(vUv - 0.5);
          // Tighter vignette when inflating so the dot is a sharp bright point
          float vignAttn = mix(1.0, 6.0, smoothstep(1.0, 30.0, inflate));
          float vignette = 1.0 - smoothstep(0.4 / vignAttn, 0.9 / vignAttn, r);
          // Boost brightness during inflation
          float boost = mix(1.0, 4.0, smoothstep(1.0, 30.0, inflate));
          vec3 col = tint * (0.55 + 0.7 * n) * vignette * boost;
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
    // Filaments = capacity-gradient bridges between matter concentrations
    // (paper §11–§12: gravity = relaxation of the substrate around defects,
    // and that gradient propagates between mass-concentrations). Brighter +
    // warmer tint than before so they actually read as "the substrate
    // pulling galaxies together" rather than as graph edges.
    this.filMaterial = new THREE.LineBasicMaterial({
      color: 0x9ac8ff, transparent: true, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.filaments = new THREE.LineSegments(this.filGeom, this.filMaterial);
    this.filaments.userData.pairs = pairs;
    this.scene.add(this.filaments);

    // Cyan ring sprite that follows the currently focused galaxy — gives
    // the user a clear "this is the one I'd zoom into" cue while flying
    // the camera around the cosmic web.
    this.focusReticle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlow(256, 'rgba(0,0,0,0)', 'rgba(122,215,255,0.85)', 'rgba(122,215,255,0)'),
      color: 0x7ad7ff,
      blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false,
      transparent: true, opacity: 0.85
    }));
    this.focusReticle.visible = false;
    this.scene.add(this.focusReticle);
    this.scene.add(this.manyPasts.group);
  }

  update(ctx: RegimeContext, dt: number): void {
    this.wallTime += ctx.dtWall;
    // Big bang flash and radiation-era visibility
    const t = ctx.time;
    const tinyT = 5e-5;             // ~50 kyr in Gyr
    const recomb = 3.8e-4;          // ~380 kyr
    // Inflation flash: when cosmic time has just been reset/scrubbed to ~0,
    // reset the wall-time inflation counter. The noise quad then inflates
    // from a central dot over ~1 wall-second.
    if (this.prevCosmicT > 1e-3 && t < 1e-6) this.wallSinceBang = 0;
    this.prevCosmicT = t;
    this.wallSinceBang += ctx.dtWall;
    // Radiation/substrate field intensity. The paper (§18) says the
    // homogeneous substrate mode is active everywhere — dormant during
    // radiation domination, then carrying capacity inhomogeneities
    // afterwards. Visually:
    //   t < recomb*0.9  → bright plasma era (universe is opaque)
    //   t ≈ recomb      → "fog clears" transition
    //   recomb < t < 0.15 Gyr → DARK AGES — but not pitch black; keep a
    //                  faint baseline (~10%) so the substrate still reads
    //                  as a real thing covering everything between galaxies
    //   t ≈ 0.15 Gyr   → REIONIZATION brightening (first stars light up
    //                  intergalactic hydrogen)
    //   t > 1 Gyr       → settle to a dim long-term floor (~6 %) — the
    //                  substrate is everywhere but most capacity-action is
    //                  now concentrated in galaxies (handled by filaments)
    const REIO     = 0.15;     // Gyr — first-stars reionization epoch
    let radIntensity: number;
    if (t < 1e-9) {
      radIntensity = 1.0;
    } else if (t < recomb * 0.9) {
      radIntensity = 1.0 - 0.5 * smoothstep(0, recomb * 0.9, t);
    } else if (t < recomb * 1.1) {
      // "Fog clears" transition — from 0.5 down to the dark-ages floor (0.10)
      radIntensity = 0.5 - 0.40 * smoothstep(recomb * 0.9, recomb * 1.1, t);
    } else if (t < REIO) {
      // Dark ages baseline + small brightening as we approach reionization
      const x = smoothstep(recomb * 1.1, REIO, t);
      radIntensity = 0.10 + 0.05 * x;
    } else if (t < 0.8) {
      // Reionization era — gentle brightening peak as first stars+galaxies form
      const x = smoothstep(REIO, 0.4, t);
      const fade = 1 - smoothstep(0.4, 0.8, t);
      radIntensity = 0.15 + 0.10 * x * fade;
    } else {
      // Long-term substrate floor: faint, ever-present capacity haze
      radIntensity = 0.06;
    }
    const radMat = this.radNoiseMesh.material as THREE.ShaderMaterial;
    radMat.uniforms.intensity.value = radIntensity * (1 + 0.6 * ctx.edePulse);
    // Radiation noise is pure visual ambiance — wall time, never freezes
    radMat.uniforms.time.value += ctx.dtWall;
    // Tint warm in the plasma era, shifts cooler through dark ages →
    // substrate background reads as "field" not "fire" once recombination
    // is over. EDE pulse re-warms it transiently.
    if (t < recomb * 1.1) {
      radMat.uniforms.tint.value.setRGB(
        1.0, 0.55 + 0.15 * ctx.edePulse, 0.30 + 0.20 * ctx.edePulse
      );
    } else {
      // Cool substrate haze: dim blue-grey
      radMat.uniforms.tint.value.setRGB(
        0.55 + 0.45 * ctx.edePulse, 0.62 + 0.20 * ctx.edePulse, 0.78
      );
    }
    // Inflation factor: starts huge after Big Bang, decays to 1 over ~1 sec
    radMat.uniforms.inflate.value = 1 + 60 * Math.exp(-this.wallSinceBang * 3.5);

    // "Breath" — visible expansion from EDE pulse
    // Hubble flow: galaxy positions scale with a(t). At t≈1 Gyr the universe
    // was ~17 % its present size, at 4 Gyr ~43 %, at 13.8 Gyr exactly 1. The
    // EDE pulse adds a small additional "breath" on top (paper §18). Both
    // factors collapse into a single multiplier `cosmicScale` that drag
    // handlers below also use to un-scale the released world point.
    const breath = 1 + 0.04 * ctx.edePulse;
    const cosmicScale = scaleFactor(ctx.time) * breath;
    this.edeBreath = cosmicScale;

    // Drive galaxy visibility
    const galsLit = clamp01((t - 0.05) / 1.5);
    for (const g of this.galaxies) {
      const lit = clamp01((t - g.birth) / 0.4);
      g.fadeIn = lit * galsLit;
      const m = g.mesh.material as THREE.SpriteMaterial;
      m.opacity = g.fadeIn;
      const haloMat = g.halo!.material as THREE.SpriteMaterial;
      // Pulse halo opacity so the entanglement overlay reads as alive,
      // not a static circle. Pulse runs on wall time so it never freezes.
      const pulse = 0.78 + 0.22 * Math.sin(this.wallTime * 1.3 + g.body.pos[0] * 0.05);
      haloMat.opacity = ctx.entanglementOn ? 0.55 * g.fadeIn * pulse : 0;
    }

    // N-body step with RAR. O(N²) per substep is the dominant CPU load
    // in COSMIC; throttle to every other frame (≈30 Hz physics) and use
    // a single substep with a longer dt. Cosmic positions change so
    // slowly visually that the user can't tell.
    this._nbodyTick = (this._nbodyTick + 1) % 2;
    if (this._nbodyTick === 0) {
      const bodies = this.galaxies.map(g => g.body);
      const visDt = Math.min(0.06, Math.abs(dt)) * Math.sign(dt || 1);
      stepLeapfrog(bodies, visDt, (i, all) => accelOnRAR(i, all, G_SIM, A0_SIM));
    }
    // Apply combined Hubble flow + EDE breath to positions
    for (const g of this.galaxies) {
      g.mesh.position.set(
        g.body.pos[0] * cosmicScale,
        g.body.pos[1] * cosmicScale,
        g.body.pos[2] * cosmicScale
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
    // Filaments brighten earlier and stronger than before — they're the
    // substrate's capacity-gradient bridges between galaxies, paper §11–12.
    // Start coming in around the first-galaxies epoch (~1 Gyr) and reach
    // full strength around 4 Gyr, then hold steady. Small wall-time
    // breathing so they read as alive, not a static graph.
    const filOpacity = 0.85 * clamp01((t - 1.0) / 3.0)
                            * (0.82 + 0.18 * Math.sin(this.wallTime * 0.6));
    this.filMaterial.opacity = filOpacity;

    this.haloGroup.visible = ctx.entanglementOn;

    // Many-Pasts ghost cloud — haunts the brightest galaxies when rewinding
    this.manyPasts.update(
      this.galaxies
        .filter(g => g.fadeIn > 0.3)
        .slice(0, 30)               // cap to 30 brightest to keep it cheap
        .map(g => ({
          id: g.id,
          pos: g.mesh.position,
          scale: g.size * 1.8
        })),
      ctx.dtWall,
      ctx.manyPastsOn
    );

    // Camera is owned by OrbitControls — don't touch it here. The focus
    // reticle below highlights which galaxy the camera ray is currently on.
    // Same logic as galaxy: only show the "I'd drill into this" reticle
    // when zoom is in the second half of the COSMIC band.
    const focused = ctx.zoomIntra > 0.5 && ctx.focus.galaxyId
      ? this.galaxies.find(g => g.id === ctx.focus.galaxyId) : null;
    if (focused) {
      this.focusReticle.visible = true;
      this.focusReticle.position.copy(focused.mesh.position);
      this.focusReticle.scale.setScalar(focused.size * 6 + 0.2);
      const fade = Math.min(1, (ctx.zoomIntra - 0.5) * 3.0);
      (this.focusReticle.material as THREE.SpriteMaterial).opacity = 0.7 * fade;
    } else {
      this.focusReticle.visible = false;
    }
  }

  // Publish the focused galaxy = the lit galaxy nearest the camera's
  // forward ray. Called every frame; the resulting focus is used at the
  // moment of crossing into the GALAXY band.
  publishFocus(): Partial<FocusState> | null {
    const camPos = this.camera.position;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    let bestId: string | null = null;
    let bestPerp2 = Infinity;
    for (const g of this.galaxies) {
      if (g.fadeIn < 0.25) continue;        // skip dim/unborn galaxies
      const dx = g.body.pos[0] * this.edeBreath - camPos.x;
      const dy = g.body.pos[1] * this.edeBreath - camPos.y;
      const dz = g.body.pos[2] * this.edeBreath - camPos.z;
      const along = dx * fwd.x + dy * fwd.y + dz * fwd.z;
      if (along < 0.5) continue;            // behind / very close
      const total2 = dx * dx + dy * dy + dz * dz;
      const perp2  = total2 - along * along;
      // weight by galaxy mass/size so bigger galaxies are preferred when ties
      const weighted = perp2 / (g.size + 0.4);
      if (weighted < bestPerp2) { bestPerp2 = weighted; bestId = g.id; }
    }
    if (bestId === null) return null;
    return { galaxyId: bestId };
  }

  // Where the currently focused galaxy sits in world space (post-Hubble-
  // flow). App lerps the OrbitControls target toward this each frame so
  // the camera flies into the clicked galaxy as the user zooms.
  focusedWorldPos(focus: FocusState): THREE.Vector3 | null {
    if (!focus.galaxyId) return null;
    const g = this.galaxies.find(g => g.id === focus.galaxyId);
    if (!g) return null;
    return new THREE.Vector3(
      g.body.pos[0] * this.edeBreath,
      g.body.pos[1] * this.edeBreath,
      g.body.pos[2] * this.edeBreath
    );
  }

  bloomStrength(ctx: RegimeContext): number {
    return 0.55 + 0.9 * ctx.edePulse;
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
