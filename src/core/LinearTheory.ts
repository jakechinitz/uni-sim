// Linear perturbation theory inputs for the cosmic-web N-body.
//
// The paper's committed stock is pressureless dust formed before the acoustic
// era with δ_c = δ_b (§20), so its linear transfer function has the standard
// cold-matter shape for the same ω_m, ω_b. We use the Eisenstein & Hu (1998)
// no-wiggle fitting form. The primordial amplitude and tilt are NOT derived by
// the paper (its likelihood fits ln A_s and n_s), so σ₈ and n_s below are
// observational inputs.

export const N_S = 0.965;        // primordial tilt (input)
export const SIGMA_8 = 0.81;     // linear rms in 8 h⁻¹Mpc spheres today (input)
const T_CMB = 2.7255;

/** Eisenstein–Hu no-wiggle transfer function. k in h/Mpc. */
export function transferEH(k: number, omegaM: number, omegaB: number, h: number): number {
  const wm = omegaM * h * h, wb = omegaB * h * h, fb = omegaB / omegaM;
  const theta = T_CMB / 2.7;
  const s = 44.5 * Math.log(9.83 / wm) / Math.sqrt(1 + 10 * Math.pow(wb, 0.75));       // sound horizon, Mpc
  const alpha = 1 - 0.328 * Math.log(431 * wm) * fb + 0.38 * Math.log(22.3 * wm) * fb * fb;
  const kMpc = k * h;
  const gamma = omegaM * h * (alpha + (1 - alpha) / (1 + Math.pow(0.43 * kMpc * s, 4)));
  const q = k * theta * theta / gamma;
  const L0 = Math.log(2 * Math.E + 1.8 * q);
  const C0 = 14.2 + 731 / (1 + 62.5 * q);
  return L0 / (L0 + C0 * q * q);
}

/**
 * Linear matter power spectrum today, P(k) in (h⁻¹Mpc)³ with k in h/Mpc,
 * normalised to SIGMA_8.
 */
export function makePower(omegaM: number, omegaB: number, h: number): (k: number) => number {
  const shape = (k: number) => Math.pow(k, N_S) * transferEH(k, omegaM, omegaB, h) ** 2;
  // σ²(R) = (1/2π²) ∫ k² P(k) W²(kR) dk, top-hat window, R = 8 h⁻¹Mpc
  const R = 8;
  let s2 = 0;
  const n = 4000, lk0 = Math.log(1e-4), lk1 = Math.log(50), d = (lk1 - lk0) / n;
  for (let i = 0; i < n; i++) {
    const k = Math.exp(lk0 + (i + 0.5) * d), x = k * R;
    const w = 3 * (Math.sin(x) - x * Math.cos(x)) / (x * x * x);
    s2 += k * k * k * shape(k) * w * w * d;
  }
  s2 /= 2 * Math.PI * Math.PI;
  const A = SIGMA_8 * SIGMA_8 / s2;
  return (k: number) => A * shape(k);
}

/** Linear rms today in top-hat spheres of radius R (h⁻¹Mpc) for the spectrum P. */
export function sigmaTopHat(P: (k: number) => number, R: number): number {
  let s2 = 0;
  const n = 6000, lk0 = Math.log(1e-4), lk1 = Math.log(400 / Math.max(R, 0.05)), d = (lk1 - lk0) / n;
  for (let i = 0; i < n; i++) {
    const k = Math.exp(lk0 + (i + 0.5) * d), x = k * R;
    const w = x < 1e-3 ? 1 : 3 * (Math.sin(x) - x * Math.cos(x)) / (x * x * x);
    s2 += k * k * k * P(k) * w * w * d;
  }
  return Math.sqrt(s2 / (2 * Math.PI * Math.PI));
}

/** Top-hat radius (h⁻¹Mpc) enclosing mass M (M☉) at the mean matter density. */
export function lagrangianRadius(massMsun: number, omegaM: number, h: number): number {
  const rhoM = omegaM * 2.775e11;                 // h² M☉ / Mpc³
  return Math.cbrt((3 * massMsun * h) / (4 * Math.PI * rhoM));
}

/**
 * Linear growth factor D(a), normalised to D(1) = 1, on the supplied
 * background:  D'' + (3/a + H'/H) D' = (3/2) ω_m(a) H100² D / (a⁵ H²).
 * Returns a sampler giving { D, dDda }.
 *   H(a)        — Hubble rate in 1/Gyr
 *   omH02(a)    — ω_m(a)·a³ in units of H², i.e. Ω_m,eff(a)·H0² in 1/Gyr²
 */
export function makeGrowth(H: (a: number) => number, omH02: (a: number) => number, aMax = 2.2) {
  const a0 = 1e-3, n = 4000;
  const la0 = Math.log(a0), la1 = Math.log(aMax), h = (la1 - la0) / n;
  const D = new Float64Array(n + 1), dD = new Float64Array(n + 1);
  // y = (D, dD/dlna). In ln a:  D'' + (2 + dlnH/dlna) D' = 1.5 omH02 D / (a³ H²)
  const dlnH = (la: number) => { const e = 1e-4; return (Math.log(H(Math.exp(la + e))) - Math.log(H(Math.exp(la - e)))) / (2 * e); };
  const f = (la: number, y0: number, y1: number): [number, number] => {
    const a = Math.exp(la), Hh = H(a);
    return [y1, -(2 + dlnH(la)) * y1 + 1.5 * omH02(a) * y0 / (a * a * a * Hh * Hh)];
  };
  // Start on the matter-era growing mode D ∝ a (radiation correction is < 1 % of the final normalised D here).
  let y0 = a0, y1 = a0;
  D[0] = y0; dD[0] = y1;
  for (let i = 0; i < n; i++) {
    const la = la0 + i * h;
    const k1 = f(la, y0, y1);
    const k2 = f(la + h / 2, y0 + h / 2 * k1[0], y1 + h / 2 * k1[1]);
    const k3 = f(la + h / 2, y0 + h / 2 * k2[0], y1 + h / 2 * k2[1]);
    const k4 = f(la + h, y0 + h * k3[0], y1 + h * k3[1]);
    y0 += h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y1 += h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    D[i + 1] = y0; dD[i + 1] = y1;
  }
  // normalise to D(1) = 1
  const at = (a: number) => {
    const x = Math.min(n, Math.max(0, (Math.log(a) - la0) / h));
    const i = Math.min(n - 1, Math.floor(x)), t = x - i;
    return { D: D[i] * (1 - t) + D[i + 1] * t, dDdlna: dD[i] * (1 - t) + dD[i + 1] * t };
  };
  const d1 = at(1).D;
  return (a: number) => {
    if (a < a0) return { D: a / d1, dDda: 1 / d1 };
    const r = at(a);
    return { D: r.D / d1, dDda: r.dDdlna / a / d1 };
  };
}
