// Particle-mesh cosmological N-body in a periodic comoving unit box.
//
// This is the engine behind the COSMIC regime's emergent web. It is pure
// arithmetic (no DOM, no three.js) so it runs unchanged in a Web Worker and
// in Node for validation.
//
// Equations. Comoving position x ∈ [0,1)³, cosmic time t, scale factor a(t).
// With momentum p ≡ a² dx/dt and the scale factor as the integration variable,
//
//     dx/da = p / (a³ H(a))
//     dp/da = (3/2) Ω_m H0² · g(x) / (a² H(a)),      g = −∇ ∇⁻² δ
//
// where δ is the matter density contrast. Ω_m is the TOTAL clustering matter:
// in the paper's saturated phase the committed component is pressureless dust
// with abundance 1/ε per baryon, so Ω_m = (1 + 1/ε) Ω_b — the growth of
// structure is ordinary gravitational instability of that total. The
// background H(a) is supplied by the caller (src/core/Cosmology.ts), so the
// web and the HUD's clock share one expansion history by construction.
//
// Initial conditions are Zel'dovich displacements of a uniform lattice by a
// Gaussian random field: x = q + D(a) ψ(q), ψ̂ = i k δ̂ / k², with D the linear
// growth factor on the same background (D(1) = 1).

import { FFT1D } from '../util/fft';

export interface PMBackground {
  /** Hubble rate H(a) in 1/Gyr. */
  H(a: number): number;
  /**
   * ρ_m(a) a³ · 8πG/3 in 1/Gyr² — "Ω_m H0²" for the clustering matter. It is a
   * function of a because the committed stock sheds the fraction
   * 1 − e^{−η* F_rel(a)} of its mass into the vacuum (≈ 2 % by today).
   */
  omegaMH02(a: number): number;
}

export interface PMConfig {
  /** Particles per side; N = n³. */
  n: number;
  /** Mesh cells per side (power of two, ≥ n). */
  mesh: number;
  seed: number;
  /**
   * Linear power today per Fourier mode: ⟨|δ_k|²⟩ = P(k)/V for the mode with
   * integer wavenumber magnitude kInt (k = 2π·kInt / L_box).
   */
  modePower(kInt: number): number;
  /** Scale factor at which the initial conditions are laid down. */
  aStart: number;
  /** Linear growth at aStart, normalised to D(1) = 1: D and dD/da. */
  growthStart: { D: number; dDda: number };
  /** Spectrum roll-off as a fraction of the lattice Nyquist frequency (default 0.8). */
  kCutFrac?: number;
  /** How many CIC windows to deconvolve from the force (0, 1 or 2; default 1). */
  deconv?: number;
}

// ---------------------------------------------------------------- FFT ----
// 3-D wrapper around the shared radix-2 transform.
class FFT3D {
  private f: FFT1D;
  private lr: Float64Array;
  private li: Float64Array;
  constructor(readonly m: number) {
    this.f = new FFT1D(m);
    this.lr = new Float64Array(m);
    this.li = new Float64Array(m);
  }
  /** In-place 3-D transform of an m³ field indexed [(z*m + y)*m + x]. */
  run(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const m = this.m, lr = this.lr, li = this.li, f = this.f;
    // x lines are contiguous
    for (let o = 0; o < m * m * m; o += m) {
      for (let i = 0; i < m; i++) { lr[i] = re[o + i]; li[i] = im[o + i]; }
      f.run(lr, li, inverse);
      for (let i = 0; i < m; i++) { re[o + i] = lr[i]; im[o + i] = li[i]; }
    }
    // y lines: stride m
    for (let z = 0; z < m; z++) for (let x = 0; x < m; x++) {
      const o = z * m * m + x;
      for (let i = 0; i < m; i++) { lr[i] = re[o + i * m]; li[i] = im[o + i * m]; }
      f.run(lr, li, inverse);
      for (let i = 0; i < m; i++) { re[o + i * m] = lr[i]; im[o + i * m] = li[i]; }
    }
    // z lines: stride m²
    const mm = m * m;
    for (let o = 0; o < mm; o++) {
      for (let i = 0; i < m; i++) { lr[i] = re[o + i * mm]; li[i] = im[o + i * mm]; }
      f.run(lr, li, inverse);
      for (let i = 0; i < m; i++) { re[o + i * mm] = lr[i]; im[o + i * mm] = li[i]; }
    }
    if (inverse) {
      const s = 1 / (m * m * m);
      for (let i = 0; i < re.length; i++) { re[i] *= s; im[i] *= s; }
    }
  }
}

// Deterministic PRNG (mulberry32) + Box–Muller.
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CosmicPM {
  readonly N: number;
  readonly n: number;
  readonly m: number;
  /** Scale factor the particle state currently corresponds to. */
  a: number;
  /** Unwrapped displacement from the Lagrangian lattice, x = q + d (box units). */
  readonly dx: Float64Array;
  readonly dy: Float64Array;
  readonly dz: Float64Array;
  /** Momenta p = a² dx/dt (box units / Gyr). */
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly pz: Float64Array;
  /** Linear overdensity at each particle's lattice site, extrapolated to a = 1. */
  readonly deltaLin: Float32Array;
  /** Local nonlinear overdensity 1 + δ at each particle (updated by every force evaluation). */
  readonly rho: Float32Array;

  private fft: FFT3D;
  private re: Float64Array;
  private im: Float64Array;
  private gx: Float64Array;   // acceleration field g on the mesh
  private gy: Float64Array;
  private gz: Float64Array;
  private ax: Float64Array;   // g interpolated to particles
  private ay: Float64Array;
  private az: Float64Array;
  private haveForce = false;
  private rhoMesh: Float64Array;
  private k2ax: Float64Array;  // (2π k)² per axis index
  private wax: Float64Array;   // CIC window^deconv per axis index, window = sinc²(π k / m)

  constructor(readonly cfg: PMConfig, readonly bg: PMBackground) {
    this.n = cfg.n; this.m = cfg.mesh;
    this.N = cfg.n ** 3;
    const N = this.N, M3 = this.m ** 3;
    this.a = cfg.aStart;
    this.dx = new Float64Array(N); this.dy = new Float64Array(N); this.dz = new Float64Array(N);
    this.px = new Float64Array(N); this.py = new Float64Array(N); this.pz = new Float64Array(N);
    this.ax = new Float64Array(N); this.ay = new Float64Array(N); this.az = new Float64Array(N);
    this.deltaLin = new Float32Array(N);
    this.rho = new Float32Array(N);
    this.fft = new FFT3D(this.m);
    this.re = new Float64Array(M3); this.im = new Float64Array(M3);
    this.gx = new Float64Array(M3); this.gy = new Float64Array(M3); this.gz = new Float64Array(M3);
    this.rhoMesh = new Float64Array(M3);
    this.k2ax = new Float64Array(this.m); this.wax = new Float64Array(this.m);
    for (let i = 0; i < this.m; i++) {
      const k = i <= this.m / 2 ? i : i - this.m;
      this.k2ax[i] = (2 * Math.PI * k) ** 2;
      const x = (Math.PI * k) / this.m;
      const sinc = k === 0 ? 1 : Math.sin(x) / x;
      this.wax[i] = sinc ** (2 * (this.cfg.deconv ?? 1));
    }
    this.initZeldovich();
  }

  /** Lattice coordinate of particle i along one axis (box units). */
  private q(i: number): number { return (i + 0.5) / this.n; }

  // Gaussian random field → Zel'dovich displacements and momenta at aStart.
  private initZeldovich(): void {
    const { n, m, N } = this, M3 = m ** 3;
    const { seed, aStart, growthStart } = this.cfg;
    const rnd = rng32(seed);
    const re = this.re, im = this.im;
    // White Gaussian noise in real space ⇒ Hermitian spectrum for free.
    for (let i = 0; i < M3; i++) {
      const u = rnd() + 1e-12, v = rnd();
      re[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      im[i] = 0;
    }
    this.fft.run(re, im, false);
    // Shape the spectrum: ⟨|δ_k|²⟩ = modePower(k), keeping only modes the
    // particle lattice can represent (|k_i| < n/2) so nothing aliases. The
    // forward transform of unit white noise has ⟨|ŵ|²⟩ = M³ and the inverse
    // divides by M³, hence the M^{3/2}.
    const kNy = n / 2;
    const amp = new Float64Array(M3);
    const m32 = Math.pow(M3, 0.5);
    for (let z = 0; z < m; z++) {
      const kz = z <= m / 2 ? z : z - m;
      for (let y = 0; y < m; y++) {
        const ky = y <= m / 2 ? y : y - m;
        for (let x = 0; x < m; x++) {
          const kx = x <= m / 2 ? x : x - m;
          const i = (z * m + y) * m + x;
          const k2 = kx * kx + ky * ky + kz * kz;
          if (k2 === 0 || Math.abs(kx) >= kNy || Math.abs(ky) >= kNy || Math.abs(kz) >= kNy) { amp[i] = 0; continue; }
          // smooth roll-off toward the lattice Nyquist frequency
          const kk = Math.sqrt(k2);
          amp[i] = Math.sqrt(this.cfg.modePower(kk)) * m32 * Math.exp(-Math.pow(kk / ((this.cfg.kCutFrac ?? 0.8) * kNy), 4));
        }
      }
    }
    for (let i = 0; i < M3; i++) { re[i] *= amp[i]; im[i] *= amp[i]; }
    const dRe = re.slice(), dIm = im.slice();          // δ̂ (unnormalised)

    // δ(x) on the mesh, linearly extrapolated to a = 1.
    this.fft.run(re, im, true);
    const stride = m / n;
    const site = (ix: number, iy: number, iz: number) =>
      ((Math.floor((iz + 0.5) * stride) % m) * m + (Math.floor((iy + 0.5) * stride) % m)) * m + (Math.floor((ix + 0.5) * stride) % m);
    const norm = 1;
    for (let iz = 0, p = 0; iz < n; iz++) for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++, p++) {
      this.deltaLin[p] = re[site(ix, iy, iz)] * norm;
    }

    // ψ̂ = i k δ̂ / k²  (so that δ = −∇·ψ), one axis at a time. k = 2π·(integer).
    const disp = [this.dx, this.dy, this.dz];
    for (let axis = 0; axis < 3; axis++) {
      for (let z = 0; z < m; z++) {
        const kz = z <= m / 2 ? z : z - m;
        for (let y = 0; y < m; y++) {
          const ky = y <= m / 2 ? y : y - m;
          for (let x = 0; x < m; x++) {
            const kx = x <= m / 2 ? x : x - m;
            const i = (z * m + y) * m + x;
            const k2 = kx * kx + ky * ky + kz * kz;
            if (k2 === 0) { re[i] = 0; im[i] = 0; continue; }
            const kc = axis === 0 ? kx : axis === 1 ? ky : kz;
            const f = (kc / k2) / (2 * Math.PI);
            // i·(a + ib) = −b + ia
            re[i] = -dIm[i] * f;
            im[i] = dRe[i] * f;
          }
        }
      }
      this.fft.run(re, im, true);
      const d = disp[axis];
      for (let iz = 0, p = 0; iz < n; iz++) for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++, p++) {
        d[p] = re[site(ix, iy, iz)] * norm;       // ψ per unit growth factor
      }
    }
    // Zel'dovich at aStart: x = q + D ψ, dx/da = (dD/da) ψ ⇒ p = a³ H (dD/da) ψ.
    const pf = aStart ** 3 * this.bg.H(aStart) * growthStart.dDda;
    for (let p = 0; p < N; p++) {
      this.px[p] = pf * this.dx[p]; this.py[p] = pf * this.dy[p]; this.pz[p] = pf * this.dz[p];
      this.dx[p] *= growthStart.D; this.dy[p] *= growthStart.D; this.dz[p] *= growthStart.D;
    }
    this.haveForce = false;
  }

  /** Mesh force g = −∇∇⁻²δ at the current positions, interpolated to particles (CIC). */
  private force(): void {
    const { n, m, N } = this, M3 = m ** 3;
    const re = this.re, im = this.im;
    re.fill(0); im.fill(0);
    const w = M3 / N;                                   // so that ⟨ρ⟩ = 1
    const inv = 1 / n;
    // ---- CIC deposit ----
    for (let iz = 0, p = 0; iz < n; iz++) for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++, p++) {
      let fx = ((ix + 0.5) * inv + this.dx[p]) * m - 0.5;
      let fy = ((iy + 0.5) * inv + this.dy[p]) * m - 0.5;
      let fz = ((iz + 0.5) * inv + this.dz[p]) * m - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
      const tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const xa = ((x0 % m) + m) % m, xb = (xa + 1) % m;
      const ya = ((y0 % m) + m) % m, yb = (ya + 1) % m;
      const za = ((z0 % m) + m) % m, zb = (za + 1) % m;
      const w00 = (1 - ty) * (1 - tz) * w, w10 = ty * (1 - tz) * w, w01 = (1 - ty) * tz * w, w11 = ty * tz * w;
      re[(za * m + ya) * m + xa] += (1 - tx) * w00; re[(za * m + ya) * m + xb] += tx * w00;
      re[(za * m + yb) * m + xa] += (1 - tx) * w10; re[(za * m + yb) * m + xb] += tx * w10;
      re[(zb * m + ya) * m + xa] += (1 - tx) * w01; re[(zb * m + ya) * m + xb] += tx * w01;
      re[(zb * m + yb) * m + xa] += (1 - tx) * w11; re[(zb * m + yb) * m + xb] += tx * w11;
    }
    // keep ρ on the mesh for the per-particle density read-back
    const rhoMesh = this.rhoMesh;
    for (let i = 0; i < M3; i++) { rhoMesh[i] = re[i]; re[i] -= 1; }
    // ---- Poisson: φ̂ = −δ̂ / k², exact Green's function, with the CIC
    //      assignment window deconvolved twice (once for the deposit, once for
    //      the interpolation back) so resolved modes feel the full force ----
    this.fft.run(re, im, false);
    const k2ax = this.k2ax, wax = this.wax;
    for (let z = 0; z < m; z++) for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      const i = (z * m + y) * m + x;
      const k2 = k2ax[x] + k2ax[y] + k2ax[z];
      if (k2 === 0) { re[i] = 0; im[i] = 0; continue; }
      const f = -1 / (k2 * wax[x] * wax[y] * wax[z]);
      re[i] *= f; im[i] *= f;
    }
    this.fft.run(re, im, true);                          // re = φ
    // ---- g = −∇φ (4th-order central differences, mesh spacing 1/m) ----
    const c1 = (2 / 3) * m, c2 = (1 / 12) * m;
    const gx = this.gx, gy = this.gy, gz = this.gz;
    const mm = m * m;
    for (let z = 0; z < m; z++) {
      const zo = z * mm;
      const zp = ((z + 1) % m) * mm, zm = ((z - 1 + m) % m) * mm;
      const zpp = ((z + 2) % m) * mm, zmm = ((z - 2 + m) % m) * mm;
      for (let y = 0; y < m; y++) {
        const yo = y * m;
        const yp = ((y + 1) % m) * m, ym = ((y - 1 + m) % m) * m;
        const ypp = ((y + 2) % m) * m, ymm = ((y - 2 + m) % m) * m;
        for (let x = 0; x < m; x++) {
          const xp = (x + 1) % m, xm = (x - 1 + m) % m, xpp = (x + 2) % m, xmm = (x - 2 + m) % m;
          const i = zo + yo + x;
          gx[i] = -(c1 * (re[zo + yo + xp] - re[zo + yo + xm]) - c2 * (re[zo + yo + xpp] - re[zo + yo + xmm]));
          gy[i] = -(c1 * (re[zo + yp + x] - re[zo + ym + x]) - c2 * (re[zo + ypp + x] - re[zo + ymm + x]));
          gz[i] = -(c1 * (re[zp + yo + x] - re[zm + yo + x]) - c2 * (re[zpp + yo + x] - re[zmm + yo + x]));
        }
      }
    }
    // ---- CIC interpolate g and ρ to particles (one pass, shared weights) ----
    const rho = this.rho, ax = this.ax, ay = this.ay, az = this.az, dx = this.dx, dy = this.dy, dz = this.dz;
    for (let p = 0, iz = 0; iz < n; iz++) for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++, p++) {
      const fx = ((ix + 0.5) * inv + dx[p]) * m - 0.5;
      const fy = ((iy + 0.5) * inv + dy[p]) * m - 0.5;
      const fz = ((iz + 0.5) * inv + dz[p]) * m - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
      const tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const xa = ((x0 % m) + m) % m, xb = (xa + 1) % m;
      const ya = ((y0 % m) + m) % m, yb = (ya + 1) % m;
      const za = ((z0 % m) + m) % m, zb = (za + 1) % m;
      const i000 = (za * m + ya) * m + xa, i100 = (za * m + ya) * m + xb;
      const i010 = (za * m + yb) * m + xa, i110 = (za * m + yb) * m + xb;
      const i001 = (zb * m + ya) * m + xa, i101 = (zb * m + ya) * m + xb;
      const i011 = (zb * m + yb) * m + xa, i111 = (zb * m + yb) * m + xb;
      const w000 = (1 - tx) * (1 - ty) * (1 - tz), w100 = tx * (1 - ty) * (1 - tz);
      const w010 = (1 - tx) * ty * (1 - tz),       w110 = tx * ty * (1 - tz);
      const w001 = (1 - tx) * (1 - ty) * tz,       w101 = tx * (1 - ty) * tz;
      const w011 = (1 - tx) * ty * tz,             w111 = tx * ty * tz;
      ax[p] = gx[i000] * w000 + gx[i100] * w100 + gx[i010] * w010 + gx[i110] * w110 + gx[i001] * w001 + gx[i101] * w101 + gx[i011] * w011 + gx[i111] * w111;
      ay[p] = gy[i000] * w000 + gy[i100] * w100 + gy[i010] * w010 + gy[i110] * w110 + gy[i001] * w001 + gy[i101] * w101 + gy[i011] * w011 + gy[i111] * w111;
      az[p] = gz[i000] * w000 + gz[i100] * w100 + gz[i010] * w010 + gz[i110] * w110 + gz[i001] * w001 + gz[i101] * w101 + gz[i011] * w011 + gz[i111] * w111;
      rho[p] = rhoMesh[i000] * w000 + rhoMesh[i100] * w100 + rhoMesh[i010] * w010 + rhoMesh[i110] * w110 + rhoMesh[i001] * w001 + rhoMesh[i101] * w101 + rhoMesh[i011] * w011 + rhoMesh[i111] * w111;
    }
    this.haveForce = true;
  }

  /** Advance to scale factor aNext with one kick–drift–kick step (one force evaluation). */
  step(aNext: number): void {
    const N = this.N, a0 = this.a, da = aNext - a0;
    if (da === 0) return;
    if (!this.haveForce) this.force();
    const kick = (a: number, h: number) => {
      const f = (h * 1.5 * this.bg.omegaMH02(a)) / (a * a * this.bg.H(a));
      for (let p = 0; p < N; p++) { this.px[p] += f * this.ax[p]; this.py[p] += f * this.ay[p]; this.pz[p] += f * this.az[p]; }
    };
    kick(a0, da / 2);
    const am = a0 + da / 2;
    const d = da / (am * am * am * this.bg.H(am));
    for (let p = 0; p < N; p++) { this.dx[p] += d * this.px[p]; this.dy[p] += d * this.py[p]; this.dz[p] += d * this.pz[p]; }
    this.a = aNext;
    this.force();
    kick(aNext, da / 2);
  }

  /** Ensure rho[] reflects the current positions (e.g. right after construction). */
  refreshDensity(): void { this.force(); }

  /** rms of the lattice-sampled nonlinear overdensity δ = ρ − 1 at the particles. */
  rmsDelta(): number {
    let s = 0;
    for (let p = 0; p < this.N; p++) { const d = this.rho[p] - 1; s += d * d; }
    return Math.sqrt(s / this.N);
  }
}
