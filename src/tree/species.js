// Species descriptions for the skeleton generator. GROW entries steer how
// each branch order bends (per metre); SPAWN entries (indexed by child order)
// say how often and at what angles children sprout.

const grow = (seg, wander, freq, up, gravity, out) => ({ seg, wander, freq, up, gravity, out });

// An ancient Edo-higan weeping cherry (shidare-zakura), after the great
// "waterfall cherries": a massive fused, twisting trunk, steep scaffold limbs
// forming a tall dome, two long low limbs resting on wooden props, and
// curtains of pendulous branchlets falling almost to the ground.
export const WEEPING_CHERRY = {
  name: 'shidare-zakura',
  seedSalt: 0,
  trunk: { length: 3.0, lean: 0.1 },
  crown: { c: [0, 6.2, 0], rx: 9.4, rz: 9.0, ryUp: 5.4, ryDown: 6.4, lump: 0.1 },
  limbs: {
    elevations: [1.22, 1.12, 1.02, 0.94, 0.86],
    attach: [0.05, 0.75],
    length: (el) => 8.2 + (1.3 - el) * 3.0,
    leader: { elevation: 1.38, length: [7.0, 7.8] },
    minRadius: 0.17,
    low: [
      { az: 2.2, elevation: 0.16, length: 8.4, grow: grow(0.12, 0.32, 0.5, () => 0.06, (t) => 0.04 + 0.07 * t, 0) },
      { az: -0.55, elevation: 0.2, length: 7.2, grow: grow(0.12, 0.32, 0.5, () => 0.06, (t) => 0.04 + 0.07 * t, 0) },
    ],
  },
  leaders: 2,
  grow: [
    grow(0.08, 0.28, 0.6, () => 0.05, () => 0, 0),
    grow(0.13, 0.5, 0.45, (t) => (t > 0.6 ? 0.05 : 0), (t) => 0.02 + 0.12 * t, 0.008),
    grow(0.09, 0.6, 0.9, () => 0.1, () => 0.34, 0.05),
    grow(0.065, 0.8, 1.7, () => 0.15, () => 0.42, 0.04),
    grow(0.05, 1.0, 2.8, () => 0.3, () => 0.2, 0.03),
  ],
  spawn: [
    null,
    null,
    { start: 0.2, end: 0.97, gap: [0.38, 0.62], angle: [0.55, 0.95], lenRatio: [0.45, 0.68], minLen: 0.8, maxLen: 4.0, lift: 0.1, inwardSkip: 0.8 },
    { start: 0.12, end: 0.97, gap: [0.28, 0.46], angle: [0.5, 0.95], lenRatio: [0.4, 0.62], minLen: 0.4, maxLen: 2.0, lift: 0.1, inwardSkip: 0.6 },
    { start: 0.15, end: 0.95, gap: [0.18, 0.3], angle: [0.5, 0.95], lenRatio: [0.35, 0.6], minLen: 0.15, maxLen: 0.6, lift: 0.2, inwardSkip: 0.3 },
  ],
  maxDepth: 4,
  weep: { from: [2, 3, 4], start: 0.25, gap: [0.36, 0.62], arc: [0.25, 0.7], wander: 0.42, endHigh: 2.6, endLow: 0.75, sub: [1, 3] },
  roots: { count: 9, length: [1.3, 2.6], radius: [0.26, 0.38] },
  rTip: 0.0026,
  trunkTop: 0.5,
  trunkMin: 0.66,
  weepWeight: 0.3,
  weepMaxR: 0.011,
  stubs: 5,
  epicormic: 16,
  blossom: { pink: 0.75, sizeScale: 1.3 },
};

// The original Somei-Yoshino: a broad umbrella with no weeping habit.
export const YOSHINO_CHERRY = {
  name: 'somei-yoshino',
  seedSalt: 0,
  trunk: { length: 2.95, lean: 0.13 },
  crown: { c: [0, 4.7, 0], rx: 8.7, rz: 8.2, ryUp: 4.3, ryDown: 3.0, lump: 0.12 },
  limbs: {
    elevations: [0.84, 0.72, 0.62, 0.53, 0.45],
    attach: [0.05, 0.9],
    length: (el) => 6.4 + (0.9 - el) * 4.0,
    leader: { elevation: 1.28, length: [5.0, 5.6] },
  },
  leaders: 2,
  grow: [
    grow(0.09, 0.22, 0.55, () => 0.06, () => 0, 0),
    grow(0.13, 0.5, 0.45, (t) => (t > 0.7 ? 0.14 : 0), (t) => 0.035 + 0.07 * t, 0.03),
    grow(0.09, 0.62, 0.9, (t) => 0.22 + 0.2 * t, () => 0.12, 0.025),
    grow(0.065, 0.85, 1.7, (t) => 0.3 + 0.2 * t, () => 0.15, 0.035),
    grow(0.05, 1.0, 2.8, () => 0.42, () => 0.1, 0.03),
    grow(0.035, 1.2, 4.5, () => 0.65, () => 0.05, 0.02),
  ],
  spawn: [
    null,
    null,
    { start: 0.16, end: 0.97, gap: [0.36, 0.6], angle: [0.6, 1.02], lenRatio: [0.48, 0.7], minLen: 0.7, maxLen: 3.9, lift: 0.22, inwardSkip: 0.82 },
    { start: 0.1, end: 0.97, gap: [0.24, 0.4], angle: [0.55, 0.98], lenRatio: [0.42, 0.64], minLen: 0.32, maxLen: 1.9, lift: 0.16, inwardSkip: 0.6 },
    { start: 0.08, end: 0.98, gap: [0.11, 0.18], angle: [0.5, 0.95], lenRatio: [0.36, 0.62], minLen: 0.16, maxLen: 0.95, lift: 0.2, inwardSkip: 0.35 },
    { start: 0.1, end: 0.96, gap: [0.05, 0.085], angle: [0.5, 1.0], lenRatio: [0.4, 0.75], minLen: 0.07, maxLen: 0.3, lift: 0.25, inwardSkip: 0.0 },
  ],
  maxDepth: 5,
  weep: null,
  roots: { count: 7, length: [1.0, 1.9], radius: [0.22, 0.3] },
  rTip: 0.0032,
  trunkTop: 0.31,
  trunkMin: 0,
  stubs: 2,
  epicormic: 19,
  blossom: { pink: 0.35, sizeScale: 1.42 },
};
