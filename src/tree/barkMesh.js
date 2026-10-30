// Builds the woody surface of a tree from its skeleton: every branch becomes a
// generalized cylinder swept along a Catmull-Rom curve with parallel-transport
// frames. Each vertex also stores its cylinder coordinates (cosθ·r, sinθ·r)
// and arc length so the bark shader can lay seamless anisotropic patterns.
//
// Cross-sections are sculpted per vertex. An ancient trunk reads as several
// stems that fused and twisted together long ago: deep spiralling flutes,
// buttresses that run down into the roots, burls, a rotted-out hollow with
// rolled callus lips. Limbs carry gnarls and collars where they leave their
// parent; old pruning cuts are left as healed stubs with flat, ringed faces.

import * as V from '../core/vec.js';
import { Noise } from '../core/noise.js';
import { RNG } from '../core/rng.js';

function radialCount(r, depth, kind, hiRes) {
  if (kind === 'root') return r > 0.2 ? 30 : r > 0.12 ? 22 : 14;
  if (kind === 'weep') return r > 0.008 ? 4 : 3;
  if (depth === 0) return hiRes ? 144 : 72;
  if (r >= 0.2) return hiRes ? 56 : 36;
  if (r >= 0.12) return hiRes ? 40 : 28;
  if (r >= 0.07) return 24;
  if (r >= 0.04) return 16;
  if (r >= 0.022) return 11;
  if (r >= 0.013) return 8;
  if (r >= 0.0075) return 5;
  return 4;
}

const MAX_STEP = [0.022, 0.06, 0.07, 0.07, 0.065, 0.06];
const MIN_STEP = [0.018, 0.03, 0.03, 0.035, 0.05, 0.065];

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

const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function buildBarkMesh(skel, opts = {}) {
  const noise = new Noise((skel.seed || 1) * 7 + 3);
  const rng = new RNG((skel.seed || 1) * 131 + 7);
  const groundAt = opts.groundAt ?? (() => 0);
  const hiRes = opts.hiRes ?? true;
  const ancient = opts.ancient ?? false;

  // Character of the ancient trunk.
  const stems = [];
  const burls = [];
  let hollow = null;
  if (ancient) {
    for (let k = 0; k < 5; k++) stems.push({ phase: (k / 5) * Math.PI * 2 + rng.sym(0.35), w: rng.range(0.7, 1.15), wobble: rng.range(0, 10) });
    for (let k = 0; k < 7; k++) {
      burls.push({ h: rng.range(0.35, 2.6), az: rng.range(0, Math.PI * 2), size: rng.range(0.1, 0.24), amp: rng.range(0.05, 0.14) });
    }
    hollow = { h: 0.78, az: opts.hollowAz ?? -0.85, halfH: 0.46, halfA: 0.34 };
  }

  const pos = [], cyl = [], bark = [], wind = [], feat = [];
  const index = [];
  let vbase = 0;
  const trunkRings = [];

  const C = [0, 0, 0], T = [0, 0, 0], N = [0, 0, 0], B = [0, 0, 0];
  const tmp = [0, 0, 0], rd = [0, 0, 0], q = [0, 0, 0];

  for (const b of skel.branches) {
    const L = b.length;
    if (L < 1e-3 || b.count < 2) continue;
    const isRoot = b.kind === 'root';
    const isStub = b.kind === 'stub';
    const isWeep = b.kind === 'weep';
    const depth = b.depth;
    const r0 = b.r[0];
    const sides = radialCount(r0, depth, b.kind, hiRes);
    const parent = b.parent;
    const rp = parent ? parent.radiusAt(b.attachS) : r0;
    const seed = (Math.sin(b.id * 12.9898 + 78.233) * 43758.5453) % 1 * 0.5 + 0.5;
    // Encoded in the fractional part of aBark.w: wood [0, .25), cut face .4, root [.5, .75).
    const kindCode = isRoot ? 0.5 : 0;
    const kindSpan = 0.24;
    const CUT = 0.4; // flags the flat face of a pruning cut

    const swell = [];
    if (depth <= 3 && !isWeep) {
      for (const c of b.children) {
        if (c.kind === 'root' || c.kind === 'weep') continue;
        const cr = c.r[0];
        const pr = b.radiusAt(c.attachS);
        if (cr < pr * 0.22) continue;
        const cd = c.tangentAt(0, [0, 0, 0]);
        const bt = b.tangentAt(c.attachS, [0, 0, 0]);
        const dd = V.dot(cd, bt);
        const perp = V.normalize([0, 0, 0], [cd[0] - bt[0] * dd, cd[1] - bt[1] * dd, cd[2] - bt[2] * dd]);
        swell.push({ s: c.attachS, r: cr, perp, width: cr * 1.8 + 0.015 });
      }
    }

    const ringS = [0];
    while (ringS[ringS.length - 1] < L) {
      const s = ringS[ringS.length - 1];
      const r = b.radiusAt(s);
      const d = Math.min(depth, 5);
      let step = V.clamp(r * 1.5, MIN_STEP[d], MAX_STEP[d]);
      if (isRoot) step = 0.045;
      if (isWeep) step = 0.11;
      if (isStub) step = 0.03;
      ringS.push(Math.min(L, s + step));
      if (L - ringS[ringS.length - 1] < step * 0.35) {
        ringS[ringS.length - 1] = L;
        break;
      }
    }
    if (ringS.length < 2) ringS.push(L);
    const rings = ringS.length;

    b.tangentAt(0, T);
    V.perpendicular(N, T);
    V.cross(B, T, N);

    const startVertex = vbase;
    for (let k = 0; k < rings; k++) {
      const s = ringS[k];
      const [ni, nf] = b.locate(s);
      curvePoint(b, ni, nf, C);
      {
        const s1 = Math.min(L, s + 0.01), s0 = Math.max(0, s - 0.01);
        const [a1, f1] = b.locate(s1);
        const [a0, f0] = b.locate(s0);
        curvePoint(b, a1, f1, tmp);
        curvePoint(b, a0, f0, q);
        const nt = V.normalize([0, 0, 0], V.sub([0, 0, 0], tmp, q));
        const dn = V.dot(N, nt);
        V.normalize(N, [N[0] - nt[0] * dn, N[1] - nt[1] * dn, N[2] - nt[2] * dn]);
        V.copy(T, nt);
        V.cross(B, T, N);
      }

      const r = b.sampleArray(b.r, s);
      const wA = b.sampleArray(b.wA, s);
      const wB = b.sampleArray(b.wB, s);
      const tipFade = k === rings - 1 && !isStub ? 0.35 : 1;

      let collar = 1;
      let crotchAO = 1;
      if (parent && !isRoot && !isWeep) {
        const ex = Math.max(0, s - rp * 0.7);
        const amp = 0.12 + (depth === 1 ? 0.6 : 0.4) * Math.min(1, r0 / rp);
        collar = 1 + amp * Math.exp(-ex / (rp * 0.9 + r0 * 2));
        crotchAO = 1 - 0.5 * Math.exp(-Math.max(0, s - rp * 0.6) / (rp * 0.8 + 0.01));
      }
      if (isWeep) collar = 1 + 0.6 * Math.exp(-s / 0.03);
      if (isRoot) {
        const t = s / L;
        collar = 1 + 0.5 * Math.exp(-s / 0.25);
        crotchAO = 0.75 + 0.25 * V.smoothstep(0, 0.3, t);
      }
      // Healed callus roll just behind an old cut.
      if (isStub) collar *= 1 + 0.12 * V.smoothstep(L - 0.08, L - 0.01, s);

      const groundY = groundAt(C[0], C[2]);
      const h = C[1] - groundY;
      const ringRadii = depth === 0 && ancient ? new Float32Array(sides) : null;

      for (let j = 0; j < sides; j++) {
        const th = (j / sides) * Math.PI * 2;
        const cs = Math.cos(th), sn = Math.sin(th);
        rd[0] = N[0] * cs + B[0] * sn;
        rd[1] = N[1] * cs + B[1] * sn;
        rd[2] = N[2] * cs + B[2] * sn;

        let rr = r * collar;
        let ao = crotchAO;
        let feature = 0;
        const az = Math.atan2(rd[2], rd[0]);

        if ((depth <= 2 || isRoot) && !isStub) {
          const amp = isRoot ? 0.12 : depth === 0 ? 0.1 : depth === 1 ? 0.075 : 0.045;
          const sx = C[0] + rd[0] * r, sy = C[1] + rd[1] * r, sz = C[2] + rd[2] * r;
          const g = noise.noise3(sx * 1.6, sy * 1.6, sz * 1.6) * 0.65 + noise.noise3(sx * 4.3 + 7, sy * 4.3, sz * 4.3) * 0.35;
          rr *= 1 + amp * g;
        }

        if (depth === 0) {
          const hh = Math.max(h, 0);
          // Buttresses where the roots leave the trunk.
          let lobe = 0;
          for (const raz of skel.rootAz) {
            const da = angDiff(az, raz);
            lobe += Math.exp(-(da * da) / (0.3 * 0.3));
          }
          rr *= 1 + 0.42 * Math.exp(-hh / 0.42) + 0.95 * lobe * Math.exp(-hh / 0.32) + 0.12 * lobe * Math.exp(-hh / 1.1);

          if (ancient) {
            // Several stems fused and twisted together: the cross-section is
            // the union of offset circles spiralling around the axis, giving
            // rounded lobes with sharp creases where neighbours meet.
            const R = rr;
            let t1 = -1e9, t2 = -1e9;
            for (const st of stems) {
              const phi = st.phase + hh * 0.5 + 0.25 * Math.sin(hh * 1.1 + st.wobble);
              const dk = R * (0.38 + 0.06 * Math.sin(hh * 0.9 + st.wobble * 2.0));
              const rc = R * (0.6 + 0.07 * st.w);
              const dl = angDiff(az, phi);
              const sd = dk * Math.sin(dl);
              const disc = rc * rc - sd * sd;
              if (disc <= 0) continue;
              const t = dk * Math.cos(dl) + Math.sqrt(disc);
              if (t > t1) { t2 = t1; t1 = t; } else if (t > t2) t2 = t;
            }
            const blend = 0.07 * R;
            let u = t1;
            if (t1 - t2 < blend) u = t1 + ((blend - (t1 - t2)) ** 2) / (4 * blend);
            const keep = 1 - V.smoothstep(2.0, 3.1, hh);
            rr = V.mix(R, u * 1.04, keep);
            // Fine spiral grain ridges.
            const ridge = 1 - Math.abs(Math.sin(az * 11 + hh * 2.4 + noise.noise3(C[0] * 2, C[1] * 0.7, C[2] * 2) * 2.0));
            rr *= 1 + 0.028 * (ridge * ridge - 0.4);
            // Burls.
            for (const bu of burls) {
              const da = angDiff(az, bu.az) * r;
              const dh = hh - bu.h;
              const d2 = (da * da + dh * dh) / (bu.size * bu.size);
              if (d2 < 9) {
                const bump = Math.exp(-d2) * (1 + 0.35 * noise.noise3(C[0] * 9 + rd[0] * 3, C[1] * 9, C[2] * 9 + rd[2] * 3));
                rr += bu.amp * bump;
                ao *= 1 - 0.15 * Math.exp(-d2 * 0.5) * (d2 > 1 ? 1 : 0);
              }
            }
            // The hollow, with rolled callus lips around its mouth.
            if (hollow) {
              const u = angDiff(az, hollow.az) / hollow.halfA;
              const v = (hh - hollow.h) / hollow.halfH;
              const e = Math.hypot(u, v * (1 + 0.15 * Math.sin(u * 3.0)));
              const inside = 1 - V.smoothstep(0.55, 1.0, e);
              const lip = Math.exp(-((e - 1.05) * (e - 1.05)) / 0.02);
              rr *= 1 - 0.7 * Math.pow(inside, 0.6) + 0.11 * lip;
              ao *= 1 - 0.95 * Math.pow(inside, 0.45);
              feature = Math.max(inside, Math.min(0.5, lip) * 0.99);
            }
          } else {
            const twist = th * 9 + C[1] * 1.3 + noise.noise3(C[0] * 2, C[1] * 0.7, C[2] * 2) * 2.2;
            const ridge = 1 - Math.abs(Math.sin(twist));
            rr *= 1 + 0.035 * (ridge * ridge - 0.4);
          }
          ao *= 0.55 + 0.45 * V.smoothstep(-0.05, 0.9, h);
        }

        if (depth === 1 && !isRoot && !isStub) {
          const tw = th * 6 + s * 0.9;
          const ridge = 1 - Math.abs(Math.sin(tw + noise.noise2(s * 0.8, th)));
          rr *= 1 + 0.02 * (ridge * ridge - 0.4);
          if (ancient && r > 0.1) {
            // Older limbs keep a hint of the trunk's twisting flutes.
            rr *= 1 + 0.07 * Math.pow(Math.max(0, Math.cos(2 * az + s * 0.8)), 2) - 0.03;
          }
        }

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
          rr *= 1 + 0.18 * Math.abs(rd[0] * T[2] - rd[2] * T[0]);
          ry *= 0.78;
          const hh2 = C[1] + ry * rr - groundAt(C[0] + rd[0] * rr, C[2] + rd[2] * rr);
          ao *= 0.6 + 0.4 * V.smoothstep(-0.05, 0.15, hh2);
        }

        rr *= tipFade;
        if (ringRadii) ringRadii[j] = rr;

        pos.push(C[0] + rd[0] * rr, C[1] + ry * rr, C[2] + rd[2] * rr);
        cyl.push(cs * r, sn * r);
        bark.push(r, s, Math.max(0.03, ao), depth + kindCode + seed * kindSpan);
        wind.push(wA, wB, b.phaseA, b.phaseB);
        feat.push(feature);
      }
      if (ringRadii) trunkRings.push({ y: C[1], c: [C[0], C[1], C[2]], n: [N[0], N[1], N[2]], b: [B[0], B[1], B[2]], radii: ringRadii });

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

    // End cap: a cone for living tips, a flat ringed face for old cuts.
    {
      const lastR = b.r[b.count - 1];
      const tipR = isStub ? 0 : lastR * 0.6;
      pos.push(C[0] + T[0] * tipR, C[1] + T[1] * tipR, C[2] + T[2] * tipR);
      cyl.push(0, 0);
      bark.push(lastR, L, isStub ? 0.8 : 1, depth + (isStub ? CUT : kindCode + seed * kindSpan));
      wind.push(b.wA[b.count - 1], b.wB[b.count - 1], b.phaseA, b.phaseB);
      feat.push(0);
      const last = startVertex + (rings - 1) * sides;
      const tip = vbase;
      for (let j = 0; j < sides; j++) index.push(last + j, last + ((j + 1) % sides), tip);
      vbase += 1;
      if (isStub) {
        // Duplicate the rim so the face gets its own flat normal and cut flag.
        const rim = vbase;
        for (let j = 0; j < sides; j++) {
          const src = (last + j) * 3;
          pos.push(pos[src], pos[src + 1], pos[src + 2]);
          cyl.push(cyl[(last + j) * 2], cyl[(last + j) * 2 + 1]);
          bark.push(lastR, L, 0.8, depth + CUT);
          wind.push(b.wA[b.count - 1], b.wB[b.count - 1], b.phaseA, b.phaseB);
          feat.push(0);
        }
        const center = vbase + sides;
        pos.push(C[0], C[1], C[2]);
        cyl.push(0, 0);
        bark.push(lastR, L, 0.8, depth + CUT);
        wind.push(b.wA[b.count - 1], b.wB[b.count - 1], b.phaseA, b.phaseB);
        feat.push(0);
        for (let j = 0; j < sides; j++) index.push(rim + j, rim + ((j + 1) % sides), center);
        vbase += sides + 1;
      }
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
    feature: new Float32Array(feat),
    index: vbase > 65535 ? new Uint32Array(index) : new Uint16Array(index),
    vertexCount: vbase,
    triangleCount: index.length / 3,
    trunkRings,
    hollow,
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
