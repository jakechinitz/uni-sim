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
  gets ~half the slider. Speed slider sets autoplay rate; play/pause/reverse
  buttons too. The ↺ Big Bang button engages **log-pace** mode that walks the
  scrub linearly so each cosmic decade gets roughly equal wall-time — ideal
  for watching inflation → recombination → first stars → galaxies unfold.

- **zoom** — single log-scale slider across six regimes:

  | Regime    | What you see |
  |-----------|--------------|
  | COSMIC    | ~220 galaxies, cosmic web, EDE pulse near z ≈ 3000 |
  | GALAXY    | spiral disk + central BH + 2–7 stellar BHs, supernovae, mergers |
  | SYSTEM    | star + 3–9 planets, Kepler orbits with trails, real photons |
  | PLANET    | shader-textured world with atmosphere rim |
  | ATOMIC    | schematic atoms with electron-cloud shells, bond network |
  | SUBSTRATE | tetrahedral lattice with live 16³ telegrapher PDE q-field, draggable defects |

- **entanglement toggle** — overlays the gravitational halo per body and
  field-lines at each scale. Each massive object carries its own halo, so
  dragging any of them moves its own entanglement signature. At SUBSTRATE,
  edges recolour by local capacity `q` (deep red ⇒ q → 0 ⇒ a mini black hole)
  and each defect grows an arrow showing the analytic ∇q force.

## Drilling in

Click any galaxy / star / planet to **pin focus** on it (a cyan reticle
appears). The next time you scroll the zoom wheel in, the simulator commits
that selection — so "drill into THIS galaxy / THIS star / THIS planet" is a
click followed by a scroll. Click empty canvas (or press Esc) to unpin.

If you just scroll without clicking, the camera-ray fallback picks whatever
is nearest the centre of your view.

## Drag

Click and drag any object to perturb the dynamics live. Releases drop the
object at its current position with zero velocity — the surrounding
dynamics (RAR pull, ∇q, Kepler) then start moving it again from rest.

- **Cosmic** — grab a galaxy; neighbours respond via the paper's
  exponential RAR (`g_obs = g_bar/(1−exp(−√(g_bar/a₀)))`) with
  `a₀ = g_share,eff · c·H₀ / (4π²)` derived in the Closure panel.
- **Galaxy** — drag the central or any stellar BH; close pairs merge and
  ringdown via a telegrapher front. Each BH's photon ring dims when
  another BH drains the local capacity around it (paper's N²=q lapse).
- **System** — drag the star or any planet; orbits re-form.
- **Substrate** — drag a defect; the live q-field PDE responds; the
  analytic ∇q arrow updates next to the defect.

## Save / Load

- **save** — downloads a JSON of the full state. Reload to restore.
- **new** — picks a new seed and a fresh Big Bang.
- Auto-saves to `localStorage` on every change.

## Physics provenance

- The **macroscopic acceleration law** is the paper's exponential RAR.
  Recovers Newton when `g_bar ≫ a₀`, deep-MOND `√(a₀·g_bar)` when
  `g_bar ≪ a₀`. Same form everywhere: COSMIC, GALAXY, SYSTEM.
- The **MOND scale** is computed from the closure chain
  `a₀ = g_share,eff/(4π²)·c·H₀`, not fit.
- The **SUBSTRATE regime** runs a real 16³ telegrapher PDE
  `τ₀ ∂_t Π = −D ∇q − Π`, `∂_t q = −∇·Π`, with `D/τ₀ = c²`. Signals
  travel at exactly the lattice speed of light. Defects drain capacity;
  paired defects can saturate to a mini-BH.
- **Strong-field lapse** N² = q is rendered as a photon-ring brightness
  modulator on every BH (visible when BHs cluster).
- **Cosmology** keeps its piecewise `a(t)` (radiation → matter → Λ), but
  the **EDE pulse** is now keyed on the trace χ = −T^μ_μ/c² of the
  matter stress-energy — dormant in radiation, switching on as matter
  takes over near z ≈ 3000, then diluting through the dark ages.
- The **Closure panel** (button at the top right) renders the live
  1,680 microstates → η* → g_share,eff → L* → G chain, with every
  number computed from the prior step. No fits.

## File tree

```
src/
  App.ts                       top-level orchestrator
  main.ts                      entry
  core/
    Camera.ts                  zoom → regime
    Clock.ts                   time scrub + log-pace mode
    Closure.ts                 paper §6–9 + §13 numeric chain
    Cosmology.ts               a(t), z(t), trace-χ-driven EDE pulse
    Drag.ts                    pointer-driven drag + zero-velocity release
    Gravity.ts                 paper exponential RAR + qField primitives
    Rng.ts                     deterministic seeds
    StellarLifecycle.ts        Salpeter IMF, t_MS, supernova channel
    Store.ts                   save/load JSON
    SubstrateSim.ts            real 16³ telegrapher PDE engine
  regimes/
    Regime.ts                  base interface (focus state, drag, hover)
    RegimeManager.ts           scene cache + pinned-focus committer
    CosmicRegime.ts            220 galaxies, filaments, big-bang flash
    GalaxyRegime.ts            spiral disk, 3,500 stars, BH cluster, mergers
    SystemRegime.ts            star, 3–9 planets, photons, stellar lifecycle
    PlanetRegime.ts            shader-textured world + atmosphere
    AtomicRegime.ts            schematic atoms + bonds
    SubstrateRegime.ts         tetra lattice, draggable defects, ∇q arrows
  render/
    BlackHole.ts               horizon + N²=q-modulated photon ring + disk
    Composer.ts                lens, bloom, flash, FXAA
    Glow.ts                    radial-gradient sprite cache
    ManyPasts.ts               §21 ghost-trajectory overlay
    Photons.ts                 pooled photon emitter
    Telegrapher.ts             expanding-wave shell overlay
  ui/
    ui.ts                      HTML control bindings + Big Bang
    ui.css                     glassmorphic dark HUD
    Closure.ts                 modal panel rendering the chain
    HoverCard.ts               pinned paper-physics tooltip
    Tooltip.ts                 free-floating tips
  util/
    units.ts                   constants + derived a₀
    lerp.ts, hash.ts
```
