// Maps the single zoom slider (0..1) to (regime, intra-regime fraction).
//
// Five regimes drill from the cosmic web down to the substrate. Each spans
// the same slider width (1/5). The fade band straddling each boundary
// is the last/first ±0.04 of an adjacent regime.

export type RegimeKey = 'COSMIC' | 'GALAXY' | 'SYSTEM' | 'ATOMIC' | 'SUBSTRATE';

export const REGIMES: RegimeKey[] = ['COSMIC', 'GALAXY', 'SYSTEM', 'ATOMIC', 'SUBSTRATE'];

const N = REGIMES.length;
const W = 1 / N;                // width of one regime band along slider
const FADE = 0.04;              // ±FADE fraction of a regime where it crossfades

export interface ZoomSlice {
  regime: RegimeKey;
  intra: number;                // 0..1 inside the regime
  // for crossfade rendering
  nextRegime: RegimeKey | null;
  blend: number;                // 0 = pure regime, 1 = pure nextRegime
}

export function decodeZoom(zoom: number): ZoomSlice {
  const z = Math.max(0, Math.min(1, zoom));
  // raw index in [0, N)
  const r = Math.min(N - 1, Math.floor(z / W));
  const intra = (z - r * W) / W; // 0..1 inside this band
  let nextRegime: RegimeKey | null = null;
  let blend = 0;

  if (intra > 1 - FADE && r < N - 1) {
    nextRegime = REGIMES[r + 1];
    blend = (intra - (1 - FADE)) / FADE;
  } else if (intra < FADE && r > 0) {
    nextRegime = REGIMES[r - 1];
    blend = (FADE - intra) / FADE;
  }

  return {
    regime: REGIMES[r],
    intra,
    nextRegime,
    blend
  };
}
