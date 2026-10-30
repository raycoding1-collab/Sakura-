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
    // Open on a three-quarter backlit view with the low sun beside the crown.
    this.az0 = 2.15;
    this.state = { az: 2.15, radius: 15, height: 1.6, look: 4 };
    this.user = { az: 2.15, radius: 15, height: 1.6, look: 4 };
    this.vel = { az: 0, pitch: 0 };
    this.idle = 0;
    this.blend = 1;
    this.resumeAfter = 9;
    this.focus = 14;
    this.pushOut = 0;
    this.onInteract = null;
    this.attach();
  }

  // The scripted path, a function of time only.
  path(t, out) {
    out.az = this.az0 + t * (Math.PI * 2 / 320) + Math.sin(t * 0.021) * 0.35;
    const w = 0.5 + 0.5 * Math.sin(t * 0.0195 + 1.2);
    out.radius = 10.4 + 6.4 * smooth(w) + 0.9 * Math.sin(t * 0.047);
    out.height = 0.9 + 1.5 * smooth(0.5 + 0.5 * Math.sin(t * 0.027 + 2.1));
    out.look = 3.7 + 0.9 * (0.5 + 0.5 * Math.sin(t * 0.023 + 0.4)) + (1 - smooth(w)) * 0.5;
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

    // Keep a respectful distance from the blossoms.
    if (this.nearestFlower) {
      const d = this.nearestFlower(this.camera.position);
      if (d < 1.2) this.pushOut += (1.2 - d) * dt * 2.5;
      else this.pushOut = Math.max(0, this.pushOut - dt * 0.12);
    }

    // Focus on the near half of the crown, eased.
    const dist = this.camera.position.distanceTo(look);
    const wantFocus = Math.max(3, dist - 3.5);
    this.focus += (wantFocus - this.focus) * Math.min(1, dt * 1.5);
  }
}
