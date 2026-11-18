// Closure chain — paper §6–9, §13. The whole UV-to-IR derivation as a single
// computation, with every number traceable to the prior step. Used by the
// CLOSURE info panel: 1,680 microstates → Newton's G at the 10⁻⁶ level once
// the marked-transfer vertex (Z_e) is included; ~1 % low without it.

import { c, G, M_SUN, G_SHARE_EFF, TET_MICROSTATES, H0, a0 } from '../util/units';

// Reduced electron Compton wavelength λe = ℏ / (m_e c)
const HBAR = 1.054571817e-34;
const M_E  = 9.1093837015e-31;
const LAMBDA_E = HBAR / (M_E * c);            // ≈ 3.86159e-13 m
const PLANCK_LENGTH = 1.616255e-35;            // CODATA

// Paper §6: admissibility closure fixed point. η* is the unique value
// satisfying ⟨K²⟩_η = 3/(2η), giving the saturation factor C_cl := η*·⟨K²⟩ = 3/2.
const ETA_STAR = 0.0298668443935;
const C_CL     = 1.5;                          // closure saturation factor (paper-fixed = 3/2)

// Paper §8: closed-return self-energy from 7 sector-diagonal + 1 shared-singlet motifs
const SIGMA_RET = 65 / 9;

// Paper §13 (substrate length scale). The seven-channel recurrence gives the
// baseline length, and the decorated marked-transfer vertex dresses it:
//   r      = e^{−7 g_share,eff}
//   L*⁽⁰⁾  = −(3/2) λe ln(1 − r)
//   ζ*     = 9 e^{−g_share,eff} (1 − 8η*/49)^{21/2}        = 0.005123584…
//   Z_e    = (1 + ζ*)(1 + 7ζ*²)
//   L*     = Z_e L*⁽⁰⁾                                      = 1.6162537024e-35 m
//   G*     = c³ L*² / ħ                                     = 6.6742890813e-11
// The baseline alone is 1.05 % low in G. The paper records that the marked
// correction was constructed after the residuals were known, so the agreement
// is a high-precision postdiction, not a blind prediction.
export function markedVertex() {
  const zeta = 9 * Math.exp(-G_SHARE_EFF) * Math.pow(1 - 8 * ETA_STAR / 49, 21 / 2);
  return {
    zeta,
    Z_mu: 1 + zeta,
    Z_e: (1 + zeta) * (1 + 7 * zeta * zeta),
    Z_tau2: 1 + (2 / 7) * zeta,
  };
}

export function computeClosure() {
  // Tree-level edge coupling: J_eff_tree = 2η*/9 (paper §7, after rooted-tree z=4 reduction)
  const j_bare       = (2 / 3) * ETA_STAR;
  const j_eff_tree   = 2 * ETA_STAR / 9;
  const j_eff_renorm = j_eff_tree / (1 + j_eff_tree * SIGMA_RET);

  const mv = markedVertex();
  const r = Math.exp(-7 * G_SHARE_EFF);
  const L_star_0 = -C_CL * LAMBDA_E * Math.log1p(-r);     // baseline, before the marked vertex
  const L_star = mv.Z_e * L_star_0;
  const G_star_0 = (c * c * c) * L_star_0 * L_star_0 / HBAR;
  const G_star = (c * c * c) * L_star * L_star / HBAR;
  const tau_star = L_star / c;                            // substrate tick

  // Galactic acceleration scale, paper §15: a₀ = g_share,eff/(4π²)·cH₀, with
  // H₀ the output of the sim's integrated background (core/Cosmology.ts).
  const a_0   = a0;

  const G_dev = (G_star - G) / G * 100;        // % from CODATA G

  return {
    // discrete
    omega_tet: TET_MICROSTATES,                // 1,680 microstates per tetrahedron
    z_coord: 4,                                // tetrahedron face-coordination
    j0: 1.5,                                   // j₀ = 3/2 (fermionic face spin)

    // closure
    eta_star: ETA_STAR,
    c_cl:     C_CL,
    gshare:   G_SHARE_EFF,

    // edge coupling chain
    j_bare,
    j_eff_tree,
    sigma_ret: SIGMA_RET,
    j_eff_renorm,

    // substrate length
    lambda_e: LAMBDA_E,
    zeta_star: mv.zeta,
    Z_e: mv.Z_e,
    L_star_0,
    G_star_0,
    G_dev_0_pct: (G_star_0 - G) / G * 100,
    tau_star,
    H0,
    L_star,
    L_planck: PLANCK_LENGTH,
    L_star_vs_planck_pct: (L_star - PLANCK_LENGTH) / PLANCK_LENGTH * 100,

    // induced gravity
    G_star,
    G_codata: G,
    G_dev_pct: G_dev,

    // galactic constant
    a_0,
    a_0_obs: 1.20e-10,                         // McGaugh 2016 best fit

    // paper's own numerics (sanity targets)
    target_L_star: 1.6162537024e-35,
    target_G_star: 6.6742890813e-11,
  };
}

// One-shot pretty SI formatter ("3.86 × 10⁻¹³ m") for closure numbers.
export function formatSI(value: number, unit = '', digits = 3): string {
  if (value === 0) return `0 ${unit}`.trim();
  const sign = value < 0 ? '−' : '';
  const a = Math.abs(value);
  const exp = Math.floor(Math.log10(a));
  const mantissa = a / Math.pow(10, exp);
  const sup = (exp >= 0 ? '' : '⁻') + Math.abs(exp).toString()
    .split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
  return `${sign}${mantissa.toFixed(digits)} × 10${sup} ${unit}`.trim();
}

// Hawking thermodynamics for a Schwarzschild BH of mass M (kg).
// Paper §21 / App. F: T_H follows from the GR exterior (surface gravity of
// N² = q) and is semiclassical; S_BH = k_B A/(4L*²) uses the matched branch
// L_P = L*, where the area law supplies the normalisation (one cut carries
// ln 2). The paper is explicit that this is not independent evidence for the
// area law. t_evap below is the standard semiclassical lifetime; it is not a
// result of the paper.
const K_B = 1.380649e-23;
export function hawking(massKg: number) {
  const rs   = 2 * G * massKg / (c * c);
  const T_H  = (HBAR * c * c * c) / (8 * Math.PI * G * massKg * K_B);
  const A    = 4 * Math.PI * rs * rs;
  const S_BH = (K_B * c * c * c * A) / (4 * HBAR * G);
  // Lifetime via Hawking radiation, t_evap ≈ 5120π G² M³ / (ℏ c⁴)
  const t_evap = (5120 * Math.PI * G * G * massKg * massKg * massKg) / (HBAR * c * c * c * c);
  return { rs, T_H, S_BH, t_evap, area: A, mass: massKg };
}

// Solar-mass shorthand for sim-unit BHs.
export function hawkingSolar(massMsun: number) { return hawking(massMsun * M_SUN); }

// Vikram, Shou, Galitski (arXiv 2404.15403; Phys. Rev. Lett. 2026):
// universal lower bound on Hamiltonian scrambling time at finite T,
//   t_scr ≳ (β ℏ / 2π) · ln(S/k_B),    β = 1/(k_B T)
// For Schwarzschild BHs this reproduces the Hayden–Preskill / Sekino–
// Susskind fast-scrambling bound — originally motivated by black holes,
// proven rigorous as a property of QM. This is external physics applied to
// the paper's §21 thermodynamic quantities; the paper itself makes no
// scrambling-time claim.
export function scrambling(massKg: number) {
  const h = hawking(massKg);
  const beta = 1 / (K_B * h.T_H);
  const lnS  = Math.log(h.S_BH / K_B);
  const t_scr = (beta * HBAR / (2 * Math.PI)) * lnS;
  return { t_scr, beta, lnS, T_H: h.T_H, S_BH: h.S_BH };
}

// Vikram bound applied to a single substrate cell. The cell entropy is the
// admissibility-closed sharing entropy g_share,eff = 7.42 (paper §6); the
// cell temperature has no manuscript-defined value, so we expose it as a
// parameter. Returns the floor time below which the cell cannot have fully
// scrambled its 1,680 microstates.
export function cellScrambling(T_cell_K: number) {
  const lnS = Math.log(G_SHARE_EFF);     // ≈ 2.0; S/k_B = g_share,eff
  const beta = 1 / (K_B * T_cell_K);
  const t_scr = (beta * HBAR / (2 * Math.PI)) * lnS;
  return { t_scr, beta, lnS };
}

// Charged-lepton mass ratios (paper §13.5):
//   m_μ/m_e = 720·(2/7)·Z_μ                 = 206.768280237   (−0.535σ)
//   m_τ/m_e = 720²·(2/7)⁴·Z_μ·Z_τ,2         = 3477.343310     (−0.125σ)
// with Z_μ = 1 + ζ*, Z_τ,2 = 1 + (2/7)ζ* from the same marked vertex that
// dresses L*. The shell integers alone (no marked response) give 205.71 and
// 3454.6, within 0.51 % and 0.65 %.
const M_MU_PDG  = 206.7682830;       // PDG ratio m_μ/m_e
const M_TAU_PDG = 3477.23;           // PDG ratio m_τ/m_e

export function leptonLadder() {
  const mv = markedVertex();
  const shell = (N: number) => Math.pow(720, N) * Math.pow(2 / 7, N * N);
  const r_mu  = shell(1) * mv.Z_mu;
  const r_tau = shell(2) * mv.Z_mu * mv.Z_tau2;
  return {
    formula: 'm_μ/m_e = 720·(2/7)·Z_μ ,  m_τ/m_e = 720²·(2/7)⁴·Z_μ·Z_τ,2',
    electron: { N: 0, predicted: 1,     shell: 1,        pdg: 1,         devPct: 0 },
    muon:     { N: 1, predicted: r_mu,  shell: shell(1), pdg: M_MU_PDG,  devPct: (r_mu  - M_MU_PDG)  / M_MU_PDG  * 100 },
    tau:      { N: 2, predicted: r_tau, shell: shell(2), pdg: M_TAU_PDG, devPct: (r_tau - M_TAU_PDG) / M_TAU_PDG * 100 },
  };
}
