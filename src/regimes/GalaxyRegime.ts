// GALAXY: spiral disk + central BH. Stars draggable; orbits use RAR so outer disk
// has flat rotation curve (paper §14 — no dark matter needed).

import * as THREE from 'three';
import { Regime, RegimeContext, DragTarget } from './Regime';
import { mulberry32 } from '../core/Rng';
import { hashStr } from '../util/hash';
import { radialGlow } from '../render/Glow';
import { BlackHole } from '../render/BlackHole';
import { Body } from '../core/Gravity';
import { TelegrapherField } from '../render/Telegrapher';

const N_STARS = 6000;
const R_GAL   = 18;
const G_SIM   = 0.0008;
const A0_SIM  = 0.00010;
const BH_MASS = 800;

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
  private bh: BlackHole;
  private bhBody: Body;
  private spiralMesh: THREE.Mesh;
  private spiralMat: THREE.ShaderMaterial;
  private haloMesh: THREE.Sprite;
  private fieldLines: THREE.LineSegments;
  private flMaterial: THREE.LineBasicMaterial;
  private picked: THREE.Sprite;
  private time = 0;
  private wallTime = 0;
  private telegrapher = new TelegrapherField(2.0, new THREE.Color(0x9ee0ff));

  constructor(aspect: number, seed: number) {
    super(aspect);
    this.camera.position.set(0, R_GAL * 0.55, R_GAL * 1.05);
    this.camera.lookAt(0, 0, 0);

    const rng = mulberry32(hashStr(`galaxy|${seed}`));

    // Central black hole
    this.bh = new BlackHole({ radius: 0.32, diskInner: 2.4, diskOuter: 9, diskTilt: 0.55 });
    this.scene.add(this.bh);
    this.bhBody = { id: 'bh', pos: [0, 0, 0], vel: [0, 0, 0], mass: BH_MASS, fixed: true };
    this.bh.userData = { type: 'bh' };
    this.draggable.add(this.bh);

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
  }

  private circularSpeed(r: number): number {
    // RAR-consistent circular speed: v^2 / r = g_obs from central BH at radius r
    const gBar = G_SIM * BH_MASS / Math.max(r * r, 1e-3);
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
    this.bh.tick(this.time);

    // Integrate stars under BH gravity using RAR
    const sub = 2;
    const dtSim = visDt / sub;
    for (let s = 0; s < sub; s++) {
      // Test-particle approximation: each star only feels the BH
      for (const star of this.stars) {
        if (star.body.fixed) continue;
        const r = [star.body.pos[0] - this.bhBody.pos[0],
                   star.body.pos[1] - this.bhBody.pos[1],
                   star.body.pos[2] - this.bhBody.pos[2]];
        const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + 1e-6;
        const dist = Math.sqrt(r2);
        const gBar = G_SIM * BH_MASS / r2;
        const y    = gBar / A0_SIM;
        const nu   = 0.5 + Math.sqrt(0.25 + 1 / Math.max(y, 1e-30));
        const gObs = nu * gBar;
        const k    = -gObs / dist;
        // kick-drift-kick (single-body)
        star.body.vel[0] += dtSim * k * r[0];
        star.body.vel[1] += dtSim * k * r[1];
        star.body.vel[2] += dtSim * k * r[2];
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

    // BH position drag-follow
    this.bh.position.set(this.bhBody.pos[0], this.bhBody.pos[1], this.bhBody.pos[2]);
    this.haloMesh.position.copy(this.bh.position);
    (this.haloMesh.material as THREE.SpriteMaterial).opacity = ctx.entanglementOn ? 0.35 : 0;
    this.fieldLines.visible = ctx.entanglementOn;
    this.flMaterial.opacity = ctx.entanglementOn ? 0.4 : 0;

    // Telegrapher waves advance with sim-time (paper §17: D/τ₀ = c²)
    this.telegrapher.update(visDt);

    // Subtle camera pan driven by wall time so it never freezes
    const phi = this.wallTime * 0.05;
    this.camera.position.x = Math.sin(phi) * R_GAL * 0.1;
    this.camera.lookAt(0, 0, 0);
  }

  bloomStrength(_ctx: RegimeContext): number {
    return 1.05;
  }

  pick(intersection: THREE.Intersection): DragTarget | null {
    const obj = intersection.object;
    const ud = obj.userData;
    if (ud?.type === 'bh') {
      const body = this.bhBody;
      return {
        id: 'bh',
        object: this.bh,
        worldPos: new THREE.Vector3().copy(this.bh.position),
        onDragMove: (p) => {
          body.pos[0] = p.x; body.pos[1] = p.y; body.pos[2] = p.z;
        },
        onDragEnd: (_v) => {
          body.vel[0] = body.vel[1] = body.vel[2] = 0;
          // Disturbing a defect launches a telegrapher front through the substrate
          this.telegrapher.emit(this.bh.position.clone(), R_GAL * 2.2, 1.0);
        }
      };
    }
    return null;
  }
}
