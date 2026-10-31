import * as THREE from 'three';
import { MeshBuilder } from '../core/geom.js';
import { createPropMaterials, propGeometry } from './propMaterial.js';
import { POND_LOBES } from './layout.js';
import { buildStreamStones } from './stream.js';
import {
  shorePoint, buildTreeSupports, buildShimenawa, buildKasuga, buildYukimi, buildBridge,
  buildRocks, buildFence, buildTsukubai, buildShishiOdoshi, buildShishiFrame, buildBonbori,
} from './structures.js';

// Stepping-stone paths: tree → bridge, bridge → wash-basin, tree → gravel court.
export const PATHS = [
  [[0.6, 1.9], [0.3, 4.3], [-0.4, 6.6], [-1.2, 8.8], [-1.75, 10.2]],
  [[-2.4, 15.7], [-0.4, 17.4], [2.2, 17.6], [4.6, 16.4], [5.6, 15.4]],
  [[1.6, -1.5], [3.0, -3.2]],
  // West from the tree to the ford across the stream, and on toward the pine.
  [[-2.4, -2.0], [-4.3, -2.6], [-6.75, -2.55]],
  [[-9.25, -2.75], [-10.9, -3.3], [-12.6, -3.0]],
];

const BONBORI = [[1.5, 3.2], [-1.0, 5.2], [0.7, 9.3], [-0.5, 10.7], [-5.35, -0.15], [-12.2, 0.4]];

export function createGarden({ skel, bark, groundAt, waterLevel }) {
  const mb = new MeshBuilder();
  const lights = [];

  buildTreeSupports(mb, skel, groundAt);
  buildShimenawa(mb, bark, groundAt, -0.75);

  const kasugaPos = [1.75, groundAt(1.75, 7.2), 7.2];
  lights.push({ pos: buildKasuga(mb, kasugaPos, 0.4), color: [1.0, 0.55, 0.22], power: 1.1, range: 6 });

  const A = POND_LOBES[0];
  const yk = shorePoint(A[0], A[1], -1.45, -0.12);
  const yukimiPos = [yk[0], Math.max(groundAt(yk[0], yk[1]), waterLevel - 0.12), yk[1]];
  lights.push({ pos: buildYukimi(mb, yukimiPos, 0.2, 1.05), color: [1.0, 0.52, 0.2], power: 1.0, range: 6 });

  for (const [x, z] of BONBORI) {
    lights.push({ pos: buildBonbori(mb, [x, groundAt(x, z), z], (x * 7.3 + z) % 6.28), color: [1.0, 0.6, 0.3], power: 0.8, range: 5.5 });
  }

  const bridge = buildBridge(mb, groundAt, waterLevel);

  buildRocks(mb, groundAt, waterLevel, {
    paths: PATHS,
    avoid: [[yukimiPos[0], yukimiPos[2], 0.7], [bridge.start[0], bridge.start[2], 1.0], [bridge.end[0], bridge.end[2], 1.0]],
  });

  buildFence(mb, groundAt, 0.75, 4.25);
  const stream = buildStreamStones(mb, groundAt, waterLevel);

  // Wash-basin and the deer-scarer by the second pond.
  const D = POND_LOBES[3];
  const tsuPos = [6.3, groundAt(6.3, 15.4), 15.4];
  buildTsukubai(mb, tsuPos, -2.2, groundAt);
  const sh = shorePoint(D[0], D[1], 0.05, 0.3);
  const shishiPos = [sh[0] + 0.35, groundAt(sh[0] + 0.35, sh[1]) + 0.3, sh[1]];
  const shishiYaw = Math.PI;
  buildShishiFrame(mb, shishiPos, shishiYaw);

  const mats = createPropMaterials(waterLevel);
  const geo = propGeometry(mb.toBuffers());
  const mesh = new THREE.Mesh(geo, mats.color);
  mesh.frustumCulled = false;

  // The rocker is its own mesh so it can tip about its axle.
  const rb = new MeshBuilder();
  buildShishiOdoshi(rb);
  const rockerGeo = propGeometry(rb.toBuffers());
  const rocker = new THREE.Mesh(rockerGeo, mats.color);
  rocker.position.set(shishiPos[0], shishiPos[1] + 0.32, shishiPos[2]);
  rocker.rotation.order = 'YZX';
  rocker.rotation.y = shishiYaw;
  rocker.frustumCulled = false;
  const rockerShadow = new THREE.Mesh(rockerGeo, mats.depth);
  rockerShadow.frustumCulled = false;

  // Fills slowly under the trickle, tips, empties and knocks against the stone.
  const cycle = 9.5;
  let lastPhase = 0;
  const update = (t, onKnock) => {
    const ph = (t % cycle) / cycle;
    let ang;
    if (ph < 0.86) ang = 0.32 - 0.16 * Math.pow(ph / 0.86, 1.6);
    else if (ph < 0.9) ang = 0.16 - 0.62 * ((ph - 0.86) / 0.04);
    else {
      const k = (ph - 0.9) / 0.1;
      ang = -0.46 + 0.78 * (1 - Math.exp(-k * 5)) + Math.sin(k * 22) * 0.06 * Math.exp(-k * 4);
    }
    // Positive tilt lowers the back end onto the striking stone.
    rocker.rotation.z = ang;
    rocker.updateMatrix();
    rocker.updateMatrixWorld(true);
    rockerShadow.matrix.copy(rocker.matrixWorld);
    rockerShadow.matrixWorld.copy(rocker.matrixWorld);
    if (lastPhase < 0.93 && ph >= 0.93 && onKnock) onKnock();
    lastPhase = ph;
  };
  rockerShadow.matrixAutoUpdate = false;

  return { mesh, geometry: geo, materials: mats, rocker, rockerShadow, lights, bridge, update, stream, positions: { kasugaPos, yukimiPos, tsuPos, shishiPos } };
}

