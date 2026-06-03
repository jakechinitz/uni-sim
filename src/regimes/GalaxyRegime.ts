// GALAXY: spiral disk + central BH. Stars draggable; orbits use RAR so outer disk
// has flat rotation curve (paper §14 — no dark matter needed).

import * as THREE from 'three';
import { Regime, RegimeContext, DragTarget, HoverInfo, FocusState } from './Regime';
import { mulberry32 } from '../core/Rng';
import { hashStr } from '../util/hash';
import { radialGlow, deltaSField } from '../render/Glow';
import { visualRatePerWall } from '../util/timeScale';
import { BlackHole } from '../render/BlackHole';
import { Body, nuRAR } from '../core/Gravity';
import { TelegrapherField } from '../render/Telegrapher';
import { ManyPasts } from '../render/ManyPasts';
import { hawkingSolar, scrambling, formatSI } from '../core/Closure';
import { M_SUN } from '../util/units';
import { imfSample, mainSeqLifetime, SUPERNOVA_MASS } from '../core/StellarLifecycle';

// 8,000 stars across an 18-unit disk — enough for a real spiral-galaxy
// brightness wash without overloading the per-frame star integration
// (~ N × 5 BHs × 2 substeps = 80k force ops/frame) or the hover raycast
// (linear in N at every pointer event, now also throttled to 30 Hz).
// Tried 12,000 first; visually beautiful but caused frame hitches on
// pointer movement. Each point still represents ~10⁷ real solar
// systems (Milky Way has ~3×10¹¹ stars) — see scale-vs-reality note
// in the README.
const N_STARS = 8000;
// Density-wave (precessing-ellipse) spiral parameters. ARM_TWIST sets the
// spiral pitch (major-axis orientation in radians per unit guiding radius →
// a 2-arm trailing pattern). PATTERN_FRAC sets the rigid pattern speed as a
// fraction of the co-rotation orbital rate. ARM_ECC_MAX caps the ellipse
// eccentricity (arm sharpness) at the disk edge. See GalaxyRegime.update().
const ARM_TWIST = 0.32;
const PATTERN_FRAC = 0.85;
const ARM_ECC_MAX = 0.42;
const R_GAL   = 18;
const G_SIM   = 0.0008;
const A0_SIM  = 0.00010;

interface BHView {
  mesh: BlackHole;
  body: Body;
  mass: number;          // sim units (sets RAR g_bar around it)
  realMassSolar: number; // physical mass for hover (T_H, S_BH)
  isCentral: boolean;
  diskTiltAxis: THREE.Vector3;
  diskTiltAngle: number;
  entHalo: THREE.Sprite; // per-BH entanglement halo — parented to mesh
                         // so dragging the BH moves its halo with it.
}

// Build a δS-field halo sprite for a BH. The texture's alpha profile
// is the paper's static-limit capacity drain δS ∝ r_s/r (paper §11),
// clamped to 1 inside the horizon and quadratic-faded at the sprite
// edge. When multiple bodies' halos overlap, additive blending sums
// them — exactly how the static linearised equation ∇²δS = −(κ/γ)ρ
// superposes contributions. Opacity is driven each frame by
// ctx.entanglementOn × pulse so each BH announces its drained
// capacity. Non-pickable so clicks fall through to the BH mesh itself.
function makeBHHalo(scaleHint: number): THREE.Sprite {
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: deltaSField(256, 0.06, '#7ad7ff'),
    color: 0x7ad7ff,
    blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true,
    opacity: 0
  }));
  halo.scale.setScalar(scaleHint);
  halo.raycast = () => {};
  return halo;
}

interface Star {
  body: Body;
  baseColor: THREE.Color;
  mass: number;        // M☉ — drives lifetime + death channel
  birth: number;       // cosmic time (Gyr) when this star ignites
  lifetime: number;    // Gyr — main-sequence span, t ∝ M^−2.5
  state: 'main' | 'giant' | 'dead' | 'absorbed';
  deathT: number;      // cosmic Gyr when it died/was eaten (Infinity if alive)
  spawnedBH: boolean;  // true once we've added a stellar BH from a supernova
  // Density-wave (precessing-ellipse) orbit — drives the star analytically in
  // update() instead of free integration, so the spiral can't wind or disperse.
  gr: number;          // guiding radius (ellipse semi-major axis)
  ecc: number;         // ellipse eccentricity (sets local arm sharpness)
  omega: number;       // streaming rate Ω(r)=v(r)/r around the ellipse
  phase0: number;      // phase around the ellipse at t=0
  yOff: number;        // vertical disk offset (held constant)
}


export class GalaxyRegime extends Regime {
  private stars: Star[] = [];
  private starGeom: THREE.BufferGeometry;
  private starMaterial: THREE.PointsMaterial;
  private points: THREE.Points;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private bhs: BHView[] = [];
  private spiralMesh: THREE.Mesh;
  private spiralMat: THREE.ShaderMaterial;
  private haloMesh: THREE.Sprite;
  private fieldLines: THREE.LineSegments;
  private flMaterial: THREE.LineBasicMaterial;
  private entGroup!: THREE.Group;
  private picked: THREE.Sprite;
  private focusReticle!: THREE.Sprite;
  private time = 0;
  private wallTime = 0;
  // Magnetic cursor support: pick() updates these when a star is under
  // the pointer; update() lerps the picked sprite onto that star and
  // fades it once the hover stops being refreshed.
  private hoveredStarIdx = -1;
  private hoveredAtWall  = -10;
  // Catch-up suppression: a freshly mounted galaxy at cosmic t ≈ 13 Gyr —
  // or a cached galaxy revisited after cosmic time has jumped forward —
  // would otherwise replay every historic supernova / BH-spawn / merger
  // ringdown in a single frame, spamming the screen with telegrapher
  // rings. While `silentCatchup` is true we still advance state (stars
  // die, remnants spawn) but skip the visual fanfare. Set per-frame
  // based on the cosmic-time gap since last update.
  private silentCatchup = true;
  private lastSeenCosmicT = -1;
  private telegrapher = new TelegrapherField(2.0, new THREE.Color(0x9ee0ff));
  private manyPasts = new ManyPasts(new THREE.Color(0x9b8dff), 2.5);
  // Supernova flare pool — when a massive star dies it spawns one of
  // these expanding-fading sprites at its position so the explosion
  // reads as an actual fireball rather than a "dead pixel" point.
  private snFlares: { sp: THREE.Sprite; birthT: number; type: 'sn' | 'pn' }[] = [];
  private snFlareTex!: THREE.Texture;
  private snGroup = new THREE.Group();

  constructor(aspect: number, seed: number) {
    super(aspect);
    this.camera.position.set(0, R_GAL * 0.55, R_GAL * 1.05);
    this.camera.lookAt(0, 0, 0);

    const rng = mulberry32(hashStr(`galaxy|${seed}`));

    // --- Black holes ---
    // Central SMBH varies by seed: 85% have one (M ∈ ~5×10⁵..10¹⁰ M☉, log-uniform
    // → broad range from dwarf to supermassive). 15% galaxies are "quiescent"
    // and have no visible central BH (dwarf irregulars, some lenticulars).
    const hasCentral = rng() > 0.15;
    if (hasCentral) {
      // Sample log-uniformly so we get a realistic mix of dwarf, milky-way-class,
      // and M87-class BHs
      const logM = 5.5 + rng() * 4.0;   // log10(M / M☉) ∈ [5.5, 9.5]
      const massSolar = Math.pow(10, logM);
      // Visual radius shrunk to ~55% of the earlier mapping so the BH
      // sits in a richer surrounding field rather than dominating the
      // composition. The q-shell + photon ring + ambient haze all scale
      // off this `radius` so one number controls the whole BH footprint.
      const simMass = 200 + 2300 * (logM - 5.5) / 4.0;
      const radius  = 0.11 + 0.22 * (simMass - 200) / 2300;
      const diskScale = 0.65 + rng() * 0.7;
      const diskInner = (2.0 + rng() * 1.2) * diskScale;
      const diskOuter = diskInner + (3.5 + rng() * 5.0);
      const tilt      = (rng() - 0.5) * Math.PI * 0.8;
      // Palette driven by SMBH mass via Shakura-Sunyaev disk-temperature
      // scaling: T_eff ∝ M^(-1/4) at the inner stable orbit. Smaller
      // SMBHs run hotter and bluer; massive SMBHs run cooler and redder
      // / purpler. logM range [5.5, 9.5] maps linearly to "heat" ∈ [0,1]:
      //   heat = 1 → small (~10⁵·⁵ M☉) → blue-white outer disk
      //   heat = 0 → massive (~10⁹·⁵ M☉) → warm purple outer disk
      // Inner-disk peak temp is always white-yellow plasma (hot color).
      const heat = Math.max(0, Math.min(1, (9.5 - logM) / 4));
      const lerpHex = (aHex: string, bHex: string, t: number) =>
        new THREE.Color(aHex).lerp(new THREE.Color(bHex), t);
      const hot  = new THREE.Color('#fff4d8');
      const mid  = lerpHex('#ff7050', '#ffaa55', heat);   // massive → warm-red; small → yellow-orange
      const cool = lerpHex('#a060ff', '#7ad7ff', heat);   // massive → purple; small → cyan-blue
      const mesh = new BlackHole({
        radius, diskInner, diskOuter, diskTilt: tilt, hot, mid, cool
      });
      // Small central offset so even the "central" BH wanders a bit per seed
      const cx = (rng() - 0.5) * 1.5;
      const cz = (rng() - 0.5) * 1.5;
      mesh.position.set(cx, 0, cz);
      mesh.userData = { type: 'bh', index: 0 };
      this.scene.add(mesh);
      this.draggable.add(mesh);
      // Central halo: large (proportional to SMBH mass), parented so it
      // moves with the BH when dragged. Opacity driven in update().
      // Central SMBH halo: sized to the visible BH radius, not the
      // whole galaxy — anything larger looks like a glass dome.
      const halo = makeBHHalo(radius * 6);
      mesh.add(halo);
      this.bhs.push({
        mesh,
        body: { id: 'bh-central', pos: [cx, 0, cz], vel: [0, 0, 0], mass: simMass, fixed: true },
        mass: simMass,
        realMassSolar: massSolar,
        isCentral: true,
        diskTiltAxis: new THREE.Vector3(1, 0, 0),
        diskTiltAngle: tilt,
        entHalo: halo
      });
    }

    // Stellar-mass BHs scattered through the disk (collapsed massive stars,
    // paper §20 same q→0 mechanism, smaller scale). Visibly hot per Hawking.
    const nStellar = 2 + Math.floor(rng() * 6);   // 2..7
    for (let i = 0; i < nStellar; i++) {
      const r   = 4 + rng() * (R_GAL - 6);
      const ang = rng() * Math.PI * 2;
      const x   = r * Math.cos(ang);
      const z   = r * Math.sin(ang);
      const y   = (rng() - 0.5) * 0.6;
      // Stellar BH masses 5..40 M☉ → sim mass small
      const massSolar = 5 + rng() * 35;
      const simMass   = 4 + rng() * 16;
      const radius    = 0.033 + 0.022 * (massSolar / 40);   // ~55% of prior scale
      const tilt      = (rng() - 0.5) * Math.PI;
      // Hotter Hawking glow for smaller BHs (T_H ∝ 1/M)
      const heat = 1 - (massSolar - 5) / 35;
      const hot  = new THREE.Color().setRGB(1, 0.85 + 0.15 * heat, 0.65 + 0.35 * heat);
      const mid  = new THREE.Color().setRGB(1, 0.55 - 0.15 * heat, 0.30 - 0.20 * heat);
      const cool = new THREE.Color('#ffb060');
      const mesh = new BlackHole({
        radius,
        diskInner: 2.2, diskOuter: 5.5,
        diskTilt: tilt,
        hot, mid, cool
      });
      mesh.position.set(x, y, z);
      mesh.userData = { type: 'bh', index: this.bhs.length };
      this.scene.add(mesh);
      this.draggable.add(mesh);
      // Initial tangential velocity ≈ Keplerian circular speed around the
      // central SMBH so the stellar BH starts on roughly-stable orbit.
      // If there's no central, just sit and feel each other's gravity.
      let vx = 0, vy = 0, vz = 0;
      const cMass = this.centralMass();
      if (cMass > 0) {
        const vc = this.circularSpeed(r);
        const sgn = rng() < 0.5 ? -1 : 1;    // mix orbit directions for variety
        vx = -sgn * Math.sin(ang) * vc;
        vz =  sgn * Math.cos(ang) * vc;
      }
      const halo = makeBHHalo(radius * 5);
      mesh.add(halo);
      this.bhs.push({
        mesh,
        body: {
          id: `bh-stellar-${i}`,
          pos: [x, y, z],
          vel: [vx, vy, vz],
          mass: simMass,
          fixed: false             // stellar BHs are now dynamic
        },
        mass: simMass,
        realMassSolar: massSolar,
        isCentral: false,
        diskTiltAxis: new THREE.Vector3(1, 0, 0),
        diskTiltAngle: tilt,
        entHalo: halo
      });
    }

    // Halo (entanglement overlay)
    this.haloMesh = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlow(512, 'rgba(0,0,0,0)', 'rgba(122,215,255,0.6)', 'rgba(122,215,255,0)'),
      blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0
    }));
    this.haloMesh.scale.setScalar(R_GAL * 3.8);
    this.scene.add(this.haloMesh);

    // Spiral background disk shader. Three structural layers always on:
    //   - exponential bulge concentrated near the centre
    //   - exponential disk falloff in radius
    //   - 2 main log-spiral arms + 2 weaker secondary arms
    // Plus three "real galaxies have these but the paper doesn't" detail
    // layers, gated by `detail` uniform (driven by the disk-detail UI
    // toggle):
    //   - dust lanes along the inner edge of each arm (offset spiral)
    //   - pinkish HII star-forming knots along arm peaks
    //   - knotty fBm clumping on the arms
    // None of these affect dynamics; only the disk visual.
    const spiralGeom = new THREE.CircleGeometry(R_GAL, 160);
    this.spiralMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        time:       { value: 0 },
        twist:      { value: 4.4 },
        coreColor:  { value: new THREE.Color('#fff4d0') },   // bulge: warm yellow-white
        midColor:   { value: new THREE.Color('#ffc890') },   // mid-disk: warm
        edgeColor:  { value: new THREE.Color('#88b8ff') },   // outer disk: cool young blue
        hiiColor:   { value: new THREE.Color('#ff7090') },   // HII regions: pink
        detail:     { value: 1 },                            // 0 = flat, 1 = textured
        // Driven by cosmic time so the disk fades up as the galaxy assembles
        alphaGlobal: { value: 1 }
      },
      vertexShader: /* glsl */`
        varying vec2 vP;
        void main(){
          vP = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float time, twist, alphaGlobal, detail;
        uniform vec3  coreColor, midColor, edgeColor, hiiColor;
        varying vec2 vP;

        float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
        float noise(vec2 p){
          vec2 i=floor(p), f=fract(p);
          vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),
                     mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y);
        }
        float fbm(vec2 p){ float v=0., a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.07; a*=0.5; } return v; }

        void main(){
          float r = length(vP);
          float R = ${R_GAL.toFixed(2)};
          if (r > R || r < 0.0005) discard;
          float t   = r / R;
          float ang = atan(vP.y, vP.x);

          // --- structural layers (always on) ---
          float bulge = exp(-t * 9.5);
          float disk  = exp(-t * 2.2) * (1.0 - smoothstep(0.93, 1.0, t));
          float ph    = ang + twist * log(max(t, 0.03));
          float arm2  = pow(0.5 + 0.5 * cos(2.0 * ph), 9.0);
          float arm4  = pow(0.5 + 0.5 * cos(4.0 * ph + 0.7), 6.0) * 0.45;
          float armStr = arm2 + arm4;

          // --- detail layers (gated by the 'detail' uniform) ---
          // Dust lane: phase-shifted narrow spiral that SUBTRACTS light.
          // Lies just inside each arm, like the dark band in real spirals.
          float dustPh   = ph + 0.6;
          float dustArm  = pow(0.5 + 0.5 * cos(2.0 * dustPh), 14.0);
          float dustMod  = 1.0 - dustArm * 0.65 * smoothstep(0.02, 0.6, t) * detail;
          // Clumpy texture along arms — noise-modulated brightness.
          float clump = 1.0 - detail + detail * (0.6 + 0.55 * fbm(vec2(ang * 5.0, t * 11.0) + time * 0.04));
          armStr *= clump;
          // HII regions: bright pink star-forming knots on arm peaks.
          float hii = detail * smoothstep(0.62, 0.86,
                       fbm(vec2(ang * 7.0, t * 14.0) + time * 0.07)) * arm2;

          // --- combined intensity ---
          float intensity = (1.5 * bulge + disk * (0.55 + 0.95 * armStr)) * dustMod;

          // --- color palette by radius ---
          vec3 col = mix(edgeColor, midColor, smoothstep(0.8, 0.25, t));
          col = mix(col, coreColor, smoothstep(0.25, 0.04, t));
          col = mix(col, hiiColor, hii * 0.85);

          gl_FragColor = vec4(col, clamp(intensity * alphaGlobal, 0.0, 1.0));
          // suppress unused-uniform warning
          float _t = time;
        }
      `
    });
    this.spiralMesh = new THREE.Mesh(spiralGeom, this.spiralMat);
    this.spiralMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.spiralMesh);


    // Stars — points with per-vertex color
    this.starGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(N_STARS * 3);
    const colors    = new Float32Array(N_STARS * 3);

    for (let i = 0; i < N_STARS; i++) {
      // Density-wave spiral seed. Bulge-concentrated guiding radius; each star
      // rides a precessing ellipse whose major axis twists with radius (that
      // twist is the 2-arm pattern). Eccentricity grows outward so the bulge
      // stays round and the outer arms read sharply.
      const u = rng();
      const gr = R_GAL * (0.05 + 0.95 * Math.pow(u, 0.65));
      const ecc = ARM_ECC_MAX * Math.min(1, gr / R_GAL);
      const phase0 = rng() * Math.PI * 2;
      const omega = this.circularSpeed(gr) / Math.max(gr, 0.1);
      const phi0 = ARM_TWIST * gr;            // pattern (major-axis) angle at t=0
      const [x, z] = this.dwPos(gr, ecc, phase0, phi0);
      const y = (rng() - 0.5) * 0.5 * Math.exp(-gr / 6);

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Color by radius (hot blue inner, warm yellow/red outer).
      // ~6% of stars get an HDR boost (>1.0) so they punch through the
      // ACES tonemap as bright sparkle — reads as the brightest local
      // suns, makes the disk feel populated rather than dust-like.
      const hue = (gr < 4) ? 0.07 + 0.05 * rng() : 0.58 + 0.08 * rng();
      const sat = 0.5 + 0.3 * rng();
      const lit = 0.78 + 0.22 * rng();
      const c = new THREE.Color().setHSL(hue, sat, lit);
      if (rng() < 0.06) c.multiplyScalar(1.8);
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      // Initial velocity — tangential RAR-circular speed (display only; the
      // motion itself is prescribed analytically in update()).
      const vCirc = this.circularSpeed(gr);
      const thetaInit = Math.atan2(z, x);
      const body: Body = {
        id: `star-${i}`,
        pos: [x, y, z],
        vel: [-Math.sin(thetaInit) * vCirc, 0, Math.cos(thetaInit) * vCirc],
        mass: 0.0001    // negligible relative to BH; stars are test particles
      };
      // Stellar lifecycle. Mass from Salpeter IMF; birth time spread across
      // the first 800 Myr so the population doesn't all ignite together
      // (looks like a sequence of supernovas firing as time advances).
      const mass = imfSample(rng);
      const birth = 0.05 + rng() * 0.8;     // Gyr
      this.stars.push({
        body, baseColor: c,
        mass, birth,
        lifetime: mainSeqLifetime(mass),
        state: 'main',
        deathT: Infinity,
        spawnedBH: false,
        gr, ecc, omega, phase0,
        yOff: y,
      });
    }

    this.posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(colors, 3);
    this.starGeom.setAttribute('position', this.posAttr);
    this.starGeom.setAttribute('color', this.colAttr);

    this.starMaterial = new THREE.PointsMaterial({
      // Each point is a whole solar system. Size 0.17 paired with the
      // 8,000-star count gives a brighter surrounding field that
      // balances the now-smaller BH. Additive blending + ACES tonemap
      // still composite into a continuous bright wash at zoom-out.
      size: 0.17, sizeAttenuation: true,
      vertexColors: true,
      transparent: true, depthWrite: false, opacity: 1.0,
      blending: THREE.AdditiveBlending,
      map: radialGlow(64, '#ffffff', '#ffe0c0', 'rgba(0,0,0,0)')
    });
    this.points = new THREE.Points(this.starGeom, this.starMaterial);
    this.points.userData = { type: 'starcloud' };
    this.scene.add(this.points);
    // Stars are clickable for focus-pin (drill into THIS star's system).
    // Adding the Points cloud to the draggable group lets Drag.ts raycast
    // hit individual stars; pick() below resolves intersection.index → star.
    this.draggable.add(this.points);

    // Single "picked star" sprite that flies under the cursor when grabbing a star
    this.picked = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlow(128, '#ffffff', '#ffd080', 'rgba(0,0,0,0)'),
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0
    }));
    this.picked.scale.setScalar(0.4);
    this.picked.userData = { type: 'star-picker', index: -1 };
    this.scene.add(this.picked);

    // Entanglement field lines — denser, 3 polar bands so the network reads
    // as a 3D structure rather than just a flat fan. Parented to a group
    // we'll position on the central BH each frame so they FOLLOW it when
    // dragged.
    const lineCount = 96;
    const segs = 36;
    const bands = 3;        // 3 polar bands → fuller-looking 3D network
    const totSegs = lineCount * bands * (segs - 1);
    const linePositions = new Float32Array(totSegs * 2 * 3);
    const lineGeom = new THREE.BufferGeometry();
    let pi = 0;
    for (let b = 0; b < bands; b++) {
      const polar = (b - (bands - 1) / 2) * 0.55;   // -0.55, 0, +0.55 rad
      const cp = Math.cos(polar), sp = Math.sin(polar);
      for (let l = 0; l < lineCount; l++) {
        const ang = (l / lineCount) * Math.PI * 2 + b * 0.13;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        for (let s = 0; s < segs - 1; s++) {
          const r1 = Math.pow(s     / segs, 1.4) * R_GAL * 2.4;
          const r2 = Math.pow((s+1) / segs, 1.4) * R_GAL * 2.4;
          const wave = Math.sin((s / segs) * 7 + l * 0.7 + b) * 0.35;
          linePositions[pi++] = r1 * ca * cp;
          linePositions[pi++] = r1 * sp + wave;
          linePositions[pi++] = r1 * sa * cp;
          linePositions[pi++] = r2 * ca * cp;
          linePositions[pi++] = r2 * sp + wave * 1.1;
          linePositions[pi++] = r2 * sa * cp;
        }
      }
    }
    lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    this.flMaterial = new THREE.LineBasicMaterial({
      color: 0x7ad7ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.fieldLines = new THREE.LineSegments(lineGeom, this.flMaterial);
    // Group so we can move the entanglement structure with the central BH
    this.entGroup = new THREE.Group();
    this.entGroup.add(this.fieldLines);
    this.scene.add(this.entGroup);

    // Telegrapher wave group — emits when objects are flicked
    this.scene.add(this.telegrapher.group);
    this.scene.add(this.manyPasts.group);
    this.snFlareTex = radialGlow(256, 'rgba(255,255,255,1)', 'rgba(255,180,90,0.6)', 'rgba(255,40,20,0)');
    this.scene.add(this.snGroup);

    // Focus reticle on the star the camera ray is pointing at
    this.focusReticle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlow(256, 'rgba(0,0,0,0)', 'rgba(122,215,255,0.9)', 'rgba(122,215,255,0)'),
      color: 0x7ad7ff,
      blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false,
      transparent: true, opacity: 0.85
    }));
    this.focusReticle.scale.setScalar(0.8);
    this.focusReticle.visible = false;
    this.scene.add(this.focusReticle);
  }

  // Total mass at galactic centre — drives initial circular speeds for star
  // placement. Stellar-mass BHs are negligible vs. the SMBH at this scale.
  // Coalesce close BH pairs. Previously we used rs ∝ M which made the
  // SMBH's effective merger radius huge (~28 sim units for a 2,000-mass
  // SMBH) and ate every stellar BH that wandered into the inner disk.
  // Switched to rs ∝ √M so each BH's merger reach is proportional to its
  // visual radius, not its raw mass. Two BHs merge when their summed
  // reach exceeds the centre-to-centre distance.
  private mergeBHs() {
    const RS_SCALE = 0.04;     // sim units per √(mass)
    let merged = false;
    outer:
    for (let i = 0; i < this.bhs.length; i++) {
      for (let j = i + 1; j < this.bhs.length; j++) {
        const a = this.bhs[i], b = this.bhs[j];
        const dx = a.body.pos[0] - b.body.pos[0];
        const dy = a.body.pos[1] - b.body.pos[1];
        const dz = a.body.pos[2] - b.body.pos[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const rs = RS_SCALE * (Math.sqrt(a.mass) + Math.sqrt(b.mass));
        if (d2 < rs * rs) {
          // Heavier survives; lighter gets absorbed. Momentum conserved.
          const keep = a.mass >= b.mass ? a : b;
          const gone = a.mass >= b.mass ? b : a;
          const M = keep.mass + gone.mass;
          for (let k = 0; k < 3; k++) {
            keep.body.pos[k] = (keep.mass * keep.body.pos[k] + gone.mass * gone.body.pos[k]) / M;
            keep.body.vel[k] = (keep.mass * keep.body.vel[k] + gone.mass * gone.body.vel[k]) / M;
          }
          keep.mass = M;
          keep.body.mass = M;
          keep.realMassSolar += gone.realMassSolar;
          keep.mesh.position.set(keep.body.pos[0], keep.body.pos[1], keep.body.pos[2]);
          // Merger ringdown — telegrapher front propagating at substrate-c
          // (skipped during the first-tick catch-up so historic mergers
          // don't all ring at once.)
          if (!this.silentCatchup) {
            this.telegrapher.emit(keep.mesh.position.clone(), R_GAL * 1.6, 1.4);
          }
          this.disposeBH(gone);
          merged = true;
          break outer;
        }
      }
    }
    return merged;
  }

  // Remove a BHView from the scene + draggable group + bhs[], dispose
  // its GPU resources, and re-index userData on the remaining BHs so
  // pick/hover still resolve to the right index. Shared by the merger
  // path and the scrub-back resurrection path below.
  private disposeBH(bh: BHView) {
    this.scene.remove(bh.mesh);
    this.draggable.remove(bh.mesh);
    bh.mesh.traverse(o => {
      const g = (o as any).geometry; if (g?.dispose) g.dispose();
      const m = (o as any).material;
      if (Array.isArray(m)) m.forEach((x: any) => x.dispose?.());
      else m?.dispose?.();
    });
    const idx = this.bhs.indexOf(bh);
    if (idx >= 0) {
      this.bhs.splice(idx, 1);
      for (let k = 0; k < this.bhs.length; k++) this.bhs[k].mesh.userData.index = k;
    }
  }

  // Find and dispose the stellar BH spawned from a given supernova
  // progenitor. Called when cosmic time is scrubbed back across the
  // star's death so the BH that "shouldn't exist yet" goes away too.
  private removeStellarBHFor(star: Star) {
    const targetId = `bh-sn-${star.body.id}`;
    const bh = this.bhs.find(b => b.body.id === targetId);
    if (bh) this.disposeBH(bh);
  }

  // Spawn an expanding-fading explosion sprite at the dying star's
  // position. Massive stars get a bigger, hotter SN flare; low-mass
  // get a softer planetary-nebula glow. Drives the "this is actually
  // a supernova, not a bright pixel" reading.
  private spawnSNFlare(s: Star, tG: number) {
    // Historic deaths skip the visual — the regime mounted at present-day
    // and we don't want to replay every supernova from the past 13 Gyr.
    if (this.silentCatchup) return;
    const type: 'sn' | 'pn' = s.mass >= SUPERNOVA_MASS ? 'sn' : 'pn';
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.snFlareTex,
      color: type === 'sn' ? new THREE.Color(1.6, 1.4, 1.0) : new THREE.Color(1.0, 0.8, 1.3),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 1
    }));
    sp.position.set(s.body.pos[0], s.body.pos[1], s.body.pos[2]);
    sp.scale.setScalar(0.4);
    this.snGroup.add(sp);
    this.snFlares.push({ sp, birthT: tG, type });
  }

  // Per-frame animation of active SN flares. Called from update(). Each
  // flare scales up rapidly, peaks, then fades. Recycled when faded.
  private updateSNFlares(tG: number) {
    const SN_DUR = 0.0015;     // Gyr of visible explosion (~1.5 Myr)
    for (let i = this.snFlares.length - 1; i >= 0; i--) {
      const f = this.snFlares[i];
      const age = tG - f.birthT;
      if (age < 0 || age > SN_DUR) {
        this.snGroup.remove(f.sp);
        (f.sp.material as THREE.SpriteMaterial).dispose();
        this.snFlares.splice(i, 1);
        continue;
      }
      const frac = age / SN_DUR;
      // Scale: rapid expansion in the first 20 %, then plateau, then
      // gentle further growth as the shell propagates
      const maxScale = f.type === 'sn' ? 4.5 : 2.0;
      const scale = 0.4 + maxScale * Math.min(1, frac * 5);
      // Opacity: peaks early, fades over the rest
      const op = f.type === 'sn'
        ? Math.max(0, 1 - Math.pow(frac, 0.7))
        : Math.max(0, 0.7 * (1 - frac));
      f.sp.scale.setScalar(scale);
      (f.sp.material as THREE.SpriteMaterial).opacity = op;
    }
  }

  // Core-collapse supernova: take the dying star's position + velocity,
  // emit a telegrapher ringdown, push a new stellar BH (a few M☉) into the
  // dynamics. The new BH then orbits / merges with other BHs naturally.
  private spawnStellarBHFromSupernova(s: Star) {
    // Catch-up suppression: a freshly mounted galaxy at present-day cosmic
    // time would otherwise spawn one stellar BH for *every* historic
    // supernova (≈ 0.5% of 3,500 stars ≈ 18 extras) in a single frame on
    // top of the constructor's 2–7 initial BHs. Those tend to land close
    // enough to one another (or to the SMBH's merger reach) that mergers
    // cascade immediately. We mark spawnedBH=true so the forward state
    // machine doesn't double-spawn if we later cross this star's death;
    // the actual BH mesh is only created in normal forward play.
    if (this.silentCatchup) return;

    // Remnant mass ≈ 30 % of initial (rest blown off in the explosion)
    const remMsun  = Math.max(3, s.mass * 0.30);
    const simMass  = 3 + (remMsun - 3) * 0.5;       // sim-mass scale
    const radius   = 0.028 + 0.017 * (remMsun / 30);   // ~55% of prior scale
    // Younger (hotter) BHs visually
    const hot = new THREE.Color(1, 0.95, 0.85);
    const mid = new THREE.Color(1, 0.55, 0.30);
    const cool = new THREE.Color('#ffa050');
    const mesh = new BlackHole({
      radius, diskInner: 2.2, diskOuter: 5.0,
      diskTilt: Math.random() * Math.PI, hot, mid, cool
    });
    mesh.position.set(s.body.pos[0], s.body.pos[1], s.body.pos[2]);
    mesh.userData = { type: 'bh', index: this.bhs.length };
    this.scene.add(mesh);
    this.draggable.add(mesh);
    const halo = makeBHHalo(radius * 5);
    mesh.add(halo);
    this.bhs.push({
      mesh,
      body: {
        id: `bh-sn-${s.body.id}`,
        pos: [s.body.pos[0], s.body.pos[1], s.body.pos[2]],
        vel: [s.body.vel[0], s.body.vel[1], s.body.vel[2]],
        mass: simMass,
        fixed: false
      },
      mass: simMass,
      realMassSolar: remMsun,
      isCentral: false,
      diskTiltAxis: new THREE.Vector3(1, 0, 0),
      diskTiltAngle: 0,
      entHalo: halo
    });
    // Supernova ringdown — skip during the first-tick catch-up so
    // a freshly-mounted galaxy doesn't burst with historic ringdowns.
    if (!this.silentCatchup) {
      this.telegrapher.emit(mesh.position.clone(), R_GAL * 1.3, 1.2);
    }
  }

  private centralMass(): number {
    const central = this.bhs.find(b => b.isCentral);
    return central?.mass ?? 0;
  }

  private circularSpeed(r: number): number {
    // RAR-consistent circular speed: v² / r = g_obs from central baryonic mass.
    // Uses the same paper-faithful exponential RAR as the rest of the sim.
    // If there's no central SMBH, use a soft bulge mass so outer rotation curve
    // still falls into deep-MOND naturally (paper §14: Tully–Fisher follows).
    const M = Math.max(this.centralMass(), 60);
    const gBar = G_SIM * M / Math.max(r * r, 1e-3);
    const y = gBar / A0_SIM;
    const gObs = nuRAR(y) * gBar;
    return Math.sqrt(gObs * Math.max(r, 0.1));
  }

  // Density-wave star position: the point at parameter `ang` on an ellipse of
  // semi-major `gr` and eccentricity `ecc` whose major axis points at angle
  // `phi`, returned as [x, z] in the galaxy plane. Arc-speed is slowest near
  // the major-axis tips, so stars crowd there — that crowding is the arm.
  // Rotating `phi` rigidly rotates the whole spiral without winding it.
  private dwPos(gr: number, ecc: number, ang: number, phi: number): [number, number] {
    const ex = gr * Math.cos(ang);
    const ey = gr * (1 - ecc) * Math.sin(ang);
    const cphi = Math.cos(phi), sphi = Math.sin(phi);
    return [ex * cphi - ey * sphi, ex * sphi + ey * cphi];
  }

  update(ctx: RegimeContext, dt: number): void {
    // Detect first-tick or cache-restore catch-up: if cosmic time jumped
    // more than ~1 Myr since the last update we saw, suppress visuals
    // this frame so historic supernovae don't all fire at once.
    const cosmicGap = this.lastSeenCosmicT < 0
      ? Infinity
      : Math.abs(ctx.time - this.lastSeenCosmicT);
    this.silentCatchup = cosmicGap > 0.005;
    this.lastSeenCosmicT = ctx.time;

    // Visual integration step. Old behaviour clamped dt at 0.06 sim_sec
    // per frame, which meant any speed slider position above ~Day/s
    // saturated to the same orbital rate — Myr/s and Gyr/s looked
    // identical. visualRatePerWall maps speedExp logarithmically so
    // each chip preset produces a visibly distinct orbital advance,
    // capped at 200 sim_sec/wall_sec for stability + perf.
    const visPerWall = visualRatePerWall(ctx.rate);
    const visDt = visPerWall * ctx.dtWall * Math.sign(ctx.rate || 1);
    this.time += visDt;
    this.wallTime += ctx.dtWall;
    this.spiralMat.uniforms.time.value = this.time;
    // Cosmic-time-driven assembly: the disk and stars fade up as the
    // galaxy forms. Roughly: nothing pre-first-stars (≲100 Myr), assembling
    // through 1 Gyr, fully visible by ~3 Gyr. Past that, slow brightening
    // tracks SMBH growth.
    const tG = ctx.time;          // Gyr
    const galaxyAlpha = Math.min(1, Math.max(0, (tG - 0.1) / 2.0));
    this.spiralMat.uniforms.alphaGlobal.value = galaxyAlpha;
    this.spiralMat.uniforms.detail.value = ctx.diskDetailOn ? 1 : 0;
    // Bumped baseline from 0.15 — at low galaxyAlpha (early in cosmic time
    // or as a freshly-mounted regime) stars were so faint that with bloom
    // off the disk looked empty. 0.45 lets the dimmest unborn stars still
    // glint.
    // Floor at 0.62 so the surrounding star field never dims to near-nothing
    // when galaxyAlpha is low (early assembly / freshly-mounted regime).
    this.starMaterial.opacity = Math.max(0.45 + 0.55 * galaxyAlpha, 0.62);
    // Central SMBH grows with time (visualised as a slow accretion-disk
    // scale-up). Multiplier 0.85 → 1.15 over 0..13.8 Gyr.
    const smbhGrowth = 0.85 + 0.3 * Math.min(1, tG / 13.8);
    // Visual-only shrink applied to every BH mesh so black holes don't swamp
    // the disk. Physics (merger reach, q-shell) derives from mass/rs, not mesh
    // scale, so this is purely cosmetic.
    const VISUAL_BH_SCALE = 0.5;
    for (const bh of this.bhs) {
      bh.mesh.scale.setScalar((bh.isCentral ? smbhGrowth : 1) * VISUAL_BH_SCALE);
    }
    // Disk toggle — when off, just the stars + BHs are visible (much more
    // legible from below the galactic plane).
    this.spiralMesh.visible = ctx.diskOn && galaxyAlpha > 0.01;
    for (const b of this.bhs) b.mesh.tick(this.time);

    // BH-BH gravity (stellar BHs orbit the central SMBH and feel each
    // other). Simple leapfrog at the same dt as stars; N ≤ 7 so the
    // O(N²) inner loop is free. After each substep, check for mergers:
    // if two BHs come within combined Schwarzschild radius, they coalesce
    // into one body conserving mass + linear momentum, emit a wavefront.
    // Adaptive substep count: each substep stays below ~1 sim_sec for
    // leapfrog stability. visDt now spans up to ~3.5 sim_sec/frame at
    // Gyr/s, so a fixed sub=2 was leaving each step at ~1.7 sim_sec,
    // borderline. Cap at 30 substeps so extreme rewinds don't tank
    // performance. Minimum 2 keeps the leapfrog midpoint quality.
    const sub = Math.min(30, Math.max(2, Math.ceil(Math.abs(visDt) / 1.0)));
    const dtSim = visDt / sub;
    for (let s = 0; s < sub; s++) {
      // Compute accelerations on each non-fixed BH from all others
      const bN = this.bhs.length;
      const ax = new Float32Array(bN);
      const ay = new Float32Array(bN);
      const az = new Float32Array(bN);
      for (let i = 0; i < bN; i++) {
        if (this.bhs[i].body.fixed) continue;
        let aix = 0, aiy = 0, aiz = 0;
        const bi = this.bhs[i].body;
        for (let j = 0; j < bN; j++) {
          if (i === j) continue;
          const bj = this.bhs[j].body;
          const rx = bj.pos[0] - bi.pos[0];
          const ry = bj.pos[1] - bi.pos[1];
          const rz = bj.pos[2] - bi.pos[2];
          const r2 = rx * rx + ry * ry + rz * rz + 0.04;
          const inv_r = 1 / Math.sqrt(r2);
          const g = G_SIM * bj.mass * inv_r * inv_r;     // strong-field; no MOND between BHs
          aix += g * rx * inv_r;
          aiy += g * ry * inv_r;
          aiz += g * rz * inv_r;
        }
        ax[i] = aix; ay[i] = aiy; az[i] = aiz;
      }
      for (let i = 0; i < bN; i++) {
        const b = this.bhs[i].body;
        if (b.fixed) continue;
        b.vel[0] += dtSim * ax[i];
        b.vel[1] += dtSim * ay[i];
        b.vel[2] += dtSim * az[i];
        b.pos[0] += dtSim * b.vel[0];
        b.pos[1] += dtSim * b.vel[1];
        b.pos[2] += dtSim * b.vel[2];
      }
      // Merger pass — if two BHs are within rMerge (proportional to combined
      // mass), absorb the lighter into the heavier. Momentum-conserving.
      this.mergeBHs();
    }

    // Stars ride a density-wave (precessing-ellipse) kinematic spiral rather
    // than free orbits. The paper's flat rotation curve (§14) means a spiral
    // made of *material* stars on circular orbits winds up and shears away
    // (the winding problem) — and free integration at high time-speed also lets
    // the disk numerically disperse. Instead, the 2-arm pattern (each star's
    // ellipse major-axis orientation) rotates RIGIDLY at patternOmega, so the
    // arms never wind; meanwhile each star streams around its own ellipse at its
    // true RAR rate Ω(r), so motion stays differential. Positions are
    // closed-form and bounded, so the disk can neither wind out nor disperse at
    // any speed. If an orbit carries a star inside a BH's tidal radius it is
    // swallowed (feeds the BH), exactly as before.
    const TIDAL_K = 0.055;      // r_tidal = TIDAL_K * sqrt(M) — feeding cue
    const tOrb = this.time;
    const rCo = 0.55 * R_GAL;                                   // co-rotation radius
    const patternOmega = (this.circularSpeed(rCo) / rCo) * PATTERN_FRAC;
    const patternRot = patternOmega * tOrb;
    for (const star of this.stars) {
      if (star.state === 'absorbed') continue;
      const phi = ARM_TWIST * star.gr + patternRot;   // arm (major-axis) angle
      const ang = star.phase0 + star.omega * tOrb;     // streaming around ellipse
      const [px, pz] = this.dwPos(star.gr, star.ecc, ang, phi);
      star.body.pos[0] = px;
      star.body.pos[1] = star.yOff;
      star.body.pos[2] = pz;
      for (const bh of this.bhs) {
        const rx = px - bh.body.pos[0];
        const ry = star.yOff - bh.body.pos[1];
        const rz = pz - bh.body.pos[2];
        const rT = TIDAL_K * Math.sqrt(bh.mass);
        if (rx * rx + ry * ry + rz * rz < rT * rT) {
          star.state = 'absorbed';
          star.deathT = tG;
          (bh.mesh as any).feedPulse = ((bh.mesh as any).feedPulse ?? 0) + 0.6;
          break;
        }
      }
    }
    // Push positions + lifecycle-driven colors into the point cloud.
    // Per-star: compute age, redden+brighten as we approach the lifetime,
    // then either flash (supernova → spawn a new stellar BH) or fade
    // (low-mass → white dwarf).
    const arr = this.posAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const FLASH_DURATION = 0.0008;       // Gyr — supernova visual lasts ~1 Myr
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      arr[i * 3 + 0] = s.body.pos[0];
      arr[i * 3 + 1] = s.body.pos[1];
      arr[i * 3 + 2] = s.body.pos[2];

      const age = tG - s.birth;

      // --- REVERSE state transitions ---
      // If cosmic time has been scrubbed BACK past one of this star's
      // state-change thresholds, revert. Without this, dead stars stay
      // dead forever (and the white-dwarf cooling formula blows up with
      // negative sinceDeath, rendering them as giant glowing blobs).
      if ((s.state === 'dead' || s.state === 'absorbed') && tG < s.deathT) {
        s.state = (age >= s.lifetime * 0.97 && age < s.lifetime) ? 'giant' : 'main';
        s.deathT = Infinity;
        if (s.spawnedBH) {
          this.removeStellarBHFor(s);
          s.spawnedBH = false;
        }
      }
      if (s.state === 'giant' && age < s.lifetime * 0.97) {
        s.state = 'main';
      }

      let r = s.baseColor.r, g = s.baseColor.g, b = s.baseColor.b;
      if (age < 0) {
        // Pre-ignition (unborn)
        r = g = b = 0;
      } else if (s.state === 'main') {
        const frac = age / s.lifetime;
        if (frac < 0.85) {
          // Main sequence — base color (slight blue dim while young)
          const young = 1 - 0.15 * (1 - frac / 0.85);
          r *= young; g *= young; b *= young;
        } else if (frac < 1.0) {
          // Subgiant → giant: redden and brighten
          const x = (frac - 0.85) / 0.15;        // 0..1
          r = r * (1 + 0.6 * x) + 0.4 * x;
          g = g * (1 + 0.2 * x);
          b = b * (1 - 0.4 * x);
          if (frac > 0.97) s.state = 'giant';
        } else {
          // Death event begins — spawn an explosion sprite
          s.state = 'dead';
          s.deathT = tG;
          this.spawnSNFlare(s, tG);
        }
      }
      if (s.state === 'giant') {
        // Late red-giant phase — keep red & bright until death
        const frac = age / s.lifetime;
        r = Math.min(1.4, r + 0.5);
        g = Math.min(0.9, g * 0.6);
        b = Math.min(0.5, b * 0.4);
        if (frac > 1.0) {
          s.state = 'dead';
          s.deathT = tG;
          this.spawnSNFlare(s, tG);
        }
      }
      if (s.state === 'absorbed') {
        // Swallowed by a BH: a brief tidal-shred flash, then gone for good.
        // No remnant point and no spawned BH, so nothing lingers on the BH.
        const sinceEaten = tG - s.deathT;
        if (sinceEaten < FLASH_DURATION) {
          const flash = 1 - sinceEaten / FLASH_DURATION;
          r = 1.4 * flash + 0.15; g = 1.0 * flash + 0.10; b = 1.5 * flash + 0.25;
        } else {
          r = g = b = 0;
        }
      }
      if (s.state === 'dead') {
        const sinceDeath = tG - s.deathT;
        if (sinceDeath < FLASH_DURATION) {
          // Death flash: white-hot for both channels. ACES tone-mapper
          // turns these HDR values into a clean overexposed dot.
          const flash = 1 - sinceDeath / FLASH_DURATION;
          if (s.mass >= SUPERNOVA_MASS) {
            r = 3 * flash + 1; g = 3 * flash + 0.6; b = 2 * flash + 0.3;
          } else {
            // Planetary-nebula style softer flare
            r = 1.6 * flash + 0.4; g = 1.4 * flash + 0.3; b = 1.0 * flash + 0.5;
          }
        } else if (s.mass >= SUPERNOVA_MASS) {
          // Massive → core-collapse BH. Spawn once, then make star invisible.
          if (!s.spawnedBH) {
            s.spawnedBH = true;
            this.spawnStellarBHFromSupernova(s);
          }
          r = g = b = 0;
        } else {
          // Low-mass → cooling white dwarf. Tiny, dim, slightly blue. Capped
          // faint so old dwarfs read as embers, not bright points.
          const cooled = Math.exp(-sinceDeath * 0.6);     // fade over Gyr
          r = Math.min(0.30 * cooled, 0.16);
          g = Math.min(0.40 * cooled, 0.22);
          b = Math.min(0.55 * cooled, 0.34);
        }
      }
      col[i * 3 + 0] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;

    // BH drag-follow + per-frame q-field uniform sync. The q-field
    // shader on each BH needs the BH's world position and the camera's
    // world position to ray-trace impact parameters each frame.
    for (const bh of this.bhs) {
      bh.mesh.position.set(bh.body.pos[0], bh.body.pos[1], bh.body.pos[2]);
      bh.mesh.syncQField(bh.mesh.position, this.camera.position);
    }
    // Compute the far-field q at each BH's location from every OTHER BH.
    // q(r) = max(0, 1 − Σ rs_j / r_ij) — paper's substrate primitive.
    // Feed it into each BH's q-shell so close BH pairs visibly drain
    // each other's photon ring (paper's N²=q lapse made visible).
    const RS_LAPSE = 0.18;        // sim units per unit mass for the lapse
    for (let i = 0; i < this.bhs.length; i++) {
      const bi = this.bhs[i];
      let drain = 0;
      for (let j = 0; j < this.bhs.length; j++) {
        if (i === j) continue;
        const bj = this.bhs[j];
        const dx = bi.body.pos[0] - bj.body.pos[0];
        const dy = bi.body.pos[1] - bj.body.pos[1];
        const dz = bi.body.pos[2] - bj.body.pos[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) + 1e-3;
        drain += RS_LAPSE * Math.sqrt(bj.mass) / dist;
      }
      bi.mesh.setLocalQ(Math.max(0.05, 1 - drain));
    }
    // Halo follows the central BH if one exists; otherwise dim halo at origin
    const central = this.bhs.find(b => b.isCentral);
    this.haloMesh.position.copy(central ? central.mesh.position : new THREE.Vector3());
    const haloPulse = 0.85 + 0.15 * Math.sin(this.wallTime * 0.9);
    (this.haloMesh.material as THREE.SpriteMaterial).opacity =
      ctx.entanglementOn ? (central ? 0.55 * haloPulse : 0.30 * haloPulse) : 0;
    // Per-BH halos: every BH gets its own entanglement signature, so
    // dragging a stellar BH carries its halo along (children inherit
    // the BH group's transform). Brightness scales with √M so the
    // SMBH dominates without drowning out the stellar remnants.
    for (let i = 0; i < this.bhs.length; i++) {
      const bh = this.bhs[i];
      const mat = bh.entHalo.material as THREE.SpriteMaterial;
      if (!ctx.entanglementOn) { mat.opacity = 0; continue; }
      // Per-BH pulse offset by index so halos breathe out of sync —
      // makes the field network read as alive, not a static wash.
      const pulse = 0.78 + 0.22 * Math.sin(this.wallTime * 1.2 + i * 0.9);
      const strength = bh.isCentral ? 0.55 : 0.35;
      mat.opacity = strength * pulse;
    }
    // Entanglement network follows the central BH (or origin if none).
    // Slow rotation to make the field feel alive — drives the visual
    // "the substrate is restructuring" intuition.
    if (central) this.entGroup.position.copy(central.mesh.position);
    else         this.entGroup.position.set(0, 0, 0);
    this.entGroup.rotation.y = this.wallTime * 0.04;
    this.entGroup.visible = ctx.entanglementOn;
    this.flMaterial.opacity = ctx.entanglementOn ? 0.55 * haloPulse : 0;

    // Telegrapher waves advance with sim-time (paper §17: D/τ₀ = c²)
    this.telegrapher.update(visDt);
    this.updateSNFlares(tG);

    // Many-Pasts ghost cloud (paper §21). Only visible when rewinding
    // and the toggle is on — drives off ctx.manyPastsOn (App already
    // requires direction=−1 to set it true).
    this.manyPasts.update(
      this.bhs.map(b => ({
        id: b.body.id,
        pos: b.mesh.position,
        scale: 1.2 + 0.7 * Math.log10(Math.max(1, b.mass / 10))
      })),
      ctx.dtWall,
      ctx.manyPastsOn
    );

    // Picker sprite — magnetic cursor that hovers onto the star
    // currently under the pointer. Fades when no fresh hover (set in
    // pick() each pointer event).
    const hoverFresh = (this.wallTime - this.hoveredAtWall) < 0.12;
    const pickerMat = this.picked.material as THREE.SpriteMaterial;
    if (hoverFresh && this.hoveredStarIdx >= 0 && this.hoveredStarIdx < this.stars.length) {
      const s = this.stars[this.hoveredStarIdx];
      this.picked.position.set(s.body.pos[0], s.body.pos[1], s.body.pos[2]);
      pickerMat.opacity += (0.85 - pickerMat.opacity) * Math.min(1, ctx.dtWall * 12);
    } else {
      pickerMat.opacity += (0 - pickerMat.opacity) * Math.min(1, ctx.dtWall * 6);
    }

    // Focus reticle — shows whenever a star is focused (camera-ray
    // fallback OR pinned-by-click). Brighter once zoom enters the
    // second half of the band (you're about to drill in).
    const showReticle = !!ctx.focus.starId;
    if (showReticle) {
      const idx = parseInt(ctx.focus.starId!.replace('st-', ''), 10);
      const s = this.stars[idx];
      if (s) {
        this.focusReticle.visible = true;
        this.focusReticle.position.set(s.body.pos[0], s.body.pos[1], s.body.pos[2]);
        const intraBoost = Math.min(1, Math.max(0, (ctx.zoomIntra - 0.5) * 3.0));
        // Base 0.35 visibility from click-pin + boost as you scroll in.
        (this.focusReticle.material as THREE.SpriteMaterial).opacity = 0.35 + 0.45 * intraBoost;
      } else {
        this.focusReticle.visible = false;
      }
    } else {
      this.focusReticle.visible = false;
    }
  }

  bloomStrength(_ctx: RegimeContext): number {
    // Cut from 1.05 — at galaxy scale the spiral disk + photon ring +
    // accretion disk all bloom together and washed the screen out.
    return 0.45;
  }

  // BHs that get gravitational lensing applied around them at this scale.
  // Apparent radius scales with sim mass + scene proximity, capped so a
  // close SMBH doesn't warp the whole frame.
  lensSources(): { worldPos: THREE.Vector3; radius: number }[] {
    const out: { worldPos: THREE.Vector3; radius: number }[] = [];
    const cam = this.camera.position;
    for (const bh of this.bhs) {
      const dx = bh.mesh.position.x - cam.x;
      const dy = bh.mesh.position.y - cam.y;
      const dz = bh.mesh.position.z - cam.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3;
      // Lens NDC radius ≈ schwarzschild_visual_radius / dist, capped
      const rs = 0.0025 * Math.sqrt(bh.mass);   // visual prop. to √M
      const ndcR = Math.min(0.07, 7 * rs / dist);
      if (ndcR < 0.005) continue;        // sub-pixel — skip
      out.push({ worldPos: bh.mesh.position, radius: ndcR });
    }
    return out;
  }

  // Publish the focused star = the star nearest the camera's forward ray.
  // Index → "st-NNNN" id, stable per seed. Called every frame; committed
  // when zoom crosses into SYSTEM.
  publishFocus(): Partial<FocusState> | null {
    const camPos = this.camera.position;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    let bestI = -1;
    let bestPerp2 = Infinity;
    // Sample a stride — checking 6000 stars/frame is wasteful when we just
    // need the nearest to the camera ray; the brightest few hundred are
    // what the user can see anyway.
    const stride = 7;
    for (let i = 0; i < this.stars.length; i += stride) {
      const p = this.stars[i].body.pos;
      const dx = p[0] - camPos.x;
      const dy = p[1] - camPos.y;
      const dz = p[2] - camPos.z;
      const along = dx * fwd.x + dy * fwd.y + dz * fwd.z;
      if (along < 0.5) continue;
      const total2 = dx * dx + dy * dy + dz * dz;
      const perp2  = total2 - along * along;
      if (perp2 < bestPerp2) { bestPerp2 = perp2; bestI = i; }
    }
    if (bestI < 0) return null;
    return { starId: `st-${bestI}` };
  }

  // World position of the focused star (if any) so the App can lerp the
  // camera target toward it as the user zooms in from GALAXY → SYSTEM.
  focusedWorldPos(focus: FocusState): THREE.Vector3 | null {
    if (!focus.starId) return null;
    const idx = parseInt(focus.starId.replace('st-', ''), 10);
    const s = this.stars[idx];
    if (!s) return null;
    return new THREE.Vector3(s.body.pos[0], s.body.pos[1], s.body.pos[2]);
  }

  pick(intersection: THREE.Intersection): DragTarget | null {
    // Stars: the user clicked a single point in the 3,500-star Points
    // cloud. Resolve via intersection.index. Stars don't physically
    // drag (perturbing one orbit at a time mid-cloud looks broken);
    // pick() returns a target so the click registers and onClickTarget
    // pins focus for drill-down into SYSTEM. Visual feedback comes
    // from the picker sprite (hover magnet) and the focus reticle
    // (after click), both updated in update().
    if (intersection.object === this.points && intersection.index !== undefined) {
      const idx = intersection.index;
      const s = this.stars[idx];
      if (!s) return null;
      // Swallowed stars are invisible and parked on the BH — a click there
      // must not pin focus on a star that no longer exists.
      if (s.state === 'absorbed') return null;
      // Stash the most-recently-hovered star index for the picker
      // sprite. Read each frame in update() so the picker tracks the
      // cursor magnetically. -1 means no current hover (decays opacity).
      this.hoveredStarIdx = idx;
      this.hoveredAtWall  = this.wallTime;
      const worldPos = new THREE.Vector3(s.body.pos[0], s.body.pos[1], s.body.pos[2]);
      return {
        id: `st-${idx}`,
        object: this.points,
        worldPos,
        onDragMove: () => { /* stars are click-only; no orbital perturbation */ },
        onDragEnd:  () => { /* picker fades naturally when hover ends */ }
      };
    }

    // Walk up the ancestor chain — the user clicks the disk/horizon/ring
    // sub-mesh, but only the BlackHole group has the {type:'bh', index} userData.
    let obj: THREE.Object3D | null = intersection.object;
    while (obj && obj.userData?.type !== 'bh') obj = obj.parent;
    if (!obj) return null;
    const idx = obj.userData.index as number;
    const bh = this.bhs[idx];
    if (!bh) return null;
    return {
      id: bh.body.id,
      object: bh.mesh,
      worldPos: new THREE.Vector3().copy(bh.mesh.position),
      onDragMove: (p) => {
        bh.body.pos[0] = p.x; bh.body.pos[1] = p.y; bh.body.pos[2] = p.z;
        // Pin to current position while held — leapfrog acceleration would
        // otherwise blast the BH around as the user moves it
        bh.body.fixed = true;
      },
      onDragEnd: (v) => {
        // Release with the (damped + capped) drag velocity. Central BH
        // stays gravitationally dominant; stellar BHs go ballistic and
        // get re-captured by the central if close.
        bh.body.fixed = bh.isCentral;   // central stays anchored, stellars are free
        bh.body.vel[0] = v.x; bh.body.vel[1] = v.y; bh.body.vel[2] = v.z;
        this.telegrapher.emit(bh.mesh.position.clone(), R_GAL * 1.6, 0.8);
      }
    };
  }

  hoverInfo(intersection: THREE.Intersection): HoverInfo | null {
    // Star intersection — paper-physics tooltip for an individual sun.
    if (intersection.object === this.points && intersection.index !== undefined) {
      const idx = intersection.index;
      const s = this.stars[idx];
      if (!s) return null;
      if (s.state === 'absorbed') return null;
      const r = Math.hypot(s.body.pos[0], s.body.pos[1], s.body.pos[2]);
      const v = Math.hypot(s.body.vel[0], s.body.vel[1], s.body.vel[2]);
      const stateLabel = s.state === 'main'  ? 'main sequence'
                       : s.state === 'giant' ? 'red giant'
                       : 'dead';
      const spectral = s.mass > 16  ? 'O' :
                       s.mass > 2.1 ? 'B' :
                       s.mass > 1.4 ? 'A' :
                       s.mass > 1.0 ? 'F' :
                       s.mass > 0.8 ? 'G' :
                       s.mass > 0.45 ? 'K' : 'M';
      return {
        title: `Sun · ${spectral}-type · ${stateLabel}`,
        rows: [
          { k: 'M',        v: `${s.mass.toFixed(2)} M☉` },
          { k: 't_MS',     v: `${s.lifetime.toExponential(2)} Gyr` },
          { k: 'r (galactic)', v: `${r.toFixed(2)} sim` },
          { k: 'v (RAR)',  v: `${v.toExponential(2)} sim/s` },
          { k: 'birth',    v: `${s.birth.toFixed(3)} Gyr` },
        ],
        note: 'Click to pin focus, then scroll zoom-in to drill into this star\'s planetary system. Orbital motion uses the paper\'s exponential RAR — Newton near the SMBH, deep-MOND at the outer disk.'
      };
    }

    let obj: THREE.Object3D | null = intersection.object;
    while (obj && obj.userData?.type !== 'bh') obj = obj.parent;
    if (!obj) return null;
    const idx = obj.userData.index as number;
    const bh = this.bhs[idx];
    if (!bh) return null;
    const h = hawkingSolar(bh.realMassSolar);
    const s = scrambling(bh.realMassSolar * M_SUN);
    const title = bh.isCentral
      ? 'Supermassive black hole · paper §20'
      : 'Stellar-mass black hole · paper §20';
    // Format t_scr in human-readable units depending on magnitude
    const t_scr_str =
      s.t_scr < 1     ? formatSI(s.t_scr, 's', 2)
    : s.t_scr < 3600  ? `${s.t_scr.toFixed(1)} s`
    : s.t_scr < 86400 ? `${(s.t_scr / 3600).toFixed(1)} hr`
    : s.t_scr < 3.156e7 ? `${(s.t_scr / 86400).toFixed(1)} day`
    : `${(s.t_scr / 3.156e7).toFixed(1)} yr`;
    return {
      title,
      rows: [
        { k: 'M',      v: `${bh.realMassSolar.toExponential(2)} M☉` },
        { k: 'r_s',    v: formatSI(h.rs, 'm', 2) },
        { k: 'T_H',    v: formatSI(h.T_H, 'K', 2) },
        { k: 'S_BH/k_B', v: formatSI(h.S_BH / 1.380649e-23, '', 2) },
        { k: 't_scr (Vikram)', v: t_scr_str },
        { k: 't_evap', v: `~${(h.t_evap / 3.156e16 / 1e9).toExponential(1)} Gyr` },
      ],
      note: bh.isCentral
        ? 'q(r) = 1 − 2GM/c²r → q = 0 at horizon. S_BH = A/4 from ln 2 per face. Scrambling floor t_scr ≳ βℏ/(2π)·ln(S/k_B) — Vikram, Shou, Galitski PRL 2026.'
        : 'Collapsed massive star. Same N² = q as the SMBH; T_H ∝ 1/M runs hotter, so t_scr ∝ M·ln M is much shorter.'
    };
  }
}
