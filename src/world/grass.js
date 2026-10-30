import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { COMMON, WIND, ATMOS, SHADOW, CANOPY } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';
import { groundHeight } from './terrain.js';

// Meadow of instanced grass blades. Each blade is a tapered, curved strip that
// leans along its own heading and bows under travelling gusts. Blades glow when
// the low sun shines through them and pick up the tree's shadow and the
// canopy's soft occlusion per vertex.

const SEGMENTS = 4;

function bladeMesh() {
  const pos = [];
  const index = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const t = i / SEGMENTS;
    pos.push(-1, t, 0, 1, t, 0);
  }
  pos.push(0, 1, 0);
  for (let i = 0; i < SEGMENTS - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const top = SEGMENTS * 2;
  index.push(top - 2, top - 1, top);
  return { position: new Float32Array(pos), index: new Uint16Array(index) };
}

export function createGrass({ count = 200000, radius = 34, seed = 99, treeFoot = [0, 0] } = {}) {
  const rng = new RNG(seed);
  const iBlade = new Float32Array(count * 4);
  const iShape = new Float32Array(count * 4);
  let n = 0;
  // Clumped placement: tufts scattered over a disc, thinner by the trunk.
  while (n < count) {
    const r = radius * Math.sqrt(rng.next());
    const a = rng.next() * Math.PI * 2;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const dTree = Math.hypot(cx - treeFoot[0], cz - treeFoot[1]);
    if (dTree < 0.85) continue;
    if (dTree < 2.2 && rng.next() > (dTree - 0.85) / 1.35) continue;
    const tuft = 8 + Math.floor(rng.next() * 14);
    const tuftR = rng.range(0.06, 0.2);
    const lush = rng.next();
    for (let k = 0; k < tuft && n < count; k++) {
      const rr = tuftR * Math.sqrt(rng.next());
      const aa = rng.next() * Math.PI * 2;
      const x = cx + Math.cos(aa) * rr, z = cz + Math.sin(aa) * rr;
      const edge = 1 - Math.max(0, (Math.hypot(x, z) - radius * 0.8) / (radius * 0.2));
      const nearTree = Math.min(1, Math.max(0.35, (dTree - 0.8) / 3));
      iBlade[n * 4] = x;
      iBlade[n * 4 + 1] = groundHeight(x, z) - 0.01;
      iBlade[n * 4 + 2] = z;
      iBlade[n * 4 + 3] = aa + rng.sym(0.9);
      iShape[n * 4] = Math.pow(rng.next(), 1.6) * 0.3 + 0.07 + lush * 0.12 * rng.next();
      iShape[n * 4] *= edge * nearTree;
      iShape[n * 4 + 1] = rng.range(0.0045, 0.0085);
      iShape[n * 4 + 2] = rng.range(0.2, 0.75);
      iShape[n * 4 + 3] = rng.next() * 0.5 + lush * 0.5;
      n++;
    }
  }
  // Shuffle so the instance count can be lowered without leaving bald patches.
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    for (let c = 0; c < 4; c++) {
      let t = iBlade[i * 4 + c]; iBlade[i * 4 + c] = iBlade[j * 4 + c]; iBlade[j * 4 + c] = t;
      t = iShape[i * 4 + c]; iShape[i * 4 + c] = iShape[j * 4 + c]; iShape[j * 4 + c] = t;
    }
  }

  const base = bladeMesh();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(base.position, 3));
  geo.setIndex(new THREE.BufferAttribute(base.index, 1));
  geo.setAttribute('iBlade', new THREE.InstancedBufferAttribute(iBlade, 4));
  geo.setAttribute('iShape', new THREE.InstancedBufferAttribute(iShape, 4));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius + 2);

  const material = new THREE.ShaderMaterial({
    uniforms: lightingUniforms({ uViewPos: { value: new THREE.Vector3() } }),
    side: THREE.DoubleSide,
    vertexShader: COMMON + WIND + ATMOS + SHADOW + CANOPY + /* glsl */ `
      attribute vec4 iBlade; // x, y, z, heading
      attribute vec4 iShape; // height, width, bend, hue
      uniform vec3 uViewPos;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vBlade; // across, along
      varying vec3 vTint;
      varying float vShadow;
      varying vec2 vCanopy;
      void main() {
        float t = position.y;
        float h = iShape.x;
        vec3 root = iBlade.xyz;
        float dist = length(root - uViewPos);
        // Thin out tiny far blades; the terrain carries the colour there.
        h = max(h * (1.0 - smoothstep(30.0, 48.0, dist)), 1e-4);
        vec2 dir = vec2(cos(iBlade.w), sin(iBlade.w));
        vec3 fwd = vec3(dir.x, 0.0, dir.y);
        vec3 side = vec3(-dir.y, 0.0, dir.x);
        float w = iShape.y * (1.0 - t * 0.82) * (position.x);
        // Bend along its heading, then let the wind push it over.
        float bend = iShape.z * t * t;
        float g = gustField(root.xz, uTime) * (0.45 + 0.9 * uGust) * uWindStrength;
        float flick = sin(uTime * (2.0 + iShape.w * 1.5) + root.x * 1.7 + root.z * 1.3) * 0.12;
        vec3 windV = vec3(uWindDir.x, 0.0, uWindDir.y) * (g * 0.55 + flick) + side * flick * 0.6;
        vec3 off = fwd * bend * h + windV * t * t * h;
        float sag = length(off);
        vec3 p = root + side * w + vec3(0.0, t * h - sag * sag * 0.45 / max(h, 0.05), 0.0) + off;
        vWorld = p;
        vec3 n = normalize(cross(side, normalize(vec3(0.0, 1.0, 0.0) * h + fwd * bend * h * 2.0 + windV * h)));
        n = normalize(n + side * position.x * 0.45);
        vNormal = n;
        vBlade = vec2(position.x, t);
        float hue = iShape.w;
        // Patches of lush, cool and sun-dried grass.
        float patchN = vnoise2(root.xz * 0.21) * 0.65 + vnoise2(root.xz * 0.9) * 0.35;
        vTint = mix(vec3(0.82, 0.95, 0.85), vec3(1.35, 1.1, 0.62), saturate(hue * hue * 0.7 + smoothstep(0.45, 0.8, patchN) * 0.6));
        vShadow = shadowFast(p + uSunDir * 0.02, 0.02, 2.5);
        vCanopy = canopyLight(p);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: COMMON + ATMOS + /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vBlade;
      varying vec3 vTint;
      varying float vShadow;
      varying vec2 vCanopy;
      void main() {
        // MSAA can shade thin blades outside their triangle: keep varyings in range.
        float t = saturate(vBlade.y);
        float shadow = saturate(vShadow);
        vec2 canopy = saturate(vCanopy);
        vec3 v = normalize(cameraPosition - vWorld);
        vec3 n = normalize(vNormal);
        if (dot(n, v) < 0.0) n = -n;
        vec3 l = uSunDir;
        vec3 root = vec3(0.014, 0.026, 0.01);
        vec3 mid = vec3(0.045, 0.072, 0.022);
        vec3 tip = vec3(0.13, 0.13, 0.045);
        vec3 albedo = mix(root, mid, smoothstep(0.0, 0.45, t));
        albedo = mix(albedo, tip, smoothstep(0.45, 1.0, t)) * vTint;
        float ao = mix(0.35, 1.0, smoothstep(0.0, 0.7, t)) * (0.3 + 0.7 * canopy.x);
        float ndl = dot(n, l);
        float wrap = saturate((ndl + 0.35) / 1.35);
        float back = pow(saturate(dot(-v, l)), 3.0) * (0.35 + 0.65 * t);
        vec3 sun = uSunColor * shadow * (albedo * wrap * 0.85 + albedo * vec3(0.9, 1.0, 0.45) * back * 0.9);
        vec3 amb = ambientLight(n) * albedo * ao;
        float spec = pow(saturate(dot(reflect(-l, n), v)), 24.0) * 0.08 * t;
        vec3 col = sun + amb + uSunColor * shadow * spec;
        col = applyFog(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { mesh, material, geometry: geo, max: count };
}
