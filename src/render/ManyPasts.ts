// Many-Pasts (paper §21) ghost-trajectory overlay.
//
// When the clock is rewinding, the simulator's forward integrator is the
// "present-pointed" branch — the operational reduction picks out the
// trajectory that arrived at the current state. This overlay sprinkles
// a few faint ghost copies of key objects at small perturbations from
// the current state, illustrating that "many pasts could have led
// here".  Visual only, not dynamical — the ghosts drift on their own
// trajectories so the eye reads them as alternate histories diverging
// backward in time, not as physical bodies.

import * as THREE from 'three';
import { radialGlow } from './Glow';

interface Ghost {
  sprite: THREE.Sprite;
  offset: THREE.Vector3;     // current perturbation from the real body
  drift:  THREE.Vector3;     // velocity of the perturbation
  age: number;
}

export class ManyPasts {
  group = new THREE.Group();
  private ghosts: Map<string, Ghost[]> = new Map();
  private texture: THREE.Texture;
  private color: THREE.Color;
  private ghostsPerBody = 4;
  private maxRadius = 1.0;     // scene-unit spread of ghost cloud

  constructor(color = new THREE.Color(0x9b8dff), maxRadius = 1.0) {
    this.maxRadius = maxRadius;
    this.color = color.clone();
    // Build mid/outer rim tints from the caller's colour so cosmic / galaxy /
    // system ghosts read distinctly (cosmic-violet vs galaxy-cyan etc.).
    const mid  = `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},0.7)`;
    const edge = `rgba(${Math.round(color.r * 120)},${Math.round(color.g * 80)},${Math.round(color.b * 220)},0)`;
    this.texture = radialGlow(128, 'rgba(255,255,255,1)', mid, edge);
  }

  // Update ghost positions toward the given body positions, with each
  // ghost perturbed by its own drifting offset. Call each frame with the
  // set of "real" bodies you want haunted.
  update(bodies: { id: string; pos: THREE.Vector3; scale: number }[], dtWall: number, enabled: boolean) {
    if (!enabled) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const seen = new Set<string>();
    for (const body of bodies) {
      seen.add(body.id);
      let arr = this.ghosts.get(body.id);
      if (!arr) {
        arr = [];
        for (let i = 0; i < this.ghostsPerBody; i++) {
          const mat = new THREE.SpriteMaterial({
            map: this.texture,
            color: this.color,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            opacity: 0.35
          });
          const sp = new THREE.Sprite(mat);
          sp.scale.setScalar(body.scale * 0.8);
          this.group.add(sp);
          arr.push({
            sprite: sp,
            offset: new THREE.Vector3((Math.random() - 0.5) * this.maxRadius,
                                      (Math.random() - 0.5) * this.maxRadius * 0.3,
                                      (Math.random() - 0.5) * this.maxRadius),
            drift:  new THREE.Vector3((Math.random() - 0.5) * 0.3,
                                      (Math.random() - 0.5) * 0.1,
                                      (Math.random() - 0.5) * 0.3),
            age: Math.random()
          });
        }
        this.ghosts.set(body.id, arr);
      }
      for (const g of arr) {
        g.age += dtWall;
        // Random walk the offset slightly so ghosts wander
        g.drift.x += (Math.random() - 0.5) * 0.04;
        g.drift.y += (Math.random() - 0.5) * 0.02;
        g.drift.z += (Math.random() - 0.5) * 0.04;
        g.drift.multiplyScalar(0.985);   // damp so it doesn't run away
        g.offset.addScaledVector(g.drift, dtWall * 0.5);
        // Soft spring back toward zero so ghosts stay clustered near the body
        g.offset.multiplyScalar(0.995);
        g.sprite.position.copy(body.pos).add(g.offset);
        // Opacity pulses softly so the cloud "breathes"
        const pulse = 0.5 + 0.35 * Math.sin(g.age * 2.1);
        (g.sprite.material as THREE.SpriteMaterial).opacity = 0.30 * pulse;
        g.sprite.scale.setScalar(body.scale * (0.6 + 0.4 * pulse));
      }
    }
    // Hide ghosts for bodies that disappeared
    for (const [id, arr] of this.ghosts) {
      if (!seen.has(id)) {
        for (const g of arr) (g.sprite.material as THREE.SpriteMaterial).opacity = 0;
      }
    }
  }

  dispose() {
    for (const arr of this.ghosts.values()) {
      for (const g of arr) {
        this.group.remove(g.sprite);
        (g.sprite.material as THREE.SpriteMaterial).dispose();
      }
    }
    this.ghosts.clear();
    this.texture.dispose();
  }
}
