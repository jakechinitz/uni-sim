// Floating paper-physics tooltip — shows T_H, S_BH, q, Ω_tet etc. when
// hovering a draggable, and PINS in place when the user clicks the
// draggable so they can read it and see what zoom-in would target.

import type { HoverInfo } from '../regimes/Regime';

let cardEl: HTMLDivElement | null = null;
let lastInfoKey = '';
let pinned = false;

function ensureEl(): HTMLDivElement {
  if (!cardEl) cardEl = document.getElementById('hover-card') as HTMLDivElement;
  return cardEl;
}

function infoKey(info: HoverInfo): string {
  return info.title + '|' + info.rows.map(r => r.k + r.v).join(',') + '|' + (info.note ?? '');
}

function render(info: HoverInfo, isPinned: boolean) {
  const el = ensureEl();
  if (!el) return;
  el.innerHTML =
    `<div class="ht-title">${info.title}${isPinned ? ' <button class="ht-x" data-tip="Close preview">×</button>' : ''}</div>` +
    info.rows.map(r =>
      `<div class="ht-row"><span class="k">${r.k}</span><span class="v">${r.v}</span></div>`
    ).join('') +
    (info.note ? `<div class="ht-note">${info.note}</div>` : '') +
    (isPinned ? `<div class="ht-hint">Scroll wheel to zoom in here · click background to close</div>` : '');
  lastInfoKey = infoKey(info);
  if (isPinned) {
    const x = el.querySelector('.ht-x');
    if (x) x.addEventListener('click', () => unpinHoverCard());
  }
}

function position(x: number, y: number) {
  const el = ensureEl();
  if (!el) return;
  const w = el.offsetWidth || 240;
  const h = el.offsetHeight || 100;
  const margin = 14;
  let px = x + 18;
  let py = y + 18;
  if (px + w + margin > window.innerWidth)  px = x - w - 18;
  if (py + h + margin > window.innerHeight) py = y - h - 18;
  el.style.left = `${px}px`;
  el.style.top  = `${py}px`;
}

// Hover (transient) — only updates when nothing is pinned.
export function updateHoverCard(info: HoverInfo | null, x: number, y: number) {
  const el = ensureEl();
  if (!el || pinned) return;
  if (!info) {
    el.classList.add('hidden');
    lastInfoKey = '';
    return;
  }
  if (infoKey(info) !== lastInfoKey) render(info, false);
  el.classList.remove('hidden');
  position(x, y);
}

// Pin (sticky) — fires on click, stays until background-click or Escape.
export function pinHoverCard(info: HoverInfo | null, x: number, y: number) {
  const el = ensureEl();
  if (!el || !info) { unpinHoverCard(); return; }
  pinned = true;
  render(info, true);
  el.classList.remove('hidden');
  el.classList.add('pinned');
  position(x, y);
}

export function unpinHoverCard() {
  const el = ensureEl();
  if (!el) return;
  pinned = false;
  el.classList.remove('pinned');
  el.classList.add('hidden');
  lastInfoKey = '';
}

export function isPinned() { return pinned; }
