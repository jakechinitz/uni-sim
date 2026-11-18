// COSMIC: an emergent cosmic web.
//
// The web is not drawn — it forms. A particle-mesh N-body of the total
// clustering matter (baryons + the paper's committed stock at 5.333 per
// baryon, as collisionless dust, §20) is evolved in a Web Worker on the sim's
// integrated background, from Zel'dovich initial conditions. The worker
// streams keyframes; this regime interpolates them on the GPU, so any cosmic
// time — play, rewind, scrub — shows the same deterministic history with no
// per-frame physics on the main thread.
//
// Nothing here applies the galactic response law: the paper's cluster-scale
// and cosmological stock "enters no cell and evolves as collisionless matter".
//
// What is decorative: point colours and sizes, the luminosity-vs-density
// mapping (matter parcels shine once their neighbourhood has collapsed), the
// spherical cut out of the periodic box, and the plasma-era backdrop.

import * as THREE from 'three';
import { Regime, RegimeContext, DragTarget, FocusState, HoverInfo } from './Regime';
import { radialGlow } from '../render/Glow';
import { smoothstep } from '../util/lerp';
import { a as scaleFactor, hubble, omegaMatterH2, checkpoints, OMEGA_M, LITTLE_H, STOCK_PER_BARYON } from '../core/Cosmology';
import { makeGrowth } from '../core/LinearTheory';
import { halfTable } from '../util/half';
import { ManyPasts } from '../render/ManyPasts';
import type { QualityLevel } from '../core/Quality';
import type { WebMessage, WebRequest } from '../workers/cosmicWeb.worker';

const BOX = 60;               // world units across the comoving box at a = 1
const BOX_MPC_H = 200;        // comoving box side, h⁻¹Mpc
const TEX_W = 256;            // keyframe texture width (tracers per row)
const H100 = 0.1022712;       // 100 km/s/Mpc in 1/Gyr
// Simulation size and number of rendered tracers per quality level. The run
// itself is the same at every level (it is off the main thread); only the
// number of points drawn changes, and each point is brightened to compensate.
const LEVELS: Record<QualityLevel, { n: number; tracers: number }> = {
  low:    { n: 64, tracers: 32768 },
  medium: { n: 64, tracers: 65536 },
  high:   { n: 64, tracers: 131072 },
};
const CUT_R = 0.5;            // spherical cut radius (box units)

let growthFn: ((a: number) => { D: number; dDda: number }) | null = null;
function growth(a: number): number {
  if (!growthFn) growthFn = makeGrowth(hubble, (x) => omegaMatterH2(x) * H100 * H100, 2.2);
  return growthFn(a).D;
}

// Raycast target standing in for the GPU-displaced tracers.
class TracerPicker extends THREE.Object3D {
  constructor(private owner: CosmicRegime) { super(); }
  raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const hit = this.owner.nearestToRay(raycaster.ray, 0.012, 0.05, true);
    if (hit) intersects.push({ distance: hit.along, point: hit.point, object: this, index: hit.index });
  }
}

export class CosmicRegime extends Regime {
  private radNoiseMesh: THREE.Mesh;
  private focusReticle!: THREE.Sprite;
  private manyPasts = new ManyPasts(new THREE.Color(0x9b8dff), 3.5);
  private picker = new TracerPicker(this);
  private wallSinceBang = 999;
  private prevCosmicT = 1;
  private seed: number;

  // ---- web state ----
  private level: QualityLevel | null = null;
  private worker: Worker | null = null;
  private nR = 0;                              // rendered tracers
  private nSide = 0;                           // particles per side in the run
  private q: Float32Array | null = null;       // display lattice positions (box units)
  private aKeys: Float32Array | null = null;
  private dKeys: Float32Array | null = null;
  private frames: (Uint16Array | null)[] = [];
  private textures: (THREE.DataTexture | null)[] = [];
  private ready = 0;                           // contiguous keyframes received
  private done = false;
  private points: THREE.Points | null = null;
  private halo: THREE.Points | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private haloMaterial: THREE.ShaderMaterial | null = null;
  // current interpolation state
  private kA = 0;
  private mix = 0;
  private scale = BOX;                          // world units per box unit (comoving view)
  private lit = 1;
  private deltaLin: Float32Array | null = null;
  private collapseB = 0.2;                      // 1/√(2(S_gal − S_cell))
  private collapseA = 1e3;                      // δ_c / D(a)
  private viewH = 800;
  // CPU mirror of tracer world positions / densities (filled on demand)
  private pos: Float32Array | null = null;
  private rho: Float32Array | null = null;
  private posStamp = -1;
  private frameNo = 0;
  private focusCache: { frame: number; id: string | null } = { frame: -99, id: null };
  private ghostIds: number[] = [];
  private ghostStamp = -999;

  constructor(aspect: number, seed: number) {
    super(aspect);
    this.seed = seed;
    this.scene.fog = null;
    this.camera.position.set(0, 0, BOX * 1.05);
    this.camera.lookAt(0, 0, 0);

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

    this.draggable.add(this.picker);

    // Ring that follows the currently focused galaxy.
    this.focusReticle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlow(256, 'rgba(0,0,0,0)', 'rgba(122,215,255,0.85)', 'rgba(122,215,255,0)'),
      color: 0x7ad7ff,
      blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false,
      transparent: true, opacity: 0.4
    }));
    this.focusReticle.visible = false;
    this.scene.add(this.focusReticle);
    this.scene.add(this.manyPasts.group);
  }

  // ---------------------------------------------------------------- web ----
  private startWeb(level: QualityLevel) {
    this.disposeWeb();
    this.level = level;
    const cfg = LEVELS[level];
    this.nSide = cfg.n;
    const worker = new Worker(new URL('../workers/cosmicWeb.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = (ev: MessageEvent<WebMessage>) => {
      if (this.worker !== worker) return;      // stale run
      const m = ev.data;
      if (m.type === 'meta') this.onMeta(m.aKeys, m.dKeys, m.q, m.nRender, m.deltaLin, m.sCell, m.sGal);
      else if (m.type === 'frame') {
        this.frames[m.k] = m.data;
        while (this.ready < this.frames.length && this.frames[this.ready]) this.ready++;
      } else if (m.type === 'done') { this.done = true; worker.terminate(); this.worker = null; }
    };
    const req: WebRequest = { seed: this.seed, n: cfg.n, nRender: cfg.tracers, boxMpcH: BOX_MPC_H };
    worker.postMessage(req);
  }

  private onMeta(aKeys: Float32Array, dKeys: Float32Array, q: Float32Array, nR: number,
                 deltaLin: Float32Array, sCell: number, sGal: number) {
    this.aKeys = aKeys; this.dKeys = dKeys; this.nR = nR;
    this.frames = new Array(aKeys.length).fill(null);
    this.textures = new Array(aKeys.length).fill(null);
    this.ready = 0;
    // Each tracer stands for a parcel one cell across; draw it at a seeded
    // random point inside its cell so the lattice does not show.
    const cell = 1 / this.nSide;
    const disp = new Float32Array(nR * 3), idx = new Float32Array(nR), rnd = new Float32Array(nR * 2);
    let h = (this.seed ^ 0x51ed270b) >>> 0;
    const r = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
    for (let i = 0; i < nR; i++) {
      disp[i * 3]     = q[i * 3]     + (r() - 0.5) * cell;
      disp[i * 3 + 1] = q[i * 3 + 1] + (r() - 0.5) * cell;
      disp[i * 3 + 2] = q[i * 3 + 2] + (r() - 0.5) * cell;
      idx[i] = i; rnd[i * 2] = r(); rnd[i * 2 + 1] = r();
    }
    this.q = disp;
    this.pos = new Float32Array(nR * 3);
    this.rho = new Float32Array(nR);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(disp, 3));
    geom.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    geom.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 2));
    geom.setAttribute('aDelta', new THREE.BufferAttribute(deltaLin, 1));
    this.deltaLin = deltaLin;
    this.collapseB = 1 / Math.sqrt(2 * Math.max(0.5, sGal - sCell));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mk = (halo: boolean) => new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: null }, uB: { value: null }, uMix: { value: 0 },
        uScale: { value: BOX }, uPx: { value: 800 }, uLit: { value: 1 },
        uTexW: { value: TEX_W }, uHalo: { value: halo ? 1 : 0 }, uCut: { value: CUT_R },
        uCollapse: { value: new THREE.Vector2(1e3, this.collapseB) },
        uGain: { value: Math.sqrt(131072 / nR) },
      },
      vertexShader: /* glsl */`
        uniform sampler2D uA; uniform sampler2D uB;
        uniform float uMix, uScale, uPx, uLit, uTexW, uHalo, uCut;
        uniform vec2 uCollapse;                              // (δ_c / D(a), 1/√(2(S_gal − S_cell)))
        uniform float uGain;                                 // compensates for fewer drawn tracers
        attribute float aIdx; attribute vec2 aRnd; attribute float aDelta;
        varying vec3 vCol; varying float vAlpha;
        float erfc_(float x) {                               // Abramowitz & Stegun 7.1.26
          float ax = abs(x), t = 1.0 / (1.0 + 0.3275911 * ax);
          float y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * exp(-ax * ax);
          return x >= 0.0 ? y : 2.0 - y;
        }
        void main() {
          float row = floor(aIdx / uTexW);
          ivec2 tc = ivec2(int(aIdx - row * uTexW), int(row));
          vec4 d = mix(texelFetch(uA, tc, 0), texelFetch(uB, tc, 0), uMix);
          vec3 x = fract(position + d.xyz) - 0.5;            // comoving, periodic box
          float edge = 1.0 - smoothstep(uCut - 0.06, uCut, length(x));
          vec4 mv = modelViewMatrix * vec4(x * uScale, 1.0);
          gl_Position = projectionMatrix * mv;
          float rho = max(d.w, 0.0);
          float dens = smoothstep(1.5, 16.0, rho);           // well-collapsed neighbourhood
          float core = smoothstep(20.0, 140.0, rho);         // cluster cores
          // Starlight ∝ the fraction of this parcel already collapsed into
          // galaxy-mass haloes (extended Press–Schechter, conditional on the
          // parcel's own linear overdensity). Diffuse gas is faint everywhere.
          float fColl = min(1.0, erfc_((uCollapse.x - aDelta) * uCollapse.y));
          float shine = pow(fColl, 0.55);                    // display gamma (decorative)
          float lum = 0.03 + shine * (0.46 + 0.40 * dens + 0.35 * core) * (0.5 + aRnd.y);
          float size = (0.08 + 0.08 * aRnd.x) * (1.0 + 0.7 * dens + 0.9 * core);
          float over = fColl;
          vec3 cool = vec3(0.50, 0.68, 1.0), warm = vec3(1.0, 0.84, 0.62);
          vCol = mix(cool, warm, clamp(0.8 * core + 0.3 * dens + 0.3 * (aRnd.x - 0.5), 0.0, 1.0));
          if (uHalo > 0.5) {                                 // committed-stock overlay
            size *= 5.0; lum = 0.035 * (0.3 * over + dens) * uLit; vCol = vec3(0.35, 0.8, 1.0);
          }
          float px = uPx * size * mix(1.0, uGain, 0.35) / max(0.05, -mv.z);
          float fade = min(1.0, px / 1.6);
          gl_PointSize = clamp(px, 1.6, 96.0);
          vAlpha = lum * edge * fade * uGain;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol; varying float vAlpha;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;
          float g = exp(-r2 * 4.5) + 0.22 * (1.0 - r2) * (1.0 - r2);
          gl_FragColor = vec4(vCol * g * vAlpha, 1.0);
        }`,
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    });
    this.material = mk(false);
    this.haloMaterial = mk(true);
    this.points = new THREE.Points(geom, this.material);
    this.points.frustumCulled = false;
    this.halo = new THREE.Points(geom, this.haloMaterial);
    this.halo.frustumCulled = false;
    this.halo.visible = false;
    this.scene.add(this.halo);
    this.scene.add(this.points);
  }

  private texture(k: number): THREE.DataTexture {
    let t = this.textures[k];
    if (!t) {
      t = new THREE.DataTexture(this.frames[k]! as Uint16Array<ArrayBuffer>, TEX_W, this.nR / TEX_W, THREE.RGBAFormat, THREE.HalfFloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      this.textures[k] = t;
    }
    return t;
  }

  private disposeWeb() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    for (const t of this.textures) t?.dispose();
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); }
    if (this.halo) this.scene.remove(this.halo);
    this.material?.dispose(); this.haloMaterial?.dispose();
    this.points = this.halo = null; this.material = this.haloMaterial = null;
    this.frames = []; this.textures = []; this.ready = 0; this.done = false;
    this.aKeys = this.dKeys = this.q = this.pos = this.rho = null;
    this.posStamp = -1;
  }

  dispose() {
    this.disposeWeb();
    super.dispose();
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    this.viewH = h;
  }

  /** Fraction of the structure-formation run received so far (1 when complete). */
  progress(): number {
    if (!this.aKeys) return 0;
    return this.done ? 1 : this.ready / this.aKeys.length;
  }

  // Fill the CPU mirror of world positions and densities for this frame.
  private syncCpu() {
    if (this.posStamp === this.frameNo || !this.q || this.ready < 2) return;
    const A = this.frames[this.kA]!, B = this.frames[this.kA + 1]!;
    const T = halfTable(), q = this.q, pos = this.pos!, rho = this.rho!, m = this.mix, s = this.scale;
    for (let i = 0; i < this.nR; i++) {
      const o = i * 4;
      for (let c = 0; c < 3; c++) {
        const d = T[A[o + c]] * (1 - m) + T[B[o + c]] * m;
        let x = q[i * 3 + c] + d; x -= Math.floor(x);
        pos[i * 3 + c] = (x - 0.5) * s;
      }
      rho[i] = T[A[o + 3]] * (1 - m) + T[B[o + 3]] * m;
    }
    this.posStamp = this.frameNo;
  }

  /**
   * Tracer nearest to a ray, in angular terms. `slope`/`floor` set the pick
   * radius (world units) as slope·distance, at least floor.
   */
  nearestToRay(ray: THREE.Ray, slope: number, floor: number, mustBeVisible: boolean):
      { index: number; along: number; point: THREE.Vector3 } | null {
    if (this.ready < 2 || !this.pos) return null;
    this.syncCpu();
    const pos = this.pos, rho = this.rho!, o = ray.origin, d = ray.direction;
    const rMax2 = (CUT_R * 0.96 * this.scale) ** 2;
    const rhoMin = mustBeVisible && this.lit > 0.3 ? 2.0 : 0;
    let best = -1, bestScore = Infinity, bestAlong = 0;
    for (let i = 0; i < this.nR; i++) {
      if (rho[i] < rhoMin) continue;
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      if (px * px + py * py + pz * pz > rMax2) continue;
      const dx = px - o.x, dy = py - o.y, dz = pz - o.z;
      const along = dx * d.x + dy * d.y + dz * d.z;
      if (along < 0.2) continue;
      const perp2 = dx * dx + dy * dy + dz * dz - along * along;
      const tol = Math.max(floor, slope * along);
      if (perp2 > tol * tol) continue;
      // Prefer the tracer closest to the ray in screen terms, then the nearer one.
      const score = perp2 / (along * along) + 1e-6 * along;
      if (score < bestScore) { bestScore = score; best = i; bestAlong = along; }
    }
    if (best < 0) return null;
    return { index: best, along: bestAlong, point: new THREE.Vector3(pos[best * 3], pos[best * 3 + 1], pos[best * 3 + 2]) };
  }

  private tracerIndex(id: string | null): number {
    if (!id || !id.startsWith('gx-') || !this.nR) return -1;
    const n = parseInt(id.slice(3), 10);
    return Number.isFinite(n) ? ((n % this.nR) + this.nR) % this.nR : -1;
  }

  // ------------------------------------------------------------- update ----
  update(ctx: RegimeContext, _dt: number): void {
    this.frameNo++;
    if (this.level !== ctx.quality.level) this.startWeb(ctx.quality.level);

    // Big bang flash and radiation-era visibility
    const t = ctx.time;
    const recomb = checkpoints.T_RECOMB;   // ~370 kyr
    // Inflation flash: when cosmic time has just been reset/scrubbed to ~0,
    // reset the wall-time inflation counter. The noise quad then inflates
    // from a central dot over ~1 wall-second.
    if (this.prevCosmicT > 1e-3 && t < 1e-6) this.wallSinceBang = 0;
    this.prevCosmicT = t;
    this.wallSinceBang += ctx.dtWall;
    // Radiation/substrate field intensity. The paper (§19) says the
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

    // ---- the web at cosmic time t ----
    const aNow = scaleFactor(t);
    // Comoving view: the expansion is divided out so structure formation is
    // visible at every epoch. The HUD reports the physical scale (× a).
    this.scale = BOX;
    const Dnow = growth(Math.max(aNow, 1e-6));
    this.collapseA = 1.686 / Math.max(Dnow, 1e-4);          // spherical-collapse threshold over growth
    // Mean collapsed fraction, for CPU-side "is anything lit yet" decisions.
    this.lit = smoothstep(checkpoints.T_FIRST_BH * 0.6, checkpoints.T_GALAXIES * 1.4, t);
    if (this.points && this.material && this.dKeys && this.ready >= 2) {
      // Displacements grow ∝ D(a) in the linear era, so keyframes are
      // interpolated in the growth factor rather than in time.
      const D = Dnow;
      const last = this.ready - 1;
      let k = 0;
      while (k < last - 1 && this.dKeys[k + 1] <= D) k++;
      const span = this.dKeys[k + 1] - this.dKeys[k];
      this.kA = k;
      this.mix = Math.min(1, Math.max(0, span > 0 ? (D - this.dKeys[k]) / span : 0));
      const pr = Math.min(window.devicePixelRatio || 1, ctx.quality.pixelRatioCap);
      const uPx = (this.viewH * pr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
      for (const mat of [this.material, this.haloMaterial!]) {
        mat.uniforms.uA.value = this.texture(k);
        mat.uniforms.uB.value = this.texture(k + 1);
        mat.uniforms.uMix.value = this.mix;
        mat.uniforms.uScale.value = this.scale;
        mat.uniforms.uPx.value = uPx;
        mat.uniforms.uLit.value = this.lit;
        (mat.uniforms.uCollapse.value as THREE.Vector2).set(this.collapseA, this.collapseB);
      }
      this.points.visible = true;
      this.halo!.visible = ctx.entanglementOn;
    } else if (this.points) {
      this.points.visible = false;
      this.halo!.visible = false;
    }

    // Many-Pasts ghosts haunt a handful of the densest nodes when rewinding.
    if (ctx.manyPastsOn && this.ready >= 2) {
      this.syncCpu();
      if (this.frameNo - this.ghostStamp > 120) {
        const rho = this.rho!, cand: number[] = [];
        for (let i = 0; i < Math.min(this.nR, 8192); i++) cand.push(i);
        cand.sort((x, y) => rho[y] - rho[x]);
        this.ghostIds = cand.slice(0, 24);
        this.ghostStamp = this.frameNo;
      }
      const pos = this.pos!;
      this.manyPasts.update(this.ghostIds.map(i => ({
        id: `gx-${i}`, pos: new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), scale: 0.5,
      })), ctx.dtWall, true);
    } else {
      this.manyPasts.update([], ctx.dtWall, false);
    }

    // Focus reticle: only in the second half of the COSMIC band, where the
    // next zoom step would drill into the focused galaxy.
    const fi = ctx.zoomIntra > 0.5 ? this.tracerIndex(ctx.focus.galaxyId) : -1;
    if (fi >= 0 && this.ready >= 2) {
      this.syncCpu();
      const pos = this.pos!;
      this.focusReticle.visible = true;
      this.focusReticle.position.set(pos[fi * 3], pos[fi * 3 + 1], pos[fi * 3 + 2]);
      const camDist = this.camera.position.distanceTo(this.focusReticle.position);
      this.focusReticle.scale.setScalar(Math.max(0.5, camDist * 0.035));
      (this.focusReticle.material as THREE.SpriteMaterial).opacity = 0.4 * Math.min(1, (ctx.zoomIntra - 0.5) * 3.0);
    } else {
      this.focusReticle.visible = false;
    }
  }

  // The galaxy nearest the camera's forward ray, among parcels that have
  // collapsed enough to host one. Recomputed every few frames.
  publishFocus(): Partial<FocusState> | null {
    if (this.ready < 2) return null;
    if (this.frameNo - this.focusCache.frame >= 6) {
      const ray = new THREE.Ray(this.camera.position.clone(), this.camera.getWorldDirection(new THREE.Vector3()));
      const hit = this.nearestToRay(ray, 0.5, 2.0, true);
      this.focusCache = { frame: this.frameNo, id: hit ? `gx-${hit.index}` : null };
    }
    return this.focusCache.id ? { galaxyId: this.focusCache.id } : null;
  }

  focusedWorldPos(focus: FocusState): THREE.Vector3 | null {
    const i = this.tracerIndex(focus.galaxyId);
    if (i < 0 || this.ready < 2) return null;
    this.syncCpu();
    const pos = this.pos!;
    return new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  }

  bloomStrength(ctx: RegimeContext): number {
    return 0.6 + 0.5 * ctx.edePulse;
  }

  // Galaxies in the web follow the precomputed history, so they are
  // selectable (click, then zoom in) but not draggable.
  pick(intersection: THREE.Intersection): DragTarget | null {
    if (intersection.object !== this.picker || intersection.index === undefined) return null;
    return {
      id: `gx-${intersection.index}`,
      object: this.picker,
      worldPos: intersection.point.clone(),
      clickOnly: true,
      onDragMove: () => {},
      onDragEnd: () => {},
    };
  }

  hoverInfo(intersection: THREE.Intersection): HoverInfo | null {
    if (intersection.object !== this.picker || intersection.index === undefined || !this.rho) return null;
    const i = intersection.index;
    const rho = this.rho[i];
    const env = rho < 0.6 ? 'void' : rho < 3 ? 'sheet' : rho < 20 ? 'filament' : 'node · cluster';
    // Mass of one simulated parcel: Ω_m ρ_crit V_box / N.
    const mParcel = OMEGA_M * 2.775e11 * BOX_MPC_H ** 3 / LITTLE_H / this.nSide ** 3;
    const exp = Math.floor(Math.log10(mParcel));
    const sup = String(exp).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]).join('');
    return {
      title: `Galaxy gx-${i} · ${env}`,
      rows: [
        { k: 'local density', v: `${rho.toFixed(rho < 10 ? 2 : 0)} × cosmic mean` },
        { k: 'matter parcel', v: `${(mParcel / 10 ** exp).toFixed(1)} × 10${sup} M☉` },
        { k: 'stock : baryons', v: `${STOCK_PER_BARYON} : 1 (committed, pressureless)` },
        { k: 'box', v: `${BOX_MPC_H} h⁻¹Mpc comoving · ${this.nSide}³ particles` },
      ],
      note: 'Click to select, then zoom in to enter this galaxy. The web is a particle-mesh N-body of baryons plus committed stock on the paper\'s expansion history; it is not drawn by hand.'
    };
  }
}
