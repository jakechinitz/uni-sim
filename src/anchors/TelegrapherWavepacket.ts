// Anchor: Telegrapher Wavepacket — dispersion-free propagation at c.
//
// Paper context: §17. The telegrapher PDE with D/τ₀ = c² admits coherent
// wavepacket solutions: a Gaussian bump in q paired with a matching Π
// translates rigidly through the lattice at exactly the speed of light,
// without spreading. This is the paper's guarantee that the substrate
// preserves causality and carries information at a finite, exact speed.
//
// Visualization:
//   * Empty vacuum (q = 1 everywhere).
//   * After a 1-second beat, a Gaussian wavepacket is emitted from one
//     side of the lattice, directed toward the opposite side.
//   * The packet moves coherently across the simulation volume. Its
//     spatial profile barely spreads — the small spreading visible is
//     numerical, not physical.
//   * Loops every ~15 wall-seconds with a fresh packet so the viewer
//     can re-watch the propagation.
//
// Pair with the "Substrate causal response" anchor: that one shows the
// field reacting to a NEW mass; this one shows the field carrying a
// pre-formed disturbance across space. Same engine (SubstrateSim,
// τ₀∂_tΠ = -D∇q - Π, ∂_tq = -∇·Π), different question.

import * as THREE from 'three';
import { Anchor, AnchorContext } from './Anchor';
import { SubstrateSim } from '../core/SubstrateSim';
import { radialGlow } from '../render/Glow';

const N_GRID    = 28;        // 28³ = ~22,000 cells. A bit denser than the
                             //  response anchor so the wavepacket reads
                             //  as smooth.
const SPACE_R   = 16;        // half-extent in sim units
const EMIT_AT_S = 1.0;       // wall-seconds to wait before first emission
const LOOP_DUR  = 15;        // wall-seconds before re-emitting

export class TelegrapherWavepacketAnchor extends Anchor {
  private sim: SubstrateSim;
  private cellSize: number;
  private cloudMesh!: THREE.InstancedMesh;
  private cloudDummy = new THREE.Object3D();
  private emitMarker!: THREE.Sprite;
  private wallTime = 0;
  // Wall-time at which the next packet should be emitted. Initialised
  // to the first-emit moment so the first packet fires at EMIT_AT_S
  // (the earlier "lastEmission = -1, fire when sinceLoop - last >= LOOP"
  // pattern incorrectly required sinceLoop ≥ LOOP_DUR for the first
  // emission — packet never appeared).
  private nextEmitAt = EMIT_AT_S;

  constructor(aspect: number) {
    super({
      id: 'telegrapher-wavepacket',
      title: 'Telegrapher wavepacket · dispersion-free at c',
      paperRef: '§17',
      blurb:
        'A Gaussian wavepacket in (q, Π) launched across an empty 28³ ' +
        "lattice. The paper's D/τ₀ = c² guarantees it propagates coherently " +
        'at exactly the speed of light with no spreading. Same telegrapher ' +
        'engine as the substrate-response anchor, different question: this ' +
        'one shows the substrate as a carrier, not a responder.',
      tier: 1
    }, aspect);

    this.camera.position.set(SPACE_R * 0.6, SPACE_R * 0.4, SPACE_R * 1.5);
    this.camera.lookAt(0, 0, 0);

    this.sim = new SubstrateSim(N_GRID);
    this.cellSize = (2 * SPACE_R) / N_GRID;

    this.buildCloud();
    this.buildScaffold();
    this.buildEmitMarker();
  }

  // --- construction ------------------------------------------------------

  private buildCloud() {
    const V = N_GRID * N_GRID * N_GRID;
    const tex = radialGlow(64,
      'rgba(255,255,255,1)',
      'rgba(150,200,255,0.65)',
      'rgba(60,120,220,0)'
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
    const box = new THREE.Box3(
      new THREE.Vector3(-SPACE_R, -SPACE_R, -SPACE_R),
      new THREE.Vector3( SPACE_R,  SPACE_R,  SPACE_R)
    );
    const helper = new THREE.Box3Helper(box, new THREE.Color(0x2a3550));
    (helper.material as THREE.LineBasicMaterial).transparent = true;
    (helper.material as THREE.LineBasicMaterial).opacity     = 0.45;
    this.scene.add(helper);
    // An arrow at the emission point indicating the propagation direction.
    // Built statically; the wavepacket reuses this direction every loop.
    const arrowDir = new THREE.Vector3(1, 0, 0);
    const arrowOrigin = new THREE.Vector3(-SPACE_R * 0.85, 0, 0);
    const arrow = new THREE.ArrowHelper(arrowDir, arrowOrigin, 3.5, 0x7ad7ff, 0.9, 0.45);
    (arrow.line.material as THREE.LineBasicMaterial).transparent = true;
    (arrow.line.material as THREE.LineBasicMaterial).opacity     = 0.7;
    this.scene.add(arrow);
    // Soft star backdrop.
    this.scene.add(this.buildStars());
  }

  private buildStars(): THREE.Points {
    const N = 350;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = SPACE_R * (4 + Math.random() * 3);
      positions[i*3+0] = R * s * Math.cos(t);
      positions[i*3+1] = R * u;
      positions[i*3+2] = R * s * Math.sin(t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({
      size: 0.32, sizeAttenuation: true,
      color: 0xccddff, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    return new THREE.Points(g, m);
  }

  private buildEmitMarker() {
    // A faint pulse at the emission point, fires when a new packet
    // is released so the viewer can see where it came from.
    const tex = radialGlow(128, '#ffffff', '#7ad7ff', 'rgba(60,150,255,0)');
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0x7ad7ff,
      blending: THREE.AdditiveBlending, depthWrite: false,
      transparent: true, opacity: 0
    }));
    sp.position.set(-SPACE_R * 0.85, 0, 0);
    sp.scale.setScalar(2.2);
    this.emitMarker = sp;
    this.scene.add(sp);
  }

  // --- lifecycle ---------------------------------------------------------

  restart() {
    this.sim = new SubstrateSim(N_GRID);
    this.wallTime = 0;
    this.nextEmitAt = EMIT_AT_S;
    this.cloudMesh.count = 0;
    this.cloudMesh.instanceMatrix.needsUpdate = true;
    (this.emitMarker.material as THREE.SpriteMaterial).opacity = 0;
  }

  // --- per-frame ---------------------------------------------------------

  update(ctx: AnchorContext): void {
    if (!ctx.playing) return;
    this.wallTime += ctx.wallDt;

    // Emit on the schedule: first packet at EMIT_AT_S, then every LOOP_DUR.
    if (this.wallTime >= this.nextEmitAt) {
      // Reset the lattice and emit a fresh wavepacket — visually cleaner
      // than letting old wavefronts pile up.
      this.sim = new SubstrateSim(N_GRID);
      // Emit from x = -85% of the lattice, moving in +X direction.
      // amp=0.45 → q drops to ~0.55 at the packet centre. sigma=2.5
      // cells ≈ packet width 5 cells; large enough to read at our
      // camera distance.
      const N = N_GRID;
      this.sim.emitPacket(
        N * 0.08, N / 2, N / 2,
        1, 0, 0,
        0.45, 2.5
      );
      this.nextEmitAt = this.wallTime + LOOP_DUR;
      // Flash the emit marker
      (this.emitMarker.material as THREE.SpriteMaterial).opacity = 1.0;
    }

    // Step the PDE. The engine clamps dt to its CFL ceiling internally;
    // we feed it a wall-paced engineDt so the wavepacket crawls visibly
    // (at native sim speed it crosses the lattice in ~3 wall-seconds).
    const engineDt = Math.min(0.06, ctx.wallDt * 2.0);
    this.sim.step(engineDt);

    // Decay the emit marker flash
    const m = this.emitMarker.material as THREE.SpriteMaterial;
    m.opacity = Math.max(0, m.opacity - ctx.wallDt * 1.2);

    this.renderCloud();
  }

  private renderCloud() {
    const N = N_GRID;
    const cInst = this.cloudMesh.instanceColor as THREE.InstancedBufferAttribute;
    const cArr  = cInst.array as Float32Array;
    const dim   = N * N * N;
    const halfN = N / 2;
    let cloudN = 0;

    for (let c = 0; c < dim; c++) {
      const q = this.sim.q[c];
      // Lower threshold so the wavepacket reads throughout its travel,
      // not just at its core.
      if (q > 0.985) continue;
      const i = c % N;
      const j = ((c - i) / N) % N;
      const k = (c - i - j * N) / (N * N);
      const x = (i + 0.5 - halfN) * this.cellSize;
      const y = (j + 0.5 - halfN) * this.cellSize;
      const z = (k + 0.5 - halfN) * this.cellSize;
      const dep = 1 - q;

      this.cloudDummy.position.set(x, y, z);
      this.cloudDummy.scale.setScalar(this.cellSize * (0.85 + 0.7 * dep));
      this.cloudDummy.updateMatrix();
      this.cloudMesh.setMatrixAt(cloudN, this.cloudDummy.matrix);
      // Colour: cool blue-violet at low depletion, warming as q drops.
      // Different palette from the response anchor so the two demos read
      // as distinct.
      cArr[cloudN * 3 + 0] = 0.30 + 0.50 * dep;
      cArr[cloudN * 3 + 1] = 0.55 + 0.20 * dep;
      cArr[cloudN * 3 + 2] = 0.85 + 0.15 * dep;
      cloudN++;
    }
    this.cloudMesh.count = cloudN;
    this.cloudMesh.instanceMatrix.needsUpdate = true;
    cInst.needsUpdate = true;
  }
}
