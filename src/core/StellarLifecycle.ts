// Stellar lifecycle physics — shared by GalaxyRegime (each of 3500 stars
// gets a mass + lifetime + death channel) and SystemRegime (the focused
// star inside that galaxy). Cosmic time is the global clock; both regimes
// compute death events from the same formulas so they stay roughly
// consistent if you zoom in and out across a death.

// Salpeter IMF: dN/dM ∝ M^-2.35. Inverse-CDF sample.
export function imfSample(rng: () => number, mMin = 0.15, mMax = 50): number {
  const a = 1.35;
  const u = rng();
  const A = Math.pow(mMin, -a) - (Math.pow(mMin, -a) - Math.pow(mMax, -a)) * u;
  return Math.pow(A, -1 / a);
}

// Approximate main-sequence lifetime in Gyr. Sun (~1 M☉) ≈ 10 Gyr,
// 8 M☉ ≈ 55 Myr, 20 M☉ ≈ 5 Myr.
export function mainSeqLifetime(massMsun: number): number {
  return 10 * Math.pow(massMsun, -2.5);
}

// Death channel: core-collapse supernova (→ stellar BH) above this mass,
// otherwise planetary nebula + white-dwarf cooling.
export const SUPERNOVA_MASS = 8;        // M☉
