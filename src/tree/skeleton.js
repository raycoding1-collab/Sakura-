// Procedural skeleton of a mature Somei-Yoshino cherry.
//
// The tree is grown recursively: a short leaning trunk forks into a handful of
// sweeping scaffold limbs, which carry ever finer orders of branches out to the
// flowering twigs. Growth directions are shaped by smooth wander noise, photo-
// and gravitropism, an outward spread bias and a lumpy dome-shaped crown
// envelope. Radii follow a pipe model (cross-section ∝ downstream wood length),
// and every node carries hierarchical wind weights so the mesh, the flowers and
// the falling petals all sway coherently.

import { RNG } from '../core/rng.js';
import { Noise } from '../core/noise.js';
import * as V from '../core/vec.js';

export class Branch {
  constructor(depth, parent = null, attachS = 0, kind = 'wood') {
    this.depth = depth;
    this.parent = parent;
    this.attachS = attachS;
    this.kind = kind;
    this.p = []; // flat xyz
    this.s = []; // arc length at each node
    this.r = []; // radius at each node
    this.wA = []; // limb-level wind compliance
    this.wB = []; // twig-level wind compliance
    this.children = [];
    this.phaseA = 0;
    this.phaseB = 0;
    this.id = 0;
  }

  get count() {
    return this.s.length;
  }

  get length() {
    return this.s.length ? this.s[this.s.length - 1] : 0;
  }

  addNode(q) {
    const n = this.s.length;
    if (n === 0) this.s.push(0);
    else {
      const i = (n - 1) * 3;
      this.s.push(this.s[n - 1] + Math.hypot(q[0] - this.p[i], q[1] - this.p[i + 1], q[2] - this.p[i + 2]));
    }
    this.p.push(q[0], q[1], q[2]);
  }

  // Index i and fraction f such that s lies between node i and i+1.
  locate(s) {
    const S = this.s;
    const n = S.length;
    if (s <= 0) return [0, 0];
    if (s >= S[n - 1]) return [n - 2, 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (S[m] <= s) lo = m;
      else hi = m;
    }
    return [lo, (s - S[lo]) / Math.max(1e-9, S[lo + 1] - S[lo])];
  }

  pointAt(s, out = [0, 0, 0]) {
    const [i, f] = this.locate(s);
    const a = i * 3, b = a + 3, p = this.p;
    out[0] = p[a] + (p[b] - p[a]) * f;
    out[1] = p[a + 1] + (p[b + 1] - p[a + 1]) * f;
    out[2] = p[a + 2] + (p[b + 2] - p[a + 2]) * f;
    return out;
  }

  tangentAt(s, out = [0, 0, 0]) {
    const [i] = this.locate(s);
    const a = i * 3, b = a + 3, p = this.p;
    out[0] = p[b] - p[a];
    out[1] = p[b + 1] - p[a + 1];
    out[2] = p[b + 2] - p[a + 2];
    return V.normalize(out);
  }

  sampleArray(arr, s) {
    const [i, f] = this.locate(s);
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  }

  radiusAt(s) {
    return this.sampleArray(this.r, s);
  }
}

// Lumpy dome describing where the flowering canopy may live.
class Crown {
  constructor(noise) {
    this.noise = noise;
    this.c = [0, 4.7, 0];
    this.rx = 8.7;
    this.rz = 8.2;
    this.ryUp = 4.3;
    this.ryDown = 3.0;
  }

  value(p) {
    const dx = p[0] - this.c[0], dy = p[1] - this.c[1], dz = p[2] - this.c[2];
    const ry = dy > 0 ? this.ryUp : this.ryDown;
    const q = Math.hypot(dx / this.rx, dy / ry, dz / this.rz);
    const l = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / l, uy = dy / l, uz = dz / l;
    const n = this.noise.noise3(ux * 1.7 + 11.3, uy * 1.7, uz * 1.7) * 0.12 +
      this.noise.noise3(ux * 4.1, uy * 4.1 + 5.7, uz * 4.1) * 0.05;
    return q / (1 + n);
  }

  // Outward normal of the envelope (approximate gradient direction).
  normal(p, out) {
    const dx = p[0] - this.c[0], dy = p[1] - this.c[1], dz = p[2] - this.c[2];
    const ry = dy > 0 ? this.ryUp : this.ryDown;
    out[0] = dx / (this.rx * this.rx);
    out[1] = dy / (ry * ry);
    out[2] = dz / (this.rz * this.rz);
    return V.normalize(out);
  }

  // Distance along a straight ray before leaving the envelope.
  room(p, d, maxDist) {
    const q = [0, 0, 0];
    for (let t = 0.1; t < maxDist; t += 0.1) {
      V.addScaled(q, p, d, t);
      if (this.value(q) > 1) return t;
    }
    return maxDist;
  }
}

// Per-order growth behaviour: segment length, wander, tropisms (per metre).
const GROW = [
  { seg: 0.09, wander: 0.22, freq: 0.55, up: () => 0.06, gravity: () => 0, out: 0 },
  { seg: 0.13, wander: 0.5, freq: 0.45, up: (t) => (t > 0.7 ? 0.14 : 0), gravity: (t) => 0.035 + 0.07 * t, out: 0.03 },
  { seg: 0.09, wander: 0.62, freq: 0.9, up: (t) => 0.22 + 0.2 * t, gravity: () => 0.12, out: 0.025 },
  { seg: 0.065, wander: 0.85, freq: 1.7, up: (t) => 0.3 + 0.2 * t, gravity: () => 0.15, out: 0.035 },
  { seg: 0.05, wander: 1.0, freq: 2.8, up: () => 0.42, gravity: () => 0.1, out: 0.03 },
  { seg: 0.035, wander: 1.2, freq: 4.5, up: () => 0.65, gravity: () => 0.05, out: 0.02 },
];

// How each order sprouts its children (index = child depth).
const SPAWN = [
  null,
  null,
  { start: 0.16, end: 0.97, gap: [0.36, 0.6], angle: [0.6, 1.02], lenRatio: [0.48, 0.7], minLen: 0.7, maxLen: 3.9, lift: 0.22, inwardSkip: 0.82 },
  { start: 0.1, end: 0.97, gap: [0.24, 0.4], angle: [0.55, 0.98], lenRatio: [0.42, 0.64], minLen: 0.32, maxLen: 1.9, lift: 0.16, inwardSkip: 0.6 },
  { start: 0.08, end: 0.98, gap: [0.11, 0.18], angle: [0.5, 0.95], lenRatio: [0.36, 0.62], minLen: 0.16, maxLen: 0.95, lift: 0.2, inwardSkip: 0.35 },
  { start: 0.1, end: 0.96, gap: [0.05, 0.085], angle: [0.5, 1.0], lenRatio: [0.4, 0.75], minLen: 0.07, maxLen: 0.3, lift: 0.25, inwardSkip: 0.0 },
];

export function generateSkeleton(seed = 7, opts = {}) {
  const rng = new RNG(seed);
  const noise = new Noise(seed * 31 + 5);
  const crown = new Crown(noise);
  const maxDepth = opts.maxDepth ?? 5;
  const groundAt = opts.groundAt ?? (() => 0);
  const branches = [];

  const register = (b) => {
    b.id = branches.length;
    branches.push(b);
    return b;
  };

  // Grow one branch path in place.
  function grow(br, start, dir, length, heading = null) {
    const gp = GROW[Math.min(br.depth, GROW.length - 1)];
    const p = V.clone(start);
    const d = V.normalize([0, 0, 0], dir);
    const en = [0, 0, 0];
    br.addNode(p);
    const n = Math.max(2, Math.ceil(length / gp.seg));
    const seg = length / n;
    const o1 = rng.range(0, 200), o2 = rng.range(0, 200), o3 = rng.range(0, 200);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const s = i * seg;
      d[0] += noise.noise2(s * gp.freq, o1) * gp.wander * seg;
      d[1] += noise.noise2(s * gp.freq, o2) * gp.wander * seg * 0.7;
      d[2] += noise.noise2(s * gp.freq, o3) * gp.wander * seg;
      d[1] += (gp.up(t) - gp.gravity(t)) * seg;
      if (heading) {
        // Hold the long-term compass heading so scaffold limbs keep their spread.
        const h = Math.hypot(d[0], d[2]);
        d[0] += (heading[0] * h - d[0]) * Math.min(1, 1.1 * seg);
        d[2] += (heading[1] * h - d[2]) * Math.min(1, 1.1 * seg);
      }
      if (gp.out > 0) {
        const ox = p[0] - crown.c[0], oz = p[2] - crown.c[2];
        const rl = Math.hypot(ox, oz);
        if (rl > 0.15) {
          d[0] += (ox / rl) * gp.out * seg * 4;
          d[2] += (oz / rl) * gp.out * seg * 4;
        }
      }
      V.normalize(d);
      if (br.depth > 0 && br.kind === 'wood') {
        const e = crown.value(p);
        if (e > 0.88) {
          crown.normal(p, en);
          const outward = V.dot(d, en);
          if (outward > 0) {
            const k = Math.min(1, (e - 0.88) * 4.5);
            V.addScaled(d, d, en, -outward * k);
            d[1] += 0.25 * k * seg;
            V.normalize(d);
          }
        }
        if (e > 1.09 && t > 0.25) {
          V.addScaled(p, p, d, seg);
          br.addNode(p);
          break;
        }
      }
      V.addScaled(p, p, d, seg);
      br.addNode(p);
    }
  }

  function spawnChildren(parent, cd) {
    const cfg = SPAWN[cd];
    if (!cfg) return;
    const L = parent.length;
    if (L < 0.05) return;
    const P = [0, 0, 0], T = [0, 0, 0], ref = [0, 0, 0], side = [0, 0, 0], dir = [0, 0, 0];
    let s = L * cfg.start + rng.range(0, cfg.gap[0]);
    let psi = rng.range(0, Math.PI * 2);
    while (s < L * cfg.end) {
      parent.pointAt(s, P);
      parent.tangentAt(s, T);
      // Stable reference frame around the parent axis.
      if (Math.abs(T[1]) < 0.95) V.normalize(ref, V.cross(ref, T, [0, 1, 0]));
      else V.normalize(ref, V.cross(ref, T, [1, 0, 0]));
      psi += 2.4 + rng.sym(0.45);
      V.rotateAxis(side, ref, T, psi);
      const ang = rng.range(cfg.angle[0], cfg.angle[1]);
      V.scale(dir, T, Math.cos(ang));
      V.addScaled(dir, dir, side, Math.sin(ang));
      dir[1] += cfg.lift;
      if (dir[1] < -0.35) dir[1] = -0.35 + (dir[1] + 0.35) * 0.3;
      V.normalize(dir);

      const ox = P[0] - crown.c[0], oz = P[2] - crown.c[2];
      const rl = Math.hypot(ox, oz);
      const inward = rl > 0.3 ? (dir[0] * ox + dir[2] * oz) / (rl * Math.hypot(dir[0], dir[2]) + 1e-6) : 0;
      const skip = inward < -0.25 && rng.chance(cfg.inwardSkip);
      if (!skip) {
        const remaining = L - s;
        const shape = 0.7 + 0.3 * Math.sin(Math.PI * Math.min(1, (s / L) * 1.15));
        let cl = V.clamp(remaining * rng.range(cfg.lenRatio[0], cfg.lenRatio[1]) * shape * 1.25, cfg.minLen, cfg.maxLen);
        if (cd >= 2) {
          const room = crown.room(P, dir, cl + 0.5);
          cl = Math.min(cl, room * 1.08 + cfg.minLen * 0.3);
        }
        if (cl >= cfg.minLen * 0.55) {
          const child = register(new Branch(cd, parent, s));
          grow(child, P, dir, cl);
          parent.children.push(child);
          if (cd < maxDepth) spawnChildren(child, cd + 1);
        }
      }
      s += rng.range(cfg.gap[0], cfg.gap[1]);
    }
  }

  // ---- Trunk -------------------------------------------------------------
  const trunk = register(new Branch(0));
  const leanAz = rng.range(0, Math.PI * 2);
  const lean = 0.13;
  grow(trunk, [0, -0.45, 0], [Math.sin(lean) * Math.cos(leanAz), 1, Math.sin(lean) * Math.sin(leanAz)], 2.95);
  {
    // Centre the crown over the (leaning) trunk top.
    const top = trunk.pointAt(trunk.length);
    crown.c[0] = top[0] * 0.8;
    crown.c[2] = top[2] * 0.8;
  }

  // ---- Scaffold limbs ----------------------------------------------------
  // Five spreading limbs evenly around the compass plus one steep central leader.
  const limbCount = 5;
  const elevs = [0.84, 0.72, 0.62, 0.53, 0.45];
  for (let i = elevs.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [elevs[i], elevs[j]] = [elevs[j], elevs[i]];
  }
  const az0 = rng.range(0, Math.PI * 2);
  const trunkLen = trunk.length;
  const limbs = [];
  const addLimb = (az, el, s, len) => {
    const P = trunk.pointAt(s);
    const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const limb = register(new Branch(1, trunk, s));
    grow(limb, P, dir, len, [Math.cos(az), Math.sin(az)]);
    trunk.children.push(limb);
    limbs.push(limb);
  };
  for (let i = 0; i < limbCount; i++) {
    const az = az0 + (i / limbCount) * Math.PI * 2 + rng.sym(0.2);
    const el = elevs[i];
    const s = trunkLen - rng.range(0.05, 0.8) * (el < 0.7 ? 1.2 : 0.8);
    addLimb(az, el, s, (6.4 + (0.9 - el) * 4.0) * rng.range(0.93, 1.07));
  }
  addLimb(az0 + rng.range(0, Math.PI * 2), 1.28, trunkLen, rng.range(5.0, 5.6));
  for (const limb of limbs) spawnChildren(limb, 2);

  // A couple of secondary leaders straight off the trunk top keep the centre full.
  for (let i = 0; i < 2; i++) {
    const az = az0 + rng.range(0, Math.PI * 2);
    const el = rng.range(0.95, 1.2);
    const s = trunkLen - rng.range(0.2, 0.6);
    const P = trunk.pointAt(s);
    const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const b = register(new Branch(2, trunk, s));
    grow(b, P, dir, rng.range(2.6, 3.4));
    trunk.children.push(b);
    spawnChildren(b, 3);
  }

  // ---- Epicormic flowering shoots on trunk and limb bases (dōbuki) ---------
  const epicormic = [];
  const addShoot = (host, s, len) => {
    const P = host.pointAt(s);
    const T = host.tangentAt(s);
    const side = V.perpendicular([0, 0, 0], T);
    V.rotateAxis(side, side, T, rng.range(0, Math.PI * 2));
    const dir = V.normalize([0, 0, 0], [side[0] + T[0] * 0.4, side[1] + T[1] * 0.4 + 0.35, side[2] + T[2] * 0.4]);
    const b = register(new Branch(5, host, s));
    grow(b, P, dir, len);
    host.children.push(b);
    epicormic.push(b);
  };
  for (let i = 0; i < 9; i++) addShoot(trunk, rng.range(0.9, trunkLen - 0.5), rng.range(0.08, 0.2));
  for (const limb of limbs) for (let i = 0; i < 2; i++) addShoot(limb, rng.range(0.4, 1.8), rng.range(0.1, 0.25));

  // ---- Surface roots -------------------------------------------------------
  const roots = [];
  const rootCount = 7;
  const rootAz = [];
  const raz0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < rootCount; i++) {
    const az = raz0 + (i / rootCount) * Math.PI * 2 + rng.sym(0.25);
    rootAz.push(az);
    const P = trunk.pointAt(0.42);
    const r = new Branch(1, trunk, 0.42, 'root');
    register(r);
    grow(r, P, [Math.cos(az), -0.05, Math.sin(az)], rng.range(1.0, 1.9));
    trunk.children.push(r);
    roots.push(r);
  }

  // ---- Radii (pipe model on downstream wood length) ------------------------
  const total = new Map();
  const totalLen = (b) => {
    if (b.kind === 'root') return 0;
    let t = b.length;
    for (const c of b.children) t += totalLen(c);
    total.set(b, t);
    return t;
  };
  totalLen(trunk);

  const rTip = 0.0032;
  const trunkTop = 0.31;
  const k = (trunkTop - rTip) / Math.sqrt(total.get(trunk) - trunk.length * 0.15);
  for (const b of branches) {
    if (b.kind === 'root') continue;
    const kids = b.children.filter((c) => c.kind !== 'root').sort((a, c) => a.attachS - c.attachS);
    const suffix = new Float64Array(kids.length + 1);
    for (let i = kids.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + total.get(kids[i]);
    let ci = 0;
    const L = b.length;
    for (let i = 0; i < b.count; i++) {
      const s = b.s[i];
      while (ci < kids.length && kids[ci].attachS < s) ci++;
      const down = (L - s) + suffix[ci];
      let r = rTip + k * Math.sqrt(down);
      if (b.depth === 0) r *= 1 + 0.16 * (1 - s / L);
      b.r.push(r);
    }
  }
  // The trunk swells into a knuckle where the scaffold limbs fork, instead of
  // thinning as each limb takes its share.
  {
    const firstFork = Math.min(...trunk.children.filter((c) => c.kind === 'wood' && c.depth === 1).map((c) => c.attachS));
    const rFork = trunk.radiusAt(firstFork);
    const L = trunk.length;
    for (let i = 0; i < trunk.count; i++) {
      const s = trunk.s[i];
      if (s <= firstFork) continue;
      const t = (s - firstFork) / Math.max(1e-3, L - firstFork);
      trunk.r[i] = Math.max(trunk.r[i], rFork * V.mix(1.0, 0.62, t * t));
    }
  }
  for (const r of roots) {
    const r0 = rng.range(0.22, 0.3);
    const L = r.length;
    for (let i = 0; i < r.count; i++) {
      const t = r.s[i] / L;
      r.r.push(r0 * Math.pow(1 - t, 0.95) + 0.02);
    }
    // Let roots hug and sink into the soil as they leave the trunk.
    for (let i = 0; i < r.count; i++) {
      const t = r.s[i] / L;
      const x = r.p[i * 3], z = r.p[i * 3 + 2];
      const g = groundAt(x, z);
      // Arch up out of the trunk flare, then dive gradually under the turf.
      const target = g - r.r[i] * V.mix(-0.05, 1.7, Math.pow(t, 1.1)) - 0.03 * t;
      r.p[i * 3 + 1] = V.mix(r.p[i * 3 + 1], target, V.smoothstep(0.0, 0.18, t));
    }
    // Recompute arc lengths after re-seating.
    for (let i = 1; i < r.count; i++) {
      const a = (i - 1) * 3, c = i * 3;
      r.s[i] = r.s[i - 1] + Math.hypot(r.p[c] - r.p[a], r.p[c + 1] - r.p[a + 1], r.p[c + 2] - r.p[a + 2]);
    }
  }

  // ---- Wind compliance --------------------------------------------------------
  let maxA = 0, maxB = 0;
  const visit = (b, wA0, wB0, phA, phB) => {
    if (b.depth === 1 && b.kind === 'wood') phA = rng.next();
    if (b.depth === 3 || (b.depth >= 3 && phB < 0)) phB = rng.next();
    b.phaseA = b.depth >= 1 ? phA : 0;
    b.phaseB = b.depth >= 3 ? phB : 0;
    let a = wA0, w = wB0;
    for (let i = 0; i < b.count; i++) {
      if (i > 0 && b.kind === 'wood') {
        const ds = b.s[i] - b.s[i - 1];
        const r = b.r[i];
        if (b.depth >= 1) a += ds * (0.05 / (r + 0.05));
        if (b.depth >= 3) w += ds * (0.012 / (r + 0.012));
      }
      b.wA.push(b.kind === 'root' ? 0 : a);
      b.wB.push(b.kind === 'root' ? 0 : w);
    }
    maxA = Math.max(maxA, a);
    maxB = Math.max(maxB, w);
    for (const c of b.children) {
      visit(c, b.depth >= 1 ? b.sampleArray(b.wA, c.attachS) : 0, b.depth >= 3 ? b.sampleArray(b.wB, c.attachS) : 0, phA, b.depth >= 3 ? phB : -1);
    }
  };
  visit(trunk, 0, 0, 0, -1);
  for (const b of branches) {
    for (let i = 0; i < b.count; i++) {
      b.wA[i] /= maxA;
      b.wB[i] /= maxB;
    }
  }

  // ---- Bounds ---------------------------------------------------------------
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let nodes = 0;
  for (const b of branches) {
    for (let i = 0; i < b.count; i++) {
      for (let c = 0; c < 3; c++) {
        const v = b.p[i * 3 + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    nodes += b.count;
  }

  return { branches, trunk, limbs, roots, rootAz, epicormic, crown, bounds: { min, max }, nodes, seed };
}
