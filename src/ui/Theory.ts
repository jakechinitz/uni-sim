// "Theory" panel: what this simulator actually computes, formula by formula,
// and how far each step is established in the paper's Lean ledger
// (github.com/jakechinitz/Entropic-EFT-Lean, ledger/LEDGER.md).
//
// The point is honesty about status. A row marked "proved" names the Lean
// theorems that kernel-check it; "given premise" is proved once a stated
// physical premise is granted; "premise" is an assumption of the theory;
// "input" is measured, not derived; "method" is a standard numerical or
// textbook technique chosen by this simulator; "decorative" is drawn for
// legibility and carries no physical claim.

import { LITTLE_H, OMEGA_LAMBDA, OMEGA_M, T_TODAY, I_REL, Z_EQ, H0_KMS_MPC, STOCK_PER_BARYON } from '../core/Cosmology';
import { computeClosure } from '../core/Closure';

type Status = 'proved' | 'given' | 'premise' | 'input' | 'method' | 'decor' | 'open';
const LABEL: Record<Status, string> = {
  proved: 'proved', given: 'given premise', premise: 'premise', input: 'input',
  method: 'method', decor: 'decorative', open: 'open issue',
};

interface Row { what: string; eq?: string; note?: string; lean?: string; status: Status; }
interface Group { title: string; rows: Row[]; }

const GROUPS: Group[] = [
  {
    title: 'Cosmic web',
    rows: [
      {
        what: 'Expansion history', status: 'given',
        eq: 'h²E² = ω_r a⁻⁴ + ω_b a⁻³ + ω_c e^{−η*F_rel} a⁻³ + η* ω_c ∫ a⁻³ e^{−η*F_rel} dF_rel',
        note: 'Integrated here, not fitted. Committed stock drains into the vacuum with w = −1 (premise) from ρ_Λ,i = 0 (adopted). The drain law is unique and the effective equation of state is proved.',
        lean: 'PositiveLedger.common_fractional_drain_unique · AppO.effective_w · Main.Cosmo.zero_cap_density',
      },
      {
        what: 'Release history F_rel(z)', status: 'input',
        note: 'The paper\'s frozen, no-fit history: mean of six measured mixing kernels with reionization at z = 7.66. No dark-sector parameter is fitted.',
      },
      {
        what: 'Stock abundance', status: 'given',
        eq: `Ω_c / Ω_b = 1/ε = 5.3207  →  ${STOCK_PER_BARYON} after formation mass conversion`,
        lean: 'Main.Core.abundance · Spine.epsilon_bracket · AppO.Num.capacity_baryon_ratio',
      },
      {
        what: 'Early pulse at equality', status: 'premise',
        eq: 'f_EDE = 0.018 ± 0.010 at z_c = 3400',
        note: 'A structurally supported extension; the perturbation calculation is open and it has no ledger row. It changes H by about 1 % at its peak and is invisible in the web.',
      },
      {
        what: 'Growth of structure', status: 'method',
        eq: 'x″ + 2H x′ = −∇φ/a² ,  ∇²φ = 4πG ρ̄ a² δ',
        note: 'Particle-mesh N-body of baryons plus stock as collisionless, pressureless dust (the paper\'s stated equation of state). The galactic response law is not applied: cosmological stock enters no response cell.',
      },
      {
        what: 'Initial fluctuations', status: 'input',
        eq: 'P(k) ∝ kⁿ T²(k) ,  n_s = 0.965 ,  σ₈ = 0.81',
        note: 'Cold-matter transfer shape (Eisenstein–Hu) for the paper\'s ω_m, ω_b. Amplitude and tilt are observational inputs; the paper fits them and does not derive them.',
      },
      {
        what: 'Which parcels shine', status: 'decor',
        note: 'Brightness follows each parcel\'s collapsed fraction at the retention-gate mass (extended Press–Schechter), with a display gamma and a camera-style auto-exposure that brightens the young, faint universe. Colour, size and the spherical cut are for legibility.',
      },
    ],
  },
  {
    title: 'Galaxy',
    rows: [
      {
        what: 'Response law', status: 'given',
        eq: 'g_obs = g_bar / (1 − e^{−√(g_bar/a₀)})',
        note: 'Proved from the Bose occupation of the response cell, which is the premise.',
        lean: 'GalacticLaw.gObs_thermal · AppKN.radial_divfree_zero',
      },
      {
        what: 'Limits of the law', status: 'proved',
        eq: 'g ≫ a₀: Newtonian ·  g ≪ a₀: g_obs → √(a₀ g_bar) ·  v⁴ → G M a₀',
        lean: 'GalacticLaw.newtonian_limit · GalacticLaw.deep_limit · GalacticLaw.btfr_fourth_power',
      },
      {
        what: 'Acceleration scale', status: 'given',
        eq: 'a₀(z) = ε c H(z) ,  ε = g_share,eff / 4π² = 0.18795',
        note: 'Follows from the horizon tilt-mode premise. H(z) is this simulator\'s integrated background, so a₀ was larger in the past.',
        lean: 'RAR.tilt_frequency_sq · RAR.gap_eq · Main.Galactic.a0_value',
      },
      {
        what: 'Disk rule', status: 'given',
        eq: 'J_⊥ = n_B(x̃)(ê·∇Φ_b) ê ,  ∇²φ_⊥ = ∇·J_⊥ ,  ê ≈ radial',
        note: 'The paper\'s direction-stiffness completion for resolved disks. Here the director is the radial unit vector and the in-plane excess is J_⊥ itself: exact for an axisymmetric disk, within about 0.01 dex of the full solve on real rotation curves. The field equations are proved in part.',
      },
      {
        what: 'Self-gravitating stellar disk', status: 'method',
        note: 'Particle-mesh gravity among 24,000 stars with warm Toomre-stable initial conditions. Bars and arms that appear are emergent. The disk is razor-thin and the stock is taken at its equilibrium, not evolved.',
      },
      {
        what: 'Painted disk (self-gravity off)', status: 'decor',
        note: 'Stars ride prescribed density-wave orbits on the law\'s rotation curve. Dust lanes and star-forming regions are artwork.',
      },
    ],
  },
  {
    title: 'Planetary system',
    rows: [
      {
        what: 'Gravity inside a star system', status: 'given',
        eq: 'Newtonian ·  Q₂^{⊙,⊥} = 0 ·  PPN γ = β = 1',
        note: 'By the carrier rule a star inside a galaxy has no response halo of its own, so orbits here are Newtonian by rule and not only as a limit. Orbits run at the labelled rate with distances to scale (1 AU = 29 scene units, P² = a³/M), held at 20 years per second so they stay visible. Body sizes are not to scale.',
      },
    ],
  },
  {
    title: 'Black holes',
    rows: [
      {
        what: 'Lapse and exterior', status: 'proved',
        eq: 'N² = q ,  q = 1 − 2GM/(c²r)',
        note: 'Stopping the domain at q = 0 is a physical postulate of the paper.',
        lean: 'BlackHole.lapse_is_sqrt · BlackHole.lapse_sq_eq_qgeo · BlackHole.qS_sign',
      },
      {
        what: 'Hawking temperature', status: 'given',
        eq: 'T_H = ħc³ / (8πGMk_B)',
        note: 'From the surface gravity of the exterior; semiclassical premise.',
        lean: 'BlackHole.surface_gravity_from_q · BlackHole.hawking_temperature',
      },
      {
        what: 'Horizon entropy', status: 'given',
        eq: 'S = k_B A / (4L*²) ,  one cut carries ln 2',
        note: 'Uses the matched branch L_P = L*. The paper says this is not independent evidence for the area law.',
        lean: 'BlackHole.entropy_eq · AppFG.cut_entropy · Spine.horizon_quarter',
      },
      {
        what: 'Evaporation and scrambling times', status: 'method',
        note: 'Standard semiclassical results shown on hover cards. They are not claims of the paper.',
      },
      {
        what: 'Black-hole size on screen', status: 'decor',
        note: 'Drawn tens of millions of times too large to be visible at galaxy scale. Every number on the hover card is the real value.',
      },
    ],
  },
  {
    title: 'Substrate and transport',
    rows: [
      {
        what: 'Boundary state count', status: 'proved',
        eq: 'Ω_tet = 2·P(7,4) = 1,680',
        lean: 'EFT.UV.boundaryStates_card · AppIJ.sorted_orbits',
      },
      {
        what: 'Closure point and sharing entropy', status: 'proved',
        eq: 'η* = 0.0298668443935 ,  g_share,eff = 7.41980002357',
        note: 'Existence, uniqueness and rigorous numerical brackets.',
        lean: 'ClosureRoot.stationary_exists · ClosureRoot.stationary_unique · ClosureRoot.stationary_bracket · ClosureRoot.gshare_bracket',
      },
      {
        what: 'Telegrapher transport', status: 'premise',
        eq: 'τ₀ ∂²δS + ∂δS = D∇²δS ,  D/τ₀ = c²',
        note: 'The causal-speed relation is closed in the canonical branch; τ₀ = 1/H₀ is a no-new-scale choice.',
        lean: 'AppCDE.characteristic_speed · Main.Galactic.transport_parameters',
      },
      {
        what: 'Capacity stays in [0, 1]', status: 'open',
        note: 'Refuted as stated: a hyperbolic flux system can overshoot. The lattice here clamps q with a limiter that has no invariant-domain proof.',
        lean: 'AppFG.capacity_overshoot',
      },
      {
        what: 'Atoms and the lattice picture', status: 'decor',
        note: 'Schematic, and drawn enormously larger than reality.',
      },
    ],
  },
  {
    title: 'Constants and histories',
    rows: [
      {
        what: 'Newton\'s constant and lepton ratios', status: 'given',
        eq: 'L* = Z_e L*⁽⁰⁾ ,  G* = c³L*²/ħ ,  m_μ/m_e = 720·(2/7)·Z_μ',
        note: 'A conditional chain with the electron as the single anchor. The marked vertex was built after the residuals were known, so the agreement is a postdiction. Open the closure panel for the numbers.',
      },
      {
        what: 'Many-Pasts overlay', status: 'decor',
        eq: 'p(h|P) = D(h,h) / Σ D(h′,h′)',
        note: 'The ghost trails only illustrate that several decohered histories are compatible with the present record. They are not extra worlds and exert no force.',
      },
    ],
  },
];

function render(): string {
  const k = computeClosure();
  const live = [
    ['h', LITTLE_H.toFixed(3)], ['H₀', `${H0_KMS_MPC.toFixed(1)} km/s/Mpc`], ['Ω_Λ', OMEGA_LAMBDA.toFixed(3)],
    ['Ω_m', OMEGA_M.toFixed(3)], ['age', `${T_TODAY.toFixed(2)} Gyr`], ['z_eq', Z_EQ.toFixed(0)],
    ['I_rel', I_REL.toFixed(1)], ['a₀', `${(k.a_0 * 1e10).toFixed(3)} × 10⁻¹⁰ m/s²`],
    ['G*', `${(k.G_star * 1e11).toFixed(5)} × 10⁻¹¹`],
  ].map(([n, v]) => `<span>${n} = <b>${v}</b></span>`).join('');
  const legend = (Object.keys(LABEL) as Status[]).map(s => `<span class="th-tag ${s}">${LABEL[s]}</span>`).join('');
  const groups = GROUPS.map(g => `<div class="th-group">${g.title}</div>` + g.rows.map(r => `
    <div class="th-row">
      <div>
        <div class="th-what">${r.what}</div>
        ${r.eq ? `<div class="th-eq">${r.eq}</div>` : ''}
        ${r.note ? `<div class="th-note">${r.note}</div>` : ''}
        ${r.lean ? `<div class="th-lean">Lean: ${r.lean}</div>` : ''}
      </div>
      <span class="th-tag ${r.status}">${LABEL[r.status]}</span>
    </div>`).join('')).join('');
  return `
    <div class="th-intro">
      Everything that moves on screen is listed here with the equation behind it and its status in the theory's
      Lean formalization
      (<a href="https://github.com/jakechinitz/Entropic-EFT-Lean" target="_blank" rel="noopener">Entropic-EFT-Lean</a>).
      That ledger tracks 1,437 statements of the paper: 882 proved, 90 proved in part, 152 physical premises,
      59 numerical enclosures, 64 data comparisons and 136 not yet formalized.
      The numbers below are outputs of this page's own integration. The only cosmological inputs are the baryon
      density, the radiation density and the release history.
    </div>
    <div class="th-live">${live}</div>
    <div class="th-legend">${legend}</div>
    ${groups}`;
}

export function bindTheoryPanel() {
  const btn = document.getElementById('btn-theory') as HTMLButtonElement | null;
  const close = document.getElementById('btn-theory-close') as HTMLButtonElement | null;
  const panel = document.getElementById('theory-panel') as HTMLDivElement | null;
  const body = document.getElementById('theory-body') as HTMLDivElement | null;
  if (!btn || !close || !panel || !body) return;
  const hide = () => { panel.classList.add('hidden'); btn.classList.remove('on'); };
  btn.addEventListener('click', () => {
    if (!body.dataset.rendered) { body.innerHTML = render(); body.dataset.rendered = '1'; }
    const open = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden', open);
    btn.classList.toggle('on', !open);
  });
  close.addEventListener('click', hide);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}
