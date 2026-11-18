// IEEE 754 half-float packing, for RGBA16F data textures.

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Float → 16-bit half (round toward zero; clamps to ±65504). */
export function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 127 + 15;
  const man = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;                              // underflow → ±0
    return sign | ((man | 0x800000) >>> (14 - exp));         // subnormal
  }
  if (exp >= 31) return sign | 0x7bff;                       // clamp (no Inf)
  return sign | (exp << 10) | (man >>> 13);
}

let table: Float32Array | null = null;
/** Lookup table decoding every 16-bit half to a float. */
export function halfTable(): Float32Array {
  if (table) return table;
  table = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 0x1f, m = h & 0x3ff;
    table[h] = e === 0 ? s * Math.pow(2, -14) * (m / 1024)
             : e === 31 ? (m ? NaN : s * Infinity)
             : s * Math.pow(2, e - 15) * (1 + m / 1024);
  }
  return table;
}
