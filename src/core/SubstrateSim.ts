// Real substrate engine — paper §17 telegrapher PDE on a 3D grid + discrete
// defects (paper §13). Runs on the main thread; vectorised typed-array loops
// keep it cheap enough for 60 fps at modest N.
//
//   First-order telegrapher system (D/τ₀ = c² → signals travel at exactly c):
//     ∂t q = -∇·Π
//     τ₀ ∂t Π = -D ∇q - Π
//
//   Discretised with central differences on a uniform N³ grid (spacing h=1):
//     Π_x[i,j,k] ← Π_x + dt·( -D (q[i+1,j,k]-q[i,j,k]) - Π_x ) / τ₀
//     q[i,j,k]   ← q + dt·(-(Π_x[i,j,k]-Π_x[i-1,j,k]) - (Π_y...)−(Π_z...))
//
//   Periodic boundaries (toroidal lattice).
//   CFL: dt < h/c. With c=1, h=1, we use dt=0.4.
//
// Defects = discrete one-bit fermionic anchors (paper §13). They drain
// capacity in their neighbourhood: each defect deposits a negative source
// −drainRate × kernel into q. They move ballistically + feel −∇q gradient
// (paper §11–12: gravity = relaxation of substrate around defects). When two
// defects come close their wells merge and q can drop below the q_sat
// threshold → that patch is a saturated mini-BH (paper §20).
//
// Wave packets ("photons") are emitted as a Gaussian bump in q paired with
// a matching Π so the bump moves coherently — propagates at exactly c.

const D     = 1.0;     // diffusion / stiffness (per paper, D = c² τ₀)
const TAU0  = 1.0;     // relaxation time
const CFL_DT = 0.4;
const Q_SAT = 0.04;    // q < this → saturated (BH-like)

export interface SimDefect {
  id: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  drainRate: number;     // per-step capacity draw
  fixed: boolean;
}

function idx(N: number, i: number, j: number, k: number) {
  return ((i + N) % N) + ((j + N) % N) * N + ((k + N) % N) * N * N;
}

function clampQ(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export class SubstrateSim {
  N: number;
  q:  Float32Array;     // capacity, baseline = 1
  Px: Float32Array;     // canonical current x
  Py: Float32Array;
  Pz: Float32Array;
  defects: SimDefect[] = [];
  private internalT = 0;
  private maxSubstepsPerFrame = 4;

  constructor(N = 28) {
    this.N = N;
    const V = N * N * N;
    this.q  = new Float32Array(V).fill(1.0);
    this.Px = new Float32Array(V);
    this.Py = new Float32Array(V);
    this.Pz = new Float32Array(V);
  }

  // Advance by dt sim-seconds. Caps total advance at maxSubstepsPerFrame × CFL_DT
  // so fast-forward doesn't run the lattice unstably.
  step(dt: number) {
    const dtAbs = Math.abs(dt);
    if (dtAbs < 1e-9) return;
    const totalLocal = Math.min(dtAbs, this.maxSubstepsPerFrame * CFL_DT);
    const substeps   = Math.max(1, Math.ceil(totalLocal / CFL_DT));
    const sub = totalLocal / substeps;
    for (let s = 0; s < substeps; s++) this.substep(sub);
  }

  private substep(dt: number) {
    const N = this.N;
    const { q, Px, Py, Pz } = this;
    // Defect sources: deposit −drain into nearest grid cell each substep.
    // Cheap nearest-cell delta-source. With softening this becomes the
    // paper's continuum Schwarzschild form q(r) = 1 − 2GM/c²r.
    for (const d of this.defects) {
      const ix = Math.floor(d.x);
      const iy = Math.floor(d.y);
      const iz = Math.floor(d.z);
      const I = idx(N, ix, iy, iz);
      q[I] = clampQ(q[I] - d.drainRate * dt);
    }

    // Update momenta from current q-gradient (forward differences)
    for (let k = 0; k < N; k++) {
      const kp = ((k + 1) % N) * N * N;
      const kc = k * N * N;
      for (let j = 0; j < N; j++) {
        const jp = ((j + 1) % N) * N;
        const jc = j * N;
        for (let i = 0; i < N; i++) {
          const ic = i;
          const ip = (i + 1) % N;
          const c  = kc + jc + ic;
          const gx = q[kc + jc + ip] - q[c];
          const gy = q[kc + jp + ic] - q[c];
          const gz = q[kp + jc + ic] - q[c];
          // dΠ/dt = (-D∇q - Π)/τ₀
          const a = dt / TAU0;
          Px[c] += a * (-D * gx - Px[c]);
          Py[c] += a * (-D * gy - Py[c]);
          Pz[c] += a * (-D * gz - Pz[c]);
        }
      }
    }

    // Update q from divergence of Π (backward differences pair w/ forward grad above)
    for (let k = 0; k < N; k++) {
      const km = ((k + N - 1) % N) * N * N;
      const kc = k * N * N;
      for (let j = 0; j < N; j++) {
        const jm = ((j + N - 1) % N) * N;
        const jc = j * N;
        for (let i = 0; i < N; i++) {
          const im = (i + N - 1) % N;
          const ic = i;
          const c  = kc + jc + ic;
          const div = (Px[c] - Px[kc + jc + im])
                    + (Py[c] - Py[kc + jm + ic])
                    + (Pz[c] - Pz[km + jc + ic]);
          q[c] = clampQ(q[c] - dt * div);
        }
      }
    }

    // Advance defects: ballistic + biased by -∇q (gravity from substrate
    // relaxation; paper §11)
    for (const d of this.defects) {
      if (d.fixed) continue;
      // Sample ∇q at defect position (trilinear → just centred differences
      // around the nearest cell)
      const ix = Math.floor(d.x), iy = Math.floor(d.y), iz = Math.floor(d.z);
      const ip = (ix + 1) % N, im = (ix + N - 1) % N;
      const jp = (iy + 1) % N, jm = (iy + N - 1) % N;
      const kp = (iz + 1) % N, kmm = (iz + N - 1) % N;
      const gx = (q[idx(N, ip, iy, iz)] - q[idx(N, im, iy, iz)]) * 0.5;
      const gy = (q[idx(N, ix, jp, iz)] - q[idx(N, ix, jm, iz)]) * 0.5;
      const gz = (q[idx(N, ix, iy, kp)] - q[idx(N, ix, iy, kmm)]) * 0.5;
      const fmag = 1.5;
      d.vx += dt * fmag * gx - 0.6 * dt * d.vx;
      d.vy += dt * fmag * gy - 0.6 * dt * d.vy;
      d.vz += dt * fmag * gz - 0.6 * dt * d.vz;
      d.x = (d.x + dt * d.vx + N) % N;
      d.y = (d.y + dt * d.vy + N) % N;
      d.z = (d.z + dt * d.vz + N) % N;
    }

    this.internalT += dt;
  }

  // Emit a wavepacket — a Gaussian bump in q paired with matching Π so it
  // moves coherently in direction `dir` at exactly c.
  emitPacket(x: number, y: number, z: number, dirX: number, dirY: number, dirZ: number, amp = 0.18, sigma = 1.8) {
    const N = this.N;
    const len = Math.hypot(dirX, dirY, dirZ) || 1;
    const ux = dirX / len, uy = dirY / len, uz = dirZ / len;
    const r = Math.max(2, Math.ceil(sigma * 2.5));
    const ix0 = Math.round(x), iy0 = Math.round(y), iz0 = Math.round(z);
    for (let dk = -r; dk <= r; dk++)
    for (let dj = -r; dj <= r; dj++)
    for (let di = -r; di <= r; di++) {
      const rr = di * di + dj * dj + dk * dk;
      const g = amp * Math.exp(-rr / (2 * sigma * sigma));
      const c = idx(N, ix0 + di, iy0 + dj, iz0 + dk);
      this.q[c]  = clampQ(this.q[c] - g);
      this.Px[c] += g * ux;
      this.Py[c] += g * uy;
      this.Pz[c] += g * uz;
    }
  }

  // Trilinear sample of q at world (lattice-fractional) position.
  qAt(x: number, y: number, z: number): number {
    const N = this.N;
    const fx = (x % N + N) % N, fy = (y % N + N) % N, fz = (z % N + N) % N;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const q = this.q;
    const c000 = q[idx(N, ix,   iy,   iz)];
    const c100 = q[idx(N, ix+1, iy,   iz)];
    const c010 = q[idx(N, ix,   iy+1, iz)];
    const c110 = q[idx(N, ix+1, iy+1, iz)];
    const c001 = q[idx(N, ix,   iy,   iz+1)];
    const c101 = q[idx(N, ix+1, iy,   iz+1)];
    const c011 = q[idx(N, ix,   iy+1, iz+1)];
    const c111 = q[idx(N, ix+1, iy+1, iz+1)];
    const c00 = c000 * (1 - tx) + c100 * tx;
    const c10 = c010 * (1 - tx) + c110 * tx;
    const c01 = c001 * (1 - tx) + c101 * tx;
    const c11 = c011 * (1 - tx) + c111 * tx;
    const c0  = c00  * (1 - ty) + c10  * ty;
    const c1  = c01  * (1 - ty) + c11  * ty;
    return clampQ(c0 * (1 - tz) + c1 * tz);
  }

  addDefect(x: number, y: number, z: number, drainRate = 0.3, id?: string): SimDefect {
    const d: SimDefect = {
      id: id ?? `d${this.defects.length}`,
      x, y, z,
      vx: 0, vy: 0, vz: 0,
      drainRate, fixed: false
    };
    this.defects.push(d);
    return d;
  }

  // Slowly relax q toward 1 everywhere — keeps the lattice from going dead
  // after long defect interactions.
  relax(rate: number, dt: number) {
    const k = Math.min(0.95, rate * dt);
    for (let i = 0; i < this.q.length; i++) {
      this.q[i] = clampQ(this.q[i] + (1 - this.q[i]) * k);
    }
  }

  qRange(): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < this.q.length; i++) {
      const v = this.q[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  }

  // Count saturated cells (q < Q_SAT) — proxy for BH-like volume
  saturationFraction(): number {
    let n = 0;
    for (let i = 0; i < this.q.length; i++) if (this.q[i] < Q_SAT) n++;
    return n / this.q.length;
  }
}

export const SUB_Q_SAT = Q_SAT;
