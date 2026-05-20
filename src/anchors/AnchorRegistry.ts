// Registry of available anchor scenes. The UI dropdown is built from this
// list — adding a new anchor is one entry here plus a class file.
//
// Ordering reflects the paper-design review tiers (1 = highest payoff for
// readers). The dropdown renders them in this order grouped by tier.

import { Anchor, AnchorMeta } from './Anchor';
import { SubstrateResponseAnchor } from './SubstrateResponse';
import { BHFormationAnchor } from './BHFormation';
import { RARTransitionAnchor } from './RARTransition';

export interface AnchorEntry {
  meta: AnchorMeta;
  build: (aspect: number) => Anchor;
}

// Ordered by paper-design-review priority (tier 1 first). Each entry
// is independent — adding another anchor is one import + one entry.
export const ANCHORS: AnchorEntry[] = [
  {
    meta: {
      id: 'bh-formation',
      title: 'BH formation as saturation boundary',
      paperRef: '§15, §20',
      blurb:
        'A dust cloud collapses. The substrate capacity q is drained at ' +
        'the centre. When q → 0 a horizon SHELL forms — paper §20: the ' +
        'manifold ends at q=0, no singular centre is drawn inside. ' +
        'Distinctive paper claim — the BH is a saturation surface, not ' +
        'a point of infinite density.',
      tier: 1
    },
    build: (aspect) => new BHFormationAnchor(aspect)
  },
  {
    meta: {
      id: 'substrate-response',
      title: 'Substrate causal response',
      paperRef: '§11, §17',
      blurb:
        'Empty vacuum (q ≈ 1 everywhere). A defect is dropped at the ' +
        'centre; the capacity field reacts and the disturbance propagates ' +
        'outward at exactly the lattice speed of light (D/τ₀ = c²), then ' +
        'settles into the static weak-field profile q(r) = 1 − r_s/r. ' +
        'Same telegrapher engine as the main SUBSTRATE regime, isolated ' +
        'so the wavefront is the only thing on screen.',
      tier: 1
    },
    build: (aspect) => new SubstrateResponseAnchor(aspect)
  },
  {
    meta: {
      id: 'rar-transition',
      title: 'Galactic RAR transition · flat rotation',
      paperRef: '§14',
      blurb:
        'A central baryonic mass with 9 test stars at radii spanning ' +
        'deep-Newton (inner) to deep-MOND (outer). Cool stars follow the ' +
        "paper's exponential RAR; warm ghost stars use Newton only. The " +
        'ghosts drift behind at large r — flat rotation curves without ' +
        'dark matter, from one paper formula with no per-galaxy fits.',
      tier: 1
    },
    build: (aspect) => new RARTransitionAnchor(aspect)
  }
];
