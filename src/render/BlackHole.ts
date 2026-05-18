// Black hole: accretion disk + photon ring + screen-space lensing fake.
// Visual only — paper's q→0 saturation rendered cinematically.

import * as THREE from 'three';

export interface BlackHoleOptions {
  radius: number;       // event horizon radius (sim units)
  diskInner?: number;   // *radius
  diskOuter?: number;   // *radius
  diskTilt?: number;    // radians around X axis
}

export class BlackHole extends THREE.Group {
  horizon: THREE.Mesh;
  photonRing: THREE.Mesh;
  disk: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(opts: BlackHoleOptions) {
    super();

    const r  = opts.radius;
    const ri = (opts.diskInner ?? 2.6) * r;
    const ro = (opts.diskOuter ?? 8.0) * r;
    const tilt = opts.diskTilt ?? 0.45;

    // Event horizon — solid black sphere
    const horizonGeom = new THREE.SphereGeometry(r, 48, 32);
    const horizonMat  = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.horizon = new THREE.Mesh(horizonGeom, horizonMat);
    this.add(this.horizon);

    // Photon ring — thin emissive shell with Fresnel-edged transparency
    const ringGeom = new THREE.SphereGeometry(r * 1.05, 64, 48);
    const ringMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: { color: { value: new THREE.Color('#ffd9a8') } },
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vV;
        void main(){
          vN = normalize(normalMatrix * normal);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-p.xyz);
          gl_Position = projectionMatrix * p;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 color;
        varying vec3 vN; varying vec3 vV;
        void main(){
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float ring = pow(f, 5.0);
          gl_FragColor = vec4(color, ring * 2.6);
        }
      `
    });
    this.photonRing = new THREE.Mesh(ringGeom, ringMat);
    this.add(this.photonRing);

    // Accretion disk — flat ring with hot-spot shader and Doppler asymmetry
    const diskGeom = new THREE.RingGeometry(ri, ro, 128, 8);
    this.uniforms = {
      time:   { value: 0 },
      inner:  { value: ri },
      outer:  { value: ro },
      hot:    { value: new THREE.Color('#fff4d8') },
      mid:    { value: new THREE.Color('#ffaa55') },
      cool:   { value: new THREE.Color('#7ad7ff') }
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

        // hash & noise
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

          // radial intensity falloff (hot at inner)
          float t   = (r - inner) / (outer - inner);
          float rad = pow(1.0 - t, 1.6);

          // doppler asymmetry: one side brighter
          float dop = 0.55 + 0.45 * sin(ang);

          // hot spots animated around
          float n = fbm(vec2(ang * 4.0 + time * 0.6, r * 0.6 - time * 0.3));

          vec3 col = mix(cool, mid, rad);
          col = mix(col, hot, pow(rad, 2.5));
          col *= 0.6 + 1.4 * n;
          float a = rad * dop * (0.65 + 0.5 * n);
          gl_FragColor = vec4(col, a);
        }
      `
    });
    this.disk = new THREE.Mesh(diskGeom, diskMat);
    this.disk.rotation.x = Math.PI / 2 - tilt; // tilt away from camera
    this.add(this.disk);
  }

  tick(time: number) {
    (this.uniforms.time as { value: number }).value = time;
  }
}
