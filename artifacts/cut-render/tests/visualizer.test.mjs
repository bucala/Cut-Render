import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RenderMaterials, DEFAULT_MATERIAL_CONTROLS } from '../src/engine/render-materials.ts';
import { HdrTransition } from '../src/engine/hdr-transition.ts';
import { loadLogoTexture, projectLogo } from '../src/engine/projected-logo.ts';

test('material controls restore original textures and physical properties', () => {
  const map = new THREE.Texture();
  const normalMap = new THREE.Texture();
  const roughnessMap = new THREE.Texture();
  const mat = new THREE.MeshPhysicalMaterial({ map, normalMap, roughnessMap, roughness: 0.8, metalness: 0.2 });
  const root = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  const controls = new RenderMaterials();
  controls.apply(root, { textures: false, normalMaps: false, roughness: 0.3, metalness: 0.9 });
  assert.equal(mat.map, null);
  assert.equal(mat.normalMap, null);
  assert.equal(mat.roughnessMap, null);
  assert.equal(mat.roughness, 0.3);
  controls.apply(root, DEFAULT_MATERIAL_CONTROLS);
  assert.equal(mat.map, map);
  assert.equal(mat.normalMap, normalMap);
  assert.equal(mat.roughness, 0.8);
  assert.equal(mat.metalness, 0.2);
  controls.apply(root, { ...DEFAULT_MATERIAL_CONTROLS, normalMaps: false });
  assert.equal(mat.map, map);
  assert.equal(mat.normalMap, null);
  controls.restore();
  assert.equal(mat.normalMap, normalMap);
});

test('plain model hides print overlays and respects artwork visibility when restored', () => {
  const root = new THREE.Group();
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
  overlay.userData.printOverlay = true;
  overlay.userData.artworkVisible = true;
  root.add(overlay);
  const controls = new RenderMaterials();
  controls.apply(root, { ...DEFAULT_MATERIAL_CONTROLS, textures: false });
  assert.equal(overlay.visible, false);
  controls.apply(root, DEFAULT_MATERIAL_CONTROLS);
  assert.equal(overlay.visible, true);
  overlay.userData.artworkVisible = false;
  controls.apply(root, DEFAULT_MATERIAL_CONTROLS);
  assert.equal(overlay.visible, false);
});

function hdr(value) {
  const data = new Uint16Array(4 * 4 * 4).fill(THREE.DataUtils.toHalfFloat(value));
  return new THREE.DataTexture(data, 4, 4, THREE.RGBAFormat, THREE.HalfFloatType);
}

test('HDR crossfade blends linear radiance, throttles updates and reaches the target', (t) => {
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const transition = new HdrTransition(hdr(1), hdr(9));
  assert.equal(THREE.DataUtils.fromHalfFloat(transition.texture.image.data[0]), 1);
  const version = transition.texture.version;
  transition.update(1010);
  assert.equal(transition.texture.version, version);
  transition.update(1250);
  assert.equal(THREE.DataUtils.fromHalfFloat(transition.texture.image.data[0]), 5);
  assert.equal(transition.update(1500), 1);
  assert.equal(THREE.DataUtils.fromHalfFloat(transition.texture.image.data[0]), 9);
  transition.dispose();
});

test('an interrupted HDR transition continues from current radiance', (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const first = new HdrTransition(hdr(1), hdr(9));
  first.update(250);
  now = 250;
  const second = new HdrTransition(first.texture, hdr(3));
  first.dispose();
  assert.equal(THREE.DataUtils.fromHalfFloat(second.texture.image.data[0]), 5);
  second.update(750);
  assert.equal(THREE.DataUtils.fromHalfFloat(second.texture.image.data[0]), 3);
  second.dispose();
});

test('logo projection respects transformed geometry and preserves image aspect', () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.position.x = 2;
  root.add(mesh);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(2, 0, 4);
  camera.lookAt(2, 0, 0);
  const texture = new THREE.Texture({ width: 200, height: 100 });
  const logo = projectLogo(root, camera, texture);
  const bounds = new THREE.Box3().setFromObject(logo);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).x - 2) < 0.001);
  assert.ok(Math.abs(size.x / size.y - 2) < 0.001);
  assert.equal(logo.material.map, texture);
  assert.throws(() => projectLogo(root, camera, texture, new THREE.Vector2(-1, 1)), /povrch/);
  logo.geometry.dispose();
  logo.material.dispose();
});

test('logo validation rejects unsupported files and excessive sizes before decoding', async () => {
  await assert.rejects(loadLogoTexture(new File(['x'], 'logo.svg', { type: 'image/svg+xml' })), /PNG/);
  await assert.rejects(loadLogoTexture({ type: 'image/png', size: 26 * 1024 * 1024 }), /25 MB/);
});
