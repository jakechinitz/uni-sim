import * as THREE from 'three';
import { App } from './App';
import { decodeZoom, type RegimeKey } from './core/Camera';

const REGIME_LIMITS: Record<RegimeKey, { min: number; max: number }> = {
  COSMIC:    { min: 12,  max: 200 },
  GALAXY:    { min: 5,   max: 80  },
  SYSTEM:    { min: 35,  max: 550 },
  ATOMIC:    { min: 6,   max: 22  },
  SUBSTRATE: { min: 6,   max: 45  },
};

const proto = App.prototype as any;
if (!proto.__unisimPanPatch) {
  const scratchDir = new THREE.Vector3();

  proto.applySliderDistance = function patchedApplySliderDistance() {
    const slice = decodeZoom(this.state.zoom);
    const lim = REGIME_LIMITS[slice.regime];

    if (this.controls) {
      this.controls.enablePan = true;
      this.controls.screenSpacePanning = true;
      this.controls.panSpeed = 1.35;
    }

    const focusPos = this.regimes.hasPin()
      ? this.regimes.current.focusedWorldPos(this.regimes.focus)
      : null;

    if (focusPos) {
      const lerpRate = 0.04 + 0.16 * slice.intra;
      this.controls.target.lerp(focusPos, Math.min(1, lerpRate));
    }

    const dist = lim.max - (lim.max - lim.min) * slice.intra;
    const cam = this.regimes.current.camera;
    scratchDir.copy(cam.position).sub(this.controls.target);
    const curLen = scratchDir.length();
    if (curLen < 1e-6) return;
    scratchDir.multiplyScalar(dist / curLen);
    cam.position.copy(this.controls.target).add(scratchDir);
  };

  proto.__unisimPanPatch = true;
}
