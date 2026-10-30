import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { COMMON, ATMOS, SHADOW } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';
import { pondSDF, ISLAND } from './layout.js';

// Koi: lofted bodies with flowing fins, swimming lazy loops through the
// pond. Each fish undulates in the vertex shader; its pattern (kohaku,
// sanke, showa, ogon, asagi) is painted with noise over a scale texture.

const STATIONS = [
  // [x, y(=0), z, scale] stations along a fish's body: x is from tail root (0) to snout (1).
  [0.0, 0.026, 0.034], [0.12, 0.042, 0.06], [0.3, 0.085, 0.11], [0.5, 0.11, 0.135],
  [0.68, 0.112, 0.13], [0.82, 0.09, 0.105], [0.92, 0.06, 0.07], [0.98, 0.03, 0.035], [1.0, 0.0, 0.0],
];

function koiMesh() {
  const pos = [], uv = [], part = [], idx = [];
  const sides = 14;
  const rings = 26;
  const station = (x) => {
    for (let i = 0; i < STATIONS.length - 1; i++) {
      const a = STATIONS[i], b = STATIONS[i + 1];
      if (x <= b[0]) {
        const t = (x - a[0]) / (b[0] - a[0]);
        const s = t * t * (3 - 2 * t);
        return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
      }
    }
    return [0, 0];
  };
  // Body.
  for (let i = 0; i <= rings; i++) {
    const x = i / rings;
    const [w, h] = station(x);
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      // Flatter belly, rounder back.
      const yy = Math.sin(a) * h * (Math.sin(a) < 0 ? 0.8 : 1);
      pos.push(x, yy, Math.cos(a) * w);
      uv.push(x, j / sides);
      part.push(0);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j;
      idx.push(a, a + sides + 1, a + 1, a + 1, a + sides + 1, a + sides + 2);
    }
  // Fins as quads (alpha-cut in the shader): tail, dorsal, two pectorals.
  const fin = (verts, kind) => {
    const b = pos.length / 3;
    for (const [x, y, z, u, v] of verts) { pos.push(x, y, z); uv.push(u, v); part.push(kind); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  fin([[0.02, 0.0, 0], [0.02, 0.0, 0], [-0.3, 0.16, 0], [-0.3, -0.16, 0]].map((p, k) => [p[0], k === 0 ? 0.03 : k === 1 ? -0.03 : p[1], p[2], k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1]), 1);
  fin([[0.38, 0.1, 0], [0.66, 0.12, 0], [0.6, 0.2, 0], [0.4, 0.19, 0]].map((p, k) => [...p, k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1]), 2);
  for (const sd of [-1, 1]) {
    fin([[0.74, -0.06, sd * 0.07], [0.8, -0.06, sd * 0.09], [0.66, -0.08, sd * 0.24], [0.6, -0.09, sd * 0.2]].map((p, k) => [...p, k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1]), 3);
  }
  return { position: new Float32Array(pos), uv: new Float32Array(uv), part: new Float32Array(part), index: new Uint16Array(idx) };
}

const VERT = COMMON + /* glsl */ `
attribute vec2 aUv;
attribute float aPart;
attribute vec4 iPose;  // x, y, z, heading
attribute vec4 iLook;  // scale, kind, phase, speed
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying float vPart;
varying vec2 vKind;
void main() {
  vec3 p = position;
  float t = uTime;
  float ph = iLook.z;
  float sp = iLook.w;
  // Travelling body wave, stronger toward the tail; fins trail behind.
  float x = p.x;
  float amp = 0.07 * pow(1.0 - clamp(x, 0.0, 1.0), 2.0) + 0.01;
  float wave = sin(x * 5.5 - t * (3.0 + sp * 9.0) + ph);
  p.z += amp * wave;
  if (aPart > 0.5) {
    float trail = aPart < 1.5 ? (0.02 - x) : 0.4;
    p.z += sin(t * (3.0 + sp * 9.0) + ph + trail * 6.0) * 0.04 * aUv.x;
    if (aPart > 2.5) p.y += sin(t * 2.3 + ph + p.z * 20.0) * 0.02 * aUv.y;
  }
  vec3 n = normalize(vec3(0.0, p.y, p.z) + vec3(0.0, 0.0, 0.0001));
  if (aPart > 0.5) n = aPart < 2.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  float s = iLook.x;
  float c = cos(iPose.w), si = sin(iPose.w);
  // Local +x is the swimming direction.
  vec3 w = vec3(p.x - 0.5, p.y, p.z) * s;
  vec3 wp = vec3(w.x * c - w.z * si, w.y, w.x * si + w.z * c) + iPose.xyz;
  vNormal = vec3(n.x * c - n.z * si, n.y, n.x * si + n.z * c);
  vWorld = wp;
  vUv = aUv;
  vPart = aPart;
  vKind = iLook.yz;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = COMMON + ATMOS + SHADOW + /* glsl */ `
uniform sampler2D uReflection;
uniform mat4 uTexMatrix;
uniform float uHasReflection;
uniform float uWaterLevel;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying float vPart;
varying vec2 vKind;
void main() {
  float kind = vKind.x;
  float seed = vKind.y;
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 n = normalize(vNormal);
  if (dot(n, v) < 0.0) n = -n;
  vec2 uv = vUv;
  float alpha = 1.0;
  vec3 white = vec3(0.8, 0.78, 0.74), red = vec3(0.7, 0.08, 0.02), black = vec3(0.012, 0.012, 0.014);
  vec3 col;
  if (vPart < 0.5) {
    // Patches over the back and flanks.
    vec2 q = vec2(uv.x * 6.0, uv.y * 3.0) + seed * 17.0;
    float big = vnoise2(q * 0.9) * 0.65 + vnoise2(q * 2.2) * 0.35;
    float spot = vnoise2(q * 3.5 + 9.0);
    float back = smoothstep(0.15, 0.45, uv.y) * (1.0 - smoothstep(0.55, 0.85, uv.y)) + smoothstep(0.0, 0.1, 1.0 - abs(uv.y * 2.0 - 1.0)) * 0.0;
    float head = smoothstep(0.82, 0.9, uv.x);
    if (kind < 0.5) { // kohaku
      col = mix(white, red, smoothstep(0.5, 0.56, big) * back * (1.0 - head * 0.5));
    } else if (kind < 1.5) { // sanke
      col = mix(white, red, smoothstep(0.52, 0.58, big) * back);
      col = mix(col, black, smoothstep(0.7, 0.74, spot) * back);
    } else if (kind < 2.5) { // showa
      col = mix(black, red, smoothstep(0.55, 0.6, big) * back);
      col = mix(col, white, smoothstep(0.62, 0.68, spot) * (1.0 - back * 0.5));
    } else if (kind < 3.5) { // ogon
      col = vec3(0.75, 0.48, 0.12);
    } else { // asagi: blue-grey netted back, orange belly
      col = mix(vec3(0.6, 0.25, 0.08), vec3(0.22, 0.28, 0.34), smoothstep(0.25, 0.4, uv.y) * (1.0 - smoothstep(0.6, 0.75, uv.y)));
    }
    // Scale net.
    vec2 sc = vec2(uv.x * 34.0, uv.y * 22.0);
    sc.y += floor(sc.x) * 0.5;
    float scale = smoothstep(0.32, 0.5, length(fract(sc) - 0.5));
    col *= 1.0 - scale * 0.18 * (1.0 - head);
    // Dark eye.
    float eye = 1.0 - smoothstep(0.012, 0.02, length(vec2(uv.x - 0.93, (abs(uv.y - 0.5) - 0.18) * 0.6)));
    col = mix(col, black, eye);
  } else {
    // Translucent fins with fine rays.
    float rays = 0.5 + 0.5 * sin(uv.y * 60.0);
    float edge = vPart < 1.5 ? (uv.x * (1.0 - abs(uv.y * 2.0 - 1.0) * 0.3) - 0.95) : (uv.x - 0.98);
    alpha = saturate(0.5 - edge / max(fwidth(edge), 1e-4)) * 0.85;
    col = mix(white * 0.9, kind > 2.5 && kind < 3.5 ? vec3(0.8, 0.55, 0.2) : (kind > 1.5 && kind < 2.5 ? black : white), 0.5) * (0.85 + 0.15 * rays);
  }
  if (alpha < 0.05) discard;
  // Light under water: dimmer, cooler, wavering.
  vec3 l = uSunDir;
  float sh = shadowFast(vWorld + vec3(0.0, 0.5, 0.0), 0.05, 2.0);
  float caust = 0.7 + 0.6 * pow(vnoise2(vWorld.xz * 6.0 + uTime * 0.4) * vnoise2(vWorld.xz * 7.3 - uTime * 0.33) * 2.0, 2.0);
  vec3 lightCol = uSunColor * sh * saturate(dot(n, normalize(l + vec3(0.0, 0.6, 0.0)))) * 0.45 * caust + ambientLight(n) * 0.55;
  vec3 c = col * lightCol * vec3(0.85, 1.0, 0.92);
  c += uSunColor * sh * pow(saturate(dot(reflect(-l, n), v)), 30.0) * 0.15 * (kind > 2.5 && kind < 3.5 ? 3.0 : 1.0);
  // Seen through the pond: follow the eye ray up to the surface, dim and tint
  // by the water between, then lay the surface reflection over the top.
  float tS = (uWaterLevel - vWorld.y) / max(v.y, 0.06);
  vec3 S = vWorld + v * tS;
  float T = exp(-tS * 3.2);
  vec3 scatter = (ambientLight(vec3(0.0, 1.0, 0.0)) * 0.11 + uSunColor * sh * 0.03) * vec3(0.25, 0.62, 0.45);
  float F = 0.02 + 0.98 * pow(1.0 - saturate(v.y), 5.0);
  float sheen = 0.05 + F;
  vec3 refl = ambientLight(vec3(-v.x, v.y, -v.z)) * 0.8;
  if (uHasReflection > 0.5) {
    vec4 rc = uTexMatrix * vec4(S, 1.0);
    refl = texture2D(uReflection, rc.xy / rc.w).rgb;
  }
  c = (c * T + scatter * (1.0 - T)) * (1.0 - sheen) + refl * sheen;
  c = applyFog(c, S);
  gl_FragColor = vec4(c, alpha);
}
`;

export function createKoi({ waterLevel, count = 9, seed = 3 }) {
  const rng = new RNG(seed);
  const base = koiMesh();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(base.position, 3));
  geo.setAttribute('aUv', new THREE.BufferAttribute(base.uv, 2));
  geo.setAttribute('aPart', new THREE.BufferAttribute(base.part, 1));
  geo.setIndex(new THREE.BufferAttribute(base.index, 1));
  const pose = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  pose.setUsage(THREE.DynamicDrawUsage);
  const look = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  geo.setAttribute('iPose', pose);
  geo.setAttribute('iLook', look);
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(-6, waterLevel, 8), 20);

  // Swimming loops, each kept well inside deep water.
  const loops = [
    { c: [ISLAND[0], ISLAND[1]], r: [2.6, 2.3], rot: 0 },
    { c: [-6.4, 5.4], r: [2.1, 1.2], rot: 0.55 },
    { c: [1.9, 14.3], r: [1.7, 1.0], rot: 0.2 },
    { c: [-3.8, 3.4], r: [1.4, 0.8], rot: 0.45 },
    { c: [-14.9, 9.8], r: [1.6, 1.0], rot: 0.3 },
  ];
  for (const L of loops) {
    // Shrink until the whole loop sits in water at least 0.5 m from the bank.
    for (let k = 0; k < 20; k++) {
      let ok = true;
      for (let i = 0; i < 64 && ok; i++) {
        const a = (i / 64) * Math.PI * 2;
        const x = L.c[0] + Math.cos(a) * L.r[0] * Math.cos(L.rot) - Math.sin(a) * L.r[1] * Math.sin(L.rot);
        const z = L.c[1] + Math.cos(a) * L.r[0] * Math.sin(L.rot) + Math.sin(a) * L.r[1] * Math.cos(L.rot);
        if (pondSDF(x, z) > -0.5 || Math.hypot(x - ISLAND[0], z - ISLAND[1]) < ISLAND[2] + 0.5) ok = false;
      }
      if (ok) break;
      L.r[0] *= 0.9;
      L.r[1] *= 0.9;
    }
  }
  const fish = [];
  for (let i = 0; i < count; i++) {
    const L = loops[i % loops.length];
    const kind = [0, 1, 2, 3, 4, 0, 3, 1, 0][i % 9];
    fish.push({
      L, a: rng.range(0, 6.28), dir: rng.chance(0.5) ? 1 : -1, speed: rng.range(0.12, 0.24),
      depth: rng.range(0.08, 0.2), wob: rng.range(0, 6.28), scale: rng.range(0.42, 0.62),
    });
    look.setXYZW(i, fish[i].scale, kind, rng.range(0, 6.28), fish[i].speed);
  }
  const uniforms = lightingUniforms({
    uReflection: { value: null },
    uTexMatrix: { value: new THREE.Matrix4() },
    uHasReflection: { value: 0 },
    uWaterLevel: { value: waterLevel },
  });
  // Drawn after the water surface (transparent queue) but fully opaque: the
  // shader composites the water over each fish itself.
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    alphaToCoverage: true, transparent: true, depthWrite: true, blending: THREE.NoBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;

  const at = (L, a, wob) => {
    const rx = L.r[0] * (1 + 0.12 * Math.sin(a * 2 + wob)), rz = L.r[1] * (1 + 0.12 * Math.cos(a * 3 + wob));
    const x = Math.cos(a) * rx, z = Math.sin(a) * rz;
    return [L.c[0] + x * Math.cos(L.rot) - z * Math.sin(L.rot), L.c[1] + x * Math.sin(L.rot) + z * Math.cos(L.rot)];
  };
  const update = (dt, t) => {
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      // Lazy pace that surges now and then.
      const surge = 0.7 + 0.5 * Math.max(0, Math.sin(t * 0.13 + f.wob * 3));
      const circ = (f.L.r[0] + f.L.r[1]) * Math.PI;
      f.a += (f.dir * f.speed * surge * dt * Math.PI * 2) / circ;
      const p = at(f.L, f.a, f.wob);
      const q = at(f.L, f.a + f.dir * 0.02, f.wob);
      const heading = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const y = waterLevel - f.depth + Math.sin(t * 0.3 + f.wob) * 0.04;
      pose.setXYZW(i, p[0], y, p[1], heading);
    }
    pose.needsUpdate = true;
  };
  update(0, 0);
  return { mesh, update, material };
}
