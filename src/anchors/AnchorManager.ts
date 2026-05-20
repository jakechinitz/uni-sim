// Manages the currently-active anchor scene. `setActive(null)` means
// "no anchor — show the regular regime view". The App polls `current`
// each frame to decide which scene to render.

import { Anchor } from './Anchor';
import { ANCHORS, AnchorEntry } from './AnchorRegistry';

export class AnchorManager {
  current: Anchor | null = null;
  currentId: string | null = null;
  private aspect: number;

  constructor(aspect: number) { this.aspect = aspect; }

  // Switch active anchor. Pass null to return to regime view.
  setActive(id: string | null) {
    if (id === this.currentId) return;
    if (this.current) {
      this.current.dispose();
      this.current = null;
    }
    this.currentId = id;
    if (id === null) return;
    const entry = ANCHORS.find(a => a.meta.id === id);
    if (!entry) {
      this.currentId = null;
      return;
    }
    this.current = entry.build(this.aspect);
  }

  resize(w: number, h: number) {
    this.aspect = w / h;
    if (this.current) this.current.resize(w, h);
  }

  // Reset whatever state the current anchor holds.
  restart() { this.current?.restart(); }

  // Read-only list for the dropdown builder.
  list(): AnchorEntry[] { return ANCHORS; }
}
