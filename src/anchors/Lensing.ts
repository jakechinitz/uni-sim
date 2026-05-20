// Anchor: Gravitational Lensing · No-Slip Consistency.
//
// Paper context: §15. The paper's scalar entanglement sector does not
// generate anisotropic stress at leading weak-field order, so the
// lensing potential Φ_lens = Ψ (the same potential that moves matter).
// This is "no-slip" lensing — same effective potential bends light AND
// drives orbits, so the theory is consistent at the Bullet-cluster /
// CLASH lensing-vs-dynamics level without per-system tuning.
//
// Visualization:
//   * A single SMBH at the centre.
//   * A flat grid of bright background sources (Einstein-ring lattice)
//     parked behind the BH.
//   * The Composer's screen-space lens pass deflects the rendered
//     pixels around the BH's projected position with radius scaling
//     as ≈ Schwarzschild apparent angular size. Same pass used by the
//     main galaxy regime; this anchor just isolates one BH so the
//     deflection ring is unambiguous.
//
// The user can slowly orbit the camera — the lensed grid pattern
// re-warps as the BH moves across the field of view.

import * as THREE from 'three';
import { Anchor, AnchorContext } from './Anchor';
import { BlackHole } from '../render/BlackHole';
import { radialGlow } from '../render/Glow';

const BH_RADIUS    = 0.45;      // sim units (visual BH radius)
const BG_DIST      = 25;        // distance from camera to background grid
const GRID_HALF    = 22;        // half-extent of source grid in sim units
const GRID_STEP    = 1.6;       // spacing between background sources

export class LensingAnchor extends Anchor {
  private bh: BlackHole;
  private bgGrid: THREE.Points;
  private wallTime = 0;

  constructor(aspect: number) {
    super({
      id: 'lensing-no-slip',
      title: 'Lensing · no-slip consistency',
      paperRef: '§15',
      blurb:
        'Paper §15: scalar entanglement sector has no anisotropic stress, ' +
        'so Φ_lens = Ψ — the same effective potential that drives orbits ' +
        'bends light. A single SMBH against a grid of background sources; ' +
        'the screen-space lens pass deflects pixels around the BH at the ' +
        'Schwarzschild apparent angular size. Drag to orbit the camera and ' +
        'watch the lensed pattern re-warp.',
      tier: 1
    }, aspect);

    this.camera.position.set(0, 0, 12);
    this.camera.lookAt(0, 0, -BG_DIST);

    this.bh = new BlackHole({
      radius: BH_RADIUS,
      diskInner: 2.6, diskOuter: 7.0,
      diskTilt: 0.65,
      hot:  new THREE.Color('#fff4d8'),
      mid:  new THREE.Color('#ffaa55'),
      cool: new THREE.Color('#7ad7ff')
    });
    this.bh.position.set(0, 0, 0);
    this.scene.add(this.bh);

    this.bgGrid = this.buildBackgroundGrid();
    this.scene.add(this.bgGrid);
    this.buildStarBackdrop();
  }

  private buildBackgroundGrid(): THREE.Points {
    // Regular 2D lattice of bright sources sitting on a plane behind the BH.
    // The grid topology makes the lensing deflection unambiguous to the eye —
    // straight rows curve into Einstein-ring-like arcs.
    const cols: number[] = [];
    const positions: number[] = [];
    for (let x = -GRID_HALF; x <= GRID_HALF; x += GRID_STEP) {
      for (let y = -GRID_HALF; y <= GRID_HALF; y += GRID_STEP) {
        positions.push(x, y, -BG_DIST);
        // Slight colour variation across the grid for visual interest
        const t = ((x + GRID_HALF) / (2 * GRID_HALF) + (y + GRID_HALF) / (2 * GRID_HALF)) * 0.5;
        const c = new THREE.Color().setHSL(0.55 + 0.15 * Math.sin(t * 8), 0.55, 0.7);
        cols.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(cols), 3));
    const m = new THREE.PointsMaterial({
      size: 0.34, sizeAttenuation: true, vertexColors: true,
      transparent: true, depthWrite: false, opacity: 0.95,
      blending: THREE.AdditiveBlending,
      map: radialGlow(64, '#ffffff', '#ffe0c0', 'rgba(0,0,0,0)')
    });
    return new THREE.Points(g, m);
  }

  private buildStarBackdrop() {
    // Deeper field behind the grid, randomly distributed so it doesn't
    // compete with the grid's lensed structure.
    const N = 400;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      positions[i*3+0] = (Math.random() - 0.5) * 80;
      positions[i*3+1] = (Math.random() - 0.5) * 80;
      positions[i*3+2] = -BG_DIST - 5 - Math.random() * 25;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({
      size: 0.18, sizeAttenuation: true,
      color: 0xccccff, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.scene.add(new THREE.Points(g, m));
  }

  // --- per-frame ---------------------------------------------------------

  update(ctx: AnchorContext): void {
    this.wallTime += ctx.wallDt;
    if (ctx.playing) {
      this.bh.tick(this.wallTime);
    }
    // The q-shell shader needs camera + BH centre each frame.
    this.bh.syncQField(this.bh.position, this.camera.position);
  }

  // Publish the BH as a lens source so the Composer's screen-space pass
  // deflects pixels around it. Radius scales with apparent angular size.
  lensSources(): { worldPos: THREE.Vector3; radius: number }[] {
    const dist = this.bh.position.distanceTo(this.camera.position) + 1e-3;
    // Lens radius in NDC, capped so a close BH doesn't warp the whole frame
    const rs = 0.0035 * Math.sqrt(120);    // visual-only scale factor
    const ndcR = Math.min(0.10, 9 * rs / dist);
    return [{ worldPos: this.bh.position, radius: ndcR }];
  }
}
