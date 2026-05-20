// Closure chain — paper §6–9, §13. The whole UV-to-IR derivation as a single
// computation, with every number traceable to the prior step. Used by the
// CLOSURE info panel to show that 1,680 microstates → Newton's G to ~1%.

import { c, G, M_SUN, G_SHARE_EFF, TET_MICROSTATES } from '../util/units';

// Reduced electron Compton wavelength λe = ℏ / (m_e c)
const HBAR = 1.054571817e-34;
const M_E  = 9.1093837e-31;
const LAMBDA_E = HBAR / (M_E * c);            // ≈ 3.86159e-13 m
const PLANCK_LENGTH = 1.616255e-35;            // CODATA

// Paper §6: admissibility closure fixed point. η* is the unique value
// satisfying ⟨K²⟩_η = 3/(2η), giving the saturation factor C_cl := η*·⟨K²⟩ = 3/2.
const ETA_STAR = 0.0298668443935;
const C_CL     = 1.5;                          // closure saturation factor (paper-fixed = 3/2)

// Paper §8: closed-return self-energy from 7 sector-diagonal + 1 shared-singlet motifs
const SIGMA_RET = 65 / 9;

// Paper §13: faithful sector resolution
//   ln(λe / L*) = 7·g_share,eff − ln(C_cl)
//   ⇒ L* = (C_cl / 1) · λe · exp(−7·g_share,eff)
//   (paper writes the prefactor as 3/2; here C_cl makes the structural origin explicit)
export function computeClosure() {
  // Tree-level edge coupling: J_eff_tree = 2η*/9 (paper §7, after rooted-tree z=4 reduction)
  const j_bare       = (2 / 3) * ETA_STAR;
  const j_eff_tree   = 2 * ETA_STAR / 9;
  const j_eff_renorm = j_eff_tree / (1 + j_eff_tree * SIGMA_RET);

  const L_star = C_CL * LAMBDA_E * Math.exp(-7 * G_SHARE_EFF);
  const G_star = (c * c * c) * L_star * L_star / HBAR;

  // Galactic acceleration scale from paper §14: a₀ = g_share,eff/(4π²)·cH₀
  const H0    = 2.18e-18;                      // s⁻¹
  const a_0   = (G_SHARE_EFF / (4 * Math.PI * Math.PI)) * c * H0;

  const G_dev = (G_star - G) / G * 100;        // % below CODATA G

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
    target_L_star: 1.60771947e-35,
    target_G_star: 6.60399128e-11,
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
// Paper §20: T_H, S_BH = A/4·(k_B c³/ℏG) emerge from substrate counting
// (ln 2 per fermionic face) — not fit, identity.
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
// proven rigorous as a property of QM. Cleanly composes with the paper's
// §20 thermodynamics (S_BH = A/4, T_H = ℏc³/8πGMk_B emerge from substrate
// counting), giving an actual measurable scrambling timescale per BH.
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

// Charged-lepton mass ladder (paper §I.1, eq. immediately above the
// "Mass ladder and numerical accuracy" subhead):
//   m_N/m_e = 720^N · (2/7)^{N²},   N = 0, 1, 2
// where N indexes the three charged-lepton generations (0 = electron,
// 1 = muon, 2 = tau). The 720 is the first-shell reduced-alphabet
// entropy (e^ln 720), the (2/7) is the orientation-summed singlet
// projection from the same 7-state alphabet that fixes Ω_tet = 1680,
// and the N² exponent is the source-norm structure of the scalar EFT.
// No fitted parameters; paper-reported residuals 0.5 % (μ), 0.7 % (τ).
// Three-generation termination follows from closure-spectrum collapse
// at N=3, not assumed (paper §I.1).
const M_MU_PDG  = 206.7682830;       // PDG ratio m_μ/m_e
const M_TAU_PDG = 3477.23;           // PDG ratio m_τ/m_e

export function leptonLadder() {
  const ratio = (N: number) => Math.pow(720, N) * Math.pow(2 / 7, N * N);
  const r_mu   = ratio(1);
  const r_tau  = ratio(2);
  return {
    formula: 'm_N/m_e = 720^N · (2/7)^{N²}',
    electron: { N: 0, predicted: ratio(0), pdg: 1,         devPct: 0 },
    muon:     { N: 1, predicted: r_mu,     pdg: M_MU_PDG,  devPct: (r_mu  - M_MU_PDG)  / M_MU_PDG  * 100 },
    tau:      { N: 2, predicted: r_tau,    pdg: M_TAU_PDG, devPct: (r_tau - M_TAU_PDG) / M_TAU_PDG * 100 },
  };
}
