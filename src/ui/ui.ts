// Binds HTML controls to the app state.

import type { SaveData } from '../core/Store';
import { downloadSave, readFile } from '../core/Store';
import { qualityForLevel } from '../core/Quality';
import { scaleAuditRows } from '../core/ScaleAudit';

export interface UICallbacks {
  state: SaveData;
  onChange: () => void;
  // Like onChange, but also applies state.scrub to the cosmic clock. Used
  // only by the time slider and Big Bang button — the controls that are
  // actually meant to move time. Cosmetic toggles must use onChange.
  onScrub: () => void;
  onLoad: (data: SaveData) => void;
  onNewSeed: () => void;
  // Optional anchor-related hooks. If supplied, the scene-picker dropdown
  // is populated and wired; the anchor info panel is shown/hidden via
  // updateAnchorPanel below.
  anchors?: {
    list: { id: string; title: string; tier?: number }[];
    onSelect: (id: string | null) => void;
    onRestart: () => void;
  };
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function renderScaleAuditPanel() {
  const root = document.getElementById('scale-audit-rows');
  if (!root) return;
  root.textContent = '';
  for (const item of scaleAuditRows()) {
    const row = document.createElement('div');
    row.className = 'scale-audit-row';

    const label = document.createElement('span');
    label.className = 'scale-label';
    label.textContent = item.label;

    const value = document.createElement('span');
    value.className = 'scale-value';
    value.textContent = item.factor;
    value.dataset.tip = `${item.visual}; true-to-scale would be ${item.trueScale}`;

    row.append(label, value);
    root.appendChild(row);
  }
}

export function bindUI(cb: UICallbacks) {
  const sliderTime  = el<HTMLInputElement>('slider-time');
  const sliderZoom  = el<HTMLInputElement>('slider-zoom');
  const sliderSpeed = el<HTMLInputElement>('slider-speed');
  const btnPlay     = el<HTMLButtonElement>('btn-play');
  const btnRew      = el<HTMLButtonElement>('btn-rewind');
  const btnFwd      = el<HTMLButtonElement>('btn-forward');
  const btnSave     = el<HTMLButtonElement>('btn-save');
  const btnLoad     = el<HTMLButtonElement>('btn-load');
  const inpLoad     = el<HTMLInputElement>('input-load');
  const btnNew      = el<HTMLButtonElement>('btn-newseed');
  const togEnt      = el<HTMLInputElement>('toggle-entangle');
  const togDisk     = el<HTMLInputElement>('toggle-disk');
  const togDiskD    = el<HTMLInputElement>('toggle-disk-detail');
  const togMP       = el<HTMLInputElement>('toggle-manypasts');
  const togSG       = el<HTMLInputElement>('toggle-selfgrav');
  const qualitySel  = document.getElementById('quality-select') as HTMLSelectElement | null;

  renderScaleAuditPanel();

  // Init from state. paintTransport / refreshPresetState rely on `chips`
  // being declared, so we set up the chip refs BEFORE the first repaint
  // (otherwise we hit a TDZ error and the whole app fails to boot).
  const chips = document.querySelectorAll<HTMLButtonElement>('#speed-presets .chip');
  function refreshPresetState(exp: number) {
    chips.forEach(ch => {
      const v = parseFloat(ch.dataset.exp ?? '');
      ch.classList.toggle('on', Math.abs(v - exp) < 0.05);
    });
  }
  function paintTransport() {
    btnPlay.textContent = cb.state.playing ? '⏸' : '▶';
    btnRew.classList.toggle('on', cb.state.direction === -1 && cb.state.playing);
    btnFwd.classList.toggle('on', cb.state.direction ===  1 && cb.state.playing);
    refreshPresetState(cb.state.speedExp);
  }

  cb.state.quality = qualityForLevel(cb.state.quality).level;
  if (qualitySel) qualitySel.value = cb.state.quality;
  sliderTime.value  = String(cb.state.scrub);
  sliderZoom.value  = String(cb.state.zoom);
  sliderSpeed.value = String(cb.state.speedExp);
  togEnt.checked    = cb.state.toggles.entangle;
  // Backfill disk toggle for saves predating it (defensive: undefined → true)
  cb.state.toggles.disk = cb.state.toggles.disk ?? true;
  togDisk.checked   = cb.state.toggles.disk;
  cb.state.toggles.diskDetail = cb.state.toggles.diskDetail ?? true;
  togDiskD.checked  = cb.state.toggles.diskDetail;
  cb.state.toggles.manyPasts = cb.state.toggles.manyPasts ?? false;
  togMP.checked     = cb.state.toggles.manyPasts;
  cb.state.toggles.selfGravity = cb.state.toggles.selfGravity ?? false;
  togSG.checked     = cb.state.toggles.selfGravity;
  paintTransport();

  sliderTime.addEventListener('input', () => {
    cb.state.scrub = parseFloat(sliderTime.value);
    // Manually scrubbing exits log-pace — user is taking direct control.
    cb.state.logPace = false;
    cb.onScrub();
  });
  sliderZoom.addEventListener('input', () => {
    cb.state.zoom = parseFloat(sliderZoom.value);
    cb.onChange();
  });
  sliderSpeed.addEventListener('input', () => {
    cb.state.speedExp = parseFloat(sliderSpeed.value);
    // Adjusting the speed slider implies "I want to play at this speed";
    // unpause if paused so the new speed is visible. Also drops out of
    // log-pace mode — manual speed override always wins.
    if (!cb.state.playing) cb.state.playing = true;
    cb.state.logPace = false;
    paintTransport();
    cb.onChange();
  });
  if (qualitySel) {
    qualitySel.addEventListener('change', () => {
      cb.state.quality = qualityForLevel(qualitySel.value).level;
      qualitySel.value = cb.state.quality;
      cb.onChange();
    });
  }
  btnPlay.addEventListener('click', () => {
    cb.state.playing = !cb.state.playing;
    paintTransport();
    cb.onChange();
  });
  btnRew.addEventListener('click', () => {
    cb.state.direction = -1;
    cb.state.playing = true;
    paintTransport();
    cb.onChange();
  });
  btnFwd.addEventListener('click', () => {
    cb.state.direction = 1;
    cb.state.playing = true;
    paintTransport();
    cb.onChange();
  });

  // Speed preset chips (snap the slider to a named rate). Manual chip
  // selection also drops out of log-pace mode.
  chips.forEach(ch => {
    ch.addEventListener('click', () => {
      const v = parseFloat(ch.dataset.exp ?? '');
      cb.state.speedExp = v;
      cb.state.playing = true;
      cb.state.logPace = false;
      sliderSpeed.value = String(v);
      paintTransport();
      cb.onChange();
    });
  });

  btnSave.addEventListener('click', () => downloadSave(cb.state));
  btnLoad.addEventListener('click', () => inpLoad.click());
  inpLoad.addEventListener('change', async () => {
    if (!inpLoad.files || inpLoad.files.length === 0) return;
    try {
      const data = await readFile(inpLoad.files[0]);
      cb.onLoad(data);
    } catch (e) { console.error('load failed', e); }
    inpLoad.value = '';
  });
  btnNew.addEventListener('click', () => cb.onNewSeed());
  togEnt.addEventListener('change', () => {
    cb.state.toggles.entangle = togEnt.checked;
    cb.onChange();
  });
  togDiskD.addEventListener('change', () => {
    cb.state.toggles.diskDetail = togDiskD.checked;
    cb.onChange();
  });
  togDisk.addEventListener('change', () => {
    cb.state.toggles.disk = togDisk.checked;
    cb.onChange();
  });
  togMP.addEventListener('change', () => {
    cb.state.toggles.manyPasts = togMP.checked;
    cb.onChange();
  });
  togSG.addEventListener('change', () => {
    cb.state.toggles.selfGravity = togSG.checked;
    cb.onChange();
  });

  // Scene picker — populated from the anchor registry. Selecting an
  // anchor swaps the rendered scene; selecting "" (Live universe)
  // returns to the regime view. The actual scene swap happens via the
  // App's anchor callback; here we just wire up the dropdown + the
  // "restart" / "back to live" buttons in the side panel.
  const anchorSelect  = document.getElementById('anchor-select')      as HTMLSelectElement | null;
  const anchorRestart = document.getElementById('btn-anchor-restart') as HTMLButtonElement | null;
  const anchorExit    = document.getElementById('btn-anchor-exit')    as HTMLButtonElement | null;
  if (anchorSelect && cb.anchors) {
    // Build options. The default "" (Live universe) is already in the HTML.
    // Anchors are appended in their registry order.
    for (const entry of cb.anchors.list) {
      const opt = document.createElement('option');
      opt.value = entry.id;
      opt.textContent = entry.title;
      anchorSelect.appendChild(opt);
    }
    anchorSelect.addEventListener('change', () => {
      const v = anchorSelect.value;
      cb.anchors!.onSelect(v === '' ? null : v);
    });
  }
  if (anchorRestart && cb.anchors) {
    anchorRestart.addEventListener('click', () => cb.anchors!.onRestart());
  }
  if (anchorExit && cb.anchors && anchorSelect) {
    anchorExit.addEventListener('click', () => {
      anchorSelect.value = '';
      cb.anchors!.onSelect(null);
    });
  }

  // ↺ Big Bang — reset cosmic time to 0 and engage log-pace playback
  // so the early universe (inflation flash → recombination → first
  // stars → galaxies) takes ~35 wall-sec to traverse. Each cosmic
  // decade gets roughly equal screen time. Also snaps to mid-COSMIC
  // zoom so you're framed on the whole cosmic web.
  const btnBang = document.getElementById('btn-bigbang') as HTMLButtonElement | null;
  if (btnBang) {
    btnBang.addEventListener('click', () => {
      cb.state.scrub = 0;
      cb.state.zoom = 0.10;           // mid-COSMIC band
      cb.state.direction = 1;
      cb.state.playing = true;
      cb.state.logPace = true;
      sliderTime.value  = String(cb.state.scrub);
      sliderZoom.value  = String(cb.state.zoom);
      paintTransport();
      cb.onScrub();
    });
  }
}

export function setHud(parts: { time: string; zoom: string; speed: string; epoch: string }) {
  (el<HTMLSpanElement>('hud-time')).textContent  = parts.time;
  (el<HTMLSpanElement>('hud-zoom')).textContent  = parts.zoom;
  (el<HTMLSpanElement>('hud-speed')).textContent = parts.speed;
  (el<HTMLDivElement>('hud-epoch')).textContent  = parts.epoch;
}

// Show / hide / populate the anchor info panel. Called by App whenever
// the active anchor changes. Pass `null` to hide.
export function updateAnchorPanel(
  info: { title: string; paperRef: string; blurb: string } | null
) {
  const panel = document.getElementById('anchor-panel');
  if (!panel) return;
  if (!info) { panel.classList.add('hidden'); return; }
  const t = document.getElementById('anchor-title');
  const r = document.getElementById('anchor-ref');
  const b = document.getElementById('anchor-blurb');
  if (t) t.textContent = info.title;
  if (r) r.textContent = info.paperRef;
  if (b) b.textContent = info.blurb;
  panel.classList.remove('hidden');
}

export function syncControls(state: SaveData) {
  state.quality = qualityForLevel(state.quality).level;
  (el<HTMLInputElement>('slider-time')).value  = String(state.scrub);
  (el<HTMLInputElement>('slider-zoom')).value  = String(state.zoom);
  (el<HTMLInputElement>('slider-speed')).value = String(state.speedExp);
  (el<HTMLInputElement>('toggle-entangle')).checked = state.toggles.entangle;
  (el<HTMLInputElement>('toggle-disk')).checked     = state.toggles.disk ?? true;
  (el<HTMLInputElement>('toggle-disk-detail')).checked = state.toggles.diskDetail ?? true;
  (el<HTMLInputElement>('toggle-manypasts')).checked   = state.toggles.manyPasts ?? false;
  (el<HTMLInputElement>('toggle-selfgrav')).checked     = state.toggles.selfGravity ?? false;
  const qualitySel = document.getElementById('quality-select') as HTMLSelectElement | null;
  if (qualitySel) qualitySel.value = state.quality;
  (el<HTMLButtonElement>('btn-play')).textContent = state.playing ? '⏸' : '▶';
  (el<HTMLButtonElement>('btn-rewind')).classList.toggle('on',  state.direction === -1 && state.playing);
  (el<HTMLButtonElement>('btn-forward')).classList.toggle('on', state.direction ===  1 && state.playing);
  document.querySelectorAll<HTMLButtonElement>('#speed-presets .chip').forEach(ch => {
    const v = parseFloat(ch.dataset.exp ?? '');
    ch.classList.toggle('on', Math.abs(v - state.speedExp) < 0.05);
  });
}
