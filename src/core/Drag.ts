// Pointer-driven drag system.
//
// Pickup gesture (deliberate, not twitchy):
//   1. pointerdown on a draggable arms a "pending pickup" but does NOT
//      start dragging. The hit object pulses a cyan ring (#cursor.pickup).
//   2. Pickup commits when EITHER:
//        - pointer moves more than DRAG_THRESHOLD_PX from the down point, OR
//        - the pointer is held for HOLD_PICKUP_MS without releasing
//   3. Release before commit = no-op. The user can click anywhere without
//      accidentally grabbing nearby objects.
// Free-space drags (no hit) and wheel events fall through to OrbitControls
// untouched. While a pending pickup is armed we temporarily disable
// OrbitControls so it doesn't orbit during the wait.

import * as THREE from 'three';
import type { DragTarget, HoverInfo } from '../regimes/Regime';

interface CameraControls { enabled: boolean; }

interface Pending {
  target: DragTarget;
  hoverInfo: HoverInfo | null;
  downX: number;
  downY: number;
  downT: number;
  pointerId: number;
}

const DRAG_THRESHOLD_PX = 6;       // pixels of movement to commit
const HOLD_PICKUP_MS    = 320;     // ms of hold to commit

export class DragController {
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private active: DragTarget | null = null;
  private pending: Pending | null = null;
  private pendingTimer: number | null = null;
  private bgClickStart: { x: number; y: number; t: number } | null = null;
  private dragPlane = new THREE.Plane();
  private cursor = document.getElementById('cursor')!;
  private canvas: HTMLCanvasElement;
  private lastWorld = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private velSamples: { p: THREE.Vector3; t: number }[] = [];
  private controls: CameraControls | null = null;
  // Throttle for the per-frame hover raycast — pointer events fire
  // much faster than render frames, and the points-cloud intersection
  // is linear in star count. 33 ms ≈ 30 Hz, plenty for hover feel.
  private lastHoverMs = 0;
  onHover: (info: HoverInfo | null, clientX: number, clientY: number) => void = () => {};
  // Fired when the user clicks a draggable without dragging — used by the
  // App to pin the hover card so they can see what zooming in would target.
  onClickTarget: (info: HoverInfo | null, target: DragTarget, x: number, y: number) => void = () => {};
  // Fired when the user clicks empty canvas (no target hit, no drag)
  onClickBackground: () => void = () => {};

  attachControls(c: CameraControls | null) { this.controls = c; }

  constructor(
    canvas: HTMLCanvasElement,
    _getCurrentScene: () => THREE.Scene,
    private getCurrentCamera: () => THREE.Camera,
    private getDraggables: () => THREE.Group,
    private regimePick: (i: THREE.Intersection) => DragTarget | null,
    private regimeHover: (i: THREE.Intersection) => HoverInfo | null = () => null
  ) {
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup',   this.onUp,   { passive: false });
    canvas.addEventListener('pointerleave', this.onUp);
  }

  private setNdc(ev: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.cursor.style.left = `${ev.clientX}px`;
    this.cursor.style.top  = `${ev.clientY}px`;
  }

  private worldOnPlane(): THREE.Vector3 {
    const cam = this.getCurrentCamera();
    this.raycaster.setFromCamera(this.pointerNdc, cam);
    const p = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, p);
    return p;
  }

  // Threshold for Points-cloud raycasts must scale with camera distance,
  // otherwise tiny attenuated stars are impossible to click when zoomed
  // out and trivially grabbable when zoomed in. ≈1.5% of camera distance
  // is roughly one screen-space pixel of slop.
  private setPointsThreshold(cam: THREE.Camera) {
    const camDist = cam.position.length();
    this.raycaster.params.Points = { threshold: Math.max(0.04, camDist * 0.015) };
  }

  // Prefer a solid mesh (black hole / planet / defect) over the ambient
  // star-points cloud. In a dense field the threshold-based points hit is often
  // marginally closer than a small BH mesh, which would otherwise steal clicks
  // meant for the buried object (e.g. the SMBH inside a self-gravity disk).
  private bestHit(hits: THREE.Intersection[]): THREE.Intersection {
    for (const h of hits) { if (!(h.object as any).isPoints) return h; }
    return hits[0];
  }

  private onDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    this.setNdc(ev);
    const cam = this.getCurrentCamera();
    this.setPointsThreshold(cam);
    this.raycaster.setFromCamera(this.pointerNdc, cam);
    const group = this.getDraggables();
    const hits = this.raycaster.intersectObjects(group.children, true);
    if (hits.length === 0) {
      // Free-space pointerdown: record a "background click in flight" so
      // we can detect a release-without-drag and dismiss any pinned card.
      this.bgClickStart = { x: ev.clientX, y: ev.clientY, t: performance.now() };
      return;
    }
    this.bgClickStart = null;
    const chosen = this.bestHit(hits);
    const target = this.regimePick(chosen);
    if (!target) return;
    // ARM a pending pickup. Don't grab yet.
    this.pending = {
      target,
      hoverInfo: this.regimeHover(chosen),
      downX: ev.clientX, downY: ev.clientY,
      downT: performance.now(),
      pointerId: ev.pointerId
    };
    if (this.controls) this.controls.enabled = false;   // disable orbit during the hold
    this.cursor.classList.add('pickup');
    // After HOLD_PICKUP_MS without release, commit even with no movement
    this.pendingTimer = window.setTimeout(() => {
      if (this.pending) this.commitPickup();
    }, HOLD_PICKUP_MS);
  };

  private commitPickup() {
    if (!this.pending) return;
    const target = this.pending.target;
    this.clearPending();
    this.active = target;
    const cam = this.getCurrentCamera();
    const camDir = new THREE.Vector3();
    cam.getWorldDirection(camDir);
    this.dragPlane.setFromNormalAndCoplanarPoint(camDir.clone().negate(), target.worldPos);
    this.lastWorld.copy(target.worldPos);
    this.velSamples = [{ p: this.lastWorld.clone(), t: performance.now() / 1000 }];
    this.cursor.classList.remove('pickup');
    this.cursor.classList.add('dragging');
    this.canvas.classList.add('grabbing');
  }

  private clearPending() {
    if (this.pendingTimer != null) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.pending = null;
    this.cursor.classList.remove('pickup');
  }

  private onMove = (ev: PointerEvent) => {
    this.setNdc(ev);
    if (this.active) {
      ev.preventDefault();
      const p = this.worldOnPlane();
      this.active.onDragMove(p);
      this.lastWorld.copy(p);
      this.velSamples.push({ p: p.clone(), t: performance.now() / 1000 });
      const cutoff = performance.now() / 1000 - 0.08;
      while (this.velSamples.length > 2 && this.velSamples[0].t < cutoff) this.velSamples.shift();
      return;
    }
    if (this.pending) {
      const dx = ev.clientX - this.pending.downX;
      const dy = ev.clientY - this.pending.downY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        this.commitPickup();
        ev.preventDefault();
      }
      return;
    }
    // Hover preview (no pending, no active). Throttled to ~30 Hz so the
    // points-cloud raycast (linear in N, dominates at 12,000-star
    // GalaxyRegime) doesn't fire on every pointer-move event.
    const nowMs = performance.now();
    if (nowMs - this.lastHoverMs < 33) return;
    this.lastHoverMs = nowMs;
    const cam = this.getCurrentCamera();
    this.setPointsThreshold(cam);
    this.raycaster.setFromCamera(this.pointerNdc, cam);
    const hits = this.raycaster.intersectObjects(this.getDraggables().children, true);
    const hit = this.bestHit(hits);
    const overDraggable = !!hit && !!this.regimePick(hit);
    this.cursor.classList.toggle('active', overDraggable);
    this.canvas.classList.toggle('grab', overDraggable);
    this.onHover(
      overDraggable ? this.regimeHover(hit) : null,
      ev.clientX, ev.clientY
    );
  };

  private onUp = (_ev: PointerEvent) => {
    if (this.active) {
      // Release with zero velocity — the object stays where the user
      // dropped it, then the surrounding dynamics (gravity, RAR pull,
      // substrate ∇q) take over from rest. Previously we passed a
      // damped flick velocity, which made every release feel like a
      // throw. Telegrapher ringdowns are still emitted by each regime's
      // onDragEnd so the moment of release is still visually marked.
      this.velocity.set(0, 0, 0);
      this.active.onDragEnd(this.velocity);
      this.active = null;
      this.cursor.classList.remove('dragging');
      this.canvas.classList.remove('grabbing');
      if (this.controls) this.controls.enabled = true;
      return;
    }
    if (this.pending) {
      // Released before commit → it's a click. Re-enable controls, then
      // fire the onClickTarget hook so the App can pin a preview card.
      const p = this.pending;
      this.clearPending();
      if (this.controls) this.controls.enabled = true;
      this.onClickTarget(p.hoverInfo, p.target, _ev.clientX, _ev.clientY);
      return;
    }
    // Background click — released without drag on empty canvas. Used to
    // dismiss any pinned preview card. We require ≤ 5 px of movement so
    // an orbit-drag never accidentally dismisses.
    if (this.bgClickStart) {
      const dx = _ev.clientX - this.bgClickStart.x;
      const dy = _ev.clientY - this.bgClickStart.y;
      const dt = performance.now() - this.bgClickStart.t;
      this.bgClickStart = null;
      if (dx * dx + dy * dy < 25 && dt < 400) {
        this.onClickBackground();
      }
    }
  };
}
