// Telegrapher waves — paper §17. A perturbation in S_ent satisfies
//   τ₀ ∂²δS + ∂δS = D ∇²δS + Aχ,    with D/τ₀ = c²,
// so substrate signals propagate at exactly c. Visually we represent each
// emission as an expanding wireframe sphere whose radius is the elapsed
// proper time × the regime's `propSpeed` (its local "speed of light" in
// scene units / sim seconds), with intensity fading as the wavefront thins.
// Only visible at speeds slow enough to resolve it — exactly the point of
// the slow-mo slider.

import * as THREE from 'three';

interface ActiveWave {
  center: THREE.Vector3;
  age: number;
  maxR: number;
  amp: number;
  mesh: THREE.Mesh;
  shellMat: THREE.MeshBasicMaterial;
  glow?: THREE.Sprite;
  glowMat?: THREE.SpriteMaterial;
}

export class TelegrapherField {
  group = new THREE.Group();
  private waves: ActiveWave[] = [];
  private color: THREE.Color;
  private propSpeed: number;

  // propSpeed: scene-units / sim-second. Pick per regime so the ripple
  // takes a few wall-seconds to cross the scene at slow-mo speeds.
  constructor(propSpeed: number, color = new THREE.Color(0x9ee0ff)) {
    this.propSpeed = propSpeed;
    this.color = color;
    this.group.renderOrder = 5;
  }

  emit(center: THREE.Vector3, maxR: number, amp = 1, glowTex?: THREE.Texture) {
    const geom = new THREE.SphereGeometry(1, 28, 18);
    const shellMat = new THREE.MeshBasicMaterial({
      color: this.color, transparent: true, opacity: 0,
      wireframe: true, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(geom, shellMat);
    mesh.position.copy(center);

    let glow: THREE.Sprite | undefined;
    let glowMat: THREE.SpriteMaterial | undefined;
    if (glowTex) {
      glowMat = new THREE.SpriteMaterial({
        map: glowTex, color: this.color, transparent: true,
        opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
      });
      glow = new THREE.Sprite(glowMat);
      glow.position.copy(center);
      this.group.add(glow);
    }

    this.group.add(mesh);
    this.waves.push({ center: center.clone(), age: 0, maxR, amp, mesh, shellMat, glow, glowMat });
  }

  update(dtSim: number) {
    const dt = Math.abs(dtSim);
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.age += dt;
      const r = w.age * this.propSpeed;
      const frac = r / w.maxR;
      // Shell: 1/(1+r²) fade, plus a ring-like envelope that peaks early and
      // falls toward maxR
      const env  = Math.max(0, 1 - frac);
      const opShell = 0.85 * w.amp * env / (1 + 1.6 * frac * frac);
      w.shellMat.opacity = opShell;
      w.mesh.scale.setScalar(Math.max(1e-6, r));

      if (w.glow && w.glowMat) {
        // Centred halo dims faster — represents the source quenching
        w.glowMat.opacity = 0.6 * w.amp * Math.max(0, 1 - 2.0 * frac);
        w.glow.scale.setScalar(Math.max(0.1, 0.4 + r * 0.25));
      }

      if (frac > 1.05 || opShell < 0.005) {
        this.group.remove(w.mesh);
        w.mesh.geometry.dispose();
        w.shellMat.dispose();
        if (w.glow) {
          this.group.remove(w.glow);
          w.glowMat?.dispose();
        }
        this.waves.splice(i, 1);
      }
    }
  }

  setVisible(v: boolean) { this.group.visible = v; }

  clear() {
    for (const w of this.waves) {
      this.group.remove(w.mesh);
      w.mesh.geometry.dispose();
      w.shellMat.dispose();
      if (w.glow) {
        this.group.remove(w.glow);
        w.glowMat?.dispose();
      }
    }
    this.waves.length = 0;
  }

  dispose() { this.clear(); }
}
