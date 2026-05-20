// Anchor: Galactic RAR Transition.
//
// Paper context: §14, eq. for g_obs vs g_bar. The paper's central
// observational claim is that one acceleration law
//
//     g_obs = g_bar / (1 − exp(−√(g_bar/a₀)))
//
// — with a₀ = g_share,eff · cH₀ / (4π²) emerging from the closure chain —
// fits galactic rotation curves end-to-end, with no dark matter and no
// per-galaxy fitting. This anchor makes that visible:
//
//   * A central baryonic source at origin (bright sprite, not a BH).
//   * A ring of test stars at radii spanning deep-Newton (inner) to
//     deep-MOND (outer). Each is locked to its RAR-circular speed.
//   * A parallel ring of Newton-only "ghost" stars at the same radii.
//     They drift behind the RAR stars at large r because Newton alone
//     under-predicts the outer rotation speed.
//   * Faint guide circles at each radius so the eye reads the orbit
//     families.
//
// The "flat rotation curve without dark matter" effect is then visible
// as the outer real stars keeping up with the inner ones, while the
// Newton ghosts fall behind.

import * as THREE from 'three';
import { Anchor, AnchorContext } from './Anchor';
import { radialGlow, deltaSField } from '../render/Glow';
import { nuRAR } from '../core/Gravity';

const N_RADII   = 9;            // number of orbital radii sampled
const R_MIN     = 1.8;
const R_MAX     = 14;
const M_CENTER  = 1500;         // sim-mass of central baryonic source
const G_SIM     = 0.0006;       // sim gravity coupling
const A0_SIM    = 0.00006;      // chosen so y crosses 1 inside R_MIN..R_MAX
const RING_SEGS = 96;           // segments per circular orbit guide

export class RARTransitionAnchor extends Anchor {
  private centralMark!: THREE.Sprite;
  private realStars: THREE.Sprite[] = [];
  private ghostStars: THREE.Sprite[] = [];
  private radii: number[] = [];
  private phaseReal: number[] = [];
  private phaseGhost: number[] = [];
  private vReal: number[] = [];           // RAR-circular angular speeds (rad/s)
  private vNewton: number[] = [];         // Newton-only angular speeds (rad/s)

  constructor(aspect: number) {
    super({
      id: 'rar-transition',
      title: 'Galactic RAR transition · flat rotation',
      paperRef: '§14',
      blurb:
        'A central baryonic mass + 9 test stars at radii spanning ' +
        'deep-Newton (inner) to deep-MOND (outer). Cool stars use the ' +
        "paper's exponential RAR; warm ghost stars use Newton only. " +
        'The ghosts drift behind at large r — flat rotation curves ' +
        'without dark matter, one paper formula, no fits.',
      tier: 1
    }, aspect);

    this.camera.position.set(0, R_MAX * 0.45, R_MAX * 1.8);
    this.camera.lookAt(0, 0, 0);

    this.buildCentralMark();
    this.buildOrbits();
    this.buildStarBackdrop();
  }

  // --- construction ------------------------------------------------------

  private buildCentralMark() {
    const tex = radialGlow(256, '#fff4d8', '#ffaa55', 'rgba(255,80,40,0)');
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true
    }));
    sprite.scale.setScalar(2.2);
    this.centralMark = sprite;
    this.scene.add(sprite);
    // δS halo so the substrate-field-around-the-mass picture is implied
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: deltaSField(256, 0.08, '#7ad7ff'),
      color: 0x7ad7ff, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.45
    }));
    halo.scale.setScalar(R_MAX * 0.9);
    this.scene.add(halo);
  }

  private buildOrbits() {
    const realTex  = radialGlow(96, '#ffffff', '#cce0ff', 'rgba(120,160,255,0)');
    const ghostTex = radialGlow(96, '#ffaa66', '#ff6040', 'rgba(255,80,40,0)');
    for (let i = 0; i < N_RADII; i++) {
      const t = i / (N_RADII - 1);
      // Log-distributed so we sample both deep-Newton AND deep-MOND ranges
      const r = R_MIN * Math.pow(R_MAX / R_MIN, t);
      this.radii.push(r);
      // Pre-compute RAR-circular and Newton-only angular speeds
      const gBar = G_SIM * M_CENTER / (r * r);
      const y    = gBar / A0_SIM;
      const gObs = nuRAR(y) * gBar;
      this.vReal.push(Math.sqrt(gObs * r) / r);
      this.vNewton.push(Math.sqrt(gBar * r) / r);
      this.phaseReal.push(Math.random() * Math.PI * 2);
      this.phaseGhost.push(this.phaseReal[i]);    // start in sync; ghost drifts behind
      const real = new THREE.Sprite(new THREE.SpriteMaterial({
        map: realTex, color: 0xddeeff,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
      }));
      real.scale.setScalar(0.55);
      this.scene.add(real);
      this.realStars.push(real);
      const ghost = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ghostTex, color: 0xff8050,
        blending: THREE.AdditiveBlending, depthWrite: false,
        transparent: true, opacity: 0.7
      }));
      ghost.scale.setScalar(0.5);
      this.scene.add(ghost);
      this.ghostStars.push(ghost);
      // Faint guide circle at this radius
      this.scene.add(this.makeGuideCircle(r));
    }
  }

  private makeGuideCircle(r: number): THREE.Line {
    const positions = new Float32Array((RING_SEGS + 1) * 3);
    for (let s = 0; s <= RING_SEGS; s++) {
      const a = (s / RING_SEGS) * Math.PI * 2;
      positions[s*3+0] = r * Math.cos(a);
      positions[s*3+1] = 0;
      positions[s*3+2] = r * Math.sin(a);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.LineBasicMaterial({
      color: 0x4a5a7a, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    return new THREE.Line(g, m);
  }

  private buildStarBackdrop() {
    const N = 200;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = R_MAX * (5 + Math.random() * 3);
      positions[i*3+0] = R * s * Math.cos(t);
      positions[i*3+1] = R * u;
      positions[i*3+2] = R * s * Math.sin(t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({
      size: 0.28, sizeAttenuation: true,
      color: 0xccccff, transparent: true, opacity: 0.4,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.scene.add(new THREE.Points(g, m));
  }

  // --- lifecycle ---------------------------------------------------------

  restart() {
    // Re-sync the two ring populations to the same initial phase so the
    // observer sees the divergence happen from scratch.
    for (let i = 0; i < N_RADII; i++) {
      this.phaseReal[i] = Math.random() * Math.PI * 2;
      this.phaseGhost[i] = this.phaseReal[i];
    }
  }

  // --- per-frame ---------------------------------------------------------

  update(ctx: AnchorContext): void {
    if (!ctx.playing) return;
    // Use wall-time so the demo isn't tied to cosmic-clock speed
    const dt = ctx.wallDt;
    // Visual rate scale — the precomputed v* values are in sim units and
    // would be very slow on a wall clock; multiply by 22 so a full inner
    // orbit takes ~5 wall-seconds, outer ~15 wall-seconds.
    const RATE = 22;
    for (let i = 0; i < N_RADII; i++) {
      this.phaseReal[i]  += this.vReal[i]  * dt * RATE;
      this.phaseGhost[i] += this.vNewton[i] * dt * RATE;
      const r = this.radii[i];
      this.realStars[i].position.set(r * Math.cos(this.phaseReal[i]),  0.0, r * Math.sin(this.phaseReal[i]));
      this.ghostStars[i].position.set(r * Math.cos(this.phaseGhost[i]), 0.0, r * Math.sin(this.phaseGhost[i]));
    }
  }
}
