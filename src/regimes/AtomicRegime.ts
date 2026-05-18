// ATOMIC: schematic atoms — nucleus + additive electron-cloud shells.
// Spring-damper interaction when dragged.

import * as THREE from 'three';
import { Regime, RegimeContext, DragTarget } from './Regime';
import { mulberry32 } from '../core/Rng';
import { hashStr } from '../util/hash';
import { radialGlow } from '../render/Glow';

interface Atom {
  rest: THREE.Vector3;
  body: { pos: THREE.Vector3; vel: THREE.Vector3; fixed: boolean };
  group: THREE.Group;
  ring1: THREE.Sprite;
  ring2: THREE.Sprite;
  ring3: THREE.Sprite;
}

const N_ATOMS = 22;
const K_SPRING = 4.0;
const DAMPING  = 0.7;

export class AtomicRegime extends Regime {
  private atoms: Atom[] = [];
  private bonds: THREE.LineSegments;
  private bondPositions: Float32Array;
  private bondGeom: THREE.BufferGeometry;
  private time = 0;

  constructor(aspect: number, seed: number) {
    super(aspect);
    this.camera.position.set(0, 4, 16);
    this.camera.lookAt(0, 0, 0);

    const rng = mulberry32(hashStr(`atomic|${seed}`));

    const ringTex = radialGlow(256, 'rgba(0,0,0,0)', 'rgba(122,215,255,0.85)', 'rgba(122,215,255,0)');
    const nucTex  = radialGlow(128, '#ffffff', '#ffd070', 'rgba(0,0,0,0)');

    for (let i = 0; i < N_ATOMS; i++) {
      const x = (rng() - 0.5) * 16;
      const y = (rng() - 0.5) * 9;
      const z = (rng() - 0.5) * 6;
      const group = new THREE.Group();
      group.position.set(x, y, z);

      const nuc = new THREE.Sprite(new THREE.SpriteMaterial({
        map: nucTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
      }));
      nuc.scale.setScalar(0.55);
      group.add(nuc);

      const ringSprite = (size: number, col: number) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: ringTex, color: col,
          blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85
        }));
        s.scale.setScalar(size);
        return s;
      };
      const r1 = ringSprite(1.3, 0x7ad7ff);
      const r2 = ringSprite(1.9, 0xb0e0ff);
      const r3 = ringSprite(2.5, 0xe0f4ff);
      group.add(r1, r2, r3);

      this.scene.add(group);
      this.draggable.add(group);
      group.userData = { type: 'atom', index: i };

      this.atoms.push({
        rest: new THREE.Vector3(x, y, z),
        body: { pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), fixed: false },
        group, ring1: r1, ring2: r2, ring3: r3
      });
    }

    // Bonds — pairs within radius
    const segs: number[] = [];
    for (let i = 0; i < N_ATOMS; i++) {
      for (let j = i + 1; j < N_ATOMS; j++) {
        const d = this.atoms[i].rest.distanceTo(this.atoms[j].rest);
        if (d < 3.0) segs.push(i, j);
      }
    }
    this.bondPositions = new Float32Array(segs.length * 3);
    this.bondGeom = new THREE.BufferGeometry();
    this.bondGeom.setAttribute('position', new THREE.BufferAttribute(this.bondPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.bondGeom.userData = { segs };
    const bondMat = new THREE.LineBasicMaterial({
      color: 0x7ad7ff, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.bonds = new THREE.LineSegments(this.bondGeom, bondMat);
    this.scene.add(this.bonds);
  }

  update(_ctx: RegimeContext, dt: number): void {
    this.time += dt;
    const dtClamp = Math.min(dt, 1 / 30);
    // Spring restoration to rest position
    for (const a of this.atoms) {
      if (a.body.fixed) continue;
      const dx = a.rest.x - a.body.pos.x;
      const dy = a.rest.y - a.body.pos.y;
      const dz = a.rest.z - a.body.pos.z;
      a.body.vel.x += dtClamp * (K_SPRING * dx - DAMPING * a.body.vel.x);
      a.body.vel.y += dtClamp * (K_SPRING * dy - DAMPING * a.body.vel.y);
      a.body.vel.z += dtClamp * (K_SPRING * dz - DAMPING * a.body.vel.z);
      a.body.pos.x += dtClamp * a.body.vel.x;
      a.body.pos.y += dtClamp * a.body.vel.y;
      a.body.pos.z += dtClamp * a.body.vel.z;
    }
    for (const a of this.atoms) {
      a.group.position.copy(a.body.pos);
      const breathe = 1.0 + 0.03 * Math.sin(this.time * 2 + a.rest.x);
      a.ring1.material.rotation = this.time * 0.4;
      a.ring2.material.rotation = -this.time * 0.3;
      a.ring3.material.rotation = this.time * 0.18;
      a.ring1.scale.setScalar(1.3 * breathe);
      a.ring2.scale.setScalar(1.9 * breathe);
      a.ring3.scale.setScalar(2.5 * breathe);
    }
    // Bonds
    const segs = this.bondGeom.userData.segs as number[];
    let k = 0;
    for (let s = 0; s < segs.length; s += 2) {
      const ai = this.atoms[segs[s]].body.pos;
      const bi = this.atoms[segs[s + 1]].body.pos;
      this.bondPositions[k++] = ai.x; this.bondPositions[k++] = ai.y; this.bondPositions[k++] = ai.z;
      this.bondPositions[k++] = bi.x; this.bondPositions[k++] = bi.y; this.bondPositions[k++] = bi.z;
    }
    (this.bondGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  bloomStrength(_ctx: RegimeContext): number { return 0.75; }

  pick(intersection: THREE.Intersection): DragTarget | null {
    let obj: THREE.Object3D | null = intersection.object;
    while (obj && !(obj.userData?.type === 'atom')) obj = obj.parent;
    if (!obj) return null;
    const idx = obj.userData.index as number;
    const a = this.atoms[idx];
    return {
      id: `atom-${idx}`,
      object: obj,
      worldPos: new THREE.Vector3().copy(obj.position),
      onDragMove: (p) => { a.body.pos.copy(p); a.body.fixed = true; a.body.vel.set(0, 0, 0); },
      onDragEnd:  (v) => { a.body.fixed = false; a.body.vel.copy(v); }
    };
  }
}
