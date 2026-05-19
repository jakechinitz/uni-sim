// Hover-tooltip controller. Every UI element with a data-tip attribute
// shows its text in a floating panel just above the cursor while the
// user hovers. Avoids the browser's native title which is slow, ugly,
// and gets clipped at the bottom of the viewport.

export function installTooltips() {
  const tip = document.getElementById('tip') as HTMLDivElement;
  if (!tip) return;
  let active: Element | null = null;

  function show(text: string, x: number, y: number) {
    tip.textContent = text;
    tip.classList.add('on');
    // Position above the cursor, flipped down if it would go off-screen top
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let px = x - w / 2;
    let py = y - h - 14;
    if (py < 6) py = y + 18;
    px = Math.max(6, Math.min(window.innerWidth - w - 6, px));
    tip.style.left = `${px}px`;
    tip.style.top  = `${py}px`;
  }
  function hide() {
    tip.classList.remove('on');
    active = null;
  }

  document.addEventListener('pointermove', (ev) => {
    const target = (ev.target as Element | null)?.closest?.('[data-tip]') ?? null;
    if (target) {
      const text = target.getAttribute('data-tip') ?? '';
      if (target !== active || tip.textContent !== text) {
        active = target;
        show(text, ev.clientX, ev.clientY);
      } else {
        // re-position to follow cursor
        const w = tip.offsetWidth, h = tip.offsetHeight;
        let px = ev.clientX - w / 2;
        let py = ev.clientY - h - 14;
        if (py < 6) py = ev.clientY + 18;
        px = Math.max(6, Math.min(window.innerWidth - w - 6, px));
        tip.style.left = `${px}px`;
        tip.style.top  = `${py}px`;
      }
    } else if (active) {
      hide();
    }
  }, { passive: true });

  document.addEventListener('pointerleave', hide);
  window.addEventListener('blur', hide);
}
