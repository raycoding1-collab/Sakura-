import * as THREE from 'three';
import { COMMON, WIND, ATMOS, SHADOW, CANOPY } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';

// Cherry bark, painted procedurally in cylinder space:
//  - young wood: glossy mahogany skin banded with pale horizontal lenticels
//  - old wood: dark, rough, horizontally peeling strips split by long fissures
//  - grey-green lichen on upward faces, moss where roots meet the soil.

const vertexShader = COMMON + WIND + /* glsl */ `
attribute vec2 aCyl;
attribute vec4 aBark;
attribute vec4 aWind;
varying vec3 vWorld;
varying vec3 vRest;
varying vec3 vNormal;
varying vec2 vCyl;
varying vec4 vBark;
void main() {
  vec3 p = position + treeWind(position, aWind);
  vWorld = p;
  vRest = position;
  vNormal = normal;
  vCyl = aCyl;
  vBark = aBark;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = COMMON + ATMOS + SHADOW + CANOPY + /* glsl */ `
varying vec3 vWorld;
varying vec3 vRest;
varying vec3 vNormal;
varying vec2 vCyl;
varying vec4 vBark;

// Cellular noise: distances to the nearest and second-nearest feature point,
// plus a stable random id of the nearest cell.
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

void main() {
#ifdef DEPTH_PASS
  gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
#else
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float r = vBark.x;
  float s = vBark.y;
  float ao = saturate(vBark.z);
  float seed = fract(vBark.w);
  float isRoot = step(0.45, seed);
  float age = smoothstep(0.03, 0.24, r);
  float foot = length(fwidth(vWorld));

  // Cylinder coordinates: around (arc metres) and along (metres).
  vec2 cyl = vCyl;
  vec3 lq = vec3(cyl * 34.0, s * 230.0 + seed * 40.0);
  float lent = smoothstep(0.66, 0.82, vnoise3(lq)) * band(0.004, foot);
  float grain = vnoise3(vec3(cyl * 120.0, s * 40.0)) * band(0.003, foot);

  // Old bark: the skin breaks into horizontally elongated plates (cellular
  // noise in cylinder space) split by dark crevices, crossed by lenticel scars
  // and the occasional long vertical fissure.
  float oldDetail = band(0.018, foot) * smoothstep(0.1, 0.24, r);
  vec2 warp = vec2(vnoise3(vec3(cyl * 3.0, s * 1.5)), vnoise3(vec3(cyl * 3.0 + 9.0, s * 1.5))) - 0.5;
  vec3 pq = vec3(cyl * 5.5 + warp * 1.4, s * 24.0 + warp.x * 3.0);
  vec3 vor = oldDetail > 0.0 ? voronoi3(pq) : vec3(0.0, 1.0, 0.5);
  float edge = vor.y - vor.x;
  float depthVar = vnoise3(pq * 0.35 + 4.0);
  float crev = smoothstep(0.015, 0.06 + 0.12 * depthVar, edge);
  crev = mix(1.0, mix(1.0, crev, 0.35 + 0.65 * depthVar), oldDetail);
  float plate = (0.6 + 0.4 * vor.z) * crev;
  // Softer profile for the relief: sharp edges alias under screen-space bump.
  float crevSoft = mix(1.0, smoothstep(0.0, 0.32, edge), oldDetail * (0.35 + 0.65 * depthVar));
  float plateSoft = (0.6 + 0.4 * vor.z) * crevSoft;
  float strips = vnoise3(vec3(cyl * 6.0 + warp.x * 2.0, s * 15.0 + 3.0));
  float stripsB = vnoise3(vec3(cyl * 16.0, s * 90.0 + warp.y * 6.0));
  float scars = smoothstep(0.62, 0.8, vnoise3(vec3(cyl * 10.0, s * 140.0))) * band(0.004, foot);
  float fissN = 1.0 - abs(vnoise3(vec3(cyl * 11.0 + warp * 3.0, s * 1.8 + vRest.y * 0.4)) * 2.0 - 1.0);
  float fiss = smoothstep(0.8, 0.99, fissN) * band(0.03, foot) * 0.6;
  float rough = fbm3(vRest * 34.0) * band(0.006, foot);
  float hOld = plateSoft * 0.75 + stripsB * 0.18 * band(0.006, foot) + scars * 0.15 + rough * 0.3 - fiss * 0.7;
  float hYoung = lent * 0.5 + grain * 0.15;
  float h = mix(hYoung * 0.0012, hOld * 0.009, age);

  // Bump from the procedural height (world-scaled Mikkelsen perturbation).
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 nb = abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2);
  nb = dot(nb, nb) > 1e-20 ? normalize(nb) : n;

  // Albedo.
  vec3 young = mix(vec3(0.07, 0.036, 0.034), vec3(0.1, 0.055, 0.048), grain);
  young = mix(young, vec3(0.26, 0.21, 0.17), lent);
  float plateTone = fract(vor.z * 7.13);
  vec3 old = mix(vec3(0.026, 0.021, 0.02), vec3(0.052, 0.043, 0.04), smoothstep(0.3, 0.9, plate) * (0.6 + 0.4 * strips));
  old = mix(old, vec3(0.085, 0.045, 0.036), smoothstep(0.82, 0.98, plateTone) * 0.7);
  old = mix(old, vec3(0.11, 0.098, 0.092), smoothstep(0.55, 0.85, stripsB) * 0.25);
  old = mix(old, vec3(0.16, 0.13, 0.105), scars * 0.5);
  old = mix(old, vec3(0.012, 0.01, 0.01), max(1.0 - crev, fiss * 0.7) * 0.85);
  vec3 albedo = mix(young, old, age);

  // Lichen on the tops of older limbs.
  float upward = saturate(nb.y * 1.4 - 0.1);
  float lichN = fbm3(vRest * 3.1) + vnoise3(vRest * 17.0) * 0.25;
  float lich = smoothstep(0.62, 0.8, lichN) * mix(upward, 0.35, age * 0.6) * smoothstep(0.02, 0.12, r);
  lich *= smoothstep(0.35, 0.6, vnoise3(vRest * 9.0));
  albedo = mix(albedo, mix(vec3(0.17, 0.19, 0.15), vec3(0.27, 0.28, 0.23), vnoise3(vRest * 40.0)), lich * 0.6);
  // Moss and earth where wood meets the soil.
  float low = 1.0 - smoothstep(0.0, mix(0.5, 0.12, isRoot), vWorld.y + 0.1);
  float mossN = smoothstep(0.35, 0.65, fbm3(vRest * 6.0));
  albedo = mix(albedo, mix(vec3(0.05, 0.075, 0.025), vec3(0.08, 0.06, 0.04), mossN), low * 0.75);

  float roughness = mix(0.42, 0.88, age);
  roughness = mix(roughness, 0.95, max(lich, low));

  // Lighting.
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 l = uSunDir;
  float rot = ign(gl_FragCoord.xy) * TAU;
  float sh = shadowSoft(vWorld + n * 0.02, 0.02, rot);
  vec2 cl = canopyLight(vWorld);
  float ndl = saturate(dot(nb, l));
  float cavity = mix(1.0, saturate(0.35 + plateSoft * 0.75), age) * (1.0 - fiss * 0.6 * age);
  vec3 sun = uSunColor * ndl * sh;
  vec3 amb = ambientLight(nb) * (0.25 + 0.75 * cl.r) * ao * cavity;
  // Faint warm bounce from the sunlit blossoms around the limbs.
  amb += vec3(1.0, 0.72, 0.74) * uSunColor * 0.012 * cl.r * (1.0 - cl.g) * ao;
  vec3 col = albedo * (sun + amb);
  col += uSunColor * ggxSpec(nb, v, l, roughness) * sh * mix(0.6, 0.25, age);
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
#endif
}
`;

export function createBarkMaterials() {
  const uniforms = lightingUniforms();
  const color = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
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
  geo.setIndex(new THREE.BufferAttribute(mesh.index, 1));
  geo.computeBoundingSphere();
  return geo;
}
