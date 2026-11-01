import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { garmentToGlb } from '../src/engine/garment-export.ts';

test('GLB keeps separate PBR materials, RGBA vertex shading and visible parts', async () => {
  // The exporter uses the browser FileReader API to pack its binary chunks.
  const originalReader = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((result) => {
        this.result = result;
        this.onloadend?.();
      });
    }
  };
  const group = new THREE.Group();
  const fabric = new THREE.MeshPhysicalMaterial({ roughness: 0.9, vertexColors: true, name: 'fabric' });
  const wood = new THREE.MeshPhysicalMaterial({ roughness: 0.7, name: 'birch' });
  const chrome = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.1, name: 'chrome' });
  const geometry = new THREE.BoxGeometry(0.4, 0.6, 0.02);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(
    new Float32Array(geometry.attributes.position.count * 4).fill(1), 4,
  ));
  group.add(new THREE.Mesh(geometry, fabric), new THREE.Mesh(geometry, wood), new THREE.Mesh(geometry, chrome));
  const hidden = new THREE.Mesh(geometry, fabric);
  hidden.visible = false;
  group.add(hidden);
  try {
    const blob = await garmentToGlb(group);
    assert.equal(blob.type, 'model/gltf-binary');
    const buffer = await blob.arrayBuffer();
    const header = new DataView(buffer);
    assert.equal(header.getUint32(0, true), 0x46546c67);
    assert.equal(header.getUint32(4, true), 2);
    assert.equal(header.getUint32(8, true), buffer.byteLength);
    assert.equal(header.getUint32(16, true), 0x4e4f534a);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, header.getUint32(12, true))));
    assert.equal(json.nodes.filter((node) => node.mesh !== undefined).length, 3);
    assert.deepEqual(json.materials.map((material) => material.name).sort(), ['birch', 'chrome', 'fabric']);
    const metal = json.materials.find((material) => material.name === 'chrome');
    assert.equal(metal.pbrMetallicRoughness.metallicFactor, 1);
    assert.equal(metal.pbrMetallicRoughness.roughnessFactor, 0.1);
    const color = json.meshes[0].primitives[0].attributes.COLOR_0;
    assert.equal(json.accessors[color].type, 'VEC4');
  } finally {
    if (originalReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = originalReader;
    geometry.dispose();
    for (const material of [fabric, wood, chrome]) material.dispose();
  }
});
