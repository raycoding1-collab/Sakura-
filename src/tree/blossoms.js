// Blossom placement and the hand-built flower mesh.
//
// Flowers grow in umbel-like clusters of three to five on short spurs along
// the fine twigs, each on its own drooping pedicel. Every flower instance knows
// its orientation, size, how far it has opened (tight crimson bud → fully open),
// its tint and age, which petals it has already shed, and the wind weights of
// the twig it hangs from.

import { RNG } from '../core/rng.js';
import * as V from '../core/vec.js';

function quatFromTo(out, from, to) {
  // Shortest-arc quaternion rotating unit vector `from` onto unit vector `to`.
  const d = V.dot(from, to);
  if (d < -0.999999) {
    const axis = V.perpendicular([0, 0, 0], from);
    out[0] = axis[0]; out[1] = axis[1]; out[2] = axis[2]; out[3] = 0;
    return out;
  }
  const c = V.cross([0, 0, 0], from, to);
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = 1 + d;
  const l = Math.hypot(out[0], out[1], out[2], out[3]);
  out[0] /= l; out[1] /= l; out[2] /= l; out[3] /= l;
  return out;
}

function quatMul(out, a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = ax * bw + aw * bx + ay * bz - az * by;
  out[1] = ay * bw + aw * by + az * bx - ax * bz;
  out[2] = az * bw + aw * bz + ax * by - ay * bx;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export function placeBlossoms(skel, opts = {}) {
  const rng = new RNG((skel.seed || 1) * 977 + 13);
  const density = opts.density ?? 1;
  const cx = skel.crown.c[0], cz = skel.crown.c[2];

  const flowers = [];
  const clusters = [];
  const P = [0, 0, 0], T = [0, 0, 0], side = [0, 0, 0], tmp = [0, 0, 0], q = [0, 0, 0, 1], qr = [0, 0, 0, 1];
  const UP = [0, 1, 0];

  const addCluster = (b, s, terminal) => {
    b.pointAt(s, P);
    b.tangentAt(s, T);
    const r = b.radiusAt(s);
    // Spur direction: around the twig, favouring up and outward.
    V.perpendicular(side, T);
    V.rotateAxis(side, side, T, rng.range(0, Math.PI * 2));
    const ox = P[0] - cx, oz = P[2] - cz;
    const ol = Math.hypot(ox, oz) || 1;
    const out = [ox / ol, 0, oz / ol];
    const dir = [
      side[0] * 0.9 + out[0] * 0.45 + T[0] * (terminal ? 0.9 : 0.25),
      side[1] * 0.9 + 0.35 + T[1] * (terminal ? 0.9 : 0.25),
      side[2] * 0.9 + out[2] * 0.45 + T[2] * (terminal ? 0.9 : 0.25),
    ];
    V.normalize(dir);
    const spur = terminal ? 0.004 : rng.range(0.004, 0.012);
    const anchor = [P[0] + side[0] * r + dir[0] * spur, P[1] + side[1] * r + dir[1] * spur, P[2] + side[2] * r + dir[2] * spur];

    const i = b.locate(s)[0];
    const wind = [b.sampleArray(b.wA, s), b.sampleArray(b.wB, s), b.phaseA, b.phaseB];

    const pinkCluster = rng.next();
    const roll = rng.next();
    const n = terminal ? (roll < 0.3 ? 4 : roll < 0.75 ? 5 : 6) : roll < 0.1 ? 3 : roll < 0.45 ? 4 : roll < 0.85 ? 5 : 6;
    clusters.push({ anchor, dir, n });
    for (let k = 0; k < n; k++) {
      // Pedicel direction fans out from the spur and droops under the flower's weight.
      rng.unitVector(tmp);
      const fd = V.normalize([0, 0, 0], [dir[0] + tmp[0] * 0.85, dir[1] + tmp[1] * 0.85 - 0.25, dir[2] + tmp[2] * 0.85]);
      const ped = rng.range(0.018, 0.034);
      const pos = [anchor[0] + fd[0] * ped, anchor[1] + fd[1] * ped - ped * 0.25, anchor[2] + fd[2] * ped];
      // Flower faces along the pedicel, nodding slightly downward/outward.
      const face = V.normalize([0, 0, 0], [fd[0] + dir[0] * 0.3, fd[1] - 0.18, fd[2] + dir[2] * 0.3]);
      quatFromTo(q, UP, face);
      const spin = rng.range(0, Math.PI * 2);
      qr[0] = 0; qr[1] = Math.sin(spin / 2); qr[2] = 0; qr[3] = Math.cos(spin / 2);
      quatMul(q, q, qr);

      const stage = rng.next();
      // Slightly larger than life so the crown reads as a cloud from afar.
      let open, scale = rng.range(0.0165, 0.0205) * 1.3;
      if (stage < 0.07) { open = rng.range(0.0, 0.16); scale *= 0.8; }
      else if (stage < 0.17) { open = rng.range(0.35, 0.75); scale *= 0.92; }
      else open = rng.range(0.86, 1.0);
      let mask = 0;
      if (open > 0.85) {
        const m = rng.next();
        if (m < 0.13) mask |= 1 << rng.int(0, 4);
        if (m < 0.04) mask |= 1 << rng.int(0, 4);
      }
      flowers.push({
        pos, quat: [q[0], q[1], q[2], q[3]], anchor,
        scale, open,
        tint: V.clamp(pinkCluster * 0.7 + rng.next() * 0.3, 0, 1),
        age: rng.next(),
        mask,
        phase: rng.next(),
        wind,
        depth: b.depth,
        node: i,
      });
    }
  };

  for (const b of skel.branches) {
    if (b.kind !== 'wood' || b.depth < 3) continue;
    const L = b.length;
    let start, gap;
    if (b.depth === 3) { start = L * 0.4; gap = 0.07; }
    else if (b.depth === 4) { start = L * 0.08; gap = 0.046; }
    else { start = Math.min(L * 0.15, 0.03); gap = 0.04; }
    gap /= density;
    let s = start + rng.range(0, gap);
    while (s < L - 0.02) {
      addCluster(b, s, false);
      s += gap * rng.range(0.7, 1.3);
    }
    if (b.children.length === 0 || b.depth >= 4) addCluster(b, L, true);
  }

  // Shuffle so any prefix is a uniform random subset (used for quality scaling).
  for (let i = flowers.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = flowers[i];
    flowers[i] = flowers[j];
    flowers[j] = t;
  }
  return { flowers, clusters };
}

// Base mesh of one flower in a normalised local frame (petal length = 1,
// flower axis = +Y). Shape is finished in the vertex shader, which knows how
// open the flower is; outlines are cut in the fragment shader.
//   type 0 petal       position = (u ∈ [-1,1] across, v ∈ [0,1] along)
//   type 1 stamen disk position = (x, z) ∈ [-1,1]²
//   type 2 stamen fan  position = (x ∈ [-1,1], y ∈ [0,1]), aPart.y = fan index
//   type 3 pedicel     position = (side ±1, t ∈ [0,1])
//   type 4 sepal       position = (corner x, corner y), aPart.y = sepal index
export function flowerBaseMesh({ detail = true, petalAcross = 3, petalAlong = 3 } = {}) {
  const pos = [], part = [], index = [];
  let v = 0;
  const quad = (a, b, c, d) => index.push(a, b, c, a, c, d);

  for (let p = 0; p < 5; p++) {
    const base = v;
    for (let j = 0; j < petalAlong; j++) {
      for (let i = 0; i < petalAcross; i++) {
        pos.push((i / (petalAcross - 1)) * 2 - 1, j / (petalAlong - 1), 0);
        part.push(0, p, 0, 0);
        v++;
      }
    }
    for (let j = 0; j < petalAlong - 1; j++) {
      for (let i = 0; i < petalAcross - 1; i++) {
        const a = base + j * petalAcross + i;
        quad(a, a + 1, a + petalAcross + 1, a + petalAcross);
      }
    }
  }
  if (detail) {
    {
      const b = v;
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(x, z, 0); part.push(1, 0, 0, 0); v++; }
      quad(b, b + 1, b + 2, b + 3);
    }
    for (let f = 0; f < 2; f++) {
      const b = v;
      for (const [x, y] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { pos.push(x, y, 0); part.push(2, f, 0, 0); v++; }
      quad(b, b + 1, b + 2, b + 3);
    }
    {
      const b = v;
      const segs = 3;
      for (let j = 0; j <= segs; j++) {
        pos.push(-1, j / segs, 0); part.push(3, 0, 0, 0);
        pos.push(1, j / segs, 0); part.push(3, 0, 0, 0);
        v += 2;
      }
      for (let j = 0; j < segs; j++) {
        const a = b + j * 2;
        quad(a, a + 1, a + 3, a + 2);
      }
    }
    for (let k = 0; k < 5; k++) {
      const b = v;
      pos.push(-1, 0, 0, 1, 0, 0, 0, 1, 0);
      part.push(4, k, 0, 0, 4, k, 0, 0, 4, k, 0, 0);
      v += 3;
      index.push(b, b + 1, b + 2);
    }
  }
  return {
    position: new Float32Array(pos),
    part: new Float32Array(part),
    index: new Uint16Array(index),
  };
}

// Distant flowers: one quad per flower in its local XZ plane; the fragment
// shader draws the five notched petals, the heart and the stamen ring.
export function flowerCardMesh() {
  return {
    position: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    part: new Float32Array([5, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0]),
    index: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

// Pack flower instances into typed arrays for instanced attributes.
export function packFlowers(flowers, light) {
  const n = flowers.length;
  const iPos = new Float32Array(n * 3);
  const iQuat = new Float32Array(n * 4);
  const iParams = new Float32Array(n * 4);
  const iExtra = new Float32Array(n * 4);
  const iWind = new Float32Array(n * 4);
  const iAnchor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const f = flowers[i];
    iPos.set(f.pos, i * 3);
    iQuat.set(f.quat, i * 4);
    iParams[i * 4] = f.scale;
    iParams[i * 4 + 1] = f.open;
    iParams[i * 4 + 2] = f.tint;
    iParams[i * 4 + 3] = f.age;
    iExtra[i * 4] = f.mask;
    iExtra[i * 4 + 1] = f.phase;
    iExtra[i * 4 + 2] = light ? light[i * 2] : 1;
    iExtra[i * 4 + 3] = light ? light[i * 2 + 1] : 1;
    iWind.set(f.wind, i * 4);
    iAnchor.set(f.anchor, i * 3);
  }
  return { count: n, iPos, iQuat, iParams, iExtra, iWind, iAnchor };
}
