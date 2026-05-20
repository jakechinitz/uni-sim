// Binds HTML controls to the app state.

import type { SaveData } from '../core/Store';
import { downloadSave, readFile } from '../core/Store';

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
  const togDisk     = el<HTMLInputElement>('toggle-disk');
  const togDiskD    = el<HTMLInputElement>('toggle-disk-detail');
  const togMP       = el<HTMLInputElement>('toggle-manypasts');

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
  paintTransport();

  sliderTime.addEventListener('input', () => {
    cb.state.scrub = parseFloat(sliderTime.value);
    // Manually scrubbing exits log-pace — user is taking direct control.
    cb.state.logPace = false;
    cb.onChange();
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
      cb.onChange();
    });
  }
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
  (el<HTMLInputElement>('toggle-disk')).checked     = state.toggles.disk ?? true;
  (el<HTMLButtonElement>('btn-play')).textContent = state.playing ? '⏸' : '▶';
  (el<HTMLButtonElement>('btn-rewind')).classList.toggle('on',  state.direction === -1 && state.playing);
  (el<HTMLButtonElement>('btn-forward')).classList.toggle('on', state.direction ===  1 && state.playing);
  document.querySelectorAll<HTMLButtonElement>('#speed-presets .chip').forEach(ch => {
    const v = parseFloat(ch.dataset.exp ?? '');
    ch.classList.toggle('on', Math.abs(v - state.speedExp) < 0.05);
  });
}
