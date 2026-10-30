import * as THREE from 'three';
import { COMMON, WIND, ATMOS, SHADOW } from '../render/glsl.js';
import { lightingUniforms } from '../render/uniforms.js';
import { LAYOUT_GLSL, POND_LOBES } from './layout.js';

// The koi pond. The scene is re-rendered from a mirrored camera into a
// reflection texture (with an oblique near plane so nothing below the water
// leaks in); the surface shader then ripples that reflection with wind-driven
// waves and the rings of landing petals, blends it by Fresnel with the dark,
// green-tinted water column, and adds a sun glint.

export class PlanarReflection {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
    this.textureMatrix = new THREE.Matrix4();
    this.target = null;
    this.scale = 0.5;
    this._v = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._rot = new THREE.Matrix4();
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
  }

  setSize(w, h) {
    const rw = Math.max(64, Math.floor(w * this.scale)), rh = Math.max(64, Math.floor(h * this.scale));
    if (this.target && this.target.width === rw && this.target.height === rh) return;
    if (this.target) this.target.dispose();
    this.target = new THREE.WebGLRenderTarget(rw, rh, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
  }

  // Mirror `camera` about the plane y = level and render `scene`.
  render(scene, camera, level, before, after) {
    const vc = this.camera;
    const camPos = camera.position;
    if (camPos.y < level + 0.02) return false;
    const n = new THREE.Vector3(0, 1, 0);
    const point = new THREE.Vector3(0, level, 0);
    this._rot.extractRotation(camera.matrixWorld);
    const look = this._t.set(0, 0, -1).applyMatrix4(this._rot).add(camPos);
    const pos = this._v.set(camPos.x, 2 * level - camPos.y, camPos.z);
    const target = new THREE.Vector3(look.x, 2 * level - look.y, look.z);
    this._up.set(0, 1, 0).applyMatrix4(this._rot);
    this._up.y = -this._up.y;
    vc.position.copy(pos);
    vc.up.copy(this._up);
    vc.lookAt(target);
    vc.updateMatrix();
    vc.updateMatrixWorld(true);
    vc.matrixWorldInverse.copy(vc.matrixWorld).invert();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.near = camera.near;
    vc.far = camera.far;

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    // Oblique near plane (Lengyel): clip everything below the water.
    this._plane.setFromNormalAndCoplanarPoint(n, point).applyMatrix4(vc.matrixWorldInverse);
    const clip = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const p = vc.projectionMatrix.elements;
    const q = this._q;
    q.x = (Math.sign(clip.x) + p[8]) / p[0];
    q.y = (Math.sign(clip.y) + p[9]) / p[5];
    q.z = -1.0;
    q.w = (1.0 + p[10]) / p[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    p[2] = clip.x;
    p[6] = clip.y;
    p[10] = clip.z + 1.0 - 0.003;
    p[14] = clip.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

    const r = this.renderer;
    const prev = r.getRenderTarget();
    before && before(vc);
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, vc);
    r.setRenderTarget(prev);
    after && after(vc);
    return true;
  }
}

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = COMMON + WIND + ATMOS + SHADOW + LAYOUT_GLSL + /* glsl */ `
uniform sampler2D uReflection;
uniform mat4 uTexMatrix;
uniform float uHasReflection;
uniform vec4 uImpacts[24];
varying vec3 vWorld;

// Height field of the surface: long soft swells, wind-brushed capillary
// wrinkles that follow the gusts, and expanding rings where petals land.
float surfaceH(vec2 p, float t) {
  float g = gustField(p, t) * (0.35 + uGust);
  vec2 w = uWindDir;
  float h = 0.0;
  h += sin(dot(p, w) * 1.9 - t * 1.6) * 0.0018;
  h += sin(dot(p, vec2(-w.y, w.x)) * 2.7 + t * 1.1) * 0.0011;
  h += (vnoise2(p * 5.0 - w * t * 0.9) - 0.5) * 0.004 * (0.3 + g);
  h += (vnoise2(p * 13.0 + w * t * 1.7) - 0.5) * 0.0018 * (0.2 + g);
  for (int i = 0; i < 24; i++) {
    vec4 im = uImpacts[i];
    float age = t - im.z;
    if (age < 0.0 || age > 4.0) continue;
    float d = length(p - im.xy);
    float front = age * 0.32;
    float env = exp(-age * 1.1) * exp(-abs(d - front) * 9.0) * im.w;
    h += sin((d - front) * 55.0) * 0.0035 * env;
  }
  return h;
}

void main() {
  vec2 p = vWorld.xz;
  float sdf = pondSDF(p);
  if (sdf > 0.25) discard;
  float t = uTime;
  float e = 0.02;
  float h0 = surfaceH(p, t);
  float hx = surfaceH(p + vec2(e, 0.0), t);
  float hz = surfaceH(p + vec2(0.0, e), t);
  vec3 n = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));

  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = saturate(dot(n, v));
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  // Reflection, perturbed by the ripples.
  vec3 refl;
  if (uHasReflection > 0.5) {
    vec4 rc = uTexMatrix * vec4(vWorld, 1.0);
    vec2 ruv = rc.xy / rc.w + n.xz * 0.035;
    refl = texture2D(uReflection, ruv).rgb;
  } else {
    refl = ambientLight(reflect(-v, n)) * 0.8;
  }

  // The water column: how deep, and how far the eye looks through it.
  float depth = 0.12 + 0.62 * smoothstep(0.0, 2.6, -sdf);
  float path = depth / max(v.y, 0.15);
  float T = exp(-path * 2.6);
  vec3 sh = vec3(shadowFast(vWorld + uSunDir * 0.05, 0.03, 2.0));
  vec3 scatter = (ambientLight(vec3(0.0, 1.0, 0.0)) * 0.08 + uSunColor * sh * 0.025) * vec3(0.35, 0.7, 0.55);
  // Sun glint.
  vec3 glint = uSunColor * sh * ggxSpec(n, v, uSunDir, 0.06) * 2.0;
  vec3 lamp = localLight(vWorld, n, 0.0) * 0.05;

  vec3 c = scatter * (1.0 - T) * (1.0 - F) + refl * F + glint + lamp;
  // Shallow margins fade into the pebble beach.
  float a = 1.0 - T * (1.0 - F);
  a *= 1.0 - smoothstep(-0.05, 0.25, sdf);
  c = applyFog(c / max(a, 1e-3), vWorld);
  gl_FragColor = vec4(c * a, a);
}
`;

export function createWater(level) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [cx, cz, rx, rz] of POND_LOBES) {
    const r = Math.max(rx, rz) + 1;
    minX = Math.min(minX, cx - r); maxX = Math.max(maxX, cx + r);
    minZ = Math.min(minZ, cz - r); maxZ = Math.max(maxZ, cz + r);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    minX, level, minZ, maxX, level, minZ, maxX, level, maxZ, minX, level, maxZ,
  ]), 3));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  geo.computeBoundingSphere();
  const impacts = Array.from({ length: 24 }, () => new THREE.Vector4(0, 0, -100, 0));
  const material = new THREE.ShaderMaterial({
    uniforms: lightingUniforms({
      uReflection: { value: null },
      uTexMatrix: { value: new THREE.Matrix4() },
      uHasReflection: { value: 0 },
      uImpacts: { value: impacts },
    }),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  let next = 0;
  const addImpact = (x, z, t, s = 1) => {
    impacts[next].set(x, z, t, s);
    next = (next + 1) % impacts.length;
  };
  return { mesh, material, addImpact, level };
}
