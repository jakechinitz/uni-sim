// Real photon particles emitted from a star, propagating at the regime's
// local c in scene units. Visible at "Light" slow-mo (you watch them crawl
// across the system); blurs at fast-forward. Absorbed when hitting a planet,
// recycled when leaving the scene radius.
//
// Implementation: pool of N photons, allocated once. Each photon is an
// instance in an InstancedMesh, advanced by visDt × propSpeed each frame.

import * as THREE from 'three';
import { radialGlow } from './Glow';

interface Photon {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  emitTime: number;
}

export class PhotonField {
  group = new THREE.Group();
  private pool: Photon[] = [];
  private mesh: THREE.InstancedMesh;
  private mat: THREE.SpriteMaterial;
  private dummy = new THREE.Object3D();
  private aliveCount = 0;
  private emitCarry = 0;     // sub-photon accumulator to keep emission smooth at any speed
  private elapsed = 0;
  private color: THREE.Color;

  constructor(
    private poolSize: number,
    private propSpeed: number,         // scene-units / sim-sec
    private maxRadius: number,         // cull when |pos - origin| > this
    color = new THREE.Color(0xfff0c0),
    private size = 0.6
  ) {
    this.color = color;
    for (let i = 0; i < poolSize; i++) {
      this.pool.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        emitTime: 0
      });
    }
    const tex = radialGlow(64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)');
    this.mat = new THREE.SpriteMaterial({
      map: tex,
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    // Use InstancedMesh of plane geometry instead of Sprite for free instancing
    const geom = new THREE.PlaneGeometry(1, 1);
    const meshMat = new THREE.MeshBasicMaterial({
      map: tex, color,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.mesh = new THREE.InstancedMesh(geom, meshMat, poolSize);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  // Emit photons from a moving source. The "rate" is photons per sim-second,
  // accumulated as sub-photons so emission stays smooth at any time scale.
  emit(origin: THREE.Vector3, rateHz: number, dtSim: number) {
    const dtAbs = Math.abs(dtSim);
    this.emitCarry += rateHz * dtAbs;
    let toEmit = Math.floor(this.emitCarry);
    if (toEmit > 64) toEmit = 64;             // cap per-frame burst
    this.emitCarry -= toEmit;
    for (let i = 0; i < toEmit; i++) this.spawn(origin);
  }

  private spawn(origin: THREE.Vector3) {
    // Find a dead slot
    let slot = -1;
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].alive) { slot = i; break; }
    }
    if (slot < 0) return;
    const p = this.pool[slot];
    p.alive = true;
    p.pos.copy(origin);
    // Uniform random direction on the sphere
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    p.vel.set(r * Math.cos(t), r * Math.sin(t), u).multiplyScalar(this.propSpeed);
    p.emitTime = this.elapsed;
  }

  update(dtSim: number, origin: THREE.Vector3, absorbers: { pos: THREE.Vector3; radius: number }[]) {
    this.elapsed += Math.abs(dtSim);
    let n = 0;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.pos.x += dtSim * p.vel.x;
      p.pos.y += dtSim * p.vel.y;
      p.pos.z += dtSim * p.vel.z;
      // Absorption
      let absorbed = false;
      for (const a of absorbers) {
        const dx = p.pos.x - a.pos.x;
        const dy = p.pos.y - a.pos.y;
        const dz = p.pos.z - a.pos.z;
        if (dx * dx + dy * dy + dz * dz < a.radius * a.radius) { absorbed = true; break; }
      }
      const dx0 = p.pos.x - origin.x, dy0 = p.pos.y - origin.y, dz0 = p.pos.z - origin.z;
      if (absorbed || dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > this.maxRadius * this.maxRadius) {
        p.alive = false;
        continue;
      }
      // Write instance transform
      this.dummy.position.copy(p.pos);
      this.dummy.scale.setScalar(this.size);
      // Subtle distance fade — closer = brighter
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aliveCount = n;
  }

  setVisible(v: boolean) { this.group.visible = v; }
  setColor(c: THREE.Color) {
    this.color.copy(c);
    (this.mesh.material as THREE.MeshBasicMaterial).color.copy(c);
    this.mat.color.copy(c);
  }
  count() { return this.aliveCount; }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mat.dispose();
  }
}
