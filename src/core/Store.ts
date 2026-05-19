// Save/load. JSON to localStorage (auto) + downloadable file (manual).

import type { RegimeKey } from './Camera';
import { SPEED_EXP_DEFAULT } from '../util/units';

// v3: speedExp is pure log-magnitude (forward); direction + playing
// promoted to first-class fields so slow-mo doesn't masquerade as rewind.
const LS_KEY = 'unisim:v3';

export interface SaveData {
  version: 3;
  seed: number;
  scrub: number;
  zoom: number;
  regime: RegimeKey;
  speedExp: number;       // log10 of forward sim_sec/wall_sec
  direction: 1 | -1;      // +1 forward, -1 rewind (separate from speedExp)
  playing: boolean;       // play/pause state (separate from speed/direction)
  toggles: { entangle: boolean; bloom: boolean; disk: boolean };
  overrides: Record<string, [number, number, number, number, number, number]>;
}

let saveTimer: number | null = null;

export function autosave(data: SaveData) {
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
  }, 500);
}

export function loadLocal(): SaveData | null {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? (JSON.parse(s) as SaveData) : null;
  } catch { return null; }
}

export function downloadSave(data: SaveData) {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const iso  = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `universe-${data.seed.toString(16)}-${iso}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function readFile(f: File): Promise<SaveData> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try { resolve(JSON.parse(String(r.result)) as SaveData); }
      catch (e) { reject(e); }
    };
    r.onerror = () => reject(r.error);
    r.readAsText(f);
  });
}

export function emptySave(seed: number): SaveData {
  return {
    version: 3,
    seed,
    scrub: 0,
    zoom: 0.07,
    regime: 'COSMIC',
    speedExp: SPEED_EXP_DEFAULT,
    direction: 1,
    playing: true,
    toggles: { entangle: false, bloom: true, disk: true },
    overrides: {}
  };
}
