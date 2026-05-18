// Real-time clock + cosmic-time clock with a wide-range slow-mo speed control.
//
// The single `speedExp` slider (range [-18, 18], log10) maps to a rate in
// sim_seconds_per_wall_second. 0 = pause. Default 16.5 ≈ 1 Gyr/s.
//
// Each wall-clock frame returns { dtWall, dtSim }:
//   - dtWall is the real seconds since last frame (UI animations, shader uniforms).
//   - dtSim  is the elapsed sim-time, in seconds. Cosmic time advances by dtSim/GYR.
// Each regime is responsible for clamping dtSim per integration step if its
// orbital physics can't take that step size — see e.g. GalaxyRegime / SystemRegime.

import { T_UNIV, GYR, expToRate, SPEED_EXP_DEFAULT, SPEED_DEAD_ZONE } from '../util/units';
import { clamp01 } from '../util/lerp';

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
  scrub = 0;
  speedExp = SPEED_EXP_DEFAULT;
  playing = true;
  private prev = performance.now() / 1000;

  get time(): number { return scrubToTime(this.scrub); }   // Gyr

  // sim_sec / wall_sec
  get speed(): number {
    if (!this.playing) return 0;
    return expToRate(this.speedExp);
  }

  get paused(): boolean { return Math.abs(this.speedExp) < SPEED_DEAD_ZONE; }

  tick(): { dtWall: number; dtSim: number } {
    const now = performance.now() / 1000;
    let dtWall = now - this.prev;
    this.prev = now;
    if (dtWall > 1 / 30) dtWall = 1 / 30;
    const dtSim = this.speed * dtWall;
    if (dtSim !== 0) {
      const dtGyr = dtSim / GYR;
      const tNew = Math.max(0, Math.min(T_UNIV, this.time + dtGyr));
      this.scrub = timeToScrub(tNew);
    }
    return { dtWall, dtSim };
  }
}
