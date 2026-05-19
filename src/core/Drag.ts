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

  private onDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    this.setNdc(ev);
    const cam = this.getCurrentCamera();
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
    const target = this.regimePick(hits[0]);
    if (!target) return;
    // ARM a pending pickup. Don't grab yet.
    this.pending = {
      target,
      hoverInfo: this.regimeHover(hits[0]),
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
    // Hover preview (no pending, no active)
    const cam = this.getCurrentCamera();
    this.raycaster.setFromCamera(this.pointerNdc, cam);
    const hits = this.raycaster.intersectObjects(this.getDraggables().children, true);
    const hit = hits[0];
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
      // Compute release velocity from windowed samples, then damp + cap.
      // Why both: any wiggle at the moment of release was being amplified
      // by 1/dt and shot the object out of frame. Damping × 0.35 makes
      // a gentle flick feel like a gentle flick. The magnitude cap is
      // proportional to camera distance so the same drag at COSMIC
      // doesn't go further off-screen than the same drag at GALAXY.
      if (this.velSamples.length >= 2) {
        const a = this.velSamples[0];
        const b = this.velSamples[this.velSamples.length - 1];
        const dt = Math.max(1e-3, b.t - a.t);
        this.velocity.subVectors(b.p, a.p).multiplyScalar(1 / dt);
      } else {
        this.velocity.set(0, 0, 0);
      }
      this.velocity.multiplyScalar(0.35);
      const camDist = this.getCurrentCamera().position.length();
      const maxV = Math.max(1, camDist * 0.6);
      if (this.velocity.length() > maxV) {
        this.velocity.setLength(maxV);
      }
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
