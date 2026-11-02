import * as THREE from 'three';

const KNIT_DATA = new Map<string, Uint8Array>();
const HEATHER_DATA = new Map<string, Uint8Array>();

/** Only pixel buffers are shared. Every material owns an independently disposable GPU texture. */
function cachedPixels(cache: Map<string, Uint8Array>, key: string, build: () => Uint8Array): Uint8Array {
  const pixels = cache.get(key) ?? build();
  cache.delete(key);
  cache.set(key, pixels);
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  return pixels;
}

function fabricTexture(data: Uint8Array, size: number): THREE.DataTexture {
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 8;
  map.repeat.setScalar(1 / 0.128);
  map.needsUpdate = true;
  return map;
}

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
  // Keep woven/twill/leather presets' own normal maps rather than silently changing their weave.
  if (/cotton|jersey|fleece|wool|knit/i.test(material.name)) {
    const data = cachedPixels(KNIT_DATA, `${cols}:${rows}:${strength}`, () => {
      const pixels = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) {
        const sy = Math.sin(tau * rows * y / size), cy = Math.cos(tau * rows * y / size);
        for (let x = 0; x < size; x++) {
          const wave = Math.cos(tau * (cols * x / size + 0.18 * cy));
          const nx = -wave * 0.23 * strength, ny = (wave * sy * 0.28 - cy * 0.12) * strength;
          const inv = 1 / Math.hypot(nx, ny, 1), i = (y * size + x) * 4;
          pixels[i] = (nx * inv * 0.5 + 0.5) * 255;
          pixels[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
          pixels[i + 2] = (inv * 0.5 + 0.5) * 255;
          pixels[i + 3] = 255;
        }
      }
      return pixels;
    });
    material.normalMap?.dispose();
    material.normalMap = fabricTexture(data, size);
    material.normalScale.set(1, 1);
    for (const texture of [material.map, material.roughnessMap]) texture?.repeat.setScalar(1000 / (32 * spacing));
    material.roughness = Math.max(material.roughness, 0.82);
  } else {
    material.normalScale.multiplyScalar(strength);
    if (material.normalMap) material.normalMap.repeat.multiplyScalar(0.8 / spacing);
  }
  material.metalness = 0;
  material.sheen = clamp(settings.sheen, 0.45, 0, 1);
  material.sheenRoughness = 0.85;
  material.sheenColor.copy(material.color).lerp(new THREE.Color(0xffffff), 0.08);
}

/**
 * Faint heathered mottling (seamless albedo, ~1-8 mm flecks) so knit jersey reads as cotton at
 * catalogue-preview scale, where the yarn-scale normal map is far below one pixel.
 */
export function applyHeather(material: THREE.MeshPhysicalMaterial, strength = 0.06) {
  const size = 512;
  strength = THREE.MathUtils.clamp(Number.isFinite(strength) ? strength : 0.06, 0, 1);
  // Periodic lattice noise: every octave wraps at the tile edge.
  const hash = (x: number, y: number, seed: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const data = cachedPixels(HEATHER_DATA, `${strength}`, () => {
    const noise = (cx: number, cy: number, seed: number) => {
      const lattice = Float64Array.from({ length: cx * cy }, (_, i) => hash(i % cx, Math.floor(i / cx), seed));
      return (u: number, v: number) => {
        const x = u * cx, y = v * cy;
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = x - x0, fy = y - y0;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const at = (i: number, j: number) => lattice[((y0 + j) % cy) * cx + (x0 + i) % cx];
        const top = at(0, 0) + (at(1, 0) - at(0, 0)) * sx;
        const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * sx;
        return top + (bottom - top) * sy;
      };
    };
    const cloud = noise(16, 16, 1), yarn = noise(48, 48, 2), fleck = noise(48, 192, 3);
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = 0.15 * cloud(u, v) + 0.3 * yarn(u, v) + 0.55 * fleck(u, v) ** 2;
      const g = Math.round(255 * (1 - strength * 1.6 * Math.max(0, n - 0.25)));
      const i = (y * size + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = g;
      pixels[i + 3] = 255;
    }
    return pixels;
  });
  const map = fabricTexture(data, size);
  map.colorSpace = THREE.SRGBColorSpace;
  material.map?.dispose();
  material.map = map;
}
