import * as THREE from 'three';
import { COMMON, WIND, ATMOS, SHADOW, CANOPY } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';

// One surface shader for all the garden's made things, switched per vertex by
// material id. Every surface is painted procedurally: speckled granite with
// lichen and moss, mossy pond rocks wet at the waterline, vermilion lacquer
// worn through to black, silvered cedar, aged bamboo with nodes, twisted rice
// straw, washi paper that glows when backlit, and lantern light.

export const MAT = {
  GRANITE: 0, LACQUER: 1, WOOD: 2, BAMBOO: 3, STRAW: 4, PAPER: 5, GLOW: 6,
  BLACK: 7, BRONZE: 8, ROCK: 9, FIRE: 10, WATER: 11, FOLIAGE: 12, SUGI: 13, CULM: 14,
};

const vertexShader = COMMON + WIND + /* glsl */ `
attribute float aMat;
attribute vec2 aUv;
attribute vec4 aSway;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying float vMat;
varying vec3 vLocal;
vec3 rotAxis(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
void main() {
  vec3 p = position;
  vec3 n = normal;
  if (aSway.w > 0.0) {
    // Hanging paper and lanterns swing about their pivot.
    float ph = hash12(aSway.xz * 7.1);
    float g = gustField(aSway.xz, uTime) * (0.4 + uGust) * uWindStrength;
    vec3 axis = normalize(vec3(-uWindDir.y, 0.0, uWindDir.x));
    float a = aSway.w * (0.18 * sin(uTime * (1.4 + ph) + ph * TAU) + 0.35 * g + 0.08 * sin(uTime * 3.7 + ph * 9.0));
    p = aSway.xyz + rotAxis(p - aSway.xyz, axis, a);
    n = rotAxis(n, axis, a);
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vLocal = p;
  vNormal = normalize(mat3(modelMatrix) * n);
  vUv = aUv;
  vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = COMMON + ATMOS + SHADOW + CANOPY + /* glsl */ `
uniform float uWaterLevel;
uniform float uGlow;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying float vMat;
varying vec3 vLocal;

float band(float size, float footprint) { return 1.0 - smoothstep(size * 0.6, size * 2.5, footprint); }

void main() {
  int m = int(vMat + 0.5);
#ifdef DEPTH_PASS
  if (m == 6 || m == 10) discard;
  gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
#else
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  bool thin = (m == 5 || m == 6);
  if (thin && dot(n, v) < 0.0) n = -n;
  if (!thin && !gl_FrontFacing) n = -n;
  vec3 wp = vWorld;
  float foot = length(fwidth(wp));
  vec3 albedo = vec3(0.5);
  float rough = 0.8;
  float spec = 0.5;
  vec3 emit = vec3(0.0);
  float h = 0.0;
  float translucency = 0.0;
  float upward = saturate(n.y);

  if (m == 0 || m == 9) {
    // Stone. Granite for carved work, darker andesite for natural rocks.
    float speck = vnoise3(wp * 90.0) * band(0.004, foot);
    float mica = smoothstep(0.78, 0.9, vnoise3(wp * 140.0 + 3.0)) * band(0.003, foot);
    float big = fbm3(wp * 3.0);
    vec3 granite = mix(vec3(0.2, 0.19, 0.175), vec3(0.3, 0.29, 0.27), speck);
    granite = mix(granite, vec3(0.05, 0.05, 0.05), mica * 0.7);
    vec3 andesite = mix(vec3(0.07, 0.068, 0.064), vec3(0.13, 0.125, 0.115), big) * (0.85 + 0.3 * speck);
    albedo = m == 0 ? granite * (0.75 + 0.35 * big) : andesite;
    h = speck * 0.002 + big * 0.006;
    // Weathering: dark streaks running down, lichen rosettes, moss on top.
    float streak = smoothstep(0.55, 0.85, vnoise3(vec3(wp.x * 6.0, wp.y * 0.8, wp.z * 6.0)));
    albedo *= 1.0 - streak * 0.35 * (1.0 - upward);
    float lichen = smoothstep(0.62, 0.72, vnoise3(wp * 7.0)) * smoothstep(0.4, 0.6, vnoise3(wp * 23.0));
    albedo = mix(albedo, mix(vec3(0.3, 0.32, 0.24), vec3(0.42, 0.28, 0.1), step(0.85, hash13(floor(wp * 7.0)))), lichen * 0.6);
    float mossAmt = smoothstep(0.35, 0.8, upward + (fbm3(wp * 2.5) - 0.5) * 0.9) * (m == 9 ? 1.0 : 0.55);
    mossAmt *= smoothstep(uWaterLevel + 0.02, uWaterLevel + 0.12, wp.y);
    vec3 moss = mix(vec3(0.02, 0.05, 0.012), vec3(0.07, 0.13, 0.025), vnoise3(wp * 30.0));
    albedo = mix(albedo, moss, mossAmt);
    h += mossAmt * vnoise3(wp * 40.0) * 0.004;
    rough = mix(0.85, 0.95, mossAmt);
    // Wet band at the waterline.
    float wet = 1.0 - smoothstep(uWaterLevel, uWaterLevel + 0.08, wp.y);
    albedo *= mix(1.0, 0.45, wet);
    rough = mix(rough, 0.2, wet);
    spec = mix(0.3, 1.0, wet);
  } else if (m == 1) {
    // Vermilion lacquer (shu-urushi), worn through to black on the edges.
    float wear = smoothstep(0.62, 0.8, vnoise3(wp * 9.0) + (1.0 - abs(dot(n, v))) * 0.0) * band(0.01, foot);
    float fade = vnoise3(wp * 1.5);
    albedo = mix(vec3(0.5, 0.06, 0.022), vec3(0.62, 0.12, 0.04), fade);
    albedo = mix(albedo, vec3(0.03, 0.02, 0.018), wear * 0.75);
    rough = mix(0.32, 0.6, wear);
    spec = 0.9;
    h = wear * 0.0006;
  } else if (m == 2) {
    // Weathered, silvered cedar.
    float g = vnoise3(vec3(vUv.x * 60.0, vUv.y * 3.0, vLocal.y * 0.0)) * band(0.003, foot);
    float knot = smoothstep(0.82, 0.95, vnoise3(vec3(vUv * 6.0, 1.7)));
    float crack = smoothstep(0.86, 0.97, 1.0 - abs(vnoise3(vec3(vUv.x * 30.0, vUv.y * 1.5, 2.0)) * 2.0 - 1.0)) * band(0.006, foot);
    albedo = mix(vec3(0.11, 0.095, 0.08), vec3(0.2, 0.185, 0.165), g);
    albedo = mix(albedo, vec3(0.06, 0.04, 0.03), knot * 0.6 + crack * 0.7);
    h = g * 0.0015 - crack * 0.002;
    rough = 0.85;
  } else if (m == 3) {
    // Bamboo: aged golden culms, a few still green; dark nodes.
    float id = hash12(floor(vec2(wp.x * 3.0, wp.z * 3.0)));
    float node = fract(vUv.y / 0.28 + id);
    float ring = 1.0 - smoothstep(0.0, 0.035, min(node, 1.0 - node));
    float streak = vnoise3(vec3(vUv.x * 80.0, vUv.y * 2.0, id * 9.0)) * band(0.003, foot);
    albedo = mix(vec3(0.3, 0.22, 0.1), vec3(0.12, 0.17, 0.05), step(0.8, id));
    albedo *= 0.85 + 0.25 * streak;
    albedo = mix(albedo, vec3(0.06, 0.045, 0.025), ring * 0.8);
    h = ring * 0.001;
    rough = 0.4;
    spec = 0.8;
  } else if (m == 4) {
    // Twisted rice straw.
    float fib = vnoise3(vec3(vUv.x * 120.0, vUv.y * 14.0, 0.0)) * band(0.002, foot);
    float groove = 0.5 + 0.5 * cos(vUv.x * 18.0);
    albedo = mix(vec3(0.3, 0.22, 0.09), vec3(0.5, 0.39, 0.17), fib) * (0.7 + 0.3 * groove);
    h = fib * 0.001 + groove * 0.002;
    rough = 0.75;
  } else if (m == 5) {
    // Washi paper streamers.
    float fib = vnoise3(vec3(wp * 200.0)) * band(0.002, foot);
    albedo = vec3(0.82, 0.8, 0.75) * (0.95 + 0.05 * fib);
    translucency = 0.7;
    rough = 0.9;
  } else if (m == 6) {
    // Bonbori washi, lit from within. uv.x = panel index + across, uv.y = up.
    float k = floor(vUv.x + 1e-4);
    vec2 q = vec2(fract(vUv.x + 1e-4), vUv.y);
    vec2 mq = (q - 0.5) * vec2(0.165, 0.35);           // metres from the panel centre
    // The flame sits low in the shade: brightest there, falling off to the frame.
    float core = exp(-dot(mq - vec2(0.0, -0.03), mq - vec2(0.0, -0.03)) * 55.0);
    float edge = smoothstep(0.0, 0.08, q.x) * smoothstep(1.0, 0.92, q.x) * smoothstep(0.0, 0.06, q.y) * smoothstep(1.0, 0.94, q.y);
    float fib = fbm3(vec3(q * vec2(28.0, 60.0), k * 7.0)) * band(0.002, foot);
    float glow = (0.45 + 0.75 * core) * mix(0.55, 1.0, edge) * (0.88 + 0.24 * fib);
    // Cherry-blossom crest: five notched petals around a ring of stamens.
    vec2 c = mq - vec2(0.0, 0.035);
    float r = length(c);
    float an = atan(c.x, c.y);
    float sec = mod(an + PI / 5.0, TAU / 5.0) - PI / 5.0;
    float petalR = 0.052 * (0.45 + 0.55 * pow(max(cos(sec * 2.5), 0.0), 0.6)) - 0.009 * max(0.0, 1.0 - abs(sec) / 0.13);
    float aa = max(fwidth(r), 1e-4);
    float crest = 1.0 - smoothstep(-aa, aa, r - petalR);
    float heart = 1.0 - smoothstep(-aa, aa, r - 0.015);
    float stamen = 0.0;
    for (int i = 0; i < 5; i++) {
      float th = float(i) * TAU / 5.0;
      stamen = max(stamen, 1.0 - smoothstep(-aa, aa, length(c - 0.024 * vec2(sin(th), cos(th))) - 0.0045));
    }
    // Pink dye bleeding up from the bottom rail (beni-bokashi).
    float dye = (1.0 - smoothstep(0.0, 0.3, q.y)) * (0.75 + 0.25 * fbm3(vec3(q * 9.0, k)));
    vec3 tint = vec3(1.0);
    tint = mix(tint, vec3(1.0, 0.42, 0.55), dye * 0.8);
    tint = mix(tint, vec3(0.95, 0.2, 0.36), crest * (1.0 - heart));
    tint = mix(tint, vec3(1.0, 0.85, 0.55), heart);
    tint = mix(tint, vec3(0.55, 0.12, 0.08), stamen * (1.0 - heart) * 0.8);
    vec3 flame = mix(vec3(1.0, 0.48, 0.16), vec3(1.0, 0.74, 0.42), core);
    float flick = 0.94 + 0.06 * sin(uTime * 13.0 + hash12(floor(wp.xz * 2.0)) * 40.0) * sin(uTime * 7.3);
    albedo = vec3(0.8, 0.77, 0.7) * tint;
    translucency = 0.5;
    emit = flame * tint * glow * uGlow * 1.25 * flick;
    rough = 0.9;
    spec = 0.15;
  } else if (m == 7) {
    albedo = vec3(0.02, 0.018, 0.016);
    rough = 0.6;
  } else if (m == 8) {
    // Bronze with green patina.
    float pat = smoothstep(0.35, 0.7, vnoise3(wp * 25.0));
    albedo = mix(vec3(0.3, 0.2, 0.08), vec3(0.08, 0.16, 0.12), pat);
    rough = mix(0.35, 0.8, pat);
    spec = 1.2;
  } else if (m == 13) {
    // Cedar bark: long fibrous strips, red-brown, greyer where weathered.
    float strip = vnoise3(vec3(vUv.x * 26.0, vUv.y * 0.9, 3.0));
    float fibre = vnoise3(vec3(vUv.x * 90.0, vUv.y * 4.0, 5.0)) * band(0.003, foot);
    albedo = mix(vec3(0.1, 0.045, 0.028), vec3(0.19, 0.1, 0.06), strip) * (0.8 + 0.3 * fibre);
    albedo = mix(albedo, vec3(0.2, 0.18, 0.16), smoothstep(0.6, 0.85, vnoise3(wp * 0.7)) * 0.5);
    h = strip * 0.004 + fibre * 0.001;
    rough = 0.85;
  } else if (m == 14) {
    // Living moso culm: jade green dusted white below each node, a dark ring
    // at the node itself; older culms yellowed and lichen-spotted.
    float id = hash12(floor(vec2(wp.x * 4.0, wp.z * 4.0)));
    float node = fract(vUv.y / 0.38 + id * 7.0);
    float ring = 1.0 - smoothstep(0.0, 0.025, min(node, 1.0 - node));
    float bloom = smoothstep(0.75, 0.98, node) * 0.6;
    vec3 green = mix(vec3(0.07, 0.13, 0.035), vec3(0.16, 0.18, 0.06), smoothstep(0.55, 0.9, id));
    albedo = mix(green, vec3(0.3, 0.32, 0.26), bloom);
    albedo = mix(albedo, vec3(0.05, 0.06, 0.02), ring * 0.7);
    albedo *= 0.9 + 0.2 * vnoise3(vec3(vUv.x * 30.0, vUv.y * 2.0, id * 9.0)) * band(0.003, foot);
    h = ring * 0.0015;
    rough = 0.35;
    spec = 0.9;
  } else if (m == 12) {
    // Dense inner foliage of a clipped shrub: dark, leafy, barely lit.
    float lv = vnoise3(wp * 45.0);
    albedo = mix(vec3(0.012, 0.03, 0.01), vec3(0.03, 0.06, 0.018), lv);
    h = lv * 0.004;
    rough = 0.8;
    spec = 0.6;
  } else if (m == 11) {
    // Still water in a stone basin: dark, mirror-smooth.
    albedo = vec3(0.004, 0.007, 0.008);
    rough = 0.06;
    spec = 2.5;
    emit = ambientLight(reflect(-v, vec3(0.0, 1.0, 0.0))) * 0.35;
  } else if (m == 10) {
    // The glowing window of a stone lantern's fire box.
    float flick = 0.85 + 0.15 * sin(uTime * 11.0 + wp.x * 17.0) * sin(uTime * 5.3 + wp.z * 9.0);
    albedo = vec3(0.0);
    emit = vec3(1.0, 0.5, 0.18) * uGlow * 4.0 * flick;
  }

  // Bump.
  vec3 dpx = dFdx(wp), dpy = dFdy(wp);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 nb = abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2);
  n = dot(nb, nb) > 1e-20 ? normalize(nb) : n;

  vec3 l = uSunDir;
  float rot = ign(gl_FragCoord.xy) * TAU;
  float sh = shadowSoft(wp + n * 0.02, 0.02, rot);
  vec2 cl = canopyLight(wp);
  float ndl = dot(n, l);
  vec3 sun = uSunColor * sh * (saturate(ndl) + translucency * saturate(-ndl) * 0.6 + translucency * pow(saturate(dot(-v, l)), 4.0) * 0.8);
  float occl = saturate(0.5 + 0.5 * n.y) * 0.3 + 0.7;
  vec3 amb = ambientLight(n) * (0.25 + 0.75 * cl.r) * occl;
  vec3 lamp = localLight(wp + n * 0.03, n, 0.15);
  vec3 col = albedo * (sun + amb + lamp) + emit;
  col += (uSunColor * sh * ggxSpec(n, v, l, rough)) * spec * 0.6;
  col = applyFog(col, wp);
  gl_FragColor = vec4(col, 1.0);
#endif
}
`;

export function createPropMaterials(waterLevel) {
  const uniforms = lightingUniforms({
    uWaterLevel: { value: waterLevel },
    uGlow: { value: 1 },
  });
  const color = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide });
  const depth = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide, defines: { DEPTH_PASS: 1 } });
  return { color, depth, uniforms };
}

export function propGeometry(buffers) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(buffers.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(buffers.normal, 3));
  geo.setAttribute('aUv', new THREE.BufferAttribute(buffers.uv, 2));
  geo.setAttribute('aMat', new THREE.BufferAttribute(buffers.mat, 1));
  geo.setAttribute('aSway', new THREE.BufferAttribute(buffers.sway, 4));
  geo.setIndex(new THREE.BufferAttribute(buffers.index, 1));
  geo.computeBoundingSphere();
  return geo;
}
