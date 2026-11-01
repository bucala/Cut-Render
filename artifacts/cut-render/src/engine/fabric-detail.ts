import * as THREE from 'three';

export interface FabricDetail {
  /** Distance between knit columns, in millimetres. */
  knitSize?: number;
  fabricStrength?: number;
  sheen?: number;
}

/** Seamless tangent-space knit relief. Garment-scale folds belong to the mesh geometry,
 * so this map only carries yarn-scale detail in both the raster and GPU path tracer.
 */
export function applyFabricDetail(material: THREE.MeshPhysicalMaterial, settings: FabricDetail) {
  // 1024 px keeps at least ~6 px per knit column; at 512 the map itself aliased into grain.
  const size = 1024, tileMetres = 0.128, tau = Math.PI * 2;
  const clamp = (n: number | undefined, fallback: number, min: number, max: number) =>
    THREE.MathUtils.clamp(Number.isFinite(n) ? n! : fallback, min, max);
  const spacing = clamp(settings.knitSize, 0.8, 0.6, 2.5);
  const strength = clamp(settings.fabricStrength, 0.65, 0, 2);
  const cols = Math.round(tileMetres * 1000 / spacing), rows = Math.round(cols * 1.5);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const phase = tau * (cols * u + 0.18 * Math.cos(tau * rows * v));
    const microX = Math.cos(phase) * 0.23;
    const microY = -Math.cos(phase) * Math.sin(tau * rows * v) * 0.28 + Math.cos(tau * rows * v) * 0.12;
    const nx = -microX * strength, ny = -microY * strength;
    const inv = 1 / Math.hypot(nx, ny, 1), i = (y * size + x) * 4;
    data[i] = (nx * inv * 0.5 + 0.5) * 255;
    data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
    data[i + 2] = (inv * 0.5 + 0.5) * 255;
    data[i + 3] = 255;
  }
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 8;
  map.repeat.setScalar(1 / tileMetres);
  map.needsUpdate = true;
  // Keep woven/twill/leather presets' own normal maps rather than silently changing their weave.
  if (/cotton|jersey|fleece|wool|knit/i.test(material.name)) {
    material.normalMap?.dispose();
    material.normalMap = map;
    material.normalScale.set(1, 1);
    for (const texture of [material.map, material.roughnessMap]) texture?.repeat.setScalar(1000 / (32 * spacing));
    material.roughness = Math.max(material.roughness, 0.82);
  } else {
    map.dispose();
    material.normalScale.multiplyScalar(strength);
    if (material.normalMap) material.normalMap.repeat.multiplyScalar(0.8 / spacing);
  }
  material.metalness = 0;
  material.sheen = clamp(settings.sheen, 0.45, 0, 1);
  material.sheenRoughness = 0.85;
  material.sheenColor.copy(material.color).lerp(new THREE.Color(0xffffff), 0.08);
}
