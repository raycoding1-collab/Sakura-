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

  // Old bark relief: rough horizontal strips and lenticel scars, cut by
  // meandering vertical crevices.
  vec2 warp = vec2(vnoise3(vec3(cyl * 3.0, s * 1.5)), vnoise3(vec3(cyl * 3.0 + 9.0, s * 1.5))) - 0.5;
  float strips = vnoise3(vec3(cyl * 6.0 + warp.x * 2.0, s * 15.0 + 3.0));
  float stripsB = vnoise3(vec3(cyl * 16.0, s * 90.0 + warp.y * 6.0));
  float scars = smoothstep(0.6, 0.78, vnoise3(vec3(cyl * 10.0, s * 140.0))) * band(0.004, foot);
  float crev = 1.0 - abs(vnoise3(vec3(cyl * 11.0 + warp * 3.0, s * 1.8 + vRest.y * 0.4)) * 2.0 - 1.0);
  float fiss = smoothstep(0.84, 0.985, crev) * band(0.012, foot);
  float rough = fbm3(vRest * 34.0) * band(0.006, foot);
  float hOld = strips * 0.5 + stripsB * 0.3 * band(0.006, foot) + scars * 0.25 + rough * 0.35 - fiss * 0.8;
  float hYoung = lent * 0.5 + grain * 0.15;
  float h = mix(hYoung * 0.0012, hOld * 0.006, age);

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
  vec3 old = mix(vec3(0.038, 0.032, 0.03), vec3(0.085, 0.075, 0.07), smoothstep(0.4, 0.8, strips) * 0.85);
  old = mix(old, vec3(0.12, 0.105, 0.1), smoothstep(0.55, 0.85, stripsB) * 0.3);
  old = mix(old, vec3(0.19, 0.15, 0.12), scars * 0.6);
  old = mix(old, vec3(0.016, 0.013, 0.012), fiss * 0.6);
  vec3 albedo = mix(young, old, age);

  // Lichen on the tops of older limbs.
  float upward = saturate(nb.y * 1.4 - 0.1);
  float lichN = fbm3(vRest * 3.1) + vnoise3(vRest * 17.0) * 0.25;
  float lich = smoothstep(0.52, 0.72, lichN) * mix(upward, 0.55, age * 0.6) * smoothstep(0.02, 0.12, r);
  albedo = mix(albedo, mix(vec3(0.2, 0.22, 0.17), vec3(0.3, 0.31, 0.25), vnoise3(vRest * 40.0)), lich * 0.7);
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
  float cavity = mix(1.0, saturate(0.5 + hOld * 0.7), age) * (1.0 - fiss * 0.6 * age);
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
