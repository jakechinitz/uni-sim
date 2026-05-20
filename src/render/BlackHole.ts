// Black hole rendering — paper-faithful: every BH visual is driven from
// the substrate capacity field q(r) = max(0, 1 − r_s/r) (paper §15, §20).
// Three layers:
//   1. Horizon: opaque black sphere at r_s. This is the q=0 saturation
//      surface (paper §20: q=0 ⇒ horizon, the manifold ends here).
//   2. q-field shell: an additive sphere ~5 r_s wide whose fragment
//      shader screen-space ray-traces each pixel to find the impact
//      parameter b = closest approach of the camera ray to the BH
//      centre, then computes q(b). Inside the Schwarzschild shadow
//      boundary (b < b_c = 3√3/2 · r_s ≈ 2.6 r_s) we draw a dim glow
//      whose intensity tracks (1−q); outside, a Gaussian photon-ring
//      peak at b ≈ b_c plus a 1/r²-ish ambient. No fudged Fresnel.
//   3. Accretion disk: flat additive ring shader, paper-style decoration
//      (paper says nothing specific about disk dynamics — §20 only notes
//      the exterior should approach a Vaidya metric during accretion).
//
// The `localQ` uniform damps everything by the far-field q at this BH's
// location — when a neighbour drains the surroundings, the ring fades
// (paper N²=q lapse applied as a brightness modulator).

import * as THREE from 'three';

export interface BlackHoleOptions {
  radius: number;       // event horizon radius (sim units)
  diskInner?: number;   // *radius
  diskOuter?: number;   // *radius
  diskTilt?: number;    // radians around X axis
  hot?:  THREE.Color;   // inner-disk colour (hottest)
  mid?:  THREE.Color;   // mid-disk
  cool?: THREE.Color;   // outer-disk
}

// Schwarzschild apparent shadow radius: b_c = (3√3 / 2) · r_s
const SHADOW_BC = (3 * Math.sqrt(3)) / 2;

export class BlackHole extends THREE.Group {
  horizon: THREE.Mesh;
  qShell: THREE.Mesh;        // q-field shader sphere (replaces the old photon ring)
  disk: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;
  private qUniforms: Record<string, THREE.IUniform>;

  constructor(opts: BlackHoleOptions) {
    super();

    const r  = opts.radius;
    const ri = (opts.diskInner ?? 2.6) * r;
    const ro = (opts.diskOuter ?? 8.0) * r;
    const tilt = opts.diskTilt ?? 0.45;

    // Event horizon — opaque black sphere at q=0 (paper §20).
    const horizonGeom = new THREE.SphereGeometry(r, 48, 32);
    const horizonMat  = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.horizon = new THREE.Mesh(horizonGeom, horizonMat);
    this.add(this.horizon);

    // q-field shell — additive sphere larger than the photon-ring radius
    // so it contains the visible photon ring (b ≈ 2.6 r_s) plus a 1/r
    // ambient tail. Fragment shader screen-space ray-traces each pixel
    // to find the impact parameter and renders accordingly.
    const qShellR = 5 * r;
    const qShellGeom = new THREE.SphereGeometry(qShellR, 64, 48);
    const qShellMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        rs:        { value: r },
        bhCenter:  { value: new THREE.Vector3() },
        cameraPos: { value: new THREE.Vector3() },
        hotColor:  { value: (opts.hot  ?? new THREE.Color('#fff4d8')).clone() },
        coolColor: { value: (opts.cool ?? new THREE.Color('#7ad7ff')).clone() },
        localQ:    { value: 1.0 },
        // SHADOW_BC = 3√3/2 — passed as uniform so JS keeps one canonical value
        bc:        { value: SHADOW_BC }
      },
      vertexShader: /* glsl */`
        varying vec3 vWorldPos;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float rs;
        uniform vec3  bhCenter;
        uniform vec3  cameraPos;
        uniform vec3  hotColor;
        uniform vec3  coolColor;
        uniform float localQ;
        uniform float bc;
        varying vec3  vWorldPos;

        void main(){
          // Ray from camera through this pixel (the fragment is on the
          // shell — we re-derive the screen-ray and trace it past the BH).
          vec3 rayDir = normalize(vWorldPos - cameraPos);
          vec3 toBH   = bhCenter - cameraPos;
          float t_ca  = dot(toBH, rayDir);
          if (t_ca < 0.0) discard;                     // BH behind camera

          // Impact parameter b = closest approach of the ray to BH centre.
          vec3 closest = cameraPos + t_ca * rayDir;
          float b = length(closest - bhCenter);

          // Paper §15-§20: capacity field q(r) = max(0, 1 − r_s/r). At
          // the horizon q = 0; far away q → 1. We index by impact
          // parameter b — what the ray "sees" outside.
          if (b < rs) discard;                         // horizon mesh draws the disc

          float bcR = bc * rs;                         // shadow boundary in sim units

          float q       = 1.0 - rs / b;                // 0 at horizon, →1 outside
          float drained = 1.0 - q;                     // = r_s / b

          if (b < bcR) {
            // Lensed-shadow region (r_s < b < b_c). A true ray-trace would
            // show the accretion disk wrapped around the BH here; we
            // approximate with a dim glow that fades smoothly from the
            // shadow boundary toward the horizon. Tied to (1−q) so the
            // gradient IS the substrate capacity drain.
            float t   = (b - rs) / (bcR - rs);
            float a   = (0.30 + 0.45 * (1.0 - t)) * localQ;
            float gI  = 0.20 * drained;
            vec3  col = mix(coolColor, hotColor, drained);
            gl_FragColor = vec4(col * gI, a * (0.6 + 0.4 * drained));
          } else {
            // Photon ring: peaks at b ≈ b_c (the Schwarzschild critical
            // impact parameter where unstable null orbits pile up).
            float ringWidth  = 0.35 * rs;
            float photonRing = exp(-pow((b - bcR) / ringWidth, 2.0));
            // 1/r² ambient tail outside the ring
            float ambient    = pow(rs / b, 1.6) * 0.10;
            float intensity  = (photonRing * 1.6 + ambient) * localQ;
            if (intensity < 0.005) discard;
            vec3  col = mix(coolColor, hotColor, smoothstep(bcR * 1.4, bcR, b));
            gl_FragColor = vec4(col * intensity, intensity);
          }
        }
      `
    });
    this.qShell = new THREE.Mesh(qShellGeom, qShellMat);
    this.qUniforms = qShellMat.uniforms;
    this.add(this.qShell);

    // Accretion disk — flat ring with hot-spot shader and Doppler asymmetry.
    // Paper says nothing specific about disk dynamics; this is decoration.
    const diskGeom = new THREE.RingGeometry(ri, ro, 128, 8);
    this.uniforms = {
      time:   { value: 0 },
      inner:  { value: ri },
      outer:  { value: ro },
      hot:    { value: opts.hot  ?? new THREE.Color('#fff4d8') },
      mid:    { value: opts.mid  ?? new THREE.Color('#ffaa55') },
      cool:   { value: opts.cool ?? new THREE.Color('#7ad7ff') }
    };
    const diskMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec2 vWorld;
        void main(){
          vWorld = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float time;
        uniform float inner;
        uniform float outer;
        uniform vec3  hot;
        uniform vec3  mid;
        uniform vec3  cool;
        varying vec2 vWorld;

        float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          float a = hash(i), b = hash(i + vec2(1,0));
          float c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
        }
        float fbm(vec2 p){
          float v = 0.0, amp = 0.5;
          for (int i = 0; i < 4; i++){ v += amp * noise(p); p *= 2.07; amp *= 0.5; }
          return v;
        }

        void main(){
          float r   = length(vWorld);
          float ang = atan(vWorld.y, vWorld.x);
          if (r < inner || r > outer) discard;

          float t   = (r - inner) / (outer - inner);
          float rad = pow(1.0 - t, 1.6);
          float dop = 0.55 + 0.45 * sin(ang);
          float n   = fbm(vec2(ang * 4.0 + time * 0.6, r * 0.6 - time * 0.3));

          vec3 col = mix(cool, mid, rad);
          col = mix(col, hot, pow(rad, 2.5));
          col *= 0.6 + 1.4 * n;
          float a = rad * dop * (0.65 + 0.5 * n);
          gl_FragColor = vec4(col, a);
        }
      `
    });
    this.disk = new THREE.Mesh(diskGeom, diskMat);
    this.disk.rotation.x = Math.PI / 2 - tilt;
    this.add(this.disk);
  }

  tick(time: number) {
    (this.uniforms.time as { value: number }).value = time;
  }

  // Per-frame uniform sync — caller passes the current world-space BH
  // centre (this group's world position) and the active camera position.
  // Cheap: two Vector3 copies; called once per BH per frame.
  syncQField(bhCenter: THREE.Vector3, cameraPos: THREE.Vector3) {
    (this.qUniforms.bhCenter.value as THREE.Vector3).copy(bhCenter);
    (this.qUniforms.cameraPos.value as THREE.Vector3).copy(cameraPos);
  }

  // Set the far-field capacity q(r→∞) at this BH's location. When
  // neighbouring BHs have drained the surroundings, the ring + glow
  // both fade (paper N²=q lapse applied as a brightness modulator).
  setLocalQ(q: number) {
    (this.qUniforms.localQ as { value: number }).value = q;
  }
}
