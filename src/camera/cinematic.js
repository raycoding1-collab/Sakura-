import * as THREE from 'three';

// A slow, breathing orbit that drifts between wide establishing views, low
// looks up into the blossoms and close passes along the crown's edge. The
// viewer can take over at any time (drag, wheel, pinch); after a quiet spell
// the camera eases back into its own path from wherever it was left.

const smooth = (t) => t * t * (3 - 2 * t);

export class CinematicCamera {
  constructor(camera, dom, { groundAt, target = new THREE.Vector3(0.3, 3.6, 0.2), nearestFlower }) {
    this.camera = camera;
    this.dom = dom;
    this.groundAt = groundAt;
    this.center = target.clone();
    this.nearestFlower = nearestFlower;
    this.auto = true;
    this.time = 0;
    // Open across the pond, the low sun behind the crown.
    this.az0 = 0;
    this.time = CinematicCamera.startTime();
    this.state = this.path(this.time, {});
    this.user = { ...this.state };
    this.vel = { az: 0, pitch: 0 };
    this.idle = 0;
    this.blend = 1;
    this.resumeAfter = 9;
    this.focus = 14;
    this.pushOut = 0;
    this.onInteract = null;
    this.attach();
  }

  // The scripted path, a function of time only: a slow loop through ten
  // viewpoints around the garden (azimuth, distance, eye height, look height,
  // seconds to reach the next), smoothly splined.
  path(t, out) {
    const K = CinematicCamera.KEYS;
    const total = K.reduce((a, k) => a + k[4], 0);
    let u = ((t % total) + total) % total;
    let i = 0;
    while (u > K[i][4]) { u -= K[i][4]; i++; }
    const f = u / K[i][4];
    const k = (j) => {
      const n = K.length;
      const key = K[((j % n) + n) % n].slice();
      // Unwrap azimuth so the camera always travels the same way round.
      key[0] += Math.floor(j / n) * Math.PI * 2;
      return key;
    };
    const p0 = k(i - 1), p1 = k(i), p2 = k(i + 1), p3 = k(i + 2);
    const s = f * f * (3 - 2 * f);
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s * s + (-a + 3 * b - 3 * c + d) * s * s * s);
    out.az = this.az0 + cr(p0[0], p1[0], p2[0], p3[0]);
    out.radius = cr(p0[1], p1[1], p2[1], p3[1]);
    out.height = cr(p0[2], p1[2], p2[2], p3[2]);
    out.look = cr(p0[3], p1[3], p2[3], p3[3]);
    return out;
  }

  attach() {
    const el = this.dom;
    const pointers = new Map();
    let lastPinch = 0;
    const interact = () => {
      if (this.auto) {
        // Take over from wherever the scripted camera currently is.
        Object.assign(this.user, this.state);
      }
      this.auto = false;
      this.idle = 0;
      if (this.onInteract) this.onInteract();
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      interact();
    });
    el.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 1) {
        this.vel.az = -dx * 0.0042;
        this.vel.pitch = dy * 0.012;
        this.user.az += this.vel.az;
        this.user.height = THREE.MathUtils.clamp(this.user.height + this.vel.pitch, 0.4, 9);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) this.user.radius = THREE.MathUtils.clamp(this.user.radius * (lastPinch / d), 6, 34);
        lastPinch = d;
      }
      interact();
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) lastPinch = 0;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.user.radius = THREE.MathUtils.clamp(this.user.radius * Math.pow(1.0012, e.deltaY), 6, 34);
      interact();
    }, { passive: false });
  }

  setAuto(on) {
    if (on === this.auto) return;
    if (on) this.resume();
    else {
      Object.assign(this.user, this.state);
      this.auto = false;
      this.idle = -1e9;
    }
  }

  resume() {
    // Re-anchor the scripted path so it continues from the current azimuth.
    const probe = this.path(this.time, {});
    this.az0 += this.user.az - probe.az;
    this.auto = true;
    this.blend = 0;
  }

  update(dt) {
    this.time += dt;
    const target = {};
    this.path(this.time, target);
    if (!this.auto) {
      this.idle += dt;
      // Inertia after a flick.
      this.vel.az *= Math.exp(-dt * 4);
      this.user.az += this.vel.az * dt * 30 * 0.12;
      if (this.idle > this.resumeAfter) this.resume();
    }
    if (this.auto) {
      this.blend = Math.min(1, this.blend + dt / 7);
      const k = smooth(this.blend);
      const s = this.state;
      s.az = THREE.MathUtils.lerp(this.user.az, target.az, k);
      s.radius = THREE.MathUtils.lerp(this.user.radius, target.radius, k);
      s.height = THREE.MathUtils.lerp(this.user.height, target.height, k);
      s.look = THREE.MathUtils.lerp(this.user.look, target.look, k);
      if (this.blend >= 1) Object.assign(this.user, s);
    } else {
      const s = this.state;
      const f = 1 - Math.exp(-dt * 10);
      s.az += (this.user.az - s.az) * f;
      s.radius += (this.user.radius - s.radius) * f;
      s.height += (this.user.height - s.height) * f;
      s.look += (this.user.look - s.look) * f;
    }

    const s = this.state;
    const radius = s.radius + this.pushOut;
    const x = this.center.x + Math.cos(s.az) * radius;
    const z = this.center.z + Math.sin(s.az) * radius;
    const g = this.groundAt(x, z);
    // Gentle hand-held drift.
    const t = this.time;
    const bx = Math.sin(t * 0.37) * 0.025 + Math.sin(t * 0.91) * 0.01;
    const by = Math.sin(t * 0.29 + 1.0) * 0.02 + Math.sin(t * 0.73) * 0.008;
    this.camera.position.set(x + bx, g + s.height + by, z);
    const look = new THREE.Vector3(this.center.x, s.look, this.center.z);
    look.x += Math.sin(t * 0.23) * 0.04;
    look.y += Math.sin(t * 0.31 + 2.0) * 0.03;
    this.camera.lookAt(look);
    this.camera.updateMatrixWorld();

    // When the viewer drives, keep a respectful distance from the blossoms.
    if (this.nearestFlower && !this.auto) {
      const d = this.nearestFlower(this.camera.position);
      if (d < 1.2) this.pushOut += (1.2 - d) * dt * 2.5;
      else this.pushOut = Math.max(0, this.pushOut - dt * 0.12);
    }

    // Focus on the near half of the crown, eased.
    const dist = this.camera.position.distanceTo(look);
    // Close in, focus on the trunk's surface; further out, on the near half of the crown.
    const wantFocus = Math.max(2.5, dist < 8 ? dist - 0.9 : dist * 0.78);
    this.focus += (wantFocus - this.focus) * Math.min(1, dt * 1.5);
  }
}

// [azimuth, distance, eye height, look height, seconds to next]
CinematicCamera.KEYS = [
  [2.4, 16.0, 1.3, 3.4, 30],   // across the pond, backlit, mirrored in the water
  [3.25, 12.0, 2.2, 3.8, 26],  // past the black pine and the azaleas
  [3.9, 12.5, 3.2, 4.0, 26],   // high over the moss
  [4.6, 12.6, 2.4, 4.2, 22],   // north
  [5.06, 4.9, 1.35, 1.7, 28],  // through the curtain to the sacred rope and the hollow
  [5.98, 8.2, 1.6, 3.0, 20],   // stepping back out
  [6.46, 16.0, 1.6, 3.8, 26],  // front-lit, red maple in the foreground
  [7.08, 15.0, 2.6, 3.6, 24],  // by the wash-basin
  [7.73, 13.5, 1.7, 3.4, 24],  // over the second pond
  [8.18, 15.0, 1.9, 3.2, 26],  // beside the vermilion bridge
];
CinematicCamera.startTime = () => 0;
