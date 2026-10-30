import * as THREE from 'three';
import { shared } from '../render/uniforms.js';

// Golden-hour palette. Values are linear HDR radiance; the final grade maps them
// to the screen. The sun hangs low in the west-south-west, warm and soft.
export const SUN = {
  elevation: THREE.MathUtils.degToRad(8),
  azimuth: THREE.MathUtils.degToRad(-24),
};

export function sunDirection(out = new THREE.Vector3()) {
  const e = SUN.elevation, a = SUN.azimuth;
  return out.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).normalize();
}

export function applyAtmosphere() {
  sunDirection(shared.uSunDir.value);
  shared.uSunColor.value.setRGB(1.0, 0.58, 0.3).multiplyScalar(5.6);
  shared.uSkyZenith.value.setRGB(0.1, 0.16, 0.38);
  shared.uSkyHorizon.value.setRGB(0.95, 0.55, 0.36).multiplyScalar(0.6);
  shared.uSkyAway.value.setRGB(0.42, 0.34, 0.54).multiplyScalar(0.58);
  shared.uGroundBounce.value.setRGB(0.24, 0.18, 0.07).multiplyScalar(0.32);
  shared.uFogColor.value.setRGB(1.0, 0.6, 0.4).multiplyScalar(0.78);
  shared.uFogSunColor.value.setRGB(1.0, 0.5, 0.2).multiplyScalar(1.25);
  shared.uFogParams.value.set(0.0015, 0.085);
  const wa = THREE.MathUtils.degToRad(-30);
  shared.uWindDir.value.set(Math.cos(wa), Math.sin(wa));
}
