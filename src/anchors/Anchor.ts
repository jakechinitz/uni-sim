// Anchor scenes — paper-derived dynamics visualizations that live alongside
// the main universe simulation. Each anchor is a self-contained THREE.Scene
// + camera + animation, focused on illustrating ONE concept from the paper:
// substrate response, BH formation, galactic transition, lensing,
// horizon information, etc.
//
// The user picks an anchor from a dropdown; the App swaps the regime render
// for the anchor's render. Selecting "Live universe" returns to the normal
// regime flow. Anchors don't share state with regimes — they're independent
// demos.
//
// To add a new anchor:
//   1. Subclass Anchor in src/anchors/YourAnchor.ts
//   2. Register it in src/anchors/AnchorRegistry.ts
//   3. Done — dropdown auto-populates.

import * as THREE from 'three';
import type { QualitySettings } from '../core/Quality';

export interface AnchorMeta {
  id: string;            // Stable identifier, used as dropdown value + URL hash
  title: string;         // Shown in dropdown + side panel
  paperRef: string;      // e.g. "§11, §17"
  blurb: string;         // 1–2 sentence description for the side panel
  tier?: 1 | 2 | 3;      // Visualization priority per design review
}

export interface AnchorContext {
  playing: boolean;      // From the global play/pause state
  wallDt: number;        // Real seconds since last frame (UI animations)
  simDt: number;         // sim_sec / wall_sec × wallDt, signed by direction
  quality: QualitySettings;
}

export abstract class Anchor {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  readonly meta: AnchorMeta;

  constructor(meta: AnchorMeta, aspect: number) {
    this.meta = meta;
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.01, 1e5);
  }

  // Per-frame update. dt is sim-seconds (can be negative when rewinding).
  abstract update(ctx: AnchorContext): void;

  // Reset the anchor to its initial state — wired to the "Restart" button.
  restart(): void {}

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Optional gravitational-lensing sources for the Composer lens pass.
  // Same contract as Regime.lensSources — return BH positions + NDC radii
  // and the screen-space deflection shader will warp pixels around them.
  lensSources(): { worldPos: THREE.Vector3; radius: number }[] { return []; }

  // Standard scene disposal. Override if you hold extra GPU resources.
  dispose() {
    this.scene.traverse((o) => {
      const g = (o as any).geometry;
      const m = (o as any).material;
      if (g && typeof g.dispose === 'function') g.dispose();
      if (Array.isArray(m)) m.forEach((x: any) => x.dispose?.());
      else m?.dispose?.();
    });
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
  }
}
