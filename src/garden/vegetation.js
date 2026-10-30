import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { Noise } from '../core/noise.js';
import * as V from '../core/vec.js';
import { MeshBuilder, mat4Compose } from '../core/geom.js';
import { COMMON, WIND, ATMOS, SHADOW, CANOPY } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';
import { generateSkeleton } from '../tree/skeleton.js';
import { buildBarkMesh } from '../tree/barkMesh.js';
import { createBarkGeometry } from '../tree/barkMaterial.js';
import { MAPLE, PINE } from '../tree/species.js';
import { pondSDF, gravelSDF, ISLAND } from './layout.js';

// The garden's other plants, all drawn with one instanced foliage card whose
// outline is cut per kind from a signed distance field:
//   0 azalea leaf whorl   1 azalea flower   2 maple leaf   3 pine needle tuft
//   4 cedar spray
// Leaves follow the same wind as the branches they grow on.

export const LEAF = { AZALEA: 0, AZALEA_FLOWER: 1, MAPLE: 2, PINE: 3, CEDAR: 4 };

const VERT = COMMON + WIND + ATMOS + CANOPY + /* glsl */ `
attribute vec3 iPos;
attribute vec4 iQuat;
attribute vec4 iData;  // scale, kind, colour variation, flutter
attribute vec4 iWind;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vData;
varying vec2 vCanopy;
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  float s = iData.x;
  vec2 uv = position.xy;
  // Cards bend slightly so leaves are not dead flat.
  vec3 local = vec3(uv.x, -0.12 * dot(uv, uv), uv.y) * s;
  vec3 n = normalize(vec3(uv.x * 0.24, 1.0, uv.y * 0.24));
  vec3 p = iPos + qrot(iQuat, local);
  vec3 wn = qrot(iQuat, n);
  float ph = hash12(iPos.xz * 13.1);
  float g = gustField(iPos.xz, uTime) * (0.5 + uGust) * uWindStrength;
  vec3 flut = vec3(sin(uTime * (3.1 + ph * 2.0) + ph * TAU), sin(uTime * 4.3 + ph * 11.0) * 0.6, cos(uTime * (2.7 + ph) + ph * 7.0)) * iData.w * (0.008 + 0.012 * g);
  p += treeWind(iPos, iWind) + flut;
  vWorld = p;
  vNormal = wn;
  vUv = uv;
  vData = iData.yzw;
  vCanopy = canopyLight(iPos);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = COMMON + ATMOS + SHADOW + /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vData;
varying vec2 vCanopy;

float leafEllipse(vec2 p, float w) {
  // Pointed ellipse along +y from the origin.
  vec2 q = vec2(p.x / w, p.y - 0.5);
  return (length(vec2(q.x, q.y * 1.0)) - 0.5) * w * mix(1.0, 0.6, smoothstep(0.2, 0.5, abs(q.y)));
}

float aa(float d) { return saturate(0.5 - d / max(fwidth(d), 1e-5)); }

void main() {
  int kind = int(vData.x + 0.5);
  float var = vData.y;
  vec2 p = vUv;
  float r = length(p);
  float an = atan(p.y, p.x);
  float d = 1.0;
  vec3 albedo = vec3(0.1);
  float trans = 0.3;
  float glossy = 0.4;
  if (kind == 0) {
    // Whorl of small glossy azalea leaves.
    float k = 6.0;
    float sector = TAU / k;
    float a = mod(an + var * 3.0, sector) - sector * 0.5;
    vec2 lp = vec2(sin(a), cos(a)) * r;
    d = leafEllipse(lp * 1.2, 0.36);
    albedo = mix(vec3(0.02, 0.05, 0.015), vec3(0.05, 0.1, 0.025), var) * (0.8 + 0.4 * smoothstep(0.0, 0.8, r));
    glossy = 0.9;
  } else if (kind == 1) {
    // Azalea flower: five broad lobes, darker spotted throat.
    float lobe = 0.82 + 0.18 * cos(an * 5.0);
    d = r - 0.9 * lobe;
    albedo = mix(vec3(0.75, 0.05, 0.25), vec3(0.85, 0.2, 0.42), var);
    albedo = mix(vec3(0.55, 0.02, 0.15), albedo, smoothstep(0.1, 0.35, r));
    trans = 0.8;
    glossy = 0.2;
  } else if (kind == 2) {
    // Palmate maple leaf: seven pointed lobes, serrated.
    float lobes = 7.0;
    float a = an - 1.5708;
    float wave = 0.5 + 0.5 * cos(a * lobes);
    float back = smoothstep(0.55, 1.0, abs(a) / 3.14159);
    float rr = mix(0.32, 0.98, pow(wave, 1.8)) * (1.0 - back * 0.65);
    rr *= 1.0 + 0.04 * sin(an * 70.0);
    d = (r - rr) * 0.6;
    d = min(d, max(abs(p.x) - 0.02, p.y + 0.0));
    float vein = smoothstep(0.03, 0.0, abs(sin(a * lobes * 0.5)) * r) * step(r, 0.9);
    albedo = mix(vec3(0.5, 0.035, 0.03), vec3(0.62, 0.12, 0.04), var);
    albedo = mix(albedo, albedo * 0.7, vein * 0.5);
    trans = 1.0;
    glossy = 0.3;
  } else if (kind == 3 || kind == 4) {
    // Needle tuft: fine radiating needles.
    float k = kind == 3 ? 26.0 : 40.0;
    float a = an * k / TAU;
    float id = floor(a);
    float len = 0.75 + 0.25 * hash11(id + var * 50.0);
    float lat = abs(fract(a) - 0.5) * (TAU / k) * r;
    d = max(lat - 0.012 - 0.01 * (1.0 - r), r - len);
    d = min(d, r - 0.12);
    albedo = kind == 3 ? mix(vec3(0.02, 0.045, 0.02), vec3(0.04, 0.075, 0.03), var) : mix(vec3(0.02, 0.04, 0.025), vec3(0.04, 0.06, 0.035), var);
    albedo *= 0.75 + 0.5 * r;
    trans = 0.25;
    glossy = 0.5;
  }
  float alpha = aa(d);
#ifdef DEPTH_PASS
  if (alpha < 0.5) discard;
  gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
#else
  if (alpha < 0.01) discard;
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 n = normalize(vNormal);
  if (dot(n, v) < 0.0) n = -n;
  vec3 l = uSunDir;
  float ndl = dot(n, l);
  float sh = shadowFast(vWorld + l * 0.03, 0.02, 1.5);
  float fwd = pow(saturate(dot(-v, l)), 4.0);
  vec3 tcol = albedo * albedo * 4.0;
  vec3 sun = uSunColor * sh * (albedo * saturate(ndl) * 0.9 + tcol * trans * (saturate(-ndl) * 0.5 + fwd * 0.6));
  vec3 amb = ambientLight(n) * albedo * (0.3 + 0.7 * vCanopy.x);
  vec3 lamp = localLight(vWorld, n, 0.3) * albedo;
  vec3 col = sun + amb + lamp + uSunColor * sh * ggxSpec(n, v, l, mix(0.7, 0.3, glossy)) * glossy * 0.5;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, alpha);
#endif
}
`;

class FoliageSet {
  constructor() {
    this.pos = [];
    this.quat = [];
    this.data = [];
    this.wind = [];
  }

  add(p, normal, scale, kind, variation, flutter, wind = [0, 0, 0, 0], spin = 0) {
    // Orient the card's +Y to the normal, with a spin about it.
    const up = [0, 1, 0];
    const n = V.normalize([0, 0, 0], normal);
    const d = V.dot(up, n);
    let q;
    if (d < -0.9999) q = [1, 0, 0, 0];
    else {
      const c = V.cross([0, 0, 0], up, n);
      q = [c[0], c[1], c[2], 1 + d];
      const l = Math.hypot(...q);
      q = q.map((v) => v / l);
    }
    const hs = Math.sin(spin / 2), hc = Math.cos(spin / 2);
    // q * spin(Y)
    const qs = [q[0] * hc - q[2] * hs, q[1] * hc + q[3] * hs, q[2] * hc + q[0] * hs, q[3] * hc - q[1] * hs];
    this.pos.push(p[0], p[1], p[2]);
    this.quat.push(...qs);
    this.data.push(scale, kind, variation, flutter);
    this.wind.push(...wind);
  }

  get count() {
    return this.pos.length / 3;
  }

  build() {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(this.pos), 3));
    geo.setAttribute('iQuat', new THREE.InstancedBufferAttribute(new Float32Array(this.quat), 4));
    geo.setAttribute('iData', new THREE.InstancedBufferAttribute(new Float32Array(this.data), 4));
    geo.setAttribute('iWind', new THREE.InstancedBufferAttribute(new Float32Array(this.wind), 4));
    geo.instanceCount = this.count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80);
    return geo;
  }
}

// ---------------------------------------------------------------------------
// Karikomi: azaleas sheared into soft mounds. A dark inner core keeps the
// mound solid; leaf whorls (and, on some, flowers) clothe its surface.
const MOUNDS = [
  [-4.6, -0.9, 1.0, 0.62, false], [-5.9, -1.9, 0.75, 0.5, true], [-13.4, 0.9, 1.15, 0.7, false],
  [-14.6, 2.3, 0.8, 0.55, true], [3.3, 10.4, 0.85, 0.55, true], [4.4, 9.5, 0.62, 0.45, false],
  [-5.8, 17.2, 0.95, 0.6, false], [6.9, 11.6, 0.7, 0.48, true], [-18.6, 9.4, 1.25, 0.8, false],
  [-17.4, 11.0, 0.8, 0.55, true], [11.6, -9.6, 1.05, 0.62, false], [4.6, -11.9, 0.9, 0.55, true],
  [13.7, 3.6, 1.0, 0.6, false], [-1.4, -6.6, 0.8, 0.52, false], [9.4, 13.8, 0.9, 0.55, false],
];

function buildMounds(fs, mb, groundAt) {
  const rng = new RNG(4321);
  const noise = new Noise(99);
  for (const [cx, cz, rad, hgt, blooming] of MOUNDS) {
    if (pondSDF(cx, cz) < rad * 0.6 || gravelSDF(cx, cz) < rad * 0.5) continue;
    const g = groundAt(cx, cz);
    const sx = rad * rng.range(1.0, 1.3), sz = rad * rng.range(0.85, 1.05), yaw = rng.range(0, 6.28);
    const shape = (dir) => 1 + 0.08 * noise.noise3(dir[0] * 2 + cx, dir[1] * 2, dir[2] * 2 + cz);
    // Core.
    const st = mb.rock({ seed: rng.int(1, 1e5), size: [sx * 0.92, hgt * 0.92, sz * 0.92], detail: 2, mat: 12, faceting: 0, cut: -0.2 });
    mb.transform(st, mat4Compose([cx, g - 0.05, cz], yaw));
    const area = Math.PI * 2 * sx * sz * 0.9;
    const count = Math.round(area * (blooming ? 420 : 300));
    for (let i = 0; i < count; i++) {
      // Points on the upper ellipsoid surface.
      const u = rng.next(), a = rng.range(0, Math.PI * 2);
      const y = Math.pow(u, 0.7);
      const rr = Math.sqrt(1 - y * y);
      const dir = [Math.cos(a) * rr, y, Math.sin(a) * rr];
      const k = shape(dir);
      const ca = Math.cos(yaw), sa = Math.sin(yaw);
      const lx = dir[0] * sx * k, lz = dir[2] * sz * k;
      const px = cx + lx * ca - lz * sa, pz = cz + lx * sa + lz * ca;
      const inset = rng.range(0, 0.06);
      const p = [px, g - 0.05 + dir[1] * hgt * k - inset, pz];
      const nrm = [dir[0] / sx, dir[1] / hgt, dir[2] / sz];
      const jitter = [nrm[0] + rng.sym(0.5), nrm[1] + rng.sym(0.3), nrm[2] + rng.sym(0.5)];
      const flower = blooming && rng.next() < 0.7 && dir[1] > 0.05;
      fs.add(p, jitter, flower ? rng.range(0.028, 0.036) : rng.range(0.045, 0.065), flower ? LEAF.AZALEA_FLOWER : LEAF.AZALEA, rng.next(), 0.2, [0, 0, 0, 0], rng.range(0, 6.28));
    }
  }
}

// Leaves along the fine twigs of a generated tree.
function leafTree(fs, skel, kind, opts) {
  const rng = new RNG(opts.seed || 1);
  const P = [0, 0, 0], T = [0, 0, 0], side = [0, 0, 0];
  for (const b of skel.branches) {
    if (b.kind !== 'wood' || b.depth < opts.minDepth) continue;
    const L = b.length;
    for (let s = L * 0.15; s < L; s += opts.gap * rng.range(0.7, 1.3)) {
      b.pointAt(s, P);
      b.tangentAt(s, T);
      const wind = [b.sampleArray(b.wA, s), b.sampleArray(b.wB, s), b.phaseA, b.phaseB];
      const n = rng.int(opts.perNode[0], opts.perNode[1]);
      for (let k = 0; k < n; k++) {
        V.perpendicular(side, T);
        V.rotateAxis(side, side, T, rng.range(0, 6.28));
        const off = opts.stalk * rng.range(0.6, 1.2);
        const p = [P[0] + side[0] * off, P[1] + side[1] * off + opts.lift, P[2] + side[2] * off];
        const nrm = [side[0] * 0.4 + rng.sym(0.3), 1, side[2] * 0.4 + rng.sym(0.3)];
        fs.add(p, nrm, rng.range(opts.size[0], opts.size[1]), kind, rng.next(), opts.flutter, wind, rng.range(0, 6.28));
      }
    }
  }
}

// Cloud-pruned pads of needles at the ends of a pine's limbs.
function pinePads(fs, skel, rng, scale = 1) {
  for (const b of skel.branches) {
    if (b.kind !== 'wood' || b.depth < 1 || b.children.some((c) => c.kind === 'wood' && c.depth > b.depth)) continue;
    const L = b.length;
    const tip = b.pointAt(L);
    const wind = [b.wA[b.count - 1], b.wB[b.count - 1], b.phaseA, b.phaseB];
    const rx = rng.range(0.45, 0.75) * scale, ry = rng.range(0.16, 0.24) * scale;
    const count = Math.round(rx * rx * 900);
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, 6.28), u = Math.sqrt(rng.next());
      const y = Math.sqrt(Math.max(0, 1 - u * u)) * (rng.next() < 0.8 ? 1 : -0.4);
      const p = [tip[0] + Math.cos(a) * u * rx, tip[1] + y * ry + 0.05, tip[2] + Math.sin(a) * u * rx];
      const nrm = [Math.cos(a) * u * 0.6 + rng.sym(0.3), 1, Math.sin(a) * u * 0.6 + rng.sym(0.3)];
      fs.add(p, nrm, rng.range(0.07, 0.1) * scale, LEAF.PINE, rng.next(), 0.15, wind, rng.range(0, 6.28));
    }
  }
}

// A dark band of evergreen woodland closing the back of the garden: short
// trunks under broad, clumped crowns of dense foliage.
function cedars(fs, mb, groundAt) {
  const rng = new RNG(808);
  for (let i = 0; i < 20; i++) {
    const a = 0.85 + (i / 19) * 3.3 + rng.sym(0.05);
    const r = rng.range(31, 38);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const g = groundAt(x, z);
    const H = rng.range(6, 11), W = rng.range(2.4, 4.0);
    mb.sweep([[x, g - 0.3, z], [x + rng.sym(0.3), g + H * 0.55, z + rng.sym(0.3)]], (t) => V.mix(0.22, 0.1, t), 8, { mat: 2, capEnd: true });
    const clumps = rng.int(7, 11);
    for (let c = 0; c < clumps; c++) {
      const cx = x + rng.sym(W * 0.6), cz = z + rng.sym(W * 0.6);
      const cy = g + H * rng.range(0.45, 0.95);
      const cr = rng.range(1.2, 2.0);
      const n = Math.round(cr * cr * 70);
      for (let k = 0; k < n; k++) {
        const b = rng.range(0, 6.28), u = Math.pow(rng.next(), 0.35);
        const yy = rng.range(-0.55, 0.8);
        const p = [cx + Math.cos(b) * u * cr, cy + yy * cr * 0.8, cz + Math.sin(b) * u * cr];
        fs.add(p, [Math.cos(b) * 0.6, 0.8, Math.sin(b) * 0.6], rng.range(0.55, 0.85), LEAF.CEDAR, rng.next(), 0.0, [0, 0, 0, 0], rng.range(0, 6.28));
      }
    }
  }
}

export function createVegetation({ groundAt, waterLevel, seed = 7 }) {
  const fs = new FoliageSet();
  const coreBuilder = new MeshBuilder();
  const barks = [];

  buildMounds(fs, coreBuilder, groundAt);

  // Red maples: one across the pond, one by the gravel court.
  for (const [x, z, s] of [[-7.4, 15.4, 1], [12.9, -0.6, 2]]) {
    const skel = generateSkeleton(seed + s * 17, { species: MAPLE, groundAt, origin: [x, groundAt(x, z), z] });
    barks.push(buildBarkMesh(skel, { groundAt, ancient: false, hiRes: false }));
    leafTree(fs, skel, LEAF.MAPLE, { seed: s * 3, minDepth: 2, gap: 0.045, perNode: [3, 6], stalk: 0.05, lift: 0.015, size: [0.042, 0.058], flutter: 1.0 });
  }

  // The black pine leaning out over the main pond, and a small one on the island.
  const rng = new RNG(seed * 5 + 1);
  {
    const x = -15.4, z = 4.4;
    const skel = generateSkeleton(seed + 3, { species: PINE, groundAt, origin: [x, groundAt(x, z), z], leanAz: 0.35 });
    barks.push(buildBarkMesh(skel, { groundAt, ancient: false, hiRes: false }));
    pinePads(fs, skel, rng, 1);
  }
  {
    const [x, z] = ISLAND;
    const skel = generateSkeleton(seed + 9, { species: { ...PINE, trunk: { length: 2.0, lean: 0.4 }, crown: { c: [0, 1.8, 0], rx: 1.8, rz: 1.8, ryUp: 1.2, ryDown: 1.5, lump: 0.1 }, limbs: { ...PINE.limbs, attach: [0.3, 1.3], length: () => 1.1 }, trunkMin: 0.07, trunkTop: 0.06 }, groundAt, origin: [x, groundAt(x, z), z], leanAz: 2.6 });
    barks.push(buildBarkMesh(skel, { groundAt, ancient: false, hiRes: false }));
    pinePads(fs, skel, rng, 0.6);
  }

  cedars(fs, coreBuilder, groundAt);

  const uniforms = lightingUniforms();
  const color = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, alphaToCoverage: true });
  const depth = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, defines: { DEPTH_PASS: 1 } });
  const geometry = fs.build();
  const mesh = new THREE.Mesh(geometry, color);
  mesh.frustumCulled = false;

  // Merge the tree barks into one geometry.
  const merged = mergeBark(barks);
  void waterLevel;
  return { mesh, geometry, materials: { color, depth }, coreBuffers: coreBuilder.toBuffers(), barkData: merged, count: fs.count };
}

function mergeBark(list) {
  const keys = ['position', 'normal', 'cyl', 'bark', 'wind', 'feature'];
  const out = {};
  for (const k of keys) {
    const total = list.reduce((a, m) => a + m[k].length, 0);
    out[k] = new Float32Array(total);
    let o = 0;
    for (const m of list) { out[k].set(m[k], o); o += m[k].length; }
  }
  const totalIdx = list.reduce((a, m) => a + m.index.length, 0);
  const idx = new Uint32Array(totalIdx);
  let o = 0, vb = 0;
  for (const m of list) {
    for (let i = 0; i < m.index.length; i++) idx[o + i] = m.index[i] + vb;
    o += m.index.length;
    vb += m.vertexCount;
  }
  out.index = idx;
  out.vertexCount = vb;
  out.triangleCount = totalIdx / 3;
  return out;
}

export { createBarkGeometry };
