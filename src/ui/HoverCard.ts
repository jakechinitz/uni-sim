// Floating paper-physics tooltip — shows T_H, S_BH, q, Ω_tet etc. when
// hovering a draggable. Position follows the cursor with a slight offset
// and flips sides at the screen edge.

import type { HoverInfo } from '../regimes/Regime';

let cardEl: HTMLDivElement | null = null;
let lastInfoKey = '';

function ensureEl(): HTMLDivElement {
  if (!cardEl) cardEl = document.getElementById('hover-card') as HTMLDivElement;
  return cardEl;
}

function infoKey(info: HoverInfo): string {
  return info.title + '|' + info.rows.map(r => r.k + r.v).join(',') + '|' + (info.note ?? '');
}

export function updateHoverCard(info: HoverInfo | null, x: number, y: number) {
  const el = ensureEl();
  if (!el) return;
  if (!info) {
    el.classList.add('hidden');
    lastInfoKey = '';
    return;
  }
  const key = infoKey(info);
  if (key !== lastInfoKey) {
    el.innerHTML =
      `<div class="ht-title">${info.title}</div>` +
      info.rows.map(r =>
        `<div class="ht-row"><span class="k">${r.k}</span><span class="v">${r.v}</span></div>`
      ).join('') +
      (info.note ? `<div class="ht-note">${info.note}</div>` : '');
    lastInfoKey = key;
  }
  el.classList.remove('hidden');
  // Position with edge-flipping
  const margin = 14;
  const w = el.offsetWidth || 240;
  const h = el.offsetHeight || 100;
  let px = x + 18;
  let py = y + 18;
  if (px + w + margin > window.innerWidth)  px = x - w - 18;
  if (py + h + margin > window.innerHeight) py = y - h - 18;
  el.style.left = `${px}px`;
  el.style.top  = `${py}px`;
}
