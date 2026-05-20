// Registry of available anchor scenes. The UI dropdown is built from this
// list — adding a new anchor is one entry here plus a class file.
//
// Ordering reflects the paper-design review tiers (1 = highest payoff for
// readers). The dropdown renders them in this order grouped by tier.

import { Anchor, AnchorMeta } from './Anchor';
import { SubstrateResponseAnchor } from './SubstrateResponse';

export interface AnchorEntry {
  meta: AnchorMeta;
  build: (aspect: number) => Anchor;
}

export const ANCHORS: AnchorEntry[] = [
  {
    meta: {
      id: 'substrate-response',
      title: 'Substrate causal response',
      paperRef: '§11, §17',
      blurb:
        'Empty vacuum (q ≈ 1 everywhere). A defect is dropped at the centre; ' +
        'the capacity field reacts and the disturbance propagates outward at ' +
        'exactly the lattice speed of light (D/τ₀ = c²), then settles into ' +
        'the static weak-field profile q(r) = 1 − r_s/r. Telegrapher PDE on a ' +
        '24³ grid — the same engine that runs SUBSTRATE in the main sim.',
      tier: 1
    },
    build: (aspect) => new SubstrateResponseAnchor(aspect)
  }
  // Future:
  //   { meta: { id: 'bh-formation', ... }, build: ... },
  //   { meta: { id: 'galaxy-rar-transition', ... }, build: ... },
  //   { meta: { id: 'lensing-no-slip', ... }, build: ... },
  //   { meta: { id: 'horizon-info', ... }, build: ... },
];
