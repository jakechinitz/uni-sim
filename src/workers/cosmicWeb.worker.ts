// Web Worker: evolves the cosmic web off the main thread and streams keyframes.
//
// The run is a particle-mesh N-body (core/CosmicPM.ts) of the total clustering
// matter — baryons plus the paper's committed stock at 5.333 per baryon, as
// collisionless dust — on the sim's integrated background (core/Cosmology.ts),
// from Zel'dovich initial conditions with the linear spectrum of
// core/LinearTheory.ts. Each keyframe holds, for every rendered tracer, its
// displacement from its lattice site (box units) and its local density ρ/ρ̄,
// packed as half floats ready to upload as an RGBA16F texture.

import { CosmicPM } from '../core/CosmicPM';
import { hubble, omegaMatterH2, OMEGA_M, OMEGA_B, LITTLE_H } from '../core/Cosmology';
import { makePower, makeGrowth, sigmaTopHat, lagrangianRadius } from '../core/LinearTheory';
import { toHalf } from '../util/half';

export interface WebRequest {
  seed: number;
  n: number;           // particles per side (mesh has the same resolution)
  nRender: number;     // tracers streamed back (≤ n³)
  boxMpcH: number;     // comoving box side, h⁻¹Mpc
}
export type WebMessage =
  | {
      type: 'meta'; aKeys: Float32Array; dKeys: Float32Array; q: Float32Array; nRender: number;
      /** Linear overdensity today at each tracer's lattice site. */
      deltaLin: Float32Array;
      /** Variance of that field over the lattice (the scale the run resolves). */
      sCell: number;
      /** Variance at the galaxy-forming mass scale (see GALAXY_MASS). */
      sGal: number;
    }
  | { type: 'frame'; k: number; data: Uint16Array }
  | { type: 'done'; ms: number };

const A_START = 0.02;          // z = 49
const A_END = 2.0;             // the run continues a little into the future
const H100 = 0.1022712;        // 100 km/s/Mpc in 1/Gyr
// Halo mass above which gas is retained and stars form: the paper's
// post-reionization retention gate, V_crit = 30 km/s, is M ≈ 10¹⁰ M☉ today.
const GALAXY_MASS = 1e10;

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

/** Scale factors of the integration steps and which of them are kept as keyframes. */
function schedule(): { a: number; keep: boolean }[] {
  const out: { a: number; keep: boolean }[] = [];
  let a = A_START, i = 0;
  while (a < A_END - 1e-9) {
    const da = a < 1 ? Math.min(0.1 * a, 0.025) : 0.05;
    let next = a + da;
    if (a < 1 && next > 1 - 1e-9) next = 1;          // land exactly on today
    if (next > A_END) next = A_END;
    a = next; i++;
    // In the linear era displacements grow ∝ D(a), so interpolating in D is
    // exact and sparse keyframes suffice; keep every step once steps are uniform.
    const keep = a >= 0.25 ? (a <= 1 + 1e-9 || i % 2 === 0) : i % 4 === 0;
    out.push({ a, keep: keep || Math.abs(a - 1) < 1e-9 || a >= A_END - 1e-9 });
  }
  return out;
}

self.onmessage = (ev: MessageEvent<WebRequest>) => {
  const { seed, n, nRender, boxMpcH } = ev.data;
  const t0 = performance.now();
  const post = (m: WebMessage, transfer: Transferable[] = []) =>
    (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(m, transfer);

  const bg = { H: hubble, omegaMH02: (a: number) => omegaMatterH2(a) * H100 * H100 };
  const growth = makeGrowth(bg.H, bg.omegaMH02, A_END * 1.1);
  const P = makePower(OMEGA_M, OMEGA_B, LITTLE_H);
  const V = boxMpcH ** 3;
  const pm = new CosmicPM({
    n, mesh: n, seed, aStart: A_START, growthStart: growth(A_START),
    modePower: (kInt) => P((2 * Math.PI * kInt) / boxMpcH) / V,
  }, bg);
  const N = pm.N;

  // Tracers: a seeded random subset of the particles (partial Fisher–Yates).
  const rnd = rng32(seed ^ 0x9e3779b9);
  const idx = new Uint32Array(N);
  for (let i = 0; i < N; i++) idx[i] = i;
  const R = Math.min(nRender, N);
  for (let i = 0; i < R; i++) {
    const j = i + Math.floor(rnd() * (N - i));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  const q = new Float32Array(R * 3);
  for (let i = 0; i < R; i++) {
    const p = idx[i];
    const ix = p % n, iy = Math.floor(p / n) % n, iz = Math.floor(p / (n * n));
    q[i * 3] = (ix + 0.5) / n; q[i * 3 + 1] = (iy + 0.5) / n; q[i * 3 + 2] = (iz + 0.5) / n;
  }

  const steps = schedule();
  // Keyframe 0 is a = 0 (no displacement, uniform density); 1 is the ICs.
  const aList = [0, A_START, ...steps.filter(s => s.keep).map(s => s.a)];
  const aKeys = Float32Array.from(aList);
  const dKeys = Float32Array.from(aList.map(a => (a === 0 ? 0 : growth(a).D)));
  const deltaLin = new Float32Array(R);
  for (let i = 0; i < R; i++) deltaLin[i] = pm.deltaLin[idx[i]];
  let sCell = 0;
  for (let p = 0; p < N; p++) sCell += pm.deltaLin[p] * pm.deltaLin[p];
  sCell /= N;
  const sGal = sigmaTopHat(P, lagrangianRadius(GALAXY_MASS, OMEGA_M, LITTLE_H)) ** 2;
  post({ type: 'meta', aKeys, dKeys, q, nRender: R, deltaLin, sCell, sGal });

  const pack = (uniform: boolean): Uint16Array => {
    const out = new Uint16Array(R * 4);
    const one = toHalf(1);
    for (let i = 0; i < R; i++) {
      const p = idx[i];
      if (uniform) { out[i * 4 + 3] = one; continue; }
      out[i * 4] = toHalf(pm.dx[p]); out[i * 4 + 1] = toHalf(pm.dy[p]); out[i * 4 + 2] = toHalf(pm.dz[p]);
      out[i * 4 + 3] = toHalf(pm.rho[p]);
    }
    return out;
  };
  const send = (k: number, uniform = false) => { const data = pack(uniform); post({ type: 'frame', k, data }, [data.buffer]); };

  send(0, true);
  pm.refreshDensity();
  send(1);
  let k = 2;
  for (const s of steps) {
    pm.step(s.a);
    if (s.keep) send(k++);
  }
  post({ type: 'done', ms: performance.now() - t0 });
};
