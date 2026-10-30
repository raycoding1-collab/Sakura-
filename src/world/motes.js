import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { COMMON, WIND, ATMOS, SHADOW } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';

// Pollen and dust adrift in the evening air. They only light up where the
// sun actually reaches them, so they trace the shafts of light through the
// crown, and glow brightest when you look toward the sun.

export function createMotes({ count = 1600, seed = 3 } = {}) {
  const rng = new RNG(seed);
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng.range(-13, 13);
    pos[i * 3 + 1] = rng.range(0.2, 8.5);
    pos[i * 3 + 2] = rng.range(-13, 13);
    rnd[i * 4] = rng.next();
    rnd[i * 4 + 1] = rng.next();
    rnd[i * 4 + 2] = rng.next();
    rnd[i * 4 + 3] = rng.next();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 20);
  const material = new THREE.ShaderMaterial({
    uniforms: lightingUniforms({ uPixelScale: { value: 1 } }),
    vertexShader: COMMON + WIND + ATMOS + SHADOW + /* glsl */ `
      attribute vec4 aRnd;
      uniform float uPixelScale;
      varying float vBright;
      varying vec3 vColor;
      void main() {
        float t = uTime;
        vec3 p = position;
        // Lazy drift with the breeze, wrapped inside the volume.
        vec3 drift = vec3(uWindDir.x, 0.0, uWindDir.y) * t * (0.12 + 0.1 * aRnd.x);
        drift += vec3(sin(t * (0.3 + aRnd.y * 0.4) + aRnd.z * 20.0), sin(t * (0.21 + aRnd.w * 0.3) + aRnd.x * 9.0) * 0.6, cos(t * (0.27 + aRnd.x * 0.3) + aRnd.w * 13.0)) * 0.6;
        p += drift;
        p.xz = mod(p.xz + 13.0, 26.0) - 13.0;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float sun = shadowFast(p, 0.02, 1.0);
        vec3 v = normalize(cameraPosition - p);
        float fwd = pow(saturate(dot(-v, uSunDir)), 6.0);
        float twinkle = 0.6 + 0.4 * sin(t * (1.5 + aRnd.y * 3.0) + aRnd.z * 30.0);
        vBright = sun * (0.02 + 1.5 * fwd) * twinkle;
        vColor = uSunColor * mix(vec3(1.0, 0.9, 0.75), vec3(1.0, 0.75, 0.8), aRnd.w);
        float size = mix(0.006, 0.014, aRnd.x);
        gl_PointSize = clamp(size * uPixelScale / max(dist, 0.1), 1.0, 24.0);
        if (vBright < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: COMMON + /* glsl */ `
      varying float vBright;
      varying vec3 vColor;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r = dot(q, q);
        float a = exp(-r * 4.0);
        gl_FragColor = vec4(vColor * vBright * a * 0.32, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 20;
  return { points, material };
}
