import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { COMMON, WIND, ATMOS, SHADOW, CANOPY } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';
import { PETAL_SHAPE } from '../tree/blossomMaterial.js';
import { groundHeight } from './terrain.js';

// Loose petals: the carpet beneath the tree and the ones drifting down.
// Both share one material — a single curled petal cut from the same signed
// distance field as the blossoms, lit as a translucent sheet.

function petalGrid(across, along) {
  const pos = [], index = [];
  for (let j = 0; j < along; j++)
    for (let i = 0; i < across; i++) pos.push((i / (across - 1)) * 2 - 1, j / (along - 1), 0);
  for (let j = 0; j < along - 1; j++)
    for (let i = 0; i < across - 1; i++) {
      const a = j * across + i;
      index.push(a, a + 1, a + across + 1, a, a + across + 1, a + across);
    }
  return { position: new Float32Array(pos), index: new Uint16Array(index) };
}

const VERT = COMMON + WIND + ATMOS + CANOPY + /* glsl */ `
attribute vec3 iPos;
attribute vec4 iQuat;
attribute vec4 iParams; // scale, curl, tint, age
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vParams;
varying vec2 vCanopy;
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  float u = position.x, v = position.y;
  float s = iParams.x;
  float curl = iParams.y;
  // Petal lies in local XZ, centred on its middle; it cups across and curls along.
  vec3 local = vec3(u * 0.5, curl * (u * u * 0.22 + (v - 0.45) * (v - 0.45) * 0.5), v - 0.5);
  vec3 n = normalize(vec3(-u * curl * 0.44, 1.0, -(v - 0.45) * curl * 1.0));
  vec3 p = iPos + qrot(iQuat, local * s);
  vWorld = p;
  vNormal = qrot(iQuat, n);
  vUv = vec2(u, v);
  vParams = iParams.yzw;
  vCanopy = canopyLight(iPos + vec3(0.0, 0.1, 0.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = COMMON + ATMOS + SHADOW + PETAL_SHAPE + /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vParams;
varying vec2 vCanopy;
uniform float uGroundLift;
void main() {
  vec2 p = vec2(vUv.x * 0.5, vUv.y * 1.05);
  float d = petalSDF(p);
  float alpha = saturate(0.5 - d / max(fwidth(d), 1e-5));
#ifdef DEPTH_PASS
  if (alpha < 0.5) discard;
  gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
#else
  if (alpha < 0.01) discard;
  float tint = vParams.y, age = vParams.z;
  vec3 albedo = petalAlbedo(p, d, tint, age * 0.5, 1.0, 0.6);
  // Fallen petals bruise and fade toward cream and tan as they age.
  albedo = mix(albedo, albedo * vec3(0.92, 0.82, 0.72), smoothstep(0.6, 1.0, age) * uGroundLift);
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 n = normalize(vNormal);
  if (dot(n, v) < 0.0) n = -n;
  vec3 l = uSunDir;
  float ndl = dot(n, l);
  float sh = shadowFast(vWorld + l * 0.02, 0.012, 1.8);
  vec3 albedoT = albedo * albedo * vec3(1.0, 0.82, 0.88);
  float fwd = pow(saturate(dot(-v, l)), 5.0);
  vec3 sun = uSunColor * sh * (albedo * max(ndl, 0.0) * 0.85 + albedoT * (max(-ndl, 0.0) * 0.6 + fwd * 0.8));
  sun += uSunColor * sh * 0.05 * pow(1.0 - saturate(dot(n, v)), 4.0);
  vec3 amb = ambientLight(n) * albedo * (0.3 + 0.7 * vCanopy.x) * mix(1.0, 0.75, uGroundLift);
  vec3 col = applyFog(sun + amb, vWorld);
  gl_FragColor = vec4(col, alpha);
#endif
}
`;

function makeMaterials(groundLift) {
  const uniforms = lightingUniforms({ uGroundLift: { value: groundLift } });
  return {
    color: new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, alphaToCoverage: true }),
    depth: new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, defines: { DEPTH_PASS: 1 } }),
  };
}

function quatFromYawTilt(out, i, yaw, tiltX, tiltZ, flip) {
  // q = yaw(Y) * tilt(X) * tilt(Z) * flip(X by π)
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cx = Math.cos(tiltX / 2), sx = Math.sin(tiltX / 2);
  const cz = Math.cos(tiltZ / 2), sz = Math.sin(tiltZ / 2);
  // yaw * tiltX
  let x = cy * sx, y = sy * cx, z = -sy * sx, w = cy * cx;
  // * tiltZ
  let x2 = x * cz + y * sz, y2 = y * cz - x * sz, z2 = z * cz + w * sz, w2 = w * cz - z * sz;
  if (flip) {
    // * (1,0,0,0) — 180° about X
    const fx = w2, fy = z2, fz = -y2, fw = -x2;
    x2 = fx; y2 = fy; z2 = fz; w2 = fw;
  }
  out[i] = x2; out[i + 1] = y2; out[i + 2] = z2; out[i + 3] = w2;
}

function buildGeometry(base, count, dynamic) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(base.position, 3));
  geo.setIndex(new THREE.BufferAttribute(base.index, 1));
  const mk = (size) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
    if (dynamic) a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  geo.setAttribute('iPos', mk(3));
  geo.setAttribute('iQuat', mk(4));
  geo.setAttribute('iParams', mk(4));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80);
  return geo;
}

// ---------------------------------------------------------------------------
// Carpet of fallen petals.
export function createGroundPetals({ flowers, count = 40000, seed = 5, windDir = [1, 0] }) {
  const rng = new RNG(seed);
  const geo = buildGeometry(petalGrid(2, 3), count, false);
  const P = geo.getAttribute('iPos').array;
  const Q = geo.getAttribute('iQuat').array;
  const S = geo.getAttribute('iParams').array;
  for (let i = 0; i < count; i++) {
    let x, z;
    if (rng.next() < 0.82) {
      const f = flowers[Math.floor(rng.next() * flowers.length)];
      const drift = Math.abs(rng.gauss()) * 2.6;
      x = f.pos[0] + windDir[0] * drift + rng.gauss() * 0.9;
      z = f.pos[2] + windDir[1] * drift + rng.gauss() * 0.9;
    } else {
      // Petals blown further across the meadow.
      const d = rng.range(4, 22);
      const a = Math.atan2(windDir[1], windDir[0]) + rng.gauss() * 0.7;
      x = Math.cos(a) * d + rng.gauss() * 2;
      z = Math.sin(a) * d + rng.gauss() * 2;
    }
    const lift = Math.pow(rng.next(), 2.2) * 0.09;
    P[i * 3] = x;
    P[i * 3 + 1] = groundHeight(x, z) + 0.004 + lift;
    P[i * 3 + 2] = z;
    quatFromYawTilt(Q, i * 4, rng.range(0, Math.PI * 2), rng.sym(0.35 + lift * 6), rng.sym(0.35 + lift * 6), rng.chance(0.4));
    S[i * 4] = rng.range(0.017, 0.024);
    S[i * 4 + 1] = rng.range(0.1, 0.9);
    S[i * 4 + 2] = rng.next();
    S[i * 4 + 3] = rng.next();
  }
  const mats = makeMaterials(1);
  const mesh = new THREE.Mesh(geo, mats.color);
  mesh.frustumCulled = false;
  return { mesh, geometry: geo, materials: mats, max: count };
}

// ---------------------------------------------------------------------------
// Drifting petals: shed from real flower positions in the crown, carried by
// the same gust field that bends the grass and sways the branches, fluttering
// and gliding on their way down, then resting on the meadow for a while.

const AIR = 0, LANDED = 1, FADING = 2;

export class FallingPetals {
  constructor({ flowers, capacity = 5000, seed = 77, windDir, gustField }) {
    this.rng = new RNG(seed);
    this.capacity = capacity;
    this.windDir = windDir;
    this.gustField = gustField;
    this.sources = flowers.filter((f) => f.open > 0.8);
    this.geometry = buildGeometry(petalGrid(3, 3), capacity, true);
    this.P = this.geometry.getAttribute('iPos').array;
    this.Q = this.geometry.getAttribute('iQuat').array;
    this.S = this.geometry.getAttribute('iParams').array;
    this.vel = new Float32Array(capacity * 3);
    this.state = new Uint8Array(capacity).fill(FADING);
    this.timer = new Float32Array(capacity).fill(0);
    this.life = new Float32Array(capacity);
    this.spin = new Float32Array(capacity * 4); // axis xyz, rate
    this.wob = new Float32Array(capacity * 4); // amplitude, freq, phase, base scale
    this.q0 = new Float32Array(capacity * 4);
    this.restY = new Float32Array(capacity);
    this.airborne = 0;
    this.targetAir = Math.floor(capacity * 0.42);
    this.spawnAccumulator = 0;
    this.cameraPos = new THREE.Vector3();
    for (let i = 0; i < capacity; i++) {
      this.S[i * 4] = 0;
      this.timer[i] = this.rng.range(0, 1);
    }
    const mats = makeMaterials(0);
    this.materials = mats;
    this.mesh = new THREE.Mesh(this.geometry, mats.color);
    this.mesh.frustumCulled = false;
    // Pre-warm so the scene opens mid-flurry.
    for (let k = 0; k < 360; k++) this.update(1 / 30, k / 30, 0.3, true);
  }

  spawn(i) {
    const r = this.rng;
    let x, y, z;
    if (r.next() < 0.16) {
      // A few drift in from upwind near the viewer, for close passing petals.
      const c = this.cameraPos;
      const a = r.range(0, Math.PI * 2);
      const d = r.range(1.5, 9);
      x = c.x + Math.cos(a) * d - this.windDir[0] * 5;
      z = c.z + Math.sin(a) * d - this.windDir[1] * 5;
      y = groundHeight(x, z) + r.range(2.5, 6.5);
    } else {
      const f = this.sources[Math.floor(r.next() * this.sources.length)];
      x = f.pos[0] + r.sym(0.03);
      y = f.pos[1] + r.sym(0.03);
      z = f.pos[2] + r.sym(0.03);
    }
    const P = this.P, S = this.S;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    this.vel[i * 3] = this.windDir[0] * 0.3; this.vel[i * 3 + 1] = -0.2; this.vel[i * 3 + 2] = this.windDir[1] * 0.3;
    const ax = r.gauss(), ay = r.gauss(), az = r.gauss();
    const al = Math.hypot(ax, ay, az) || 1;
    this.spin[i * 4] = ax / al; this.spin[i * 4 + 1] = ay / al; this.spin[i * 4 + 2] = az / al;
    this.spin[i * 4 + 3] = r.range(0.6, 3.2) * (r.chance(0.5) ? 1 : -1);
    this.wob[i * 4] = r.range(0.3, 0.9);
    this.wob[i * 4 + 1] = r.range(1.2, 2.8);
    this.wob[i * 4 + 2] = r.range(0, Math.PI * 2);
    this.wob[i * 4 + 3] = r.range(0.02, 0.028);
    quatFromYawTilt(this.q0, i * 4, r.range(0, Math.PI * 2), r.sym(1.4), r.sym(1.4), r.chance(0.5));
    S[i * 4] = this.wob[i * 4 + 3];
    S[i * 4 + 1] = r.range(0.4, 1.2);
    S[i * 4 + 2] = r.next();
    S[i * 4 + 3] = r.next() * 0.5;
    this.state[i] = AIR;
    this.timer[i] = 0;
    this.life[i] = r.range(6, 18);
    this.restY[i] = r.range(0.004, 0.07) * (r.chance(0.6) ? 1 : 0.2);
    this.airborne++;
  }

  // Divergence-free swirl: curl of a sum of travelling sine potentials.
  flow(x, y, z, t, out) {
    const a = 0.31, b = 0.27, c = 0.23;
    let vx = -b * Math.cos(b * z + t * 0.23) * 0.9;
    let vy = -c * Math.cos(c * x + t * 0.17) * 0.6;
    let vz = -a * Math.cos(a * y * 1.7 + t * 0.31) * 0.9;
    const a2 = 0.83, b2 = 0.71, c2 = 0.67;
    vx += -b2 * Math.cos(b2 * (z + x * 0.3) - t * 0.41) * 0.35;
    vy += -c2 * Math.cos(c2 * (x - z * 0.4) + t * 0.37) * 0.25;
    vz += -a2 * Math.cos(a2 * (y * 1.5 + x * 0.2) - t * 0.29) * 0.35;
    out[0] = vx; out[1] = vy; out[2] = vz;
    return out;
  }

  update(dt, time, gust, warm = false) {
    const { P, Q, S, vel, rng } = this;
    const wd = this.windDir;
    const fl = [0, 0, 0];
    const target = this.targetAir * (0.75 + 0.6 * gust);
    // Spawn toward the target airborne population.
    this.spawnAccumulator += Math.max(0, target - this.airborne) * dt * 0.6 + dt * 6;
    let toSpawn = Math.floor(this.spawnAccumulator);
    this.spawnAccumulator -= toSpawn;
    const tmpQ = [0, 0, 0, 0];

    for (let i = 0; i < this.capacity; i++) {
      const st = this.state[i];
      if (st === FADING) {
        this.timer[i] -= dt;
        if (S[i * 4] > 0) S[i * 4] = Math.max(0, S[i * 4] - dt * 0.012);
        if (this.timer[i] <= 0 && toSpawn > 0) {
          this.spawn(i);
          toSpawn--;
        }
        continue;
      }
      if (st === LANDED) {
        this.timer[i] += dt;
        if (this.timer[i] > this.life[i]) {
          this.state[i] = FADING;
          this.timer[i] = 2.5;
        }
        continue;
      }
      // Airborne.
      this.timer[i] += dt;
      const t = this.timer[i];
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      // Orientation: initial pose · steady tumble · pendulum rocking.
      const sx = this.spin[i * 4], sy = this.spin[i * 4 + 1], sz = this.spin[i * 4 + 2];
      const ang = this.spin[i * 4 + 3] * t * 0.5;
      const rock = Math.sin(t * this.wob[i * 4 + 1] + this.wob[i * 4 + 2]) * this.wob[i * 4] * 0.5;
      const ha = (ang + rock) * 0.5;
      const sa = Math.sin(ha);
      tmpQ[0] = sx * sa; tmpQ[1] = sy * sa; tmpQ[2] = sz * sa; tmpQ[3] = Math.cos(ha);
      const q0x = this.q0[i * 4], q0y = this.q0[i * 4 + 1], q0z = this.q0[i * 4 + 2], q0w = this.q0[i * 4 + 3];
      const qx = q0w * tmpQ[0] + q0x * tmpQ[3] + q0y * tmpQ[2] - q0z * tmpQ[1];
      const qy = q0w * tmpQ[1] + q0y * tmpQ[3] + q0z * tmpQ[0] - q0x * tmpQ[2];
      const qz = q0w * tmpQ[2] + q0z * tmpQ[3] + q0x * tmpQ[1] - q0y * tmpQ[0];
      const qw = q0w * tmpQ[3] - q0x * tmpQ[0] - q0y * tmpQ[1] - q0z * tmpQ[2];
      Q[i * 4] = qx; Q[i * 4 + 1] = qy; Q[i * 4 + 2] = qz; Q[i * 4 + 3] = qw;
      // Petal normal = q · (0,1,0).
      const nx = 2 * (qx * qy - qw * qz), ny = 1 - 2 * (qx * qx + qz * qz), nz = 2 * (qy * qz + qw * qx);
      const flat = Math.abs(ny);
      // Flat petals fall slowly; edge-on petals slice down and glide sideways.
      const vt = 0.45 + 0.75 * (1 - flat);
      const glide = 0.55 * flat * (1 - flat) * 4;
      const sgn = ny > 0 ? 1 : -1;
      const g = this.gustField(x, z, time) * (0.5 + gust);
      this.flow(x, y, z, time, fl);
      const height = y - groundHeight(x, z);
      const ground = Math.min(1, height / 1.5);
      const wx = wd[0] * (0.25 + 0.9 * g) * (0.4 + 0.6 * ground) + fl[0] * 0.55;
      const wy = fl[1] * 0.35 + 0.18 * g * ground;
      const wz = wd[1] * (0.25 + 0.9 * g) * (0.4 + 0.6 * ground) + fl[2] * 0.55;
      const tx = wx - nx * sgn * glide;
      const ty = wy - vt;
      const tz = wz - nz * sgn * glide;
      const k = 1 - Math.exp(-dt / 0.45);
      vel[i * 3] += (tx - vel[i * 3]) * k;
      vel[i * 3 + 1] += (ty - vel[i * 3 + 1]) * k;
      vel[i * 3 + 2] += (tz - vel[i * 3 + 2]) * k;
      P[i * 3] = x + vel[i * 3] * dt;
      P[i * 3 + 1] = y + vel[i * 3 + 1] * dt;
      P[i * 3 + 2] = z + vel[i * 3 + 2] * dt;
      const gy = groundHeight(P[i * 3], P[i * 3 + 2]) + this.restY[i];
      if (P[i * 3 + 1] <= gy) {
        P[i * 3 + 1] = gy;
        this.state[i] = LANDED;
        this.timer[i] = 0;
        this.airborne--;
        quatFromYawTilt(Q, i * 4, rng.range(0, Math.PI * 2), rng.sym(0.3), rng.sym(0.3), ny < 0);
      } else if (Math.hypot(P[i * 3], P[i * 3 + 2]) > 70 || t > 90) {
        this.state[i] = FADING;
        this.timer[i] = 0.5;
        S[i * 4] = 0;
        this.airborne--;
      }
    }
    if (!warm) {
      for (const name of ['iPos', 'iQuat', 'iParams']) this.geometry.getAttribute(name).needsUpdate = true;
    }
  }
}
