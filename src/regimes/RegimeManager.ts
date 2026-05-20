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
import { PlanetRegime }    from './PlanetRegime';
import { AtomicRegime }    from './AtomicRegime';
import { SubstrateRegime } from './SubstrateRegime';
import { decodeZoom, RegimeKey } from '../core/Camera';
import { Composer } from '../render/Composer';
import { hashStr } from '../util/hash';

type Ctor = new (aspect: number, seed: number) => Regime;
const REGISTRY: Record<RegimeKey, Ctor> = {
  COSMIC:    CosmicRegime,
  GALAXY:    GalaxyRegime,
  SYSTEM:    SystemRegime,
  PLANET:    PlanetRegime,
  ATOMIC:    AtomicRegime,
  SUBSTRATE: SubstrateRegime,
};

function focusContextFor(key: RegimeKey, f: FocusState): string {
  switch (key) {
    case 'COSMIC':    return '';
    case 'GALAXY':    return f.galaxyId ?? '';
    case 'SYSTEM':    return `${f.galaxyId ?? ''}|${f.starId ?? ''}`;
    case 'PLANET':    return `${f.galaxyId ?? ''}|${f.starId ?? ''}|${f.planetId ?? ''}`;
    case 'ATOMIC':    return '';
    case 'SUBSTRATE': return '';
  }
}

function mixSeed(base: number, ctx: string): number {
  if (!ctx) return base;
  return (base ^ hashStr(ctx)) >>> 0;
}

// Soft cap on how many distinct (regime, focus) scenes we keep in GPU memory.
// Most users only ping-pong between the current galaxy and zoomed-out cosmic,
// so 6 is comfortable headroom without holding many BH disks + star clouds.
const CACHE_LIMIT = 6;

export class RegimeManager {
  current!: Regime;
  currentKey: RegimeKey = 'COSMIC';
  focus: FocusState = { galaxyId: null, starId: null, planetId: null };
  // App attaches this to swap OrbitControls onto the new camera whenever
  // the active regime changes.
  onRegimeChange?: (regime: Regime, key: RegimeKey) => void;
  private currentFocusCtx = '';
  // Pinned-focus map: { 'galaxyId' | 'starId' | 'planetId' → wall-time-pin }
  // pumpFocus() leaves a pinned field untouched. Pins are cleared on
  // explicit unpin (background click, regime change wipes child pins).
  private pinned = new Set<keyof FocusState>();
  // LRU cache: cacheKey → {regime, lastUsed}. Recreating GalaxyRegime is
  // expensive (BH shaders, 6k star buffer, spiral mesh), so we cache rather
  // than dispose-and-rebuild on every zoom ping-pong.
  private cache = new Map<string, { regime: Regime; lastUsed: number }>();
  private accessCounter = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private composer: Composer,
    private seed: number
  ) {
    this.rebuild('COSMIC');
  }

  setSeed(seed: number) {
    this.seed = seed;
    this.focus = { galaxyId: null, starId: null, planetId: null };
    this.pinned.clear();
    // Seed change invalidates the whole cache (every regime would need
    // rebuilding against the new base seed anyway)
    for (const entry of this.cache.values()) entry.regime.dispose();
    this.cache.clear();
    this.current = null as unknown as Regime;
    this.rebuild(this.currentKey);
  }

  resetFocus() {
    this.focus = { galaxyId: null, starId: null, planetId: null };
    this.pinned.clear();
  }

  // Lock a single focus field to a chosen value. pumpFocus() will leave
  // pinned fields alone, so the user's selection survives camera moves.
  pinFocus(field: keyof FocusState, value: string | null) {
    this.focus[field] = value;
    if (value !== null) this.pinned.add(field);
    else this.pinned.delete(field);
    // Crossing focus committed → rebuild on next setZoom call.
  }

  unpinAll() {
    this.pinned.clear();
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
    // Pinned fields are user-selected — never overwrite from the
    // camera-ray fallback published by regimes.
    if (p.galaxyId !== undefined && !this.pinned.has('galaxyId')) this.focus.galaxyId = p.galaxyId;
    if (p.starId   !== undefined && !this.pinned.has('starId'))   this.focus.starId   = p.starId;
    if (p.planetId !== undefined && !this.pinned.has('planetId')) this.focus.planetId = p.planetId;
  }

  resize(w: number, h: number) {
    if (this.current) this.current.resize(w, h);
  }

  update(ctx: RegimeContext, dt: number) {
    this.current.update({ ...ctx }, dt);
  }

  render(dt: number) {
    this.composer.setScene(this.current.scene, this.current.camera);
    this.composer.render(dt);
  }

  pick(intersect: THREE.Intersection) {
    return this.current.pick(intersect);
  }
  hoverInfo(intersect: THREE.Intersection) {
    return this.current.hoverInfo(intersect);
  }

  private rebuild(key: RegimeKey) {
    const fctx = focusContextFor(key, this.focus);
    const cacheKey = `${key}|${fctx}`;
    let entry = this.cache.get(cacheKey);
    if (entry) {
      // Hit — reuse the existing scene, just promote LRU
      entry.lastUsed = ++this.accessCounter;
      this.current = entry.regime;
    } else {
      // Miss — build, cache. Evict the oldest entry if at the cap.
      if (this.cache.size >= CACHE_LIMIT) {
        let oldestKey: string | null = null;
        let oldestT = Infinity;
        for (const [k, e] of this.cache) {
          if (e.lastUsed < oldestT) { oldestT = e.lastUsed; oldestKey = k; }
        }
        if (oldestKey) {
          this.cache.get(oldestKey)!.regime.dispose();
          this.cache.delete(oldestKey);
        }
      }
      const Ctor = REGISTRY[key];
      const effSeed = mixSeed(this.seed, fctx);
      const w = this.renderer.domElement.clientWidth;
      const h = this.renderer.domElement.clientHeight;
      const regime = new Ctor(w / h, effSeed);
      regime.resize(w, h);
      this.cache.set(cacheKey, { regime, lastUsed: ++this.accessCounter });
      this.current = regime;
    }
    this.currentKey = key;
    this.currentFocusCtx = fctx;
    this.onRegimeChange?.(this.current, key);
  }
}
