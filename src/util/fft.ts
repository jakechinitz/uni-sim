// Radix-2 complex FFTs on parallel re/im arrays. Pure arithmetic: used by the
// cosmic-web worker (3-D) and the galaxy disk's gravity solve (2-D).

export class FFT1D {
  private rev: Uint32Array;
  private cos: Float64Array;
  private sin: Float64Array;
  constructor(readonly n: number) {
    const bits = Math.round(Math.log2(n));
    if (1 << bits !== n) throw new Error('FFT size must be a power of two');
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }
  /** Transform one line held in (re, im). inverse=true uses e^{+iθ}; unnormalised. */
  run(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = this.n, rev = this.rev, cs = this.cos, sn = this.sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sgn = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const wr = cs[t], wi = sgn * sn[t];
          const a = s + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }
}

/** In-place 2-D transform of an m×m field indexed [y*m + x]. */
export class FFT2D {
  private f: FFT1D;
  private lr: Float64Array;
  private li: Float64Array;
  constructor(readonly m: number) {
    this.f = new FFT1D(m);
    this.lr = new Float64Array(m);
    this.li = new Float64Array(m);
  }
  run(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const m = this.m, lr = this.lr, li = this.li, f = this.f;
    for (let o = 0; o < m * m; o += m) {                    // rows are contiguous
      for (let i = 0; i < m; i++) { lr[i] = re[o + i]; li[i] = im[o + i]; }
      f.run(lr, li, inverse);
      for (let i = 0; i < m; i++) { re[o + i] = lr[i]; im[o + i] = li[i]; }
    }
    for (let x = 0; x < m; x++) {                           // columns: stride m
      for (let i = 0; i < m; i++) { lr[i] = re[x + i * m]; li[i] = im[x + i * m]; }
      f.run(lr, li, inverse);
      for (let i = 0; i < m; i++) { re[x + i * m] = lr[i]; im[x + i * m] = li[i]; }
    }
    if (inverse) {
      const s = 1 / (m * m);
      for (let i = 0; i < re.length; i++) { re[i] *= s; im[i] *= s; }
    }
  }
}
