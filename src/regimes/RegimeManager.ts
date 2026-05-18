// Crossfade between adjacent regimes during zoom transition.
// Renders current scene fully, optionally renders next scene over it with reduced alpha.

import * as THREE from 'three';
import type { RegimeContext } from './Regime';
import { Regime } from './Regime';
import { CosmicRegime }    from './CosmicRegime';
import { GalaxyRegime }    from './GalaxyRegime';
import { SystemRegime }    from './SystemRegime';
import { PlanetRegime }    from './PlanetRegime';
import { AtomicRegime }    from './AtomicRegime';
import { SubstrateRegime } from './SubstrateRegime';
import { decodeZoom, RegimeKey } from '../core/Camera';
import { Composer } from '../render/Composer';

type Ctor = new (aspect: number, seed: number) => Regime;
const REGISTRY: Record<RegimeKey, Ctor> = {
  COSMIC:    CosmicRegime,
  GALAXY:    GalaxyRegime,
  SYSTEM:    SystemRegime,
  PLANET:    PlanetRegime,
  ATOMIC:    AtomicRegime,
  SUBSTRATE: SubstrateRegime,
};

export class RegimeManager {
  private cache = new Map<RegimeKey, Regime>();
  current!: Regime;
  currentKey: RegimeKey = 'COSMIC';
  next: Regime | null = null;
  nextKey: RegimeKey | null = null;
  blend = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private composer: Composer,
    private seed: number
  ) {
    this.setRegime('COSMIC');
  }

  setSeed(seed: number) {
    this.seed = seed;
    // Drop all cached regimes — they'll regenerate on demand
    for (const r of this.cache.values()) r.dispose();
    this.cache.clear();
    this.setRegime(this.currentKey);
  }

  setRegime(key: RegimeKey) {
    this.current = this.get(key);
    this.currentKey = key;
  }

  setZoom(zoom: number) {
    const slice = decodeZoom(zoom);
    if (slice.regime !== this.currentKey) {
      this.setRegime(slice.regime);
      this.composer.flash(0.6);
    }
    if (slice.nextRegime) {
      this.next = this.get(slice.nextRegime);
      this.nextKey = slice.nextRegime;
      this.blend = slice.blend;
    } else {
      this.next = null;
      this.nextKey = null;
      this.blend = 0;
    }
  }

  resize(w: number, h: number) {
    for (const r of this.cache.values()) r.resize(w, h);
  }

  update(ctx: RegimeContext, dt: number) {
    const cur = this.current;
    cur.update({ ...ctx }, dt);
    if (this.next) this.next.update({ ...ctx }, dt);
  }

  render(dt: number) {
    // Render only the current regime; transitions between regimes are signalled
    // by a Composer.flash() in setZoom() and by per-regime visibility ramps.
    this.composer.setScene(this.current.scene, this.current.camera);
    this.composer.setBloom(this.current.bloomStrength({
      seed: this.seed, time: 0, zoomIntra: 0, edePulse: 0, entanglementOn: false
    }));
    this.composer.render(dt);
  }

  pick(intersect: THREE.Intersection) {
    return this.current.pick(intersect);
  }

  private get(key: RegimeKey): Regime {
    let r = this.cache.get(key);
    if (!r) {
      const Ctor = REGISTRY[key];
      const w = this.renderer.domElement.clientWidth;
      const h = this.renderer.domElement.clientHeight;
      r = new Ctor(w / h, this.seed);
      r.resize(w, h);
      this.cache.set(key, r);
    }
    return r;
  }
}
