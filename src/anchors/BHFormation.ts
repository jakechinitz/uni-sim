// Anchor: Black-Hole Formation as a Saturation Boundary.
//
// Paper context: §20 (q→0 saturation = horizon; manifold ends at q=0,
// nothing physical continues to a singular centre). §15 (q(r) = 1 − r_s/r
// for the exterior). The point of this demo is to make the paper's
// distinctive ontological claim visible:
//
//   * Matter collapses inward (just Newtonian dust for visualization).
//   * The substrate capacity field q drops in the centre but remains bounded.
//   * When q reaches 0 at some radius r_s, a horizon shell EMERGES —
//     drawn as an opaque black sphere with a δS-driven photon ring.
//   * The exterior remains an ordinary Schwarzschild-like geometry.
//   * The story stops at the horizon; no singularity is drawn inside.
//
// What you see: cloud of dust particles collapsing → central q-field
// reddening → bounded q-shell reaches q≈0 → horizon pops into existence
// and grows → particles that fall through stop being rendered (they've
// "joined the horizon degrees of freedom"). The exterior settles into a
// static profile.

import * as THREE from 'three';
import { Anchor, AnchorContext } from './Anchor';
import { radialGlow, deltaSField } from '../render/Glow';
import { BlackHole } from '../render/BlackHole';

const N_DUST       = 600;        // dust particles in the collapsing cloud
const CLOUD_R      = 9;          // initial cloud radius
const TARGET_RS    = 1.0;        // final horizon radius (sim units)
const G_DUST       = 0.6;        // sim gravitational coupling (visual)
const COLLAPSE_DAMP = 0.985;     // light velocity damping so collapse isn't ballistic
const MASS_TO_Q_ZERO = 12;       // visual mass scale at which q-shell saturates
const HORIZON_Q_THRESHOLD = 0.02;

export class BHFormationAnchor extends Anchor {
  private dust!: THREE.Points;
  private dustPositions!: Float32Array;
  private dustVelocities!: Float32Array;
  private dustColors!: Float32Array;
  private dustAlive!: Uint8Array;
  private centralMass = 0;                  // mass that has collapsed past r_s
  private qFloor = 1;                       // bounded q minimum, 1 -> 0
  private hole: BlackHole | null = null;
  private holeRadius = 0;                   // grows as more dust falls in
  private capacityField!: THREE.Mesh;       // soft glowing ball showing q-drain
  private horizonShell!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private wallTime = 0;
  private collapseStartT = 1.0;             // wall-seconds before collapse begins

  constructor(aspect: number) {
    super({
      id: 'bh-formation',
      title: 'BH formation as saturation boundary',
      paperRef: '§15, §20',
      blurb:
        'A dust cloud collapses. The bounded substrate capacity q is drained ' +
        'toward the centre. When q reaches the q=0 free boundary a horizon ' +
        'SHELL forms — no singular centre is drawn inside.',
      tier: 1
    }, aspect);

    this.camera.position.set(0, CLOUD_R * 0.5, CLOUD_R * 2.4);
    this.camera.lookAt(0, 0, 0);

    this.buildDust();
    this.buildCapacityField();
    this.buildHorizonShell();
    this.buildStarBackdrop();
  }

  // --- construction ------------------------------------------------------

  private buildDust() {
    this.dustPositions = new Float32Array(N_DUST * 3);
    this.dustVelocities = new Float32Array(N_DUST * 3);
    this.dustColors = new Float32Array(N_DUST * 3);
    this.dustAlive = new Uint8Array(N_DUST);
    for (let i = 0; i < N_DUST; i++) {
      // Uniform-in-volume spherical distribution
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = CLOUD_R * Math.cbrt(Math.random());
      const s = Math.sqrt(1 - u * u);
      this.dustPositions[i*3+0] = r * s * Math.cos(t);
      this.dustPositions[i*3+1] = r * u;
      this.dustPositions[i*3+2] = r * s * Math.sin(t);
      // Small random initial velocity so the cloud doesn't all fall on
      // perfectly radial trajectories (looks plasticine otherwise).
      this.dustVelocities[i*3+0] = (Math.random() - 0.5) * 0.04;
      this.dustVelocities[i*3+1] = (Math.random() - 0.5) * 0.04;
      this.dustVelocities[i*3+2] = (Math.random() - 0.5) * 0.04;
      const c = new THREE.Color().setHSL(0.06 + Math.random() * 0.06, 0.55, 0.55 + Math.random() * 0.20);
      this.dustColors[i*3+0] = c.r;
      this.dustColors[i*3+1] = c.g;
      this.dustColors[i*3+2] = c.b;
      this.dustAlive[i] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.dustPositions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color',    new THREE.BufferAttribute(this.dustColors, 3));
    const m = new THREE.PointsMaterial({
      size: 0.16, sizeAttenuation: true, vertexColors: true,
      transparent: true, depthWrite: false, opacity: 0.92,
      blending: THREE.AdditiveBlending,
      map: radialGlow(64, '#ffffff', '#ffe0c0', 'rgba(0,0,0,0)')
    });
    this.dust = new THREE.Points(g, m);
    this.scene.add(this.dust);
  }

  private buildCapacityField() {
    // Glowing ball with a δS texture — visualises q-drain in the centre.
    // Grows opacity + size as more dust collapses inward. When the horizon
    // emerges, this fades and the BlackHole mesh takes over.
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: deltaSField(256, 0.10, '#ffb070'),
      color: 0xffb070,
      blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true,
      opacity: 0
    }));
    sprite.scale.setScalar(0.8);
    this.capacityField = sprite as unknown as THREE.Mesh;
    this.scene.add(sprite);
  }

  private buildHorizonShell() {
    const g = new THREE.SphereGeometry(1, 56, 28);
    const m = new THREE.MeshBasicMaterial({
      color: 0x7ad7ff,
      wireframe: true,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    this.horizonShell = new THREE.Mesh(g, m);
    this.horizonShell.visible = false;
    this.scene.add(this.horizonShell);
  }

  private buildStarBackdrop() {
    const N = 250;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = CLOUD_R * (5 + Math.random() * 3);
      positions[i*3+0] = R * s * Math.cos(t);
      positions[i*3+1] = R * u;
      positions[i*3+2] = R * s * Math.sin(t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({
      size: 0.3, sizeAttenuation: true,
      color: 0xddddff, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    const stars = new THREE.Points(g, m);
    this.scene.add(stars);
  }

  // --- lifecycle ---------------------------------------------------------

  restart() {
    if (this.hole) {
      this.scene.remove(this.hole);
      // BlackHole is a Group with its own meshes; standard dispose pattern
      this.hole.traverse((o: any) => {
        if (o.geometry?.dispose) o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x: any) => x.dispose?.());
        else m?.dispose?.();
      });
      this.hole = null;
    }
    this.holeRadius = 0;
    this.centralMass = 0;
    this.qFloor = 1;
    this.wallTime = 0;
    (this.capacityField.material as THREE.SpriteMaterial).opacity = 0;
    this.horizonShell.visible = false;
    this.horizonShell.scale.setScalar(1);
    this.horizonShell.material.opacity = 0;
    this.horizonShell.material.color.set(0x7ad7ff);
    // Re-seed dust cloud
    for (let i = 0; i < N_DUST; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = CLOUD_R * Math.cbrt(Math.random());
      const s = Math.sqrt(1 - u * u);
      this.dustPositions[i*3+0] = r * s * Math.cos(t);
      this.dustPositions[i*3+1] = r * u;
      this.dustPositions[i*3+2] = r * s * Math.sin(t);
      this.dustVelocities[i*3+0] = (Math.random() - 0.5) * 0.04;
      this.dustVelocities[i*3+1] = (Math.random() - 0.5) * 0.04;
      this.dustVelocities[i*3+2] = (Math.random() - 0.5) * 0.04;
      this.dustAlive[i] = 1;
    }
    (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  // --- per-frame ---------------------------------------------------------

  update(ctx: AnchorContext): void {
    if (!ctx.playing) return;
    this.wallTime += ctx.wallDt;
    if (this.wallTime < this.collapseStartT) return;

    const dt = Math.min(0.05, ctx.wallDt * 1.3);
    const pos = this.dustPositions;
    const vel = this.dustVelocities;

    // Newtonian dust attracted to centre + any accreted central mass.
    // Soft Plummer-style core so particles don't shoot through origin.
    const softR2 = 0.04;
    const Mcentral = Math.max(1, this.centralMass);
    let absorbed = 0;
    let cloudPeakDensity = 0;
    for (let i = 0; i < N_DUST; i++) {
      if (!this.dustAlive[i]) continue;
      const x = pos[i*3+0], y = pos[i*3+1], z = pos[i*3+2];
      const r2 = x*x + y*y + z*z + softR2;
      const r = Math.sqrt(r2);
      // Inverse-square pull toward origin; mass acts like all dust within
      // r is the central source. We approximate with the running centralMass
      // (only counts dust that has passed the horizon shell).
      const g = G_DUST * Mcentral / r2;
      const k = -g / r;
      vel[i*3+0] += dt * k * x;
      vel[i*3+1] += dt * k * y;
      vel[i*3+2] += dt * k * z;
      // Damp slightly so the collapse isn't ballistic — radiation losses,
      // hand-waved (not paper-derived but visually correct).
      vel[i*3+0] *= COLLAPSE_DAMP;
      vel[i*3+1] *= COLLAPSE_DAMP;
      vel[i*3+2] *= COLLAPSE_DAMP;
      pos[i*3+0] += dt * vel[i*3+0];
      pos[i*3+1] += dt * vel[i*3+1];
      pos[i*3+2] += dt * vel[i*3+2];
      // Has this dust mote crossed the (current or future) horizon?
      const rNew = Math.sqrt(pos[i*3+0]**2 + pos[i*3+1]**2 + pos[i*3+2]**2);
      if (rNew < this.holeRadius * 1.05 || rNew < 0.5) {
        // Joined the horizon — stops being rendered, contributes mass.
        this.dustAlive[i] = 0;
        absorbed++;
      } else if (rNew < CLOUD_R * 0.3) {
        cloudPeakDensity++;
      }
    }
    if (absorbed > 0) this.centralMass += absorbed * 0.3;

    // Pre-horizon capacity field: opacity grows with central density.
    this.qFloor = Math.max(0, 1 - this.centralMass / MASS_TO_Q_ZERO);
    const qDrain = 1 - this.qFloor;
    const shellRadius = Math.max(0.08, TARGET_RS * Math.sqrt(qDrain));
    const matCap = this.capacityField.material as THREE.SpriteMaterial;
    matCap.opacity = Math.min(0.85, Math.max(cloudPeakDensity / 250, qDrain * 0.35));
    this.capacityField.scale.setScalar(0.8 + Math.min(2.2, this.centralMass / 30));

    // Bounded free-boundary visual: q never overshoots below 0; the visible
    // shell marks the radius where the q-floor is approaching saturation.
    this.horizonShell.visible = qDrain > 0.08;
    this.horizonShell.scale.setScalar(shellRadius);
    this.horizonShell.material.opacity = this.qFloor <= HORIZON_Q_THRESHOLD
      ? 0.52
      : Math.min(0.28, qDrain * 0.24);
    this.horizonShell.material.color.set(this.qFloor <= HORIZON_Q_THRESHOLD ? 0xffb070 : 0x7ad7ff);

    // Spawn the horizon shell once the bounded q-front reaches q≈0. After
    // that, the BlackHole mesh grows with the same free-boundary radius.
    if (!this.hole && this.qFloor <= HORIZON_Q_THRESHOLD) {
      this.hole = new BlackHole({
        radius: 0.25, diskInner: 2.6, diskOuter: 6.5,
        diskTilt: 0.5,
        hot: new THREE.Color('#fff4d8'),
        mid: new THREE.Color('#ffaa55'),
        cool: new THREE.Color('#a060ff')
      });
      this.scene.add(this.hole);
      this.hole.setLocalQ(Math.max(0.05, this.qFloor));
      // Fade capacity field out as the horizon takes over.
      matCap.opacity = 0;
    }
    if (this.hole) {
      this.holeRadius = Math.min(TARGET_RS, Math.max(0.25, shellRadius));
      this.hole.scale.setScalar(this.holeRadius / 0.25);
      this.hole.setLocalQ(Math.max(0.05, this.qFloor));
      this.hole.syncQField(this.hole.position, this.camera.position);
      this.hole.tick(this.wallTime);
    }

    // Push dust positions to GPU
    (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    // Hide absorbed particles by zeroing their colour alpha-equivalent:
    // PointsMaterial doesn't support per-point alpha easily, so we just
    // set position to far-away (off-camera) when absorbed.
    for (let i = 0; i < N_DUST; i++) {
      if (!this.dustAlive[i]) {
        pos[i*3+0] = 1e6; pos[i*3+1] = 1e6; pos[i*3+2] = 1e6;
      }
    }
  }
}
