import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { settleCloth, hangerHeight, hangerDepth } from '../src/engine/cloth-drape.ts';
import { applyFabricDetail } from '../src/engine/fabric-detail.ts';
import { GarmentStage, marketingBackdrop } from '../src/engine/garment-stage.ts';

const support = { top: 0.7, neckWidth: 0.07, halfWidth: 0.2, slope: 0.2 };
function panel(back) {
  const geometry = new THREE.PlaneGeometry(0.36, 0.5, 16, 24);
  geometry.translate(0, 0.425, back ? -0.014 : 0.014);
  return { geometry, sewn: (i) => i % 17 === 0 || i % 17 === 16 };
}

test('long hanging panels keep their drafted length under gravity', () => {
  const panels = [false, true].map((back) => {
    const geometry = new THREE.PlaneGeometry(0.36, 0.75, 36, 75);
    geometry.translate(0, 0.32, back ? -0.014 : 0.014);
    return { geometry, sewn: (i) => i % 37 === 0 || i % 37 === 36 };
  });
  const before = Math.min(...panels[0].geometry.attributes.position.array.filter((_, i) => i % 3 === 1));
  settleCloth(panels, support);
  const after = Math.min(...panels[0].geometry.attributes.position.array.filter((_, i) => i % 3 === 1));
  assert.ok(before - after < 0.015, `hem dropped ${((before - after) * 1000).toFixed(0)} mm`);
});

test('PBD is finite and deterministic, carries trims, and holds shoulder supports', () => {
  function run() {
    const panels = [panel(false), panel(true)];
    const original = panels[0].geometry.attributes.position.array.slice();
    const result = settleCloth(panels, support);
    const position = panels[0].geometry.attributes.position.array;
    assert.ok(result.particles > 800);
    assert.ok(result.constraints > result.particles);
    assert.ok(position.every(Number.isFinite));
    let moved = 0, pinned = 0;
    for (let i = 0; i < original.length; i += 3) {
      const x = original[i], y = original[i + 1];
      if (Math.abs(x) >= support.neckWidth && Math.abs(x) <= support.halfWidth &&
          Math.abs(y - hangerHeight(support, x)) < 0.014) {
        assert.equal(position[i + 1], y); pinned++;
      } else if (position[i + 1] < y - 0.0001) moved++;
    }
    assert.ok(pinned > 0);
    assert.ok(moved > 0);
    const point = new THREE.Vector3().fromArray(original, 17 * 12 * 3 + 8 * 3);
    const displacement = result.displacement(point);
    assert.ok(displacement.length() > 0);
    assert.ok(Number.isFinite(displacement.y));
    return position;
  }
  assert.deepEqual(run(), run());
});

test('sewn front and back boundary pairs converge without closing the open hem', () => {
  const panels = [panel(false), panel(true)];
  settleCloth(panels, support);
  const a = panels[0].geometry.attributes.position, b = panels[1].geometry.attributes.position;
  assert.ok(new THREE.Vector3().fromBufferAttribute(a, 17 * 20)
    .distanceTo(new THREE.Vector3().fromBufferAttribute(b, 17 * 20)) < 0.002);
  assert.ok(Math.abs(a.getZ(17 * 24 + 8) - b.getZ(17 * 24 + 8)) > 0.001);
});

test('curved hanger support carries pinned shoulders along the same depth profile', () => {
  const curved = { ...support, depthBow: 0.012 };
  assert.equal(hangerDepth(curved, 0), 0);
  assert.equal(hangerDepth(curved, curved.halfWidth), curved.depthBow);
  const panels = [panel(false), panel(true)];
  const original = panels.map((p) => p.geometry.attributes.position.array.slice());
  settleCloth(panels, curved);
  let pinned = 0;
  panels.forEach((p, k) => {
    const position = p.geometry.attributes.position;
    assert.ok(position.array.every(Number.isFinite));
    for (let i = 0; i < position.count; i++) {
      const x = original[k][i * 3], y = original[k][i * 3 + 1], z = original[k][i * 3 + 2];
      if (Math.abs(x) >= curved.neckWidth && Math.abs(x) <= curved.halfWidth &&
          Math.abs(y - hangerHeight(curved, x)) < 0.014) {
        assert.ok(Math.abs(position.getZ(i) - z - hangerDepth(curved, x)) < 1e-8);
        pinned++;
      }
    }
    p.geometry.dispose();
  });
  assert.ok(pinned > 0);
});

test('fabric map uses physical metre UVs and respects strength, spacing and sheen', () => {
  const material = new THREE.MeshPhysicalMaterial({ color: '#992233', roughness: 0.5 });
  material.name = 'cotton-jersey';
  applyFabricDetail(material, { knitSize: 0.8, wrinkles: 1, fabricStrength: 0.7, sheen: 0.35 });
  assert.equal(material.normalMap.wrapS, THREE.RepeatWrapping);
  assert.equal(material.normalMap.repeat.x, 1 / 0.128);
  assert.equal(material.sheen, 0.35);
  assert.ok(material.roughness >= 0.82);
  const first = material.normalMap.image.data.slice();
  applyFabricDetail(material, { knitSize: 0.8, wrinkles: 0, fabricStrength: 0.7 });
  assert.deepEqual(material.normalMap.image.data, first, 'macro-fold controls must not alter the knit normal map');
  applyFabricDetail(material, { knitSize: 1.6, wrinkles: 1 });
  assert.notDeepEqual(material.normalMap.image.data, first);
  applyFabricDetail(material, { fabricStrength: 0 });
  const data = material.normalMap.image.data;
  for (let i = 0; i < data.length; i += 4) {
    assert.equal(data[i], 127); assert.equal(data[i + 1], 127); assert.equal(data[i + 2], 255);
  }
  material.normalMap.dispose(); material.dispose();
});

test('marketing backdrop keeps the garment hue, lighter and calmer', () => {
  const green = new THREE.Color('#4f7a5a');
  const a = { h: 0, s: 0, l: 0 }, b = { h: 0, s: 0, l: 0 };
  green.getHSL(a); marketingBackdrop(green).getHSL(b);
  assert.ok(Math.abs(a.h - b.h) < 0.01);
  assert.ok(b.l > a.l && b.s < a.s);
});

test('garment stage switches light patterns and follows the environment style', () => {
  const stage = new GarmentStage();
  stage.fit(1, true);
  stage.setGobo('window');
  assert.ok(stage.panes.visible && stage.shaftLight.intensity > 0 && !stage.leaves.visible);
  stage.setGobo('leaves');
  assert.ok(stage.leaves.visible && !stage.panes.visible);
  stage.setGobo(false);
  assert.ok(!stage.leaves.visible && !stage.panes.visible);
  stage.setStyle({ wall: '#252931', key: { color: '#dfe9ff', intensity: 1.5, position: [-2.5, 5, 2] },
    fill: { color: '#7e8db8', intensity: 0.15, position: [3.5, 2, 2] }, shafts: { color: '#ffaa5e', intensity: 1.3 } });
  assert.equal(stage.wallColor().getHexString(), new THREE.Color('#252931').getHexString());
  assert.ok(stage.panes.visible, 'environment window light shows without a user pattern');
  stage.setPresentation('marketing', new THREE.Color('#4f7a5a'));
  assert.equal(stage.wallColor().getHexString(), marketingBackdrop(new THREE.Color('#4f7a5a')).getHexString());
  assert.ok(stage.shadowKey.castShadow && stage.shadowKey.intensity > 0);
  stage.dispose();
});
