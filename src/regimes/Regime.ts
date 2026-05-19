// Shared interface for every scale regime.
import * as THREE from 'three';
// Focus carries the user's drill-down path through the zoom hierarchy:
// "I'm looking at THIS galaxy in COSMIC", "this star in that galaxy", etc.
// Each regime can both READ focus (so e.g. SystemRegime builds the star
// the user picked) and WRITE focus (so e.g. CosmicRegime publishes "this
// is the galaxy nearest the camera" when zoom approaches GALAXY).
export interface FocusState {
  galaxyId: string | null;     // ID of the cosmic-web galaxy you're inside
  starId:   string | null;     // ID of the galactic star you're inside
}

export interface RegimeContext {
  seed: number;
  time: number;            // Gyr
  zoomIntra: number;       // 0..1 inside the regime
  edePulse: number;        // 0..1 strength of the Hubble-tension pulse
  entanglementOn: boolean;
  diskOn: boolean;         // galaxy spiral overlay toggle
  dtWall: number;          // wall-clock seconds since last frame (UI animations)
  rate: number;            // current sim_sec / wall_sec from the speed slider
  focus: FocusState;
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

export interface HoverInfo {
  title: string;
  rows: { k: string; v: string }[];
  note?: string;
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
  // Optional: paper-physics hover panel for the intersected object.
  hoverInfo(_intersection: THREE.Intersection): HoverInfo | null { return null; }
  // Regimes that publish a focus child (e.g. COSMIC picks the focused
  // galaxy nearest the camera ray) override this. Called per frame for
  // continuous tracking, and once more at the moment of regime transition
  // to commit the final selection. Default: no change.
  publishFocus(): Partial<FocusState> | null { return null; }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    const disposeMat = (m: any) => {
      if (!m) return;
      // Plain texture-bearing fields (map, normalMap, alphaMap, ...) on
      // standard materials
      for (const k of ['map','alphaMap','normalMap','roughnessMap','metalnessMap','emissiveMap','envMap']) {
        const t = m[k];
        if (t && typeof t.dispose === 'function') t.dispose();
      }
      // Shader-material uniforms: walk them and dispose any THREE.Texture
      if (m.uniforms) {
        for (const u of Object.values(m.uniforms) as any[]) {
          const v = u?.value;
          if (v && typeof v.dispose === 'function' && v.isTexture) v.dispose();
        }
      }
      if (typeof m.dispose === 'function') m.dispose();
    };
    this.scene.traverse(o => {
      const m = (o as any).material;
      const g = (o as any).geometry;
      if (g && typeof g.dispose === 'function') g.dispose();
      if (Array.isArray(m)) m.forEach(disposeMat);
      else disposeMat(m);
    });
    // Clear scene children so any leftover refs aren't held by Three.js
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
  }
}
