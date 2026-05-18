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
