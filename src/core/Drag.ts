// Pointer-driven drag system. Raycasts against the current regime's `draggable` group.
// On hit, locks a drag plane perpendicular to the camera at that depth.
// pointermove → calls regime's onDragMove with world point on that plane.
// pointerup → releases with windowed velocity.

import * as THREE from 'three';
import type { DragTarget, HoverInfo } from '../regimes/Regime';

// Loose type for OrbitControls so we don't import three/addons here.
interface CameraControls { enabled: boolean; }

export class DragController {
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private active: DragTarget | null = null;
  private dragPlane = new THREE.Plane();
  private cursor = document.getElementById('cursor')!;
  private canvas: HTMLCanvasElement;
  private lastWorld = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private velSamples: { p: THREE.Vector3; t: number }[] = [];
  private controls: CameraControls | null = null;
  onHover: (info: HoverInfo | null, clientX: number, clientY: number) => void = () => {};

  // Called by App when the active OrbitControls instance changes (regime swap)
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
    // cursor follower
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
    if (hits.length === 0) return;
    const target = this.regimePick(hits[0]);
    if (!target) return;
    ev.preventDefault();
    // Stop OrbitControls from also handling this pointerdown
    ev.stopImmediatePropagation();
    if (this.controls) this.controls.enabled = false;
    this.active = target;
    // Build a plane through the picked object's world position, facing the camera
    const camDir = new THREE.Vector3();
    cam.getWorldDirection(camDir);
    this.dragPlane.setFromNormalAndCoplanarPoint(camDir.clone().negate(), target.worldPos);
    this.lastWorld.copy(target.worldPos);
    this.velSamples = [{ p: this.lastWorld.clone(), t: performance.now() / 1000 }];
    this.cursor.classList.add('dragging');
    this.canvas.classList.add('grabbing');
    try { (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId); } catch {}
  };

  private onMove = (ev: PointerEvent) => {
    this.setNdc(ev);
    if (this.active) {
      ev.preventDefault();
      const p = this.worldOnPlane();
      this.active.onDragMove(p);
      this.lastWorld.copy(p);
      this.velSamples.push({ p: p.clone(), t: performance.now() / 1000 });
      // keep ≤ 80 ms of history
      const cutoff = performance.now() / 1000 - 0.08;
      while (this.velSamples.length > 2 && this.velSamples[0].t < cutoff) this.velSamples.shift();
    } else {
      // hover detection — show cursor ring + hover card if over a draggable
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
    }
  };

  private onUp = (_ev: PointerEvent) => {
    if (!this.active) return;
    // Compute windowed velocity
    if (this.velSamples.length >= 2) {
      const a = this.velSamples[0];
      const b = this.velSamples[this.velSamples.length - 1];
      const dt = Math.max(1e-3, b.t - a.t);
      this.velocity.subVectors(b.p, a.p).multiplyScalar(1 / dt);
    } else {
      this.velocity.set(0, 0, 0);
    }
    this.active.onDragEnd(this.velocity);
    this.active = null;
    this.cursor.classList.remove('dragging');
    this.canvas.classList.remove('grabbing');
    if (this.controls) this.controls.enabled = true;
  };
}
