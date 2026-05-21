// Anchor: Substrate Causal Response.
//
// Paper context: §11 (gravity as substrate relaxation around defects),
// §17 (telegrapher PDE τ₀∂_tΠ = -D∇q - Π, ∂_tq = -∇·Π, with D/τ₀ = c²
// guaranteeing causal propagation at exactly the lattice speed of light).
//
// What the user sees:
//   * Empty vacuum (q ≈ 1 everywhere — no visible cloud).
//   * After a 1-second beat, a single defect is dropped at the centre.
//   * The capacity drain at that cell sources an outgoing spherical
//     wavefront in q + Π. The front propagates at lattice-c, leaving
//     behind a settling static well that approaches the paper's
//     weak-field profile q(r) = 1 - r_s/r.
//
// This is THE most under-visualized thing the paper actually claims:
// gravity is a *responsive medium*, not a static formula. The PDE
// engine (SubstrateSim) is the exact one used in SUBSTRATE zoom in
// the main sim — but here we strip away all the user-defect clutter
// so the wavefront is the only thing to look at.

import * as THREE from 'three';
import { Anchor, AnchorContext } from './Anchor';
import { SubstrateSim } from '../core/SubstrateSim';
import { radialGlow } from '../render/Glow';

const N_GRID    = 24;          // 24³ = 13,824 cells. Slightly denser than the
                               //  main SUBSTRATE regime so the wavefront reads
                               //  as a smooth sphere rather than discrete cubes.
const SPACE_R   = 14;          // Half-extent in sim units. Cube spans ±14.
const DROP_AT_S = 1.0;         // Wall-seconds to wait before dropping the defect.

export class SubstrateResponseAnchor extends Anchor {
  private sim: SubstrateSim;
  private cellSize: number;
  private cloudMesh!: THREE.InstancedMesh;
  private cloudDummy = new THREE.Object3D();
  private defectGlyph!: THREE.Sprite;
  private wallTime = 0;
  private defectDropped = false;

  constructor(aspect: number) {
    super({
      id: 'substrate-response',
      title: 'Substrate causal response',
      paperRef: '§11, §17',
      blurb:
        'Telegrapher PDE on a 24³ grid. Drop a defect; the capacity ' +
        'wave propagates outward at lattice-c and settles to the static ' +
        'weak-field profile.',
      tier: 1
    }, aspect);

    this.camera.position.set(SPACE_R * 0.6, SPACE_R * 0.45, SPACE_R * 1.4);
    this.camera.lookAt(0, 0, 0);

    this.sim = new SubstrateSim(N_GRID);
    this.cellSize = (2 * SPACE_R) / N_GRID;

    this.buildCloud();
    this.buildScaffold();
    this.buildDefectGlyph();
  }

  // --- construction helpers ----------------------------------------------

  private buildCloud() {
    // Instanced billboard sprites — one per lattice cell. Each frame we
    // assign matrix + color to the depleted cells (q < 0.95) and set
    // `count` so unused instances are not drawn.
    const V = N_GRID * N_GRID * N_GRID;
    const tex = radialGlow(64,
      'rgba(255,255,255,1)',
      'rgba(180,130,255,0.55)',
      'rgba(100,0,180,0)'
    );
    const geom = new THREE.PlaneGeometry(1, 1);
    const mat  = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, vertexColors: true
    });
    this.cloudMesh = new THREE.InstancedMesh(geom, mat, V);
    this.cloudMesh.frustumCulled = false;
    this.cloudMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(V * 3), 3);
    this.cloudMesh.count = 0;
    this.scene.add(this.cloudMesh);
  }

  private buildScaffold() {
    // A faint wireframe cube delimits the simulation volume so the
    // viewer reads the wavefront as moving through a finite lattice.
    const box = new THREE.Box3(
      new THREE.Vector3(-SPACE_R, -SPACE_R, -SPACE_R),
      new THREE.Vector3( SPACE_R,  SPACE_R,  SPACE_R)
    );
    const helper = new THREE.Box3Helper(box, new THREE.Color(0x2a3550));
    (helper.material as THREE.LineBasicMaterial).transparent = true;
    (helper.material as THREE.LineBasicMaterial).opacity     = 0.45;
    this.scene.add(helper);
    // Soft star backdrop so the lattice isn't floating in pure black —
    // adds scale cues without competing with the wavefront.
    const stars = this.buildStarBackdrop();
    this.scene.add(stars);
  }

  private buildStarBackdrop(): THREE.Points {
    const N = 400;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = SPACE_R * (4 + Math.random() * 3);
      positions[i * 3 + 0] = R * s * Math.cos(t);
      positions[i * 3 + 1] = R * u;
      positions[i * 3 + 2] = R * s * Math.sin(t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({
      size: 0.35, sizeAttenuation: true,
      color: 0xddddff, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    return new THREE.Points(g, m);
  }

  private buildDefectGlyph() {
    // Pulsing marker sprite at the defect position, only visible once
    // the defect has dropped. Tells the viewer "this is the source."
    const tex = radialGlow(128, '#ffffff', '#ffb070', 'rgba(255,80,40,0)');
    this.defectGlyph = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xffd9a8,
      blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true,
      opacity: 0
    }));
    this.defectGlyph.scale.setScalar(1.4);
    this.scene.add(this.defectGlyph);
  }

  // --- lifecycle ---------------------------------------------------------

  restart() {
    // Rebuild the PDE state cleanly. Cheap — typed arrays, no GPU resources.
    this.sim = new SubstrateSim(N_GRID);
    this.wallTime = 0;
    this.defectDropped = false;
    (this.defectGlyph.material as THREE.SpriteMaterial).opacity = 0;
    this.cloudMesh.count = 0;
    this.cloudMesh.instanceMatrix.needsUpdate = true;
  }

  // --- per-frame ---------------------------------------------------------

  update(ctx: AnchorContext): void {
    if (!ctx.playing) return;
    this.wallTime += ctx.wallDt;

    // Drop the defect once the user has had a beat to see the empty
    // vacuum baseline. drainRate 0.35 ≈ moderate well — fast enough to
    // generate a clean wavefront, slow enough to read the settle.
    if (!this.defectDropped && this.wallTime > DROP_AT_S) {
      // drainRate 0.8: stronger well so the wavefront has visible amplitude
      // as it leaves the source. The original 0.35 produced a real wave
      // but with q values just barely under the visibility threshold —
      // looked like "nothing was happening" past the immediate defect.
      this.sim.addDefect(N_GRID / 2, N_GRID / 2, N_GRID / 2, 0.8, 'src');
      this.defectDropped = true;
    }

    // PDE step. We pace it slower than wall-time so the wavefront is
    // visible — at full speed it crosses the lattice in a few frames.
    const engineDt = Math.min(0.06, ctx.wallDt * 2.5);
    this.sim.step(engineDt);

    // Update defect glyph: fade in, gentle pulse.
    if (this.defectDropped) {
      const mat = this.defectGlyph.material as THREE.SpriteMaterial;
      const pulse = 0.7 + 0.3 * Math.sin(this.wallTime * 3.0);
      mat.opacity = Math.min(1, (this.wallTime - DROP_AT_S) * 2) * pulse;
    }

    this.renderCloud();
  }

  // Walk the lattice and emit one instance per depleted cell.
  private renderCloud() {
    const N = N_GRID;
    const cInst = this.cloudMesh.instanceColor as THREE.InstancedBufferAttribute;
    const cArr  = cInst.array as Float32Array;
    const dim   = N * N * N;
    const halfN = N / 2;
    let cloudN = 0;

    for (let c = 0; c < dim; c++) {
      const q = this.sim.q[c];
      // Lowered visibility threshold from 0.94 to 0.985 so the propagating
      // wavefront (which is a small q dip far from the source) is visible
      // throughout its travel, not just near the saturated centre.
      if (q > 0.985) continue;
      const i = c % N;
      const j = ((c - i) / N) % N;
      const k = (c - i - j * N) / (N * N);
      const x = (i + 0.5 - halfN) * this.cellSize;
      const y = (j + 0.5 - halfN) * this.cellSize;
      const z = (k + 0.5 - halfN) * this.cellSize;
      const dep = 1 - q;                       // depletion magnitude in [0, 1]
      const hot = Math.max(0, 1 - q / 0.35);   // > 0 only near saturation

      this.cloudDummy.position.set(x, y, z);
      // Larger base scale so individual cells read as soft bubbles, not
      // sub-pixel specks. Depletion still modulates the size on top.
      this.cloudDummy.scale.setScalar(this.cellSize * (1.05 + 0.8 * dep));
      this.cloudDummy.updateMatrix();
      this.cloudMesh.setMatrixAt(cloudN, this.cloudDummy.matrix);

      // Colour map: cool violet at low depletion (wavefront), warming
      // through orange to hot red as q approaches saturation.
      cArr[cloudN * 3 + 0] = 0.40 + 0.55 * hot + 0.35 * dep;
      cArr[cloudN * 3 + 1] = Math.max(0, 0.30 + 0.35 * dep - 0.20 * hot);
      cArr[cloudN * 3 + 2] = Math.max(0, 0.55 + 0.45 * dep - 0.45 * hot);
      cloudN++;
    }
    this.cloudMesh.count = cloudN;
    this.cloudMesh.instanceMatrix.needsUpdate = true;
    cInst.needsUpdate = true;
  }
}
