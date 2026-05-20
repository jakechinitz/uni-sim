// Anchor: Cosmological Activation Story.
//
// Paper context: §18. The homogeneous mode of the entanglement scalar
// is *dormant in radiation domination* (T^μ_μ = 0, no trace source).
// It activates as the universe transitions to matter-domination near
// z ≈ 3000, producing a transient early-dark-energy pulse that shifts
// the sound-horizon-inferred Hubble constant in the right direction.
// The mode then dilutes through the dark ages.
//
// Visualization: a 3D "history rail" running left → right along the
// X axis. Each cosmic epoch is a labeled ring; the χ-trace amplitude
// plotted as a vertical excursion above the rail. A playhead sweeps
// through cosmic time, lighting up each epoch as it passes. The
// dormant radiation era reads as a flat baseline, the EDE pulse as a
// dramatic spike at matter-rad equality, then a slow exponential
// decay through the dark ages.

import * as THREE from 'three';
import { Anchor, AnchorContext } from './Anchor';
import { traceChi, edePulse } from '../core/Cosmology';
import { radialGlow } from '../render/Glow';

// 8 paper-labelled epochs along the rail, log-spaced in cosmic time.
const EPOCHS: { tGyr: number; label: string }[] = [
  { tGyr: 1e-9,   label: 'Big Bang' },
  { tGyr: 1e-6,   label: 'Inflation end' },
  { tGyr: 1e-5,   label: 'Radiation era' },
  { tGyr: 5e-5,   label: 'Matter-rad equality · EDE pulse' },
  { tGyr: 3.8e-4, label: 'Recombination' },
  { tGyr: 0.15,   label: 'First stars' },
  { tGyr: 1.0,    label: 'Galaxies' },
  { tGyr: 13.8,   label: 'Today' }
];

const RAIL_LEN     = 22;        // sim units (the rail spans -RAIL_LEN/2 .. +RAIL_LEN/2 on X)
const SWEEP_DUR    = 25;        // wall-seconds for a full playhead pass
const TRACE_PTS    = 240;       // resolution of the χ-trace plot curve

export class CosmologicalActivationAnchor extends Anchor {
  private rail: THREE.Mesh;
  private epochRings: { ring: THREE.Mesh; tGyr: number; xpos: number }[] = [];
  private epochLabels: THREE.Sprite[] = [];
  private chiCurve: THREE.Line;
  private edeCurve: THREE.Line;
  private playhead: THREE.Group;
  private playheadPulse: THREE.Sprite;
  private wallTime = 0;

  constructor(aspect: number) {
    super({
      id: 'cosmological-activation',
      title: 'Cosmological activation · Hubble tension',
      paperRef: '§18',
      blurb:
        'A 3D history rail of cosmic epochs. The trace-coupled scalar χ ' +
        'is dormant during radiation (T^μ_μ = 0), spikes at matter-rad ' +
        'equality (paper §18 EDE pulse), then dilutes through the dark ' +
        'ages. The playhead sweeps cosmic time on a log scale; watch the ' +
        'χ curve light up exactly at the equality crossing.',
      tier: 2
    }, aspect);

    this.camera.position.set(0, 7, 18);
    this.camera.lookAt(0, 2, 0);

    this.rail = this.buildRail();
    this.scene.add(this.rail);
    this.buildEpochRings();
    this.buildEpochLabels();
    this.chiCurve = this.buildTraceCurve('chi', 0xa060ff, 0.95);
    this.edeCurve = this.buildTraceCurve('ede', 0xffa050, 0.85);
    this.scene.add(this.chiCurve);
    this.scene.add(this.edeCurve);
    this.playhead = this.buildPlayhead();
    this.playheadPulse = this.buildPlayheadPulse();
    this.scene.add(this.playhead);
    this.scene.add(this.playheadPulse);
    this.buildStarBackdrop();
  }

  // --- construction helpers ----------------------------------------------

  // Map cosmic time t (in Gyr, log-scaled) to X position on the rail.
  // Range: 1e-9 Gyr → -RAIL_LEN/2; 13.8 Gyr → +RAIL_LEN/2.
  private tToX(tGyr: number): number {
    const lt = Math.log10(Math.max(tGyr, 1e-12));
    const ltMin = Math.log10(1e-9), ltMax = Math.log10(13.8);
    const u = (lt - ltMin) / (ltMax - ltMin);
    return -RAIL_LEN / 2 + u * RAIL_LEN;
  }

  private buildRail(): THREE.Mesh {
    // Thin glowing horizontal bar at y=0 representing the time axis.
    const g = new THREE.BoxGeometry(RAIL_LEN, 0.06, 0.06);
    const m = new THREE.MeshBasicMaterial({
      color: 0x445e88, transparent: true, opacity: 0.65
    });
    return new THREE.Mesh(g, m);
  }

  private buildEpochRings() {
    const ringTex = radialGlow(128, 'rgba(255,255,255,0)', 'rgba(180,200,255,0.85)', 'rgba(122,160,255,0)');
    for (const e of EPOCHS) {
      const xpos = this.tToX(e.tGyr);
      // Small disc that sits on the rail at the epoch's time
      const g = new THREE.RingGeometry(0.20, 0.45, 28);
      const m = new THREE.MeshBasicMaterial({
        color: 0x8ec0ff, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
      });
      const ring = new THREE.Mesh(g, m);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(xpos, 0, 0);
      this.scene.add(ring);
      this.epochRings.push({ ring, tGyr: e.tGyr, xpos });
      // A faint additive sprite under each ring for soft glow
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ringTex, color: 0x8ec0ff,
        blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.4
      }));
      sp.scale.setScalar(0.7);
      sp.position.set(xpos, 0, 0);
      this.scene.add(sp);
    }
  }

  private buildEpochLabels() {
    for (const e of EPOCHS) {
      const xpos = this.tToX(e.tGyr);
      this.epochLabels.push(this.makeTextSprite(e.label, xpos));
    }
  }

  // Quick canvas-to-sprite text label. Lightweight; no Three's Text.
  private makeTextSprite(text: string, xpos: number): THREE.Sprite {
    const cvs = document.createElement('canvas');
    cvs.width = 512; cvs.height = 64;
    const ctx = cvs.getContext('2d')!;
    ctx.font = 'bold 22px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(220, 230, 255, 0.92)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 32);
    const tex = new THREE.CanvasTexture(cvs);
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false
    }));
    sp.scale.set(4.8, 0.6, 1);
    sp.position.set(xpos, -1.0, 0);
    this.scene.add(sp);
    return sp;
  }

  // The χ-trace plot or the EDE pulse plot, sampled across the rail.
  // ymax scales the vertical excursion (in sim units) per unit amplitude.
  private buildTraceCurve(kind: 'chi' | 'ede', color: number, opacity: number): THREE.Line {
    const pts = new Float32Array(TRACE_PTS * 3);
    for (let i = 0; i < TRACE_PTS; i++) {
      const u = i / (TRACE_PTS - 1);
      const ltMin = Math.log10(1e-9), ltMax = Math.log10(13.8);
      const lt = ltMin + u * (ltMax - ltMin);
      const tGyr = Math.pow(10, lt);
      const v = kind === 'chi' ? traceChi(tGyr) : edePulse(tGyr);
      const x = -RAIL_LEN/2 + u * RAIL_LEN;
      const y = 0.2 + v * 4.5;     // sit slightly above the rail
      pts[i*3+0] = x; pts[i*3+1] = y; pts[i*3+2] = 0;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({
      color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    return new THREE.Line(g, m);
  }

  private buildPlayhead(): THREE.Group {
    // Vertical stroke that slides along the rail. Made of a thin tall
    // box + a small disc on the rail line itself.
    const g = new THREE.Group();
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 5.4, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x7ad7ff, transparent: true, opacity: 0.7 })
    );
    bar.position.y = 2.7;
    g.add(bar);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x7ad7ff })
    );
    g.add(dot);
    g.position.x = -RAIL_LEN / 2;
    return g;
  }

  private buildPlayheadPulse(): THREE.Sprite {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlow(128, '#ffffff', '#7ad7ff', 'rgba(60,150,255,0)'),
      color: 0x7ad7ff, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0
    }));
    sp.scale.setScalar(2.0);
    return sp;
  }

  private buildStarBackdrop() {
    const N = 250;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = 40 + Math.random() * 35;
      positions[i*3+0] = R * s * Math.cos(t);
      positions[i*3+1] = R * u;
      positions[i*3+2] = R * s * Math.sin(t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({
      size: 0.25, sizeAttenuation: true,
      color: 0xccddff, transparent: true, opacity: 0.45,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.scene.add(new THREE.Points(g, m));
  }

  // --- lifecycle ---------------------------------------------------------

  restart() { this.wallTime = 0; }

  // --- per-frame ---------------------------------------------------------

  update(ctx: AnchorContext): void {
    if (!ctx.playing) return;
    this.wallTime = (this.wallTime + ctx.wallDt) % SWEEP_DUR;
    const u = this.wallTime / SWEEP_DUR;            // 0..1 along the rail
    const x = -RAIL_LEN/2 + u * RAIL_LEN;
    this.playhead.position.x = x;
    this.playheadPulse.position.x = x;

    // Convert playhead position back to cosmic time so we can read the
    // current χ amplitude — drives the pulse glow.
    const ltMin = Math.log10(1e-9), ltMax = Math.log10(13.8);
    const lt = ltMin + u * (ltMax - ltMin);
    const tGyr = Math.pow(10, lt);
    const chi = traceChi(tGyr);
    const ede = edePulse(tGyr);

    // Playhead pulse brightness tracks the EDE amplitude — really lights
    // up at matter-rad equality.
    (this.playheadPulse.material as THREE.SpriteMaterial).opacity = 0.25 + 0.75 * ede;
    this.playheadPulse.position.y = 0.2 + ede * 4.5;
    this.playheadPulse.scale.setScalar(1.5 + 2.5 * ede);

    // Epoch rings: brighter when the playhead is nearby.
    for (const er of this.epochRings) {
      const d = Math.abs(er.xpos - x);
      const near = Math.max(0, 1 - d / 1.2);
      const m = er.ring.material as THREE.MeshBasicMaterial;
      m.opacity = 0.35 + 0.55 * near;
    }

    // tag a no-op to silence "unused chi" lint warnings — chi is used
    // indirectly via the curve; we keep the variable for future use.
    void chi;
  }
}
