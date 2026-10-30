// Light transport through the blossom canopy, baked into a small 3D grid.
// Flowers are splatted as an extinction field; for every cell we march toward
// the sun (direct transmittance) and over the sky hemisphere (ambient
// visibility). The grid shades bark, grass, ground, petals and fireflies alike
// and gives the crown its soft, cloud-like depth.

import * as V from '../core/vec.js';

export function buildCanopyGrid(flowers, sunDir, opts = {}) {
  const cell = opts.cell ?? 0.34;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const f of flowers) {
    for (let c = 0; c < 3; c++) {
      if (f.pos[c] < min[c]) min[c] = f.pos[c];
      if (f.pos[c] > max[c]) max[c] = f.pos[c];
    }
  }
  const pad = 1.2;
  min[0] -= pad; min[2] -= pad; max[0] += pad; max[2] += pad; max[1] += pad;
  min[1] = Math.min(min[1], 0) - 0.2;
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const N = nx * ny * nz;
  const sigma = new Float32Array(N);
  const idx = (x, y, z) => x + nx * (y + ny * z);

  // Splat projected flower area (G = 0.5 for random orientation) per volume.
  const cellVol = cell * cell * cell;
  const boost = opts.extinctionBoost ?? 1.0;
  for (const f of flowers) {
    const area = 2.6 * f.scale * f.scale * (0.35 + 0.65 * f.open);
    const w = (0.5 * area * boost) / cellVol;
    const gx = (f.pos[0] - min[0]) / cell - 0.5, gy = (f.pos[1] - min[1]) / cell - 0.5, gz = (f.pos[2] - min[2]) / cell - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
    const fx = gx - x0, fy = gy - y0, fz = gz - z0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const x = x0 + dx, y = y0 + dy, z = z0 + dz;
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const k = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
      sigma[idx(x, y, z)] += w * k;
    }
  }

  // Soften the field (separable 1-2-1 blur on each axis).
  const blurAxis = (src, axis) => {
    const dst = new Float32Array(N);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let a, b;
      if (axis === 0) { a = x > 0 ? src[idx(x - 1, y, z)] : 0; b = x < nx - 1 ? src[idx(x + 1, y, z)] : 0; }
      else if (axis === 1) { a = y > 0 ? src[idx(x, y - 1, z)] : 0; b = y < ny - 1 ? src[idx(x, y + 1, z)] : 0; }
      else { a = z > 0 ? src[idx(x, y, z - 1)] : 0; b = z < nz - 1 ? src[idx(x, y, z + 1)] : 0; }
      dst[idx(x, y, z)] = (a + 2 * src[idx(x, y, z)] + b) * 0.25;
    }
    return dst;
  };
  let field = blurAxis(blurAxis(blurAxis(sigma, 0), 1), 2);

  // Directions: sun + a cosine-weighted hemisphere set.
  const dirs = [];
  const K = 16;
  for (let i = 0; i < K; i++) {
    const u = (i + 0.5) / K;
    const phi = i * 2.399963;
    const r = Math.sqrt(u);
    dirs.push([Math.cos(phi) * r, Math.sqrt(1 - u), Math.sin(phi) * r]);
  }

  const march = (x, y, z, d) => {
    // March in grid units from cell centre; nearest-cell lookups.
    let px = x + 0.5, py = y + 0.5, pz = z + 0.5;
    let tau = 0;
    const step = 1.0;
    for (let i = 0; i < 200; i++) {
      px += d[0] * step; py += d[1] * step; pz += d[2] * step;
      const ix = px | 0, iy = py | 0, iz = pz | 0;
      if (px < 0 || py < 0 || pz < 0 || ix >= nx || iy >= ny || iz >= nz) break;
      tau += field[ix + nx * (iy + ny * iz)] * cell * step;
      if (tau > 8) break;
    }
    return Math.exp(-tau);
  };

  const data = new Uint8Array(N * 2);
  const sun = V.normalize([0, 0, 0], sunDir);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let vis = 0;
    for (let k = 0; k < K; k++) vis += march(x, y, z, dirs[k]);
    vis /= K;
    const t = march(x, y, z, sun);
    const i = idx(x, y, z);
    data[i * 2] = Math.round(V.clamp(vis, 0, 1) * 255);
    data[i * 2 + 1] = Math.round(V.clamp(t, 0, 1) * 255);
  }

  const size = [nx * cell, ny * cell, nz * cell];
  // Trilinear sampler for CPU-side baking (matches GPU texel-centre convention).
  const sample = (p, out = [1, 1]) => {
    const gx = (p[0] - min[0]) / cell - 0.5, gy = (p[1] - min[1]) / cell - 0.5, gz = (p[2] - min[2]) / cell - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
    const fx = gx - x0, fy = gy - y0, fz = gz - z0;
    let a = 0, b = 0, wsum = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const xx = V.clamp(x0 + dx, 0, nx - 1), yy = V.clamp(y0 + dy, 0, ny - 1), zz = V.clamp(z0 + dz, 0, nz - 1);
      const k = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
      const i = idx(xx, yy, zz);
      a += (data[i * 2] / 255) * k;
      b += (data[i * 2 + 1] / 255) * k;
      wsum += k;
    }
    out[0] = a / wsum;
    out[1] = b / wsum;
    return out;
  };

  return { data, nx, ny, nz, min, size, cell, sample };
}
