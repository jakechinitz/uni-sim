// Paper-faithful gravity.
//
// Two regimes of force law:
//  1) RAR (Radial-Acceleration Relation) for cosmic/galactic/system scales.
//     Smoothly interpolates between Newton (g_bar >> a0) and deep-MOND (sqrt(a0*g_bar)).
//     Gives flat rotation curves and Tully-Fisher without dark matter.
//  2) Substrate q-capacity field for the microstructure.
//     q(x) = clamp(1 - Σ r_s,i / |x - x_i|, 0, 1).
//     Test-defect acceleration = -∇q · c²/2  (weak limit of paper's lapse rule N²=q).
//
// Units are intentionally simulator-internal ("sim units"). Each regime sets its own
// length/mass/time scale; the only invariants we preserve are the *form* of the laws
// and the a0 / G ratios used for crossover.

import { G, a0, c } from '../util/units';

export interface Body {
  id: string;
  pos: [number, number, number];
  vel: [number, number, number];
  mass: number;
  fixed?: boolean;   // when true, ignored by integrator (e.g. while user-dragged)
}

// Soft 1/r with Plummer-style softening to avoid singularities at close range.
const SOFT2 = 1e-8;

// Paper's RAR (Chinitz, paper line 1107):
//   g_obs = g_bar / (1 − exp(−√(g_bar/a₀)))
// With y = g_bar/a₀, the boost factor is therefore
//   ν(y) := g_obs / g_bar = 1 / (1 − exp(−√y)).
// Asymptotes:
//   y → ∞ (Newton):     exp(−√y) → 0, ν → 1.
//   y → 0  (deep-MOND): √y small, 1−exp(−√y) ≈ √y, so ν → 1/√y, which
//                       gives g_obs = g_bar/√y = √(a₀·g_bar). ✓
// The older simple-µ form is kept below for reference.
export function nuRAR(y: number): number {
  if (y <= 0) return 1e15;
  // Fast path: at y > 100 (deep Newton regime), exp(-√y) < 5×10⁻⁵, so
  // ν is within 10⁻⁵ of 1.0. Skip the exp() call — for typical galactic
  // interior dynamics (y ≈ 100..10⁴) this is the hot path and the exp
  // was dominating the per-star integration cost.
  if (y > 100) return 1.0;
  const sy = Math.sqrt(y);
  // 1 − exp(−√y) underflows for very small √y; series expansion
  //   1/(1 − exp(−x)) ≈ 1/x + 1/2 + x/12 − …
  // tells us ν → 1/√y in that limit, so we substitute directly.
  if (sy < 1e-7) return 1 / Math.max(sy, 1e-30);
  const denom = 1 - Math.exp(-sy);
  return 1 / denom;
}

// Older simple-µ family: ν(y) = 1/2 + √(1/4 + 1/y). Kept for diff /
// comparison work; not wired in.
export function nuRAR_simple(y: number): number {
  if (y <= 1e-30) return 1e15;
  return 0.5 + Math.sqrt(0.25 + 1 / y);
}

// Pairwise force from body j on a test point. Returns acceleration vector (sim units).
// `gScale` is the regime's gravity coupling (G in SI, or a scaled equivalent).
// `a0Scale` is the regime's MOND scale.
export function pairAccelRAR(
  rx: number, ry: number, rz: number,        // r_test - r_source
  mass: number,
  gScale: number,
  a0Scale: number
): [number, number, number] {
  const r2  = rx * rx + ry * ry + rz * rz + SOFT2;
  const r   = Math.sqrt(r2);
  const gBar = gScale * mass / r2;             // Newtonian magnitude
  const y    = gBar / a0Scale;
  const nu   = nuRAR(y);
  const gObs = nu * gBar;
  const k    = -gObs / r;                       // pull toward source
  return [k * rx, k * ry, k * rz];
}

export function accelOnRAR(
  i: number,
  bodies: Body[],
  gScale: number,
  a0Scale: number
): [number, number, number] {
  const bi = bodies[i];
  let ax = 0, ay = 0, az = 0;
  for (let j = 0; j < bodies.length; j++) {
    if (j === i) continue;
    const bj = bodies[j];
    const rx = bi.pos[0] - bj.pos[0];
    const ry = bi.pos[1] - bj.pos[1];
    const rz = bi.pos[2] - bj.pos[2];
    const a  = pairAccelRAR(rx, ry, rz, bj.mass, gScale, a0Scale);
    ax += a[0]; ay += a[1]; az += a[2];
  }
  return [ax, ay, az];
}

// --- Substrate q-field --------------------------------------------------

export interface Defect {
  id: string;
  pos: [number, number, number];
  rS: number;   // Schwarzschild-like saturation radius (sim units)
}

// q at point x given defects. Clamped to [0,1]; q=0 ⇒ saturated (black-hole region).
export function qField(px: number, py: number, pz: number, defects: Defect[]): number {
  let drain = 0;
  for (const d of defects) {
    const rx = px - d.pos[0], ry = py - d.pos[1], rz = pz - d.pos[2];
    const r = Math.sqrt(rx * rx + ry * ry + rz * rz) + 1e-6;
    drain += d.rS / r;
  }
  return Math.max(0, Math.min(1, 1 - drain));
}

// -∇q · c²/2 — the substrate force on a test defect.
// We compute analytically: ∂q/∂x_k = - Σ d.rS · (x_k - d.pos_k) / |r|^3  (only where unclamped).
export function gradAccelQ(
  px: number, py: number, pz: number,
  defects: Defect[],
  cScale: number = 1
): [number, number, number] {
  let dqx = 0, dqy = 0, dqz = 0;
  // Skip if saturated; the field is flat (clamp) inside the BH region.
  let drain = 0;
  for (const d of defects) {
    const rx = px - d.pos[0], ry = py - d.pos[1], rz = pz - d.pos[2];
    const r2 = rx * rx + ry * ry + rz * rz + 1e-12;
    const r  = Math.sqrt(r2);
    drain += d.rS / r;
    const k = d.rS / (r2 * r);   // d/dx (1/r) = -x/r^3, so ∂drain/∂x = -k·rx; ∂q/∂x = +k·rx
    dqx += k * rx;
    dqy += k * ry;
    dqz += k * rz;
  }
  if (drain >= 1) return [0, 0, 0]; // saturated -> no gradient (inside horizon)
  // a = -∇q · c²/2
  const s = -0.5 * cScale * cScale;
  return [s * dqx, s * dqy, s * dqz];
}

// Leapfrog (kick-drift-kick) for arbitrary acceleration provider
export function stepLeapfrog(
  bodies: Body[],
  dt: number,
  accel: (i: number, bodies: Body[]) => [number, number, number]
): void {
  // half-kick + drift + half-kick.
  const n = bodies.length;
  const a0arr: [number, number, number][] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (bodies[i].fixed) { a0arr[i] = [0, 0, 0]; continue; }
    a0arr[i] = accel(i, bodies);
  }
  for (let i = 0; i < n; i++) {
    if (bodies[i].fixed) continue;
    bodies[i].vel[0] += 0.5 * dt * a0arr[i][0];
    bodies[i].vel[1] += 0.5 * dt * a0arr[i][1];
    bodies[i].vel[2] += 0.5 * dt * a0arr[i][2];
    bodies[i].pos[0] += dt * bodies[i].vel[0];
    bodies[i].pos[1] += dt * bodies[i].vel[1];
    bodies[i].pos[2] += dt * bodies[i].vel[2];
  }
  for (let i = 0; i < n; i++) {
    if (bodies[i].fixed) continue;
    const a1 = accel(i, bodies);
    bodies[i].vel[0] += 0.5 * dt * a1[0];
    bodies[i].vel[1] += 0.5 * dt * a1[1];
    bodies[i].vel[2] += 0.5 * dt * a1[2];
  }
}

// Re-export constants for callers that want raw SI baselines.
export const _SI = { G, a0, c };
