// Deterministic pseudo-random numbers (mulberry32) with a few shaping helpers.

export class RNG {
  constructor(seed = 1) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }

  // Symmetric value in [-a, a].
  sym(a = 1) {
    return (this.next() * 2 - 1) * a;
  }

  // Approximate standard normal (sum of uniforms, cheap and smooth enough).
  gauss() {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  // Uniform direction on the unit sphere written into out[0..2].
  unitVector(out) {
    const z = this.next() * 2 - 1;
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    out[0] = r * Math.cos(a);
    out[1] = z;
    out[2] = r * Math.sin(a);
    return out;
  }

  fork() {
    return new RNG((this.next() * 4294967296) >>> 0);
  }
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
