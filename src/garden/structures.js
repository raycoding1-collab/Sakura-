// The garden's built things, modelled from their traditional anatomy.

import { MeshBuilder, mat4Compose } from '../core/geom.js';
import { RNG } from '../core/rng.js';
import { Noise } from '../core/noise.js';
import { MAT } from './propMaterial.js';
import { pondSDF, BRIDGE, POND_LOBES, ISLAND, GRAVEL_STONES, GARDEN_R } from './layout.js';

const lerp = (a, b, t) => a + (b - a) * t;

// Walk from (cx, cz) along angle a until the pond distance crosses `offset`.
export function shorePoint(cx, cz, a, offset = 0, maxR = 30) {
  const dx = Math.cos(a), dz = Math.sin(a);
  let prev = pondSDF(cx, cz) - offset;
  for (let t = 0.05; t < maxR; t += 0.05) {
    const d = pondSDF(cx + dx * t, cz + dz * t) - offset;
    if ((prev < 0) !== (d < 0)) return [cx + dx * t, cz + dz * t];
    prev = d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wooden crutches (tsue) under the long low limbs, with straw padding.
export function buildTreeSupports(mb, skel, groundAt) {
  const posts = [];
  for (const limb of skel.limbs.filter((l) => l.role === 'low')) {
    for (const f of [0.5, 0.82]) {
      const s = limb.length * f;
      const P = limb.pointAt(s), T = limb.tangentAt(s);
      const r = limb.radiusAt(s);
      const g = groundAt(P[0], P[2]);
      const top = P[1] - r * 1.05 - 0.05;
      const lean = [-T[2] * 0.06, 0, T[0] * 0.06];
      // Post: a peeled cedar log, slightly tapered and bent.
      const path = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        path.push([P[0] + lean[0] * t + Math.sin(t * 3.0) * 0.02, lerp(g - 0.15, top, t), P[2] + lean[2] * t]);
      }
      mb.sweep(path, (t) => lerp(0.085, 0.07, t), 12, { mat: MAT.WOOD, capEnd: true, uvScale: 1 });
      // Cross-beam cradling the limb.
      const side = [-T[2], 0, T[0]];
      const sl = Math.hypot(side[0], side[2]) || 1;
      side[0] /= sl; side[2] /= sl;
      const cb = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6 - 0.5;
        cb.push([P[0] + lean[0] + side[0] * t * 0.7, top + 0.02 + Math.abs(t) * 0.08, P[2] + lean[2] + side[2] * t * 0.7]);
      }
      mb.sweep(cb, 0.05, 10, { mat: MAT.WOOD, capStart: true, capEnd: true });
      // Straw padding wrapped around the limb where it rests.
      const wrap = [];
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        const ss = s - 0.12 + t * 0.24;
        const C = limb.pointAt(ss), TT = limb.tangentAt(ss);
        const ref = Math.abs(TT[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let nx = TT[1] * ref[2] - TT[2] * ref[1], ny = TT[2] * ref[0] - TT[0] * ref[2], nz = TT[0] * ref[1] - TT[1] * ref[0];
        const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        const bx = TT[1] * nz - TT[2] * ny, by = TT[2] * nx - TT[0] * nz, bz = TT[0] * ny - TT[1] * nx;
        const a = t * Math.PI * 2 * 5;
        const rr = limb.radiusAt(ss) * 1.12 + 0.012;
        wrap.push([C[0] + (nx * Math.cos(a) + bx * Math.sin(a)) * rr, C[1] + (ny * Math.cos(a) + by * Math.sin(a)) * rr, C[2] + (nz * Math.cos(a) + bz * Math.sin(a)) * rr]);
      }
      mb.sweep(wrap, 0.016, 6, { mat: MAT.STRAW, uvScale: 1 });
      posts.push([P[0], g, P[2]]);
    }
  }
  return posts;
}

// ---------------------------------------------------------------------------
// Shimenawa: a thick two-ply straw rope girdling the sacred trunk, knotted at
// the front with hanging tails, and zigzag shide paper streamers.
export function buildShimenawa(mb, bark, groundAt, frontAz) {
  const rings = bark.trunkRings;
  if (!rings.length) return;
  const g0 = groundAt(rings[0].c[0], rings[0].c[2]);
  const want = g0 + 1.3;
  let ring = rings[0];
  for (const r of rings) if (Math.abs(r.y - want) < Math.abs(ring.y - want)) ring = r;
  const sides = ring.radii.length;
  // Bridge the creases between fused stems: dilate then smooth the outline.
  const dil = new Float32Array(sides);
  const win = Math.round(sides * 0.07);
  for (let j = 0; j < sides; j++) {
    let m = 0;
    for (let k = -win; k <= win; k++) m = Math.max(m, ring.radii[(j + k + sides) % sides]);
    dil[j] = m;
  }
  const sm = new Float32Array(sides);
  for (let j = 0; j < sides; j++) {
    let a = 0;
    for (let k = -3; k <= 3; k++) a += dil[(j + k + sides) % sides];
    sm[j] = a / 7;
  }
  const ropeR = 0.078;
  const loop = [];
  const N = 160;
  const [cx, cy, cz] = ring.c;
  const Nn = ring.n, Bb = ring.b;
  let frontIdx = 0, frontBest = -2;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const f = (th / (Math.PI * 2)) * sides;
    const j0 = Math.floor(f) % sides, j1 = (j0 + 1) % sides;
    const rr = lerp(sm[j0], sm[j1], f - Math.floor(f)) + ropeR * 0.8;
    const dx = Nn[0] * Math.cos(th) + Bb[0] * Math.sin(th);
    const dy = Nn[1] * Math.cos(th) + Bb[1] * Math.sin(th);
    const dz = Nn[2] * Math.cos(th) + Bb[2] * Math.sin(th);
    // Rope sags a little lower at the front.
    const az = Math.atan2(dz, dx);
    const facing = Math.cos(az - frontAz);
    if (facing > frontBest) { frontBest = facing; frontIdx = i; }
    loop.push([cx + dx * rr, cy + dy * rr - 0.05 * Math.max(0, facing) ** 2, cz + dz * rr]);
  }
  // Two twisted strands following the loop.
  const twists = Math.round(N * 0.9);
  for (let strand = 0; strand < 2; strand++) {
    const path = [];
    const M = N * 6;
    for (let i = 0; i <= M; i++) {
      const t = i / M;
      const fi = t * N;
      const a = loop[Math.floor(fi) % N], b = loop[(Math.floor(fi) + 1) % N];
      const p = [lerp(a[0], b[0], fi % 1), lerp(a[1], b[1], fi % 1), lerp(a[2], b[2], fi % 1)];
      const out = [p[0] - cx, 0, p[2] - cz];
      const ol = Math.hypot(out[0], out[2]) || 1;
      const ph = t * twists * Math.PI * 2 / 6 + strand * Math.PI;
      path.push([p[0] + (out[0] / ol) * Math.cos(ph) * ropeR * 0.42, p[1] + Math.sin(ph) * ropeR * 0.42, p[2] + (out[2] / ol) * Math.cos(ph) * ropeR * 0.42]);
    }
    path.pop();
    mb.sweep(path, ropeR * 0.6, 8, { mat: MAT.STRAW, closed: true, uvScale: 1 });
  }
  // Knot and hanging straw tails at the front.
  const F = loop[frontIdx];
  const out = [F[0] - cx, 0, F[2] - cz];
  const ol = Math.hypot(out[0], out[2]);
  out[0] /= ol; out[2] /= ol;
  const knot = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    knot.push([F[0] + out[0] * (0.05 + Math.cos(a) * 0.02) - out[2] * Math.sin(a) * 0.05, F[1] + Math.sin(a) * 0.05, F[2] + out[2] * (0.05 + Math.cos(a) * 0.02) + out[0] * Math.sin(a) * 0.05]);
  }
  mb.sweep(knot, 0.035, 8, { mat: MAT.STRAW, closed: true });
  for (const side of [-1, 1]) {
    const tail = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      tail.push([F[0] + out[0] * 0.09 - out[2] * side * (0.05 + t * 0.06), F[1] - t * 0.42, F[2] + out[2] * 0.09 + out[0] * side * (0.05 + t * 0.06)]);
    }
    mb.setSway([tail[0][0], tail[0][1], tail[0][2]], 0.4);
    mb.sweep(tail, (t) => lerp(0.03, 0.012, t), 7, { mat: MAT.STRAW, capEnd: true });
    mb.clearSway();
  }
  // Shide: zigzag folded paper hanging at intervals around the front half.
  for (const offset of [-0.32, -0.12, 0.12, 0.32]) {
    const idx = (frontIdx + Math.round((offset * N) / (Math.PI * 2) * 2.4) + N) % N;
    const P = loop[idx];
    const o = [P[0] - cx, 0, P[2] - cz];
    const l = Math.hypot(o[0], o[2]);
    o[0] /= l; o[2] /= l;
    const tan = [-o[2], 0, o[0]];
    const top = [P[0] + o[0] * ropeR, P[1] - ropeR * 0.6, P[2] + o[2] * ropeR];
    mb.setSway(top, 1.0);
    const w = 0.036, step = 0.062;
    // Four panels, each shifted sideways: the lightning-bolt silhouette.
    const shifts = [0, 0.024, 0, 0.024];
    for (let k = 0; k < 4; k++) {
      const y0 = top[1] - k * step, y1 = y0 - step * 0.98;
      const sx = shifts[k] - 0.012;
      const x0 = sx, x1 = sx + w;
      const nrm = o;
      const v = [
        [top[0] + tan[0] * x0 + o[0] * 0.003 * k, y0, top[2] + tan[2] * x0 + o[2] * 0.003 * k],
        [top[0] + tan[0] * x1 + o[0] * 0.003 * k, y0, top[2] + tan[2] * x1 + o[2] * 0.003 * k],
        [top[0] + tan[0] * x1 + o[0] * 0.003 * (k + 1), y1, top[2] + tan[2] * x1 + o[2] * 0.003 * (k + 1)],
        [top[0] + tan[0] * x0 + o[0] * 0.003 * (k + 1), y1, top[2] + tan[2] * x0 + o[2] * 0.003 * (k + 1)],
      ];
      const ids = v.map((p, q) => mb.vertex(p, nrm, [q % 2, k], MAT.PAPER));
      mb.quad(ids[0], ids[3], ids[2], ids[1]);
    }
    mb.clearSway();
  }
}

// ---------------------------------------------------------------------------
// Kasuga lantern: tall hexagonal granite lantern. Returns the flame position.
export function buildKasuga(mb, pos, yaw, scale = 1) {
  const start = mb.count;
  const hex = { facets: true, mat: MAT.GRANITE };
  // Base (kiso) with a carved lotus rim.
  mb.lathe([[0.34, -0.1], [0.34, 0.08], [0.34, 0.08], [0.3, 0.13], [0.22, 0.19], [0.22, 0.19], [0.14, 0.21]], 6, hex);
  // Shaft (sao) with the central band.
  mb.lathe([[0.1, 0.2], [0.095, 0.55], [0.095, 0.55], [0.12, 0.57], [0.12, 0.6], [0.12, 0.6], [0.095, 0.62], [0.09, 0.98]], 20, { mat: MAT.GRANITE });
  // Middle platform (chudai).
  mb.lathe([[0.12, 0.97], [0.26, 1.06], [0.26, 1.06], [0.27, 1.12], [0.27, 1.12], [0.2, 1.15]], 6, hex);
  // Fire box (hibukuro): corner posts, sills, and glowing windows.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    mb.box([0, 0, 0], [0.028, 0.16, 0.028], MAT.GRANITE, mat4Compose([Math.cos(a) * 0.165, 1.31, Math.sin(a) * 0.165], -a));
  }
  mb.lathe([[0.19, 1.14], [0.19, 1.18], [0.19, 1.18], [0.0, 1.18]], 6, hex);
  mb.lathe([[0.0, 1.44], [0.19, 1.44], [0.19, 1.44], [0.19, 1.48]], 6, hex);
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2;
    const r = 0.14;
    const p0 = [Math.cos(a0) * r, 1.19, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, 1.19, Math.sin(a1) * r];
    const mid = (a0 + a1) / 2;
    const nn = [Math.cos(mid), 0, Math.sin(mid)];
    const lit = k === 0 || k === 3;
    const v = [p0, p1, [p1[0], 1.43, p1[2]], [p0[0], 1.43, p0[2]]].map((p, q) => mb.vertex(p, nn, [q % 2, q >> 1], lit ? MAT.FIRE : MAT.GRANITE));
    mb.quad(v[0], v[1], v[2], v[3]);
  }
  // Roof (kasa): broad curved hexagon with upturned corners and scroll knobs.
  const roofShape = (th, y, r) => {
    const corner = Math.pow(Math.abs(Math.cos(3 * th)), 8);
    if (r > 0.3) return [r * (1 + 0.04 * corner), y + 0.05 * corner];
    return [r, y];
  };
  mb.lathe([[0.17, 1.47], [0.44, 1.52], [0.46, 1.55], [0.46, 1.55], [0.42, 1.58], [0.3, 1.64], [0.16, 1.72], [0.1, 1.74]], 6, { ...hex, shape: roofShape });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const tip = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const ang = t * Math.PI * 1.4;
      tip.push([Math.cos(a) * (0.47 + Math.sin(ang) * 0.025), 1.61 + (1 - Math.cos(ang)) * 0.025, Math.sin(a) * (0.47 + Math.sin(ang) * 0.025)]);
    }
    mb.sweep(tip, 0.02, 6, { mat: MAT.GRANITE, capStart: true, capEnd: true });
  }
  // Lotus seat and jewel (ukebana, hoju).
  mb.lathe([[0.1, 1.73], [0.11, 1.76], [0.06, 1.78], [0.06, 1.78], [0.09, 1.82], [0.1, 1.86], [0.08, 1.91], [0.035, 1.96], [0.0, 1.99]], 16, { mat: MAT.GRANITE });
  mb.transform(start, mat4Compose(pos, yaw, [scale, scale, scale]));
  return [pos[0], pos[1] + 1.31 * scale, pos[2]];
}

// Yukimi lantern: squat, wide-roofed, standing on curved legs at the water.
export function buildYukimi(mb, pos, yaw, scale = 1) {
  const start = mb.count;
  const legs = 3;
  for (let k = 0; k < legs; k++) {
    const a = (k / legs) * Math.PI * 2 + 0.3;
    const path = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const rr = lerp(0.42, 0.12, Math.sin(t * Math.PI * 0.5));
      path.push([Math.cos(a) * rr, lerp(-0.12, 0.42, t) + Math.sin(t * Math.PI) * 0.06, Math.sin(a) * rr]);
    }
    mb.sweep(path, (t) => lerp(0.06, 0.045, t), 10, { mat: MAT.GRANITE, capStart: true, capEnd: true });
  }
  mb.lathe([[0.0, 0.4], [0.2, 0.4], [0.2, 0.4], [0.22, 0.45], [0.22, 0.45], [0.18, 0.47]], 6, { facets: true, mat: MAT.GRANITE });
  // Fire box with two lit windows.
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2;
    const r = 0.17;
    const p0 = [Math.cos(a0) * r, 0.47, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, 0.47, Math.sin(a1) * r];
    const mid = (a0 + a1) / 2;
    const nn = [Math.cos(mid), 0, Math.sin(mid)];
    const lit = k === 1 || k === 4;
    const v = [p0, p1, [p1[0], 0.7, p1[2]], [p0[0], 0.7, p0[2]]].map((p, q) => mb.vertex(p, nn, [q % 2, q >> 1], lit ? MAT.FIRE : MAT.GRANITE));
    mb.quad(v[0], v[1], v[2], v[3]);
    mb.box([0, 0, 0], [0.025, 0.115, 0.025], MAT.GRANITE, mat4Compose([Math.cos(a0) * 0.18, 0.585, Math.sin(a0) * 0.18], -a0));
  }
  // The wide snow-catching roof.
  const roofShape = (th, y, r) => {
    const corner = Math.pow(Math.abs(Math.cos(3 * th)), 10);
    if (r > 0.5) return [r * (1 + 0.03 * corner), y + 0.06 * corner];
    return [r, y];
  };
  mb.lathe([[0.15, 0.69], [0.66, 0.74], [0.68, 0.77], [0.68, 0.77], [0.6, 0.8], [0.38, 0.88], [0.15, 0.95], [0.08, 0.97]], 6, { facets: true, mat: MAT.GRANITE, shape: roofShape });
  mb.lathe([[0.08, 0.96], [0.09, 0.99], [0.05, 1.01], [0.07, 1.05], [0.05, 1.1], [0.0, 1.13]], 14, { mat: MAT.GRANITE });
  mb.transform(start, mat4Compose(pos, yaw, [scale, scale, scale]));
  return [pos[0], pos[1] + 0.58 * scale, pos[2]];
}

// ---------------------------------------------------------------------------
// Vermilion arched bridge (sori-bashi) with plank deck and bronze finials.
export function buildBridge(mb, groundAt, waterLevel) {
  const [x0, z0, x1, z1] = BRIDGE;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const dir = [(x1 - x0) / len, 0, (z1 - z0) / len];
  const side = [-dir[2], 0, dir[0]];
  const g0 = groundAt(x0, z0), g1 = groundAt(x1, z1);
  const rise = 0.62;
  const half = 0.72;
  const deckAt = (t) => [lerp(x0, x1, t), lerp(g0, g1, t) + 0.12 + Math.sin(t * Math.PI) * rise, lerp(z0, z1, t)];
  const offset = (p, s, dy = 0) => [p[0] + side[0] * s, p[1] + dy, p[2] + side[2] * s];
  const N = 40;
  const curve = (s, dy) => Array.from({ length: N + 1 }, (_, i) => offset(deckAt(i / N), s, dy));
  // Stringers.
  for (const s of [-half + 0.06, half - 0.06]) mb.board(curve(s, -0.1), 0.1, 0.16, { mat: MAT.LACQUER });
  // Deck planks across.
  const planks = Math.round(len / 0.13);
  for (let i = 0; i < planks; i++) {
    const t = (i + 0.5) / planks;
    const p = deckAt(t);
    const a = deckAt(Math.min(1, t + 0.01)), b = deckAt(Math.max(0, t - 0.01));
    const pitch = Math.atan2(a[1] - b[1], Math.hypot(a[0] - b[0], a[2] - b[2]));
    const yaw = Math.atan2(dir[2], dir[0]);
    mb.box([0, 0, 0], [0.058, 0.022, half + 0.04], MAT.WOOD, matFromBasis(p, dir, side, pitch, yaw));
  }
  // Railing posts, rails and finials.
  const posts = 9;
  for (const s of [-half, half]) {
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      const p = offset(deckAt(t), s);
      const hgt = i === 0 || i === posts - 1 ? 0.95 : 0.78;
      const w = i === 0 || i === posts - 1 ? 0.07 : 0.045;
      mb.box([p[0], p[1] + hgt / 2, p[2]], [w, hgt / 2, w], MAT.LACQUER);
      if (i === 0 || i === posts - 1) {
        // Giboshi: onion-shaped bronze finial.
        const st = mb.count;
        mb.lathe([[0.07, 0.0], [0.075, 0.04], [0.05, 0.06], [0.09, 0.12], [0.08, 0.18], [0.03, 0.24], [0.012, 0.29], [0.0, 0.31]], 16, { mat: MAT.BRONZE });
        mb.transform(st, mat4Compose([p[0], p[1] + hgt, p[2]], 0));
      }
    }
    mb.board(curve(s, 0.74), 0.07, 0.05, { mat: MAT.LACQUER });
    mb.board(curve(s, 0.38), 0.04, 0.035, { mat: MAT.LACQUER });
  }
  // Piers standing in the water.
  for (const t of [0.3, 0.7]) {
    for (const s of [-half + 0.06, half - 0.06]) {
      const p = offset(deckAt(t), s);
      const bottom = groundAt(p[0], p[2]) - 0.2;
      mb.sweep([[p[0], bottom, p[2]], [p[0], p[1] - 0.12, p[2]]], 0.055, 12, { mat: MAT.LACQUER, capEnd: true });
    }
    const p = deckAt(t);
    mb.board([offset(p, -half - 0.05, -0.22), offset(p, half + 0.05, -0.22)], 0.08, 0.1, { mat: MAT.LACQUER });
  }
  void waterLevel;
  return { start: deckAt(0), end: deckAt(1), mid: deckAt(0.5) };
}

function matFromBasis(p, dir, side, pitch, yaw) {
  // Local x along the bridge (pitched), z across, y up.
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fx = [dir[0] * cp, sp, dir[2] * cp];
  const up = [-dir[0] * sp, cp, -dir[2] * sp];
  void yaw;
  return [fx[0], fx[1], fx[2], 0, up[0], up[1], up[2], 0, side[0], side[1], side[2], 0, p[0], p[1], p[2], 1];
}

// ---------------------------------------------------------------------------
// Rocks: pond-edge stones (gogan-ishi), the gravel court's triad, island
// stones, and flat stepping stones along the paths.
export function buildRocks(mb, groundAt, waterLevel, extra = {}) {
  const rng = new RNG(911);
  const placed = [];
  const add = (x, z, size, yaw, sink, opts = {}) => {
    const g = groundAt(x, z);
    const st = mb.rock({ seed: rng.int(1, 1e6), size, detail: opts.detail ?? 3, mat: MAT.ROCK, faceting: opts.faceting ?? 0.75 });
    mb.transform(st, mat4Compose([x, Math.max(g, opts.minY ?? -1e9) - sink * size[1], z], yaw, [1, 1, 1], rng.sym(0.08), rng.sym(0.08)));
    placed.push([x, z, Math.max(size[0], size[2])]);
  };
  const avoid = (x, z, r) => {
    for (const p of [...placed, ...(extra.avoid || [])]) if (Math.hypot(x - p[0], z - p[1]) < r + p[2] * 0.9) return true;
    return false;
  };
  // Shore stones around every lobe.
  for (const [cx, cz, rx, rz] of POND_LOBES) {
    const count = Math.round((rx + rz) * 2.0);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng.sym(0.2);
      const sp = shorePoint(cx, cz, a, rng.range(-0.05, 0.2));
      if (!sp || pondSDF(sp[0], sp[1]) < -0.4) continue;
      const s = rng.range(0.22, 0.6);
      if (avoid(sp[0], sp[1], s)) continue;
      add(sp[0], sp[1], [s * rng.range(0.9, 1.4), s * rng.range(0.5, 0.9), s * rng.range(0.8, 1.2)], rng.range(0, 6.28), 0.25, { minY: waterLevel - 0.15 });
    }
  }
  // Island: a cluster of mossy stones.
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, 6.28), d = rng.range(0, ISLAND[2] * 0.8);
    const s = rng.range(0.3, 0.75);
    add(ISLAND[0] + Math.cos(a) * d, ISLAND[1] + Math.sin(a) * d, [s, s * rng.range(0.6, 1.1), s * 0.9], rng.range(0, 6.28), 0.2);
  }
  // The gravel court's three-stone group: upright, reclining, low.
  for (const [x, z, r] of GRAVEL_STONES) {
    add(x, z, [r * 0.85, r * 1.25, r * 0.75], rng.range(0, 6.28), 0.15, { faceting: 0.85 });
  }
  // Stones gripping the roots of the old tree.
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, 6.28), d = rng.range(2.4, 3.4);
    const s = rng.range(0.25, 0.45);
    add(Math.cos(a) * d, Math.sin(a) * d, [s * 1.3, s * 0.6, s], rng.range(0, 6.28), 0.3);
  }
  // Stepping stones (tobi-ishi) along the paths.
  for (const path of extra.paths || []) {
    let along = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (along < L) {
        const t = along / L;
        const x = lerp(a[0], b[0], t) + rng.sym(0.12), z = lerp(a[1], b[1], t) + rng.sym(0.12);
        const s = rng.range(0.26, 0.36);
        const st = mb.rock({ seed: rng.int(1, 1e6), size: [s * 1.25, 0.12, s], detail: 2, mat: MAT.GRANITE, faceting: 0.5, cut: -0.2, top: 0.35 });
        mb.transform(st, mat4Compose([x, groundAt(x, z) + 0.01, z], rng.range(0, 6.28)));
        along += rng.range(0.62, 0.74);
      }
      along -= L;
    }
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Yotsume-gaki: a see-through bamboo lattice fence along the garden's back.
export function buildFence(mb, groundAt, a0, a1, radius = GARDEN_R - 1.5) {
  const arc = (a1 - a0) * radius;
  const posts = Math.round(arc / 1.8);
  const noise = new Noise(77);
  const at = (a, rr = radius) => {
    const r = rr + noise.noise2(a * 3, 0.5) * 0.3;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  for (let i = 0; i <= posts; i++) {
    const a = lerp(a0, a1, i / posts);
    const [x, z] = at(a);
    const g = groundAt(x, z);
    mb.sweep([[x, g - 0.2, z], [x, g + 1.25, z]], 0.032, 10, { mat: MAT.BAMBOO, capEnd: true, uvScale: 1 });
  }
  for (const hgt of [0.35, 0.72, 1.08]) {
    const path = [];
    const n = Math.round(arc / 0.5);
    for (let i = 0; i <= n; i++) {
      const a = lerp(a0, a1, i / n);
      const [x, z] = at(a, radius - 0.045);
      path.push([x, groundAt(x, z) + hgt, z]);
    }
    mb.sweep(path, 0.016, 6, { mat: MAT.BAMBOO, capStart: true, capEnd: true });
  }
  const pickets = Math.round(arc / 0.3);
  for (let i = 0; i <= pickets; i++) {
    const a = lerp(a0, a1, i / pickets);
    const off = i % 2 ? 0.02 : -0.06;
    const [x, z] = at(a, radius + off);
    const g = groundAt(x, z);
    mb.sweep([[x, g - 0.1, z], [x, g + 1.16, z]], 0.012, 5, { mat: MAT.BAMBOO, capEnd: true });
    for (const hgt of [0.35, 0.72, 1.08]) {
      const [kx, kz] = at(a, radius - 0.02);
      mb.box([0, 0, 0], [0.018, 0.012, 0.018], MAT.BLACK, mat4Compose([kx, g + hgt, kz], -a));
    }
  }
}

// ---------------------------------------------------------------------------
// Tsukubai: a stone wash-basin with a bamboo ladle, its front and side
// stones, and a bamboo spout trickling into it.
export function buildTsukubai(mb, pos, yaw, groundAt) {
  const start = mb.count;
  const g = 0;
  // Basin: a squat round stone with a carved bowl.
  mb.lathe([[0.0, g - 0.1], [0.3, g - 0.1], [0.34, g + 0.12], [0.33, g + 0.32], [0.3, g + 0.38], [0.18, g + 0.39], [0.16, g + 0.3], [0.08, g + 0.25], [0.0, g + 0.24]], 24, { mat: MAT.GRANITE });
  // Water surface in the bowl.
  for (let k = 0; k < 24; k++) {
    const a0 = (k / 24) * Math.PI * 2, a1 = ((k + 1) / 24) * Math.PI * 2;
    const c = mb.vertex([0, g + 0.335, 0], [0, 1, 0], [0, 0], MAT.WATER);
    const p0 = mb.vertex([Math.cos(a0) * 0.172, g + 0.335, Math.sin(a0) * 0.172], [0, 1, 0], [1, 0], MAT.WATER);
    const p1 = mb.vertex([Math.cos(a1) * 0.172, g + 0.335, Math.sin(a1) * 0.172], [0, 1, 0], [1, 1], MAT.WATER);
    mb.tri(c, p1, p0);
  }
  // Hishaku ladle resting across the rim.
  mb.sweep([[-0.28, g + 0.405, 0.03], [0.22, g + 0.405, -0.03]], 0.008, 6, { mat: MAT.BAMBOO, capStart: true, capEnd: true });
  const cup = mb.count;
  mb.lathe([[0.0, 0.0], [0.035, 0.0], [0.04, 0.06], [0.036, 0.065], [0.03, 0.01], [0.0, 0.01]], 14, { mat: MAT.BAMBOO });
  mb.transform(cup, mat4Compose([0.26, g + 0.39, -0.035], 0));
  // Kakei: bamboo pipe on two crossed stakes, pouring into the bowl.
  const spout = [[0.0, g + 0.58, 0.0], [0.0, g + 0.62, 0.55], [0.0, g + 0.66, 1.2]];
  mb.sweep(spout, 0.028, 10, { mat: MAT.BAMBOO, capStart: true, capEnd: true });
  for (const sx of [-1, 1]) {
    mb.sweep([[sx * 0.12, g - 0.1, 0.62], [-sx * 0.04, g + 0.7, 0.62]], 0.018, 6, { mat: MAT.BAMBOO, capEnd: true });
  }
  mb.box([0, g + 0.62, 0.62], [0.05, 0.015, 0.02], MAT.BLACK);
  mb.transform(start, mat4Compose(pos, yaw));
  return { spoutTip: [pos[0], pos[1] + 0.58, pos[2]] };
}

// Shishi-odoshi rocker: built about its own pivot so it can tip.
export function buildShishiOdoshi(mb) {
  // Tube: open angled mouth at the front, closed node at the back.
  const tube = [];
  for (let i = 0; i <= 10; i++) tube.push([lerp(-0.36, 0.52, i / 10), 0, 0]);
  mb.sweep(tube, 0.045, 14, { mat: MAT.BAMBOO, capStart: true, uvScale: 1 });
  // Axle pin.
  mb.sweep([[0, 0, -0.12], [0, 0, 0.12]], 0.008, 6, { mat: MAT.BLACK, capStart: true, capEnd: true });
}

export function buildShishiFrame(mb, pos, yaw) {
  const start = mb.count;
  for (const z of [-0.09, 0.09]) {
    mb.sweep([[0, -0.15, z], [0, 0.42, z]], 0.026, 8, { mat: MAT.BAMBOO, capEnd: true });
  }
  // The striking stone under the tube's back end.
  const st = mb.rock({ seed: 5, size: [0.14, 0.1, 0.12], detail: 2, mat: MAT.ROCK });
  mb.transform(st, mat4Compose([-0.34, -0.02, 0], 0));
  mb.transform(start, mat4Compose(pos, yaw));
}

// ---------------------------------------------------------------------------
// Bonbori: the paper lamps of night cherry viewing. A stepped black plinth, a
// square vermilion post with brass fittings, a lacquered tray, a hexagonal
// shade of washi stretched over a black frame (each panel printed with a
// cherry-blossom crest and dyed pink toward the bottom), and a flared hipped
// roof with brass ridges and a jewel finial. Returns the light point.
export function buildBonbori(mb, pos, yaw) {
  const start = mb.count;
  const sq = (profile, mat) => mb.lathe(profile, 4, { facets: true, angle0: Math.PI / 4, mat });
  // Plinth and post.
  sq([[0.0, -0.06], [0.2, -0.06], [0.2, -0.06], [0.2, 0.04], [0.2, 0.04], [0.17, 0.06], [0.17, 0.06], [0.0, 0.06]], MAT.BLACK);
  sq([[0.12, 0.06], [0.12, 0.13], [0.12, 0.13], [0.1, 0.15], [0.0, 0.15]], MAT.BLACK);
  sq([[0.05, 0.15], [0.042, 1.25], [0.0, 1.25]], MAT.LACQUER);
  for (const [y0, y1] of [[0.15, 0.22], [0.62, 0.65], [1.18, 1.25]]) {
    sq([[0.0, y0], [0.054, y0], [0.054, y0], [0.054, y1], [0.054, y1], [0.0, y1]], MAT.BRONZE);
  }
  // Tray with a moulded edge, on a small block.
  mb.lathe([[0.0, 1.25], [0.07, 1.25], [0.07, 1.25], [0.07, 1.28], [0.07, 1.28], [0.2, 1.285], [0.2, 1.285],
    [0.205, 1.3], [0.2, 1.315], [0.2, 1.315], [0.0, 1.315]], 6, { facets: true, mat: MAT.BLACK });

  // Paper panels; uv.x carries the panel index, uv.y runs up the panel.
  const R = 0.165, y0 = 1.315, y1 = 1.665;
  const corner = (k, y, r = R) => [Math.cos((k * Math.PI) / 3) * r, y, Math.sin((k * Math.PI) / 3) * r];
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) * Math.PI) / 3;
    const n = [Math.cos(a), 0, Math.sin(a)];
    const v0 = mb.vertex(corner(k, y0), n, [k, 0], MAT.GLOW);
    const v1 = mb.vertex(corner(k + 1, y0), n, [k + 1, 0], MAT.GLOW);
    const v2 = mb.vertex(corner(k + 1, y1), n, [k + 1, 1], MAT.GLOW);
    const v3 = mb.vertex(corner(k, y1), n, [k, 1], MAT.GLOW);
    mb.quad(v0, v1, v2, v3);
    // Frame: corner posts, and rails along the top and bottom edges.
    const c = corner(k, 0, R + 0.002);
    mb.box([0, 0, 0], [0.008, (y1 - y0) / 2 + 0.012, 0.008], MAT.BLACK, mat4Compose([c[0], (y0 + y1) / 2, c[2]], -(k * Math.PI) / 3));
    const m = R * Math.cos(Math.PI / 6) + 0.004;
    for (const [y, hh] of [[y0 + 0.012, 0.012], [y1 - 0.01, 0.01], [(y0 + y1) / 2 + 0.07, 0.0035]]) {
      mb.box([0, 0, 0], [R / 2 + 0.006, hh, 0.006], MAT.BLACK, mat4Compose([Math.cos(a) * m, y, Math.sin(a) * m], -a - Math.PI / 2));
    }
  }
  // Collar, then the roof: concave hip faces flaring out to upturned eaves.
  mb.lathe([[0.0, y1], [0.17, y1], [0.17, y1], [0.17, 1.685], [0.17, 1.685], [0.0, 1.685]], 6, { facets: true, mat: MAT.BLACK });
  const roof = [[0.0, 1.9], [0.03, 1.885], [0.07, 1.84], [0.12, 1.78], [0.18, 1.73], [0.235, 1.705], [0.262, 1.708], [0.27, 1.722]];
  mb.lathe([...roof, [0.27, 1.722], [0.262, 1.69], [0.262, 1.69], [0.15, 1.685], [0.0, 1.685]], 6, { facets: true, mat: MAT.BLACK });
  for (let k = 0; k < 6; k++) {
    const path = roof.slice(1).map(([r, y]) => corner(k, y + 0.008, r));
    mb.sweep(path, 0.006, 5, { mat: MAT.BRONZE, capEnd: true });
  }
  // Jewel finial.
  mb.lathe([[0.0, 1.89], [0.022, 1.895], [0.022, 1.905], [0.012, 1.91], [0.026, 1.93], [0.024, 1.95], [0.012, 1.972], [0.0, 1.985]], 10, { mat: MAT.BRONZE });
  mb.transform(start, mat4Compose(pos, yaw));
  return [pos[0], pos[1] + 1.48, pos[2]];
}
