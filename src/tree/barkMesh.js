// Builds the woody surface of the tree from the skeleton: every branch becomes a
// generalized cylinder swept along a Catmull-Rom curve with parallel-transport
// frames. Each vertex also stores its cylinder coordinates (cosθ·r, sinθ·r)
// and arc length so the bark shader can lay seamless anisotropic patterns.
// Cross-sections are sculpted per vertex — root buttresses and flare at
// the base, gnarled lumps and twisting fissures on old wood, collars where a
// branch leaves its parent and swollen bark ridges on the parent around it.

import * as V from '../core/vec.js';
import { Noise } from '../core/noise.js';

function radialCount(r, depth, kind) {
  if (kind === 'root') return r > 0.12 ? 22 : 16;
  if (depth === 0) return 60;
  if (r >= 0.12) return 32;
  if (r >= 0.07) return 24;
  if (r >= 0.04) return 16;
  if (r >= 0.022) return 11;
  if (r >= 0.013) return 8;
  if (r >= 0.0075) return 5;
  return 4;
}

const MAX_STEP = [0.045, 0.075, 0.08, 0.07, 0.065, 0.06];
const MIN_STEP = [0.03, 0.035, 0.03, 0.035, 0.05, 0.065];

// Uniform Catmull-Rom position on the node polyline at node-parameter u.
function curvePoint(b, i, f, out) {
  const n = b.count;
  const p = b.p;
  const i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(n - 1, i + 1), i3 = Math.min(n - 1, i + 2);
  const t = f, t2 = t * t, t3 = t2 * t;
  for (let c = 0; c < 3; c++) {
    const P0 = p[i0 * 3 + c], P1 = p[i1 * 3 + c], P2 = p[i2 * 3 + c], P3 = p[i3 * 3 + c];
    out[c] = 0.5 * (2 * P1 + (-P0 + P2) * t + (2 * P0 - 5 * P1 + 4 * P2 - P3) * t2 + (-P0 + 3 * P1 - 3 * P2 + P3) * t3);
  }
  return out;
}

export function buildBarkMesh(skel, opts = {}) {
  const noise = new Noise((skel.seed || 1) * 7 + 3);
  const groundAt = opts.groundAt ?? (() => 0);

  const pos = [], cyl = [], bark = [], wind = [];
  const index = [];
  let vbase = 0;

  const C = [0, 0, 0], T = [0, 0, 0], N = [0, 0, 0], B = [0, 0, 0];
  const tmp = [0, 0, 0], rd = [0, 0, 0], q = [0, 0, 0];

  for (const b of skel.branches) {
    const L = b.length;
    if (L < 1e-3 || b.count < 2) continue;
    const isRoot = b.kind === 'root';
    const depth = b.depth;
    const r0 = b.r[0];
    const sides = radialCount(r0, depth, b.kind);
    const parent = b.parent;
    const rp = parent ? parent.radiusAt(b.attachS) : r0;
    const seed = (Math.sin(b.id * 12.9898 + 78.233) * 43758.5453) % 1 * 0.5 + 0.5;

    // Children that may swell this branch's bark around their base.
    const swell = [];
    if (depth <= 3) {
      for (const c of b.children) {
        if (c.kind === 'root') continue;
        const cr = c.r[0];
        const pr = b.radiusAt(c.attachS);
        if (cr < pr * 0.22) continue;
        const cd = c.tangentAt(0, [0, 0, 0]);
        const bt = b.tangentAt(c.attachS, [0, 0, 0]);
        // Perpendicular component of the child direction.
        const dd = V.dot(cd, bt);
        const perp = V.normalize([0, 0, 0], [cd[0] - bt[0] * dd, cd[1] - bt[1] * dd, cd[2] - bt[2] * dd]);
        swell.push({ s: c.attachS, r: cr, perp, width: cr * 1.8 + 0.015 });
      }
    }

    // Ring positions along the branch.
    const ringS = [0];
    while (ringS[ringS.length - 1] < L) {
      const s = ringS[ringS.length - 1];
      const r = b.radiusAt(s);
      const d = Math.min(depth, 5);
      let step = V.clamp(r * 1.5, MIN_STEP[d], MAX_STEP[d]);
      if (isRoot) step = 0.05;
      ringS.push(Math.min(L, s + step));
      if (L - ringS[ringS.length - 1] < step * 0.35) {
        ringS[ringS.length - 1] = L;
        break;
      }
    }
    if (ringS.length < 2) ringS.push(L);
    const rings = ringS.length;

    // Initial frame.
    b.tangentAt(0, T);
    V.perpendicular(N, T);
    V.cross(B, T, N);

    const startVertex = vbase;
    for (let k = 0; k < rings; k++) {
      const s = ringS[k];
      const [ni, nf] = b.locate(s);
      curvePoint(b, ni, nf, C);
      // Tangent by central difference on the curve.
      {
        const s1 = Math.min(L, s + 0.01), s0 = Math.max(0, s - 0.01);
        const [a1, f1] = b.locate(s1);
        const [a0, f0] = b.locate(s0);
        curvePoint(b, a1, f1, tmp);
        curvePoint(b, a0, f0, q);
        const nt = V.normalize([0, 0, 0], V.sub([0, 0, 0], tmp, q));
        // Parallel transport of N onto the new tangent.
        const dn = V.dot(N, nt);
        V.normalize(N, [N[0] - nt[0] * dn, N[1] - nt[1] * dn, N[2] - nt[2] * dn]);
        V.copy(T, nt);
        V.cross(B, T, N);
      }

      let r = b.sampleArray(b.r, s);
      const wA = b.sampleArray(b.wA, s);
      const wB = b.sampleArray(b.wB, s);
      const tipFade = k === rings - 1 ? 0.35 : 1;

      // Collar where this branch leaves its parent.
      let collar = 1;
      let crotchAO = 1;
      if (parent && !isRoot) {
        const ex = Math.max(0, s - rp * 0.7);
        const amp = 0.12 + (depth === 1 ? 0.6 : 0.4) * Math.min(1, r0 / rp);
        collar = 1 + amp * Math.exp(-ex / (rp * 0.9 + r0 * 2));
        crotchAO = 1 - 0.5 * Math.exp(-Math.max(0, s - rp * 0.6) / (rp * 0.8 + 0.01));
      }
      if (isRoot) {
        const t = s / L;
        collar = 1 + 0.5 * Math.exp(-s / 0.25);
        crotchAO = 0.75 + 0.25 * V.smoothstep(0, 0.3, t);
      }

      const groundY = groundAt(C[0], C[2]);

      for (let j = 0; j < sides; j++) {
        const th = (j / sides) * Math.PI * 2;
        const cs = Math.cos(th), sn = Math.sin(th);
        rd[0] = N[0] * cs + B[0] * sn;
        rd[1] = N[1] * cs + B[1] * sn;
        rd[2] = N[2] * cs + B[2] * sn;

        let rr = r * collar;
        let ao = crotchAO;

        // Gnarl: large slow lumps on old wood.
        if (depth <= 2 || isRoot) {
          const amp = isRoot ? 0.12 : depth === 0 ? 0.11 : depth === 1 ? 0.075 : 0.045;
          const sx = C[0] + rd[0] * r, sy = C[1] + rd[1] * r, sz = C[2] + rd[2] * r;
          const g = noise.noise3(sx * 1.6, sy * 1.6, sz * 1.6) * 0.65 + noise.noise3(sx * 4.3 + 7, sy * 4.3, sz * 4.3) * 0.35;
          rr *= 1 + amp * g;
        }

        // Trunk: buttresses, base flare and twisting longitudinal fissures.
        if (depth === 0) {
          const h = C[1] - groundY;
          const az = Math.atan2(rd[2], rd[0]);
          let lobe = 0;
          for (const raz of skel.rootAz) {
            let da = az - raz;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            lobe += Math.exp(-(da * da) / (0.3 * 0.3));
          }
          const hh = Math.max(h, 0);
          rr *= 1 + 0.42 * Math.exp(-hh / 0.42) + 0.95 * lobe * Math.exp(-hh / 0.32) + 0.12 * lobe * Math.exp(-hh / 1.1);
          const twist = th * 9 + C[1] * 1.3 + noise.noise3(C[0] * 2, C[1] * 0.7, C[2] * 2) * 2.2;
          const ridge = 1 - Math.abs(Math.sin(twist));
          rr *= 1 + 0.035 * (ridge * ridge - 0.4);
          ao *= 0.55 + 0.45 * V.smoothstep(-0.05, 0.9, h);
        }

        if (depth === 1 && !isRoot) {
          const twist = th * 6 + s * 0.9;
          const ridge = 1 - Math.abs(Math.sin(twist + noise.noise2(s * 0.8, th)));
          rr *= 1 + 0.02 * (ridge * ridge - 0.4);
        }

        // Swollen bark ridges around strong side branches.
        for (const w of swell) {
          const ds = (s - w.s) / w.width;
          if (ds > -3 && ds < 3) {
            const facing = Math.max(0, V.dot(rd, w.perp));
            const bump = Math.exp(-ds * ds) * facing * facing;
            rr += w.r * 0.42 * bump;
            ao *= 1 - 0.18 * bump;
          }
        }

        let ry = rd[1];
        if (isRoot) {
          // Roots are flattened, wider than they are tall.
          rr *= 1 + 0.18 * Math.abs(rd[0] * T[2] - rd[2] * T[0]);
          ry *= 0.78;
          const hh = C[1] + ry * rr - groundAt(C[0] + rd[0] * rr, C[2] + rd[2] * rr);
          ao *= 0.6 + 0.4 * V.smoothstep(-0.05, 0.15, hh);
        }

        rr *= tipFade;

        pos.push(C[0] + rd[0] * rr, C[1] + ry * rr, C[2] + rd[2] * rr);
        cyl.push(cs * r, sn * r);
        bark.push(r, s, Math.max(0.05, ao), depth + (isRoot ? 0.5 : 0) + seed * 0.25);
        wind.push(wA, wB, b.phaseA, b.phaseB);
      }

      if (k > 0) {
        const a0 = startVertex + (k - 1) * sides;
        const a1 = startVertex + k * sides;
        for (let j = 0; j < sides; j++) {
          const j1 = (j + 1) % sides;
          index.push(a0 + j, a0 + j1, a1 + j);
          index.push(a0 + j1, a1 + j1, a1 + j);
        }
      }
      vbase += sides;
    }

    // Tip cap.
    {
      const tipR = b.r[b.count - 1] * 0.6;
      pos.push(C[0] + T[0] * tipR, C[1] + T[1] * tipR, C[2] + T[2] * tipR);
      cyl.push(0, 0);
      bark.push(b.r[b.count - 1], L, 1, depth + seed * 0.25);
      wind.push(b.wA[b.count - 1], b.wB[b.count - 1], b.phaseA, b.phaseB);
      const last = startVertex + (rings - 1) * sides;
      const tip = vbase;
      for (let j = 0; j < sides; j++) index.push(last + j, last + ((j + 1) % sides), tip);
      vbase += 1;
    }
  }

  const position = new Float32Array(pos);
  const normal = computeNormals(position, index);
  return {
    position,
    normal,
    cyl: new Float32Array(cyl),
    bark: new Float32Array(bark),
    wind: new Float32Array(wind),
    index: vbase > 65535 ? new Uint32Array(index) : new Uint16Array(index),
    vertexCount: vbase,
    triangleCount: index.length / 3,
  };
}

export function computeNormals(position, index) {
  const n = new Float32Array(position.length);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const ux = position[b] - position[a], uy = position[b + 1] - position[a + 1], uz = position[b + 2] - position[a + 2];
    const vx = position[c] - position[a], vy = position[c + 1] - position[a + 1], vz = position[c + 2] - position[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}
