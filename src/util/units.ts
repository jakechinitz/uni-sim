// Physical constants & length scales. Paper-faithful values where relevant.

export const G   = 6.674e-11;   // SI Newton constant (RAR strong-field limit)
export const c   = 2.998e8;     // m/s
export const H0  = 2.18e-18;    // Hubble today, s^-1 (~67 km/s/Mpc)
export const a0  = 1.2e-10;     // m/s^2 - galactic acceleration scale; paper's g_share,eff·cH0/(4π²)

export const M_SUN = 1.989e30;  // kg
export const M_EARTH = 5.972e24;
export const PC    = 3.086e16;  // m
export const KPC   = 1e3 * PC;
export const MPC   = 1e6 * PC;
export const AU    = 1.496e11;
export const LY    = 9.461e15;
export const GYR   = 3.156e16;  // s
export const T_UNIV = 13.8;     // Gyr, paper

// Paper-derived structure invariants
export const TET_FACES   = 4;
export const FACE_STATES = 7;
export const TET_MICROSTATES = 1680;
export const G_SHARE_EFF = 7.42;

// Cosmology
export const Z_EQ        = 3400;      // matter-radiation equality, where EDE pulse fires
export const Z_RECOMB    = 1100;
export const Z_FIRST_BH  = 25;
export const Z_GALAXIES  = 8;

export const SCALE = {
  // log10(metres) midpoint for each regime
  COSMIC:    25,
  GALAXY:    21,
  SYSTEM:    13,
  PLANET:    7,
  ATOMIC:    -10,
  SUBSTRATE: -16,
} as const;

// Speed-slider semantics: PURE LOG-MAGNITUDE of forward sim_sec/wall_sec.
// Range covers ~36 orders of magnitude. Negative exp = slow-mo forward
// (Quantum, Light), positive = fast forward (Year/s, Gyr/s). exp = 0 is
// 1× real time. Pause / rewind are separate states managed by the Clock:
// pause flips clock.playing; rewind flips clock.direction. This avoids
// the prior "negative exp = rewind" confusion where Light slow-mo was
// silently making time run backwards.
export const SPEED_EXP_MIN = -18;
export const SPEED_EXP_MAX = 18;
export const SPEED_EXP_DEFAULT = 16.5;

// Convert speed-exponent → sim_sec / wall_sec (always positive forward rate).
export function expToRate(exp: number): number {
  return Math.pow(10, exp);
}

// Human-readable formatting of a sim_sec/wall_sec rate.
const _MIN = 60, _HR = 3600, _DAY = 86400, _YR = 3.156e7;
export function formatRate(rate: number): string {
  if (rate === 0) return 'paused';
  const sign = rate < 0 ? '↶ ' : '';
  const a = Math.abs(rate);
  if (a < 1e-12) return `${sign}${(a * 1e15).toFixed(2)} fs/s`;
  if (a < 1e-9)  return `${sign}${(a * 1e12).toFixed(2)} ps/s`;
  if (a < 1e-6)  return `${sign}${(a * 1e9).toFixed(2)} ns/s`;
  if (a < 1e-3)  return `${sign}${(a * 1e6).toFixed(1)} μs/s`;
  if (a < 0.5)   return `${sign}${(a * 1e3).toFixed(0)} ms/s`;
  if (a < 50)    return `${sign}${a.toFixed(2)}× real`;
  if (a < _HR)   return `${sign}${(a / _MIN).toFixed(1)} min/s`;
  if (a < _DAY)  return `${sign}${(a / _HR).toFixed(1)} hr/s`;
  if (a < _YR)   return `${sign}${(a / _DAY).toFixed(1)} day/s`;
  if (a < 1e6 * _YR) return `${sign}${(a / _YR).toFixed(0)} yr/s`;
  if (a < 1e9 * _YR) return `${sign}${(a / (1e6 * _YR)).toFixed(1)} Myr/s`;
  return `${sign}${(a / (1e9 * _YR)).toFixed(2)} Gyr/s`;
}

// Preset speed stops. The slider snaps to these when chips are clicked.
export const SPEED_PRESETS = [
  { label: 'Quantum',  exp: -15, hint: 'fs/s — telegrapher ripples visible' },
  { label: 'Light',    exp: -2,  hint: 'see photons cross a system' },
  { label: 'Real',     exp: 0,   hint: '1× wall time' },
  { label: 'Day/s',    exp: 4.94, hint: 'Earth spins in a second' },
  { label: 'Year/s',   exp: 7.5,  hint: 'planetary orbit per second' },
  { label: 'Myr/s',    exp: 13.5, hint: 'galaxy rotates per second' },
  { label: 'Gyr/s',    exp: 16.5, hint: 'universe evolves visibly' },
];
