// SUBSTRATE: tetrahedral lattice (schematic), draggable defects.
// q-field recomputed live → wireframe edges recolor → pile defects → q→0 → mini black hole.

import * as THREE from 'three';
import { Regime, RegimeContext, DragTarget, HoverInfo } from './Regime';
import { mulberry32 } from '../core/Rng';
import { hashStr } from '../util/hash';
import { qField, gradAccelQ, Defect } from '../core/Gravity';
import { radialGlow } from '../render/Glow';
import { TET_MICROSTATES, G_SHARE_EFF } from '../util/units';
import { TelegrapherField } from '../render/Telegrapher';
import { formatSI } from '../core/Closure';

const N_TET   = 220;        // tetrahedra to render
const LATTICE_R = 14;
const N_DEFECTS = 3;

interface Tetra {
  center: THREE.Vector3;
  q: number;
}

export class SubstrateRegime extends Regime {
  private tetras: Tetra[] = [];
  private defects: Defect[] = [];
  private defectMeshes: THREE.Sprite[] = [];
  private edgeGeom: THREE.BufferGeometry;
  private edgePositions: Float32Array;
  private edgeColors: Float32Array;
  private edgeLines: THREE.LineSegments;
  private nVerts = 0;
  private time = 0;
  private vertOffsets: Float32Array;  // per-tet vertex offsets from center (12 verts × 3 floats)
  private edgePairs: [number, number][];  // edges of a tetrahedron in vertex-index pairs
  private defectVels: [number, number, number][] = [];
  // propSpeed 0.5 scene-units/sim-sec means at "Quantum" preset (fs/s slow-mo)
  // the ripple takes ~30 wall-sec to cross the lattice — exactly the regime
  // where finite-c substrate transport is meant to be visible.
  private telegrapher = new TelegrapherField(0.5, new THREE.Color(0xa0e0ff));

  constructor(aspect: number, seed: number) {
    super(aspect);
    this.camera.position.set(0, 4, LATTICE_R * 1.5);
    this.camera.lookAt(0, 0, 0);

    const rng = mulberry32(hashStr(`substrate|${seed}`));

    // Build a jittered cubic lattice of tetrahedron centers
    const step = 2.2;
    const ext = Math.ceil(Math.pow(N_TET, 1 / 3) / 2);
    for (let i = -ext; i <= ext && this.tetras.length < N_TET; i++) {
      for (let j = -ext; j <= ext && this.tetras.length < N_TET; j++) {
        for (let k = -ext; k <= ext && this.tetras.length < N_TET; k++) {
          const x = i * step + (rng() - 0.5) * 0.6;
          const y = j * step + (rng() - 0.5) * 0.6;
          const z = k * step + (rng() - 0.5) * 0.6;
          if (Math.sqrt(x * x + y * y + z * z) > LATTICE_R) continue;
          this.tetras.push({ center: new THREE.Vector3(x, y, z), q: 1 });
        }
      }
    }

    // Regular tetrahedron vertices (size ~0.7)
    const SZ = 0.72;
    const v0 = new THREE.Vector3( 1,  1,  1);
    const v1 = new THREE.Vector3(-1, -1,  1);
    const v2 = new THREE.Vector3(-1,  1, -1);
    const v3 = new THREE.Vector3( 1, -1, -1);
    const verts = [v0, v1, v2, v3].map(v => v.normalize().multiplyScalar(SZ));
    this.edgePairs = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];

    // Each tet has 4 verts (12 floats) and 6 edges (12 indices)
    this.vertOffsets = new Float32Array(this.tetras.length * 4 * 3);
    for (let t = 0; t < this.tetras.length; t++) {
      // Per-tet random rotation for visual variety
      const rotAxis = new THREE.Vector3(rng()-.5, rng()-.5, rng()-.5).normalize();
      const rotAng  = rng() * Math.PI * 2;
      const q = new THREE.Quaternion().setFromAxisAngle(rotAxis, rotAng);
      for (let v = 0; v < 4; v++) {
        const p = verts[v].clone().applyQuaternion(q);
        this.vertOffsets[(t * 4 + v) * 3 + 0] = p.x;
        this.vertOffsets[(t * 4 + v) * 3 + 1] = p.y;
        this.vertOffsets[(t * 4 + v) * 3 + 2] = p.z;
      }
    }

    // Edge buffer: each tet × 6 edges × 2 endpoints × 3 floats
    this.nVerts = this.tetras.length * 6 * 2;
    this.edgePositions = new Float32Array(this.nVerts * 3);
    this.edgeColors    = new Float32Array(this.nVerts * 3);
    this.edgeGeom = new THREE.BufferGeometry();
    this.edgeGeom.setAttribute('position', new THREE.BufferAttribute(this.edgePositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.edgeGeom.setAttribute('color',    new THREE.BufferAttribute(this.edgeColors, 3).setUsage(THREE.DynamicDrawUsage));
    const edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.edgeLines = new THREE.LineSegments(this.edgeGeom, edgeMat);
    this.scene.add(this.edgeLines);
    this.scene.add(this.telegrapher.group);

    // Defects
    const defectTex = radialGlow(256, '#ffffff', '#ffb070', 'rgba(255,80,40,0)');
    for (let i = 0; i < N_DEFECTS; i++) {
      const ang = (i / N_DEFECTS) * Math.PI * 2 + rng() * 0.3;
      const r   = 5 + rng() * 2;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const y = (rng() - 0.5) * 1.0;
      const defect: Defect = { id: `defect-${i}`, pos: [x, y, z], rS: 1.4 + rng() * 0.4 };
      this.defects.push(defect);
      this.defectVels.push([0, 0, 0]);

      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: defectTex,
        color: 0xffd9a8,
        blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true
      }));
      s.scale.setScalar(2.6);
      s.position.set(x, y, z);
      s.userData = { type: 'defect', index: i };
      this.scene.add(s);
      this.draggable.add(s);
      this.defectMeshes.push(s);
    }
  }

  update(ctx: RegimeContext, dt: number): void {
    // dt is sim seconds. At default fast-forward this is huge; clamp so the
    // defect integration stays stable. Slower speeds → smaller dt → genuine
    // slow-mo of substrate dynamics.
    const dtClamp = Math.min(0.05, Math.abs(dt)) * Math.sign(dt || 1);
    this.time += dtClamp;
    for (let i = 0; i < this.defects.length; i++) {
      const d = this.defects[i];
      if ((d as any).fixed) continue;
      // skip self in field
      const others = this.defects.filter((_, j) => j !== i);
      const a = gradAccelQ(d.pos[0], d.pos[1], d.pos[2], others, 1.5);
      this.defectVels[i][0] += dtClamp * a[0] - 0.4 * dtClamp * this.defectVels[i][0];
      this.defectVels[i][1] += dtClamp * a[1] - 0.4 * dtClamp * this.defectVels[i][1];
      this.defectVels[i][2] += dtClamp * a[2] - 0.4 * dtClamp * this.defectVels[i][2];
      d.pos[0] += dtClamp * this.defectVels[i][0];
      d.pos[1] += dtClamp * this.defectVels[i][1];
      d.pos[2] += dtClamp * this.defectVels[i][2];
      this.defectMeshes[i].position.set(d.pos[0], d.pos[1], d.pos[2]);
    }

    // Defect glow: saturation q→0 = mini-BH. Smaller q → hotter Hawking glow
    // (T_H ∝ 1/M; here we map "1/q-deficit" as a stand-in for inverse horizon mass).
    // Pulse amplitude breathes on wall-time so it never freezes.
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 3.0);
    for (let i = 0; i < this.defects.length; i++) {
      const d = this.defects[i];
      const others = this.defects.filter((_, j) => j !== i);
      const localQ = qField(d.pos[0], d.pos[1], d.pos[2], others);
      const mat = this.defectMeshes[i].material as THREE.SpriteMaterial;
      if (localQ < 0.05) {
        // Hawking-hot: hotter (whiter) as q → 0
        const hot = 1 - localQ * 20;  // 0..1
        mat.color.setRGB(1.0, 0.30 + 0.55 * hot, 0.18 + 0.55 * hot);
        this.defectMeshes[i].scale.setScalar(0.9 + 0.6 * hot * pulse);
      } else {
        mat.color.setRGB(1.0, 0.82, 0.62);
        this.defectMeshes[i].scale.setScalar(1.0);
      }
    }

    // Recompute edge positions + colors using current q field
    const cool = new THREE.Color(0x6090c0); // q=1 (vacuum)
    const warm = new THREE.Color(0xff9050); // mid depletion
    const hot  = new THREE.Color(0xff3030); // q→0 (saturated)
    let pi = 0, ci = 0;
    for (let t = 0; t < this.tetras.length; t++) {
      const center = this.tetras[t].center;
      // sample q at each vertex
      const verts: [number, number, number, number][] = []; // x, y, z, q
      for (let v = 0; v < 4; v++) {
        const vx = center.x + this.vertOffsets[(t * 4 + v) * 3 + 0];
        const vy = center.y + this.vertOffsets[(t * 4 + v) * 3 + 1];
        const vz = center.z + this.vertOffsets[(t * 4 + v) * 3 + 2];
        const q = qField(vx, vy, vz, this.defects);
        verts.push([vx, vy, vz, q]);
      }
      for (const [a, b] of this.edgePairs) {
        const va = verts[a], vb = verts[b];
        this.edgePositions[pi++] = va[0]; this.edgePositions[pi++] = va[1]; this.edgePositions[pi++] = va[2];
        this.edgePositions[pi++] = vb[0]; this.edgePositions[pi++] = vb[1]; this.edgePositions[pi++] = vb[2];
        for (const v of [va, vb]) {
          const q = v[3];
          let col: THREE.Color;
          if (q > 0.6) col = cool.clone().lerp(warm, (1 - q) / 0.4);
          else         col = warm.clone().lerp(hot, (0.6 - q) / 0.6);
          const intensity = ctx.entanglementOn ? (1.3 - 0.5 * q) : 0.7;
          this.edgeColors[ci++] = col.r * intensity;
          this.edgeColors[ci++] = col.g * intensity;
          this.edgeColors[ci++] = col.b * intensity;
        }
      }
    }
    (this.edgeGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.edgeGeom.attributes.color    as THREE.BufferAttribute).needsUpdate = true;

    // Slow camera orbit
    const phi = this.time * 0.04;
    this.camera.position.set(Math.sin(phi) * LATTICE_R * 1.4, 4, Math.cos(phi) * LATTICE_R * 1.4);
    this.camera.lookAt(0, 0, 0);

    this.telegrapher.update(dtClamp);
  }

  bloomStrength(_ctx: RegimeContext): number { return 0.7; }

  pick(intersection: THREE.Intersection): DragTarget | null {
    const obj = intersection.object;
    const ud = obj.userData;
    if (ud?.type !== 'defect') return null;
    const idx = ud.index as number;
    const d = this.defects[idx];
    return {
      id: d.id,
      object: obj,
      worldPos: new THREE.Vector3().copy(obj.position),
      onDragMove: (p) => {
        d.pos[0] = p.x; d.pos[1] = p.y; d.pos[2] = p.z;
        (d as any).fixed = true;
        this.defectVels[idx][0] = 0;
        this.defectVels[idx][1] = 0;
        this.defectVels[idx][2] = 0;
      },
      onDragEnd: (v) => {
        (d as any).fixed = false;
        this.defectVels[idx][0] = v.x;
        this.defectVels[idx][1] = v.y;
        this.defectVels[idx][2] = v.z;
        // Moving a defect launches a substrate ripple. Per §17 of the paper
        // this propagates at c. Visible at "Quantum"-preset slow-mo.
        this.telegrapher.emit(
          new THREE.Vector3(d.pos[0], d.pos[1], d.pos[2]),
          LATTICE_R * 1.4, 1.0
        );
      }
    };
  }

  hudExtras(): string {
    return `tetra · 4 faces × 7 states · Ω=${TET_MICROSTATES} · g_share≈${G_SHARE_EFF}`;
  }

  hoverInfo(intersection: THREE.Intersection): HoverInfo | null {
    const ud = intersection.object.userData;
    if (ud?.type !== 'defect') return null;
    const idx = ud.index as number;
    const d   = this.defects[idx];
    // q sampled at this defect's center, excluding self
    const others = this.defects.filter((_, j) => j !== idx);
    const q     = qField(d.pos[0], d.pos[1], d.pos[2], others);
    const saturated = q < 0.05;
    const rows = [
      { k: 'q (capacity)', v: q.toFixed(3) + (saturated ? ' · saturated' : '') },
      { k: 'Ω_tet',        v: TET_MICROSTATES.toLocaleString() },
      { k: '4 faces ×',    v: '7 states' },
      { k: 'j₀',           v: '3/2 (fermionic)' },
      { k: 'g_share,eff',  v: G_SHARE_EFF.toFixed(4) },
      { k: 'L* (substrate)', v: formatSI(1.60771947e-35, 'm', 2) },
    ];
    return {
      title: saturated ? 'Defect · q→0 saturated (mini-BH)' : 'Defect · one-bit fermion anchor',
      rows,
      note: saturated
        ? 'No remaining capacity. Same lapse rule N² = q as the galactic BH — two scales, one mechanism.'
        : 'ΔS = ln 2 per defect (paper §13). Drag through another defect → q→0 → mini-BH forms.'
    };
  }
}
