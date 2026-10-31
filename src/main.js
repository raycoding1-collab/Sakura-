import * as THREE from 'three';
import { shared } from './render/uniforms.js';
import { applyAtmosphere } from './world/atmosphere.js';
import { createSky } from './world/sky.js';
import { createTerrain, groundHeight, WATER_LEVEL } from './world/terrain.js';
import { createGrass } from './world/grass.js';
import { createGroundPetals, FallingPetals } from './world/petals.js';
import { createMotes } from './world/motes.js';
import { gustField, gustEnvelope } from './world/wind.js';
import { generateSkeleton } from './tree/skeleton.js';
import { WEEPING_CHERRY, YOSHINO_CHERRY } from './tree/species.js';
import { buildBarkMesh } from './tree/barkMesh.js';
import { createBarkMaterials, createBarkGeometry } from './tree/barkMaterial.js';
import { placeBlossoms, flowerBaseMesh, flowerCardMesh, packFlowers } from './tree/blossoms.js';
import { createBlossomMaterials, createBlossomGeometry, BlossomDetail } from './tree/blossomMaterial.js';
import { buildCanopyGrid } from './tree/canopyGrid.js';
import { createGarden } from './garden/garden.js';
import { createWater, PlanarReflection } from './garden/water.js';
import { createStream } from './garden/stream.js';
import { createVegetation } from './garden/vegetation.js';
import { createKoi } from './garden/koi.js';
import { propGeometry } from './garden/propMaterial.js';
import { SunShadow } from './render/shadows.js';
import { PostPipeline } from './render/post.js';
import { CinematicCamera } from './camera/cinematic.js';
import { UI } from './ui/ui.js';
import { Ambience } from './audio/ambience.js';

const params = new URLSearchParams(location.search);
const seed = parseInt(params.get('seed') || '7', 10);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const PRESETS = {
  // For offline film rendering on a strong GPU.
  ultra: { streamPetals: 2800, flowers: 1.0, grass: 220000, carpet: 52000, falling: 6000, motes: 1400, shadow: 4096, samples: 4, dof: true, pixels: 40e6, reflect: 0.75, reflectFlowers: 0.8 },
  high: { streamPetals: 2000, flowers: 0.75, grass: 160000, carpet: 42000, falling: 5000, motes: 1100, shadow: 4096, samples: 4, dof: true, pixels: 2.6e6, reflect: 0.5, reflectFlowers: 0.45 },
  medium: { streamPetals: 1300, flowers: 0.5, grass: 90000, carpet: 30000, falling: 3600, motes: 900, shadow: 2048, samples: 4, dof: true, pixels: 1.5e6, reflect: 0.35, reflectFlowers: 0.3 },
  low: { streamPetals: 700, flowers: 0.32, grass: 40000, carpet: 18000, falling: 2200, motes: 500, shadow: 2048, samples: 2, dof: false, pixels: 0.85e6, reflect: 0.25, reflectFlowers: 0.15 },
};

function detectQuality(gl) {
  const forced = params.get('quality');
  if (forced && PRESETS[forced]) return forced;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return 'low';
  if (/SwiftShader|llvmpipe|Software/i.test(name)) return 'low';
  if (/Apple/i.test(name) && !/Pro|Max|Ultra/i.test(name)) return 'medium';
  if (/Intel|UHD|Iris|Mali|Adreno|PowerVR/i.test(name)) return 'medium';
  return 'high';
}

const fmt = (n) => n.toLocaleString('en-US');

async function boot() {
  const ui = new UI();
  const canvas = document.getElementById('scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
  } catch (e) {
    ui.fail();
    return;
  }
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext) || !(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'))) {
    ui.fail();
    return;
  }
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const qualityName = detectQuality(gl);
  const Q = PRESETS[qualityName];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.08, 4000);
  applyAtmosphere();

  // ---- Grow the tree ----------------------------------------------------------
  ui.progress(0.05, 'Growing an old weeping cherry');
  await nextFrame();
  const species = params.get('tree') === 'yoshino' ? YOSHINO_CHERRY : WEEPING_CHERRY;
  const skel = generateSkeleton(seed, { species, groundAt: groundHeight, waterLevel: WATER_LEVEL });
  const branchCount = skel.branches.filter((b) => b.kind === 'wood').length;

  ui.progress(0.2, `${fmt(branchCount)} branches · twisting the ancient trunk`);
  await nextFrame();
  const barkData = buildBarkMesh(skel, { groundAt: groundHeight, ancient: species === WEEPING_CHERRY, hiRes: qualityName !== 'low' });
  const barkGeo = createBarkGeometry(barkData);
  const barkMats = createBarkMaterials();
  const bark = new THREE.Mesh(barkGeo, barkMats.color);
  bark.frustumCulled = false;
  scene.add(bark);

  ui.progress(0.42, 'Opening blossoms');
  await nextFrame();
  const { flowers } = placeBlossoms(skel);
  const flowerCount = Math.floor(flowers.length * Q.flowers);

  ui.progress(0.55, `${fmt(flowerCount)} blossoms · gathering light in the crown`);
  await nextFrame();
  const grid = buildCanopyGrid(flowers, shared.uSunDir.value.toArray());
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
    flowers.forEach((f, i) => {
      grid.sample(f.pos, tmp);
      light[i * 2] = tmp[0];
      light[i * 2 + 1] = tmp[1];
    });
  }
  const packed = packFlowers(flowers, light);
  const blossomMats = createBlossomMaterials();
  blossomMats.uniforms.uFlowerScale.value = Math.min(1.35, Math.pow(Q.flowers, -0.42));
  const blossomGeo = createBlossomGeometry(flowerCardMesh(), packed);
  const blossomShadowGeo = createBlossomGeometry(flowerCardMesh(), packed, blossomGeo);
  blossomGeo.instanceCount = blossomShadowGeo.instanceCount = flowerCount;
  const blossoms = new THREE.Mesh(blossomGeo, blossomMats.color);
  blossoms.frustumCulled = false;
  scene.add(blossoms);
  const detail = new BlossomDetail(packed, flowerBaseMesh({ detail: true, petalAcross: 3, petalAlong: 4 }));
  detail.limit = flowerCount;
  const blossomsNear = new THREE.Mesh(detail.geometry, blossomMats.detail);
  blossomsNear.frustumCulled = false;
  scene.add(blossomsNear);

  // ---- The land and air ---------------------------------------------------------
  ui.progress(0.66, 'Raking gravel, filling the pond, lighting lanterns');
  await nextFrame();
  const sky = createSky();
  scene.add(sky);
  const terrain = createTerrain();
  scene.add(terrain);
  const garden = createGarden({ skel, bark: barkData, groundAt: groundHeight, waterLevel: WATER_LEVEL });
  scene.add(garden.mesh);
  scene.add(garden.rocker);
  garden.lights.forEach((L, i) => {
    if (i >= shared.uLightPos.value.length) return;
    shared.uLightPos.value[i].set(L.pos[0], L.pos[1], L.pos[2], L.range);
  });
  const windDir = [shared.uWindDir.value.x, shared.uWindDir.value.y];
  const grass = createGrass({ count: Q.grass, treeFoot: [0, 0] });
  scene.add(grass.mesh);
  const carpet = createGroundPetals({ flowers, count: Q.carpet, windDir });
  scene.add(carpet.mesh);
  ui.progress(0.74, 'Planting maples, pines and azaleas');
  await nextFrame();
  const veg = createVegetation({ groundAt: groundHeight, waterLevel: WATER_LEVEL, seed });
  scene.add(veg.mesh);
  const vegBarkGeo = createBarkGeometry(veg.barkData);
  const vegBark = new THREE.Mesh(vegBarkGeo, barkMats.color);
  vegBark.frustumCulled = false;
  scene.add(vegBark);
  const vegCoreGeo = propGeometry(veg.coreBuffers);
  const vegCore = new THREE.Mesh(vegCoreGeo, garden.materials.color);
  vegCore.frustumCulled = false;
  scene.add(vegCore);

  const water = createWater(WATER_LEVEL);
  scene.add(water.mesh);
  const stream = createStream({ waterLevel: WATER_LEVEL, wet: garden.stream.wet, petals: Q.streamPetals });
  scene.add(stream.group);
  const koi = createKoi({ waterLevel: WATER_LEVEL });
  scene.add(koi.mesh);
  const reflection = Q.reflect > 0 ? new PlanarReflection(renderer) : null;
  if (reflection) reflection.scale = Q.reflect;
  const falling = new FallingPetals({
    flowers, capacity: Q.falling, windDir, gustField,
    onSplash: (x, z, t) => water.addImpact(x, z, t, 1),
    onStream: (x, z, s) => stream.rafts.inject(x, z, s),
  });
  scene.add(falling.mesh);
  const motes = createMotes({ count: Q.motes });
  scene.add(motes.points);

  {
    const hide = (params.get('hide') || '').split(',');
    const named = { sky, terrain, bark, blossoms, grass: grass.mesh, carpet: carpet.mesh, falling: falling.mesh, motes: motes.points, garden: garden.mesh, water: water.mesh, veg: veg.mesh, stream: stream.group };
    for (const k of hide) if (named[k]) named[k].visible = false;
  }

  const shadow = new SunShadow(renderer, Q.shadow);
  shadow.add(barkGeo, barkMats.depth);
  shadow.add(blossomShadowGeo, blossomMats.depth);
  shadow.add(falling.geometry, falling.materials.depth);
  shadow.add(garden.geometry, garden.materials.depth);
  shadow.add(veg.geometry, veg.materials.depth);
  shadow.add(vegBarkGeo, barkMats.depth);
  shadow.add(vegCoreGeo, garden.materials.depth);
  shadow.scene.add(garden.rockerShadow);
  shadow.update(shared.uSunDir.value);

  const post = new PostPipeline(renderer, { timeUniform: shared.uTime, samples: Q.samples, dof: Q.dof });
  post.params.fade = 0;
  if (params.has('nobloom')) post.params.bloom = 0;
  if (params.has('nodof')) post.useDof = false;
  if (params.has('nan')) {
    post.mat.composite.defines.DEBUG_NAN = 1;
    post.mat.composite.needsUpdate = true;
  }

  // ---- Camera, sound, controls ------------------------------------------------
  const cine = new CinematicCamera(camera, canvas, {
    groundAt: (x, z) => Math.max(groundHeight(x, z), WATER_LEVEL),
    nearestFlower: (p) => detail.nearest(p),
  });
  const fixed = params.get('cam');
  if (fixed) {
    const [r, h, az, look] = fixed.split(',').map(Number);
    Object.assign(cine.user, { radius: r, height: h, az, look });
    Object.assign(cine.state, cine.user);
    cine.auto = false;
    cine.resumeAfter = Infinity;
    cine.idle = -Infinity;
  }
  const t0 = parseFloat(params.get('t') || '0');
  cine.time = t0;
  // Film capture (frame-stepped): the camera follows its path only, whatever
  // happens to the mouse or keyboard in the capture window.
  const capture = params.has('frames');
  if (capture) {
    canvas.style.pointerEvents = 'none';
    cine.resumeAfter = 0;
  }
  // A free camera for film shots: eye=x,y,z&at=x,y,z (world), optionally
  // gliding to eye2 / at2 over dur seconds.
  if (params.get('eye')) {
    const v3 = (str) => new THREE.Vector3(...str.split(',').map(Number));
    const e0 = v3(params.get('eye')), a0 = v3(params.get('at') || '0,2,0');
    const e1 = params.get('eye2') ? v3(params.get('eye2')) : e0;
    const a1 = params.get('at2') ? v3(params.get('at2')) : a0;
    const dur = parseFloat(params.get('dur') || '5');
    const look = new THREE.Vector3();
    let tt = 0;
    cine.update = (dt) => {
      tt += dt;
      const k = Math.min(1, tt / dur);
      const e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(e0, e1, e);
      look.lerpVectors(a0, a1, e);
      camera.lookAt(look);
      camera.updateMatrixWorld();
      cine.focus = parseFloat(params.get('focus')) || Math.max(2, camera.position.distanceTo(look) * 0.8);
    };
  }

  const audio = new Ambience();
  ui.on('camera', () => {
    if (capture) return;
    cine.setAuto(!cine.auto);
    ui.setCamera(cine.auto);
  });
  ui.on('sound', () => {
    if (audio.enabled) audio.stop();
    else audio.start();
    ui.setSound(audio.enabled);
  });
  cine.onInteract = () => {
    ui.setCamera(false);
    ui.interacted();
  };

  // ---- Resolution management ------------------------------------------------------
  let renderScale = 1;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, parseFloat(params.get('maxdpr')) || 2);
    const cssW = window.innerWidth, cssH = window.innerHeight;
    let w = cssW * dpr, h = cssH * dpr;
    const cap = Math.sqrt((parseFloat(params.get('maxpx')) || Q.pixels) / (w * h));
    const s = Math.min(1, cap) * renderScale;
    w = Math.max(320, Math.floor(w * s));
    h = Math.max(180, Math.floor(h * s));
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = parseFloat(params.get('fov')) || (w / h < 0.8 ? 58 : 40);
    camera.updateProjectionMatrix();
    post.setSize(w, h);
    if (reflection) reflection.setSize(w, h);
    motes.material.uniforms.uPixelScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    barkMats.color.uniforms.uPixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / h;
  };
  window.addEventListener('resize', resize);
  resize();

  // ---- Compile everything before the curtain rises ---------------------------------
  ui.progress(0.86, 'Waiting for dusk');
  await nextFrame();
  cine.update(0);
  try {
    if (renderer.compileAsync) {
      await renderer.compileAsync(scene, camera);
      await renderer.compileAsync(shadow.scene, shadow.camera);
    }
  } catch (e) {
    /* fall back to compiling on the first frame */
  }
  ui.progress(1, 'Dusk');
  await nextFrame();

  // ---- Frame loop -----------------------------------------------------------------
  const clock = new THREE.Clock();
  let time = t0;
  let frames = 0;
  let fadeIn = params.has('frames') ? 1 : 0;
  const stopAfter = parseInt(params.get('frames') || '0', 10) || Infinity;
  let perfAcc = 0, perfN = 0, perfT = 0, lowered = false;
  const sunDir = shared.uSunDir.value;

  const frame = (forcedDt) => {
    const raw = typeof forcedDt === 'number' ? forcedDt : clock.getDelta();
    const dt = Math.min(raw, 1 / 20);
    time += dt;
    shared.uTime.value = time;
    shared.uGust.value = gustEnvelope(time);

    cine.update(dt);
    sky.userData.update(camera, time);
    falling.cameraPos.copy(camera.position);
    falling.update(dt, time, shared.uGust.value);
    grass.material.uniforms.uViewPos.value.copy(camera.position);
    blossomMats.uniforms.uViewPos.value.copy(camera.position);
    detail.update(camera.position, blossomMats.uniforms.uDetailDist.value);
    audio.update(shared.uGust.value);
    garden.update(time, () => audio.knock && audio.knock());
    koi.update(dt, time);
    stream.update(dt, time);
    garden.lights.forEach((L, i) => {
      if (i >= shared.uLightColor.value.length) return;
      const fl = 0.86 + 0.08 * Math.sin(time * 9.1 + i * 2.3) + 0.06 * Math.sin(time * 23.7 + i * 5.1);
      shared.uLightColor.value[i].set(L.color[0] * L.power * fl, L.color[1] * L.power * fl, L.color[2] * L.power * fl, 0);
    });

    shadow.render();
    if (reflection) {
      // Mirror pass: lighter scene (no grass, motes or close-up flowers).
      const hidden = [grass.mesh, motes.points, blossomsNear, water.mesh, koi.mesh, stream.water, stream.rafts.mesh, stream.mist];
      const fullCount = blossomGeo.instanceCount;
      const ok = reflection.render(scene, camera, WATER_LEVEL, (vc) => {
        for (const o of hidden) o.visible = false;
        blossomGeo.instanceCount = Math.floor(fullCount * Q.reflectFlowers / Q.flowers);
        sky.userData.update(vc, time);
      }, () => {
        for (const o of hidden) o.visible = true;
        blossomGeo.instanceCount = fullCount;
        sky.userData.update(camera, time);
      });
      water.material.uniforms.uHasReflection.value = ok ? 1 : 0;
      water.material.uniforms.uReflection.value = reflection.target.texture;
      water.material.uniforms.uTexMatrix.value.copy(reflection.textureMatrix);
      for (const m of [stream.material, koi.material]) {
        m.uniforms.uHasReflection.value = ok ? 1 : 0;
        m.uniforms.uReflection.value = reflection.target.texture;
        m.uniforms.uTexMatrix.value.copy(reflection.textureMatrix);
      }
    }
    fadeIn = Math.min(1, fadeIn + Math.min(raw, 0.25) / 3.5);
    post.params.fade = fadeIn * fadeIn * (3 - 2 * fadeIn);
    post.params.focus = cine.focus;
    post.render(scene, camera, sunDir);

    frames++;
    window.__frames = frames;

    // Adaptive resolution: hold a smooth frame rate rather than a fixed size.
    if (frames > 30 && raw < 0.5 && forcedDt === undefined) {
      perfAcc += raw;
      perfN++;
      perfT += raw;
      if (perfT > 2.5) {
        const avg = perfAcc / perfN;
        if (avg > 1 / 42 && renderScale > 0.55) {
          renderScale = Math.max(0.55, renderScale * 0.85);
          lowered = true;
          resize();
        } else if (lowered && avg < 1 / 58 && renderScale < 1) {
          renderScale = Math.min(1, renderScale * 1.08);
          resize();
        }
        perfAcc = perfN = perfT = 0;
      }
    }
    if (frames < stopAfter && forcedDt === undefined) requestAnimationFrame(() => frame());
  };
  // Test hook: step the simulation by a fixed dt and render one frame.
  window.__step = (d) => frame(d);

  window.__stats = {
    quality: qualityName,
    branches: branchCount,
    weeps: skel.weeps.length,
    foliage: veg.count,
    flowers: flowerCount,
    barkTris: barkData.triangleCount,
    grid: [grid.nx, grid.ny, grid.nz],
  };
  ui.ready(`${fmt(flowerCount)} blossoms · ${fmt(skel.weeps.length)} hanging branchlets`, params.has('frames'));
  requestAnimationFrame(() => frame());
}

boot();
