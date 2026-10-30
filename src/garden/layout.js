// The garden plan. Every feature is described once here, as plain numbers and
// signed-distance functions, and exported both to JavaScript (terrain heights,
// placement) and to GLSL (ground materials, water), so they always agree.
//
// Plan (metres, +x east, +z south): the old weeping cherry stands at the
// origin on a low mound. A three-lobed koi pond lies to its south-west with a
// small rock island; a vermilion arched bridge crosses its waist. North-east
// of the tree is a raked-gravel court with a three-stone group. A mossy
// artificial hill and a bamboo fence close the garden on the pond side; toward
// the sunset the garden opens onto the valley and the far ridges (shakkei).

export const WATER_Y = -0.3;
export const GARDEN_R = 27;

// Pond as a smooth union of rotated ellipses: [cx, cz, rx, rz, angle].
export const POND_LOBES = [
  [-8.8, 6.6, 7.2, 4.1, 0.55],
  [-3.7, 3.3, 2.9, 1.9, 0.45],
  [-3.2, 12.9, 3.8, 1.25, -0.12],
  [1.9, 14.3, 3.1, 2.3, 0.2],
  [-15.0, 9.8, 3.0, 2.2, 0.3],
];
export const ISLAND = [-10.4, 6.6, 1.45];
// Arched bridge across the narrow channel: [x0, z0, x1, z1].
export const BRIDGE = [-1.9, 10.55, -2.25, 15.25];

// Raked gravel court: ellipse [cx, cz, rx, rz, angle] and its stone triad.
export const GRAVEL = [7.4, -7.2, 6.2, 4.2, -0.45];
export const GRAVEL_STONES = [
  [6.3, -6.6, 0.95],
  [8.6, -8.2, 0.6],
  [9.4, -5.4, 0.45],
];

// Tsukiyama: mossy artificial hills [cx, cz, radius, height].
export const HILLS = [
  [-13.5, 15.5, 6.5, 1.5],
  [-18.5, 4.0, 5.0, 1.0],
  [3.5, 15.5, 4.5, 0.7],
];

export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function ellipseSDF(x, z, e) {
  const dx = x - e[0], dz = z - e[1];
  const c = Math.cos(e[4]), s = Math.sin(e[4]);
  const u = (dx * c + dz * s) / e[2];
  const v = (-dx * s + dz * c) / e[3];
  const k = Math.hypot(u, v);
  return (k - 1) * Math.min(e[2], e[3]);
}

export function pondSDF(x, z) {
  let d = 1e9;
  for (const e of POND_LOBES) d = smin(d, ellipseSDF(x, z, e), 2.2);
  // Gentle irregularity of the bank line.
  d += Math.sin(x * 1.3 + z * 0.4) * 0.12 + Math.sin(z * 1.7 - x * 0.6) * 0.08;
  // The island is land.
  const island = Math.hypot(x - ISLAND[0], z - ISLAND[1]) - ISLAND[2];
  return Math.max(d, -island);
}

export function gravelSDF(x, z) {
  return ellipseSDF(x, z, GRAVEL);
}

// Ground height of the garden, added to the regional terrain.
export function gardenHeight(x, z, base) {
  const r = Math.hypot(x, z);
  let h = base;
  // Low mound under the old tree.
  h += 0.32 * Math.exp(-(r * r) / 30);
  for (const [cx, cz, rad, hh] of HILLS) {
    const d = Math.hypot(x - cx, z - cz) / rad;
    h += hh * Math.exp(-d * d * 2.2);
  }
  // Gravel court sits a touch lower, edged by a crisp step.
  const g = gravelSDF(x, z);
  h -= 0.06 * (1 - smoothstep(-0.05, 0.08, g));

  // Pond basin and banks, relative to the water line.
  const d = pondSDF(x, z);
  if (d < 1.6) {
    const bank = WATER_Y + 0.07 + 0.25 * smoothstep(0.0, 1.6, d);
    if (d >= 0) {
      h = h + (bank - h) * (1 - smoothstep(0.0, 1.6, d));
    } else {
      const depth = 0.12 + 0.62 * smoothstep(0.0, 2.6, -d);
      h = WATER_Y - depth;
    }
  }
  const isl = Math.hypot(x - ISLAND[0], z - ISLAND[1]);
  if (isl < ISLAND[2] + 0.4) {
    const t = 1 - smoothstep(0, ISLAND[2] + 0.4, isl);
    h = Math.max(h, WATER_Y - 0.1 + 0.55 * t);
  }
  return h;
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// GLSL twin of the distance functions above.
const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
export const LAYOUT_GLSL = /* glsl */ `
const float WATER_Y = ${f(WATER_Y)};
const float GARDEN_R = ${f(GARDEN_R)};
float sminf(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float ellipseSDF(vec2 p, vec2 c, vec2 r, float ang) {
  vec2 d = p - c;
  float co = cos(ang), si = sin(ang);
  vec2 q = vec2(d.x * co + d.y * si, -d.x * si + d.y * co) / r;
  return (length(q) - 1.0) * min(r.x, r.y);
}
float pondSDF(vec2 p) {
  float d = 1e9;
${POND_LOBES.map((e) => `  d = sminf(d, ellipseSDF(p, vec2(${f(e[0])}, ${f(e[1])}), vec2(${f(e[2])}, ${f(e[3])}), ${f(e[4])}), 2.2);`).join('\n')}
  d += sin(p.x * 1.3 + p.y * 0.4) * 0.12 + sin(p.y * 1.7 - p.x * 0.6) * 0.08;
  float island = length(p - vec2(${f(ISLAND[0])}, ${f(ISLAND[1])})) - ${f(ISLAND[2])};
  return max(d, -island);
}
float gravelSDF(vec2 p) {
  return ellipseSDF(p, vec2(${f(GRAVEL[0])}, ${f(GRAVEL[1])}), vec2(${f(GRAVEL[2])}, ${f(GRAVEL[3])}), ${f(GRAVEL[4])});
}
const vec3 GRAVEL_STONES[${GRAVEL_STONES.length}] = vec3[](${GRAVEL_STONES.map((s) => `vec3(${f(s[0])}, ${f(s[1])}, ${f(s[2])})`).join(', ')});
`;
