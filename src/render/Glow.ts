// Cached radial-gradient sprite textures for stars, galaxies, defects.
import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

export function radialGlow(
  size = 256,
  core = '#ffffff',
  mid = '#7ad7ff',
  edge = 'rgba(122,215,255,0)'
): THREE.Texture {
  const key = `${size}|${core}|${mid}|${edge}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, core);
  g.addColorStop(0.18, mid);
  g.addColorStop(1.0, edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter  = THREE.LinearFilter;
  tex.magFilter  = THREE.LinearFilter;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

export function ring(
  size = 256,
  inner = 0.42,
  outer = 0.52,
  color = '#7ad7ff'
): THREE.Texture {
  const key = `ring|${size}|${inner}|${outer}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  const ri = inner * size / 2, ro = outer * size / 2;
  const g = ctx.createRadialGradient(cx, cy, ri, cx, cy, ro);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, ro, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}
