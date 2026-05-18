// Scale factor a(t), redshift z(t), and epoch labels.
// Curve-fit (not integrated Friedmann), with an EDE pulse near z_eq for the Hubble-tension story.

import { T_UNIV, Z_EQ, Z_RECOMB, Z_FIRST_BH, Z_GALAXIES } from '../util/units';
import { smoothstep } from '../util/lerp';

// All times in Gyr.
const T_BB        = 0;
const T_RAD_END   = 5e-5;       // ~50 kyr in Gyr (~ matter-rad equality)
const T_RECOMB    = 3.8e-4;     // ~380 kyr
const T_FIRST_BH  = 0.15;
const T_GALAXIES  = 0.7;
const T_TODAY     = T_UNIV;

// Baseline a(t) — radiation -> matter -> Λ-onset.
// Built so a(today) = 1 exactly.
function aBase(tGyr: number): number {
  if (tGyr <= 0) return 1e-9;
  const t = tGyr;

  // Pick branch by epoch
  // a_rad(t) ∝ t^{1/2}, a_mat(t) ∝ t^{2/3}, a_lam picks up after t≈9.8 Gyr
  // Choose constants so the branches join smoothly at t_eq and a(today)=1.
  const t_eq = T_RAD_END;
  // a at t_eq from matter-dom extrapolation: a_eq = (t_eq / today)^{2/3}
  const a_eq = Math.pow(t_eq / T_TODAY, 2 / 3);

  if (t < t_eq) {
    return a_eq * Math.sqrt(t / t_eq);
  }
  // Smooth matter→Λ transition near 9.8 Gyr
  const aM = Math.pow(t / T_TODAY, 2 / 3);
  const lamOn = smoothstep(9.0, 11.0, t);
  // gentle Λ bump pushing a up toward 1 today
  const aL = aM * (1 + 0.08 * lamOn);
  return aL;
}

// EDE pulse: brief boost of the homogeneous mode near z ~ Z_EQ.
// Visually a "breath" in cosmic-web spacing and a rim glow strength.
export function edePulse(tGyr: number): number {
  // peak near t_eq, width ~ factor of 3 in log-t
  if (tGyr <= 0) return 0;
  const lt  = Math.log10(tGyr);
  const lt0 = Math.log10(T_RAD_END);
  const sig = 0.35;
  const x   = (lt - lt0) / sig;
  return Math.exp(-x * x);
}

export function a(tGyr: number): number {
  // small additive expansion from EDE pulse so the visible "breath" exists
  return aBase(tGyr) * (1 + 0.05 * edePulse(tGyr));
}

export function z(tGyr: number): number {
  return Math.max(0, 1 / Math.max(1e-9, a(tGyr)) - 1);
}

export type EpochKey = 'BIG_BANG' | 'RADIATION' | 'HUBBLE_PULSE' | 'RECOMBINATION'
                     | 'DARK_AGES' | 'FIRST_LIGHT' | 'GALAXIES' | 'CLUSTERS' | 'TODAY';

export function epoch(tGyr: number): { key: EpochKey; label: string } {
  if (tGyr <= 1e-8)             return { key: 'BIG_BANG',     label: 'Big Bang' };
  if (tGyr <  T_RAD_END * 0.6)  return { key: 'RADIATION',    label: 'Radiation Era' };
  if (tGyr <  T_RAD_END * 1.6)  return { key: 'HUBBLE_PULSE', label: 'Hubble-Tension Pulse' };
  if (tGyr <  T_RECOMB)         return { key: 'RECOMBINATION', label: 'Recombination' };
  if (tGyr <  T_FIRST_BH)       return { key: 'DARK_AGES',    label: 'Dark Ages' };
  if (tGyr <  T_GALAXIES)       return { key: 'FIRST_LIGHT',  label: 'First Stars · Black Holes' };
  if (tGyr <  4)                return { key: 'GALAXIES',     label: 'Galaxies Condense' };
  if (tGyr <  12)               return { key: 'CLUSTERS',     label: 'Clusters & Cosmic Web' };
  return                          { key: 'TODAY',        label: 'Today' };
}

// Visual checkpoints used by regimes
export const checkpoints = {
  T_BB, T_RAD_END, T_RECOMB, T_FIRST_BH, T_GALAXIES, T_TODAY,
  Z_EQ, Z_RECOMB, Z_FIRST_BH, Z_GALAXIES
};
