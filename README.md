# uni-sim

A cinematic, in-browser universe simulator built on top of the *Entropic Scalar
EFT* paper. The vacuum is a finite-capacity entanglement substrate; matter is
its depletion; gravity is its long-wavelength relaxation; black holes are its
saturation. The simulator starts at the Big Bang and runs forward, with one
zoom slider that walks from the cosmic web all the way down to the tetrahedral
substrate.

## Run

```
npm install
npm run dev
# open http://localhost:5173
```

For a production build:

```
npm run build
npm run preview
```

## What you're looking at

Three controls drive everything.

- **time** — scrubs from t = 0 to ~13.8 Gyr. Non-linear so the early universe
  gets ~half the slider. Speed slider sets autoplay rate; play/pause/reverse buttons too.
- **zoom** — single log-scale slider across six regimes:

  | Regime    | What you see |
  |-----------|--------------|
  | COSMIC    | ~100 galaxies, cosmic web, EDE pulse near z ≈ 3000 |
  | GALAXY    | spiral disk + central black hole (accretion disk + photon ring) |
  | SYSTEM    | star + 7 planets, Kepler orbits with trails |
  | PLANET    | textured world with atmosphere rim |
  | ATOMIC    | schematic atoms with electron-cloud shells |
  | SUBSTRATE | tetrahedral lattice of cells, draggable defects, live q-capacity field |

- **entanglement toggle** — overlays the gravitational halo / field-lines at
  each scale. At SUBSTRATE, edges recolor according to the local capacity `q`
  (deep red ⇒ q → 0 ⇒ a mini black hole).

## Drag

Click and drag any object to perturb the dynamics live:

- Cosmic web — grab a galaxy and fling it; neighbours respond via the **RAR**
  (radial-acceleration relation) at the paper's `a₀ ≈ 1.2×10⁻¹⁰ m/s²`.
  This is the deep-MOND tail — much longer reach than Newton.
- Galaxy — drag the central black hole; the disk, photon ring, halo and
  entanglement field follow.
- System — drag the star or any planet; orbits re-form (RAR collapses to
  Newton at AU scale).
- Substrate — drag a defect; the `q`-field recomputes live; pile two defects
  together and you get a local `q → 0` saturation, i.e. a tiny black hole.

## Save / Load

- **save** — downloads a JSON of `{ seed, time, zoom, camera, toggles,
  overrides }`. Reload the same file later to restore the exact view.
- **new** — picks a new seed and a fresh Big Bang.
- Auto-saves to `localStorage` on every change.

## Physics provenance

The gravity model is paper-faithful in its observable form. We use the
**Radial-Acceleration Relation** (simple-µ family,
`ν(y) = ½ + √(¼ + 1/y)`, `y = g_bar / a₀`) for the COSMIC, GALAXY, and
SYSTEM regimes — recovers Newton when `g_bar ≫ a₀` and `√(a₀ g_bar)` when
`g_bar ≪ a₀`. The SUBSTRATE regime uses the paper's primitive picture: each
defect drains capacity as `r_s / r`, the test-defect acceleration is
`−∇q · c²/2`, and `q → 0` is the black-hole interior. The cosmology and
black-hole rendering are stylized — visible Big Bang flash, radiation field,
the Hubble-tension EDE pulse near z ≈ 3000 — not full Friedmann.

## File tree

```
src/
  App.ts                  top-level
  main.ts                 entry
  core/
    Camera.ts             zoom → regime
    Clock.ts              time scrub
    Cosmology.ts          a(t), z(t), EDE pulse, epoch labels
    Drag.ts               pointer raycast + drag plane
    Gravity.ts            RAR + q-field (paper-faithful)
    Rng.ts                deterministic seeds
    Store.ts              save/load JSON
    Events.ts             pub/sub
  regimes/
    Regime.ts             interface
    RegimeManager.ts      switches scenes on zoom change
    CosmicRegime.ts
    GalaxyRegime.ts
    SystemRegime.ts
    PlanetRegime.ts
    AtomicRegime.ts
    SubstrateRegime.ts
  render/
    Composer.ts           bloom + flash + FXAA
    BlackHole.ts          accretion disk + photon ring
    Glow.ts               radial-gradient sprite cache
  ui/
    ui.ts                 HTML control bindings
    ui.css                glassmorphic dark HUD
  util/
    units.ts              physical constants + paper invariants
    lerp.ts, hash.ts
```
