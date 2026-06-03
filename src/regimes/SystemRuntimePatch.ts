import * as THREE from 'three';
import { SystemRegime } from './SystemRegime';

type PatchedSystem = SystemRegime & {
  starDied?: boolean;
  remnant?: THREE.Object3D | null;
  starLight?: THREE.PointLight;
  photons?: { setVisible?: (visible: boolean) => void };
  starMesh?: THREE.Sprite;
};

const REMNANT_SCALE = 0.5;
const REMNANT_LIGHT = 1.2;
const REMNANT_COLOR = 0x304050;

const proto = SystemRegime.prototype as any;
if (!proto.__unisimSystemRuntimePatch) {
  const originalUpdate = proto.update;
  const originalKillStar = proto.killStar;
  const originalLensSources = proto.lensSources;

  function toneDownRemnant(system: PatchedSystem) {
    if (!system.starDied) {
      system.photons?.setVisible?.(true);
      return;
    }

    system.photons?.setVisible?.(false);

    if (system.starMesh) {
      system.starMesh.visible = false;
      const mat = system.starMesh.material as THREE.SpriteMaterial;
      mat.opacity = 0;
    }

    if (system.starLight) {
      system.starLight.intensity = Math.min(system.starLight.intensity, REMNANT_LIGHT);
      system.starLight.color.set(REMNANT_COLOR);
    }

    if (system.remnant) {
      system.remnant.scale.setScalar(REMNANT_SCALE);
    }
  }

  proto.killStar = function patchedKillStar(this: PatchedSystem) {
    originalKillStar.call(this);
    toneDownRemnant(this);
  };

  proto.update = function patchedSystemUpdate(this: PatchedSystem, ctx: any, dt: number) {
    originalUpdate.call(this, ctx, dt);
    toneDownRemnant(this);
  };

  proto.lensSources = function patchedLensSources(this: PatchedSystem) {
    const sources = originalLensSources.call(this) as { worldPos: THREE.Vector3; radius: number }[];
    return sources.map(source => ({
      worldPos: source.worldPos,
      radius: Math.min(source.radius, 0.11),
    }));
  };

  proto.__unisimSystemRuntimePatch = true;
}
