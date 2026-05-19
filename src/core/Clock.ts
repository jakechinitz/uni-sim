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

import { T_UNIV, GYR, expToRate, SPEED_EXP_DEFAULT } from '../util/units';
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
  // Cosmic time in Gyr is the source of truth. Floor is 0 (Big Bang);
  // there is no upper bound — time can run into the heat-death future.
  // The TIME slider's scrub ∈ [0,1] maps to t ∈ [0, T_UNIV] via the
  // existing exponential map; past T_UNIV the slider sits at 1.
  timeGyr = 0;
  speedExp = SPEED_EXP_DEFAULT;
  direction: 1 | -1 = 1;
  playing = true;
  // Log-pace mode: the play head advances the SCRUB linearly (not the
  // cosmic time). Because scrub→time is exponential (K=8), this gives
  // every decade of cosmic history roughly equal wall-time visibility —
  // ideal for the Big Bang button. logPaceWallSec controls how long
  // the whole 0→13.8 Gyr sweep takes in wall-clock seconds.
  useLogPace = false;
  logPaceWallSec = 35;
  private prev = performance.now() / 1000;
  atFloor = false;          // hit t = 0 while rewinding (no further past)

  // Slider position. Setting it scrubs cosmic time; getting it clamps at 1
  // once you've drifted past present-day.
  get scrub(): number {
    return this.timeGyr <= T_UNIV ? timeToScrub(this.timeGyr) : 1;
  }
  set scrub(s: number) {
    this.timeGyr = scrubToTime(clamp01(s));
  }

  get time(): number { return this.timeGyr; }

  // sim_sec / wall_sec, signed by direction
  get speed(): number {
    if (!this.playing) return 0;
    return this.direction * expToRate(this.speedExp);
  }

  get paused(): boolean { return !this.playing; }

  tick(): { dtWall: number; dtSim: number } {
    const now = performance.now() / 1000;
    let dtWall = now - this.prev;
    this.prev = now;
    if (dtWall > 1 / 30) dtWall = 1 / 30;
    this.atFloor = false;

    // Log-pace mode: forward-only, advances the SCRUB linearly so the
    // exponential scrub→time map spreads early-universe history across
    // many wall-seconds. dtSim is then the implied cosmic-time advance,
    // which downstream regimes still clamp internally.
    if (this.useLogPace && this.playing && this.direction === 1) {
      const prevTime = this.timeGyr;
      const newScrub = Math.min(1, this.scrub + dtWall / this.logPaceWallSec);
      this.scrub = newScrub;
      if (newScrub >= 1) this.useLogPace = false;   // ride out into normal-speed
      const dtSim = Math.max(0, this.timeGyr - prevTime) * GYR;
      return { dtWall, dtSim };
    }

    const dtSim = this.speed * dtWall;
    if (dtSim !== 0) {
      const dtGyr = dtSim / GYR;
      this.timeGyr = Math.max(0, this.timeGyr + dtGyr);
      if (this.timeGyr <= 0 && this.direction < 0) this.atFloor = true;
    }
    return { dtWall, dtSim };
  }
}
