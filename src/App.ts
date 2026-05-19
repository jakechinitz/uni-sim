// Top-level orchestrator: renderer, composer, regime manager, time clock, UI, drag, save.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Composer } from './render/Composer';
import { RegimeManager } from './regimes/RegimeManager';
import { Clock } from './core/Clock';
import { z as cosmoZ, epoch as cosmoEpoch, edePulse } from './core/Cosmology';
import { decodeZoom } from './core/Camera';
import { bindUI, setHud, syncControls } from './ui/ui';
import { bindClosurePanel } from './ui/Closure';
import { updateHoverCard } from './ui/HoverCard';
import { SaveData, autosave, emptySave, loadLocal } from './core/Store';
import { DragController } from './core/Drag';
import { formatRate } from './util/units';

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

  constructor() {
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);
    this.resize();

    // Pristine state, then overlay any save
    const saved = loadLocal();
    this.state = saved ?? emptySave((Math.random() * 1e9) | 0);

    // Mirror state into clock
    this.clock.scrub     = this.state.scrub;
    this.clock.speedExp  = this.state.speedExp;
    this.clock.direction = this.state.direction;
    this.clock.playing   = this.state.playing;

    // Dummy scene/camera for composer init
    const dummyScene = new THREE.Scene();
    const dummyCam = new THREE.PerspectiveCamera();
    this.composer = new Composer(this.renderer, dummyScene, dummyCam);
    this.composer.enableBloom(this.state.toggles.bloom);

    this.regimes = new RegimeManager(this.renderer, this.composer, this.state.seed);

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

    // Install OrbitControls on the initial regime and re-install on every
    // regime swap so the controls track whichever camera is active.
    this.installControls();
    this.regimes.onRegimeChange = () => this.installControls();

    this.regimes.setZoom(this.state.zoom);

    bindClosurePanel();

    bindUI({
      state: this.state,
      onChange: () => {
        this.clock.scrub     = this.state.scrub;
        this.clock.speedExp  = this.state.speedExp;
        this.clock.direction = this.state.direction;
        this.clock.playing   = this.state.playing;
        this.regimes.setZoom(this.state.zoom);
        this.composer.enableBloom(this.state.toggles.bloom);
        autosave(this.state);
      },
      onLoad: (data) => {
        this.state = data;
        this.clock.scrub     = data.scrub;
        this.clock.speedExp  = data.speedExp;
        this.clock.direction = data.direction;
        this.clock.playing   = data.playing;
        this.regimes.setSeed(data.seed);          // also resets focus
        this.regimes.setZoom(data.zoom);
        this.composer.enableBloom(data.toggles.bloom);
        syncControls(data);
        autosave(this.state);
      },
      onNewSeed: () => {
        const newSeed = (Math.random() * 1e9) | 0;
        this.state.seed  = newSeed;
        this.state.scrub = 0;
        this.state.zoom  = 0.07;
        this.state.overrides = {};
        this.regimes.setSeed(newSeed);            // also resets focus
        this.regimes.setZoom(this.state.zoom);
        this.clock.scrub = 0;
        syncControls(this.state);
        this.composer.flash(1.0);
        this.prevTime = 1; // ensure bang flash next frame
        autosave(this.state);
      }
    });

    window.addEventListener('resize', () => this.resize());

    this.loop();
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.resize();
    if (this.regimes)  this.regimes.resize(w, h);
  }

  // OrbitControls swap when regime changes. Damped orbit, dolly with wheel,
  // right-click pan. Each regime has its own scale so distance limits adapt.
  private installControls() {
    if (this.controls) this.controls.dispose();
    this.controls = new OrbitControls(this.regimes.current.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 1.1;
    this.controls.panSpeed = 0.8;
    this.controls.target.set(0, 0, 0);
    // Per-regime dolly range so wheel-zoom feels right at each scale
    const limits: Record<string, { min: number; max: number }> = {
      COSMIC:    { min: 8,  max: 220 },
      GALAXY:    { min: 1,  max: 90  },
      SYSTEM:    { min: 10, max: 700 },
      SUBSTRATE: { min: 4,  max: 60  },
    };
    const lim = limits[this.regimes.currentKey] ?? { min: 1, max: 1000 };
    this.controls.minDistance = lim.min;
    this.controls.maxDistance = lim.max;
    if (this.drag) this.drag.attachControls(this.controls);
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const { dtWall, dtSim } = this.clock.tick();

    // sync state from clock
    this.state.scrub     = this.clock.scrub;
    this.state.direction = this.clock.direction;
    this.state.playing   = this.clock.playing;

    const tGyr = this.clock.time;
    // Big-bang flash whenever we arrive at t≈0 from elsewhere
    if (this.prevTime > 1e-3 && tGyr < 1e-6) this.composer.flash(1.0);
    this.prevTime = tGyr;

    const ede  = edePulse(tGyr);
    const slice = decodeZoom(this.state.zoom);
    this.state.regime = slice.regime;

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
      dtWall,
      rate: this.clock.speed,
      focus: this.regimes.focus
    }, dtSim);

    if (this.controls) this.controls.update();
    this.regimes.render(dtWall);

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
      speed: formatRate(this.clock.speed),
      epoch: ep.label
    });

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
