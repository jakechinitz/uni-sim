# Physics implementation audit

This is a code-facing audit of how the simulator maps onto the paper. It is not a claim that every frontier derivation in the paper has been numerically solved in the app.

## Strong matches

- **Weak-field/RAR law**: `src/core/Gravity.ts` implements the exponential RAR form `g_obs = g_bar / (1 - exp(-sqrt(g_bar/a0)))` used by cosmic, galaxy, and system regimes.
- **Closure chain**: `src/core/Closure.ts` and `src/util/units.ts` compute `g_share,eff`, `L*`, `G`, and `a0 = c H0 g_share,eff / (4 pi^2)` from the prior steps instead of fitting them in the UI.
- **No-slip lensing visualization**: `src/render/Composer.ts` ties lensing to the same black-hole mass/position sources as the gravity visualization and does not introduce a separate slip parameter.
- **Telegrapher substrate**: `src/core/SubstrateSim.ts` runs a first-order telegrapher-like q/Pi lattice and exposes saturated q cells in substrate mode.
- **Black-hole lapse visualization**: `src/render/BlackHole.ts` uses local q to dim photon rings and disks, matching the paper's `N^2 = q` visual story.
- **Trace-triggered cosmology visual**: `src/core/Cosmology.ts` keeps the trace-coupled mode dormant in radiation and turns it on near the matter transition, matching the qualitative claim in the paper.

## Improvements made in this branch

- Added a runtime quality selector so the same static web app can run on hosted pages and weaker hardware.
- Added a black-hole scale audit panel. Current on-screen black-hole disks are deliberately inflated relative to true Schwarzschild radii; the panel separates visual radius from physical labels.
- Clamped substrate `q` to `[0, 1]` at defect sources, wave packets, divergence updates, samples, and relaxation. This now matches the paper's bounded-q strong-field premise.
- Added dev-only physics self-checks for RAR asymptotes, closure range, trace activation, and substrate q bounds.
- Updated the black-hole formation anchor so the horizon is tied to a bounded q/free-boundary shell instead of only a raw collapse threshold.

## Still heuristic or incomplete

- **Dynamical collapse**: the app visualizes a bounded free-boundary shell, but it does not solve the paper's full nonlinear collapse PDE with `D(q)=D0 q(1-q)` and `Gamma(q)=Gamma0 q`.
- **Cosmology**: the app uses a piecewise scale factor plus trace pulse; it is not a Boltzmann-code cosmology or a closed fit to CMB/BAO/SN data.
- **Lensing**: lensing is a screen-space shader cue, not a null-geodesic ray tracer through q(r).
- **Substrate engine**: the live lattice is modest and pedagogical. It shows finite-speed q transport and saturation, but it is not a calibrated microscopic simulation.
- **Black-hole visual scale**: rendered radii are intentionally enormous so they are visible inside galaxy view. Hover-card physics values remain literal.

## Next best technical upgrades

- Move `SubstrateSim` stepping into a Web Worker.
- Add quality-dependent object counts at construction time for galaxy/cosmic regimes.
- Add deterministic unit tests for closure/RAR/q-bound checks instead of dev-console self-checks only.
- Replace screen-space lensing with an optional higher-quality ray-marched q(r) lens mode for black-hole anchors.
- Add a collapse anchor backed by the paper's bounded `D(q)`/`Gamma(q)` PDE, keeping the current dust-cloud anchor as a visual introduction.
