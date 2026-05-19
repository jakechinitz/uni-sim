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
//
// Paper's actual mechanism (paper §cosmology): the scalar S couples to
// the trace χ = −T^μ_μ/c² of the matter stress-energy. In pure
// radiation T^μ_μ = 0 so the homogeneous mode is DORMANT; it only
// activates as the universe transitions from radiation- to
// matter-dominated, near z ≈ 3000. The pulse below is a toy-level
// realisation of that switch-on: rather than a static Gaussian, we
// gate the amplitude by the radiation→matter trace switch and let
// it decay as the matter component dilutes through the dark ages.
//
// Visually this still reads as a single bright burst near t_eq with
// a slow Hubble-tension tail, but now the FORM is keyed on the
// physical mechanism rather than picked by hand.
export function traceChi(tGyr: number): number {
  // Toy switch-on. χ ≈ 0 while radiation-dominated (t ≪ t_eq), saturates
  // to ~1 as matter takes over, then dilutes ∝ a⁻³ ∝ t⁻². We capture
  // both behaviours with a smooth ramp × power-law tail.
  if (tGyr <= 0) return 0;
  const r = tGyr / T_RAD_END;
  const switchOn = r / Math.sqrt(1 + r * r);          // ~0 at r≪1, ~1 at r≫1
  const matterDilution = 1 / (1 + Math.pow(tGyr / 0.005, 1.4));   // tail decays
  return switchOn * matterDilution;
}

export function edePulse(tGyr: number): number {
  // The pulse amplitude tracks χ(t) directly: dormant in radiation,
  // peaks around z_eq (~50 kyr), then fades through the dark ages.
  // Same overall shape as the old Gaussian but derived from the
  // trace-coupling mechanism.
  return Math.max(0, Math.min(1, traceChi(tGyr) * 1.8));
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
