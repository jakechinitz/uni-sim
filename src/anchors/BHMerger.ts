// Anchor: BH-BH Inspiral + Merger Ringdown.
//
// Paper context: §17 (telegrapher front carries the merger ringdown
// outward at c; D/τ₀ = c² is the substrate's gravitational-wave-analogue
// speed). §20 (BH = q→0 saturation; merger combines two saturation
// surfaces into one).
//
// Visualization:
//   * Two equal-mass SMBHs spiral around their common centre of mass.
//   * A scripted inspiral: orbital separation r(t) decays as the cube-
//     root of (t_merge - t) — the rough scaling from Peters-Mathews
//     leading-order gravitational radiation back-reaction. Not derived
//     from our PDE (the sim isn't a GW solver), but it gives the right
//     "speeds up as they get close" feel.
//   * At merger, both BHs are removed and replaced by a single bigger
//     BH at the centre of mass; a telegrapher front rings outward at
//     lattice-c representing the gravitational-wave shell.
//   * After the ringdown propagates and fades, the cycle restarts so
//     the user can watch the inspiral again.
//
// Uses the existing BlackHole render component (q-shell + δS halo +
// photon ring all driven by paper's q(r) = 1 − r_s/r) and the
// TelegrapherField sprite that's already used by the main galaxy
// regime for merger ringdowns.

import * as THREE from 'three';
import { Anchor, AnchorContext } from './Anchor';
import { BlackHole } from '../render/BlackHole';
import { TelegrapherField } from '../render/Telegrapher';
import { radialGlow } from '../render/Glow';

const BH_RADIUS_INDIV = 0.42;       // each progenitor's visual radius
const BH_RADIUS_FINAL = 0.62;       // final merged BH (≈ sum, slightly less)
const R_START         = 8;          // initial orbital separation
const R_FINAL         = 0.6;        // separation at which we declare merger
const INSPIRAL_DUR    = 10;         // wall-seconds from start to merger
const RINGDOWN_DUR    = 5;          // wall-seconds of post-merger telegrapher pulse
const RESTART_GAP     = 2;          // wall-seconds of empty before restarting

interface MergerState {
  phase: 'inspiral' | 'merged' | 'idle';
  t: number;                        // wall-time within the current phase
}

export class BHMergerAnchor extends Anchor {
  private bhA!: BlackHole;
  private bhB!: BlackHole;
  private merged: BlackHole | null = null;
  private telegrapher = new TelegrapherField(2.6, new THREE.Color(0x9ee0ff));
  private state: MergerState = { phase: 'inspiral', t: 0 };
  private wallTime = 0;

  constructor(aspect: number) {
    super({
      id: 'bh-merger',
      title: 'BH–BH inspiral + ringdown',
      paperRef: '§17, §20',
      blurb:
        'Two equal-mass SMBHs spiral inward, merge into one saturation ' +
        'surface, and emit a telegrapher ringdown shell propagating at ' +
        'lattice-c (paper §17 — the substrate analogue of GW emission). ' +
        'Inspiral rate follows Peters-Mathews r ∝ (t_merge - t)^{1/4} ' +
        'phenomenology — not derived from our PDE, but the right shape.',
      tier: 2
    }, aspect);

    this.camera.position.set(0, 8, 16);
    this.camera.lookAt(0, 0, 0);

    this.spawnProgenitors();
    this.scene.add(this.telegrapher.group);
    this.buildStars();
  }

  // --- progenitor construction -------------------------------------------

  private spawnProgenitors() {
    // Both BHs get distinct cool-color palettes so the viewer can tell
    // which one came from where post-merger.
    this.bhA = this.makeBH(BH_RADIUS_INDIV, '#a060ff');
    this.bhB = this.makeBH(BH_RADIUS_INDIV, '#7ad7ff');
    this.scene.add(this.bhA);
    this.scene.add(this.bhB);
  }

  private makeBH(radius: number, coolHex: string): BlackHole {
    return new BlackHole({
      radius,
      diskInner: 2.6, diskOuter: 5.5,
      diskTilt: 0.45,
      hot:  new THREE.Color('#fff4d8'),
      mid:  new THREE.Color('#ffaa55'),
      cool: new THREE.Color(coolHex)
    });
  }

  private buildStars() {
    const N = 350;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = 30 + Math.random() * 25;
      positions[i*3+0] = R * s * Math.cos(t);
      positions[i*3+1] = R * u;
      positions[i*3+2] = R * s * Math.sin(t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({
      size: 0.26, sizeAttenuation: true,
      color: 0xddddff, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending,
      map: radialGlow(64, '#ffffff', '#ccddff', 'rgba(0,0,0,0)')
    });
    this.scene.add(new THREE.Points(g, m));
  }

  // --- lifecycle ---------------------------------------------------------

  restart() {
    // Tear down the merged remnant (if any) and re-spawn progenitors.
    if (this.merged) {
      this.scene.remove(this.merged);
      this.disposeBH(this.merged);
      this.merged = null;
    }
    if (this.bhA && this.bhA.parent) this.scene.remove(this.bhA);
    if (this.bhB && this.bhB.parent) this.scene.remove(this.bhB);
    if (this.bhA) this.disposeBH(this.bhA);
    if (this.bhB) this.disposeBH(this.bhB);
    this.spawnProgenitors();
    this.state = { phase: 'inspiral', t: 0 };
    this.wallTime = 0;
  }

  private disposeBH(bh: BlackHole) {
    bh.traverse((o: any) => {
      const g = o.geometry; if (g?.dispose) g.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x: any) => x.dispose?.());
      else m?.dispose?.();
    });
  }

  // --- per-frame ---------------------------------------------------------

  update(ctx: AnchorContext): void {
    if (!ctx.playing) return;
    this.wallTime += ctx.wallDt;
    this.state.t += ctx.wallDt;

    if (this.state.phase === 'inspiral') {
      // r(t) follows Peters-Mathews leading-order:
      //   da/dt ∝ -1/a³  →  a(t) ∝ (t_merge - t)^{1/4}.
      // We normalise so a(0)=R_START and a(INSPIRAL_DUR)=R_FINAL.
      const u = Math.min(1, this.state.t / INSPIRAL_DUR);
      const r = R_START * Math.pow(1 - u, 0.25) + R_FINAL * Math.pow(u, 0.25);
      // Orbital angular speed Ω from Kepler-ish r-1.5 (visual only).
      // Faster at small r — last few cycles look frantic, like real GW.
      const Omega = 1.4 * Math.pow(R_START / Math.max(r, 0.3), 1.5);
      // Integrate phase
      const phase = this.state.t * 1.4 + this.cumulativeOmega(u, Omega);

      const xA =  r * 0.5 * Math.cos(phase);
      const zA =  r * 0.5 * Math.sin(phase);
      const xB = -r * 0.5 * Math.cos(phase);
      const zB = -r * 0.5 * Math.sin(phase);
      this.bhA.position.set(xA, 0, zA);
      this.bhB.position.set(xB, 0, zB);
      this.bhA.tick(this.wallTime);
      this.bhB.tick(this.wallTime);
      this.bhA.syncQField(this.bhA.position, this.camera.position);
      this.bhB.syncQField(this.bhB.position, this.camera.position);

      // Cross-drain: each BH's q-shell sees the other's mass drain its
      // local capacity — paper N²=q lapse made visible by ring-dimming
      // as the pair approaches merger.
      const sep = this.bhA.position.distanceTo(this.bhB.position);
      const drain = Math.min(0.9, 0.15 / Math.max(sep, 0.4));
      this.bhA.setLocalQ(1 - drain);
      this.bhB.setLocalQ(1 - drain);

      // Trigger merger
      if (this.state.t >= INSPIRAL_DUR) {
        this.triggerMerger();
      }
    } else if (this.state.phase === 'merged') {
      if (this.merged) {
        this.merged.tick(this.wallTime);
        this.merged.syncQField(this.merged.position, this.camera.position);
      }
      this.telegrapher.update(ctx.wallDt);
      if (this.state.t >= RINGDOWN_DUR) {
        this.state = { phase: 'idle', t: 0 };
      }
    } else if (this.state.phase === 'idle') {
      this.telegrapher.update(ctx.wallDt);
      if (this.state.t >= RESTART_GAP) {
        this.restart();
      }
    }
  }

  // Phase accumulator helper — keeps the orbital phase progressing
  // smoothly even as Ω(r) speeds up. We bake in a closed-form integral
  // for r ∝ (1-u)^{1/4}: phase(u) = ∫₀ᵘ Ω(r(s)) ds (approx).
  private cumulativeOmega(u: number, currentOmega: number): number {
    // Crude trapezoid over 12 samples — runs once per frame, cheap.
    const N = 12;
    let sum = 0;
    for (let i = 1; i <= N; i++) {
      const s = (i / N) * u;
      const r = R_START * Math.pow(1 - s, 0.25) + R_FINAL * Math.pow(s, 0.25);
      const om = 1.4 * Math.pow(R_START / Math.max(r, 0.3), 1.5);
      sum += om * (INSPIRAL_DUR / N);
    }
    void currentOmega;   // referenced for symmetry; integral above wins
    return sum;
  }

  private triggerMerger() {
    // Remove progenitors
    this.scene.remove(this.bhA);
    this.scene.remove(this.bhB);
    // Spawn merged BH at origin (centre of mass for equal-mass progenitors)
    this.merged = new BlackHole({
      radius: BH_RADIUS_FINAL,
      diskInner: 2.8, diskOuter: 6.8,
      diskTilt: 0.55,
      hot:  new THREE.Color('#fff4d8'),
      mid:  new THREE.Color('#ffaa55'),
      cool: new THREE.Color('#9b8dff')  // blend of the two progenitor cools
    });
    this.merged.position.set(0, 0, 0);
    this.scene.add(this.merged);
    // Emit the ringdown shell at lattice-c (paper's substrate-GW analogue).
    // Amplitude 1.6 = strong, propagates outward over ~RINGDOWN_DUR seconds.
    this.telegrapher.emit(new THREE.Vector3(0, 0, 0), 20, 1.6);
    this.state = { phase: 'merged', t: 0 };
  }

  // Lens sources so the lensing shader bends light around the BHs during
  // the demo. Two during inspiral, one after merger.
  lensSources(): { worldPos: THREE.Vector3; radius: number }[] {
    const cam = this.camera.position;
    const out: { worldPos: THREE.Vector3; radius: number }[] = [];
    const lensFor = (bh: BlackHole) => {
      const dist = bh.position.distanceTo(cam) + 1e-3;
      const ndcR = Math.min(0.07, 7 * 0.04 / dist);
      if (ndcR > 0.005) out.push({ worldPos: bh.position, radius: ndcR });
    };
    if (this.state.phase === 'inspiral') {
      lensFor(this.bhA);
      lensFor(this.bhB);
    } else if (this.merged) {
      lensFor(this.merged);
    }
    return out;
  }
}
