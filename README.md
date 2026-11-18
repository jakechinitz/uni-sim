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

- **time** — scrubs from t = 0 to today, 13.70 Gyr (the age the integrated
  background gives). Non-linear so the early universe
  gets ~half the slider. Speed slider sets autoplay rate; play/pause/reverse
  buttons too. The ↺ Big Bang button engages **log-pace** mode that walks the
  scrub linearly so each cosmic decade gets roughly equal wall-time — ideal
  for watching inflation → recombination → first stars → galaxies unfold.

- **zoom** — single log-scale slider across five regimes:

  | Regime    | What you see |
  |-----------|--------------|
  | COSMIC    | an emergent cosmic web of up to 131,072 galaxies, formed by an N-body run on the paper's expansion history |
  | GALAXY    | 24,000 self-gravitating stars under the paper's disk rule, central BH + stellar BHs, supernovae, mergers |
  | SYSTEM    | star + 3–9 planets on Newtonian orbits with trails, belt, comets, real photons |
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

- **Cosmic** — galaxies follow the precomputed structure-formation run, so
  they are click-to-select rather than draggable. Click one, then zoom in.
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

The **theory** button (top right) lists every quantity the simulator computes,
its equation, and its status in the paper's Lean formalization
([Entropic-EFT-Lean](https://github.com/jakechinitz/Entropic-EFT-Lean)):
proved, proved given a premise, premise, measured input, numerical method,
decorative, or open issue. In short:

- **Expansion history.** `a(t)` is the integrated Friedmann sum of the paper:
  baryons, radiation, committed stock at 5.333 per baryon that drains a share
  η* into the vacuum along the paper's frozen release history, and the small
  early pulse (f_EDE = 0.018 at z = 3400). The inputs are the baryon density,
  the radiation density and the release history. The outputs are h = 0.693,
  Ω_Λ = 0.710, an age of 13.70 Gyr and `a₀ = ε c H₀ = 1.27 × 10⁻¹⁰ m/s²`.
- **Cosmic web.** A particle-mesh N-body (64³ particles, FFT Poisson solver)
  of baryons plus stock as collisionless dust, from Zel'dovich initial
  conditions with a cold-matter transfer function. It runs in a Web Worker
  and streams keyframes that the GPU interpolates, so play, rewind and scrub
  show the same history. Linear growth matches theory to 3 %. The amplitude
  σ₈ and tilt n_s are observational inputs. The galactic response law is not
  applied at this scale: the paper's cosmological stock enters no response cell.
- **Galaxies.** Stars feel each other through a particle-mesh solve plus the
  paper's response `g_obs = g_bar/(1 − e^{−√(g_bar/a₀)})`, applied by the
  paper's disk rule: the response acts on the radial component of the
  baryonic field (a stiff, near-radial director), so the tangential pull of
  bars and arms stays Newtonian. `a₀(z) = ε c H(z)` follows the epoch.
- **Planetary systems** are Newtonian by the paper's carrier rule: a star
  inside a galaxy has no response halo of its own.
- **Black holes** use `N² = q`, `q = 1 − 2GM/c²r`, the Hawking temperature
  and the area entropy with `L_P = L*`. Their on-screen size is inflated;
  the numbers on the hover cards are real.
- The **SUBSTRATE regime** runs a 16³ telegrapher PDE
  `τ₀ ∂_t Π = −D ∇q − Π`, `∂_t q = −∇·Π`, with `D/τ₀ = c²`. The paper's own
  ledger refutes that this system keeps q in [0, 1] unaided, so the lattice
  clamps q with a limiter that has no invariant-domain proof.
- The **closure** panel renders the chain 1,680 microstates → η* →
  g_share,eff → L* → G*, including the marked-transfer vertex Z_e. G* lands
  −0.073 σ from CODATA (1.05 % low without the vertex). The paper records
  that the vertex was built after the residuals were known, so this is a
  postdiction.

In development builds a physics self-test runs at startup and logs
`[physics] self-checks passed` or the failing checks to the console.

## File tree

```
src/
  App.ts                       top-level orchestrator
  main.ts                      entry
  core/
    Camera.ts                  zoom → regime
    Clock.ts                   time scrub + log-pace mode
    Closure.ts                 paper §6–9 + §13 numeric chain (dressed L*, G*, lepton ratios)
    CosmicPM.ts                particle-mesh cosmological N-body (pure arithmetic)
    Cosmology.ts               integrated Friedmann background: a(t), H(a), a₀(z)
    LinearTheory.ts            transfer function, σ₈ normalisation, growth factor
    Drag.ts                    pointer-driven drag + zero-velocity release
    Gravity.ts                 paper exponential RAR + qField primitives
    Rng.ts                     deterministic seeds
    StellarLifecycle.ts        Salpeter IMF, t_MS, supernova channel
    Store.ts                   save/load JSON
    SubstrateSim.ts            real 16³ telegrapher PDE engine
  regimes/
    Regime.ts                  base interface (focus state, drag, hover)
    RegimeManager.ts           scene cache + pinned-focus committer
    CosmicRegime.ts            emergent cosmic web: GPU-interpolated N-body keyframes
    GalaxyRegime.ts            24,000-star self-gravitating disk, BH cluster, mergers
    SystemRegime.ts            star, 3–9 planets, photons, stellar lifecycle
    AtomicRegime.ts            schematic atoms + bonds
    SubstrateRegime.ts         tetra lattice, draggable defects, ∇q arrows
  render/
    BlackHole.ts               horizon + N²=q-modulated photon ring + disk
    Composer.ts                lens, bloom, flash, FXAA
    Glow.ts                    radial-gradient sprite cache
    ManyPasts.ts               §22 ghost-trajectory overlay
    Photons.ts                 pooled photon emitter
    Telegrapher.ts             expanding-wave shell overlay
  ui/
    ui.ts                      HTML control bindings + Big Bang
    ui.css                     glassmorphic dark HUD
    Closure.ts                 modal panel rendering the chain
    Theory.ts                  what is computed, and its status in the Lean ledger
    HoverCard.ts               pinned paper-physics tooltip
    Tooltip.ts                 free-floating tips
  workers/
    cosmicWeb.worker.ts        runs the cosmic N-body off the main thread
  util/
    units.ts                   constants + derived a₀
    fft.ts                     radix-2 FFTs (1-D, 2-D)
    half.ts                    half-float packing for keyframe textures
    lerp.ts, hash.ts
```
