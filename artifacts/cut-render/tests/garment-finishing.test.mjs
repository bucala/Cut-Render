import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cornerRounder, lockstitchGeometry, sleeveSideClearance, weldClosedSeams } from '../src/engine/garment-finishing.ts';
import { applyFabricDetail, applyHeather } from '../src/engine/fabric-detail.ts';

test('rounded shoulder joins have continuous tangents and leave drafting points unchanged', () => {
  const corner = { x: 0, y: 0 }, before = { x: -100, y: 0 }, after = { x: 100, y: 70 };
  const round = cornerRounder(before, corner, after, 30);
  const incoming = new THREE.Vector2(1, 0), outgoing = new THREE.Vector2(100, 70).normalize();
  const draft = (s) => ({ x: (s < 0 ? incoming : outgoing).x * s, y: (s < 0 ? incoming : outgoing).y * s });
  const point = (s) => { const p = round(draft(s)); return new THREE.Vector2(p.x, p.y); };
  const derivative = (a, b) => point(b).sub(point(a)).normalize();
  assert.ok(round(corner).y > 0, 'the hard shoulder corner must move inward');
  assert.deepEqual(corner, { x: 0, y: 0 });
  assert.deepEqual(round(draft(-30)), draft(-30));
  assert.deepEqual(round(draft(30)), draft(30));
  assert.ok(derivative(-0.001, 0).dot(derivative(0, 0.001)) > 0.999999);
  assert.ok(derivative(-30.001, -30).dot(derivative(-30, -29.999)) > 0.999999);
  assert.ok(derivative(29.999, 30).dot(derivative(30, 30.001)) > 0.999999);
  const far = { x: 0, y: 200 };
  assert.equal(round(far), far);
  for (let s = -40; s <= 40; s += 0.1) assert.ok(point(s).toArray().every(Number.isFinite));
  assert.deepEqual(cornerRounder(before, corner, after, 0)(corner), corner);
});

test('sewn layers share exact positions and normals without welding open hems or artwork UVs', () => {
  const layers = [false, true].map((back) => {
    const geometry = new THREE.PlaneGeometry(2, 2, 2, 2);
    const points = Array.from({ length: 9 }, (_, i) => ({
      x: geometry.attributes.position.getX(i) * 1000, y: -geometry.attributes.position.getY(i) * 1000,
    }));
    geometry.translate(back ? 0.01 : 0, 0, back ? -0.2 : 0.2);
    if (back) {
      const index = geometry.index;
      for (let i = 0; i < index.count; i += 3) {
        const b = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b);
      }
    }
    return { geometry, points, sewn: (i) => i % 3 === 0 || i % 3 === 2 };
  });
  const uv = layers.map((l) => l.geometry.attributes.uv.array.slice());
  const winding = layers.map((l) => l.geometry.index.array.slice());
  assert.equal(weldClosedSeams(layers), 6);
  for (let i = 0; i < 9; i++) {
    const a = new THREE.Vector3().fromBufferAttribute(layers[0].geometry.attributes.position, i);
    const b = new THREE.Vector3().fromBufferAttribute(layers[1].geometry.attributes.position, i);
    if (i % 3 === 1) { assert.ok(a.distanceTo(b) > 0.39, 'open middle of the hem must keep its depth'); continue; }
    assert.deepEqual(a.toArray(), b.toArray());
    const n = new THREE.Vector3().fromBufferAttribute(layers[0].geometry.attributes.normal, i);
    const m = new THREE.Vector3().fromBufferAttribute(layers[1].geometry.attributes.normal, i);
    assert.deepEqual(n.toArray(), m.toArray());
    assert.ok(Math.abs(n.length() - 1) < 1e-6);
  }
  layers.forEach(({ geometry }, i) => {
    assert.deepEqual(geometry.attributes.uv.array, uv[i]);
    assert.deepEqual(geometry.index.array, winding[i]);
    assert.ok(geometry.attributes.position.array.every(Number.isFinite));
    assert.ok(geometry.attributes.normal.array.every(Number.isFinite));
    geometry.dispose();
  });
});

test('a lowered sleeve stays outside the body side instead of crossing the meshing outline', () => {
  const underarm = { x: 288, y: 240 }, hem = { x: 280, y: 720 };
  assert.equal(sleeveSideClearance(underarm, underarm, hem, 0), 0);
  assert.equal(sleeveSideClearance({ x: 200, y: 200 }, underarm, hem, 1), 0);
  assert.equal(sleeveSideClearance({ x: 330, y: 320 }, underarm, hem, 1), 0);
  for (let progress = 0.01; progress <= 1; progress += 0.01) {
    const edge = { x: 288 - progress * 38, y: 240 + progress * 84 };
    const shifted = edge.x + sleeveSideClearance(edge, underarm, hem, progress);
    const side = 288 + (280 - 288) * (edge.y - 240) / 480;
    assert.ok(shifted >= side + 8 * progress - 1e-9);
  }
});

test('lockstitches use one finite indexed geometry with correctly oriented thread faces', () => {
  for (const end of [new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0, 0, 0.1)]) {
    const curve = new THREE.LineCurve3(new THREE.Vector3(), end);
    const geometry = lockstitchGeometry(curve, (u) => 0.35 + 0.3 * u);
    const count = Math.floor(curve.getLength() / 0.0032);
    const { position, normal, color } = geometry.attributes;
    assert.equal(position.count, count * 8);
    assert.equal(geometry.index.count, count * 24);
    assert.ok(position.array.every(Number.isFinite));
    assert.ok(normal.array.every(Number.isFinite));
    assert.ok(color.array.every((n) => n >= 0.35 && n <= 0.65));
    const a = new THREE.Vector3().fromBufferAttribute(position, geometry.index.getX(0));
    const b = new THREE.Vector3().fromBufferAttribute(position, geometry.index.getX(1));
    const c = new THREE.Vector3().fromBufferAttribute(position, geometry.index.getX(2));
    assert.ok(b.sub(a).cross(c.sub(a)).dot(new THREE.Vector3().fromBufferAttribute(normal, 0)) > 0);
    geometry.dispose();
  }
  const short = lockstitchGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, 0.001, 0)), () => 1);
  assert.equal(short.attributes.position.count, 0);
  short.dispose();
});

test('cached fabric pixels keep texture transforms and disposal independent between garments', () => {
  const a = new THREE.MeshPhysicalMaterial(), b = new THREE.MeshPhysicalMaterial();
  a.name = b.name = 'cotton-jersey';
  applyFabricDetail(a, {}); applyFabricDetail(b, {});
  assert.notEqual(a.normalMap, b.normalMap);
  assert.equal(a.normalMap.image.data, b.normalMap.image.data);
  a.normalMap.repeat.set(2, 3);
  assert.equal(b.normalMap.repeat.x, 1 / 0.128);
  let disposed = false;
  b.normalMap.addEventListener('dispose', () => { disposed = true; });
  a.normalMap.dispose();
  assert.equal(disposed, false);
  applyHeather(a); applyHeather(b);
  assert.notEqual(a.map, b.map);
  assert.equal(a.map.image.data, b.map.image.data);
  assert.equal(a.map.colorSpace, THREE.SRGBColorSpace);
  a.map.repeat.set(4, 5);
  assert.equal(b.map.repeat.x, 1 / 0.128);
  const old = b.map.image.data;
  applyHeather(b, 0.2);
  assert.notEqual(b.map.image.data, old);
  for (const material of [a, b]) { material.normalMap.dispose(); material.map.dispose(); material.dispose(); }
});

test('fabric detail retains non-knit preset maps rather than generating and discarding knit pixels', () => {
  const map = new THREE.DataTexture(new Uint8Array([127, 127, 255, 255]), 1, 1);
  map.repeat.set(2, 3);
  const material = new THREE.MeshPhysicalMaterial({ normalMap: map });
  material.name = 'leather';
  material.normalScale.set(0.4, 0.8);
  applyFabricDetail(material, { knitSize: 1.6, fabricStrength: 0.5 });
  assert.equal(material.normalMap, map);
  assert.deepEqual(material.normalScale.toArray(), [0.2, 0.4]);
  assert.deepEqual(map.repeat.toArray(), [1, 1.5]);
  map.dispose(); material.dispose();
});
