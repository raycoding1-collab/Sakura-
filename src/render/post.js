import * as THREE from 'three';
import { COMMON } from './glsl.js';

// Post-processing written from scratch:
//   HDR scene (4x MSAA) → bokeh depth of field (half res, golden-angle gather)
//   → crepuscular rays (radial blur of the unoccluded sky) → mip-chain bloom
//   → AgX tone mapping, split-tone grade, vignette and film grain.

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const DEPTH_FN = /* glsl */ `
uniform vec2 uNearFar;
float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}
`;

function pass(fragmentShader, uniforms, defines = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
  });
}

function rt(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    ...opts,
  });
}

const DOF_PREFILTER = DEPTH_FN + /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  // Nearest depth of the 2x2 footprint keeps thin foreground petals intact.
  float d0 = texture2D(tDepth, vUv + uTexel * vec2(-0.5, -0.5)).r;
  float d1 = texture2D(tDepth, vUv + uTexel * vec2(0.5, -0.5)).r;
  float d2 = texture2D(tDepth, vUv + uTexel * vec2(-0.5, 0.5)).r;
  float d3 = texture2D(tDepth, vUv + uTexel * vec2(0.5, 0.5)).r;
  float d = min(min(d0, d1), min(d2, d3));
  gl_FragColor = vec4(clamp(c, vec3(0.0), vec3(300.0)), linearDepth(d));
}`;

const DOF_GATHER = /* glsl */ `
uniform sampler2D tHalf;
uniform vec2 uPixel;
uniform float uFocus;
uniform float uAperture; // blur in half-res pixels per dioptre
uniform float uMaxBlur;
varying vec2 vUv;
const float GOLDEN = 2.39996323;
float blurSize(float depth) {
  return min(abs(1.0 / uFocus - 1.0 / max(depth, 0.05)) * uAperture, uMaxBlur);
}
void main() {
  vec4 center = texture2D(tHalf, vUv);
  float cd = center.a;
  float cs = blurSize(cd);
  vec3 col = center.rgb;
  float tot = 1.0;
  float reach = cs;
  float radius = 0.7;
  float ang = ign(gl_FragCoord.xy) * TAU;
  for (int i = 0; i < 96; i++) {
    if (radius >= uMaxBlur) break;
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uPixel * radius;
    vec4 s = texture2D(tHalf, tc);
    float ss = blurSize(s.a);
    if (s.a > cd) ss = clamp(ss, 0.0, cs * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, ss);
    col += mix(col / tot, s.rgb, m);
    tot += 1.0;
    reach = max(reach, m * ss);
    radius += 1.15 / radius;
    ang += GOLDEN;
  }
  gl_FragColor = vec4(col / tot, reach);
}`;

const GOD_MASK = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform float uAspect;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).r;
  vec3 c = texture2D(tColor, vUv).rgb;
  float sky = step(0.99999, d);
  vec2 dv = (vUv - uSun) * vec2(uAspect, 1.0);
  float near = exp(-dot(dv, dv) * 5.0);
  float l = luma(c);
  vec3 m = c * (min(l, 9.0) / max(l, 1e-4)) * sky * near;
  gl_FragColor = vec4(m, 1.0);
}`;

const GOD_BLUR = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uSun;
uniform float uLength;
varying vec2 vUv;
void main() {
  vec2 delta = (uSun - vUv) * uLength / 40.0;
  float j = ign(gl_FragCoord.xy);
  vec2 uv = vUv + delta * j;
  vec3 acc = vec3(0.0);
  float w = 1.0, tot = 0.0;
  for (int i = 0; i < 40; i++) {
    acc += texture2D(tInput, uv).rgb * w;
    tot += w;
    w *= 0.962;
    uv += delta;
  }
  gl_FragColor = vec4(acc / tot, 1.0);
}`;

const BLOOM_DOWN = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uKaris;
varying vec2 vUv;
vec3 tap(vec2 o) { return clamp(texture2D(tInput, vUv + o * uTexel).rgb, vec3(0.0), vec3(400.0)); }
float kw(vec3 c) { return 1.0 / (1.0 + luma(c)); }
void main() {
  vec3 a = tap(vec2(-2, 2)), b = tap(vec2(0, 2)), c = tap(vec2(2, 2));
  vec3 d = tap(vec2(-2, 0)), e = tap(vec2(0, 0)), f = tap(vec2(2, 0));
  vec3 g = tap(vec2(-2, -2)), h = tap(vec2(0, -2)), i = tap(vec2(2, -2));
  vec3 j = tap(vec2(-1, 1)), k = tap(vec2(1, 1)), l = tap(vec2(-1, -1)), m = tap(vec2(1, -1));
  vec3 res;
  if (uKaris > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25;
    vec3 g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = kw(g0) * 0.125, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.5;
    res = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    res = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(res, 1.0);
}`;

const BLOOM_UP = /* glsl */ `
uniform sampler2D tInput;
uniform sampler2D tBase;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec4 d = uTexel.xyxy * vec4(1.0, 1.0, -1.0, 0.0) * uRadius;
  vec3 s = texture2D(tInput, vUv - d.xy).rgb;
  s += texture2D(tInput, vUv - d.wy).rgb * 2.0;
  s += texture2D(tInput, vUv - d.zy).rgb;
  s += texture2D(tInput, vUv + d.zw).rgb * 2.0;
  s += texture2D(tInput, vUv).rgb * 4.0;
  s += texture2D(tInput, vUv + d.xw).rgb * 2.0;
  s += texture2D(tInput, vUv + d.zy).rgb;
  s += texture2D(tInput, vUv + d.wy).rgb * 2.0;
  s += texture2D(tInput, vUv + d.xy).rgb;
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + s / 16.0, 1.0);
}`;

const COMPOSITE = DEPTH_FN + /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tDof;
uniform sampler2D tGod;
uniform sampler2D tBloom;
uniform float uUseDof;
uniform float uFocus;
uniform float uAperture;
uniform vec3 uGodTint;
uniform float uGod;
uniform float uBloom;
uniform float uBloomLevels;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uFade;
uniform vec2 uResolution;
varying vec2 vUv;

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 v) {
  const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const float lo = -12.47393, hi = 4.026069;
  v = m * v;
  v = clamp(log2(max(v, vec3(1e-10))), lo, hi);
  v = (v - lo) / (hi - lo);
  return agxContrast(v);
}
vec3 agxLook(vec3 v) {
  float l = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = pow(max(v, vec3(0.0)), vec3(1.12));
  return l + 1.18 * (v - l);
}
vec3 agxEotf(vec3 v) {
  const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  return pow(max(mi * v, vec3(0.0)), vec3(2.2));
}

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
#ifdef DEBUG_NAN
  if (any(isnan(col)) || any(isinf(col))) { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); return; }
  if (any(lessThan(col, vec3(0.0)))) { gl_FragColor = vec4(0.0, 1.0, 1.0, 1.0); return; }
  if (luma(col) > 2000.0) { gl_FragColor = vec4(1.0, 1.0, 0.0, 1.0); return; }
#endif
  if (uUseDof > 0.5) {
    float depth = linearDepth(texture2D(tDepth, vUv).r);
    float coc = abs(1.0 / uFocus - 1.0 / max(depth, 0.05)) * uAperture * 2.0;
    vec4 dof = texture2D(tDof, vUv);
    float m = smoothstep(0.9, 2.2, max(coc, dof.a * 2.0));
    col = mix(col, dof.rgb, m);
  }
  col += texture2D(tGod, vUv).rgb * uGodTint * uGod;
  vec3 bloom = texture2D(tBloom, vUv).rgb / uBloomLevels;
  col = mix(col, bloom, uBloom);
  col *= uExposure;

  // Tone map (AgX) then grade in display space.
  vec3 c = agxEotf(agxLook(agx(col)));
  c = max(c, vec3(0.0));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Split tone (linear): lavender shadows, peach highlights.
  c *= mix(vec3(0.96, 0.97, 1.06), vec3(1.0), smoothstep(0.0, 0.25, l));
  c *= mix(vec3(1.0), vec3(1.04, 1.0, 0.95), smoothstep(0.25, 0.9, l));
  // Vignette.
  vec2 q = vUv - 0.5;
  q.x *= uResolution.x / uResolution.y;
  float vig = 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
  c *= vig;
  // Grain and dither.
  float g = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 517.0) - 0.5;
  c += g * uGrain * (0.6 + 0.4 * (1.0 - l));
  c = mix(vec3(0.0), c, uFade);
  // sRGB encode.
  c = saturate(c);
  vec3 srgb = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  gl_FragColor = vec4(srgb, 1.0);
}`;

export class PostPipeline {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.samples = opts.samples ?? 4;
    this.useDof = opts.dof ?? true;
    this.bloomLevels = 6;
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(triangle);
    this.quad.frustumCulled = false;
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const time = opts.timeUniform;
    this.mat = {
      prefilter: pass(COMMON + DOF_PREFILTER, { uTime: time, tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNearFar: { value: new THREE.Vector2(0.1, 4000) } }),
      gather: pass(COMMON + DOF_GATHER, { uTime: time, tHalf: { value: null }, uPixel: { value: new THREE.Vector2() }, uFocus: { value: 15 }, uAperture: { value: 40 }, uMaxBlur: { value: 14 } }),
      godMask: pass(COMMON + GOD_MASK, { uTime: time, tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } }),
      godBlur: pass(COMMON + GOD_BLUR, { uTime: time, tInput: { value: null }, uSun: { value: new THREE.Vector2() }, uLength: { value: 1 } }),
      down: pass(COMMON + BLOOM_DOWN, { uTime: time, tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } }),
      up: pass(COMMON + BLOOM_UP, { uTime: time, tInput: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } }),
      composite: pass(COMMON + COMPOSITE, {
        uTime: time,
        tColor: { value: null }, tDepth: { value: null }, tDof: { value: null }, tGod: { value: null }, tBloom: { value: null },
        uNearFar: { value: new THREE.Vector2(0.1, 4000) },
        uUseDof: { value: 1 }, uFocus: { value: 15 }, uAperture: { value: 40 },
        uGodTint: { value: new THREE.Color(1.0, 0.72, 0.45) }, uGod: { value: 0.0 },
        uBloom: { value: 0.07 }, uBloomLevels: { value: this.bloomLevels },
        uExposure: { value: 1.0 }, uVignette: { value: 0.32 }, uGrain: { value: 0.018 }, uFade: { value: 1 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      }),
    };
    this.params = {
      focus: 15,
      aperture: 60, // blur in full-res pixels per dioptre of defocus, at 1080p
      exposure: 1.0,
      bloom: 0.07,
      god: 0.55,
      fade: 1,
    };
    this.sunUV = new THREE.Vector2(0.5, 0.5);
    this.sunVisible = 0;
    this.width = 0;
    this.height = 0;
  }

  setSize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.dispose();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    this.hdr = rt(w, h, { samples: this.samples, depthBuffer: true, depthTexture });
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    this.half = rt(hw, hh);
    this.dof = rt(hw, hh);
    this.godA = rt(hw, hh);
    this.godB = rt(hw, hh);
    this.down = [];
    this.up = [];
    for (let i = 0; i < this.bloomLevels; i++) {
      const s = 1 << (i + 1);
      this.down.push(rt(Math.max(1, Math.floor(w / s)), Math.max(1, Math.floor(h / s))));
      this.up.push(rt(Math.max(1, Math.floor(w / s)), Math.max(1, Math.floor(h / s))));
    }
  }

  dispose() {
    const all = [this.hdr, this.half, this.dof, this.godA, this.godB, ...(this.down || []), ...(this.up || [])];
    for (const t of all) {
      if (!t) continue;
      if (t.depthTexture) t.depthTexture.dispose();
      t.dispose();
    }
  }

  draw(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.quadCam);
  }

  updateSun(camera, sunDir) {
    const p = new THREE.Vector3().copy(camera.position).addScaledVector(sunDir, 1000);
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const facing = fwd.dot(sunDir);
    p.project(camera);
    this.sunUV.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    const off = Math.max(Math.abs(p.x), Math.abs(p.y));
    const ss = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    this.sunVisible = facing > 0 ? ss(1.9, 0.9, off) * ss(0.0, 0.25, facing) : 0;
  }

  // Render the main scene into the HDR target, then run the chain to screen.
  render(scene, camera, sunDir) {
    const r = this.renderer;
    const m = this.mat;
    const w = this.width, h = this.height;
    const nearFar = new THREE.Vector2(camera.near, camera.far);
    const resScale = h / 1080;

    r.setRenderTarget(this.hdr);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, camera);

    const color = this.hdr.texture;
    const depth = this.hdr.depthTexture;

    // Depth of field.
    const useDof = this.useDof;
    // Gather runs at half resolution, so the aperture is expressed in half-res pixels.
    const aperture = this.params.aperture * resScale * 0.5;
    if (useDof) {
      m.prefilter.uniforms.tColor.value = color;
      m.prefilter.uniforms.tDepth.value = depth;
      m.prefilter.uniforms.uTexel.value.set(1 / w, 1 / h);
      m.prefilter.uniforms.uNearFar.value.copy(nearFar);
      this.draw(m.prefilter, this.half);
      m.gather.uniforms.tHalf.value = this.half.texture;
      m.gather.uniforms.uPixel.value.set(1 / this.half.width, 1 / this.half.height);
      m.gather.uniforms.uFocus.value = this.params.focus;
      m.gather.uniforms.uAperture.value = aperture;
      m.gather.uniforms.uMaxBlur.value = 13 * Math.max(0.6, resScale);
      this.draw(m.gather, this.dof);
    }

    // Crepuscular rays.
    this.updateSun(camera, sunDir);
    const god = this.params.god * this.sunVisible;
    if (god > 0.001) {
      m.godMask.uniforms.tColor.value = color;
      m.godMask.uniforms.tDepth.value = depth;
      m.godMask.uniforms.uSun.value.copy(this.sunUV);
      m.godMask.uniforms.uAspect.value = w / h;
      this.draw(m.godMask, this.godA);
      m.godBlur.uniforms.uSun.value.copy(this.sunUV);
      m.godBlur.uniforms.tInput.value = this.godA.texture;
      m.godBlur.uniforms.uLength.value = 0.9;
      this.draw(m.godBlur, this.godB);
      m.godBlur.uniforms.tInput.value = this.godB.texture;
      m.godBlur.uniforms.uLength.value = 0.22;
      this.draw(m.godBlur, this.godA);
    }

    // Bloom pyramid.
    let src = useDof ? this.dof.texture : color;
    let sw = useDof ? this.dof.width : w, sh = useDof ? this.dof.height : h;
    for (let i = 0; i < this.bloomLevels; i++) {
      m.down.uniforms.tInput.value = src;
      m.down.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      m.down.uniforms.uKaris.value = i === 0 ? 1 : 0;
      this.draw(m.down, this.down[i]);
      src = this.down[i].texture;
      sw = this.down[i].width;
      sh = this.down[i].height;
    }
    let upSrc = this.down[this.bloomLevels - 1].texture;
    for (let i = this.bloomLevels - 2; i >= 0; i--) {
      const target = this.up[i];
      const prev = i === this.bloomLevels - 2 ? this.down[i + 1] : this.up[i + 1];
      m.up.uniforms.tInput.value = upSrc;
      m.up.uniforms.tBase.value = this.down[i].texture;
      m.up.uniforms.uTexel.value.set(1 / prev.width, 1 / prev.height);
      m.up.uniforms.uRadius.value = 1.0;
      this.draw(m.up, target);
      upSrc = target.texture;
    }

    const c = m.composite.uniforms;
    c.tColor.value = color;
    c.tDepth.value = depth;
    c.tDof.value = this.dof.texture;
    c.tGod.value = this.godA.texture;
    c.tBloom.value = this.up[0].texture;
    c.uNearFar.value.copy(nearFar);
    c.uUseDof.value = useDof ? 1 : 0;
    c.uFocus.value = this.params.focus;
    c.uAperture.value = aperture;
    c.uGod.value = god;
    c.uBloom.value = this.params.bloom;
    c.uExposure.value = this.params.exposure;
    c.uFade.value = this.params.fade;
    c.uResolution.value.set(w, h);
    this.draw(m.composite, null);
  }
}
