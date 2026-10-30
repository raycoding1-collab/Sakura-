import * as THREE from 'three';
import { Noise } from '../core/noise.js';
import { smoothstep } from '../core/vec.js';
import { COMMON, WIND, ATMOS, SHADOW, CANOPY } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';
import { SUN } from './atmosphere.js';

// A soft grassy knoll for the tree, falling away into a hazy valley.

const noise = new Noise(4242);
const sunAz = SUN.azimuth;
const sunX = Math.cos(sunAz), sunZ = Math.sin(sunAz);

function rawHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = 1.1 * Math.exp(-(r * r) / (26 * 26));
  const fall = smoothstep(26, 170, r);
  const toward = r > 1e-3 ? (x * sunX + z * sunZ) / r : 0;
  h -= fall * (13 + 7 * Math.max(0, toward));
  h += noise.fbm2(x * 0.012 + 3.1, z * 0.012 - 1.7, 5) * (0.5 + 11 * smoothstep(25, 300, r));
  h += noise.fbm2(x * 0.09, z * 0.09, 3) * 0.16 * (1 - smoothstep(30, 80, r));
  h += noise.noise2(x * 0.42, z * 0.42) * 0.035;
  return h;
}

const H0 = rawHeight(0, 0);
export function groundHeight(x, z) {
  return rawHeight(x, z) - H0;
}

export function groundNormal(x, z, out = [0, 1, 0]) {
  const e = 0.25;
  const hx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const hz = groundHeight(x, z + e) - groundHeight(x, z - e);
  const l = Math.hypot(hx, 2 * e, hz);
  out[0] = -hx / l; out[1] = (2 * e) / l; out[2] = -hz / l;
  return out;
}

export const TERRAIN_GLSL = /* glsl */ `
uniform vec2 uTreeFoot; // canopy footprint radius, petal spread
vec3 meadowColor(vec3 wp, float shadeNoise) {
  vec2 p = wp.xz;
  float r = length(p);
  float patch1 = fbm2(p * 0.07 + 4.0);
  float patch2 = fbm2(p * 0.31 - 2.0);
  float fine = vnoise2(p * 6.0) * 0.6 + vnoise2(p * 23.0) * 0.4;
  vec3 lush = vec3(0.035, 0.07, 0.02);
  vec3 dry = vec3(0.1, 0.1, 0.04);
  vec3 deep = vec3(0.022, 0.045, 0.016);
  vec3 c = mix(lush, dry, smoothstep(0.42, 0.7, patch1) * 0.75);
  c = mix(c, deep, smoothstep(0.55, 0.8, patch2) * 0.6);
  c *= 0.78 + 0.44 * fine;
  // Bare soil and moss around the trunk foot.
  float soil = 1.0 - smoothstep(0.7, 2.2 + patch2 * 1.2, r);
  vec3 earth = mix(vec3(0.075, 0.05, 0.035), vec3(0.06, 0.09, 0.03), smoothstep(0.4, 0.7, fine));
  c = mix(c, earth, soil);
  return c;
}
`;

export function createTerrain() {
  const rings = 230, seg = 300, Rmax = 1400;
  const verts = 1 + rings * seg;
  const pos = new Float32Array(verts * 3);
  pos[0] = 0; pos[1] = groundHeight(0, 0); pos[2] = 0;
  let v = 1;
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    const r = 0.35 + Rmax * Math.pow(t, 2.6);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2 + (i % 2) * (Math.PI / seg);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos[v * 3] = x; pos[v * 3 + 1] = groundHeight(x, z); pos[v * 3 + 2] = z;
      v++;
    }
  }
  const idx = [];
  for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
  for (let i = 1; i < rings; i++) {
    const a = 1 + (i - 1) * seg, b = 1 + i * seg;
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      idx.push(a + j, a + j1, b + j);
      idx.push(a + j1, b + j1, b + j);
    }
  }
  const nrm = new Float32Array(verts * 3);
  const tmp = [0, 0, 0];
  for (let k = 0; k < verts; k++) {
    groundNormal(pos[k * 3], pos[k * 3 + 2], tmp);
    nrm[k * 3] = tmp[0]; nrm[k * 3 + 1] = tmp[1]; nrm[k * 3 + 2] = tmp[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Rmax);

  const vertexShader = /* glsl */ `
    varying vec3 vWorld;
    varying vec3 vNormal;
    void main() {
      vWorld = position;
      vNormal = normal;
      gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
    }`;

  const material = new THREE.ShaderMaterial({
    uniforms: lightingUniforms({ uTreeFoot: { value: new THREE.Vector2(7.5, 10) } }),
    vertexShader,
    fragmentShader: COMMON + WIND + ATMOS + SHADOW + CANOPY + TERRAIN_GLSL + /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 wp = vWorld;
        // Micro relief of the turf.
        float hgt = vnoise2(wp.xz * 9.0) * 0.012 + vnoise2(wp.xz * 31.0) * 0.004;
        vec3 dpx = dFdx(wp), dpy = dFdy(wp);
        float fade = 1.0 - smoothstep(4.0, 30.0, length(wp - cameraPosition));
        vec2 dh = vec2(dFdx(hgt), dFdy(hgt)) * fade;
        vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
        float det = dot(dpx, r1);
        vec3 nb = abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2);
        if (dot(nb, nb) > 1e-20) n = normalize(nb);

        vec3 albedo = meadowColor(wp, 0.0);
        // Fallen petals carpet the ground beneath the crown.
        float r = length(wp.xz - vec2(0.6, -0.3));
        float under = 1.0 - smoothstep(uTreeFoot.x * 0.55, uTreeFoot.y, r);
        float drift = 1.0 - smoothstep(0.0, 1.0, length((wp.xz - uWindDir * 4.0) / vec2(14.0, 11.0)));
        float carpet = max(under, drift * 0.6) * smoothstep(0.35, 0.75, vnoise2(wp.xz * 7.0) * 0.6 + vnoise2(wp.xz * 1.3) * 0.5);
        albedo = mix(albedo, vec3(0.62, 0.45, 0.48), carpet * 0.3);

        vec3 l = uSunDir;
        float rot = ign(gl_FragCoord.xy) * TAU;
        float sh = shadowSoft(wp + n * 0.03, 0.03, rot);
        vec2 cl = canopyLight(wp + vec3(0.0, 0.25, 0.0));
        float ndl = saturate(dot(n, l));
        // Grass is never a perfect Lambertian: a little wrap for the low sun.
        float wrap = saturate((dot(n, l) + 0.25) / 1.25);
        vec3 sun = uSunColor * mix(ndl, wrap, 0.6) * sh;
        vec3 amb = ambientLight(n) * (0.35 + 0.65 * cl.r);
        vec3 col = albedo * (sun + amb);
        col = applyFog(col, wp);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.userData.receivesShadowOnly = true;
  return mesh;
}

