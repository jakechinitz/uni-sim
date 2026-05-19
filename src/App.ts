// Top-level orchestrator: renderer, composer, regime manager, time clock, UI, drag, save.

import * as THREE from 'three';
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

  constructor() {
    const canvas = document.getElementById('c') as HTMLCanvasElement;
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
    this.regimes.setZoom(this.state.zoom);

    const drag = new DragController(
      canvas,
      () => this.regimes.current.scene,
      () => this.regimes.current.camera,
      () => this.regimes.current.draggable,
      (i) => this.regimes.pick(i),
      (i) => this.regimes.hoverInfo(i)
    );
    drag.onHover = (info, x, y) => updateHoverCard(info, x, y);

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
      dtWall,
      rate: this.clock.speed,
      focus: this.regimes.focus
    }, dtSim);

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

    // Autosave on time change
    autosave(this.state);
  };
}
