// SUBSTRATE: tetrahedral lattice (schematic), draggable defects.
// q-field recomputed live → wireframe edges recolor → pile defects → q→0 → mini black hole.

import * as THREE from 'three';
import { Regime, RegimeContext, DragTarget, HoverInfo } from './Regime';
import { mulberry32 } from '../core/Rng';
import { hashStr } from '../util/hash';
import { Defect } from '../core/Gravity';
import { radialGlow } from '../render/Glow';
import { TET_MICROSTATES, G_SHARE_EFF } from '../util/units';
import { TelegrapherField } from '../render/Telegrapher';
import { formatSI, cellScrambling } from '../core/Closure';
import { SubstrateSim, SimDefect, SUB_Q_SAT } from '../core/SubstrateSim';

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

  // Real substrate engine — telegrapher PDE + discrete defects on a 20³ grid.
  // The lattice IS the substrate; tetrahedra are visual scaffolding.
  // 16³ = 4,096 cells. Previous 20³ = 8,000 doubled the per-frame PDE
  // cost; 16³ keeps the q-cloud legible and the engine snappy.
  private sim = new SubstrateSim(16);
  private simDefects: SimDefect[] = [];
  // engine-cell → scene coords. Engine origin is at (N/2, N/2, N/2).
  private cellSize = 0;            // set after sim construction
  // q-cloud: instanced point sprites at every cell, opacity = (1-q)
  private cloudMesh!: THREE.InstancedMesh;
  private cloudDummy = new THREE.Object3D();
  private cloudColor = new THREE.Color();

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

    // Sim-to-scene mapping. The lattice spans 2·LATTICE_R = 28 scene units.
    this.cellSize = (2 * LATTICE_R) / this.sim.N;

    // q-cloud — additive sprite per lattice cell, alpha = depletion (1-q).
    // Cells at q ≈ 1 are invisible vacuum; depleted regions glow.
    const cloudTex = radialGlow(64, 'rgba(255,255,255,1)', 'rgba(200,150,255,0.6)', 'rgba(120,0,200,0)');
    const cloudGeom = new THREE.PlaneGeometry(1, 1);
    const cloudMat  = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true
    });
    const V = this.sim.N * this.sim.N * this.sim.N;
    this.cloudMesh = new THREE.InstancedMesh(cloudGeom, cloudMat, V);
    this.cloudMesh.frustumCulled = false;
    this.cloudMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(V * 3), 3);
    this.cloudMesh.count = 0;
    this.scene.add(this.cloudMesh);

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
      // Mirror into the engine
      const enginePos = this.sceneToEngine(x, y, z);
      this.simDefects.push(this.sim.addDefect(enginePos.ex, enginePos.ey, enginePos.ez, 0.5, defect.id));

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

  private sceneToEngine(x: number, y: number, z: number) {
    const N = this.sim.N;
    return {
      ex: x / this.cellSize + N / 2,
      ey: y / this.cellSize + N / 2,
      ez: z / this.cellSize + N / 2
    };
  }
  private engineToScene(ex: number, ey: number, ez: number) {
    const N = this.sim.N;
    return {
      x: (ex - N / 2) * this.cellSize,
      y: (ey - N / 2) * this.cellSize,
      z: (ez - N / 2) * this.cellSize
    };
  }
  // Sample q at a scene-space point using the engine's trilinear sampler.
  private qAt(x: number, y: number, z: number): number {
    const p = this.sceneToEngine(x, y, z);
    return this.sim.qAt(p.ex, p.ey, p.ez);
  }

  update(ctx: RegimeContext, dt: number): void {
    // dt is cosmic-sim seconds.
    //
    // LATTICE_PACE_SCALE is a viewer calibration, not a paper-derived ratio.
    // Justification:
    //   • Engine wave-speed in the lattice is 1 cell per CFL_DT = 0.4
    //     lattice-seconds (PDE-internal); the 20-cell lattice front-crosses
    //     in ~8 lattice-seconds.
    //   • At cosmic speed s, engineDt per frame = min(MAX, s·dtWall·G).
    //   • Pick G so the engine just slows below MAX at the "Quantum" preset
    //     (s = 10⁻¹⁵): solving s·dtWall·G ≈ MAX gives G ≈ MAX/(10⁻¹⁵·dtWall)
    //     ≈ 0.06/(10⁻¹⁵·0.016) ≈ 4×10¹⁵. We round to 10¹⁵ — at "Quantum" the
    //     engine is just below saturation, so fronts visibly crawl over a
    //     few wall-seconds. UX, not physics.
    //
    // The Vikram, Shou, Galitski (PRL 2026) lower bound t_scr ≳ βℏ/(2π)·ln(S)
    // is a rigorous FLOOR on scrambling time at any temperature; it does
    // not constrain this gain from above. We surface that bound on every
    // BH hover (and in `Closure.scrambling()`) where it IS rigorous.
    const LATTICE_PACE_SCALE = 1e15;
    const dtClamp = Math.min(0.05, Math.abs(dt)) * Math.sign(dt || 1);
    const engineDt = Math.min(0.06, Math.abs(dt) * LATTICE_PACE_SCALE) * Math.sign(dt || 1);
    this.time += Math.max(Math.abs(dtClamp), ctx.dtWall * 0.5);

    // Push current scene defect positions into the engine (so user drags are
    // felt by the lattice). Defects not being dragged read their position
    // back from the engine after step().
    for (let i = 0; i < this.defects.length; i++) {
      const d  = this.defects[i];
      const sd = this.simDefects[i];
      if ((d as any).fixed) {
        const p = this.sceneToEngine(d.pos[0], d.pos[1], d.pos[2]);
        sd.x = p.ex; sd.y = p.ey; sd.z = p.ez;
        sd.vx = sd.vy = sd.vz = 0;
        sd.fixed = true;
      } else {
        sd.fixed = false;
      }
    }

    // Real PDE step + slow vacuum recovery (engineDt is decoupled from cosmic
    // dt so the substrate stays animated except at extreme slow-mo)
    this.sim.step(engineDt);
    this.sim.relax(0.012, engineDt);

    // Sync defects back from the engine to the scene
    for (let i = 0; i < this.defects.length; i++) {
      const d  = this.defects[i];
      const sd = this.simDefects[i];
      if (!(d as any).fixed) {
        const s = this.engineToScene(sd.x, sd.y, sd.z);
        d.pos[0] = s.x; d.pos[1] = s.y; d.pos[2] = s.z;
        this.defectMeshes[i].position.set(s.x, s.y, s.z);
        this.defectVels[i][0] = sd.vx;
        this.defectVels[i][1] = sd.vy;
        this.defectVels[i][2] = sd.vz;
      }
    }

    // Defect glow: Hawking-style heat as local q approaches 0
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 3.0);
    for (let i = 0; i < this.defects.length; i++) {
      const d = this.defects[i];
      const localQ = this.qAt(d.pos[0], d.pos[1], d.pos[2]);
      const mat = this.defectMeshes[i].material as THREE.SpriteMaterial;
      if (localQ < SUB_Q_SAT * 4) {
        const hot = Math.min(1, 1 - localQ / (SUB_Q_SAT * 4));
        mat.color.setRGB(1.0, 0.30 + 0.55 * hot, 0.18 + 0.55 * hot);
        this.defectMeshes[i].scale.setScalar(0.9 + 0.7 * hot * pulse);
      } else {
        mat.color.setRGB(1.0, 0.82, 0.62);
        this.defectMeshes[i].scale.setScalar(1.0);
      }
    }

    // Render the live q-field as an additive cloud. Only depleted cells
    // (q < 0.92) are written so vacuum stays invisible.
    const N = this.sim.N;
    let cloudN = 0;
    const cInst = this.cloudMesh.instanceColor as THREE.InstancedBufferAttribute;
    const cArr  = cInst.array as Float32Array;
    const dim   = N * N * N;
    for (let c = 0; c < dim; c++) {
      const q = this.sim.q[c];
      if (q > 0.92) continue;
      // Decode cell coords
      const i = c % N;
      const j = ((c - i) / N) % N;
      const k = (c - i - j * N) / (N * N);
      const s = this.engineToScene(i + 0.5, j + 0.5, k + 0.5);
      // Mid-depletion → warm; saturated → hot red. Brightness scales with (1-q).
      const dep = 1 - q;
      const hot = Math.max(0, 1 - q / 0.35);
      const r = 0.45 + 0.55 * hot + 0.3 * dep;
      const g = 0.30 + 0.35 * dep - 0.20 * hot;
      const b = 0.55 + 0.45 * dep - 0.45 * hot;
      this.cloudDummy.position.set(s.x, s.y, s.z);
      this.cloudDummy.scale.setScalar(this.cellSize * (0.85 + 0.6 * dep));
      this.cloudDummy.updateMatrix();
      this.cloudMesh.setMatrixAt(cloudN, this.cloudDummy.matrix);
      cArr[cloudN * 3 + 0] = r;
      cArr[cloudN * 3 + 1] = Math.max(0, g);
      cArr[cloudN * 3 + 2] = Math.max(0, b);
      cloudN++;
    }
    this.cloudMesh.count = cloudN;
    this.cloudMesh.instanceMatrix.needsUpdate = true;
    cInst.needsUpdate = true;

    // Recompute tetra edge colors using the engine's q field (paper §6 — edges
    // tinted by their own occupancy variable, now PDE-driven)
    const cool = new THREE.Color(0x6090c0);
    const warm = new THREE.Color(0xff9050);
    const hotC = new THREE.Color(0xff3030);
    let pi = 0, ci = 0;
    for (let t = 0; t < this.tetras.length; t++) {
      const center = this.tetras[t].center;
      const verts: [number, number, number, number][] = [];
      for (let v = 0; v < 4; v++) {
        const vx = center.x + this.vertOffsets[(t * 4 + v) * 3 + 0];
        const vy = center.y + this.vertOffsets[(t * 4 + v) * 3 + 1];
        const vz = center.z + this.vertOffsets[(t * 4 + v) * 3 + 2];
        const q = this.qAt(vx, vy, vz);
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
          else         col = warm.clone().lerp(hotC, (0.6 - q) / 0.6);
          const intensity = ctx.entanglementOn ? (1.3 - 0.5 * q) : 0.7;
          this.edgeColors[ci++] = col.r * intensity;
          this.edgeColors[ci++] = col.g * intensity;
          this.edgeColors[ci++] = col.b * intensity;
        }
      }
    }
    (this.edgeGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.edgeGeom.attributes.color    as THREE.BufferAttribute).needsUpdate = true;

    // Camera owned by OrbitControls.


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
        // Push velocity into the engine defect (in lattice units / sim sec)
        const sd = this.simDefects[idx];
        sd.fixed = false;
        sd.vx = v.x / this.cellSize;
        sd.vy = v.y / this.cellSize;
        sd.vz = v.z / this.cellSize;
        // Emit a real wave packet on the engine in the release direction —
        // the visible cloud will show it propagating at lattice-c (paper §17,
        // D/τ₀ = c²). Plus the cinematic shell overlay for legibility.
        const speed = Math.hypot(v.x, v.y, v.z);
        if (speed > 0.05) {
          const ep = this.sceneToEngine(d.pos[0], d.pos[1], d.pos[2]);
          this.sim.emitPacket(ep.ex, ep.ey, ep.ez, v.x, v.y, v.z, 0.18, 1.6);
        }
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
    const q   = this.qAt(d.pos[0], d.pos[1], d.pos[2]);
    const saturated = q < SUB_Q_SAT * 4;
    // Vikram-bound cell scrambling floor at the Planck temperature (the only
    // intrinsic substrate temperature scale; paper does not define one, so we
    // expose this as a reference).
    const T_PLANCK = 1.416784e32;
    const cs = cellScrambling(T_PLANCK);
    const rows = [
      { k: 'q (capacity)', v: q.toFixed(3) + (saturated ? ' · saturated' : '') },
      { k: 'Ω_tet',        v: TET_MICROSTATES.toLocaleString() },
      { k: '4 faces ×',    v: '7 states · j₀=3/2' },
      { k: 'g_share,eff',  v: G_SHARE_EFF.toFixed(4) },
      { k: 'L*',           v: formatSI(1.60771947e-35, 'm', 2) },
      { k: 't_scr|cell @ T_P', v: formatSI(cs.t_scr, 's', 2) },
    ];
    return {
      title: saturated ? 'Defect · q→0 saturated (mini-BH)' : 'Defect · one-bit fermion anchor',
      rows,
      note: saturated
        ? 'No remaining capacity. Same lapse rule N²=q as the galactic BH — two scales, one mechanism.'
        : 'ΔS = ln 2 per defect (paper §13). Cell scrambling floor t_scr ≳ βℏ/(2π)·ln(Ω_tet) — Vikram, Shou, Galitski PRL 2026.'
    };
  }
}
