import * as THREE from 'three';
import { shared } from '../render/uniforms.js';

// Golden-hour palette. Values are linear HDR radiance; the final grade maps them
// to the screen. The sun hangs low in the west-south-west, warm and soft.
export const SUN = {
  elevation: THREE.MathUtils.degToRad(9.5),
  azimuth: THREE.MathUtils.degToRad(-24),
};

export function sunDirection(out = new THREE.Vector3()) {
  const e = SUN.elevation, a = SUN.azimuth;
  return out.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).normalize();
}

export function applyAtmosphere() {
  sunDirection(shared.uSunDir.value);
  shared.uSunColor.value.setRGB(1.0, 0.6, 0.32).multiplyScalar(5.2);
  shared.uSkyZenith.value.setRGB(0.12, 0.19, 0.42);
  shared.uSkyHorizon.value.setRGB(0.95, 0.56, 0.36).multiplyScalar(0.7);
  shared.uSkyAway.value.setRGB(0.46, 0.38, 0.56).multiplyScalar(0.62);
  shared.uGroundBounce.value.setRGB(0.26, 0.2, 0.08).multiplyScalar(0.36);
  shared.uFogColor.value.setRGB(1.0, 0.62, 0.42).multiplyScalar(0.8);
  shared.uFogSunColor.value.setRGB(1.0, 0.55, 0.25).multiplyScalar(1.5);
  shared.uFogParams.value.set(0.0026, 0.05);
  const wa = THREE.MathUtils.degToRad(-30);
  shared.uWindDir.value.set(Math.cos(wa), Math.sin(wa));
}
