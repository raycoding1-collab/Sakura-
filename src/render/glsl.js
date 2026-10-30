// Shared GLSL building blocks. Every material in the scene is a hand-written
// ShaderMaterial assembled from these chunks so lighting, wind, fog and
// shadows stay consistent across bark, blossoms, grass and petals.

export const COMMON = /* glsl */ `
#define PI 3.14159265359
#define TAU 6.28318530718
uniform float uTime;

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2 saturate(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
float sq(float x) { return x * x; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.31; a *= 0.5; }
  return s;
}

float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

// Interleaved gradient noise: stable per-pixel jitter for kernels.
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
`;

// Wind: a slow global gust envelope, gust fronts travelling across the land,
// and three bands of motion for the tree (trunk lean, limb sway, twig bob).
export const WIND = /* glsl */ `
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uGust;

float gustField(vec2 xz, float t) {
  vec2 side = vec2(-uWindDir.y, uWindDir.x);
  float a = sin(dot(xz, uWindDir) * 0.085 - t * 0.95);
  float b = sin(dot(xz, side) * 0.051 + t * 0.31 + 1.3);
  float c = sin(dot(xz, uWindDir) * 0.21 - t * 1.7 + dot(xz, side) * 0.07);
  return 0.5 + 0.5 * (a * 0.55 + b * 0.3 + c * 0.15);
}

vec3 treeWind(vec3 p, vec4 w) {
  float t = uTime;
  float g = gustField(p.xz, t) * (0.55 + 0.9 * uGust) * uWindStrength;
  vec3 wd = vec3(uWindDir.x, 0.0, uWindDir.y);
  vec3 side = vec3(-wd.z, 0.0, wd.x);
  float h = max(p.y, 0.0);
  float trunk = h * h * 0.0006;
  vec3 d = wd * trunk * (0.7 * g + 0.22 * sin(t * 0.61)) + side * trunk * 0.18 * sin(t * 0.43 + 1.0);

  float pa = w.z * TAU;
  float sa = sin(t * 1.05 + pa) * 0.6 + sin(t * 0.67 + pa * 2.3) * 0.4;
  d += w.x * 0.12 * (wd * (0.75 * g + 0.45 * sa) + side * 0.45 * sin(t * 0.83 + pa * 1.7) + vec3(0.0, 0.45, 0.0) * sin(t * 1.21 + pa * 3.1) * (0.4 + g));

  float pb = w.w * TAU;
  float sb = sin(t * 2.1 + pb) * 0.6 + sin(t * 3.3 + pb * 1.9) * 0.4;
  d += w.y * 0.055 * (wd * (0.6 * g + 0.6 * sb) + side * 0.6 * sin(t * 1.9 + pb * 1.3) + vec3(0.0, 0.7, 0.0) * sin(t * 2.6 + pb * 2.9) * (0.5 + g));
  return d;
}
`;

// Atmosphere: sun, sky ambient, height fog with sun in-scattering.
export const ATMOS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyAway;
uniform vec3 uGroundBounce;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec2 uFogParams; // density, height falloff

// Diffuse irradiance from the sky dome and the sunlit meadow below.
vec3 ambientLight(vec3 n) {
  float up = n.y * 0.5 + 0.5;
  vec2 sunH = normalize(uSunDir.xz);
  float towardSun = dot(normalize(n.xz + 1e-4), sunH) * 0.5 + 0.5;
  float sideness = 1.0 - abs(n.y);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(0.35, 1.0, up) * 0.6);
  vec3 horizon = mix(uSkyAway, uSkyHorizon, towardSun);
  vec3 c = mix(uGroundBounce, sky, smoothstep(0.0, 0.62, up));
  c += horizon * sideness * 0.35;
  return c;
}

vec3 fogInscatter(vec3 rd) {
  float sunAmt = pow(saturate(dot(rd, uSunDir)), 5.0);
  float az = dot(normalize(rd.xz + 1e-4), normalize(uSunDir.xz)) * 0.5 + 0.5;
  vec3 base = mix(uSkyAway, uFogColor, az);
  return base + uFogSunColor * sunAmt;
}

vec3 applyFog(vec3 col, vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  vec3 rd = d / max(dist, 1e-4);
  float a = uFogParams.x, b = uFogParams.y;
  float ry = abs(rd.y) < 1e-3 ? 1e-3 : rd.y;
  float optical = a * exp(-cameraPosition.y * b) * (1.0 - exp(-dist * ry * b)) / (ry * b);
  float f = 1.0 - exp(-max(optical, 0.0));
  return mix(col, fogInscatter(rd), f);
}

// Cheap GGX specular for a single directional light.
float ggxSpec(vec3 n, vec3 v, vec3 l, float rough) {
  vec3 h = normalize(v + l);
  float a = rough * rough;
  float a2 = a * a;
  float nh = saturate(dot(n, h));
  float d = a2 / (PI * sq(nh * nh * (a2 - 1.0) + 1.0));
  float nl = saturate(dot(n, l)), nv = saturate(dot(n, v)) + 1e-4;
  float k = sq(rough + 1.0) / 8.0;
  float vis = 1.0 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k));
  float f = 0.04 + 0.96 * pow(1.0 - saturate(dot(v, h)), 5.0);
  return d * vis * f * 0.25 * nl;
}
`;

// Canopy light volume: R = sky visibility, G = sun transmittance through blossoms.
export const CANOPY = /* glsl */ `
uniform highp sampler3D uCanopy;
uniform vec3 uCanopyMin;
uniform vec3 uCanopyInvSize;

vec2 canopyLight(vec3 p) {
  vec3 uvw = (p - uCanopyMin) * uCanopyInvSize;
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) {
    // Below the grid the canopy still shades the ground beneath it.
    if (uvw.y < 0.0 && all(greaterThan(uvw.xz, vec2(0.0))) && all(lessThan(uvw.xz, vec2(1.0)))) {
      return texture(uCanopy, vec3(uvw.x, 0.0, uvw.z)).rg;
    }
    return vec2(1.0);
  }
  return texture(uCanopy, uvw).rg;
}
`;

// Sun shadows: hand-rolled PCSS-lite (blocker search + rotated Poisson PCF).
export const SHADOW = /* glsl */ `
uniform highp sampler2DShadow uShadowMap;
uniform highp sampler2D uShadowDepth;
uniform mat4 uShadowMatrix;
uniform vec4 uShadowInfo; // texel size, depth range (m), texel world size (m), sun penumbra factor

const vec2 POISSON12[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);

vec3 shadowCoord(vec3 wpos) {
  vec4 c = uShadowMatrix * vec4(wpos, 1.0);
  return c.xyz / c.w;
}

bool outsideShadow(vec3 c) {
  return c.x < 0.001 || c.y < 0.001 || c.x > 0.999 || c.y > 0.999 || c.z > 0.999;
}

// Soft shadow with contact hardening. bias in metres along the light.
float shadowSoft(vec3 wpos, float bias, float rot) {
  vec3 c = shadowCoord(wpos);
  if (outsideShadow(c)) return 1.0;
  float texel = uShadowInfo.x;
  float zb = bias / uShadowInfo.y;
  float s = sin(rot), co = cos(rot);
  mat2 R = mat2(co, s, -s, co);
  float blocker = 0.0, nb = 0.0;
  for (int i = 0; i < 6; i++) {
    vec2 o = R * POISSON12[i * 2] * 20.0 * texel;
    float d = texture(uShadowDepth, c.xy + o).r;
    if (d < c.z - zb) { blocker += d; nb += 1.0; }
  }
  if (nb < 0.5) return 1.0;
  blocker /= nb;
  float pen = (c.z - blocker) * uShadowInfo.y * uShadowInfo.w / uShadowInfo.z;
  float radius = clamp(pen, 1.2, 22.0) * texel;
  float sum = 0.0;
  for (int i = 0; i < 12; i++) {
    sum += texture(uShadowMap, vec3(c.xy + R * POISSON12[i] * radius, c.z - zb));
  }
  return sum / 12.0;
}

// Small fixed kernel for tiny or numerous surfaces (petals, grass).
float shadowFast(vec3 wpos, float bias, float radiusTexels) {
  vec3 c = shadowCoord(wpos);
  if (outsideShadow(c)) return 1.0;
  float zb = bias / uShadowInfo.y;
  float r = radiusTexels * uShadowInfo.x;
  float sum = texture(uShadowMap, vec3(c.xy + vec2(-0.5, -0.5) * r, c.z - zb));
  sum += texture(uShadowMap, vec3(c.xy + vec2(0.5, -0.5) * r, c.z - zb));
  sum += texture(uShadowMap, vec3(c.xy + vec2(-0.5, 0.5) * r, c.z - zb));
  sum += texture(uShadowMap, vec3(c.xy + vec2(0.5, 0.5) * r, c.z - zb));
  return sum * 0.25;
}
`;
