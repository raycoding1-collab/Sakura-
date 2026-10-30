import * as THREE from 'three';
import { shared } from './render/uniforms.js';
import { applyAtmosphere } from './world/atmosphere.js';
import { createSky } from './world/sky.js';
import { createTerrain, groundHeight } from './world/terrain.js';
import { generateSkeleton } from './tree/skeleton.js';
import { buildBarkMesh } from './tree/barkMesh.js';
import { createBarkMaterials, createBarkGeometry } from './tree/barkMaterial.js';
import { placeBlossoms, flowerBaseMesh, flowerCardMesh, packFlowers } from './tree/blossoms.js';
import { createBlossomMaterials, createBlossomGeometry, BlossomDetail } from './tree/blossomMaterial.js';
import { buildCanopyGrid } from './tree/canopyGrid.js';
import { createGrass } from './world/grass.js';
import { createGroundPetals, FallingPetals } from './world/petals.js';
import { gustField, gustEnvelope } from './world/wind.js';
import { SunShadow } from './render/shadows.js';
import { PostPipeline } from './render/post.js';

const params = new URLSearchParams(location.search);
const seed = parseInt(params.get('seed') || '7', 10);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.autoClear = false;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 4000);

applyAtmosphere();

// Neutral canopy volume until the blossoms are grown.
{
  const t = new THREE.Data3DTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
  t.format = THREE.RGFormat;
  t.needsUpdate = true;
  shared.uCanopy.value = t;
}

const sky = createSky();
scene.add(sky);
const terrain = createTerrain();
scene.add(terrain);

const skel = generateSkeleton(seed, { groundAt: groundHeight });
const barkData = buildBarkMesh(skel, { groundAt: groundHeight });
const barkGeo = createBarkGeometry(barkData);
const barkMats = createBarkMaterials();
const bark = new THREE.Mesh(barkGeo, barkMats.color);
bark.frustumCulled = false;
scene.add(bark);

const tb0 = performance.now();
const { flowers } = placeBlossoms(skel);
const tb1 = performance.now();
const grid = buildCanopyGrid(flowers, shared.uSunDir.value.toArray());
const tb2 = performance.now();
{
  const tex = new THREE.Data3DTexture(grid.data, grid.nx, grid.ny, grid.nz);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  shared.uCanopy.value = tex;
  shared.uCanopyMin.value.fromArray(grid.min);
  shared.uCanopyInvSize.value.set(1 / grid.size[0], 1 / grid.size[1], 1 / grid.size[2]);
}
const light = new Float32Array(flowers.length * 2);
{
  const tmp = [0, 0];
  flowers.forEach((f, i) => { grid.sample(f.pos, tmp); light[i * 2] = tmp[0]; light[i * 2 + 1] = tmp[1]; });
}
const packed = packFlowers(flowers, light);
const blossomMats = createBlossomMaterials();
const blossomGeo = createBlossomGeometry(flowerCardMesh(), packed);
const blossomShadowGeo = createBlossomGeometry(flowerCardMesh(), packed, blossomGeo);
const maxFlowers = parseInt(params.get('flowers') || '400000', 10);
blossomGeo.instanceCount = blossomShadowGeo.instanceCount = Math.min(flowers.length, maxFlowers);
const blossoms = new THREE.Mesh(blossomGeo, blossomMats.color);
blossoms.frustumCulled = false;
scene.add(blossoms);
const blossomDetail = new BlossomDetail(packed, flowerBaseMesh({ detail: true, petalAcross: 3, petalAlong: 4 }));
blossomDetail.limit = blossomGeo.instanceCount;
const blossomsNear = new THREE.Mesh(blossomDetail.geometry, blossomMats.detail);
blossomsNear.frustumCulled = false;
scene.add(blossomsNear);
window.__stats = { flowers: flowers.length, barkTris: barkData.triangleCount, place: (tb1 - tb0) | 0, grid: (tb2 - tb1) | 0, gridDims: [grid.nx, grid.ny, grid.nz] };

const windDir = [shared.uWindDir.value.x, shared.uWindDir.value.y];
const grass = createGrass({ count: parseInt(params.get('grass') || '320000', 10), treeFoot: [0, 0] });
scene.add(grass.mesh);
const groundPetals = createGroundPetals({ flowers, count: 42000, windDir });
scene.add(groundPetals.mesh);
const falling = new FallingPetals({ flowers, capacity: 5000, windDir, gustField });
scene.add(falling.mesh);

{
  const hide = (params.get('hide') || '').split(',');
  const named = { sky, terrain, bark, blossoms, grass: grass.mesh, ground: groundPetals.mesh, falling: falling.mesh };
  for (const k of hide) if (named[k]) named[k].visible = false;
}
const shadow = new SunShadow(renderer, 4096);
shadow.add(barkGeo, barkMats.depth);
shadow.add(blossomShadowGeo, blossomMats.depth);
shadow.add(falling.geometry, falling.materials.depth);

const post = new PostPipeline(renderer, { timeUniform: shared.uTime });
if (params.has('nobloom')) post.params.bloom = 0;
if (params.has('nodof')) post.useDof = false;
if (params.has('nan')) { post.mat.composite.defines.DEBUG_NAN = 1; post.mat.composite.needsUpdate = true; post.params.bloom = 0; post.useDof = false; }

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();

const stopAfter = parseInt(params.get('frames') || '1e9', 10);
const clock = new THREE.Clock();
let t = parseFloat(params.get('t') || '0');
const az0 = parseFloat(params.get('az') || '0.6');

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  shared.uTime.value = t;
  const az = az0 + t * 0.02;
  const R = parseFloat(params.get('r') || '17');
  const camH = parseFloat(params.get('h') || '1.8');
  const ty = parseFloat(params.get('ty') || '3.6');
  camera.position.set(Math.cos(az) * R, camH + groundHeight(Math.cos(az) * R, Math.sin(az) * R), Math.sin(az) * R);
  camera.lookAt(0, ty, 0);
  camera.updateMatrixWorld();
  sky.userData.update(camera, t);
  shared.uGust.value = gustEnvelope(t);
  falling.cameraPos.copy(camera.position);
  falling.update(dt, t, shared.uGust.value);
  grass.material.uniforms.uViewPos.value.copy(camera.position);
  blossomMats.uniforms.uViewPos.value.copy(camera.position);
  blossomDetail.update(camera.position, blossomMats.uniforms.uDetailDist.value);
  shadow.update(shared.uSunDir.value);
  shadow.render();
  post.params.focus = camera.position.distanceTo(new THREE.Vector3(0, 3.6, 0));
  post.render(scene, camera, shared.uSunDir.value);
  window.__frames = (window.__frames || 0) + 1;
  if (window.__frames < stopAfter) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__ready = true;
