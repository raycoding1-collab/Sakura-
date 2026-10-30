import { shared } from '../render/uniforms.js';

// CPU twin of the GLSL gust field so petals ride the same gusts that move the
// grass and branches.
export function gustField(x, z, t) {
  const w = shared.uWindDir.value;
  const sx = -w.y, sz = w.x;
  const along = x * w.x + z * w.y;
  const across = x * sx + z * sz;
  const a = Math.sin(along * 0.085 - t * 0.95);
  const b = Math.sin(across * 0.051 + t * 0.31 + 1.3);
  const c = Math.sin(along * 0.21 - t * 1.7 + across * 0.07);
  return 0.5 + 0.5 * (a * 0.55 + b * 0.3 + c * 0.15);
}

// Slow global breathing of the wind: long calm spells broken by soft gusts.
export function gustEnvelope(t) {
  const s1 = Math.sin(t * 0.083) * 0.5 + 0.5;
  const s2 = Math.sin(t * 0.037 + 1.7) * 0.5 + 0.5;
  const s3 = Math.sin(t * 0.21 + 0.4) * 0.5 + 0.5;
  const burst = Math.pow(s1 * s2, 2.2);
  return Math.min(1, 0.12 + burst * 1.1 + s3 * 0.08);
}
