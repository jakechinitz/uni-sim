// Deterministic PRNG and hashed sub-seeds for per-cell, per-object generation.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function splitmix32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x9E3779B9) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x85EBCA6B);
    t = Math.imul(t ^ (t >>> 13), 0xC2B2AE35);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, arr: T[]): T {
  return arr[(rng() * arr.length) | 0];
}
export function range(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}
export function gauss(rng: Rng): number {
  // Box–Muller
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
