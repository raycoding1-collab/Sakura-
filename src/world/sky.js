import * as THREE from 'three';
import { COMMON, ATMOS } from '../render/glsl.js';
import { pickShared } from '../render/uniforms.js';

// Sky dome drawn as one oversized triangle behind everything: twilight gradient,
// sun disk and halo, drifting sunset clouds, and four layers of misty mountain
// ridges painted far-to-near like a folding screen.

export const SKY_GLSL = /* glsl */ `
uniform float uCloudTime;

float ridgeNoise(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    float n = 1.0 - abs(vnoise2(p) * 2.0 - 1.0);
    s += a * n * n;
    p = mat2(1.7, 1.1, -1.1, 1.7) * p + 3.1;
    a *= 0.5;
  }
  return s;
}

float mountainHeight(int i, float az) {
  vec2 c = vec2(cos(az), sin(az));
  if (i == 0) return 0.006 + 0.085 * pow(ridgeNoise(c * 1.6 + 17.0), 1.7);
  if (i == 1) return -0.002 + 0.065 * pow(ridgeNoise(c * 2.7 + 41.0), 1.55);
  if (i == 2) return -0.012 + 0.046 * pow(ridgeNoise(c * 4.6 + 73.0), 1.35);
  return -0.022 + 0.03 * pow(ridgeNoise(c * 8.0 + 5.0), 1.2) + 0.004 * vnoise2(c * 90.0);
}

vec3 skyGradient(vec3 rd) {
  float h = max(rd.y, 0.0);
  float sd = dot(rd, uSunDir);
  float az = dot(normalize(rd.xz + 1e-4), normalize(uSunDir.xz)) * 0.5 + 0.5;
  float toward = pow(az, 2.5);
  vec3 hor = fogInscatter(vec3(rd.x, 0.0, rd.z));
  // Low band: gold toward the sun, the rosy Belt of Venus opposite.
  vec3 low = mix(vec3(0.62, 0.42, 0.6), vec3(1.25, 0.6, 0.34), toward);
  vec3 mid = mix(vec3(0.36, 0.33, 0.6), vec3(0.85, 0.46, 0.5), toward);
  vec3 c = mix(hor, low, smoothstep(0.0, 0.05, h));
  c = mix(c, mid, smoothstep(0.04, 0.24, h));
  c = mix(c, uSkyZenith, smoothstep(0.18, 0.85, h));
  // Earth's shadow: a cool band hugging the horizon opposite the sun.
  float anti = pow(1.0 - az, 3.0);
  c = mix(c, vec3(0.3, 0.3, 0.48), anti * (1.0 - smoothstep(0.0, 0.05, h)) * smoothstep(-0.02, 0.012, h) * 0.55);
  float s = saturate(sd);
  c += uSunColor * (0.035 * pow(s, 4.0) + 0.12 * pow(s, 32.0) + 0.5 * pow(s, 350.0));
  return c;
}

vec4 clouds(vec3 rd) {
  if (rd.y < -0.01) return vec4(0.0);
  float sd = dot(rd, uSunDir);
  vec2 uv = rd.xz / (rd.y + 0.09);
  vec2 drift = vec2(0.012, 0.004) * uCloudTime;
  // Soft altocumulus field.
  vec2 q = uv * 0.55 + drift;
  float warp = fbm2(q * 0.7 + 3.0);
  float n = fbm2(q * 1.3 + warp * 0.9);
  float dens = smoothstep(0.5, 0.76, n) * smoothstep(0.2, 0.7, fbm2(q * 0.25 + 31.0));
  // Long glowing streaks low over the horizon.
  vec2 su = vec2(uv.x * 0.9 + uv.y * 0.3, (uv.y - uv.x * 0.3) * 6.0) * 0.18 + drift * 0.6;
  float streak = smoothstep(0.52, 0.8, fbm2(su + 11.0)) * (1.0 - smoothstep(0.0, 0.25, rd.y)) * 0.8;
  dens = max(dens * smoothstep(0.02, 0.2, rd.y), streak);
  dens *= smoothstep(-0.01, 0.03, rd.y);
  // Self-shadowing toward the sun.
  vec2 toSun = normalize(uSunDir.xz) * 0.22;
  float n2 = fbm2((uv + toSun) * 0.55 * 1.3 + drift * 1.3 + warp * 0.9);
  float occl = smoothstep(0.45, 0.85, n2);
  float lit = exp(-occl * 2.2);
  float az = dot(normalize(rd.xz + 1e-4), normalize(uSunDir.xz)) * 0.5 + 0.5;
  vec3 shade = mix(vec3(0.28, 0.24, 0.42), vec3(0.6, 0.32, 0.4), az * az) * 0.7;
  // Undersides catch the sun from below the horizon line: rose to gold.
  vec3 glow = uSunColor * mix(0.12, 0.42, az * az) * mix(vec3(1.0, 0.7, 0.85), vec3(1.0, 0.9, 0.8), az);
  vec3 col = mix(shade, glow, lit);
  // Silver lining where the cloud thins near the sun.
  col += uSunColor * pow(saturate(sd), 10.0) * (1.0 - dens) * 1.6;
  return vec4(col, dens * 0.85);
}

vec3 mountains(vec3 rd, vec3 col) {
  float az = atan(rd.z, rd.x);
  float y = rd.y;
  float px = max(fwidth(y) * 1.2, 1e-4);
  float towardSun = dot(normalize(rd.xz + 1e-4), normalize(uSunDir.xz)) * 0.5 + 0.5;
  vec3 mist = fogInscatter(vec3(rd.x, -0.01, rd.z));
  vec3 rock = mix(vec3(0.3, 0.24, 0.36), vec3(0.12, 0.11, 0.2), towardSun);
  for (int i = 0; i < 4; i++) {
    float h = mountainHeight(i, az);
    float a = 1.0 - smoothstep(h - px, h + px, y);
    if (a <= 0.0) continue;
    float fi = float(i);
    float haze = mix(0.72, 0.18, fi / 3.0);
    vec3 layer = mix(rock * mix(1.0, 0.75, fi / 3.0), mist, haze);
    // Ridge slope catching the low sun.
    float dh = mountainHeight(i, az + 0.004) - h;
    float facing = saturate(-dh * 120.0 * sign(sin(az - atan(uSunDir.z, uSunDir.x))));
    layer += uSunColor * 0.04 * facing * (1.0 - haze);
    // Valley mist pooling below each ridge line.
    float below = h - y;
    float pool = smoothstep(0.0, mix(0.05, 0.022, fi / 3.0), below);
    layer = mix(layer, mist, pool * mix(0.65, 0.85, fi / 3.0));
    col = mix(col, layer, a);
  }
  // The valley floor dissolves into haze.
  col = mix(col, mist, 1.0 - smoothstep(-0.06, -0.02, y));
  return col;
}

vec3 skyColor(vec3 rd, bool withSun) {
  vec3 col = skyGradient(rd);
  vec4 cl = clouds(rd);
  col = mix(col, cl.rgb, cl.a);
  if (withSun) {
    float ang = acos(clamp(dot(rd, uSunDir), -1.0, 1.0));
    float r = 0.0105;
    float disk = 1.0 - smoothstep(r * 0.92, r, ang);
    float limb = sqrt(saturate(1.0 - sq(ang / r)));
    col += uSunColor * vec3(1.0, 0.9, 0.78) * disk * (14.0 + 16.0 * limb) * (1.0 - cl.a * 0.85);
  }
  col = mountains(rd, col);
  return col;
}
`;

export function createSky() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...pickShared('uTime', 'uSunDir', 'uSunColor', 'uSkyZenith', 'uSkyHorizon', 'uSkyAway', 'uFogColor', 'uFogSunColor', 'uFogParams'),
      uInvViewProj: { value: new THREE.Matrix4() },
      uCloudTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vNdc;
      void main() {
        vNdc = position.xy;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }`,
    fragmentShader: COMMON + ATMOS + SKY_GLSL + /* glsl */ `
      uniform mat4 uInvViewProj;
      varying vec2 vNdc;
      void main() {
        vec4 wp = uInvViewProj * vec4(vNdc, 1.0, 1.0);
        vec3 rd = normalize(wp.xyz / wp.w - cameraPosition);
        gl_FragColor = vec4(skyColor(rd, true), 1.0);
      }`,
    depthWrite: false,
    depthTest: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.userData.update = (camera, time) => {
    material.uniforms.uInvViewProj.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    material.uniforms.uCloudTime.value = time;
  };
  return mesh;
}
