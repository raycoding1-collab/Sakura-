import * as THREE from 'three';
import { shared } from './uniforms.js';

// Orthographic sun shadow map. Casters live in their own scene as proxies that
// share geometry with the visible meshes but use depth-only materials (with
// identical wind / instancing code so shadows move with the tree).
export class SunShadow {
  constructor(renderer, size = 4096) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 150);
    this.center = new THREE.Vector3(0.5, 3.8, 0.3);
    this.radius = 10.5;
    this.distance = 60;
    this.setSize(size);
    this.bias = new THREE.Matrix4().set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1,
    );
  }

  setSize(size) {
    if (this.target) {
      this.target.depthTexture.dispose();
      this.target.dispose();
    }
    const depthTexture = new THREE.DepthTexture(size, size);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.compareFunction = THREE.LessEqualCompare;
    depthTexture.minFilter = THREE.LinearFilter;
    depthTexture.magFilter = THREE.LinearFilter;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RedFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture,
    });
    this.size = size;
    shared.uShadowMap.value = depthTexture;
    shared.uShadowDepth.value = this.target.texture;
  }

  add(geometry, material) {
    const m = new THREE.Mesh(geometry, material);
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    this.scene.add(m);
    return m;
  }

  update(sunDir) {
    const cam = this.camera;
    cam.position.copy(this.center).addScaledVector(sunDir, this.distance);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.center);
    cam.left = -this.radius;
    cam.right = this.radius;
    cam.top = this.radius;
    cam.bottom = -this.radius;
    cam.near = 1;
    cam.far = this.distance + 90;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    shared.uShadowMatrix.value.multiplyMatrices(this.bias, cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    const range = cam.far - cam.near;
    const texelWorld = (2 * this.radius) / this.size;
    // Sun angular diameter ~0.0093 rad, slightly widened for a softer, dreamier light.
    shared.uShadowInfo.value.set(1 / this.size, range, texelWorld, 0.0145);
  }

  render() {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.setRenderTarget(this.target);
    r.setClearColor(0xffffff, 1);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);
  }
}
