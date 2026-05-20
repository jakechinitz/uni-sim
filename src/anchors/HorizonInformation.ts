// Anchor: Horizon Information Scrambling + Hawking Leakage.
//
// Paper context: §20 + §B (ln 2 per face, S_BH = A/4 from substrate
// counting). Hayden–Preskill / Sekino–Susskind fast scrambling, with
// the Vikram–Shou–Galitski lower bound on t_scr that the main sim
// already surfaces in BH hover cards.
//
// What the user sees (a 30-second loop):
//   1. A small structured "payload" — a colour-coded asterism of points
//      arranged into a recognisable shape — drifts in from offscreen
//      toward the central BH.
//   2. As it approaches the photon ring, the asterism is visibly
//      stretched + sheared by the strong gradient (no GR ray-tracing;
//      just a per-point distortion as a function of distance to BH).
//   3. Once each payload point crosses the horizon, it's "ingested"
//      and its colour is added to a pool of face-channel encodings
//      drawn around the horizon as a faint pulsing ring of dots.
//   4. After all points are absorbed, slow Hawking-like emission
//      begins: random faint sprites leak outward, each carrying a
//      colour drawn from the ingested pool but in shuffled order.
//      Their emission is exponentially distributed so it looks thermal,
//      not deterministic. Over time the pool gets drained back to zero.
//
// This is a cartoon of the paper's stance on BH information: structure
// goes in, scrambles into horizon channels, and slowly leaks back out
// in a thermal-looking but information-preserving way.

import * as THREE from 'three';
import { Anchor, AnchorContext } from './Anchor';
import { BlackHole } from '../render/BlackHole';
import { radialGlow } from '../render/Glow';

const BH_RADIUS    = 0.55;
const PAYLOAD_N    = 14;
const PAYLOAD_R    = 14;        // starting distance from BH centre
const FALL_DUR     = 6;         // wall-seconds for payload to reach horizon
const EMIT_RATE    = 0.7;       // Hawking emissions per wall-second (mean)

interface PayloadPoint {
  sprite: THREE.Sprite;
  startPos: THREE.Vector3;
  colour: THREE.Color;
  ingested: boolean;
  ingestT: number;          // wall-time when this point was absorbed
}

interface HawkingPhoton {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  birthT: number;
  colour: THREE.Color;
}

export class HorizonInformationAnchor extends Anchor {
  private bh: BlackHole;
  private payload: PayloadPoint[] = [];
  private pool: THREE.Color[] = [];          // ingested colours, queued for emission
  private hawking: HawkingPhoton[] = [];
  private channelRing!: THREE.Points;        // visible "horizon channels" decoration
  private channelOffsets: Float32Array;
  private wallTime = 0;
  private nextEmitAt = 999;
  private payloadStart = 1.0;                // wall-seconds before the asterism appears

  constructor(aspect: number) {
    super({
      id: 'horizon-information',
      title: 'Horizon information · scramble + leak',
      paperRef: '§20, App. B',
      blurb:
        'A structured payload falls into a BH. It gets stretched at the ' +
        'photon ring, ingested into horizon channels (ln 2 per face), then ' +
        'slowly leaks back out as Hawking emission in shuffled order. ' +
        "Cartoon of the paper's information-preserving thermal-looking " +
        'leakage; not a literal scrambling calculation.',
      tier: 2
    }, aspect);

    this.camera.position.set(0, 4, 16);
    this.camera.lookAt(0, 0, 0);

    this.bh = new BlackHole({
      radius: BH_RADIUS,
      diskInner: 2.6, diskOuter: 6.5,
      diskTilt: 0.45,
      hot: new THREE.Color('#fff4d8'),
      mid: new THREE.Color('#ffaa55'),
      cool: new THREE.Color('#7ad7ff')
    });
    this.scene.add(this.bh);

    // Pre-allocate the "horizon channel" decoration — 7 dots in a slow
    // rotating ring just outside the photon ring. They light up as the
    // pool fills with ingested colours, fade as Hawking emission drains.
    const N_CH = 7;
    const chPositions = new Float32Array(N_CH * 3);
    this.channelOffsets = new Float32Array(N_CH);
    for (let i = 0; i < N_CH; i++) {
      const a = (i / N_CH) * Math.PI * 2;
      const r = BH_RADIUS * 4.5;
      chPositions[i*3+0] = r * Math.cos(a);
      chPositions[i*3+1] = 0;
      chPositions[i*3+2] = r * Math.sin(a);
      this.channelOffsets[i] = a;
    }
    const chG = new THREE.BufferGeometry();
    chG.setAttribute('position', new THREE.BufferAttribute(chPositions, 3));
    const chM = new THREE.PointsMaterial({
      size: 0.45, sizeAttenuation: true, transparent: true,
      color: 0xffd9a8, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false,
      map: radialGlow(64, '#ffffff', '#ffd9a8', 'rgba(0,0,0,0)')
    });
    this.channelRing = new THREE.Points(chG, chM);
    this.scene.add(this.channelRing);

    this.buildPayload();
    this.buildStarBackdrop();
  }

  private buildPayload() {
    // Asterism: small ring of points each with a distinct hue, so the
    // viewer can tell the "structure" apart from random Hawking emission.
    const tex = radialGlow(96, '#ffffff', '#aaccff', 'rgba(120,160,255,0)');
    for (let i = 0; i < PAYLOAD_N; i++) {
      const a = (i / PAYLOAD_N) * Math.PI * 2;
      const localR = 1.2 + 0.4 * Math.sin(a * 3);
      const sx = localR * Math.cos(a);
      const sy = 0.0 + 0.3 * Math.sin(a * 2);
      const sz = localR * Math.sin(a);
      const startPos = new THREE.Vector3(PAYLOAD_R + sx, sy, sz);
      const colour = new THREE.Color().setHSL(i / PAYLOAD_N, 0.85, 0.62);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: colour,
        blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true,
        opacity: 0
      }));
      sp.position.copy(startPos);
      sp.scale.setScalar(0.5);
      this.scene.add(sp);
      this.payload.push({ sprite: sp, startPos, colour, ingested: false, ingestT: 0 });
    }
  }

  private buildStarBackdrop() {
    const N = 250;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = 40 + Math.random() * 30;
      positions[i*3+0] = R * s * Math.cos(t);
      positions[i*3+1] = R * u;
      positions[i*3+2] = R * s * Math.sin(t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({
      size: 0.22, sizeAttenuation: true,
      color: 0xddddff, transparent: true, opacity: 0.45,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.scene.add(new THREE.Points(g, m));
  }

  // --- lifecycle ---------------------------------------------------------

  restart() {
    this.wallTime = 0;
    this.nextEmitAt = 999;
    this.pool.length = 0;
    // Clear Hawking pool
    for (const h of this.hawking) {
      this.scene.remove(h.sprite);
      (h.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.hawking.length = 0;
    // Reset payload
    for (const p of this.payload) {
      p.ingested = false;
      p.ingestT = 0;
      p.sprite.position.copy(p.startPos);
      const m = p.sprite.material as THREE.SpriteMaterial;
      m.opacity = 0;
      m.color.copy(p.colour);
      p.sprite.scale.setScalar(0.5);
    }
    (this.channelRing.material as THREE.PointsMaterial).opacity = 0;
  }

  // --- per-frame ---------------------------------------------------------

  update(ctx: AnchorContext): void {
    if (!ctx.playing) return;
    this.wallTime += ctx.wallDt;
    this.bh.tick(this.wallTime);
    this.bh.syncQField(this.bh.position, this.camera.position);

    // -------- payload infall ----------
    let allIngested = true;
    if (this.wallTime > this.payloadStart) {
      const t = Math.min(1, (this.wallTime - this.payloadStart) / FALL_DUR);
      for (const p of this.payload) {
        if (p.ingested) continue;
        allIngested = false;
        const sp = p.sprite;
        (sp.material as THREE.SpriteMaterial).opacity = Math.min(1, (this.wallTime - this.payloadStart) * 2);
        // Lerp from start toward (just past the horizon). Path is direct,
        // not a spiral — keeps the demo readable.
        sp.position.lerpVectors(p.startPos, this.bh.position, t);
        // Stretching: scale point along the radial direction as it nears BH.
        const d = sp.position.distanceTo(this.bh.position);
        const stretch = Math.max(0.3, Math.min(1.5, 1.0 + (BH_RADIUS * 6 - d) * 0.15));
        sp.scale.setScalar(0.5 * stretch);
        // Once within the horizon shell, ingest it
        if (d < BH_RADIUS * 1.5) {
          p.ingested = true;
          p.ingestT = this.wallTime;
          (sp.material as THREE.SpriteMaterial).opacity = 0;
          this.pool.push(p.colour.clone());
        }
      }
    } else {
      allIngested = false;
    }

    // -------- horizon channel ring ----------
    // Brightness tracks how much "stuff" the pool holds. Pulse rotation
    // gives the visual a sense of activity. Once Hawking has drained the
    // pool back to zero, the ring fades.
    const chMat = this.channelRing.material as THREE.PointsMaterial;
    const target = Math.min(1, this.pool.length / Math.max(1, PAYLOAD_N) * 0.9);
    chMat.opacity += (target - chMat.opacity) * Math.min(1, ctx.wallDt * 4);
    // Slow rotation of the ring
    const chPos = this.channelRing.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.channelOffsets.length; i++) {
      const a = this.channelOffsets[i] + this.wallTime * 0.4;
      const r = BH_RADIUS * 4.5;
      chPos.setX(i, r * Math.cos(a));
      chPos.setZ(i, r * Math.sin(a));
    }
    chPos.needsUpdate = true;

    // -------- Hawking emission ----------
    // Once the pool has anything in it, start emitting on a Poisson-ish
    // schedule. The wait time between emissions is exponentially
    // distributed, which is the right shape for a thermal-looking process.
    if (allIngested && this.nextEmitAt > 100) {
      // First time we hit "all ingested" — set the first emission time
      this.nextEmitAt = this.wallTime + (-Math.log(Math.random()) / EMIT_RATE);
    }
    if (this.pool.length > 0 && this.wallTime >= this.nextEmitAt) {
      // Pull a random colour from the pool (shuffled, not FIFO)
      const idx = Math.floor(Math.random() * this.pool.length);
      const colour = this.pool[idx];
      this.pool.splice(idx, 1);
      this.emitHawking(colour);
      this.nextEmitAt = this.wallTime + (-Math.log(Math.random()) / EMIT_RATE);
    }

    // -------- Hawking particle motion + decay ----------
    for (let i = this.hawking.length - 1; i >= 0; i--) {
      const h = this.hawking[i];
      const age = this.wallTime - h.birthT;
      // Constant outward velocity; fade as they fly off
      h.sprite.position.addScaledVector(h.vel, ctx.wallDt);
      const fade = Math.max(0, 1 - age / 5);
      (h.sprite.material as THREE.SpriteMaterial).opacity = fade;
      if (age > 5) {
        this.scene.remove(h.sprite);
        (h.sprite.material as THREE.SpriteMaterial).dispose();
        this.hawking.splice(i, 1);
      }
    }
  }

  private emitHawking(colour: THREE.Color) {
    // Pick a random outward direction. Slightly biased toward the
    // equatorial plane so emission looks loosely disk-like; pure-isotropic
    // would also be fine and arguably more correct.
    const u = Math.random() * 0.8 - 0.4;
    const t = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t)).normalize();
    const start = this.bh.position.clone().addScaledVector(dir, BH_RADIUS * 1.4);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlow(64, '#ffffff', '#ffd9a8', 'rgba(0,0,0,0)'),
      color: colour,
      blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.95
    }));
    sp.position.copy(start);
    sp.scale.setScalar(0.32);
    this.scene.add(sp);
    // Slow outward velocity — Hawking is "slow" relative to the infall
    this.hawking.push({
      sprite: sp,
      vel: dir.multiplyScalar(1.5),
      birthT: this.wallTime,
      colour
    });
  }

  lensSources(): { worldPos: THREE.Vector3; radius: number }[] {
    const dist = this.bh.position.distanceTo(this.camera.position) + 1e-3;
    const ndcR = Math.min(0.08, 0.05 / dist * 12);
    return [{ worldPos: this.bh.position, radius: ndcR }];
  }
}
