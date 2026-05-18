// Shared interface for every scale regime.
import * as THREE from 'three';
export interface RegimeContext {
  seed: number;
  time: number;            // Gyr
  zoomIntra: number;       // 0..1 inside the regime
  edePulse: number;        // 0..1 strength of the Hubble-tension pulse
  entanglementOn: boolean;
}

export interface DragTarget {
  id: string;
  object: THREE.Object3D;
  // (kept loose so any Object3D — Sprite, Mesh, Group — works)
  worldPos: THREE.Vector3;
  // Called by Drag with new world position. Regime updates state.
  onDragMove: (p: THREE.Vector3) => void;
  // Called on release with linear velocity (world units / second).
  onDragEnd: (v: THREE.Vector3) => void;
}

export abstract class Regime {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  draggable = new THREE.Group();   // raycast targets are children of this

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.01, 1e6);
    this.scene.background = null;
    this.scene.add(this.draggable);
  }

  abstract update(ctx: RegimeContext, dt: number): void;
  abstract pick(intersection: THREE.Intersection): DragTarget | null;
  abstract bloomStrength(ctx: RegimeContext): number;

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.scene.traverse(o => {
      const m = (o as any).material;
      const g = (o as any).geometry;
      if (g && typeof g.dispose === 'function') g.dispose();
      if (Array.isArray(m)) m.forEach(mm => mm.dispose && mm.dispose());
      else if (m && m.dispose) m.dispose();
    });
  }
}
