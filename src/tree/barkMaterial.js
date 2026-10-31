import * as THREE from 'three';
import { COMMON, WIND, ATMOS, SHADOW, CANOPY } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';

// Cherry bark, painted procedurally in cylinder space, by age of the wood:
//  - young shoots: glossy mahogany skin banded with pale horizontal lenticels
//  - mature limbs: darker skin breaking into horizontally elongated plates
//  - the ancient trunk and roots: deep furrows following the spiral grain of
//    the fused stems, rough ridges between them, lichen and moss
// plus the rotten heartwood of the hollow, its pale callus lips, and the
// ringed faces of old pruning cuts.

const vertexShader = COMMON + WIND + /* glsl */ `
attribute vec2 aCyl;
attribute vec4 aBark;
attribute vec4 aWind;
attribute float aFeature;
uniform float uPixelAngle; // view angle of one screen pixel (radians)
varying float vCoverage;
varying vec3 vWorld;
varying vec3 vRest;
varying vec3 vNormal;
varying vec2 vCyl;
varying vec4 vBark;
varying float vFeature;
void main() {
  vec3 p = position + treeWind(position, aWind);
  vCoverage = 1.0;
#ifndef DEPTH_PASS
  // Branches thinner than a pixel are widened to about one pixel and drawn
  // with matching partial coverage, so they read as soft lines rather than
  // broken stair-steps.
  float rMin = 0.7 * uPixelAngle * length(p - cameraPosition);
  if (aBark.x < rMin) {
    p += normal * (rMin - aBark.x);
    vCoverage = aBark.x / rMin;
  }
#endif
  vWorld = p;
  vRest = position;
  vNormal = normal;
  vCyl = aCyl;
  vBark = aBark;
  vFeature = aFeature;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = COMMON + ATMOS + SHADOW + CANOPY + /* glsl */ `
varying vec3 vWorld;
varying vec3 vRest;
varying vec3 vNormal;
varying vec2 vCyl;
varying vec4 vBark;
varying float vFeature;
varying float vCoverage;

vec3 voronoi3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = vec3(hash13(i + g), hash13(i + g + 17.1), hash13(i + g + 31.7));
        vec3 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; id = hash13(i + g + 5.3); }
        else if (d < d2) d2 = d;
      }
  return vec3(sqrt(d1), sqrt(d2), id);
}

// Feature fade: kills pattern octaves smaller than ~2 pixels.
float band(float size, float footprint) { return 1.0 - smoothstep(size * 0.6, size * 2.5, footprint); }

vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

void main() {
#ifdef DEPTH_PASS
  gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
#else
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float r = vBark.x;
  float s = vBark.y;
  float ao = saturate(vBark.z);
  float code = fract(vBark.w);
  float isRoot = step(0.47, code) * step(code, 0.76);
  float isCut = step(0.35, code) * step(code, 0.45);
  float seed = fract(code * 4.0);
  float age = smoothstep(0.03, 0.24, r);
  float ancient = smoothstep(0.3, 0.55, r) + isRoot * smoothstep(0.08, 0.2, r);
  ancient = saturate(ancient);
  float hollowIn = smoothstep(0.55, 0.9, vFeature);
  float lipM = vFeature > 0.0 && vFeature < 0.55 ? vFeature * 2.0 : 0.0;
  float foot = length(fwidth(vWorld));
  vec2 cyl = vCyl;

  // ---- Young skin --------------------------------------------------------------
  float lent = smoothstep(0.66, 0.82, vnoise3(vec3(cyl * 34.0, s * 230.0 + seed * 40.0))) * band(0.004, foot);
  float grain = vnoise3(vec3(cyl * 120.0, s * 40.0)) * band(0.003, foot);

  // ---- Mature plates -----------------------------------------------------------
  float oldDetail = band(0.018, foot) * smoothstep(0.1, 0.24, r) * (1.0 - ancient);
  vec2 warp = vec2(vnoise3(vec3(cyl * 3.0, s * 1.5)), vnoise3(vec3(cyl * 3.0 + 9.0, s * 1.5))) - 0.5;
  vec3 pq = vec3(cyl * 5.5 + warp * 1.4, s * 24.0 + warp.x * 3.0);
  vec3 vor = oldDetail > 0.0 ? voronoi3(pq) : vec3(0.0, 1.0, 0.5);
  float edge = vor.y - vor.x;
  float depthVar = vnoise3(pq * 0.35 + 4.0);
  float crev = smoothstep(0.015, 0.06 + 0.12 * depthVar, edge);
  crev = mix(1.0, mix(1.0, crev, 0.35 + 0.65 * depthVar), oldDetail);
  float plate = (0.6 + 0.4 * vor.z) * crev;
  float crevSoft = mix(1.0, smoothstep(0.0, 0.32, edge), oldDetail * (0.35 + 0.65 * depthVar));
  float plateSoft = (0.6 + 0.4 * vor.z) * crevSoft;
  float strips = vnoise3(vec3(cyl * 6.0 + warp.x * 2.0, s * 15.0 + 3.0));
  float scars = smoothstep(0.62, 0.8, vnoise3(vec3(cyl * 10.0, s * 140.0))) * band(0.004, foot);

  // ---- Ancient furrowed bark along the spiral grain ----------------------------
  // Rotating the cylinder coordinates with height aligns the pattern with the
  // twist of the fused stems: long furrows wind around the trunk.
  vec2 sc = rot2(cyl, -s * 0.5 * (1.0 - isRoot));
  float fwarp = vnoise3(vec3(sc * 2.2, s * 0.8)) - 0.5;
  float furrowN = vnoise3(vec3(sc * 14.0 + fwarp * 1.5, s * 1.6));
  float furrow = 1.0 - abs(furrowN * 2.0 - 1.0);
  float furrowD = smoothstep(0.62, 0.97, furrow) * band(0.025, foot);
  float ridgeRough = vnoise3(vec3(sc * 40.0, s * 9.0)) * band(0.008, foot);
  float crossCrack = smoothstep(0.8, 0.93, vnoise3(vec3(sc * 22.0, s * 55.0))) * band(0.01, foot) * (1.0 - furrowD) * 0.6;
  float flake = vnoise3(vec3(sc * 7.0, s * 4.0));
  float hAnc = (1.0 - furrowD) * (0.7 + 0.3 * ridgeRough) - crossCrack * 0.35 + flake * 0.2;

  float hYoung = lent * 0.5 + grain * 0.15;
  float hMature = plateSoft * 0.75 + scars * 0.15;
  float h = mix(mix(hYoung * 0.0012, hMature * 0.009, age), hAnc * 0.02, ancient);
  h *= 1.0 - hollowIn;

  // Rings on the cut faces of pruned stubs.
  float rings = 0.0;
  if (isCut > 0.5) {
    float rr = length(cyl) / max(r, 1e-3);
    float wob = vnoise3(vec3(cyl * 30.0, seed * 10.0)) * 0.08;
    rings = 0.5 + 0.5 * cos((rr + wob) * 46.0);
    h = rings * 0.0008 + (1.0 - smoothstep(0.82, 1.0, rr)) * 0.0;
  }

  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 nb = abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2);
  nb = dot(nb, nb) > 1e-20 ? normalize(nb) : n;

  // ---- Albedo --------------------------------------------------------------------
  vec3 young = mix(vec3(0.07, 0.036, 0.034), vec3(0.1, 0.055, 0.048), grain);
  young = mix(young, vec3(0.18, 0.145, 0.12), lent * 0.5);
  float plateTone = fract(vor.z * 7.13);
  vec3 mature = mix(vec3(0.03, 0.024, 0.022), vec3(0.058, 0.048, 0.044), smoothstep(0.3, 0.9, plate) * (0.6 + 0.4 * strips));
  mature = mix(mature, vec3(0.08, 0.045, 0.036), smoothstep(0.84, 0.98, plateTone) * 0.6);
  mature = mix(mature, vec3(0.12, 0.1, 0.085), scars * 0.35);
  mature = mix(mature, vec3(0.012, 0.01, 0.01), (1.0 - crev) * 0.85);
  vec3 anc = mix(vec3(0.036, 0.031, 0.029), vec3(0.068, 0.061, 0.056), smoothstep(0.35, 0.85, flake) * (0.6 + 0.4 * ridgeRough));
  anc = mix(anc, vec3(0.095, 0.088, 0.08), smoothstep(0.6, 0.9, ridgeRough) * 0.35 * (1.0 - furrowD));
  anc = mix(anc, vec3(0.014, 0.011, 0.01), furrowD * 0.9);
  anc = mix(anc, vec3(0.02, 0.016, 0.014), crossCrack * 0.7);
  vec3 albedo = mix(mix(young, mature, age), anc, ancient);

  // Hollow: crumbling dark heartwood with fibrous streaks; pale callus lips.
  if (hollowIn > 0.0) {
    float fib = vnoise3(vec3(vRest.x * 30.0, vRest.y * 4.0, vRest.z * 30.0));
    vec3 rot = mix(vec3(0.016, 0.01, 0.007), vec3(0.045, 0.027, 0.015), fib);
    albedo = mix(albedo, rot, hollowIn);
  }
  albedo = mix(albedo, vec3(0.15, 0.11, 0.085), lipM * 0.6);

  if (isCut > 0.5) {
    vec3 wood = mix(vec3(0.16, 0.12, 0.085), vec3(0.24, 0.2, 0.15), rings);
    float rr = length(cyl) / max(r, 1e-3);
    wood = mix(wood, vec3(0.07, 0.045, 0.03), smoothstep(0.0, 0.35, 1.0 - rr) * 0.5);
    wood = mix(wood, vec3(0.05, 0.035, 0.03), smoothstep(0.85, 1.0, rr));
    albedo = wood;
  }

  // Lichen and moss.
  float upward = saturate(nb.y * 1.4 - 0.1);
  float lichN = fbm3(vRest * 3.1) + vnoise3(vRest * 17.0) * 0.25;
  float lich = smoothstep(0.62, 0.8, lichN) * mix(upward, 0.3, ancient) * smoothstep(0.02, 0.12, r);
  lich *= smoothstep(0.35, 0.6, vnoise3(vRest * 9.0)) * (1.0 - hollowIn) * (1.0 - isCut);
  albedo = mix(albedo, mix(vec3(0.14, 0.16, 0.12), vec3(0.24, 0.25, 0.2), vnoise3(vRest * 40.0)), lich * 0.5);
  float mossFurrow = furrowD * ancient * smoothstep(0.45, 0.7, fbm3(vRest * 2.0));
  float low = 1.0 - smoothstep(0.0, mix(0.6, 0.15, isRoot), vWorld.y + 0.15);
  float mossN = smoothstep(0.35, 0.65, fbm3(vRest * 6.0));
  float moss = max(low * 0.8, mossFurrow * 0.5) * (1.0 - hollowIn);
  albedo = mix(albedo, mix(vec3(0.04, 0.08, 0.02), vec3(0.08, 0.11, 0.03), mossN), moss);

  float roughness = mix(0.45, 0.9, max(age, ancient));
  roughness = mix(roughness, 0.95, max(lich, moss));

  // ---- Lighting --------------------------------------------------------------------
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 l = uSunDir;
  float rot = ign(gl_FragCoord.xy) * TAU;
  float sh = shadowSoft(vWorld + n * 0.02, 0.02, rot);
  vec2 cl = canopyLight(vWorld);
  float ndl = saturate(dot(nb, l));
  float cavity = mix(mix(1.0, saturate(0.35 + plateSoft * 0.75), age), saturate(0.3 + hAnc * 0.85), ancient);
  cavity *= 1.0 - hollowIn * 0.6;
  vec3 sun = uSunColor * ndl * sh;
  vec3 amb = ambientLight(nb) * (0.25 + 0.75 * cl.r) * ao * cavity;
  amb += vec3(1.0, 0.72, 0.74) * uSunColor * 0.012 * cl.r * (1.0 - cl.g) * ao;
  vec3 lamp = localLight(vWorld + n * 0.05, nb, 0.1) * ao;
  vec3 col = albedo * (sun + amb + lamp);
  col += uSunColor * ggxSpec(nb, v, l, roughness) * sh * mix(0.5, 0.15, max(age, ancient));
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, saturate(vCoverage));
#endif
}
`;

export function createBarkMaterials() {
  const uniforms = lightingUniforms({ uPixelAngle: { value: 0.0007 } });
  const color = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, alphaToCoverage: true });
  const depth = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, defines: { DEPTH_PASS: 1 } });
  return { color, depth };
}

export function createBarkGeometry(mesh) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normal, 3));
  geo.setAttribute('aCyl', new THREE.BufferAttribute(mesh.cyl, 2));
  geo.setAttribute('aBark', new THREE.BufferAttribute(mesh.bark, 4));
  geo.setAttribute('aWind', new THREE.BufferAttribute(mesh.wind, 4));
  geo.setAttribute('aFeature', new THREE.BufferAttribute(mesh.feature, 1));
  geo.setIndex(new THREE.BufferAttribute(mesh.index, 1));
  geo.computeBoundingSphere();
  return geo;
}
