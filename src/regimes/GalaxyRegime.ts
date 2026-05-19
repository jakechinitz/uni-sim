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
import { hawkingSolar, scrambling, formatSI } from '../core/Closure';
import { M_SUN } from '../util/units';

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
  private picked: THREE.Sprite;
  private focusReticle!: THREE.Sprite;
  private time = 0;
  private wallTime = 0;
  private telegrapher = new TelegrapherField(2.0, new THREE.Color(0x9ee0ff));

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
      this.bhs.push({
        mesh,
        body: { id: `bh-stellar-${i}`, pos: [x, y, z], vel: [0, 0, 0], mass: simMass, fixed: true },
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
        edgeColor:  { value: new THREE.Color('#7ad7ff') }
      },
      vertexShader: /* glsl */`
        varying vec2 vP;
        void main(){
          vP = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float time, arms, twist, innerCut, outerSoft;
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
          gl_FragColor = vec4(col, clamp(intensity, 0.0, 1.0));
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
      this.stars.push({ body, baseColor: c });
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

    // Field lines (entanglement overlay) — outward strands from center
    const lineCount = 36;
    const segs = 32;
    const linePositions = new Float32Array(lineCount * (segs - 1) * 2 * 3);
    const lineGeom = new THREE.BufferGeometry();
    for (let l = 0; l < lineCount; l++) {
      const ang = (l / lineCount) * Math.PI * 2;
      for (let s = 0; s < segs - 1; s++) {
        const r1 = (s / segs) * R_GAL * 2.5;
        const r2 = ((s + 1) / segs) * R_GAL * 2.5;
        const dy = Math.sin((s / segs) * 6 + l) * 0.4;
        const off = (l * (segs - 1) + s) * 6;
        linePositions[off + 0] = r1 * Math.cos(ang);
        linePositions[off + 1] = dy;
        linePositions[off + 2] = r1 * Math.sin(ang);
        linePositions[off + 3] = r2 * Math.cos(ang);
        linePositions[off + 4] = dy * 1.1;
        linePositions[off + 5] = r2 * Math.sin(ang);
      }
    }
    lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    this.flMaterial = new THREE.LineBasicMaterial({
      color: 0x7ad7ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.fieldLines = new THREE.LineSegments(lineGeom, this.flMaterial);
    this.scene.add(this.fieldLines);

    // Telegrapher wave group — emits when objects are flicked
    this.scene.add(this.telegrapher.group);

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
    for (const b of this.bhs) b.mesh.tick(this.time);

    // Integrate stars under combined BH gravity using RAR. Each star feels
    // every BH in the galaxy (central SMBH + stellar-mass remnants).
    const sub = 2;
    const dtSim = visDt / sub;
    for (let s = 0; s < sub; s++) {
      for (const star of this.stars) {
        if (star.body.fixed) continue;
        let ax = 0, ay = 0, az = 0;
        for (const bh of this.bhs) {
          const rx = star.body.pos[0] - bh.body.pos[0];
          const ry = star.body.pos[1] - bh.body.pos[1];
          const rz = star.body.pos[2] - bh.body.pos[2];
          const r2 = rx * rx + ry * ry + rz * rz + 1e-3;
          const dist = Math.sqrt(r2);
          const gBar = G_SIM * bh.mass / r2;
          const y    = gBar / A0_SIM;
          const nu   = 0.5 + Math.sqrt(0.25 + 1 / Math.max(y, 1e-30));
          const gObs = nu * gBar;
          const k    = -gObs / dist;
          ax += k * rx; ay += k * ry; az += k * rz;
        }
        star.body.vel[0] += dtSim * ax;
        star.body.vel[1] += dtSim * ay;
        star.body.vel[2] += dtSim * az;
        star.body.pos[0] += dtSim * star.body.vel[0];
        star.body.pos[1] += dtSim * star.body.vel[1];
        star.body.pos[2] += dtSim * star.body.vel[2];
      }
    }
    // Push positions into the point cloud
    const arr = this.posAttr.array as Float32Array;
    for (let i = 0; i < this.stars.length; i++) {
      arr[i * 3 + 0] = this.stars[i].body.pos[0];
      arr[i * 3 + 1] = this.stars[i].body.pos[1];
      arr[i * 3 + 2] = this.stars[i].body.pos[2];
    }
    this.posAttr.needsUpdate = true;

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
    this.fieldLines.visible = ctx.entanglementOn;
    this.flMaterial.opacity = ctx.entanglementOn ? 0.4 : 0;

    // Telegrapher waves advance with sim-time (paper §17: D/τ₀ = c²)
    this.telegrapher.update(visDt);

    // Camera owned by OrbitControls. Focus reticle highlights the star the
    // camera ray currently points at — zoom in from here drills into THAT
    // star's solar system.
    if (ctx.focus.starId) {
      const idx = parseInt(ctx.focus.starId.replace('st-', ''), 10);
      const s = this.stars[idx];
      if (s) {
        this.focusReticle.visible = true;
        this.focusReticle.position.set(s.body.pos[0], s.body.pos[1], s.body.pos[2]);
      } else {
        this.focusReticle.visible = false;
      }
    } else {
      this.focusReticle.visible = false;
    }
  }

  bloomStrength(_ctx: RegimeContext): number {
    return 1.05;
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
      },
      onDragEnd: (_v) => {
        bh.body.vel[0] = bh.body.vel[1] = bh.body.vel[2] = 0;
        this.telegrapher.emit(bh.mesh.position.clone(), R_GAL * 2.2, 1.0);
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
