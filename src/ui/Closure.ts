// Closure-chain modal — renders the live numeric derivation
// 1,680 microstates → η* → g_share,eff → L*⁽⁰⁾ → Z_e → L* → G*
// (paper §6–9, §13). Every value is computed, not hard-coded. The edge
// coupling J_eff is shown for completeness; it cancels out of G and a₀.

import { computeClosure, formatSI, leptonLadder } from '../core/Closure';

interface ChainRow {
  step: string;
  what: string;
  detail?: string;
  value: string;
  tone?: 'match' | 'dev';
}

function chainRows(): ChainRow[] {
  const k = computeClosure();
  return [
    {
      step: '1',
      what: 'Tetrahedral microstates',
      detail: 'Ω_tet = 2·P(7,4): 4 faces, 7 face-states, injective labellings × 2 orientations',
      value: `Ω = ${k.omega_tet.toLocaleString()}`
    },
    {
      step: '2',
      what: 'Closure fixed point',
      detail: '⟨K²⟩_η = 3/(2η) → unique η*',
      value: `η* = ${k.eta_star.toFixed(7)}`
    },
    {
      step: '3',
      what: 'Sharing entropy',
      detail: 'entropy of the e^{−ηK²}-weighted ensemble at η*',
      value: `g_share,eff = ${k.gshare.toFixed(4)}`
    },
    {
      step: '4',
      what: 'Bare edge coupling',
      detail: 'tetrahedral transverse fraction 2/3 × η*',
      value: `J_bare = ${k.j_bare.toFixed(6)}`
    },
    {
      step: '5',
      what: 'Tree-level reduction',
      detail: 'rooted z = 4 graph → J_eff^tree = 2η*/9',
      value: `J_eff^tree = ${k.j_eff_tree.toFixed(6)}`
    },
    {
      step: '6',
      what: 'Loop dressing',
      detail: 'Σ_ret = 65/9 from 7 sector-diag + 1 shared-singlet · cancels out of G and a₀',
      value: `J_eff^(ren) = ${k.j_eff_renorm.toFixed(6)}`
    },
    {
      step: '7',
      what: 'Electron anchor',
      detail: 'reduced Compton λe = ℏ/(m_e c)',
      value: formatSI(k.lambda_e, 'm')
    },
    {
      step: '8',
      what: 'Baseline length',
      detail: `L*⁽⁰⁾ = −(3/2)·λe·ln(1 − e^{−7g}) · alone gives G ${k.G_dev_0_pct.toFixed(2)} % from CODATA`,
      value: formatSI(k.L_star_0, 'm', 5)
    },
    {
      step: '9',
      what: 'Marked-transfer vertex',
      detail: 'ζ* = 9e^{−g}(1 − 8η*/49)^{21/2},  Z_e = (1 + ζ*)(1 + 7ζ*²)',
      value: `ζ* = ${k.zeta_star.toFixed(9)} · Z_e = ${k.Z_e.toFixed(8)}`
    },
    {
      step: '10',
      what: 'Substrate length',
      detail: `L* = Z_e·L*⁽⁰⁾ · Planck length ${formatSI(k.L_planck, 'm', 5)} · tick τ* = L*/c = ${formatSI(k.tau_star, 's')}`,
      value: formatSI(k.L_star, 'm', 7)
    },
    {
      step: '11',
      what: 'Induced gravity',
      detail: 'G* = c³ L*² / ℏ',
      value: formatSI(k.G_star, 'm³ kg⁻¹ s⁻²', 7)
    },
    {
      step: '✓',
      what: 'Match to Newton',
      detail: `CODATA G = ${formatSI(k.G_codata, '', 5)} ± 0.00015`,
      value: `${((k.G_star - k.G_codata) / 0.00015e-11).toFixed(3)} σ  (${(k.G_dev_pct * 1e4).toFixed(1)} ppm)`,
      tone: Math.abs(k.G_dev_pct) < 0.01 ? 'match' : 'dev'
    },
    {
      step: '★',
      what: 'Galactic acceleration',
      detail: `a₀ = g_share,eff/(4π²)·cH₀ — paper §15 · H₀ = ${(k.H0 / 3.240779e-20).toFixed(1)} km/s/Mpc from this sim's integrated background · observed 1.20 × 10⁻¹⁰`,
      value: formatSI(k.a_0, 'm/s²'),
      tone: Math.abs((k.a_0 - k.a_0_obs) / k.a_0_obs) < 0.1 ? 'match' : undefined
    },
  ];
}

function leptonRows(): ChainRow[] {
  const L = leptonLadder();
  const ppm = (d: number) => `${d > 0 ? '+' : ''}${(d * 1e4).toFixed(2)} ppm`;
  return [
    {
      step: 'μ',
      what: 'Muon mass ratio',
      detail: `720·(2/7)·Z_μ,  Z_μ = 1 + ζ* · shell integers alone: ${L.muon.shell.toFixed(2)}`,
      value: `${L.muon.predicted.toFixed(6)} (PDG ${L.muon.pdg.toFixed(6)}; ${ppm(L.muon.devPct)})`,
      tone: Math.abs(L.muon.devPct) < 0.01 ? 'match' : undefined
    },
    {
      step: 'τ',
      what: 'Tau mass ratio',
      detail: `720²·(2/7)⁴·Z_μ·Z_τ,2,  Z_τ,2 = 1 + (2/7)ζ* · shell integers alone: ${L.tau.shell.toFixed(1)}`,
      value: `${L.tau.predicted.toFixed(3)} (PDG ${L.tau.pdg.toFixed(2)} ± 0.09; ${ppm(L.tau.devPct)})`,
      tone: Math.abs(L.tau.devPct) < 0.01 ? 'match' : undefined
    },
  ];
}

let panelEl: HTMLDivElement | null = null;
let bodyEl:  HTMLDivElement | null = null;

function ensureRendered() {
  if (!panelEl) panelEl = document.getElementById('closure-panel') as HTMLDivElement;
  if (!bodyEl)  bodyEl  = document.getElementById('closure-body')  as HTMLDivElement;
  if (!bodyEl) return;

  if (bodyEl.dataset.rendered === '1') return;
  const renderRow = (r: ChainRow) => `
    <div class="chain-step${r.tone ? ' ' + r.tone : ''}">
      <div class="n">${r.step}</div>
      <div class="what">${r.what}${r.detail ? `<br><em>${r.detail}</em>` : ''}</div>
      <div class="val">${r.value}</div>
    </div>
  `;
  bodyEl.innerHTML = chainRows().map(renderRow).join('') +
    `<div class="chain-foot">
      The chain runs <em>top to bottom with no continuously fitted coefficient</em>.
      The electron mass is the one dimensionful anchor; it sets the substrate
      length L*, which sets G*. The seven-channel baseline alone lands 1.05 %
      low; the marked-transfer vertex Z_e closes the gap to the 10⁻⁶ level.
      The paper records that this vertex was constructed after the residuals
      were known, so the match is a high-precision <em>postdiction</em>, not a
      blind prediction. a₀ comes from the same g_share,eff and the horizon
      rate H₀, and scales with epoch as a₀(z) = ε c H(z).
    </div>
    <div class="panel-title" style="margin-top:18px; padding-top:14px; border-top:1px solid var(--line);">
      Charged-lepton mass ratios · paper §13.5
    </div>
    ` +
    leptonRows().map(renderRow).join('') +
    `<div class="chain-foot">
      The 720 is the first-shell reduced-alphabet entropy and the (2/7) the
      orientation-summed singlet projection from the same seven-state alphabet
      that fixed Ω<sub>tet</sub> = 1,680. The same marked-vertex weight ζ* that
      dresses L* supplies the last fraction of a percent here, through
      different graph polynomials.
    </div>`;
  bodyEl.dataset.rendered = '1';
}

export function bindClosurePanel() {
  const btn   = document.getElementById('btn-closure')       as HTMLButtonElement;
  const close = document.getElementById('btn-closure-close') as HTMLButtonElement;
  const panel = document.getElementById('closure-panel')     as HTMLDivElement;
  if (!btn || !close || !panel) return;

  btn.addEventListener('click', () => {
    ensureRendered();
    const open = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden', open);
    btn.classList.toggle('on', !open);
  });
  close.addEventListener('click', () => {
    panel.classList.add('hidden');
    btn.classList.remove('on');
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      btn.classList.remove('on');
    }
  });
}
