// Closure-chain modal — renders the live numeric derivation
// 1,680 microstates → η* → g_share,eff → J_eff^(ren) → L* → G
// (paper §6–9, §13). Every value is computed, not hard-coded.

import { computeClosure, formatSI } from '../core/Closure';

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
      detail: 'Ω_tet · 4 faces × 7 face-states (j₀ = 3/2), admissibility-closed',
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
      detail: 'admissibility-weighted, survives closure',
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
      detail: 'Σ_ret = 65/9 from 7 sector-diag + 1 shared-singlet',
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
      what: 'Substrate length',
      detail: 'L* = (3/2)·λe·exp(−7·g_share,eff)',
      value: formatSI(k.L_star, 'm')
    },
    {
      step: '9',
      what: 'Induced gravity',
      detail: 'G* = c³ L*² / ℏ',
      value: formatSI(k.G_star, 'm³ kg⁻¹ s⁻²')
    },
    {
      step: '✓',
      what: 'Match to Newton',
      detail: `CODATA G = ${formatSI(k.G_codata, '')}`,
      value: `${(100 + k.G_dev_pct).toFixed(2)}% of G`,
      tone: Math.abs(k.G_dev_pct) < 2 ? 'match' : 'dev'
    },
    {
      step: '★',
      what: 'Galactic acceleration',
      detail: 'a₀ = g_share,eff/(4π²)·cH₀ — paper §14, no fit',
      value: formatSI(k.a_0, 'm/s²'),
      tone: Math.abs((k.a_0 - k.a_0_obs) / k.a_0_obs) < 0.1 ? 'match' : undefined
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
  const rows = chainRows();
  bodyEl.innerHTML = rows.map(r => `
    <div class="chain-step${r.tone ? ' ' + r.tone : ''}">
      <div class="n">${r.step}</div>
      <div class="what">${r.what}${r.detail ? `<br><em>${r.detail}</em>` : ''}</div>
      <div class="val">${r.value}</div>
    </div>
  `).join('') + `
    <div class="chain-foot">
      The chain runs <em>top to bottom with zero free parameters</em>. The electron
      mass — the lightest one-bit fermionic defect — sets the substrate spacing
      L*, which in turn sets G*. Match to Newton at the 1% level is a closure
      result, not a fit. The MOND scale a₀ arises from the same arithmetic
      crossed with the cosmological horizon thermal acceleration cH₀.
    </div>
  `;
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
