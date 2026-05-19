// Owns the active scene AND the focus path (which galaxy → which star) so
// drill-down zoom is continuous: the galaxy you were looking at in COSMIC
// becomes the galaxy in GALAXY, that galaxy's star becomes the star in
// SYSTEM. Focus is committed at the moment of each regime transition by
// asking the outgoing regime to publish its child.

import * as THREE from 'three';
import type { RegimeContext, FocusState } from './Regime';
import { Regime } from './Regime';
import { CosmicRegime }    from './CosmicRegime';
import { GalaxyRegime }    from './GalaxyRegime';
import { SystemRegime }    from './SystemRegime';
import { SubstrateRegime } from './SubstrateRegime';
import { decodeZoom, RegimeKey } from '../core/Camera';
import { Composer } from '../render/Composer';
import { hashStr } from '../util/hash';

type Ctor = new (aspect: number, seed: number) => Regime;
const REGISTRY: Record<RegimeKey, Ctor> = {
  COSMIC:    CosmicRegime,
  GALAXY:    GalaxyRegime,
  SYSTEM:    SystemRegime,
  SUBSTRATE: SubstrateRegime,
};

function focusContextFor(key: RegimeKey, f: FocusState): string {
  switch (key) {
    case 'COSMIC':    return '';
    case 'GALAXY':    return f.galaxyId ?? '';
    case 'SYSTEM':    return `${f.galaxyId ?? ''}|${f.starId ?? ''}`;
    case 'SUBSTRATE': return '';
  }
}

function mixSeed(base: number, ctx: string): number {
  if (!ctx) return base;
  return (base ^ hashStr(ctx)) >>> 0;
}

export class RegimeManager {
  current!: Regime;
  currentKey: RegimeKey = 'COSMIC';
  focus: FocusState = { galaxyId: null, starId: null };
  private currentFocusCtx = '';

  constructor(
    private renderer: THREE.WebGLRenderer,
    private composer: Composer,
    private seed: number
  ) {
    this.rebuild('COSMIC');
  }

  setSeed(seed: number) {
    this.seed = seed;
    this.focus = { galaxyId: null, starId: null };
    this.rebuild(this.currentKey);
  }

  resetFocus() {
    this.focus = { galaxyId: null, starId: null };
  }

  // Called per frame. Commits focus from the outgoing regime when crossing
  // a regime boundary, then rebuilds against (regime, focus-mixed seed).
  setZoom(zoom: number) {
    const slice = decodeZoom(zoom);
    const switching = slice.regime !== this.currentKey;
    if (switching) {
      // Final publish from outgoing regime before we tear it down
      const pub = this.current.publishFocus();
      this.applyFocus(pub);
    }
    const fctx = focusContextFor(slice.regime, this.focus);
    if (switching || fctx !== this.currentFocusCtx) {
      this.rebuild(slice.regime);
      this.composer.flash(switching ? 0.55 : 0.30);
    }
  }

  // While inside a regime, allow the regime to update focus continuously
  // (e.g. CosmicRegime tracks which galaxy the camera ray is pointed at so
  // the focus is already correct when the user crosses into GALAXY).
  pumpFocus() {
    const pub = this.current.publishFocus();
    this.applyFocus(pub);
  }

  private applyFocus(p: Partial<FocusState> | null) {
    if (!p) return;
    if (p.galaxyId !== undefined) this.focus.galaxyId = p.galaxyId;
    if (p.starId   !== undefined) this.focus.starId   = p.starId;
  }

  resize(w: number, h: number) {
    if (this.current) this.current.resize(w, h);
  }

  update(ctx: RegimeContext, dt: number) {
    this.current.update({ ...ctx }, dt);
  }

  render(dt: number) {
    this.composer.setScene(this.current.scene, this.current.camera);
    this.composer.setBloom(this.current.bloomStrength({
      seed: this.seed, time: 0, zoomIntra: 0, edePulse: 0,
      entanglementOn: false, dtWall: 0, rate: 0,
      focus: this.focus
    }));
    this.composer.render(dt);
  }

  pick(intersect: THREE.Intersection) {
    return this.current.pick(intersect);
  }
  hoverInfo(intersect: THREE.Intersection) {
    return this.current.hoverInfo(intersect);
  }

  private rebuild(key: RegimeKey) {
    if (this.current) this.current.dispose();
    const fctx = focusContextFor(key, this.focus);
    const effSeed = mixSeed(this.seed, fctx);
    const Ctor = REGISTRY[key];
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    this.current = new Ctor(w / h, effSeed);
    this.current.resize(w, h);
    this.currentKey = key;
    this.currentFocusCtx = fctx;
  }
}
