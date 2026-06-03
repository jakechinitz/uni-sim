import * as THREE from 'three';
import { GalaxyRegime } from './GalaxyRegime';
import { SUPERNOVA_MASS } from '../core/StellarLifecycle';

type PatchedGalaxy = GalaxyRegime & {
  stars?: any[];
  bhs?: any[];
  posAttr?: THREE.BufferAttribute;
  colAttr?: THREE.BufferAttribute;
  starMaterial?: THREE.PointsMaterial;
};

const VISUAL_BH_SCALE = 0.5;
const STAR_POINT_SIZE = 0.17;
const MIN_STAR_OPACITY = 0.62;
const SWALLOW_R_K = 0.055;
const DEAD_FLASH_VISIBLE_GYR = 1e-11;
const HIDDEN_STAR_POS = 1e6;

const proto = GalaxyRegime.prototype as any;
if (!proto.__unisimGalaxyRuntimePatch) {
  const originalUpdate = proto.update;

  proto.update = function patchedGalaxyUpdate(this: PatchedGalaxy, ctx: any, dt: number) {
    originalUpdate.call(this, ctx, dt);

    const stars = this.stars;
    const bhs = this.bhs;
    const posAttr = this.posAttr;
    const colAttr = this.colAttr;
    if (!stars || !bhs || !posAttr || !colAttr) return;

    const positions = posAttr.array as Float32Array;
    const colors = colAttr.array as Float32Array;

    if (this.starMaterial) {
      this.starMaterial.size = STAR_POINT_SIZE;
      this.starMaterial.opacity = Math.max(this.starMaterial.opacity, MIN_STAR_OPACITY);
    }

    for (const bh of bhs) {
      const desiredScale = (bh.isCentral ? bh.mesh.scale.x : 1) * VISUAL_BH_SCALE;
      if (bh.isCentral) bh.mesh.scale.setScalar(desiredScale);
      else bh.mesh.scale.setScalar(VISUAL_BH_SCALE);
    }

    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      if (!star) continue;

      const px = star.body.pos[0];
      const py = star.body.pos[1];
      const pz = star.body.pos[2];
      let swallowed = false;

      for (const bh of bhs) {
        const dx = px - bh.body.pos[0];
        const dy = py - bh.body.pos[1];
        const dz = pz - bh.body.pos[2];
        const swallowR = SWALLOW_R_K * Math.sqrt(Math.max(1, bh.mass));
        if (dx * dx + dy * dy + dz * dz < swallowR * swallowR) {
          swallowed = true;
          break;
        }
      }

      if (swallowed) {
        star.state = 'dead';
        star.deathT = Number.NEGATIVE_INFINITY;
        star.spawnedBH = true;
        star.body.fixed = true;
        star.body.pos[0] = HIDDEN_STAR_POS;
        star.body.pos[1] = HIDDEN_STAR_POS;
        star.body.pos[2] = HIDDEN_STAR_POS;
        positions[i * 3 + 0] = HIDDEN_STAR_POS;
        positions[i * 3 + 1] = HIDDEN_STAR_POS;
        positions[i * 3 + 2] = HIDDEN_STAR_POS;
        colors[i * 3 + 0] = 0;
        colors[i * 3 + 1] = 0;
        colors[i * 3 + 2] = 0;
        continue;
      }

      if (star.state === 'dead') {
        const sinceDeath = ctx.time - star.deathT;
        if (Number.isFinite(sinceDeath) && sinceDeath > DEAD_FLASH_VISIBLE_GYR) {
          if (star.mass >= SUPERNOVA_MASS) {
            colors[i * 3 + 0] = 0;
            colors[i * 3 + 1] = 0;
            colors[i * 3 + 2] = 0;
          } else {
            colors[i * 3 + 0] = Math.min(colors[i * 3 + 0], 0.16);
            colors[i * 3 + 1] = Math.min(colors[i * 3 + 1], 0.22);
            colors[i * 3 + 2] = Math.min(colors[i * 3 + 2], 0.34);
          }
        }
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  };

  proto.__unisimGalaxyRuntimePatch = true;
}
