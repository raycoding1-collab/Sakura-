// A small mesh builder for the garden's hand-made objects: surfaces of
// revolution with round or faceted sections, swept tubes and boards, boxes
// and fractured rocks. Every vertex carries a material id (aMat) and a
// two-component pattern coordinate (aUv) for the procedural surface shader,
// plus an optional sway pivot/weight (aSway) for parts that move in the wind.

import { Noise } from './noise.js';
import { RNG } from './rng.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.mat = [];
    this.sway = [];
    this.idx = [];
    this.swayState = [0, 0, 0, 0];
  }

  get count() {
    return this.pos.length / 3;
  }

  setSway(pivot, weight) {
    this.swayState = [pivot[0], pivot[1], pivot[2], weight];
  }

  clearSway() {
    this.swayState = [0, 0, 0, 0];
  }

  vertex(p, n, uv, mat) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.mat.push(mat);
    this.sway.push(...this.swayState);
    return this.count - 1;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  // Apply a 4x4 column-major matrix to vertices [from, count).
  transform(from, m) {
    for (let i = from; i < this.count; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      this.pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      this.pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      this.pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      const nx = this.nrm[i * 3], ny = this.nrm[i * 3 + 1], nz = this.nrm[i * 3 + 2];
      const n = norm([m[0] * nx + m[4] * ny + m[8] * nz, m[1] * nx + m[5] * ny + m[9] * nz, m[2] * nx + m[6] * ny + m[10] * nz]);
      this.nrm[i * 3] = n[0]; this.nrm[i * 3 + 1] = n[1]; this.nrm[i * 3 + 2] = n[2];
    }
  }

  // Surface of revolution. profile: [[radius, y], ...] bottom to top; a point
  // listed twice makes a hard edge. sides: polygon count; facets: flat sides
  // (hexagonal stone work) or smooth (round). shape(theta, y, r) may return a
  // modified [r, y] (e.g. upturned roof corners).
  lathe(profile, sides, { mat = 0, facets = false, angle0 = 0, shape = null, uvScale = 1 } = {}) {
    const start = this.count;
    // Profile normals (in r-y plane), per point, hard edges at duplicates.
    const pn = [];
    for (let i = 0; i < profile.length; i++) {
      const a = profile[Math.max(0, i - 1)], b = profile[Math.min(profile.length - 1, i + 1)];
      let dr = b[0] - a[0], dy = b[1] - a[1];
      const prevSame = i > 0 && profile[i - 1][0] === profile[i][0] && profile[i - 1][1] === profile[i][1];
      const nextSame = i < profile.length - 1 && profile[i + 1][0] === profile[i][0] && profile[i + 1][1] === profile[i][1];
      if (prevSame && i < profile.length - 1) { dr = profile[i + 1][0] - profile[i][0]; dy = profile[i + 1][1] - profile[i][1]; }
      if (nextSame && i > 0) { dr = profile[i][0] - profile[i - 1][0]; dy = profile[i][1] - profile[i - 1][1]; }
      const l = Math.hypot(dr, dy) || 1;
      pn.push([dy / l, -dr / l]);
    }
    let along = 0;
    const alongs = [0];
    for (let i = 1; i < profile.length; i++) {
      along += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
      alongs.push(along);
    }
    const cols = facets ? sides * 2 : sides + 1;
    for (let i = 0; i < profile.length; i++) {
      for (let c = 0; c < cols; c++) {
        let th, nth;
        if (facets) {
          const f = Math.floor(c / 2);
          th = angle0 + ((f + (c % 2)) / sides) * Math.PI * 2;
          nth = angle0 + ((f + 0.5) / sides) * Math.PI * 2;
        } else {
          th = angle0 + (c / sides) * Math.PI * 2;
          nth = th;
        }
        let r = profile[i][0], y = profile[i][1];
        if (shape) [r, y] = shape(th, y, r, i);
        const p = [Math.cos(th) * r, y, Math.sin(th) * r];
        const n = norm([Math.cos(nth) * pn[i][0], pn[i][1], Math.sin(nth) * pn[i][0]]);
        this.vertex(p, n, [(c / cols) * uvScale * Math.PI * 2 * Math.max(r, 0.05), alongs[i] * uvScale], mat);
      }
    }
    for (let i = 0; i < profile.length - 1; i++) {
      if (profile[i][0] === profile[i + 1][0] && profile[i][1] === profile[i + 1][1]) continue;
      for (let c = 0; c < cols - 1; c++) {
        if (facets && c % 2 === 1) continue;
        const a = start + i * cols + c, b = a + 1, cc = a + cols + 1, d = a + cols;
        this.quad(a, d, cc, b);
      }
    }
    return start;
  }

  // Tube swept along a polyline with parallel-transport frames.
  sweep(path, radius, sides, { mat = 0, closed = false, capStart = false, capEnd = false, twist = 0, uvScale = 1, radial = null } = {}) {
    const start = this.count;
    const n = path.length;
    const T = [], N = [], B = [];
    for (let i = 0; i < n; i++) {
      const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      T.push(norm(sub(b, a)));
    }
    let nn = Math.abs(T[0][1]) < 0.9 ? norm(cross(T[0], [0, 1, 0])) : norm(cross(T[0], [1, 0, 0]));
    for (let i = 0; i < n; i++) {
      const t = T[i];
      nn = norm(sub(nn, t.map((v) => v * dot(nn, t))));
      N.push(nn);
      B.push(cross(t, nn));
    }
    let along = 0;
    const rows = closed ? n + 1 : n;
    for (let ii = 0; ii < rows; ii++) {
      const i = ii % n;
      if (ii > 0) along += Math.hypot(...sub(path[i], path[(ii - 1) % n]));
      const rr = typeof radius === 'function' ? radius(ii / (rows - 1), i) : radius;
      for (let j = 0; j <= sides; j++) {
        const th = (j / sides) * Math.PI * 2 + twist * along;
        const cs = Math.cos(th), sn = Math.sin(th);
        const d = [N[i][0] * cs + B[i][0] * sn, N[i][1] * cs + B[i][1] * sn, N[i][2] * cs + B[i][2] * sn];
        const rk = radial ? rr * radial(th, along) : rr;
        const p = [path[i][0] + d[0] * rk, path[i][1] + d[1] * rk, path[i][2] + d[2] * rk];
        this.vertex(p, d, [(j / sides) * Math.PI * 2 * rr * uvScale, along * uvScale], mat);
      }
    }
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const a = start + i * (sides + 1) + j;
        this.quad(a, a + 1, a + sides + 2, a + sides + 1);
      }
    }
    const cap = (i, flip) => {
      const c = this.vertex(path[i], flip ? T[i].map((v) => -v) : T[i], [0, 0], mat);
      const ring = start + (i === 0 ? 0 : (rows - 1) * (sides + 1));
      const rr = typeof radius === 'function' ? radius(i === 0 ? 0 : 1, i) : radius;
      const first = this.count;
      for (let j = 0; j <= sides; j++) {
        const src = ring + j;
        const p = [this.pos[src * 3], this.pos[src * 3 + 1], this.pos[src * 3 + 2]];
        this.vertex(p, flip ? T[i].map((v) => -v) : T[i], [Math.cos((j / sides) * 6.283) * rr, Math.sin((j / sides) * 6.283) * rr], mat);
      }
      for (let j = 0; j < sides; j++) {
        if (flip) this.tri(c, first + j + 1, first + j);
        else this.tri(c, first + j, first + j + 1);
      }
    };
    if (capStart && !closed) cap(0, true);
    if (capEnd && !closed) cap(n - 1, false);
    return start;
  }

  // Rectangular board swept along a path; `up` gives the board's up vector.
  board(path, width, height, { mat = 0, up = () => [0, 1, 0], uvScale = 1 } = {}) {
    const start = this.count;
    const n = path.length;
    let along = 0;
    const frames = [];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
      const t = norm(sub(b, a));
      let u = up(i / (n - 1), path[i]);
      u = norm(sub(u, t.map((v) => v * dot(u, t))));
      const s = cross(t, u);
      if (i > 0) along += Math.hypot(...sub(path[i], path[i - 1]));
      frames.push({ t, u, s, along });
    }
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let f = 0; f < 4; f++) {
      const c0 = corners[f], c1 = corners[(f + 1) % 4];
      const base = this.count;
      for (let i = 0; i < n; i++) {
        const { u, s, along: al } = frames[i];
        const nrm = norm([
          s[0] * (c0[0] + c1[0]) + u[0] * (c0[1] + c1[1]),
          s[1] * (c0[0] + c1[0]) + u[1] * (c0[1] + c1[1]),
          s[2] * (c0[0] + c1[0]) + u[2] * (c0[1] + c1[1]),
        ]);
        for (const c of [c0, c1]) {
          const p = [
            path[i][0] + s[0] * c[0] * width * 0.5 + u[0] * c[1] * height * 0.5,
            path[i][1] + s[1] * c[0] * width * 0.5 + u[1] * c[1] * height * 0.5,
            path[i][2] + s[2] * c[0] * width * 0.5 + u[2] * c[1] * height * 0.5,
          ];
          this.vertex(p, nrm, [(c === c0 ? 0 : 1) * (f % 2 ? height : width) * uvScale, al * uvScale], mat);
        }
      }
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 2;
        this.quad(a, a + 2, a + 3, a + 1);
      }
    }
    // End caps.
    for (const i of [0, n - 1]) {
      const { t, u, s } = frames[i];
      const nn = i === 0 ? t.map((v) => -v) : t;
      const vs = corners.map((c) => this.vertex([
        path[i][0] + s[0] * c[0] * width * 0.5 + u[0] * c[1] * height * 0.5,
        path[i][1] + s[1] * c[0] * width * 0.5 + u[1] * c[1] * height * 0.5,
        path[i][2] + s[2] * c[0] * width * 0.5 + u[2] * c[1] * height * 0.5,
      ], nn, [c[0] * width, c[1] * height], mat));
      if (i === 0) this.quad(vs[0], vs[1], vs[2], vs[3]);
      else this.quad(vs[3], vs[2], vs[1], vs[0]);
    }
    return start;
  }

  // Axis-aligned box centred at c with half extents h, then transformed by m.
  box(c, h, mat = 0, m = null) {
    const start = this.count;
    const faces = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    for (const [nn, a, b] of faces) {
      const v = [];
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [
          c[0] + (nn[0] + a[0] * i + b[0] * j) * h[0],
          c[1] + (nn[1] + a[1] * i + b[1] * j) * h[1],
          c[2] + (nn[2] + a[2] * i + b[2] * j) * h[2],
        ];
        v.push(this.vertex(p, nn, [(i * 0.5 + 0.5) * 2 * Math.max(h[0], h[2]), (j * 0.5 + 0.5) * 2 * h[1]], mat));
      }
      this.quad(v[0], v[1], v[2], v[3]);
    }
    if (m) this.transform(start, m);
    return start;
  }

  // A fractured rock: subdivided icosahedron pushed out by noise and cut by
  // a few cleavage planes, flattened underneath.
  rock({ seed = 1, size = [1, 0.7, 0.9], detail = 3, mat = 9, cut = -0.35, faceting = 0.8, top = null } = {}) {
    const start = this.count;
    const rng = new RNG(seed);
    const noise = new Noise(seed * 13 + 1);
    const { verts, faces } = icosphere(detail);
    const planes = [];
    const np = 4 + rng.int(0, 4);
    for (let i = 0; i < np; i++) {
      const d = norm([rng.gauss(), rng.gauss() * 0.6 + 0.3, rng.gauss()]);
      planes.push({ d, o: rng.range(0.72, 0.92) });
    }
    const out = verts.map((v) => {
      let r = 1 + 0.18 * noise.fbm3(v[0] * 1.6, v[1] * 1.6, v[2] * 1.6, 4) + 0.05 * noise.noise3(v[0] * 6, v[1] * 6, v[2] * 6);
      for (const pl of planes) {
        const k = dot(v, pl.d);
        if (k > 0) r = Math.min(r, r * (1 - faceting) + (pl.o / k) * faceting);
      }
      const p = [v[0] * r * size[0], v[1] * r * size[1], v[2] * r * size[2]];
      if (p[1] < cut * size[1]) p[1] = cut * size[1] + (p[1] - cut * size[1]) * 0.15;
      // A worn, nearly flat top (stepping stones).
      if (top !== null && p[1] > top * size[1]) p[1] = top * size[1] + (p[1] - top * size[1]) * 0.12;
      return p;
    });
    const nrm = out.map(() => [0, 0, 0]);
    for (const [a, b, c] of faces) {
      const fn = cross(sub(out[b], out[a]), sub(out[c], out[a]));
      for (const k of [a, b, c]) { nrm[k][0] += fn[0]; nrm[k][1] += fn[1]; nrm[k][2] += fn[2]; }
    }
    out.forEach((p, i) => this.vertex(p, norm(nrm[i]), [p[0] + p[2], p[1]], mat));
    for (const [a, b, c] of faces) this.tri(start + a, start + b, start + c);
    return start;
  }

  toBuffers() {
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nrm),
      uv: new Float32Array(this.uv),
      mat: new Float32Array(this.mat),
      sway: new Float32Array(this.sway),
      index: this.count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
    };
  }
}

const icoCache = new Map();
export function icosphere(detail) {
  if (icoCache.has(detail)) return icoCache.get(detail);
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const mid = new Map();
    const midpoint = (a, b) => {
      const k = a < b ? a * 100000 + b : b * 100000 + a;
      if (mid.has(k)) return mid.get(k);
      const v = norm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]);
      verts.push(v);
      mid.set(k, verts.length - 1);
      return verts.length - 1;
    };
    const nf = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  const res = { verts, faces };
  icoCache.set(detail, res);
  return res;
}

// Column-major 4x4 helpers.
export function mat4Compose(pos, yaw = 0, scale = [1, 1, 1], tiltX = 0, tiltZ = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cx = Math.cos(tiltX), sx = Math.sin(tiltX);
  const cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);
  // R = Ry * Rx * Rz
  const r00 = cy * cz + sy * sx * sz, r01 = -cy * sz + sy * sx * cz, r02 = sy * cx;
  const r10 = cx * sz, r11 = cx * cz, r12 = -sx;
  const r20 = -sy * cz + cy * sx * sz, r21 = sy * sz + cy * sx * cz, r22 = cy * cx;
  return [
    r00 * scale[0], r10 * scale[0], r20 * scale[0], 0,
    r01 * scale[1], r11 * scale[1], r21 * scale[1], 0,
    r02 * scale[2], r12 * scale[2], r22 * scale[2], 0,
    pos[0], pos[1], pos[2], 1,
  ];
}
