// SYSTEM: a star + 5–8 planets on Keplerian orbits. Drag any planet/star to perturb.
// RAR collapses to Newton at AU scale (g_bar >> a0), so orbits look correct.

import * as THREE from 'three';
import { Regime, RegimeContext, DragTarget } from './Regime';
import { mulberry32 } from '../core/Rng';
import { hashStr } from '../util/hash';
import { radialGlow } from '../render/Glow';
import { Body, accelOnRAR, stepLeapfrog } from '../core/Gravity';
import { TelegrapherField } from '../render/Telegrapher';
import { PhotonField } from '../render/Photons';

const G_SIM     = 4.0;
const A0_SIM    = 1e-9;     // effectively Newton at this scale
const N_BG_STARS = 1400;    // background "galactic neighbourhood" stars

interface PlanetView {
  body: Body;
  mesh: THREE.Mesh;
  trail: THREE.Line;
  trailPositions: Float32Array;
  trailHead: number;
  ring?: THREE.Mesh;
}

const TRAIL = 256;

export class SystemRegime extends Regime {
  private starBody: Body;
  private starMesh: THREE.Sprite;
  private planets: PlanetView[] = [];
  private fieldLines: THREE.LineSegments;
  private fieldOpacity = 0;
  private time = 0;
  private wallTime = 0;
  private telegrapher = new TelegrapherField(30, new THREE.Color(0xffd9a0));
  // Photon field — propSpeed 1000 scene-units/sim-sec → visible at "Light"
  // preset (~5 wall-sec to traverse the system), blurs at faster speeds.
  private photons = new PhotonField(800, 1000, 320, new THREE.Color(0xffeac0), 0.7);

  constructor(aspect: number, seed: number) {
    super(aspect);
    this.camera.position.set(0, 80, 230);
    this.camera.lookAt(0, 0, 0);

    const rng = mulberry32(hashStr(`system|${seed}`));

    // Distant "galactic neighbourhood" — sparse field of background stars
    // visible at the edges of the frame so this regime feels embedded in
    // the surrounding galaxy rather than being an isolated set piece.
    const bgGeom = new THREE.BufferGeometry();
    const bgPos = new Float32Array(N_BG_STARS * 3);
    const bgCol = new THREE.Color();
    const bgColArr = new Float32Array(N_BG_STARS * 3);
    for (let i = 0; i < N_BG_STARS; i++) {
      // Sphere-shell distribution far from the system (r ~ 700..1500)
      const u = rng() * 2 - 1;
      const theta = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = 700 + rng() * 800;
      bgPos[i * 3 + 0] = R * s * Math.cos(theta);
      bgPos[i * 3 + 1] = R * u * 0.4;        // flattened to a disk
      bgPos[i * 3 + 2] = R * s * Math.sin(theta);
      // Realistic stellar colour distribution: mostly cool reds/oranges,
      // some yellows, occasional blue
      const t = rng();
      if (t < 0.6)      bgCol.setHSL(0.04 + rng() * 0.08, 0.6, 0.55);
      else if (t < 0.9) bgCol.setHSL(0.12 + rng() * 0.05, 0.6, 0.65);
      else              bgCol.setHSL(0.6 + rng() * 0.08, 0.7, 0.75);
      bgColArr[i * 3 + 0] = bgCol.r;
      bgColArr[i * 3 + 1] = bgCol.g;
      bgColArr[i * 3 + 2] = bgCol.b;
    }
    bgGeom.setAttribute('position', new THREE.BufferAttribute(bgPos, 3));
    bgGeom.setAttribute('color',    new THREE.BufferAttribute(bgColArr, 3));
    const bgMat = new THREE.PointsMaterial({
      size: 1.8,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.scene.add(new THREE.Points(bgGeom, bgMat));

    // Per-seed star: pick a type → mass, colour, size
    // Wide range so different focused stars give visibly different systems.
    const stellarType = rng();  // 0..1
    let starMass: number, starHot: string, starMid: string, starCool: string, starScale: number;
    if (stellarType < 0.45) {
      // M dwarf: small, red, cool
      starMass = 350 + rng() * 200;
      starHot = '#ffe2a8'; starMid = '#ff9858'; starCool = 'rgba(255,80,40,0)';
      starScale = 28;
    } else if (stellarType < 0.85) {
      // G/K star (Sun-ish): medium, yellow
      starMass = 700 + rng() * 600;
      starHot = '#fffae0'; starMid = '#ffcc70'; starCool = 'rgba(255,140,40,0)';
      starScale = 40;
    } else {
      // O/B giant: large, blue-white, hot
      starMass = 1500 + rng() * 1200;
      starHot = '#f0faff'; starMid = '#a8d0ff'; starCool = 'rgba(70,140,255,0)';
      starScale = 65;
    }
    const N_PLANETS = 3 + Math.floor(rng() * 7);   // 3..9 planets per system

    // Central star
    this.starBody = { id: 'star', pos: [0, 0, 0], vel: [0, 0, 0], mass: starMass };
    this.starMesh = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlow(512, starHot, starMid, starCool),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    this.starMesh.scale.setScalar(starScale);
    this.starMesh.userData = { type: 'star' };
    this.scene.add(this.starMesh);
    this.draggable.add(this.starMesh);
    const STAR_MASS = starMass;

    // Planets
    for (let i = 0; i < N_PLANETS; i++) {
      const a = 25 + i * 22 + rng() * 8;     // semi-major axis
      const e = 0.02 + rng() * 0.18;
      const phase = rng() * Math.PI * 2;
      const r = a * (1 - e);
      const x = r * Math.cos(phase);
      const z = r * Math.sin(phase);
      const v = Math.sqrt(G_SIM * STAR_MASS * (1 / r - 0.5 / a));
      const tx = -Math.sin(phase), tz = Math.cos(phase);
      const body: Body = {
        id: `p-${i}`,
        pos: [x, 0, z],
        vel: [tx * v, 0, tz * v],
        mass: 0.01 + rng() * 0.05
      };

      const radius = 1.0 + Math.pow(rng(), 1.6) * 4.5;
      const hue    = (rng() * 360);
      const planetCol = new THREE.Color().setHSL(hue / 360, 0.55, 0.6);

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 32, 24),
        new THREE.MeshStandardMaterial({
          color: planetCol,
          roughness: 0.6,
          metalness: 0.05,
          emissive: planetCol.clone().multiplyScalar(0.04)
        })
      );
      mesh.userData = { type: 'planet', index: i };
      mesh.position.set(x, 0, z);
      this.scene.add(mesh);
      this.draggable.add(mesh);

      // Orbit trail
      const trailPositions = new Float32Array(TRAIL * 3);
      for (let k = 0; k < TRAIL; k++) {
        trailPositions[k * 3 + 0] = x;
        trailPositions[k * 3 + 1] = 0;
        trailPositions[k * 3 + 2] = z;
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
      const tm = new THREE.LineBasicMaterial({
        color: planetCol, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      const trail = new THREE.Line(tg, tm);
      this.scene.add(trail);

      const pv: PlanetView = { body, mesh, trail, trailPositions, trailHead: 0 };

      // Saturn-style ring for one planet
      if (i === 3) {
        const ringGeom = new THREE.RingGeometry(radius * 1.4, radius * 2.1, 64);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xddc090,
          side: THREE.DoubleSide,
          transparent: true, opacity: 0.7, depthWrite: false
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.rotation.x = Math.PI / 2.4;
        mesh.add(ring);
        pv.ring = ring;
      }

      this.planets.push(pv);
    }

    // Lights
    const star = new THREE.PointLight(0xffe0a0, 4, 3000, 1.6);
    this.scene.add(star);
    this.scene.add(new THREE.AmbientLight(0x202028, 0.4));

    // Entanglement field — dipolar field lines
    const lineCount = 24;
    const segs = 24;
    const positions = new Float32Array(lineCount * (segs - 1) * 6);
    for (let l = 0; l < lineCount; l++) {
      const phi = (l / lineCount) * Math.PI * 2;
      for (let s = 0; s < segs - 1; s++) {
        const t1 = s / segs, t2 = (s + 1) / segs;
        const r1 = 30 + t1 * 220;
        const r2 = 30 + t2 * 220;
        const y1 = Math.sin(t1 * Math.PI) * 30;
        const y2 = Math.sin(t2 * Math.PI) * 30;
        const off = (l * (segs - 1) + s) * 6;
        positions[off + 0] = r1 * Math.cos(phi);
        positions[off + 1] = y1;
        positions[off + 2] = r1 * Math.sin(phi);
        positions[off + 3] = r2 * Math.cos(phi);
        positions[off + 4] = y2;
        positions[off + 5] = r2 * Math.sin(phi);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.LineBasicMaterial({
      color: 0x7ad7ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.fieldLines = new THREE.LineSegments(g, m);
    this.scene.add(this.fieldLines);
    this.scene.add(this.telegrapher.group);
    this.scene.add(this.photons.group);
  }

  update(ctx: RegimeContext, dt: number): void {
    const visDt = Math.min(0.06, Math.abs(dt)) * Math.sign(dt || 1);
    this.time += visDt;
    this.wallTime += ctx.dtWall;
    const sub = 2;
    const dtSim = visDt / sub;
    const bodies: Body[] = [this.starBody, ...this.planets.map(p => p.body)];
    for (let s = 0; s < sub; s++) {
      stepLeapfrog(bodies, dtSim, (i, all) => accelOnRAR(i, all, G_SIM, A0_SIM));
    }

    // Update visuals
    this.starMesh.position.set(this.starBody.pos[0], this.starBody.pos[1], this.starBody.pos[2]);
    for (const pv of this.planets) {
      pv.mesh.position.set(pv.body.pos[0], pv.body.pos[1], pv.body.pos[2]);
      if (pv.ring) pv.ring.rotation.z += visDt * 0.1;
      const tp = pv.trailPositions;
      tp.copyWithin(0, 3, TRAIL * 3);
      tp[(TRAIL - 1) * 3 + 0] = pv.body.pos[0];
      tp[(TRAIL - 1) * 3 + 1] = pv.body.pos[1];
      tp[(TRAIL - 1) * 3 + 2] = pv.body.pos[2];
      const attr = pv.trail.geometry.attributes.position as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }

    // Camera owned by OrbitControls.
    this.fieldOpacity += ((ctx.entanglementOn ? 0.7 : 0) - this.fieldOpacity) * Math.min(1, ctx.dtWall * 4);
    (this.fieldLines.material as THREE.LineBasicMaterial).opacity = this.fieldOpacity;
    this.fieldLines.visible = this.fieldOpacity > 0.01;

    this.telegrapher.update(visDt);

    // Photons — real particles emitted by the star and propagating at sim-c.
    // Emit at a wall-time pace (visible at any speed); advance with visDt so
    // slow-mo makes them crawl. At fast-forward they blast across instantly.
    const starPos = new THREE.Vector3(this.starBody.pos[0], this.starBody.pos[1], this.starBody.pos[2]);
    // Trickle photons in: a steady ~50 per wall-second baseline, plus burst
    // proportional to sim-time advance so emission scales with speed
    this.photons.emit(starPos, 50, ctx.dtWall);
    this.photons.emit(starPos, 0.4, visDt);
    const absorbers = this.planets.map(pv => ({
      pos: new THREE.Vector3(pv.body.pos[0], pv.body.pos[1], pv.body.pos[2]),
      radius: 14
    }));
    this.photons.update(visDt, starPos, absorbers);
  }

  bloomStrength(_ctx: RegimeContext): number {
    return 0.85;
  }

  pick(intersection: THREE.Intersection): DragTarget | null {
    const obj = intersection.object;
    const ud  = obj.userData;
    if (ud?.type === 'planet') {
      const pv = this.planets[ud.index as number];
      return {
        id: pv.body.id,
        object: obj,
        worldPos: new THREE.Vector3().copy(obj.position),
        onDragMove: (p) => {
          pv.body.pos[0] = p.x; pv.body.pos[1] = p.y; pv.body.pos[2] = p.z;
          pv.body.fixed = true;
        },
        onDragEnd: (v) => {
          pv.body.fixed = false;
          pv.body.vel[0] = v.x; pv.body.vel[1] = v.y; pv.body.vel[2] = v.z;
          this.telegrapher.emit(
            new THREE.Vector3(pv.body.pos[0], pv.body.pos[1], pv.body.pos[2]),
            400, 0.7
          );
        }
      };
    }
    if (ud?.type === 'star') {
      return {
        id: 'star',
        object: obj,
        worldPos: new THREE.Vector3().copy(obj.position),
        onDragMove: (p) => {
          this.starBody.pos[0] = p.x; this.starBody.pos[1] = p.y; this.starBody.pos[2] = p.z;
          this.starBody.fixed = true;
        },
        onDragEnd: (v) => {
          this.starBody.fixed = false;
          this.starBody.vel[0] = v.x; this.starBody.vel[1] = v.y; this.starBody.vel[2] = v.z;
          this.telegrapher.emit(
            new THREE.Vector3(this.starBody.pos[0], this.starBody.pos[1], this.starBody.pos[2]),
            500, 1.0
          );
        }
      };
    }
    return null;
  }
}
