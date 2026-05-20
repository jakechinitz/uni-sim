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

// δS-field texture for entanglement halos. Alpha profile is the paper's
// static-limit capacity drain: δS ∝ r_s / r outside the source (paper §11).
// Clamped to 1 inside the horizon radius. The result is a soft 1/r glow
// that, when additively blended with other bodies' halos, sums to the
// cumulative δS field — exactly how the paper's static linearised
// equation ∇²δS = −(κ/γ)ρ superposes contributions.
//
// `rsFrac` is the fraction of the texture half-radius that maps to r_s
// (default 0.06 ≈ 6% of the sprite — a tight horizon-like core).
export function deltaSField(
  size = 256,
  rsFrac = 0.06,
  color = '#7ad7ff'
): THREE.Texture {
  const key = `deltaS|${size}|${rsFrac}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const c = new THREE.Color(color);
  const cr = Math.round(c.r * 255);
  const cg = Math.round(c.g * 255);
  const cb = Math.round(c.b * 255);
  const half = size / 2;
  const rs = rsFrac * half;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - half + 0.5;
      const dy = y - half + 0.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      // δS profile: clamped at horizon, 1/r outside
      const delta = r < rs ? 1 : rs / r;
      // Quadratic fade at outer edge so the sprite blends to zero at its bounds
      const edge = Math.max(0, 1 - r / half);
      const intensity = Math.min(1, delta) * edge * edge;
      const i = (y * size + x) * 4;
      data[i]     = cr;
      data[i + 1] = cg;
      data[i + 2] = cb;
      data[i + 3] = Math.round(intensity * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter  = THREE.LinearFilter;
  tex.magFilter  = THREE.LinearFilter;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}
