// Top-level orchestrator: renderer, composer, regime manager, time clock, UI, drag, save.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Composer } from './render/Composer';
import { RegimeManager } from './regimes/RegimeManager';
import { Clock } from './core/Clock';
import { z as cosmoZ, epoch as cosmoEpoch, edePulse } from './core/Cosmology';
import { decodeZoom } from './core/Camera';
import { bindUI, setHud, syncControls, updateAnchorPanel } from './ui/ui';
import { bindClosurePanel } from './ui/Closure';
import { updateHoverCard, pinHoverCard, unpinHoverCard } from './ui/HoverCard';
import { SaveData, autosave, emptySave, loadLocal } from './core/Store';
import { DragController } from './core/Drag';
import { formatRate } from './util/units';
import type { RegimeKey } from './core/Camera';
import { AnchorManager } from './anchors/AnchorManager';

// Camera-distance range per regime — wheel zooms within this range, then
// the slider crosses a band boundary and the next regime mounts with the
// camera starting at its maxDistance. So scrolling carries you seamlessly
// through cosmic → galaxy → system → substrate.
const REGIME_LIMITS: Record<RegimeKey, { min: number; max: number }> = {
  COSMIC:    { min: 12,  max: 200 },
  GALAXY:    { min: 5,   max: 80  },
  SYSTEM:    { min: 35,  max: 550 },
  ATOMIC:    { min: 6,   max: 22  },
  SUBSTRATE: { min: 6,   max: 45  },
};

export class App {
  private renderer: THREE.WebGLRenderer;
  private composer: Composer;
  private regimes: RegimeManager;
  private clock = new Clock();
  private state: SaveData;
  private prevTime = 1; // ensure first frame with time≈0 fires the bang flash
  private controls!: OrbitControls;
  private drag!: DragController;
  private canvas!: HTMLCanvasElement;
  // Anchor scenes (paper-derived dynamics demos). When `current` is set
  // we render the anchor scene instead of the regime view.
  private anchors!: AnchorManager;

  constructor() {
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);
    // HDR tone mapping. Without this, the bright PointLight in SystemRegime
    // clips planet surface colors to white near the star and pitch-black
    // far away. ACESFilmic compresses the high end so we can crank the
    // light intensity without losing detail.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Bumped from 1.05 — galaxies and the cosmic web were reading too
    // dark. 1.25 lifts the midtones into a legible range while ACES
    // still compresses the highlights cleanly.
    this.renderer.toneMappingExposure = 1.25;
    this.resize();

    // Pristine state, then overlay any save
    const saved = loadLocal();
    this.state = saved ?? emptySave((Math.random() * 1e9) | 0);

    // Mirror state into clock
    this.clock.scrub     = this.state.scrub;
    this.clock.speedExp  = this.state.speedExp;
    this.clock.direction = this.state.direction;
    this.clock.playing   = this.state.playing;
    this.clock.useLogPace = this.state.logPace ?? false;

    // Dummy scene/camera for composer init
    const dummyScene = new THREE.Scene();
    const dummyCam = new THREE.PerspectiveCamera();
    this.composer = new Composer(this.renderer, dummyScene, dummyCam);

    this.regimes = new RegimeManager(this.renderer, this.composer, this.state.seed);
    this.anchors = new AnchorManager(window.innerWidth / window.innerHeight);

    // DragController is registered FIRST so its pointerdown handler runs
    // before OrbitControls' — when it grabs an object it stopImmediatePropagation
    // and OrbitControls never sees the event. Free-space drags fall through
    // to OrbitControls naturally.
    this.drag = new DragController(
      canvas,
      () => this.regimes.current.scene,
      () => this.regimes.current.camera,
      () => this.regimes.current.draggable,
      (i) => this.regimes.pick(i),
      (i) => this.regimes.hoverInfo(i)
    );
    this.drag.onHover = (info, x, y) => updateHoverCard(info, x, y);
    // Click a draggable → pin its hover card AND pin its focus so the
    // next zoom-in commits on the thing you clicked, not whatever the
    // camera ray happens to point at. Background click clears both.
    this.drag.onClickTarget = (info, target, x, y) => {
      pinHoverCard(info, x, y);
      this.applyClickFocus(target.id);
    };
    this.drag.onClickBackground = () => {
      unpinHoverCard();
      this.regimes.unpinAll();
    };
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        unpinHoverCard();
        this.regimes.unpinAll();
      }
    });

    // Install OrbitControls on the initial regime and re-install on every
    // regime swap so the controls track whichever camera is active.
    this.installControls();
    this.regimes.onRegimeChange = () => this.installControls();

    this.regimes.setZoom(this.state.zoom);

    bindClosurePanel();

    bindUI({
      state: this.state,
      onChange: () => {
        this.clock.scrub      = this.state.scrub;
        this.clock.speedExp   = this.state.speedExp;
        this.clock.direction  = this.state.direction;
        this.clock.playing    = this.state.playing;
        this.clock.useLogPace = this.state.logPace ?? false;
        this.regimes.setZoom(this.state.zoom);
        autosave(this.state);
      },
      onLoad: (data) => {
        this.state = data;
        this.clock.scrub      = data.scrub;
        this.clock.speedExp   = data.speedExp;
        this.clock.direction  = data.direction;
        this.clock.playing    = data.playing;
        this.clock.useLogPace = data.logPace ?? false;
        this.regimes.setSeed(data.seed);          // also resets focus
        this.regimes.setZoom(data.zoom);
        syncControls(data);
        autosave(this.state);
      },
      onNewSeed: () => {
        const newSeed = (Math.random() * 1e9) | 0;
        this.state.seed  = newSeed;
        this.state.scrub = 0;
        this.state.zoom  = 0.07;
        this.state.logPace = false;
        this.regimes.setSeed(newSeed);            // also resets focus
        this.regimes.setZoom(this.state.zoom);
        this.clock.scrub = 0;
        this.clock.useLogPace = false;
        syncControls(this.state);
        this.composer.flash(1.0);
        this.prevTime = 1; // ensure bang flash next frame
        autosave(this.state);
      },
      // Anchor (dynamics-demo) wiring. Selecting a scene from the
      // dropdown swaps the rendered scene for an isolated paper-derived
      // demo; the regime view stays alive in the background but isn't
      // drawn. Selecting "Live universe" returns to the regime flow.
      anchors: {
        list: this.anchors.list().map(e => ({
          id: e.meta.id,
          title: e.meta.title,
          tier: e.meta.tier
        })),
        onSelect: (id) => {
          this.anchors.setActive(id);
          if (id === null || !this.anchors.current) {
            updateAnchorPanel(null);
            // Returning to live: re-bind OrbitControls to the regime camera.
            this.installControls();
          } else {
            const m = this.anchors.current.meta;
            updateAnchorPanel({ title: m.title, paperRef: m.paperRef, blurb: m.blurb });
            // Anchor active: bind OrbitControls to the anchor's camera so
            // the user can orbit / zoom-with-wheel the demo.
            this.installControlsForAnchor(this.anchors.current.camera);
          }
        },
        onRestart: () => this.anchors.restart()
      }
    });

    window.addEventListener('resize', () => this.resize());
    // Wheel anywhere on the canvas → unified zoom slider. OrbitControls'
    // own wheel-zoom is disabled in installControls so they don't fight.
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    // Substrate info panel + packet emitter button
    const emitBtn = document.getElementById('btn-emit-packet');
    if (emitBtn) emitBtn.addEventListener('click', () => {
      const cur = this.regimes.current as unknown as { emitTelegrapherPacket?: () => void };
      cur.emitTelegrapherPacket?.();
    });

    this.loop();
  }

  // Convert a clicked draggable's id into a focus pin on the right
  // field for the current regime. Galaxies pin the cosmic-web focus;
  // stars pin the galactic focus. BH clicks don't pin starId (BHs
  // aren't stars; the hover card pin is still useful but drill-in
  // needs a real star). Defects and unrecognised ids fall through.
  private applyClickFocus(id: string) {
    if (id.startsWith('gx-')) {
      this.regimes.pinFocus('galaxyId', id);
    } else if (id.startsWith('st-')) {
      this.regimes.pinFocus('starId', id);
    }
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.resize();
    if (this.regimes)  this.regimes.resize(w, h);
    if (this.anchors)  this.anchors.resize(w, h);
  }

  // OrbitControls per regime — handles left-drag orbit + right-drag pan.
  // Wheel zoom is OFF; instead the wheel adjusts the unified zoom slider
  // (see onWheel below) so scrolling carries you through regimes
  // continuously. Camera distance is derived from the slider each frame
  // in `applySliderDistance`.
  private installControls() {
    // Preserve view direction across regime swaps so the camera glides
    // into the next regime pointed at the same focused thing.
    const oldDir = this.controls
      ? this.controls.object.position.clone().sub(this.controls.target).normalize()
      : null;
    if (this.controls) this.controls.dispose();
    this.controls = new OrbitControls(this.regimes.current.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enableZoom = false;          // we own the wheel
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.5;
    this.controls.panSpeed = 0.8;
    this.controls.target.set(0, 0, 0);
    if (oldDir) {
      const lim = REGIME_LIMITS[this.regimes.currentKey];
      const startDist = lim.max * 0.95;
      this.regimes.current.camera.position.copy(oldDir.multiplyScalar(startDist));
      this.regimes.current.camera.lookAt(this.controls.target);
    }
    this.controls.update();
    if (this.drag) this.drag.attachControls(this.controls);
  }

  // Attach OrbitControls to an anchor's camera so the user can orbit it.
  // Anchors get free rotation + pan; we leave wheel-zoom disabled so the
  // unified zoom slider's semantics aren't broken when the user returns
  // to live universe. Re-uses the same OrbitControls instance pattern as
  // installControls() for regime cameras.
  private installControlsForAnchor(cam: THREE.PerspectiveCamera) {
    if (this.controls) this.controls.dispose();
    this.controls = new OrbitControls(cam, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enableZoom = true;   // anchors don't use the unified zoom slider, so wheel-zoom is fine here
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.5;
    this.controls.panSpeed = 0.8;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    if (this.drag) this.drag.attachControls(this.controls);
  }

  // Each frame: pin the camera at the radial distance the zoom slider
  // implies, preserving the orbit direction. Also lerp the controls
  // target toward the focused thing (the clicked galaxy/star) so the
  // camera flies INTO it as the user zooms — instead of pulling toward
  // world-origin while a perfectly-good focused target sits off-centre.
  private applySliderDistance() {
    const slice = decodeZoom(this.state.zoom);
    const lim = REGIME_LIMITS[slice.regime];

    // Lerp controls.target toward the focused thing ONLY when the user
    // has explicitly clicked-pinned something. Without a pin, the camera
    // free-orbits world origin like before. With a pin, the camera flies
    // smoothly into the clicked galaxy/star as the user scrolls in.
    const focusPos = this.regimes.hasPin()
      ? this.regimes.current.focusedWorldPos(this.regimes.focus)
      : null;
    const want = focusPos ?? this._originVec;
    // Stronger lerp at higher intra so the target snaps to the focused
    // object as we approach the next regime.
    const lerpRate = 0.04 + 0.16 * slice.intra;
    this.controls.target.lerp(want, Math.min(1, lerpRate));

    const dist = lim.max - (lim.max - lim.min) * slice.intra;
    const cam = this.regimes.current.camera;
    const dir = cam.position.clone().sub(this.controls.target);
    const curLen = dir.length();
    if (curLen < 1e-6) return;
    dir.multiplyScalar(dist / curLen);
    cam.position.copy(this.controls.target).add(dir);
  }
  private _originVec = new THREE.Vector3();

  // Wheel input is intercepted by the canvas listener (see constructor)
  // and routed into the unified zoom slider. deltaY < 0 (scroll up) = zoom
  // in. The slider's onChange handler in bindUI updates regime + camera
  // distance via the normal pipeline.
  private onWheel = (ev: WheelEvent) => {
    // In anchor mode the OrbitControls wheel-zoom is enabled; let the
    // wheel event pass through to OrbitControls untouched.
    if (this.anchors.current) return;
    ev.preventDefault();
    // Per-pixel wheel deltas vary by device. Tuned so a single mouse-wheel
    // notch (deltaY ≈ 100) moves the slider by ~0.02, meaning ~12 notches
    // to cross one regime band. Feels comparable to slider drag speed.
    const SENS = 0.00018;
    let z = this.state.zoom - ev.deltaY * SENS;
    z = Math.max(0, Math.min(0.9995, z));
    if (z === this.state.zoom) return;
    this.state.zoom = z;
    const sl = document.getElementById('slider-zoom') as HTMLInputElement;
    if (sl) sl.value = String(z);
  };

  private loop = () => {
    requestAnimationFrame(this.loop);
    const { dtWall, dtSim } = this.clock.tick();

    // sync state from clock
    this.state.scrub     = this.clock.scrub;
    this.state.direction = this.clock.direction;
    this.state.playing   = this.clock.playing;
    this.state.logPace   = this.clock.useLogPace;
    // Push the play head back into the slider every frame so the
    // user can SEE time advancing across the epoch ticks. Without
    // this, the only feedback playback gives is the HUD readout
    // updating — the slider thumb stays put and the time slider
    // looks dead.
    const sliderTimeEl = document.getElementById('slider-time') as HTMLInputElement | null;
    if (sliderTimeEl) sliderTimeEl.value = String(this.state.scrub);
    // Dim the time slider when paused so the user has a visible cue
    // that scrubbing now only ticks visuals (no physics advance).
    const timeLabel = document.querySelector('.time-slider') as HTMLLabelElement | null;
    if (timeLabel) timeLabel.classList.toggle('paused', !this.clock.playing);

    const tGyr = this.clock.time;
    // Big-bang flash whenever we arrive at t≈0 from elsewhere
    if (this.prevTime > 1e-3 && tGyr < 1e-6) this.composer.flash(1.0);
    // Recombination beat (~380 kyr) — universe transparent. Fires when
    // crossing t = 3.8e-4 Gyr in the forward direction.
    const T_RECOMB = 3.8e-4;
    if (this.prevTime < T_RECOMB && tGyr >= T_RECOMB && this.clock.direction > 0) {
      this.composer.flash(0.45);
    }
    this.prevTime = tGyr;

    const ede  = edePulse(tGyr);
    const slice = decodeZoom(this.state.zoom);
    this.state.regime = slice.regime;

    // If an anchor scene is active, take the alternate render path —
    // we skip the regime flow entirely and just step + render the anchor.
    const anchor = this.anchors.current;
    if (anchor) {
      anchor.update({ playing: this.clock.playing, wallDt: dtWall, simDt: dtSim });
      // Keep OrbitControls' damping/rotation alive each frame.
      if (this.controls) this.controls.update();
      // Anchors that include BHs publish lens sources just like regimes.
      this.composer.setLensSources(anchor.camera, anchor.lensSources());
      this.composer.setScene(anchor.scene, anchor.camera);
      this.composer.render(dtWall);
    } else {
      // Live-universe path.

      // Continuously refresh focus from the current regime (so the next
      // regime transition has the right child), then apply zoom — which
      // commits focus + rebuilds if (regime, focus) changed.
      this.regimes.pumpFocus();
      this.regimes.setZoom(this.state.zoom);

      this.regimes.update({
        seed: this.state.seed,
        time: tGyr,
        zoomIntra: slice.intra,
        edePulse: ede,
        entanglementOn: this.state.toggles.entangle,
        diskOn: this.state.toggles.disk ?? true,
        diskDetailOn: this.state.toggles.diskDetail ?? true,
        manyPastsOn: (this.state.toggles.manyPasts ?? false) && this.clock.direction === -1 && this.clock.playing,
        dtWall,
        rate: this.clock.speed,
        focus: this.regimes.focus
      }, dtSim);

      if (this.controls) {
        this.controls.update();
        this.applySliderDistance();
      }
      // Feed BH lens sources into the post-process for the current camera.
      this.composer.setLensSources(this.regimes.current.camera, this.regimes.current.lensSources());
      this.regimes.render(dtWall);
    }

    // HUD
    const zR = cosmoZ(tGyr);
    const ep = cosmoEpoch(tGyr);
    const tLabel = tGyr < 1e-3   ? `t = ${(tGyr * 1e6).toFixed(2)} kyr`
                  : tGyr < 1     ? `t = ${(tGyr * 1000).toFixed(0)} Myr`
                  : tGyr < 13.8  ? `t = ${tGyr.toFixed(2)} Gyr`
                  : tGyr < 100   ? `t = ${tGyr.toFixed(2)} Gyr · future`
                                 : `t = ${tGyr.toExponential(2)} Gyr · far future`;
    const zLabel = isFinite(zR) ? (zR > 1000 ? `z ≈ ${zR.toExponential(2)}` : `z ≈ ${zR.toFixed(2)}`) : 'z ≈ ∞';
    setHud({
      time:  `${tLabel} · ${zLabel} · ${ep.label}`,
      zoom:  `${slice.regime} ▸ ${slice.intra.toFixed(2)}`,
      speed: this.clock.useLogPace
        ? `log-pace · ${this.clock.logPaceWallSec}s sweep`
        : formatRate(this.clock.speed),
      epoch: ep.label
    });

    // Substrate info panel — visible only at SUBSTRATE scale
    const spPanel = document.getElementById('substrate-panel');
    if (spPanel) {
      const atSub = slice.regime === 'SUBSTRATE';
      spPanel.classList.toggle('hidden', !atSub);
      if (atSub) {
        const cur = this.regimes.current as unknown as {
          totalCellCount?: () => number; saturatedCellCount?: () => number;
        };
        const total = cur.totalCellCount?.() ?? 0;
        const sat   = cur.saturatedCellCount?.() ?? 0;
        const c = document.getElementById('sp-cells');
        const s = document.getElementById('sp-saturated');
        if (c) c.textContent = total.toLocaleString();
        if (s) s.textContent = `${sat} / ${total.toLocaleString()}`;
      }
    }

    // Autosave only every ~1.5 sec wall time, not every frame. The
    // throttle inside autosave() collapsed bursts but still fired the
    // tiny setTimeout dance 60×/sec — cumulative GC noise.
    this._autosaveAccum += dtWall;
    if (this._autosaveAccum >= 1.5) {
      this._autosaveAccum = 0;
      autosave(this.state);
    }
  };
  private _autosaveAccum = 0;
}
