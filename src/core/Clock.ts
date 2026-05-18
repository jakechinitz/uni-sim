// Maps real wall time -> cosmic time (Gyr), with non-linear scrub mapping.
import { T_UNIV } from '../util/units';
import { clamp01 } from '../util/lerp';

// scrub in [0,1] -> cosmicTime in [0, T_UNIV] Gyr (early universe gets ~half the screen time)
export function scrubToTime(s: number): number {
  s = clamp01(s);
  const K = 8;
  return T_UNIV * (Math.exp(K * s) - 1) / (Math.exp(K) - 1);
}
export function timeToScrub(t: number): number {
  const K = 8;
  return Math.log(1 + (t / T_UNIV) * (Math.exp(K) - 1)) / K;
}

export class Clock {
  scrub = 0;                 // 0..1 (drives time)
  speedExp = 1;              // -3..3 log10, 0 = pause
  playing = true;
  private prev = performance.now() / 1000;

  get time(): number { return scrubToTime(this.scrub); }   // Gyr
  get speed(): number {
    if (!this.playing) return 0;
    // sign(s)*10^|s| for asymmetric log scale; treat |s|<0.02 as ~zero
    if (Math.abs(this.speedExp) < 0.02) return 0;
    const sign = this.speedExp < 0 ? -1 : 1;
    return sign * Math.pow(10, Math.abs(this.speedExp));
  }

  tick(): number {
    const now = performance.now() / 1000;
    let dt = now - this.prev;
    this.prev = now;
    if (dt > 1 / 30) dt = 1 / 30; // clamp post-unfocus jumps
    if (this.speed !== 0) {
      // 1.0 unit of speed = 1 Gyr per real second of viewing
      const tNew = Math.max(0, Math.min(T_UNIV, this.time + this.speed * dt));
      this.scrub = timeToScrub(tNew);
    }
    return dt;
  }
}
