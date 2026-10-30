// Minimal allocation-light vec3 helpers on plain arrays, used by the generators
// so they stay independent from the renderer.

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const clone = (a) => [a[0], a[1], a[2]];
export const set = (o, x, y, z) => ((o[0] = x), (o[1] = y), (o[2] = z), o);
export const copy = (o, a) => ((o[0] = a[0]), (o[1] = a[1]), (o[2] = a[2]), o);
export const add = (o, a, b) => ((o[0] = a[0] + b[0]), (o[1] = a[1] + b[1]), (o[2] = a[2] + b[2]), o);
export const sub = (o, a, b) => ((o[0] = a[0] - b[0]), (o[1] = a[1] - b[1]), (o[2] = a[2] - b[2]), o);
export const scale = (o, a, s) => ((o[0] = a[0] * s), (o[1] = a[1] * s), (o[2] = a[2] * s), o);
export const addScaled = (o, a, b, s) => ((o[0] = a[0] + b[0] * s), (o[1] = a[1] + b[1] * s), (o[2] = a[2] + b[2] * s), o);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const lerp = (o, a, b, t) => (
  (o[0] = a[0] + (b[0] - a[0]) * t), (o[1] = a[1] + (b[1] - a[1]) * t), (o[2] = a[2] + (b[2] - a[2]) * t), o
);

export function cross(o, a, b) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  o[0] = x; o[1] = y; o[2] = z;
  return o;
}

export function normalize(o, a = o) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l;
  return o;
}

// Any unit vector perpendicular to n.
export function perpendicular(o, n) {
  if (Math.abs(n[1]) < 0.9) cross(o, n, [0, 1, 0]);
  else cross(o, n, [1, 0, 0]);
  return normalize(o);
}

// Rotate v around unit axis k by angle (Rodrigues).
export function rotateAxis(o, v, k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const d = dot(k, v) * (1 - c);
  const x = v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d;
  const y = v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d;
  const z = v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d;
  o[0] = x; o[1] = y; o[2] = z;
  return o;
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
