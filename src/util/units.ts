// Physical constants & length scales. Paper-faithful values where relevant.

import { H0_SI, T_TODAY } from '../core/Cosmology';

export const G   = 6.67430e-11; // SI Newton constant, CODATA 2018 (±0.00015)
export const c   = 299792458;   // m/s (exact)
// Hubble constant today, s⁻¹ — an OUTPUT of the sim's integrated background
// (core/Cosmology.ts: h = 0.693 from ω_b and the paper's release history).
export const H0  = H0_SI;

// Paper-derived structure invariants
export const TET_FACES   = 4;
export const FACE_STATES = 7;
export const TET_MICROSTATES = 1680;
// Paper line 558 (App. B): g_share,eff = 7.41980002357 — admissibility-
// closed effective sharing entropy. Using full paper precision so the
// L* and G* downstream numbers match the paper's target values
// (L* = 1.60771947 × 10⁻³⁵ m, G* = 6.60399128 × 10⁻¹¹ m³ kg⁻¹ s⁻²).
export const G_SHARE_EFF = 7.41980002357;

// a₀ = g_share,eff · cH₀ / (4π²) = ε c H₀ (paper §15). With the background's
// own H₀ = 69.3 km/s/Mpc this is 1.27 × 10⁻¹⁰ m/s² (paper: 1.27 ± 0.04;
// McGaugh's empirical value is 1.20). At redshift z the scale is
// a₀(z) = ε c H(z). Used everywhere instead of a hardcoded value so the live
// sim, the Closure panel and the paper agree.
export const a0 = (G_SHARE_EFF / (4 * Math.PI * Math.PI)) * c * H0;

export const M_SUN = 1.989e30;  // kg
export const M_EARTH = 5.972e24;
export const PC    = 3.086e16;  // m
export const KPC   = 1e3 * PC;
export const MPC   = 1e6 * PC;
export const AU    = 1.496e11;
export const LY    = 9.461e15;
export const GYR   = 3.156e16;  // s
// Age of the universe today (Gyr): t(a = 1) of the integrated background, ≈ 13.70.
export const T_UNIV = T_TODAY;

// Cosmology

export const SCALE = {
  // log10(metres) midpoint for each regime
  COSMIC:    25,
  GALAXY:    21,
  SYSTEM:    13,
  ATOMIC:    -10,
  SUBSTRATE: -16,
} as const;

// Speed-slider semantics: PURE LOG-MAGNITUDE of forward sim_sec/wall_sec.
// Range covers ~36 orders of magnitude. Negative exp = slow-mo forward
// (Quantum, Light), positive = fast forward (Year/s, Gyr/s). exp = 0 is
// 1× real time. Pause / rewind are separate states managed by the Clock:
// pause flips clock.playing; rewind flips clock.direction. This avoids
// the prior "negative exp = rewind" confusion where Light slow-mo was
// silently making time run backwards.
export const SPEED_EXP_MIN = -18;
export const SPEED_EXP_MAX = 18;
export const SPEED_EXP_DEFAULT = 16.5;

// Convert speed-exponent → sim_sec / wall_sec (always positive forward rate).
export function expToRate(exp: number): number {
  return Math.pow(10, exp);
}

// Human-readable formatting of a sim_sec/wall_sec rate.
const _MIN = 60, _HR = 3600, _DAY = 86400, _YR = 3.156e7;
export function formatRate(rate: number): string {
  if (rate === 0) return 'paused';
  const sign = rate < 0 ? '↶ ' : '';
  const a = Math.abs(rate);
  if (a < 1e-12) return `${sign}${(a * 1e15).toFixed(2)} fs/s`;
  if (a < 1e-9)  return `${sign}${(a * 1e12).toFixed(2)} ps/s`;
  if (a < 1e-6)  return `${sign}${(a * 1e9).toFixed(2)} ns/s`;
  if (a < 1e-3)  return `${sign}${(a * 1e6).toFixed(1)} μs/s`;
  if (a < 0.5)   return `${sign}${(a * 1e3).toFixed(0)} ms/s`;
  if (a < 50)    return `${sign}${a.toFixed(2)}× real`;
  if (a < _HR)   return `${sign}${(a / _MIN).toFixed(1)} min/s`;
  if (a < _DAY)  return `${sign}${(a / _HR).toFixed(1)} hr/s`;
  if (a < _YR)   return `${sign}${(a / _DAY).toFixed(1)} day/s`;
  if (a < 1e6 * _YR) return `${sign}${(a / _YR).toFixed(0)} yr/s`;
  if (a < 1e9 * _YR) return `${sign}${(a / (1e6 * _YR)).toFixed(1)} Myr/s`;
  return `${sign}${(a / (1e9 * _YR)).toFixed(2)} Gyr/s`;
}

// Preset speed stops. The slider snaps to these when chips are clicked.
export const SPEED_PRESETS = [
  { label: 'Quantum',  exp: -15, hint: 'fs/s — telegrapher ripples visible' },
  { label: 'Light',    exp: -2,  hint: 'see photons cross a system' },
  { label: 'Real',     exp: 0,   hint: '1× wall time' },
  { label: 'Day/s',    exp: 4.94, hint: 'Earth spins in a second' },
  { label: 'Year/s',   exp: 7.5,  hint: 'planetary orbit per second' },
  { label: 'Myr/s',    exp: 13.5, hint: 'galaxy rotates per second' },
  { label: 'Gyr/s',    exp: 16.5, hint: 'universe evolves visibly' },
];
