import * as THREE from 'three';

// Uniform objects shared by reference between every material, so one update
// per frame reaches the whole scene.
export const shared = {
  uTime: { value: 0 },

  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color() },
  uSkyZenith: { value: new THREE.Color() },
  uSkyHorizon: { value: new THREE.Color() },
  uSkyAway: { value: new THREE.Color() },
  uGroundBounce: { value: new THREE.Color() },
  uFogColor: { value: new THREE.Color() },
  uFogSunColor: { value: new THREE.Color() },
  uFogParams: { value: new THREE.Vector2(0.0035, 0.05) },

  uWindDir: { value: new THREE.Vector2(1, 0) },
  uWindStrength: { value: 1 },
  uGust: { value: 0 },

  uShadowMap: { value: null },
  uShadowDepth: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowInfo: { value: new THREE.Vector4(1 / 2048, 100, 0.01, 0.012) },

  uLightPos: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -100, 0, 0.001)) },
  uLightColor: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) },

  uCanopy: { value: null },
  uCanopyMin: { value: new THREE.Vector3() },
  uCanopyInvSize: { value: new THREE.Vector3(1, 1, 1) },
};

export function pickShared(...names) {
  const out = {};
  for (const n of names) out[n] = shared[n];
  return out;
}

export const ALL_LIGHTING = [
  'uTime', 'uSunDir', 'uSunColor', 'uSkyZenith', 'uSkyHorizon', 'uSkyAway', 'uGroundBounce',
  'uFogColor', 'uFogSunColor', 'uFogParams', 'uWindDir', 'uWindStrength', 'uGust',
  'uShadowMap', 'uShadowDepth', 'uShadowMatrix', 'uShadowInfo', 'uCanopy', 'uCanopyMin', 'uCanopyInvSize',
  'uLightPos', 'uLightColor',
];

export function lightingUniforms(extra = {}) {
  return { ...pickShared(...ALL_LIGHTING), ...extra };
}
