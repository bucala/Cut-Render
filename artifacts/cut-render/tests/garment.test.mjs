import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { settleCloth, hangerHeight } from '../src/engine/cloth-drape.ts';
import { applyFabricDetail } from '../src/engine/fabric-detail.ts';

const support = { top: 0.7, neckWidth: 0.07, halfWidth: 0.2, slope: 0.2 };
function panel(back) {
  const geometry = new THREE.PlaneGeometry(0.36, 0.5, 16, 24);
  geometry.translate(0, 0.425, back ? -0.014 : 0.014);
  return { geometry, sewn: (i) => i % 17 === 0 || i % 17 === 16 };
}

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

test('fabric map uses physical metre UVs and respects strength, spacing and sheen', () => {
  const material = new THREE.MeshPhysicalMaterial({ color: '#992233', roughness: 0.5 });
  material.name = 'cotton-jersey';
  applyFabricDetail(material, { knitSize: 0.8, wrinkles: 1, fabricStrength: 0.7, sheen: 0.35 });
  assert.equal(material.normalMap.wrapS, THREE.RepeatWrapping);
  assert.equal(material.normalMap.repeat.x, 1 / 0.128);
  assert.equal(material.sheen, 0.35);
  assert.ok(material.roughness >= 0.82);
  const first = material.normalMap.image.data.slice();
  applyFabricDetail(material, { knitSize: 1.6, wrinkles: 1 });
  assert.notDeepEqual(material.normalMap.image.data, first);
  applyFabricDetail(material, { fabricStrength: 0 });
  const data = material.normalMap.image.data;
  for (let i = 0; i < data.length; i += 4) {
    assert.equal(data[i], 127); assert.equal(data[i + 1], 127); assert.equal(data[i + 2], 255);
  }
  material.normalMap.dispose(); material.dispose();
});
