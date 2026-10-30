import * as THREE from 'three';
import { Noise } from '../core/noise.js';
import { smoothstep } from '../core/vec.js';
import { COMMON, WIND, ATMOS, SHADOW, CANOPY } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';
import { SUN } from './atmosphere.js';
import { gardenHeight, LAYOUT_GLSL, GRAVEL, WATER_Y } from '../garden/layout.js';

// The land: a garden on a broad knoll — moss, raked gravel, a pebble beach
// around the koi pond — falling away beyond the fence into a hazy valley.

const noise = new Noise(4242);
const sunAz = SUN.azimuth;
const sunX = Math.cos(sunAz), sunZ = Math.sin(sunAz);

function rawHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = 1.1 * Math.exp(-(r * r) / (30 * 30));
  const fall = smoothstep(32, 180, r);
  const toward = r > 1e-3 ? (x * sunX + z * sunZ) / r : 0;
  h -= fall * (13 + 7 * Math.max(0, toward));
  h += noise.fbm2(x * 0.012 + 3.1, z * 0.012 - 1.7, 5) * (0.35 + 11 * smoothstep(30, 300, r));
  h += noise.fbm2(x * 0.09, z * 0.09, 3) * 0.08 * (1 - smoothstep(30, 80, r));
  h += noise.noise2(x * 0.42, z * 0.42) * 0.02;
  return h;
}

// The garden is laid out relative to the knoll's crest; the world origin sits
// on the ground at the foot of the tree.
const RAW0 = rawHeight(0, 0);
const OFFSET = gardenHeight(0, 0, 0);
export function groundHeight(x, z) {
  return gardenHeight(x, z, rawHeight(x, z) - RAW0) - OFFSET;
}
export const WATER_LEVEL = WATER_Y - OFFSET;

export function groundNormal(x, z, out = [0, 1, 0]) {
  const e = 0.12;
  const hx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const hz = groundHeight(x, z + e) - groundHeight(x, z - e);
  const l = Math.hypot(hx, 2 * e, hz);
  out[0] = -hx / l; out[1] = (2 * e) / l; out[2] = -hz / l;
  return out;
}

export const TERRAIN_GLSL = LAYOUT_GLSL + /* glsl */ `
vec3 voronoi2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(i + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = hash12(i + g + 7.7); }
      else if (d < d2) d2 = d;
    }
  return vec3(sqrt(d1), sqrt(d2), id);
}

// Rake pattern: concentric ripples around each stone, a band following the
// edge of the court, straight furrows everywhere else.
float rakeCoord(vec2 p, out float ringZone) {
  const float spacing = 0.09;
  float nearest = 1e3;
  for (int i = 0; i < GRAVEL_STONES.length(); i++) {
    nearest = min(nearest, length(p - GRAVEL_STONES[i].xy) - GRAVEL_STONES[i].z * 1.1);
  }
  float edge = -gravelSDF(p);
  vec2 axis = vec2(cos(${GRAVEL[4]}), sin(${GRAVEL[4]}));
  float across = dot(p - vec2(${GRAVEL[0]}, ${GRAVEL[1]}), vec2(-axis.y, axis.x));
  ringZone = step(nearest, 0.72);
  if (nearest < 0.72) return nearest / spacing;
  if (edge < 0.36) return edge / spacing;
  return across / spacing;
}
`;

export function createTerrain() {
  // Polar mesh: fine rings through the garden, then growing toward the horizon.
  const seg = 760;
  const radii = [];
  for (let r = 0.25; r < 34; r += r < 20 ? 0.16 : 0.22) radii.push(r);
  let r = radii[radii.length - 1];
  while (r < 1400) {
    r *= 1.045;
    radii.push(Math.min(r, 1400));
  }
  const rings = radii.length;
  const verts = 1 + rings * seg;
  const pos = new Float32Array(verts * 3);
  pos[0] = 0; pos[1] = groundHeight(0, 0); pos[2] = 0;
  let v = 1;
  for (let i = 0; i < rings; i++) {
    const rr = radii[i];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2 + (i % 2) * (Math.PI / seg);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      pos[v * 3] = x; pos[v * 3 + 1] = groundHeight(x, z); pos[v * 3 + 2] = z;
      v++;
    }
  }
  const idx = new Uint32Array(seg * 3 + (rings - 1) * seg * 6);
  let k = 0;
  for (let j = 0; j < seg; j++) { idx[k++] = 0; idx[k++] = 1 + ((j + 1) % seg); idx[k++] = 1 + j; }
  for (let i = 1; i < rings; i++) {
    const a = 1 + (i - 1) * seg, b = 1 + i * seg;
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      idx[k++] = a + j; idx[k++] = a + j1; idx[k++] = b + j;
      idx[k++] = a + j1; idx[k++] = b + j1; idx[k++] = b + j;
    }
  }
  const nrm = new Float32Array(verts * 3);
  const tmp = [0, 0, 0];
  for (let q = 0; q < verts; q++) {
    groundNormal(pos[q * 3], pos[q * 3 + 2], tmp);
    nrm[q * 3] = tmp[0]; nrm[q * 3 + 1] = tmp[1]; nrm[q * 3 + 2] = tmp[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1400);

  const vertexShader = /* glsl */ `
    varying vec3 vWorld;
    varying vec3 vNormal;
    void main() {
      vWorld = position;
      vNormal = normal;
      gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
    }`;

  const material = new THREE.ShaderMaterial({
    uniforms: lightingUniforms(),
    vertexShader,
    fragmentShader: COMMON + WIND + ATMOS + SHADOW + CANOPY + TERRAIN_GLSL + /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;

      vec3 meadow(vec2 p, float fine) {
        float patch1 = fbm2(p * 0.07 + 4.0);
        float patch2 = fbm2(p * 0.31 - 2.0);
        vec3 c = mix(vec3(0.035, 0.07, 0.02), vec3(0.1, 0.1, 0.04), smoothstep(0.42, 0.7, patch1) * 0.75);
        c = mix(c, vec3(0.022, 0.045, 0.016), smoothstep(0.55, 0.8, patch2) * 0.6);
        return c * (0.78 + 0.44 * fine);
      }

      void main() {
        vec3 n = normalize(vNormal);
        vec3 wp = vWorld;
        vec2 p = wp.xz;
        float r = length(p);
        float camDist = length(wp - cameraPosition);
        float fade = 1.0 - smoothstep(6.0, 40.0, camDist);
        float fine = vnoise2(p * 6.0) * 0.6 + vnoise2(p * 23.0) * 0.4;

        float pond = pondSDF(p);
        float gravelD = gravelSDF(p);
        float garden = 1.0 - smoothstep(GARDEN_R - 1.5, GARDEN_R + 2.0, r);

        // ---- Material masks ---------------------------------------------------
        float bed = 1.0 - smoothstep(-0.05, 0.05, pond);
        float beach = (1.0 - smoothstep(0.25, 0.75, pond + (vnoise2(p * 2.0) - 0.5) * 0.3)) * (1.0 - bed);
        float gravel = (1.0 - smoothstep(-0.015, 0.015, gravelD)) * (1.0 - bed);
        float soil = (1.0 - smoothstep(0.9, 2.6 + vnoise2(p * 1.3) * 1.2, r)) * (1.0 - bed);

        // ---- Relief and albedo --------------------------------------------------
        float hgt = 0.0;
        vec3 albedo;
        float rough = 0.9;
        float sheen = 0.0;

        // Moss: velvety cushions of sugigoke.
        float cushion = fbm2(p * 2.6);
        float fuzz = vnoise2(p * 38.0);
        vec3 moss = mix(vec3(0.02, 0.05, 0.012), vec3(0.06, 0.13, 0.022), smoothstep(0.3, 0.75, cushion));
        moss = mix(moss, vec3(0.12, 0.17, 0.035), smoothstep(0.6, 0.95, cushion + fuzz * 0.25) * 0.6);
        moss *= 0.85 + 0.3 * fuzz;
        float hMoss = cushion * 0.025 + fuzz * 0.004;
        vec3 ground = mix(meadow(p, fine), moss, garden);
        albedo = ground;
        hgt = mix(vnoise2(p * 9.0) * 0.012, hMoss, garden);
        sheen = garden * 0.35;

        // Soil and roots under the old tree.
        vec3 earth = mix(vec3(0.06, 0.042, 0.03), vec3(0.04, 0.07, 0.022), smoothstep(0.4, 0.75, fine));
        albedo = mix(albedo, earth, soil);
        hgt = mix(hgt, fine * 0.01, soil);

        // Raked white gravel.
        if (gravel > 0.0) {
          float ringZone;
          float rc = rakeCoord(p, ringZone);
          float ridge = 0.5 + 0.5 * cos(rc * TAU);
          float grain = vnoise2(p * 140.0);
          float stoneLip = 0.0;
          for (int i = 0; i < GRAVEL_STONES.length(); i++)
            stoneLip = max(stoneLip, 1.0 - smoothstep(0.0, 0.12, length(p - GRAVEL_STONES[i].xy) - GRAVEL_STONES[i].z));
          float rakeFade = 1.0 - smoothstep(0.6, 1.4, fwidth(rc));
          float hg = ridge * 0.014 * rakeFade + grain * 0.002;
          vec3 g = mix(vec3(0.34, 0.33, 0.31), vec3(0.5, 0.49, 0.46), grain);
          g *= 0.88 + 0.12 * mix(0.5, ridge, rakeFade);
          albedo = mix(albedo, g, gravel);
          hgt = mix(hgt, hg, gravel);
          sheen *= 1.0 - gravel;
          albedo = mix(albedo, albedo * 0.7, stoneLip * gravel);
        }

        // Pebble beach (suhama) along the water.
        if (beach > 0.0) {
          vec3 vo = voronoi2(p * 16.0);
          float pebble = smoothstep(0.0, 0.18, vo.y - vo.x);
          float dome = (1.0 - vo.x * vo.x) * pebble;
          vec3 pc = mix(vec3(0.16, 0.15, 0.14), vec3(0.36, 0.34, 0.31), vo.z);
          pc = mix(pc, vec3(0.08, 0.075, 0.07), step(0.82, vo.z));
          pc = mix(vec3(0.05, 0.045, 0.04), pc, pebble);
          float wet = 1.0 - smoothstep(0.0, 0.3, pond);
          pc *= mix(1.0, 0.55, wet);
          albedo = mix(albedo, pc, beach);
          hgt = mix(hgt, dome * 0.02, beach);
          rough = mix(rough, mix(0.7, 0.25, wet), beach);
          sheen *= 1.0 - beach;
        }

        // Pond bed: silt with scattered stones.
        if (bed > 0.0) {
          vec3 vo = voronoi2(p * 5.0);
          float stone = smoothstep(0.55, 0.9, vo.z) * smoothstep(0.0, 0.2, vo.y - vo.x);
          vec3 silt = mix(vec3(0.045, 0.045, 0.028), vec3(0.03, 0.04, 0.025), fine);
          albedo = mix(albedo, mix(silt, vec3(0.09, 0.085, 0.075), stone), bed);
          hgt = mix(hgt, stone * 0.03, bed);
        }

        // Bump.
        vec3 dpx = dFdx(wp), dpy = dFdy(wp);
        vec2 dh = vec2(dFdx(hgt), dFdy(hgt)) * fade;
        vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
        float det = dot(dpx, r1);
        vec3 nb = abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2);
        if (dot(nb, nb) > 1e-20) n = normalize(nb);

        // Fallen petals gather on the ground beneath the crown.
        float under = 1.0 - smoothstep(4.0, 10.5, length(p));
        float carpet = under * smoothstep(0.35, 0.75, vnoise2(p * 7.0) * 0.6 + vnoise2(p * 1.3) * 0.5) * (1.0 - bed) * (1.0 - gravel * 0.6);
        albedo = mix(albedo, vec3(0.62, 0.38, 0.45), carpet * 0.32);

        // ---- Lighting -------------------------------------------------------------
        vec3 v = normalize(cameraPosition - wp);
        vec3 l = uSunDir;
        float rot = ign(gl_FragCoord.xy) * TAU;
        float sh = shadowSoft(wp + n * 0.03, 0.03, rot);
        vec2 cl = canopyLight(wp + vec3(0.0, 0.25, 0.0));
        float ndl = saturate(dot(n, l));
        float wrap = saturate((dot(n, l) + 0.25) / 1.25);
        vec3 sun = uSunColor * mix(ndl, wrap, 0.5) * sh;
        vec3 amb = ambientLight(n) * (0.3 + 0.7 * cl.r);
        vec3 lamp = localLight(wp + n * 0.05, n, 0.2);
        vec3 col = albedo * (sun + amb + lamp);
        // Velvet sheen of the moss, strongest at grazing light.
        float rim = pow(1.0 - saturate(dot(n, v)), 3.0);
        col += sheen * rim * (uSunColor * sh * 0.06 + amb * 0.2) * vec3(0.7, 1.0, 0.45);
        col += uSunColor * sh * ggxSpec(n, v, l, rough) * (1.0 - garden * 0.7) * 0.5;
        col = applyFog(col, wp);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}
