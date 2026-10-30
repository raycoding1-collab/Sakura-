// Procedural tree skeletons.
//
// A tree is grown recursively from a species description: a trunk, a set of
// scaffold limbs, then ever finer orders of branches. Growth directions are
// shaped by smooth wander noise, photo- and gravitropism, an outward spread
// bias, a held compass heading for the scaffold, and a lumpy crown envelope.
// Weeping species then let long pendulous branchlets fall from their outer
// branches toward the ground, in curtains.
//
// Radii follow a pipe model (cross-section proportional to the wood downstream)
// and every node carries hierarchical wind weights so the mesh, the flowers
// and the falling petals all sway together.

import { RNG } from '../core/rng.js';
import { Noise } from '../core/noise.js';
import * as V from '../core/vec.js';

export class Branch {
  constructor(depth, parent = null, attachS = 0, kind = 'wood') {
    this.depth = depth;
    this.parent = parent;
    this.attachS = attachS;
    this.kind = kind; // 'wood' | 'root' | 'weep' | 'stub'
    this.p = [];
    this.s = [];
    this.r = [];
    this.wA = [];
    this.wB = [];
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

// Lumpy dome describing where the crown may live.
class Crown {
  constructor(noise, spec) {
    this.noise = noise;
    this.c = spec.c.slice();
    this.rx = spec.rx;
    this.rz = spec.rz;
    this.ryUp = spec.ryUp;
    this.ryDown = spec.ryDown;
    this.lump = spec.lump ?? 0.12;
  }

  value(p) {
    const dx = p[0] - this.c[0], dy = p[1] - this.c[1], dz = p[2] - this.c[2];
    const ry = dy > 0 ? this.ryUp : this.ryDown;
    const q = Math.hypot(dx / this.rx, dy / ry, dz / this.rz);
    const l = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / l, uy = dy / l, uz = dz / l;
    const n = this.noise.noise3(ux * 1.7 + 11.3, uy * 1.7, uz * 1.7) * this.lump +
      this.noise.noise3(ux * 4.1, uy * 4.1 + 5.7, uz * 4.1) * this.lump * 0.4;
    return q / (1 + n);
  }

  normal(p, out) {
    const dx = p[0] - this.c[0], dy = p[1] - this.c[1], dz = p[2] - this.c[2];
    const ry = dy > 0 ? this.ryUp : this.ryDown;
    out[0] = dx / (this.rx * this.rx);
    out[1] = dy / (ry * ry);
    out[2] = dz / (this.rz * this.rz);
    return V.normalize(out);
  }

  room(p, d, maxDist) {
    const q = [0, 0, 0];
    for (let t = 0.1; t < maxDist; t += 0.1) {
      V.addScaled(q, p, d, t);
      if (this.value(q) > 1) return t;
    }
    return maxDist;
  }
}

export function generateSkeleton(seed = 7, opts = {}) {
  const sp = opts.species;
  const rng = new RNG(seed * 7919 + (sp.seedSalt || 0));
  const noise = new Noise(seed * 31 + 5 + (sp.seedSalt || 0));
  const crown = new Crown(noise, sp.crown);
  const origin = opts.origin || [0, 0, 0];
  const groundAt = opts.groundAt ?? (() => 0);
  const localGround = (x, z) => groundAt(x + origin[0], z + origin[2]) - origin[1];
  const GROW = sp.grow;
  const SPAWN = sp.spawn;
  const maxDepth = sp.maxDepth;
  const branches = [];

  const register = (b) => {
    b.id = branches.length;
    branches.push(b);
    return b;
  };

  // Grow one branch path in place. `stopY` ends hanging growth above the ground.
  function grow(br, start, dir, length, gp, heading = null, opt = {}) {
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
      d[1] += (gp.up(t, s) - gp.gravity(t, s)) * seg;
      if (heading) {
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
      if (br.depth > 0 && br.kind === 'wood' && !opt.free) {
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
      if (opt.stopY !== undefined && p[1] <= opt.stopY) break;
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
          grow(child, P, dir, cl, GROW[Math.min(cd, GROW.length - 1)]);
          parent.children.push(child);
          if (cd < maxDepth) spawnChildren(child, cd + 1);
        }
      }
      s += rng.range(cfg.gap[0], cfg.gap[1]);
    }
  }

  // ---- Trunk -------------------------------------------------------------------
  const T0 = sp.trunk;
  const trunk = register(new Branch(0));
  const leanAz = opts.leanAz ?? T0.leanAz ?? rng.range(0, Math.PI * 2);
  const lean = T0.lean;
  grow(trunk, [0, -0.45, 0], [Math.sin(lean) * Math.cos(leanAz), 1, Math.sin(lean) * Math.sin(leanAz)], T0.length, GROW[0]);
  {
    const top = trunk.pointAt(trunk.length);
    crown.c[0] += top[0] * 0.8;
    crown.c[2] += top[2] * 0.8;
  }
  const trunkLen = trunk.length;

  // ---- Scaffold limbs ----------------------------------------------------------
  const limbs = [];
  const az0 = rng.range(0, Math.PI * 2);
  const addLimb = (az, el, s, len, extra = {}) => {
    const P = trunk.pointAt(s);
    const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const limb = register(new Branch(1, trunk, s));
    grow(limb, P, dir, len, extra.grow || GROW[1], [Math.cos(az), Math.sin(az)], { free: !!extra.free });
    limb.role = extra.role || 'limb';
    trunk.children.push(limb);
    limbs.push(limb);
    return limb;
  };
  const L0 = sp.limbs;
  const elevs = L0.elevations.slice();
  for (let i = elevs.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [elevs[i], elevs[j]] = [elevs[j], elevs[i]];
  }
  for (let i = 0; i < elevs.length; i++) {
    const az = az0 + (i / elevs.length) * Math.PI * 2 + rng.sym(0.2);
    const el = elevs[i];
    const s = trunkLen - rng.range(L0.attach[0], L0.attach[1]);
    addLimb(az, el, s, L0.length(el) * rng.range(0.93, 1.07));
  }
  if (L0.leader) addLimb(az0 + rng.range(0, Math.PI * 2), L0.leader.elevation, trunkLen, rng.range(L0.leader.length[0], L0.leader.length[1]));
  // Long low limbs reaching out over the garden (these get wooden props).
  for (const low of L0.low || []) {
    const s = trunkLen - rng.range(0.5, 0.9);
    addLimb(low.az, low.elevation, s, low.length, { grow: low.grow, role: 'low', free: true });
  }
  for (const limb of limbs) spawnChildren(limb, 2);

  // Extra leaders from the trunk top keep the centre full.
  for (let i = 0; i < (sp.leaders || 0); i++) {
    const az = rng.range(0, Math.PI * 2);
    const el = rng.range(0.95, 1.2);
    const s = trunkLen - rng.range(0.2, 0.6);
    const P = trunk.pointAt(s);
    const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const b = register(new Branch(2, trunk, s));
    grow(b, P, dir, rng.range(2.6, 3.4), GROW[2]);
    trunk.children.push(b);
    spawnChildren(b, 3);
  }

  // ---- Weeping branchlets ------------------------------------------------------
  const weeps = [];
  if (sp.weep) {
    const W = sp.weep;
    const P = [0, 0, 0], T = [0, 0, 0], side = [0, 0, 0];
    const growWhip = (parent, s, dirIn, endY, depth) => {
      parent.pointAt(s, P);
      const drop = P[1] - endY;
      if (drop < 0.4) return null;
      const arc = rng.range(W.arc[0], W.arc[1]);
      const whip = register(new Branch(depth, parent, s, 'weep'));
      // A fountain arc: leaves its parent outward, bends over ever more
      // steeply, then falls as a gently wavering string.
      const gp = {
        seg: 0.07, wander: W.wander, freq: 1.0, out: 0,
        up: () => 0,
        gravity: (t, ss) => 0.5 + 3.2 * V.smoothstep(0.0, arc * 2.2, ss),
      };
      grow(whip, P, dirIn, arc + drop * 1.04, gp, null, { free: true, stopY: endY });
      parent.children.push(whip);
      weeps.push(whip);
      return whip;
    };
    const hosts = branches.filter((b) => b.kind === 'wood' && W.from.includes(b.depth));
    for (const b of hosts) {
      const L = b.length;
      let s = L * W.start + rng.range(0, W.gap[1]);
      while (s < L - 0.05) {
        b.pointAt(s, P);
        b.tangentAt(s, T);
        V.perpendicular(side, T);
        V.rotateAxis(side, side, T, rng.range(0, Math.PI * 2));
        const ox = P[0] - crown.c[0], oz = P[2] - crown.c[2];
        const ol = Math.hypot(ox, oz) || 1;
        // Few curtains deep inside the crown; most hang from its outer shell.
        const shell = V.smoothstep(crown.rx * 0.15, crown.rx * 0.55, ol);
        if (rng.next() > 0.25 + 0.75 * shell) {
          s += rng.range(W.gap[0], W.gap[1]);
          continue;
        }
        const dir = [T[0] * 0.3 + side[0] * 0.35 + (ox / ol) * 0.75, 0.12 + Math.abs(side[1]) * 0.15, T[2] * 0.3 + side[2] * 0.35 + (oz / ol) * 0.75];
        // Curtains fall lower toward the rim of the crown, forming a dome.
        const rim = V.smoothstep(2, crown.rx * 0.9, ol);
        const g = localGround(P[0], P[2]);
        const floorY = Math.max(g, opts.waterLevel !== undefined ? opts.waterLevel - origin[1] : -1e9);
        const endY = floorY + V.mix(W.endHigh, W.endLow, rim) + rng.range(-0.6, 0.9) * (rng.next() < 0.25 ? 1.6 : 1);
        const whip = growWhip(b, s, dir, endY, 4);
        // Weeping shoots hang in loose bundles of different lengths.
        if (whip && rng.next() < 0.45) {
          const extra = rng.int(1, 2);
          for (let e = 0; e < extra; e++) {
            const d2 = [dir[0] + rng.sym(0.25), dir[1] + rng.sym(0.1), dir[2] + rng.sym(0.25)];
            growWhip(b, Math.min(L - 0.02, s + rng.range(0.02, 0.08)), d2, endY + rng.range(0.3, 1.6), 4);
          }
        }
        if (whip && whip.length > 1.2) {
          const subs = rng.int(W.sub[0], W.sub[1]);
          for (let k = 0; k < subs; k++) {
            const ss = whip.length * rng.range(0.06, 0.4);
            whip.tangentAt(ss, T);
            V.perpendicular(side, T);
            V.rotateAxis(side, side, T, rng.range(0, Math.PI * 2));
            const d2 = [side[0] * 0.8 + T[0] * 0.3, 0.2, side[2] * 0.8 + T[2] * 0.3];
            growWhip(whip, ss, d2, endY + rng.range(0.15, 1.3), 5);
          }
        }
        s += rng.range(W.gap[0], W.gap[1]);
      }
    }
  }

  // ---- Pruning scars: a few limbs cut long ago, now short healed stubs ---------
  const stubs = [];
  for (let i = 0; i < (sp.stubs || 0); i++) {
    const host = i < 2 ? trunk : limbs[rng.int(0, limbs.length - 1)];
    const s = host === trunk ? rng.range(trunkLen * 0.55, trunkLen * 0.85) : rng.range(0.6, Math.min(2.4, host.length * 0.4));
    const P = host.pointAt(s), T = host.tangentAt(s);
    const side = V.perpendicular([0, 0, 0], T);
    V.rotateAxis(side, side, T, rng.range(0, Math.PI * 2));
    const dir = V.normalize([0, 0, 0], [side[0] + T[0] * 0.3, side[1] + 0.25, side[2] + T[2] * 0.3]);
    const stub = register(new Branch(2, host, s, 'stub'));
    grow(stub, P, dir, (host === trunk ? 0.5 : 0.3) + rng.range(0, 0.15), GROW[1], null, { free: true });
    host.children.push(stub);
    stubs.push(stub);
  }

  // ---- Epicormic flowering shoots on trunk and limb bases ----------------------
  const epicormic = [];
  for (let i = 0; i < (sp.epicormic || 0); i++) {
    const host = i < sp.epicormic * 0.5 ? trunk : limbs[rng.int(0, limbs.length - 1)];
    const s = host === trunk ? rng.range(0.9, trunkLen - 0.3) : rng.range(0.4, 1.8);
    const P = host.pointAt(s), T = host.tangentAt(s);
    const side = V.perpendicular([0, 0, 0], T);
    V.rotateAxis(side, side, T, rng.range(0, Math.PI * 2));
    const dir = V.normalize([0, 0, 0], [side[0] + T[0] * 0.4, side[1] + T[1] * 0.4 + 0.35, side[2] + T[2] * 0.4]);
    const b = register(new Branch(5, host, s));
    grow(b, P, dir, rng.range(0.08, 0.25), GROW[Math.min(5, GROW.length - 1)], null, { free: true });
    host.children.push(b);
    epicormic.push(b);
  }

  // ---- Surface roots -------------------------------------------------------------
  const roots = [];
  const rootAz = [];
  const R0 = sp.roots;
  const raz0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < R0.count; i++) {
    const az = raz0 + (i / R0.count) * Math.PI * 2 + rng.sym(0.25);
    rootAz.push(az);
    const P = trunk.pointAt(0.42);
    const r = register(new Branch(1, trunk, 0.42, 'root'));
    grow(r, P, [Math.cos(az), -0.05, Math.sin(az)], rng.range(R0.length[0], R0.length[1]), GROW[1], null, { free: true });
    trunk.children.push(r);
    roots.push(r);
  }

  // ---- Radii (pipe model on downstream wood length) --------------------------------
  const total = new Map();
  const totalLen = (b) => {
    if (b.kind === 'root') return 0;
    let t = b.length * (b.kind === 'weep' ? sp.weepWeight ?? 0.35 : 1);
    for (const c of b.children) t += totalLen(c);
    total.set(b, t);
    return t;
  };
  totalLen(trunk);

  const rTip = sp.rTip;
  const k = (sp.trunkTop - rTip) / Math.sqrt(total.get(trunk) - trunk.length * 0.15);
  for (const b of branches) {
    if (b.kind === 'root') continue;
    const kids = b.children.filter((c) => c.kind !== 'root').sort((a, c) => a.attachS - c.attachS);
    const suffix = new Float64Array(kids.length + 1);
    for (let i = kids.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + total.get(kids[i]);
    let ci = 0;
    const L = b.length;
    const own = b.kind === 'weep' ? sp.weepWeight ?? 0.35 : 1;
    for (let i = 0; i < b.count; i++) {
      const s = b.s[i];
      while (ci < kids.length && kids[ci].attachS < s) ci++;
      const down = (L - s) * own + suffix[ci];
      let r = rTip + k * Math.sqrt(down);
      if (b.depth === 0) r *= 1 + 0.16 * (1 - s / L);
      if (b.kind === 'weep') r = Math.min(r, sp.weepMaxR ?? 0.012);
      b.r.push(r);
    }
  }
  // Scaffold limbs of an old tree stay stout even where their crown is thin.
  if (L0.minRadius) {
    for (const limb of limbs) {
      const rMin = L0.minRadius * (limb.role === 'low' ? 1.25 : 1);
      for (let i = 0; i < limb.count; i++) {
        const t = limb.s[i] / limb.length;
        limb.r[i] = Math.max(limb.r[i], rMin * (1 - 0.72 * Math.pow(t, 0.8)));
      }
    }
  }
  // Stubs keep the thickness they had when they were cut.
  for (const st of stubs) {
    const host = st.parent;
    const r0 = host.radiusAt(st.attachS) * rng.range(0.4, 0.6);
    for (let i = 0; i < st.count; i++) st.r[i] = r0 * (1 - 0.08 * (st.s[i] / st.length));
  }
  // The trunk swells into a knuckle where the scaffold limbs fork, and an old
  // trunk is far thicker than its crown alone would demand.
  {
    const firstFork = Math.min(...trunk.children.filter((c) => c.kind === 'wood' && c.depth === 1).map((c) => c.attachS));
    const rFork = Math.max(trunk.radiusAt(firstFork), sp.trunkMin ?? 0);
    const L = trunk.length;
    for (let i = 0; i < trunk.count; i++) {
      const s = trunk.s[i];
      const base = (sp.trunkMin ?? 0) * (1 + 0.25 * (1 - s / firstFork));
      if (s <= firstFork) {
        trunk.r[i] = Math.max(trunk.r[i], base);
        continue;
      }
      const t = (s - firstFork) / Math.max(1e-3, L - firstFork);
      trunk.r[i] = Math.max(trunk.r[i], rFork * V.mix(1.0, 0.62, t * t));
    }
  }
  for (const r of roots) {
    const r0 = rng.range(R0.radius[0], R0.radius[1]);
    const L = r.length;
    for (let i = 0; i < r.count; i++) {
      const t = r.s[i] / L;
      r.r.push(r0 * Math.pow(1 - t, 0.95) + 0.02);
    }
    for (let i = 0; i < r.count; i++) {
      const t = r.s[i] / L;
      const x = r.p[i * 3], z = r.p[i * 3 + 2];
      const g = localGround(x, z);
      const target = g - r.r[i] * V.mix(-0.05, 1.7, Math.pow(t, 1.1)) - 0.03 * t;
      r.p[i * 3 + 1] = V.mix(r.p[i * 3 + 1], target, V.smoothstep(0.0, 0.18, t));
    }
    for (let i = 1; i < r.count; i++) {
      const a = (i - 1) * 3, c = i * 3;
      r.s[i] = r.s[i - 1] + Math.hypot(r.p[c] - r.p[a], r.p[c + 1] - r.p[a + 1], r.p[c + 2] - r.p[a + 2]);
    }
  }

  // ---- Wind compliance -----------------------------------------------------------
  let maxA = 0, maxB = 0;
  const visit = (b, wA0, wB0, phA, phB) => {
    if (b.depth === 1 && b.kind === 'wood') phA = rng.next();
    if (b.kind === 'weep' && b.parent.kind !== 'weep') phB = rng.next();
    else if (b.kind === 'weep') phB = (phB + rng.range(0.05, 0.15)) % 1;
    else if (b.depth === 3 || (b.depth >= 3 && phB < 0)) phB = rng.next();
    b.phaseA = b.depth >= 1 ? phA : 0;
    b.phaseB = b.depth >= 3 || b.kind === 'weep' ? phB : 0;
    let a = wA0, w = wB0;
    const rigid = b.kind === 'root' || b.kind === 'stub';
    for (let i = 0; i < b.count; i++) {
      if (i > 0 && !rigid) {
        const ds = b.s[i] - b.s[i - 1];
        const r = b.r[i];
        if (b.depth >= 1) a += ds * (0.05 / (r + 0.05)) * (b.kind === 'weep' ? 0.3 : 1);
        if (b.kind === 'weep') w += ds * 0.55;
        else if (b.depth >= 3) w += ds * (0.012 / (r + 0.012)) * 0.3;
      }
      b.wA.push(rigid ? wA0 : a);
      b.wB.push(rigid ? wB0 : w);
    }
    maxA = Math.max(maxA, a);
    maxB = Math.max(maxB, w);
    for (const c of b.children) {
      visit(c, b.depth >= 1 ? b.sampleArray(b.wA, c.attachS) : 0, b.depth >= 3 || b.kind === 'weep' ? b.sampleArray(b.wB, c.attachS) : 0, phA, b.depth >= 3 || b.kind === 'weep' ? phB : -1);
    }
  };
  visit(trunk, 0, 0, 0, -1);
  for (const b of branches) {
    for (let i = 0; i < b.count; i++) {
      b.wA[i] /= maxA || 1;
      b.wB[i] /= maxB || 1;
    }
  }

  // ---- Move into place -----------------------------------------------------------
  if (origin[0] || origin[1] || origin[2]) {
    for (const b of branches) {
      for (let i = 0; i < b.count; i++) {
        b.p[i * 3] += origin[0];
        b.p[i * 3 + 1] += origin[1];
        b.p[i * 3 + 2] += origin[2];
      }
    }
    crown.c[0] += origin[0];
    crown.c[1] += origin[1];
    crown.c[2] += origin[2];
  }

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

  return { branches, trunk, limbs, roots, rootAz, weeps, stubs, epicormic, crown, bounds: { min, max }, nodes, seed, species: sp, origin };
}
