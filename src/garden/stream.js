import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { mat4Compose } from '../core/geom.js';
import { COMMON, WIND, ATMOS, SHADOW } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';
import { petalGrid, buildGeometry, makeMaterials, quatFromYawTilt } from '../world/petals.js';
import { STREAM, STREAM_COURSE, FALLS, WATER_Y, LAYOUT_GLSL, streamDepth } from './layout.js';
import { MAT } from './propMaterial.js';

// The mountain stream: a waterfall pouring over a lip stone between two
// flanking rocks into a plunge pool, with the carp stone (koi-ishi) below it,
// then a brook running through pools and riffles past the cherry into the
// pond. Water flows by a two-phase flow map along the channel; foam gathers
// in the riffles, around stones and under the falls; mist drifts off the pool;
// and petals from the cherry ride the current in rafts (hanaikada).

const C = STREAM_COURSE;
const G = 9.81;

// Flow speed along the course, from the local fall of the water surface.
const SPEED = C.s.map((_, i) => {
  const a = Math.max(0, i - 3), b = Math.min(C.s.length - 1, i + 3);
  const slope = Math.max(0, -(C.wl[b] - C.wl[a]) / Math.max(1e-3, C.s[b] - C.s[a]));
  return Math.min(0.95, 0.2 + slope * 5.0) * Math.sqrt(0.6 / Math.max(0.45, C.hw[i]));
});
const SLOPE = C.s.map((_, i) => {
  const a = Math.max(0, i - 2), b = Math.min(C.s.length - 1, i + 2);
  return Math.max(0, -(C.wl[b] - C.wl[a]) / Math.max(1e-3, C.s[b] - C.s[a]));
});

// Interpolated course data at arc length s.
function courseAt(s, out = {}) {
  const n = C.s.length;
  s = Math.min(Math.max(s, 0), C.length - 1e-4);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (C.s[m] <= s) lo = m; else hi = m;
  }
  const t = (s - C.s[lo]) / Math.max(1e-6, C.s[hi] - C.s[lo]);
  const L = (arr) => arr[lo] + (arr[hi] - arr[lo]) * t;
  const dx = C.x[hi] - C.x[lo], dz = C.z[hi] - C.z[lo];
  const l = Math.hypot(dx, dz) || 1;
  out.x = L(C.x); out.z = L(C.z); out.hw = L(C.hw); out.wl = L(C.wl);
  out.tx = dx / l; out.tz = dz / l; out.speed = L(SPEED); out.slope = L(SLOPE);
  return out;
}

// The waterfall's frame: forward (the way the water leaves), right, the lip.
function fallsFrame(offset) {
  const f = FALLS.dir;
  const fl = Math.hypot(f[0], f[1]);
  const fx = f[0] / fl, fz = f[1] / fl;
  const lip = [FALLS.lip[0], FALLS.lip[1] - offset, FALLS.lip[2]];
  const pool = STREAM[0][3] - offset;
  const at = (right, fwd, y) => [lip[0] + fz * right + fx * fwd, y, lip[2] - fx * right + fz * fwd];
  return { fx, fz, lip, pool, at, yaw: Math.atan2(fx, fz) };
}

// Plunge point: where the falling sheet meets the pool.
function plungePoint(offset) {
  const F = fallsFrame(offset);
  const tEnd = Math.sqrt((2 * (F.lip[1] - F.pool)) / G);
  return F.at(0, 0.06 + 0.55 * tEnd, F.pool);
}

// ---------------------------------------------------------------------------
// Stones: the waterfall's rock frame, the pool's rim, the banks, boulders in
// the riffles, a ford of stepping stones and a granite slab bridge. Built into
// the garden's prop mesh. Returns the stones that stand in the water, which
// the water surface turns into foam.
export function buildStreamStones(mb, groundAt, waterLevel) {
  const offset = WATER_Y - waterLevel;
  const rng = new RNG(2024);
  const wet = [];
  const rock = (pos, size, yaw, opts = {}) => {
    const st = mb.rock({ seed: rng.int(1, 1e6), size, detail: opts.detail ?? 4, mat: opts.mat ?? MAT.ROCK, faceting: opts.faceting ?? 0.8, top: opts.top ?? null, cut: opts.cut ?? -0.35 });
    mb.transform(st, mat4Compose(pos, yaw, [1, 1, 1], opts.tiltX ?? rng.sym(0.06), opts.tiltZ ?? rng.sym(0.06)));
  };

  // The waterfall (taki-ishi-gumi).
  const F = fallsFrame(offset);
  const ly = F.lip[1], py = F.pool;
  const H = ly - py;
  // Lip stone, worn smooth where the water goes over.
  rock(F.at(0, -0.42, ly - 0.17), [0.58, 0.22, 0.5], F.yaw, { top: 0.55, faceting: 0.6 });
  // The face behind the falling water.
  rock(F.at(0.05, -0.32, py + H * 0.42), [0.62, H * 0.5, 0.36], F.yaw + 0.1, { faceting: 0.85 });
  rock(F.at(-0.48, -0.2, py + H * 0.2), [0.42, H * 0.34, 0.34], F.yaw - 0.3);
  rock(F.at(0.52, -0.25, py + H * 0.25), [0.4, H * 0.36, 0.32], F.yaw + 0.4);
  // Two tall flanking stones (the guardians), the left one taller.
  rock(F.at(-1.0, -0.1, py + 0.55), [0.52, 1.45, 0.56], F.yaw + 0.3, { faceting: 0.88, tiltZ: 0.1 });
  rock(F.at(0.98, -0.05, py + 0.45), [0.46, 1.08, 0.5], F.yaw - 0.4, { faceting: 0.88, tiltZ: -0.08 });
  // The mass of the hill behind, and the channel that feeds the lip.
  rock(F.at(-0.75, -1.05, ly - 0.35), [0.85, 0.75, 0.8], F.yaw + 1.1);
  rock(F.at(0.85, -1.15, ly - 0.4), [0.8, 0.68, 0.85], F.yaw - 0.7);
  rock(F.at(-0.15, -2.05, ly - 0.2), [1.05, 0.62, 0.8], F.yaw + 0.4);
  rock(F.at(-1.75, -0.7, py + 0.65), [0.75, 0.95, 0.7], F.yaw + 2.0);
  rock(F.at(1.7, -0.75, py + 0.55), [0.7, 0.8, 0.65], F.yaw - 1.6);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) rock(F.at(side * 0.5, -0.8 - k * 0.45, ly - 0.08), [0.24, 0.16, 0.22], rng.range(0, 6.28));
  }
  // Outcrops breaking through the hill around the falls.
  for (let k = 0; k < 14; k++) {
    const side = k % 2 ? 1 : -1;
    const right = side * rng.range(1.6, 4.2), fwd = rng.range(-3.2, 0.6);
    const p = F.at(right, fwd, 0);
    const s = rng.range(0.35, 0.85);
    rock([p[0], groundAt(p[0], p[2]) - s * 0.35, p[2]], [s * rng.range(1.0, 1.5), s * rng.range(0.55, 0.9), s], rng.range(0, 6.28), { faceting: 0.85 });
  }
  // The carp stone, leaning up toward the falls as if about to leap them.
  const koiStone = F.at(0.18, 0.95, py - 0.08);
  rock(koiStone, [0.2, 0.42, 0.19], F.yaw, { tiltX: -0.42, tiltZ: 0.12, faceting: 0.7 });
  wet.push([koiStone[0], koiStone[2], 0.22]);
  // Rim of the plunge pool.
  const p0 = STREAM[0];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rng.sym(0.15);
    const cx = Math.cos(a), cz = Math.sin(a);
    // Leave the falls side and the outflow open.
    const toFalls = cx * -F.fx + cz * -F.fz;
    const toOut = cx * (STREAM[1][0] - p0[0]) / 2.3 + cz * (STREAM[1][1] - p0[1]) / 2.3;
    if (toFalls > 0.55 || toOut > 0.75) continue;
    const r = p0[2] + rng.range(0.1, 0.3);
    const x = p0[0] + cx * r, z = p0[1] + cz * r;
    const s = rng.range(0.24, 0.48);
    rock([x, groundAt(x, z) - s * 0.25, z], [s * 1.2, s * 0.7, s], rng.range(0, 6.28));
  }

  // Banks, boulders and crossings, walking down the course.
  const ford = 15.1, bridge = 7.3;
  const cs = {};
  for (let s = 1.6; s < C.length - 1.4; s += rng.range(0.45, 0.85)) {
    courseAt(s, cs);
    if (Math.abs(s - bridge) < 0.9 || Math.abs(s - ford) < 0.6) continue;
    const nx = -cs.tz, nz = cs.tx;
    const side = rng.chance(0.5) ? 1 : -1;
    const big = rng.chance(0.14);
    const sz = big ? rng.range(0.38, 0.55) : rng.range(0.14, 0.32);
    const d = cs.hw + sz * rng.range(0.2, 0.7);
    const x = cs.x + nx * d * side, z = cs.z + nz * d * side;
    rock([x, groundAt(x, z) - sz * 0.3, z], [sz * rng.range(1.0, 1.4), sz * rng.range(0.55, 0.85), sz], rng.range(0, 6.28), { detail: big ? 4 : 3 });
    // Boulders standing in the riffles.
    if (cs.slope > 0.04 && rng.chance(0.45)) {
      const b = rng.range(0.13, 0.24);
      const a = rng.sym(0.45) * cs.hw;
      const bx = cs.x + nx * a, bz = cs.z + nz * a;
      rock([bx, cs.wl - offset - b * 0.35, bz], [b * 1.2, b * 0.8, b], rng.range(0, 6.28), { detail: 3 });
      wet.push([bx, bz, b * 1.1]);
    }
  }
  // Ford of stepping stones (sawatari), flat-topped, just clear of the water.
  courseAt(ford, cs);
  for (const a of [-0.52, -0.02, 0.5]) {
    const x = cs.x - cs.tz * a + cs.tx * rng.sym(0.1), z = cs.z + cs.tx * a + cs.tz * rng.sym(0.1);
    const s = rng.range(0.2, 0.25);
    rock([x, cs.wl - offset + 0.06 - s * 0.3, z], [s * 1.25, s * 0.55, s * 1.05], rng.range(0, 6.28), { top: 0.3, faceting: 0.55, detail: 3 });
    wet.push([x, z, s * 1.15]);
  }
  // Granite slab bridge resting on a stone at each end.
  courseAt(bridge, cs);
  const nx = -cs.tz, nz = cs.tx;
  const half = cs.hw + 0.55;
  const ends = [-1, 1].map((k) => [cs.x + nx * half * k, cs.z + nz * half * k]);
  const gy = Math.max(groundAt(...ends[0]), groundAt(...ends[1]));
  for (const [x, z] of ends) rock([x, groundAt(x, z) - 0.1, z], [0.36, 0.26, 0.42], rng.range(0, 6.28), { top: 0.4, faceting: 0.7 });
  const slabYaw = Math.atan2(nx, nz) + Math.PI / 2;
  const slab = mb.rock({ seed: 77, size: [half + 0.15, 0.085, 0.3], detail: 4, mat: MAT.GRANITE, faceting: 0.95, top: 0.45, cut: -0.5 });
  mb.transform(slab, mat4Compose([cs.x, gy + 0.18, cs.z], slabYaw, [1, 1, 1], 0, 0.015));
  return { wet };
}

// ---------------------------------------------------------------------------
const WATER_VERT = /* glsl */ `
attribute vec4 aFlow;   // flow direction xz, speed, foam
attribute vec3 aCoord;  // across (m), along (m), |across| / half-width
attribute float aDepth;
varying vec3 vWorld;
varying vec4 vFlow;
varying vec3 vCoord;
varying float vDepth;
void main() {
  vWorld = position;
  vFlow = aFlow;
  vCoord = aCoord;
  vDepth = aDepth;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const WATER_FRAG = COMMON + WIND + ATMOS + SHADOW + LAYOUT_GLSL + /* glsl */ `
uniform sampler2D uReflection;
uniform mat4 uTexMatrix;
uniform float uHasReflection;
uniform vec3 uPlunge; // x, z, strength
uniform float uPondLevel;
varying vec3 vWorld;
varying vec4 vFlow;
varying vec3 vCoord;
varying float vDepth;

float waveH(vec2 q) {
  // Broad boils, then the fine wrinkles that make running water sparkle.
  return fbm2(vec2(q.x * 3.0, q.y * 1.3)) * 0.008
       + vnoise2(vec2(q.x * 11.0, q.y * 5.0)) * 0.006
       + vnoise2(vec2(q.x * 27.0, q.y * 13.0)) * 0.0028;
}
// Two phases of the same pattern carried downstream and crossfaded, so the
// surface flows at the local speed without ever smearing out.
float flowH(vec2 q, float speed, float t, out float foamN) {
  const float T = 1.7;
  float p1 = fract(t / T), p2 = fract(t / T + 0.5);
  float w = abs(p1 * 2.0 - 1.0);
  vec2 q1 = q - vec2(0.0, speed * T * p1);
  vec2 q2 = q - vec2(0.0, speed * T * p2) + vec2(3.7, 11.9);
  foamN = mix(fbm2(q1 * vec2(5.5, 2.6) + 4.0), fbm2(q2 * vec2(5.5, 2.6) + 4.0), w);
  return mix(waveH(q1), waveH(q2), w);
}
float standing(vec2 q, float riffle, float t) {
  // Standing waves where the water speeds over the riffles: fixed in place
  // while the texture of the water runs through them.
  float h = sin(q.y * 10.5 + sin(q.x * 3.1) * 1.3 + sin(t * 2.3 + q.x) * 0.3) * 0.009;
  h += sin(q.y * 6.4 - abs(q.x) * 5.5) * 0.006;
  return h * riffle;
}
float plunge(vec2 p, float t) {
  float d = length(p - uPlunge.xy);
  return sin(d * 21.0 - t * 8.0) * 0.006 * exp(-d * 1.3) * uPlunge.z;
}

void main() {
  float t = uTime;
  vec2 dir = normalize(vFlow.xy);
  vec3 T3 = vec3(dir.x, 0.0, dir.y);
  vec3 B3 = vec3(-dir.y, 0.0, dir.x);
  float speed = vFlow.z;
  float riffle = smoothstep(0.32, 0.7, speed);
  vec2 q = vCoord.xy;
  vec2 pw = vWorld.xz;
  float e = 0.03;
  float fn, fdummy;
  float h0 = flowH(q, speed, t, fn) + standing(q, riffle, t) + plunge(pw, t);
  float ha = flowH(q + vec2(e, 0.0), speed, t, fdummy) + standing(q + vec2(e, 0.0), riffle, t) + plunge(pw + B3.xz * e, t);
  float hs = flowH(q + vec2(0.0, e), speed, t, fdummy) + standing(q + vec2(0.0, e), riffle, t) + plunge(pw + T3.xz * e, t);
  float amp = 0.7 + 0.8 * riffle;
  vec3 n = normalize(vec3(0.0, 1.0, 0.0) - B3 * (ha - h0) / e * amp - T3 * (hs - h0) / e * amp);

  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = saturate(dot(n, v));
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  // Upstream, the sky through the ripples, darkened where low reflected rays
  // would meet the banks and plants; near the pond's level, the pond's mirror.
  vec3 r = reflect(-v, n);
  vec3 bankCol = ambientLight(vec3(0.0, 1.0, 0.0)) * vec3(0.1, 0.13, 0.08);
  vec3 refl = mix(bankCol, ambientLight(r) * 0.62, smoothstep(-0.04, 0.45, r.y));
  if (uHasReflection > 0.5) {
    vec4 rc = uTexMatrix * vec4(vWorld, 1.0);
    vec3 mirror = texture2D(uReflection, rc.xy / rc.w + n.xz * 0.05).rgb;
    refl = mix(mirror, refl, smoothstep(0.03, 0.18, vWorld.y - uPondLevel));
  }
  vec3 l = uSunDir;
  float sh = shadowFast(vWorld + l * 0.05, 0.03, 2.0);
  // Clear mountain water: the bed shows through, tinted where it deepens.
  float path = vDepth / max(v.y, 0.18);
  float Tr = exp(-path * 5.0);
  vec3 scatter = (ambientLight(vec3(0.0, 1.0, 0.0)) * 0.12 + uSunColor * sh * 0.035) * vec3(0.3, 0.56, 0.44);
  vec3 glint = uSunColor * sh * ggxSpec(n, v, l, 0.05) * 2.4;
  vec3 lamp = localLight(vWorld, n, 0.0);
  float sheen = 0.06 + F;
  vec3 c = scatter * (1.0 - Tr) * (1.0 - sheen) + refl * sheen + glint + lamp * 0.04;
  float a = 1.0 - Tr * (1.0 - sheen);

  // Foam: white water in the riffles, at the stones and under the falls.
  // Streaks drawn out along the current; solid white only at the stones and
  // under the falls.
  float foamAmt = saturate(vFlow.w);
  float streak = smoothstep(0.52, 0.74, fn);
  float foam = streak * foamAmt * 0.85;
  foam = max(foam, smoothstep(0.75, 1.0, foamAmt) * (0.5 + 0.5 * fn));
  vec3 fc = uSunColor * sh * (0.18 + 0.4 * saturate(dot(n, l))) * 0.65 + ambientLight(n) * 0.9 + lamp * 0.6;
  c = mix(c, fc * vec3(0.92, 0.95, 0.95), foam);
  a = mix(a, 1.0, foam * 0.95);

  // Soft waterline at the banks, and the hand-over to the pond.
  a *= 1.0 - smoothstep(0.9, 1.08, vCoord.z);
  a *= smoothstep(-0.7, 0.15, pondSDF(vWorld.xz));
  c = applyFog(c / max(a, 1e-3), vWorld);
  gl_FragColor = vec4(c * a, a);
}
`;

const FALL_VERT = /* glsl */ `
attribute vec2 aSheet; // across -1..1, down 0..1
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vSheet;
void main() {
  vWorld = position;
  vNormal = normal;
  vSheet = aSheet;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FALL_FRAG = COMMON + WIND + ATMOS + SHADOW + /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vSheet;
void main() {
  float u = vSheet.x, s = vSheet.y;
  float t = uTime;
  // Distance fallen grows with the square of time; the texture falls with it.
  float fall = s * s * 1.2 + s * 0.35;
  float rope = fbm2(vec2(u * 7.5, fall * 1.3 - t * 2.4));
  float fine = vnoise2(vec2(u * 46.0, fall * 7.0 - t * 6.5));
  float aer = smoothstep(0.08, 0.7, s);
  float white = smoothstep(0.42, 0.72, rope + fine * 0.22 + aer * 0.15);
  float alpha = mix(0.5 + 0.35 * white, 0.3 + 0.7 * white, aer);
  float ragged = 0.72 + 0.22 * vnoise2(vec2(s * 5.0 - t * 1.6, u * 2.0 + 3.0)) + 0.08 * s;
  alpha *= 1.0 - smoothstep(ragged, 1.0, abs(u));
  alpha *= smoothstep(0.0, 0.03, s);
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 n = normalize(vNormal);
  if (dot(n, v) < 0.0) n = -n;
  vec3 l = uSunDir;
  float sh = shadowFast(vWorld + l * 0.05, 0.03, 2.0);
  vec3 lamp = localLight(vWorld, n, 0.3);
  vec3 lit = uSunColor * sh * (0.4 * saturate(dot(n, l)) + 0.7 * pow(saturate(dot(-v, l)), 3.0) + 0.15) + ambientLight(n) * 1.05 + lamp * 0.5;
  vec3 glassy = ambientLight(reflect(-v, n)) * 0.45 + uSunColor * sh * ggxSpec(n, v, l, 0.07) * 1.5;
  vec3 c = mix(glassy, lit * 0.88, max(aer * 0.75, white * 0.9));
  c = applyFog(c, vWorld);
  gl_FragColor = vec4(c * alpha, alpha);
}
`;

const MIST_VERT = COMMON + /* glsl */ `
attribute vec4 iMist; // offset x, z, phase, size
uniform vec3 uOrigin;
uniform vec2 uDrift;
varying vec2 vUv;
varying float vFade;
varying vec3 vWorld;
void main() {
  float life = fract(uTime * 0.11 + iMist.z);
  vec3 c = uOrigin + vec3(iMist.x, 0.05 + life * 0.85, iMist.y) + vec3(uDrift.x, 0.0, uDrift.y) * life * 0.8;
  float size = iMist.w * (0.45 + life * 1.1);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = c + (right * position.x + up * position.y) * size;
  vUv = position.xy;
  vFade = sin(life * 3.14159) * (1.0 - life * 0.5);
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const MIST_FRAG = COMMON + WIND + ATMOS + SHADOW + /* glsl */ `
varying vec2 vUv;
varying float vFade;
varying vec3 vWorld;
void main() {
  float r = length(vUv);
  float n = fbm2(vUv * 2.2 + vWorld.xz * 0.7 + uTime * 0.05);
  float a = smoothstep(1.0, 0.2, r) * smoothstep(0.25, 0.75, n) * vFade * 0.16;
  if (a < 0.002) discard;
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 c = ambientLight(vec3(0.0, 1.0, 0.0)) * 1.1 + uSunColor * (0.25 + 1.2 * pow(saturate(dot(-v, uSunDir)), 4.0));
  c = applyFog(c, vWorld);
  gl_FragColor = vec4(c * a, a);
}
`;

const premultiplied = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
};

// Water ribbon over a run of course samples.
function ribbon(samples, offset, foamAt) {
  const A = 13;
  const pos = [], flow = [], coord = [], depth = [], index = [];
  samples.forEach((c, i) => {
    for (let j = 0; j < A; j++) {
      const a = (j / (A - 1)) * 2.2 - 1.1;
      const x = c.x - c.tz * a * c.hw, z = c.z + c.tx * a * c.hw;
      pos.push(x, c.wl - offset, z);
      flow.push(c.tx, c.tz, c.speed * (1 - 0.45 * Math.min(1, a * a)), foamAt(x, z, c, Math.abs(a)));
      coord.push(a * c.hw, c.s, Math.abs(a));
      depth.push(streamDepth(Math.min(1, Math.abs(a)) * c.hw, c.hw));
    }
    if (i > 0) {
      const b0 = (i - 1) * A, b1 = i * A;
      for (let j = 0; j < A - 1; j++) index.push(b0 + j, b0 + j + 1, b1 + j, b0 + j + 1, b1 + j + 1, b1 + j);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(flow), 4));
  geo.setAttribute('aCoord', new THREE.BufferAttribute(new Float32Array(coord), 3));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(depth), 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

function mergeGeometries(list) {
  const out = new THREE.BufferGeometry();
  const names = Object.keys(list[0].attributes);
  for (const name of names) {
    const size = list[0].getAttribute(name).itemSize;
    const total = list.reduce((a, g) => a + g.getAttribute(name).array.length, 0);
    const arr = new Float32Array(total);
    let o = 0;
    for (const g of list) { arr.set(g.getAttribute(name).array, o); o += g.getAttribute(name).array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = [];
  let base = 0;
  for (const g of list) {
    for (const i of g.index.array) idx.push(i + base);
    base += g.getAttribute('position').count;
  }
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

export function createStream({ waterLevel, wet = [], petals = 1200 }) {
  const offset = WATER_Y - waterLevel;
  const F = fallsFrame(offset);
  const plunge = plungePoint(offset);

  // ---- Water surface -------------------------------------------------------------
  const foamAt = (x, z, c, edge) => {
    let f = Math.min(1, Math.max(0, (c.slope - 0.03) / 0.09)) * 0.5 * (1 - 0.5 * edge);
    const dp = Math.hypot(x - plunge[0], z - plunge[2]);
    f += 1.3 * Math.exp(-dp / 0.5);
    for (const [rx, rz, rr] of wet) {
      const dx = x - rx, dz = z - rz;
      const along = dx * c.tx + dz * c.tz, across = -dx * c.tz + dz * c.tx;
      const ring = Math.exp(-Math.max(0, Math.hypot(dx, dz) - rr) / 0.07);
      const wake = along > 0 ? Math.exp(-along / 0.8) * Math.exp(-Math.pow(Math.max(0, Math.abs(across) - rr * 0.6) / 0.12, 2)) : 0;
      f += ring * 0.9 + wake * 0.6;
    }
    f += Math.max(0, edge - 0.82) * 0.8;
    return Math.min(1, f);
  };
  const main = [];
  for (let i = 0; i < C.s.length; i++) {
    const c = courseAt(C.s[i]);
    c.s = C.s[i];
    main.push(c);
  }
  // Round off the head of the pool, back toward the falls.
  const head = [];
  const c0 = courseAt(0);
  for (let k = 8; k >= 1; k--) {
    const back = (k / 8) * c0.hw * 0.98;
    const w = Math.sqrt(Math.max(0.02, 1 - (back / (c0.hw * 1.02)) ** 2));
    head.push({ ...c0, x: c0.x - c0.tx * back, z: c0.z - c0.tz * back, hw: c0.hw * w, s: -back });
  }
  // The feed channel above the lip, running to the edge.
  const feed = [];
  for (let k = 0; k <= 8; k++) {
    const back = 1.3 * (1 - k / 8);
    feed.push({ x: F.lip[0] - F.fx * back, z: F.lip[2] - F.fz * back, hw: FALLS.width * 0.5, wl: FALLS.lip[1] - 0.04, tx: F.fx, tz: F.fz, speed: 0.55 + k * 0.03, slope: 0.0, s: -back - 5 });
  }
  const water = mergeGeometries([ribbon([...head, ...main], offset, foamAt), ribbon(feed, offset, (x, z, c, edge) => Math.max(0, edge - 0.7) * 0.6 + (c.speed - 0.55) * 2.0)]);
  const waterMat = new THREE.ShaderMaterial({
    uniforms: lightingUniforms({
      uReflection: { value: null },
      uTexMatrix: { value: new THREE.Matrix4() },
      uHasReflection: { value: 0 },
      uPlunge: { value: new THREE.Vector3(plunge[0], plunge[2], 1) },
      uPondLevel: { value: waterLevel },
    }),
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    ...premultiplied,
  });
  const waterMesh = new THREE.Mesh(water, waterMat);
  waterMesh.renderOrder = 5;
  waterMesh.frustumCulled = false;

  // ---- The falling sheet ----------------------------------------------------------
  const rows = 28, cols = 14;
  const H = F.lip[1] - F.pool;
  const tEnd = Math.sqrt((2 * (H + 0.05)) / G);
  const vx = 0.55;
  const fpos = [], fnrm = [], fsheet = [], fidx = [];
  const sheetAt = (u, s) => {
    const tt = s * tEnd;
    const w = FALLS.width * 0.5 * (1 + 0.3 * s);
    const fwd = 0.06 + vx * tt + 0.035 * (1 - u * u);
    const y = F.lip[1] - 0.5 * G * tt * tt;
    return F.at(u * w, fwd, y);
  };
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const u = (i / cols) * 2 - 1, s = j / rows;
      const p = sheetAt(u, s);
      const pu = sheetAt(u + 0.01, s), ps = sheetAt(u, Math.min(1, s + 0.01));
      const du = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]];
      const ds = [ps[0] - p[0], ps[1] - p[1] - (s >= 1 ? 0.01 : 0), ps[2] - p[2]];
      const n = [du[1] * ds[2] - du[2] * ds[1], du[2] * ds[0] - du[0] * ds[2], du[0] * ds[1] - du[1] * ds[0]];
      const nl = Math.hypot(...n) || 1;
      fpos.push(...p);
      fnrm.push(n[0] / nl, n[1] / nl, n[2] / nl);
      fsheet.push(u, s);
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      fidx.push(a, c, b, b, c, d);
    }
  const fallGeo = new THREE.BufferGeometry();
  fallGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fpos), 3));
  fallGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(fnrm), 3));
  fallGeo.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(fsheet), 2));
  fallGeo.setIndex(fidx);
  fallGeo.computeBoundingSphere();
  const fallMat = new THREE.ShaderMaterial({ uniforms: lightingUniforms(), vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, side: THREE.DoubleSide, ...premultiplied });
  const fallMesh = new THREE.Mesh(fallGeo, fallMat);
  fallMesh.renderOrder = 6;
  fallMesh.frustumCulled = false;

  // ---- Mist off the plunge pool ---------------------------------------------------
  const mistCount = 22;
  const rng = new RNG(31);
  const mistGeo = new THREE.InstancedBufferGeometry();
  mistGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  mistGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const im = new Float32Array(mistCount * 4);
  for (let i = 0; i < mistCount; i++) {
    const a = rng.range(0, 6.28), r = Math.sqrt(rng.next()) * 0.55;
    im.set([Math.cos(a) * r, Math.sin(a) * r, i / mistCount + rng.sym(0.02), rng.range(0.35, 0.6)], i * 4);
  }
  mistGeo.setAttribute('iMist', new THREE.InstancedBufferAttribute(im, 4));
  mistGeo.instanceCount = mistCount;
  const mistMat = new THREE.ShaderMaterial({
    uniforms: lightingUniforms({ uOrigin: { value: new THREE.Vector3(plunge[0], F.pool, plunge[2]) }, uDrift: { value: new THREE.Vector2(F.fx * 0.5, F.fz * 0.5) } }),
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    ...premultiplied,
  });
  const mist = new THREE.Mesh(mistGeo, mistMat);
  mist.renderOrder = 7;
  mist.frustumCulled = false;

  const rafts = new StreamPetals({ capacity: petals, offset });
  const group = new THREE.Group();
  group.add(waterMesh, fallMesh, mist, rafts.mesh);

  return {
    group,
    water: waterMesh,
    material: waterMat,
    falls: fallMesh,
    mist,
    rafts,
    plunge,
    update: (dt, t) => rafts.update(dt, t),
  };
}

// ---------------------------------------------------------------------------
// Hanaikada: petals riding the current in loose rafts. Most fall onto the
// water where the stream passes under the crown; they drift downstream at
// the local speed (faster mid-stream), wander across, turn slowly, and pass
// out into the pond.
class StreamPetals {
  constructor({ capacity, offset, seed = 404 }) {
    this.capacity = capacity;
    this.offset = offset;
    this.rng = new RNG(seed);
    this.geometry = buildGeometry(petalGrid(3, 3), capacity, true);
    this.P = this.geometry.getAttribute('iPos').array;
    this.Q = this.geometry.getAttribute('iQuat').array;
    this.S = this.geometry.getAttribute('iParams').array;
    this.s = new Float32Array(capacity);
    this.a = new Float32Array(capacity);
    this.k = new Float32Array(capacity);
    this.yaw = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.phase = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.flip = new Uint8Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.next = 0;
    this.materials = makeMaterials(0);
    this.mesh = new THREE.Mesh(this.geometry, this.materials.color);
    this.mesh.frustumCulled = false;
    this.cs = {};
    // Start with the stream already carrying rafts.
    for (let n = 0; n < capacity * 0.75;) {
      const sz = this.raftSize();
      this.raft(this.spawnArc(true), this.rng.sym(0.6), sz);
      n += sz;
    }
    this.update(0, 0);
  }

  raftSize() {
    return this.rng.chance(0.25) ? 1 + this.rng.int(0, 3) : this.rng.int(14, 60);
  }

  // Where new petals land: mostly beneath the crown, a few anywhere.
  spawnArc(anywhere = false) {
    const r = this.rng;
    if (anywhere || r.chance(0.12)) return r.range(0.3, C.length - 1.5);
    return r.range(C.length * 0.5, C.length - 2.0);
  }

  slot() {
    for (let k = 0; k < this.capacity; k++) {
      const i = (this.next + k) % this.capacity;
      if (!this.alive[i]) { this.next = i + 1; return i; }
    }
    const i = this.next % this.capacity;
    this.next = i + 1;
    return i;
  }

  place(i, s, a) {
    const r = this.rng;
    this.s[i] = s;
    this.a[i] = Math.max(-0.9, Math.min(0.9, a));
    this.k[i] = r.range(0.75, 1.15);
    this.yaw[i] = r.range(0, 6.28);
    this.spin[i] = r.sym(0.5);
    this.phase[i] = r.range(0, 6.28);
    this.size[i] = r.range(0.022, 0.03);
    this.flip[i] = r.chance(0.35) ? 1 : 0;
    this.alive[i] = 1;
    const S = this.S;
    S[i * 4] = this.size[i];
    S[i * 4 + 1] = r.range(0.08, 0.3);
    S[i * 4 + 2] = r.next();
    S[i * 4 + 3] = r.next() * 0.6;
  }

  raft(s, a, count) {
    const r = this.rng;
    for (let n = 0; n < count; n++) {
      const i = this.slot();
      this.place(i, s + r.gauss() * 0.12 * Math.sqrt(count / 10), a + r.gauss() * 0.12);
    }
  }

  // A petal from the air that came down on the stream.
  inject(x, z, s) {
    const c = courseAt(s, this.cs);
    const a = ((x - c.x) * -c.tz + (z - c.z) * c.tx) / c.hw;
    this.place(this.slot(), s, a);
  }

  update(dt, t) {
    const { P, Q, S, rng } = this;
    const c = this.cs;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) { S[i * 4] = 0; continue; }
      alive++;
      courseAt(this.s[i], c);
      const a = this.a[i];
      const v = c.speed * (1 - 0.55 * a * a) * this.k[i];
      this.s[i] += v * dt;
      // Wander across the current, kept off the banks.
      this.a[i] += (Math.sin(t * 0.6 + this.phase[i]) * 0.07 + Math.sin(t * 1.7 + this.phase[i] * 3.1) * 0.03) * dt / Math.max(0.4, c.hw);
      if (Math.abs(this.a[i]) > 0.8) this.a[i] *= 1 - dt * 0.8;
      this.yaw[i] += this.spin[i] * dt * (0.4 + v);
      const x = c.x - c.tz * this.a[i] * c.hw, z = c.z + c.tx * this.a[i] * c.hw;
      const bob = Math.sin(t * 2.2 + this.phase[i] + this.s[i] * 3.0) * 0.004 * (0.3 + c.slope * 8.0);
      P[i * 3] = x; P[i * 3 + 1] = c.wl - this.offset + 0.006 + bob; P[i * 3 + 2] = z;
      const tilt = 0.04 + c.slope * 1.2;
      quatFromYawTilt(Q, i * 4, this.yaw[i], Math.sin(t * 1.9 + this.phase[i]) * tilt, Math.cos(t * 1.4 + this.phase[i]) * tilt, this.flip[i]);
      // Out into the pond: shrink away.
      const end = C.length - this.s[i];
      S[i * 4] = this.size[i] * Math.min(1, Math.max(0, end / 1.2));
      if (end < 0.05) this.alive[i] = 0;
    }
    // Keep the stream supplied with new rafts.
    const want = this.capacity * 0.72;
    if (alive < want && rng.chance(Math.min(1, dt * 1.5))) this.raft(this.spawnArc(), rng.sym(0.6), this.raftSize());
    for (const name of ['iPos', 'iQuat', 'iParams']) this.geometry.getAttribute(name).needsUpdate = true;
  }
}
