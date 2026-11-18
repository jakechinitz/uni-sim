// Background cosmology: scale factor a(t), Hubble rate H(a), epoch labels.
//
// This is an INTEGRATED Friedmann history, not a curve fit. The sum is the
// paper's (Entropic Scalar EFT §19–§20, App. O):
//
//   h² E²(a) = ω_r a⁻⁴ + ω_b a⁻³ + ω_c^wb e^{−η* F_rel(a)} a⁻³ + ω_Λ(a) + ω_EDE(a)
//   ω_Λ(a)   = η* ω_c^wb ∫₀^a a'⁻³ e^{−η* F_rel} dF_rel
//
//  - ω_c^wb = 5.333 ω_b: the committed stock per baryon (1/ε = 5.3207 bare,
//    5.333 after the formation mass conversion). It is pressureless dust.
//  - η* = 0.0298668443935: the share of the stock released into the vacuum.
//  - F_rel(a) ∈ [0,1]: the released fraction. The table below is the paper's
//    frozen, no-fit release history (mean of the six measured kernels at
//    z_re = 7.66); it gives I_rel = ∫a⁻³dF_rel = 95.5.
//  - ω_EDE: the early pulse near equality, quantified by the paper as
//    f_EDE = 0.018 at z_c = 3400 (axion-like n = 3 proxy, standard fluid form
//    ρ ∝ 2/(1 + (a/a_c)^{4.5})). It changes H by ~1 % at its peak.
//
// The only inputs are ω_b (BBN/CMB), the radiation density (T_CMB, N_eff) and
// the release history. Everything else — h = 0.693, Ω_Λ = 0.709, the age,
// a₀ = ε c H₀ — is OUTPUT. Flatness fixes h² as the sum evaluated at a = 1.
//
// Beyond today the paper gives no release history; F_rel is held at its
// present value (no further release), which makes the future ΛCDM-like.

// ---- inputs ---------------------------------------------------------------
export const OMEGA_B_H2 = 0.02238;            // ω_b
export const STOCK_PER_BARYON = 5.333;        // ω_c^wb / ω_b
export const ETA_STAR = 0.0298668443935;      // η*
export const OMEGA_R_H2 = 4.184e-5;           // photons (2.7255 K) + 3.046 massless neutrinos
export const F_EDE = 0.018;                   // early-pulse energy fraction at z_c
export const Z_C = 3400;                      // pulse redshift
const H100 = 0.1022712;                       // 100 km/s/Mpc in 1/Gyr
const KM_S_MPC_IN_SI = 3.240779e-20;          // 1 km/s/Mpc in 1/s

// F_rel on a uniform grid in ln(1+z), z = 30 → 0 (97 nodes). Zero above z = 30.
const F_Z_MAX = 30;
const F_TAB = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1e-06, 2e-06, 2e-06, 7e-06, 1.3e-05, 2.4e-05, 4e-05, 6.7e-05, 0.000114, 0.000179, 0.000275, 0.000413, 0.00062, 0.000916, 0.001313, 0.00185, 0.002539, 0.003426, 0.004593, 0.006075, 0.007903, 0.010089, 0.012707, 0.015779, 0.019458, 0.023767, 0.028702, 0.034272, 0.040439, 0.045755, 0.048956, 0.052484, 0.0564, 0.060726, 0.065351, 0.070414, 0.076037, 0.082203, 0.08898, 0.096418, 0.104475, 0.113085, 0.122282, 0.131934, 0.142071, 0.152669, 0.16362, 0.174868, 0.18658, 0.198774, 0.211352, 0.224163, 0.237197, 0.250493, 0.263989, 0.277695, 0.291564, 0.305447, 0.319288, 0.333095, 0.346814, 0.360403, 0.373997, 0.387513, 0.400855, 0.41398, 0.426966, 0.439827, 0.452519, 0.465009, 0.477178, 0.489026, 0.500575, 0.511854, 0.52284, 0.533505, 0.543885, 0.553913, 0.563597, 0.572888, 0.581853, 0.590533, 0.598925, 0.606962, 0.614623, 0.621926, 0.628906, 0.635562, 0.641859, 0.647882];
const F_N = F_TAB.length;
const LN_ZMAX1 = Math.log(1 + F_Z_MAX);

const OMEGA_C_H2 = STOCK_PER_BARYON * OMEGA_B_H2;

// Node j ↔ scale factor a_j.
const nodeA = (j: number) => Math.exp(-LN_ZMAX1 * (1 - j / (F_N - 1)));
// Fractional node index for scale factor a (clamped).
const nodeX = (a: number) => (F_N - 1) * (1 + Math.log(a) / LN_ZMAX1);

// Vacuum density released so far, ω_Λ at each node (trapezoid in F).
const LAM_TAB = new Float64Array(F_N);
let I_REL_ACC = 0;
for (let j = 1; j < F_N; j++) {
  const a0 = nodeA(j - 1), a1 = nodeA(j), dF = F_TAB[j] - F_TAB[j - 1];
  const g0 = Math.exp(-ETA_STAR * F_TAB[j - 1]) / a0 ** 3, g1 = Math.exp(-ETA_STAR * F_TAB[j]) / a1 ** 3;
  LAM_TAB[j] = LAM_TAB[j - 1] + ETA_STAR * OMEGA_C_H2 * 0.5 * (g0 + g1) * dF;
  I_REL_ACC += 0.5 * (1 / a0 ** 3 + 1 / a1 ** 3) * dF;
}
/** I_rel = ∫ a⁻³ dF_rel over the whole history (paper: 95.5 ± 8). */
export const I_REL = I_REL_ACC;

function tabLerp(tab: ArrayLike<number>, a: number): number {
  const x = nodeX(a);
  if (x <= 0) return tab[0];
  if (x >= F_N - 1) return tab[F_N - 1];
  const j = Math.floor(x), f = x - j;
  return tab[j] * (1 - f) + tab[j + 1] * f;
}

/** Released fraction F_rel at scale factor a. */
export function releasedFraction(a: number): number { return tabLerp(F_TAB, a); }

// Early pulse: fraction F_EDE of the total at a_c.
const A_C = 1 / (1 + Z_C);
const OMEGA_EDE_C = (F_EDE / (1 - F_EDE)) * (OMEGA_R_H2 / A_C ** 4 + (OMEGA_B_H2 + OMEGA_C_H2) / A_C ** 3);
const omegaEDE = (a: number) => OMEGA_EDE_C * 2 / (1 + Math.pow(a / A_C, 4.5));

/** Clustering matter today-normalised: ω_m(a)·a³ = ω_b + ω_c e^{−η*F(a)}. */
export function omegaMatterH2(a: number): number {
  return OMEGA_B_H2 + OMEGA_C_H2 * Math.exp(-ETA_STAR * releasedFraction(a));
}

/** h² E²(a): the Friedmann sum in units of (100 km/s/Mpc)². */
function e2h2(a: number): number {
  return OMEGA_R_H2 / a ** 4 + omegaMatterH2(a) / a ** 3 + tabLerp(LAM_TAB, a) + omegaEDE(a);
}

// ---- outputs --------------------------------------------------------------
/** Dimensionless Hubble constant h (output of the sum; paper: 0.693 ± 0.021). */
export const LITTLE_H = Math.sqrt(e2h2(1));
/** H₀ in km/s/Mpc, 1/Gyr and 1/s. */
export const H0_KMS_MPC = 100 * LITTLE_H;
export const H0_PER_GYR = H100 * LITTLE_H;
export const H0_SI = H0_KMS_MPC * KM_S_MPC_IN_SI;
/** Present density parameters. */
export const OMEGA_LAMBDA = LAM_TAB[F_N - 1] / (LITTLE_H * LITTLE_H);
export const OMEGA_M = omegaMatterH2(1) / (LITTLE_H * LITTLE_H);
export const OMEGA_B = OMEGA_B_H2 / (LITTLE_H * LITTLE_H);

/** Hubble rate at scale factor a, in 1/Gyr. */
export function hubble(a: number): number { return H100 * Math.sqrt(e2h2(a)); }

/** H(a)/H₀ — also a₀(z)/a₀(0), since a₀(z) = ε c H(z) (paper §15). */
export function hubbleRatio(a: number): number { return hubble(a) / H0_PER_GYR; }

/** Energy fraction in the early pulse at scale factor a. */
export function edeFraction(a: number): number { return omegaEDE(a) / e2h2(a); }

// ---- t(a) table: t = ∫ d ln a / H, uniform in ln a ------------------------
const LN_A_MIN = Math.log(1e-10), LN_A_MAX = Math.log(1e3);
const T_N = 2048;
const D_LN_A = (LN_A_MAX - LN_A_MIN) / (T_N - 1);
const T_TAB = new Float64Array(T_N);
{
  // Start deep in the radiation era, where a ∝ t^{1/2} ⇒ t = 1/(2H).
  let prevInvH = 1 / hubble(Math.exp(LN_A_MIN));
  T_TAB[0] = 0.5 * prevInvH;
  for (let i = 1; i < T_N; i++) {
    const invH = 1 / hubble(Math.exp(LN_A_MIN + i * D_LN_A));
    T_TAB[i] = T_TAB[i - 1] + 0.5 * (prevInvH + invH) * D_LN_A;
    prevInvH = invH;
  }
}

/** Cosmic time (Gyr) at scale factor a. */
export function timeOfA(a: number): number {
  const x = (Math.log(a) - LN_A_MIN) / D_LN_A;
  if (x <= 0) return T_TAB[0] * (a / 1e-10) ** 2;
  if (x >= T_N - 1) return T_TAB[T_N - 1] + (Math.log(a) - LN_A_MAX) / hubble(1e3);
  const i = Math.floor(x), f = x - i;
  return T_TAB[i] * (1 - f) + T_TAB[i + 1] * f;
}

/** Age of the universe today (Gyr) — an output of the integration. */
export const T_TODAY = timeOfA(1);

/** Scale factor at cosmic time t (Gyr); a(T_TODAY) = 1. */
export function a(tGyr: number): number {
  if (!(tGyr > 0)) return 1e-10;
  if (tGyr <= T_TAB[0]) return 1e-10 * Math.sqrt(tGyr / T_TAB[0]);
  if (tGyr >= T_TAB[T_N - 1]) return 1e3 * Math.exp((tGyr - T_TAB[T_N - 1]) * hubble(1e3));   // de Sitter
  let lo = 0, hi = T_N - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T_TAB[mid] <= tGyr) lo = mid; else hi = mid; }
  // Interpolate ln a against ln t (exact for the power-law eras).
  const f = Math.log(tGyr / T_TAB[lo]) / Math.log(T_TAB[hi] / T_TAB[lo]);
  return Math.exp(LN_A_MIN + (lo + f) * D_LN_A);
}

export function z(tGyr: number): number {
  return Math.max(0, 1 / a(tGyr) - 1);
}

/** Matter–radiation equality (output): 1 + z_eq = ω_m / ω_r. */
export const Z_EQ = (OMEGA_B_H2 + OMEGA_C_H2) / OMEGA_R_H2 - 1;

// The trace of the matter stress-energy as a fraction of the total density of
// matter + radiation: 0 in pure radiation (T^μ_μ = 0), → 1 once matter
// dominates. This is the switch that leaves the homogeneous mode dormant
// early (paper §19).
export function traceChi(tGyr: number): number {
  if (!(tGyr > 0)) return 0;
  const s = a(tGyr);
  const m = omegaMatterH2(s) / s ** 3, r = OMEGA_R_H2 / s ** 4;
  return m / (m + r);
}

// Peak of the pulse's energy fraction, for a 0..1 display amplitude.
let EDE_PEAK = 0;
for (let i = 0; i <= 400; i++) {
  const s = A_C * Math.pow(10, -1.5 + 3 * i / 400);
  EDE_PEAK = Math.max(EDE_PEAK, edeFraction(s));
}
/** Early pulse amplitude normalised to its peak (display only; the physical size is edeFraction ≤ ~2 %). */
export function edePulse(tGyr: number): number {
  if (!(tGyr > 0)) return 0;
  return Math.min(1, edeFraction(a(tGyr)) / EDE_PEAK);
}

// ---- epochs ---------------------------------------------------------------
const Z_RECOMB = 1090, Z_FIRST_BH = 25, Z_GALAXIES = 8;
const T_BB       = 0;
const T_RAD_END  = timeOfA(1 / (1 + Z_EQ));       // matter–radiation equality
const T_RECOMB   = timeOfA(1 / (1 + Z_RECOMB));
const T_FIRST_BH = timeOfA(1 / (1 + Z_FIRST_BH));
const T_GALAXIES = timeOfA(1 / (1 + Z_GALAXIES));

export type EpochKey = 'BIG_BANG' | 'RADIATION' | 'HUBBLE_PULSE' | 'RECOMBINATION'
                     | 'DARK_AGES' | 'FIRST_LIGHT' | 'GALAXIES' | 'CLUSTERS' | 'TODAY';

export function epoch(tGyr: number): { key: EpochKey; label: string } {
  if (tGyr <= 1e-8)             return { key: 'BIG_BANG',     label: 'Big Bang' };
  if (tGyr <  T_RAD_END * 0.5)  return { key: 'RADIATION',    label: 'Radiation Era' };
  if (tGyr <  T_RAD_END * 2.5)  return { key: 'HUBBLE_PULSE', label: 'Equality · Early Pulse' };
  if (tGyr <  T_RECOMB)         return { key: 'RECOMBINATION', label: 'Recombination' };
  if (tGyr <  T_FIRST_BH)       return { key: 'DARK_AGES',    label: 'Dark Ages' };
  if (tGyr <  T_GALAXIES)       return { key: 'FIRST_LIGHT',  label: 'First Stars · Black Holes' };
  if (tGyr <  4)                return { key: 'GALAXIES',     label: 'Galaxies Condense' };
  if (tGyr <  12)               return { key: 'CLUSTERS',     label: 'Clusters & Cosmic Web' };
  return                          { key: 'TODAY',        label: 'Today' };
}

// Checkpoints used by regimes (all derived from the integrated history).
export const checkpoints = {
  T_BB, T_RAD_END, T_RECOMB, T_FIRST_BH, T_GALAXIES, T_TODAY,
  Z_EQ, Z_RECOMB, Z_FIRST_BH, Z_GALAXIES
};
