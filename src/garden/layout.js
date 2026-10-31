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
  // The waterfall hill and the rise the stream comes down through.
  [-2.4, -20.4, 5.6, 2.6],
  [-7.2, -19.4, 4.6, 1.5],
  [2.4, -19.6, 4.2, 1.25],
  [-0.6, -24.5, 6.0, 1.6],
  [-5.4, -12.8, 5.0, 0.5],
];

// Mountain stream (yarimizu). It leaves a plunge pool under a two-metre
// waterfall north of the tree, winds south past the west edge of the crown
// in pools and riffles, and runs into the pond. [x, z, half-width, water level]
export const STREAM = [
  [-2.55, -16.0, 1.05, 0.45],
  [-3.85, -14.15, 0.55, 0.41],
  [-5.55, -12.35, 0.5, 0.27],
  [-6.45, -9.95, 0.62, 0.17],
  [-6.0, -7.55, 0.5, 0.06],
  [-7.0, -5.25, 0.58, -0.05],
  [-7.95, -3.0, 0.74, -0.14],
  [-7.6, -0.8, 0.64, -0.22],
  [-6.7, 1.0, 0.85, -0.28],
  [-5.9, 2.7, 1.15, -0.3],
];
// The waterfall: the lip it pours over, the direction it leaves in, its width.
export const FALLS = { lip: [-2.42, 1.8, -17.25], dir: [-0.12, 0.99], width: 0.6 };

// The stream's centreline, sampled finely from a Catmull-Rom spline through
// the control points. Levels hold flat in the pools at each control point and
// fall through the riffles between them.
export const STREAM_COURSE = (() => {
  const P = STREAM;
  const n = P.length;
  const at = (i) => P[Math.max(0, Math.min(n - 1, i))];
  const x = [], z = [], hw = [], wl = [], s = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(4, Math.ceil(len / 0.1));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      x.push(cr(p0[0], p1[0], p2[0], p3[0]));
      z.push(cr(p0[1], p1[1], p2[1], p3[1]));
      const u = t * t * (3 - 2 * t);
      hw.push(p1[2] + (p2[2] - p1[2]) * u);
      const f = Math.min(1, Math.max(0, (t - 0.22) / 0.56));
      wl.push(p1[3] + (p2[3] - p1[3]) * f * f * (3 - 2 * f));
    }
  }
  const last = P[n - 1];
  x.push(last[0]); z.push(last[1]); hw.push(last[2]); wl.push(last[3]);
  s.push(0);
  for (let i = 1; i < x.length; i++) s.push(s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < x.length; i++) {
    minX = Math.min(minX, x[i] - hw[i]); maxX = Math.max(maxX, x[i] + hw[i]);
    minZ = Math.min(minZ, z[i] - hw[i]); maxZ = Math.max(maxZ, z[i] + hw[i]);
  }
  return { x, z, hw, wl, s, length: s[s.length - 1], box: [minX, maxX, minZ, maxZ] };
})();

// Nearest point of the stream: distance from the centreline, arc length,
// half-width, water level, the flow direction, and which bank (+1 left).
export function streamInfo(px, pz, margin = 4.5) {
  const C = STREAM_COURSE;
  const [x0, x1, z0, z1] = C.box;
  if (px < x0 - margin || px > x1 + margin || pz < z0 - margin || pz > z1 + margin) return null;
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 0; i < C.x.length - 1; i++) {
    const ax = C.x[i], az = C.z[i];
    const dx = C.x[i + 1] - ax, dz = C.z[i + 1] - az;
    const l2 = dx * dx + dz * dz;
    let t = ((px - ax) * dx + (pz - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - px, ez = az + dz * t - pz;
    const d2 = ex * ex + ez * ez;
    if (d2 < best) { best = d2; bi = i; bt = t; }
  }
  const i = bi, t = bt;
  const dx = C.x[i + 1] - C.x[i], dz = C.z[i + 1] - C.z[i];
  const l = Math.hypot(dx, dz) || 1;
  const tx = dx / l, tz = dz / l;
  const side = (px - C.x[i]) * -tz + (pz - C.z[i]) * tx;
  return {
    d: Math.sqrt(best),
    s: C.s[i] + (C.s[i + 1] - C.s[i]) * t,
    hw: C.hw[i] + (C.hw[i + 1] - C.hw[i]) * t,
    wl: C.wl[i] + (C.wl[i + 1] - C.wl[i]) * t,
    tx, tz,
    side: side >= 0 ? 1 : -1,
  };
}

// The same, from a precomputed 0.2 m grid: for things that ask every frame.
const GRID = (() => {
  const [x0, x1, z0, z1] = STREAM_COURSE.box;
  const m = 1.5, cell = 0.2;
  const ox = x0 - m, oz = z0 - m;
  const nx = Math.ceil((x1 - x0 + 2 * m) / cell), nz = Math.ceil((z1 - z0 + 2 * m) / cell);
  const bank = new Float32Array(nx * nz).fill(99), level = new Float32Array(nx * nz), arc = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const st = streamInfo(ox + (i + 0.5) * cell, oz + (j + 0.5) * cell, m);
      if (!st) continue;
      bank[j * nx + i] = st.d - st.hw;
      level[j * nx + i] = st.wl;
      arc[j * nx + i] = st.s;
    }
  return { ox, oz, nx, nz, cell, bank, level, arc };
})();
export function streamLookup(x, z, out = {}) {
  const g = GRID;
  const i = Math.floor((x - g.ox) / g.cell), j = Math.floor((z - g.oz) / g.cell);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) { out.bank = 99; return out; }
  const k = j * g.nx + i;
  out.bank = g.bank[k]; out.level = g.level[k]; out.s = g.arc[k];
  return out;
}

// Depth of the stream bed below the surface, by distance from the centreline.
export function streamDepth(d, hw) {
  const k = Math.min(1, d / hw);
  const deep = 0.17 + 0.3 * Math.min(1, Math.max(0, (hw - 0.6) / 0.45));
  return 0.04 + deep * (1 - k * k);
}

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
  // The stream runs in a shallow valley of its own.
  const st = streamInfo(x, z);
  if (st) {
    const valley = st.wl + 0.09 + 0.17 * Math.max(0, st.d - st.hw - 0.25);
    const w = 1 - smoothstep(st.hw + 0.5, st.hw + 3.8, st.d);
    h += (valley - h) * w;
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
  // The stream's channel, carved last so it stays open into the pond.
  if (st && st.d < st.hw + 0.25) {
    const bank = st.d < st.hw ? st.wl - streamDepth(st.d, st.hw) : st.wl - 0.04 + 0.14 * smoothstep(st.hw, st.hw + 0.25, st.d);
    h = Math.min(h, bank);
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
