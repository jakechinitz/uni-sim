// Binds HTML controls to the app state.

import type { SaveData } from '../core/Store';
import { downloadSave, readFile } from '../core/Store';
import { SPEED_DEAD_ZONE, SPEED_EXP_DEFAULT } from '../util/units';

export interface UICallbacks {
  state: SaveData;
  onChange: () => void;
  onLoad: (data: SaveData) => void;
  onNewSeed: () => void;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
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
  const togBlm      = el<HTMLInputElement>('toggle-bloom');

  // Init from state
  sliderTime.value  = String(cb.state.scrub);
  sliderZoom.value  = String(cb.state.zoom);
  sliderSpeed.value = String(cb.state.speedExp);
  togEnt.checked    = cb.state.toggles.entangle;
  togBlm.checked    = cb.state.toggles.bloom;
  btnPlay.textContent = cb.state.speedExp === 0 ? '▶' : '⏸';

  sliderTime.addEventListener('input', () => {
    cb.state.scrub = parseFloat(sliderTime.value);
    cb.onChange();
  });
  sliderZoom.addEventListener('input', () => {
    cb.state.zoom = parseFloat(sliderZoom.value);
    cb.onChange();
  });
  // Remember last non-zero speed so play resumes there
  let lastSpeedExp = cb.state.speedExp !== 0 ? cb.state.speedExp : SPEED_EXP_DEFAULT;

  sliderSpeed.addEventListener('input', () => {
    cb.state.speedExp = parseFloat(sliderSpeed.value);
    if (Math.abs(cb.state.speedExp) >= SPEED_DEAD_ZONE) lastSpeedExp = cb.state.speedExp;
    refreshPresetState(cb.state.speedExp);
    cb.onChange();
  });
  btnPlay.addEventListener('click', () => {
    if (Math.abs(cb.state.speedExp) < SPEED_DEAD_ZONE) {
      cb.state.speedExp = lastSpeedExp;
      btnPlay.textContent = '⏸';
    } else {
      lastSpeedExp = cb.state.speedExp;
      cb.state.speedExp = 0;
      btnPlay.textContent = '▶';
    }
    sliderSpeed.value = String(cb.state.speedExp);
    refreshPresetState(cb.state.speedExp);
    cb.onChange();
  });
  btnRew.addEventListener('click', () => {
    const e = Math.max(1, Math.abs(cb.state.speedExp || lastSpeedExp));
    cb.state.speedExp = -e;
    lastSpeedExp = cb.state.speedExp;
    sliderSpeed.value = String(cb.state.speedExp);
    btnPlay.textContent = '⏸';
    refreshPresetState(cb.state.speedExp);
    cb.onChange();
  });
  btnFwd.addEventListener('click', () => {
    const e = Math.max(1, Math.abs(cb.state.speedExp || lastSpeedExp));
    cb.state.speedExp = e;
    lastSpeedExp = cb.state.speedExp;
    sliderSpeed.value = String(cb.state.speedExp);
    btnPlay.textContent = '⏸';
    refreshPresetState(cb.state.speedExp);
    cb.onChange();
  });

  // Speed preset chips (snap the slider to a named rate)
  const chips = document.querySelectorAll<HTMLButtonElement>('#speed-presets .chip');
  function refreshPresetState(exp: number) {
    chips.forEach(ch => {
      const v = parseFloat(ch.dataset.exp ?? '');
      ch.classList.toggle('on', Math.abs(v - exp) < 0.05);
    });
  }
  chips.forEach(ch => {
    ch.addEventListener('click', () => {
      const v = parseFloat(ch.dataset.exp ?? '');
      cb.state.speedExp = v;
      lastSpeedExp = v;
      sliderSpeed.value = String(v);
      btnPlay.textContent = '⏸';
      refreshPresetState(v);
      cb.onChange();
    });
  });
  refreshPresetState(cb.state.speedExp);
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
  togBlm.addEventListener('change', () => {
    cb.state.toggles.bloom = togBlm.checked;
    cb.onChange();
  });
}

// Exported so syncControls() can re-highlight chips after a load.
function highlightPresets(exp: number) {
  document.querySelectorAll<HTMLButtonElement>('#speed-presets .chip').forEach(ch => {
    const v = parseFloat(ch.dataset.exp ?? '');
    ch.classList.toggle('on', Math.abs(v - exp) < 0.05);
  });
}

export function setHud(parts: { time: string; zoom: string; speed: string; epoch: string }) {
  (el<HTMLSpanElement>('hud-time')).textContent  = parts.time;
  (el<HTMLSpanElement>('hud-zoom')).textContent  = parts.zoom;
  (el<HTMLSpanElement>('hud-speed')).textContent = parts.speed;
  (el<HTMLDivElement>('hud-epoch')).textContent  = parts.epoch;
}

export function syncControls(state: SaveData) {
  (el<HTMLInputElement>('slider-time')).value  = String(state.scrub);
  (el<HTMLInputElement>('slider-zoom')).value  = String(state.zoom);
  (el<HTMLInputElement>('slider-speed')).value = String(state.speedExp);
  (el<HTMLInputElement>('toggle-entangle')).checked = state.toggles.entangle;
  (el<HTMLInputElement>('toggle-bloom')).checked    = state.toggles.bloom;
  (el<HTMLButtonElement>('btn-play')).textContent =
    Math.abs(state.speedExp) < SPEED_DEAD_ZONE ? '▶' : '⏸';
  highlightPresets(state.speedExp);
}
