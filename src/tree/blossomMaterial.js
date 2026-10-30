import * as THREE from 'three';
import { COMMON, WIND, ATMOS, SHADOW } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';

// The flower shader. The vertex stage sculpts each petal from a flat grid:
// it rises off the receptacle, bends along its length and cups across its
// width, all driven by how open the flower is — so one mesh covers tight
// buds, half-open cups and flat, fully open blooms. The fragment stage cuts
// the notched petal outline from a signed distance field, paints the colour
// (crimson heart, pink body, near-white edge, fine veins) and lights the petal
// as a thin translucent sheet that glows when the low sun shines through it.

export const FLOWER_VERTEX = /* glsl */ `
attribute vec4 aPart;
attribute vec3 iPos;
attribute vec4 iQuat;
attribute vec4 iParams; // scale, open, tint, age
attribute vec4 iExtra;  // petal mask, phase, sky visibility, sun transmittance
attribute vec4 iWind;
attribute vec3 iAnchor;
uniform vec3 uViewPos;
uniform float uDetailDist;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying float vType;
varying vec4 vParams;
varying vec2 vLight;
varying float vMask;

vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec3 rotAxis(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

void main() {
  float type = aPart.x;
  float scale = iParams.x;
  float open = iParams.y;
  float phase = iExtra.y;
  vec3 local = vec3(0.0);
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  float collapse = 0.0;
  float shade = 1.0;
  // Near flowers are drawn by the detailed mesh, the rest by the light one.
  float camDist = length(iPos - uViewPos);
#if defined(DETAIL_MESH)
  if (camDist > uDetailDist) collapse = 1.0;
#elif !defined(DEPTH_PASS)
  if (camDist <= uDetailDist) collapse = 1.0;
#endif

  if (type < 0.5) {
    float idx = aPart.y;
    if (mod(floor(iExtra.x / exp2(idx) + 0.001), 2.0) > 0.5) collapse = 1.0;
    float jit = hash11(phase * 97.0 + idx * 7.1);
    shade = jit;
    float phi = idx * (TAU / 5.0) + (jit - 0.5) * 0.22;
    vec3 R = vec3(cos(phi), 0.0, sin(phi));
    vec3 Tn = vec3(-sin(phi), 0.0, cos(phi));
    float u = position.x, v = position.y;
    float o = smoothstep(0.0, 1.0, open);
    float a0 = mix(0.5, 0.28 + 0.14 * jit, o);
    float k = mix(-2.7, 0.32 + 0.2 * jit, o);
    float kk = abs(k) < 1e-3 ? 1e-3 : k;
    float L = mix(0.7, 1.0, o);
    float ang = a0 - kk * v;
    float radial = 0.085 + L * (sin(a0) - sin(ang)) / kk;
    float height = L * (cos(ang) - cos(a0)) / kk;
    float W = 0.5 * L;
    vec3 nProf = -sin(ang) * R + cos(ang) * vec3(0.0, 1.0, 0.0);
    float cup = mix(0.75, 0.2, o) * (0.4 + 0.6 * v);
    local = R * radial + vec3(0.0, height, 0.0) + Tn * (u * W) + nProf * (cup * u * u * W);
    local += nProf * 0.035 * sin(v * 4.5 + phase * 20.0 + idx * 2.0) * o * v;
    nrm = normalize(nProf - Tn * (2.0 * cup * u));
  } else if (type < 1.5) {
    if (open < 0.45) collapse = 1.0;
    local = vec3(position.x * 0.42, 0.19 + 0.05 * open, position.y * 0.42);
  } else if (type < 2.5) {
    if (open < 0.45) collapse = 1.0;
    float a = aPart.y * PI * 0.5 + phase * 3.0;
    vec3 d = vec3(cos(a), 0.0, sin(a));
    local = d * position.x * 0.42 + vec3(0.0, 0.02 + position.y * 0.22, 0.0);
    nrm = cross(d, vec3(0.0, 1.0, 0.0));
  } else if (type < 3.5) {
  } else if (type > 4.5) {
    // Flower card: a single quad that reaches as far as the petals do.
    float o = smoothstep(0.0, 1.0, open);
    float reach = mix(0.27, 1.13, o);
    local = vec3(position.x * reach, mix(0.16, 0.035, o), position.y * reach);
    shade = hash11(phase * 53.0);
  } else {
    float a = aPart.y * (TAU / 5.0) + TAU / 10.0;
    vec3 R = vec3(cos(a), 0.0, sin(a));
    vec3 Tn = vec3(-sin(a), 0.0, cos(a));
    float reflex = mix(0.35, -0.9, open);
    vec3 tip = normalize(R * cos(reflex) + vec3(0.0, sin(reflex), 0.0));
    local = R * 0.05 + Tn * position.x * 0.075 * (1.0 - position.y) + tip * position.y * 0.27 + vec3(0.0, -0.02, 0.0);
    nrm = normalize(cross(Tn, tip));
  }

  vec3 world = iPos + qrot(iQuat, local * scale);
  vec3 wn = qrot(iQuat, nrm);

  if (type > 2.5 && type < 3.5) {
    vec3 base = iPos + qrot(iQuat, vec3(0.0, -0.04, 0.0) * scale);
    vec3 A = iAnchor;
    float t = position.y;
    vec3 mid = mix(A, base, 0.5) + vec3(0.0, 0.3 * length(base - A), 0.0);
    vec3 c = mix(mix(A, mid, t), mix(mid, base, t), t);
    vec3 tg = normalize(mix(mid - A, base - mid, t) + 1e-5);
    vec3 toCam = normalize(uViewPos - c);
    vec3 sv = normalize(cross(tg, toCam) + 1e-5);
    world = c + sv * position.x * 0.00075 * mix(1.0, 1.5, t);
    wn = toCam;
  }

  // Flutter about the spur, then ride along with the twig.
  float g = gustField(iAnchor.xz, uTime) * (0.5 + uGust) * uWindStrength;
  vec3 axis = normalize(vec3(-uWindDir.y, 0.3, uWindDir.x));
  float fl = (0.07 + 0.12 * g) * sin(uTime * (2.1 + phase * 1.9) + phase * TAU) + 0.06 * g;
  world = iAnchor + rotAxis(world - iAnchor, axis, fl);
  wn = rotAxis(wn, axis, fl);
  world += treeWind(iAnchor, iWind);
  if (collapse > 0.5) world = iAnchor;

  vWorld = world;
  vNormal = wn;
  vUv = type > 4.5 ? position.xy * mix(0.27, 1.13, smoothstep(0.0, 1.0, open)) : position.xy;
  vType = type;
  vMask = iExtra.x;
  vParams = vec4(iParams.z, iParams.w, open, shade);
  vLight = iExtra.zw;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const PETAL_SHAPE = /* glsl */ `
// Signed distance to a sakura petal: slender claw, broad obovate blade,
// and the characteristic notch at the tip. p.x across, p.y base→tip.
float petalSDF(vec2 p) {
  float y = p.y;
  float wv = mix(0.15, 1.0, smoothstep(0.0, 0.52, y));
  vec2 q = vec2(p.x / wv, y - 0.58);
  q /= vec2(0.44, q.y < 0.0 ? 0.6 : 0.44);
  float body = (length(q) - 1.0) * 0.44 * mix(wv, 1.0, 0.5);
  vec2 nq = (p - vec2(0.0, 1.04)) / vec2(0.068, 0.135);
  float notch = (length(nq) - 1.0) * 0.068;
  return max(body, -notch);
}

vec3 petalAlbedo(vec2 p, float d, float tint, float age, float open, float shade) {
  float y = p.y;
  vec3 white = vec3(0.97, 0.9, 0.92);
  vec3 body = mix(vec3(0.95, 0.72, 0.79), vec3(0.92, 0.55, 0.68), tint);
  vec3 heart = mix(vec3(0.8, 0.24, 0.4), vec3(0.6, 0.08, 0.2), age);
  vec3 col = mix(body, white, smoothstep(0.3, 1.0, y) * (0.6 - tint * 0.3));
  col = mix(heart, col, smoothstep(0.02, 0.26 + age * 0.12, y));
  // Buds carry deeper colour on the outside.
  col = mix(mix(vec3(0.86, 0.32, 0.47), col, 0.3), col, smoothstep(0.15, 0.7, open));
  // Fine radiating veins.
  float a = atan(p.x, y + 0.22) * 30.0;
  float vf = 1.0 - smoothstep(0.4, 1.4, fwidth(a));
  float vein = pow(0.5 + 0.5 * cos(a + sin(y * 7.0) * 0.8), 8.0) * smoothstep(0.04, 0.3, y) * (1.0 - smoothstep(0.65, 1.0, y));
  col *= 1.0 - vein * 0.14 * vf;
  // Translucent, paler rim.
  col = mix(col, white, smoothstep(-0.035, 0.0, d) * 0.35);
  col *= 0.94 + 0.12 * shade;
  return col;
}
`;

const fragmentShader = COMMON + WIND + ATMOS + SHADOW + PETAL_SHAPE + /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying float vType;
varying vec4 vParams;
varying vec2 vLight;
varying float vMask;

float aaAlpha(float d) {
  float w = max(fwidth(d), 1e-5);
  return saturate(0.5 - d / w);
}

void main() {
  float type = vType;
  vec2 p = vec2(vUv.x * 0.5, vUv.y * 1.05);
  float d = 0.0;
  float alpha = 1.0;
  float cardR = 0.0, cardTh = 0.0;
  if (type < 0.5) {
    d = petalSDF(p);
    alpha = aaAlpha(d);
  } else if (type > 4.5) {
    // Whole flower drawn on one card: five notched petals around the heart.
    vec2 q = vUv;
    float o = smoothstep(0.0, 1.0, vParams.z);
    cardR = length(q);
    cardTh = atan(q.y, q.x);
    if (vParams.z < 0.3) {
      d = cardR - (0.22 + 0.03 * cos(cardTh * 5.0));
      p = vec2(0.0, cardR * 2.0);
    } else {
      float sector = TAU / 5.0;
      float k = floor(cardTh / sector + 0.5);
      float a = k * sector;
      vec2 dir = vec2(cos(a), sin(a));
      float along = dot(q, dir);
      float across = dot(q, vec2(-dir.y, dir.x));
      float Lp = mix(0.5, 1.0, o);
      p = vec2(across, (along - 0.085) / Lp * 1.05);
      d = petalSDF(p);
      float ki = mod(k + 5.0, 5.0);
      if (mod(floor(vMask / exp2(ki) + 0.001), 2.0) > 0.5) d = max(d, 0.02);
      d = min(d, cardR - 0.12);
    }
    alpha = aaAlpha(d);
  }
#ifdef DEPTH_PASS
  if (alpha < 0.5) discard;
  gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
#else
  vec3 albedo;
  float translucent = 0.0;
  if (type < 0.5) {
    albedo = petalAlbedo(p, d, vParams.x, vParams.y, vParams.z, vParams.w);
    translucent = 1.0;
  } else if (type < 1.5) {
    // Stamen ring seen from above: filaments and anthers around the pistil.
    vec2 q = vUv;
    float rr = length(q);
    float an = atan(q.y, q.x);
    float bins = 24.0;
    float fb = an / TAU * bins;
    float cell = floor(fb);
    float ra = 0.7 + 0.22 * hash11(cell * 3.7 + vParams.w * 11.0);
    float lat = (fract(fb) - 0.5) * (TAU / bins) * rr;
    float anther = length(vec2(lat, rr - ra)) - 0.075;
    float fil = max(abs(lat) - 0.016, max(0.15 - rr, rr - ra));
    float pist = rr - 0.11;
    float sd = min(min(anther, fil), pist);
    alpha = aaAlpha(sd);
    vec3 anth = mix(vec3(0.95, 0.68, 0.18), vec3(0.45, 0.16, 0.08), vParams.y);
    albedo = anther < 0.0 ? anth : (pist < 0.0 ? vec3(0.55, 0.62, 0.22) : mix(vec3(0.95, 0.82, 0.86), vec3(0.85, 0.3, 0.45), vParams.y * 0.6));
  } else if (type < 2.5) {
    // Stamen fan seen from the side.
    vec2 q = vec2(vUv.x, vUv.y);
    float sd = 1e3;
    float an = 1e3;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float x1 = -0.88 + fi * 0.35 + (hash11(fi + vParams.w * 13.0) - 0.5) * 0.12;
      float y1 = 0.78 + 0.18 * hash11(fi * 1.3 + vParams.w * 7.0);
      vec2 a = vec2(x1 * 0.18, 0.0), b = vec2(x1, y1);
      vec2 pa = q - a, ba = b - a;
      float h = saturate(dot(pa, ba) / dot(ba, ba));
      sd = min(sd, length(pa - ba * h) - 0.018);
      an = min(an, length(q - b) - 0.065);
    }
    alpha = aaAlpha(min(sd, an));
    vec3 anth = mix(vec3(0.95, 0.68, 0.18), vec3(0.45, 0.16, 0.08), vParams.y);
    albedo = an < 0.0 ? anth : vec3(0.95, 0.82, 0.86);
  } else if (type < 3.5) {
    albedo = mix(vec3(0.16, 0.2, 0.05), vec3(0.32, 0.08, 0.06), vUv.y);
  } else if (type < 4.5) {
    albedo = vec3(0.3, 0.06, 0.06);
  } else {
    translucent = 1.0;
    if (vParams.z < 0.3) {
      albedo = mix(vec3(0.8, 0.22, 0.4), vec3(0.95, 0.6, 0.7), smoothstep(0.05, 0.24, cardR) * 0.6 + vParams.z);
    } else {
      albedo = petalAlbedo(p, d, vParams.x, vParams.y, vParams.z, vParams.w);
      // Stamen ring: a crown of anthers that blurs to a warm tint with distance.
      float cell = cardTh / TAU * 24.0;
      float lat = (fract(cell) - 0.5) * (TAU / 24.0) * cardR;
      float rr = 0.3 + 0.05 * hash11(floor(cell) + vParams.w * 17.0);
      float dotm = 1.0 - smoothstep(0.035, 0.05, length(vec2(lat, cardR - rr)));
      float ring = smoothstep(0.16, 0.22, cardR) * (1.0 - smoothstep(0.34, 0.4, cardR));
      float blurW = smoothstep(0.015, 0.05, fwidth(cardR));
      vec3 anth = mix(vec3(0.95, 0.68, 0.18), vec3(0.5, 0.18, 0.08), vParams.y);
      albedo = mix(albedo, anth, mix(dotm, ring * 0.3, blurW) * smoothstep(0.5, 0.8, vParams.z));
    }
  }
  if (alpha < 0.01) discard;

  vec3 v = normalize(cameraPosition - vWorld);
  vec3 n = normalize(vNormal);
  if (dot(n, v) < 0.0) n = -n;
  vec3 l = uSunDir;
  float ndl = dot(n, l);
  float sh = shadowFast(vWorld + l * 0.02, 0.012, 1.6);
  float skyVis = vLight.x, sunT = vLight.y;
  float vis = sh * mix(1.0, sunT, 0.25);

  vec3 albedoT = albedo * albedo * vec3(1.0, 0.82, 0.88);
  float front = max(ndl, 0.0);
  float back = max(-ndl, 0.0) * translucent;
  float fwd = pow(saturate(dot(-v, l)), 5.0) * translucent;
  vec3 sun = uSunColor * vis * (albedo * front * 0.85 + albedoT * (back * 0.6 + fwd * 0.75));
  sun += uSunColor * vis * 0.05 * pow(1.0 - saturate(dot(n, v)), 4.0) * front * translucent;

  float ao = (type < 0.5 || type > 4.5) ? mix(0.55, 1.0, smoothstep(0.0, 0.45, p.y)) : 0.7;
  vec3 amb = ambientLight(n) * albedo * (0.22 + 0.78 * skyVis) * ao;
  // Light scattered between petals deep inside the crown.
  amb += uSunColor * albedoT * 0.06 * (0.35 + 0.65 * sunT) * (0.4 + 0.6 * skyVis) * translucent;
  vec3 col = applyFog(sun + amb, vWorld);
  gl_FragColor = vec4(col, alpha);
#endif
}
`;

export function createBlossomMaterials() {
  const uniforms = lightingUniforms({
    uViewPos: { value: new THREE.Vector3() },
    uDetailDist: { value: 5.5 },
  });
  const vertexShader = COMMON + WIND + FLOWER_VERTEX;
  const color = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
  });
  const detail = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
    defines: { DETAIL_MESH: 1 },
  });
  const depth = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    side: THREE.DoubleSide,
    defines: { DEPTH_PASS: 1 },
  });
  return { color, detail, depth, uniforms };
}

export const INSTANCED = [['iPos', 3], ['iQuat', 4], ['iParams', 4], ['iExtra', 4], ['iWind', 4], ['iAnchor', 3]];

// Instanced flower geometry. Pass `shareFrom` to reuse the per-instance
// buffers of another geometry (the shadow proxy shares the visible one's).
export function createBlossomGeometry(base, packed, shareFrom = null) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(base.position, 3));
  geo.setAttribute('aPart', new THREE.BufferAttribute(base.part, 4));
  geo.setIndex(new THREE.BufferAttribute(base.index, 1));
  for (const [name, size] of INSTANCED) {
    geo.setAttribute(name, shareFrom ? shareFrom.getAttribute(name) : new THREE.InstancedBufferAttribute(packed[name], size));
  }
  geo.instanceCount = packed.count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), 14);
  return geo;
}

// Keeps a small instance set of the flowers around the camera up to date so
// they can be drawn with the full-detail mesh (cupped petals, stamens,
// pedicels, sepals) while the rest of the crown uses the light mesh.
export class BlossomDetail {
  constructor(packed, base, capacity = 9000) {
    this.packed = packed;
    this.capacity = capacity;
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(base.position, 3));
    this.geometry.setAttribute('aPart', new THREE.BufferAttribute(base.part, 4));
    this.geometry.setIndex(new THREE.BufferAttribute(base.index, 1));
    for (const [name, size] of INSTANCED) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      attr.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, attr);
    }
    this.geometry.instanceCount = 0;
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), 14);
    // Spatial hash of flower positions (1 m cells).
    this.cells = new Map();
    const p = packed.iPos;
    for (let i = 0; i < packed.count; i++) {
      const k = this.key(Math.floor(p[i * 3]), Math.floor(p[i * 3 + 1]), Math.floor(p[i * 3 + 2]));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(i);
    }
    this.last = new THREE.Vector3(1e9, 0, 0);
    this.limit = packed.count;
  }

  key(x, y, z) {
    return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  }

  update(camPos, radius) {
    if (camPos.distanceToSquared(this.last) < 0.09) return;
    this.last.copy(camPos);
    const r = radius + 0.8;
    const r2 = r * r;
    const P = this.packed.iPos;
    const out = [];
    const x0 = Math.floor(camPos.x - r), x1 = Math.floor(camPos.x + r);
    const y0 = Math.floor(camPos.y - r), y1 = Math.floor(camPos.y + r);
    const z0 = Math.floor(camPos.z - r), z1 = Math.floor(camPos.z + r);
    for (let x = x0; x <= x1 && out.length < this.capacity; x++)
      for (let y = y0; y <= y1 && out.length < this.capacity; y++)
        for (let z = z0; z <= z1 && out.length < this.capacity; z++) {
          const list = this.cells.get(this.key(x, y, z));
          if (!list) continue;
          for (const i of list) {
            if (i >= this.limit) continue;
            const dx = P[i * 3] - camPos.x, dy = P[i * 3 + 1] - camPos.y, dz = P[i * 3 + 2] - camPos.z;
            if (dx * dx + dy * dy + dz * dz < r2) {
              out.push(i);
              if (out.length >= this.capacity) break;
            }
          }
        }
    for (const [name, size] of INSTANCED) {
      const attr = this.geometry.getAttribute(name);
      const src = this.packed[name];
      const dst = attr.array;
      for (let j = 0; j < out.length; j++) {
        const i = out[j];
        for (let c = 0; c < size; c++) dst[j * size + c] = src[i * size + c];
      }
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(1, out.length * size));
      attr.needsUpdate = true;
    }
    this.geometry.instanceCount = out.length;
  }
}
