// Maps the unified clock's literal sim_sec/wall_sec rate to a visual
// integration rate that regimes can use to step their orbital
// dynamics. The clock advances *cosmic time* at the slider's literal
// rate (so the t = X Gyr HUD reads honestly), but a literal integration
// step at Gyr/s would jump 3×10¹⁶ sim_sec per frame — orbits would
// either shatter or, more likely, the per-frame cap would saturate
// and every preset above Day/s would integrate at exactly the same
// visual pace.
//
// The mapping below is logarithmic in speedExp so each chip preset
// produces a visibly distinct orbital rate, with a hard ceiling at
// ~200 sim_sec / wall_sec to keep the integrator stable + cheap.
//
//   rate (sim_sec/wall_sec)  speedExp  visPerWall   note
//   1e-2  (Light)            -2         2.0×10⁻⁴   effectively frozen
//   1     (Real)              0         9.3×10⁻⁴   frozen
//   1e4   (Day/s)             4         0.02       slow
//   1e7.5 (Year/s)            7.5       0.30       slow-medium
//   1e13.5 (Myr/s)           13.5       30         fast
//   1e16.5 (Gyr/s)           16.5       200 (cap)  very fast
//
// Past Gyr/s the visual saturates, but cosmic time on the HUD still
// advances at the literal slider rate. That's the intended split: the
// label tells you what's happening to the universe, the visual tells
// you what your eyes can actually parse.
export function visualRatePerWall(simSecPerWallSec: number): number {
  const r = Math.abs(simSecPerWallSec);
  if (r <= 1e-30) return 0;
  const speedExp = Math.log10(r);
  return Math.min(200, 0.02 * Math.pow(10, (speedExp - 4) / 3));
}
