// GALAXY: spiral disk + central BH. Stars draggable; orbits use RAR so outer disk
// has flat rotation curve (paper §14 — no dark matter needed).

import * as THREE from 'three';
import { Regime, RegimeContext, DragTarget, HoverInfo, FocusState } from './Regime';
import { mulberry32 } from '../core/Rng';
import { hashStr } from '../util/hash';
import { radialGlow } from '../render/Glow';
import { BlackHole } from '../render/BlackHole';
import { Body } from '../core/Gravity';
import { TelegrapherField } from '../render/Telegrapher';
import { ManyPasts } from '../render/ManyPasts';
import { hawkingSolar, scrambling, formatSI } from '../core/Closure';
import { M_SUN } from '../util/units';
import { imfSample, mainSeqLifetime, SUPERNOVA_MASS } from '../core/StellarLifecycle';

// 3500 stars is plenty visually; previous 6000 doubled the per-frame
// star integration cost without noticeable visual gain.
const N_STARS = 3500;
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
}

interface Star {
  body: Body;
  baseColor: THREE.Color;
  mass: number;        // M☉ — drives lifetime + death channel
  birth: number;       // cosmic time (Gyr) when this star ignites
  lifetime: number;    // Gyr — main-sequence span, t ∝ M^−2.5
  state: 'main' | 'giant' | 'dead';
  deathT: number;      // cosmic Gyr when it died (Infinity if still alive)
  spawnedBH: boolean;  // true once we've added a stellar BH from a supernova
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
      // Map physical mass to sim units (visible disk size). Use a gentle log scale
      // so even dwarfs are visible.
      const simMass = 200 + 2300 * (logM - 5.5) / 4.0;
      const radius  = 0.20 + 0.40 * (simMass - 200) / 2300;
      const diskScale = 0.65 + rng() * 0.7;
      const diskInner = (2.0 + rng() * 1.2) * diskScale;
      const diskOuter = diskInner + (3.5 + rng() * 5.0);
      const tilt      = (rng() - 0.5) * Math.PI * 0.8;
      // Active vs aged: hotter disks for younger SMBHs
      const active    = rng();
      const hot   = active > 0.5 ? new THREE.Color('#fff4d8') : new THREE.Color('#ffd0a0');
      const mid   = active > 0.5 ? new THREE.Color('#ffaa55') : new THREE.Color('#ff8060');
      const cool  = active > 0.5 ? new THREE.Color('#7ad7ff') : new THREE.Color('#a060ff');
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
      this.bhs.push({
        mesh,
        body: { id: 'bh-central', pos: [cx, 0, cz], vel: [0, 0, 0], mass: simMass, fixed: true },
        mass: simMass,
        realMassSolar: massSolar,
        isCentral: true,
        diskTiltAxis: new THREE.Vector3(1, 0, 0),
        diskTiltAngle: tilt
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
      const radius    = 0.06 + 0.04 * (massSolar / 40);
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
        diskTiltAngle: tilt
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

    // Spiral background disk shader (the bulk light of the disk)
    const spiralGeom = new THREE.CircleGeometry(R_GAL, 96);
    this.spiralMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        time:       { value: 0 },
        arms:       { value: 2 },
        twist:      { value: 4.1 },
        innerCut:   { value: 0.42 },
        outerSoft:  { value: 0.96 },
        coreColor:  { value: new THREE.Color('#fff0c8') },
        midColor:   { value: new THREE.Color('#ffaa90') },
        edgeColor:  { value: new THREE.Color('#7ad7ff') },
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
        uniform float time, arms, twist, innerCut, outerSoft, alphaGlobal;
        uniform vec3  coreColor, midColor, edgeColor;
        varying vec2 vP;
        float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
        float noise(vec2 p){
          vec2 i=floor(p), f=fract(p);
          vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),
                     mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y);
        }
        void main(){
          float r = length(vP);
          float R = ${R_GAL.toFixed(2)};
          if (r > R || r < 0.001) discard;
          float t = r / R;
          float ang = atan(vP.y, vP.x);
          float ph = ang + twist * log(max(t, 0.04));
          float armStr = 0.5 + 0.5 * cos(arms * ph);
          armStr = pow(armStr, 6.0);
          // dust lanes — subtract a thin band
          armStr *= 0.7 + 0.6 * noise(vec2(ang * 6.0, t * 12.0) + time * 0.05);
          float core = smoothstep(0.0, innerCut, 1.0 - t);
          float disk = (1.0 - smoothstep(outerSoft, 1.0, t));
          float intensity = (0.6 * core + 0.45 * armStr) * disk;
          vec3 col = mix(edgeColor, midColor, smoothstep(0.7, 0.2, t));
          col = mix(col, coreColor, core);
          gl_FragColor = vec4(col, clamp(intensity * alphaGlobal, 0.0, 1.0));
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
      // log-spiral seeded distribution; bulge concentrated at small r
      const u = rng();
      const r = R_GAL * (0.05 + 0.95 * Math.pow(u, 0.65));
      const arm = (rng() < 0.6) ? 1 : 0;
      const base = (Math.floor(rng() * 2) === 0) ? 0 : Math.PI; // 2-arm
      const armPhase = base + 0.55 * Math.log(Math.max(r, 0.1)) - 4.1 * Math.log(Math.max(r / R_GAL, 0.01));
      const jitter = (rng() - 0.5) * (arm ? 0.5 : Math.PI * 2);
      const theta = armPhase + jitter;
      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);
      const y = (rng() - 0.5) * 0.5 * Math.exp(-r / 6);

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Color by radius (hot blue inner, warm yellow/red outer)
      const hue = (r < 4) ? 0.07 + 0.05 * rng() : 0.58 + 0.08 * rng();
      const sat = 0.5 + 0.3 * rng();
      const lit = 0.65 + 0.25 * rng();
      const c = new THREE.Color().setHSL(hue, sat, lit);
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      // Initial velocity — set to RAR-circular for stability
      const vCirc = this.circularSpeed(r);
      const tx = -Math.sin(theta), tz = Math.cos(theta);
      const body: Body = {
        id: `star-${i}`,
        pos: [x, y, z],
        vel: [tx * vCirc, 0, tz * vCirc],
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
        spawnedBH: false
      });
    }

    this.posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(colors, 3);
    this.starGeom.setAttribute('position', this.posAttr);
    this.starGeom.setAttribute('color', this.colAttr);

    this.starMaterial = new THREE.PointsMaterial({
      size: 0.08, sizeAttenuation: true,
      vertexColors: true,
      transparent: true, depthWrite: false, opacity: 1.0,
      blending: THREE.AdditiveBlending,
      map: radialGlow(64, '#ffffff', '#ffe0c0', 'rgba(0,0,0,0)')
    });
    this.points = new THREE.Points(this.starGeom, this.starMaterial);
    this.scene.add(this.points);

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
  // Coalesce close BH pairs. Sim Schwarzschild radius scales as mass;
  // when two BHs are within (rs1 + rs2) × buffer, the smaller is absorbed
  // by the heavier and a telegrapher front rings out from the merger.
  private mergeBHs() {
    const RS_SCALE = 0.0035;   // sim units per unit mass (visual choice)
    const BUFFER   = 4.0;      // merger triggers at a generous multiple
    let merged = false;
    outer:
    for (let i = 0; i < this.bhs.length; i++) {
      for (let j = i + 1; j < this.bhs.length; j++) {
        const a = this.bhs[i], b = this.bhs[j];
        const dx = a.body.pos[0] - b.body.pos[0];
        const dy = a.body.pos[1] - b.body.pos[1];
        const dz = a.body.pos[2] - b.body.pos[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const rs = (RS_SCALE * (a.mass + b.mass)) * BUFFER;
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
          this.telegrapher.emit(keep.mesh.position.clone(), R_GAL * 1.6, 1.4);
          // Remove the absorbed BH from scene + draggable + bhs[]
          this.scene.remove(gone.mesh);
          this.draggable.remove(gone.mesh);
          gone.mesh.traverse(o => {
            const g = (o as any).geometry; if (g?.dispose) g.dispose();
            const m = (o as any).material;
            if (Array.isArray(m)) m.forEach((x: any) => x.dispose?.());
            else m?.dispose?.();
          });
          this.bhs.splice(this.bhs.indexOf(gone), 1);
          // Re-index userData so pick/hover still works
          for (let k = 0; k < this.bhs.length; k++) this.bhs[k].mesh.userData.index = k;
          merged = true;
          break outer;
        }
      }
    }
    return merged;
  }

  // Spawn an expanding-fading explosion sprite at the dying star's
  // position. Massive stars get a bigger, hotter SN flare; low-mass
  // get a softer planetary-nebula glow. Drives the "this is actually
  // a supernova, not a bright pixel" reading.
  private spawnSNFlare(s: Star, tG: number) {
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
    // Remnant mass ≈ 30 % of initial (rest blown off in the explosion)
    const remMsun  = Math.max(3, s.mass * 0.30);
    const simMass  = 3 + (remMsun - 3) * 0.5;       // sim-mass scale
    const radius   = 0.05 + 0.03 * (remMsun / 30);
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
      diskTiltAngle: 0
    });
    // Supernova ringdown
    this.telegrapher.emit(mesh.position.clone(), R_GAL * 1.3, 1.2);
  }

  private centralMass(): number {
    const central = this.bhs.find(b => b.isCentral);
    return central?.mass ?? 0;
  }

  private circularSpeed(r: number): number {
    // RAR-consistent circular speed: v² / r = g_obs from central baryonic mass.
    // If there's no central SMBH, use a soft bulge mass so outer rotation curve
    // still falls into deep-MOND naturally (paper §14: Tully–Fisher follows).
    const M = Math.max(this.centralMass(), 60);
    const gBar = G_SIM * M / Math.max(r * r, 1e-3);
    const y = gBar / A0_SIM;
    const nu = 0.5 + Math.sqrt(0.25 + 1 / Math.max(y, 1e-30));
    const gObs = nu * gBar;
    return Math.sqrt(gObs * Math.max(r, 0.1));
  }

  update(ctx: RegimeContext, dt: number): void {
    // dt is sim seconds. Clamp the per-frame step so fast-forward doesn't
    // shatter orbits; wall-time accumulator drives pure-UI animations (halo
    // fade, camera pan) so they stay alive at extreme speeds.
    const visDt = Math.min(0.06, Math.abs(dt)) * Math.sign(dt || 1);
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
    this.starMaterial.opacity = 0.15 + 0.85 * galaxyAlpha;
    // Central SMBH grows with time (visualised as a slow accretion-disk
    // scale-up). Multiplier 0.85 → 1.15 over 0..13.8 Gyr.
    const smbhGrowth = 0.85 + 0.3 * Math.min(1, tG / 13.8);
    for (const bh of this.bhs) {
      if (bh.isCentral) bh.mesh.scale.setScalar(smbhGrowth);
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
    const sub = 2;
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

    // Stars under combined BH gravity (RAR — paper §14). Each star feels
    // every surviving BH (central SMBH + stellar remnants). If a star
    // wanders inside a BH's tidal radius, it's disrupted: marked dead
    // (death flash will fire next frame) and the BH disk brightens
    // transiently.
    const TIDAL_K = 0.025;      // r_tidal = TIDAL_K * sqrt(M) — visual cue
    for (let s = 0; s < sub; s++) {
      for (const star of this.stars) {
        if (star.body.fixed || star.state === 'dead') continue;
        let ax = 0, ay = 0, az = 0;
        for (const bh of this.bhs) {
          const rx = star.body.pos[0] - bh.body.pos[0];
          const ry = star.body.pos[1] - bh.body.pos[1];
          const rz = star.body.pos[2] - bh.body.pos[2];
          const r2 = rx * rx + ry * ry + rz * rz + 1e-3;
          const dist = Math.sqrt(r2);
          // Tidal-disruption: too-close encounter consumes the star
          const rT = TIDAL_K * Math.sqrt(bh.mass);
          if (dist < rT) {
            star.state = 'dead';
            star.deathT = tG;
            // Pulse the BH's accretion disk to register the feeding event
            (bh.mesh as any).feedPulse = ((bh.mesh as any).feedPulse ?? 0) + 0.6;
            break;
          }
          const gBar = G_SIM * bh.mass / r2;
          const y    = gBar / A0_SIM;
          const nu   = 0.5 + Math.sqrt(0.25 + 1 / Math.max(y, 1e-30));
          const gObs = nu * gBar;
          const k    = -gObs / dist;
          ax += k * rx; ay += k * ry; az += k * rz;
        }
        if (star.state === 'dead') continue;
        star.body.vel[0] += dtSim * ax;
        star.body.vel[1] += dtSim * ay;
        star.body.vel[2] += dtSim * az;
        star.body.pos[0] += dtSim * star.body.vel[0];
        star.body.pos[1] += dtSim * star.body.vel[1];
        star.body.pos[2] += dtSim * star.body.vel[2];
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
          // Low-mass → cooling white dwarf. Tiny, dim, slightly blue.
          const cooled = Math.exp(-sinceDeath * 0.6);     // fade over Gyr
          r = 0.30 * cooled; g = 0.40 * cooled; b = 0.55 * cooled;
        }
      }
      col[i * 3 + 0] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;

    // BH drag-follow
    for (const bh of this.bhs) {
      bh.mesh.position.set(bh.body.pos[0], bh.body.pos[1], bh.body.pos[2]);
    }
    // Halo follows the central BH if one exists; otherwise dim halo at origin
    const central = this.bhs.find(b => b.isCentral);
    this.haloMesh.position.copy(central ? central.mesh.position : new THREE.Vector3());
    const haloPulse = 0.85 + 0.15 * Math.sin(this.wallTime * 0.9);
    (this.haloMesh.material as THREE.SpriteMaterial).opacity =
      ctx.entanglementOn ? (central ? 0.55 * haloPulse : 0.30 * haloPulse) : 0;
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

    // Focus reticle — only shown when zoom is in the second half of the
    // GALAXY band (i.e. user is about to drill into a star). At low intra
    // the reticle just clutters the view, especially when stars are bunched
    // near the BH and it appears to "blink" between them.
    const showReticle = ctx.zoomIntra > 0.5 && !!ctx.focus.starId;
    if (showReticle) {
      const idx = parseInt(ctx.focus.starId!.replace('st-', ''), 10);
      const s = this.stars[idx];
      if (s) {
        this.focusReticle.visible = true;
        this.focusReticle.position.set(s.body.pos[0], s.body.pos[1], s.body.pos[2]);
        const fade = Math.min(1, (ctx.zoomIntra - 0.5) * 3.0);   // fade in over the last half
        (this.focusReticle.material as THREE.SpriteMaterial).opacity = 0.6 * fade;
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

  pick(intersection: THREE.Intersection): DragTarget | null {
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
