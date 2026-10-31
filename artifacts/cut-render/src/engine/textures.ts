import * as THREE from 'three';

/**
 * Procedural, tileable textures generated on a canvas at runtime so the app ships
 * without large texture downloads. Each kind produces a height field that is turned
 * into a normal map, plus optional roughness / albedo variation.
 */
export type ProceduralKind =
  | 'knit'
  | 'twill'
  | 'plain-weave'
  | 'satin'
  | 'leather'
  | 'ripstop'
  | 'kraft'
  | 'paper'
  | 'brushed'
  | 'carbon';

export interface ProceduralTextureSet {
  normal: THREE.Texture;
  roughness?: THREE.Texture;
  albedo?: THREE.Texture;
}

const SIZE = 256;
const cache = new Map<ProceduralKind, ProceduralTextureSet>();

// Deterministic value noise -------------------------------------------------
function hash(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const w = (a: number) => ((a % period) + period) % period;
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, y: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    const scale = period / SIZE;
    sum += amp * valueNoise(x * scale, y * scale, period, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

type HeightFn = (x: number, y: number) => number;

function heightFor(kind: ProceduralKind): HeightFn {
  const TAU = Math.PI * 2;
  switch (kind) {
    case 'knit':
      return (x, y) => {
        // V-shaped knit loops in columns
        const cols = 32;
        const rows = 48;
        const cx = (x / SIZE) * cols;
        const cy = (y / SIZE) * rows;
        const fx = cx - Math.floor(cx) - 0.5;
        const fy = cy - Math.floor(cy);
        const side = fx < 0 ? -1 : 1;
        const loop = Math.abs(fx * 2 - side * (fy - 0.5) * 0.6);
        return 1 - Math.min(1, loop * 1.4) + fbm(x, y, 16, 2, 3) * 0.2;
      };
    case 'twill':
      return (x, y) => {
        const d = ((x + y) / SIZE) * 48;
        const rib = 0.5 + 0.5 * Math.sin(d * TAU);
        return rib * 0.8 + fbm(x, y, 32, 3, 7) * 0.35;
      };
    case 'plain-weave':
      return (x, y) => {
        const n = 40;
        const cx = Math.floor((x / SIZE) * n);
        const cy = Math.floor((y / SIZE) * n);
        const fx = (x / SIZE) * n - cx;
        const fy = (y / SIZE) * n - cy;
        const over = (cx + cy) % 2 === 0;
        const thread = over ? Math.sin(fx * Math.PI) : Math.sin(fy * Math.PI);
        const slub = fbm(x, y, 8, 2, 11) * 0.4;
        return thread * 0.8 + slub;
      };
    case 'satin':
      return (x, y) => 0.5 + 0.5 * Math.sin((y / SIZE) * 120 * TAU + fbm(x, y, 8, 2, 5) * 2) * 0.3;
    case 'leather':
      return (x, y) => {
        // Cellular-ish pebble grain from thresholded noise
        const n = fbm(x, y, 24, 4, 21);
        const cells = Math.abs(Math.sin(n * 18));
        return Math.pow(cells, 0.6) * 0.7 + fbm(x, y, 64, 2, 9) * 0.3;
      };
    case 'ripstop':
      return (x, y) => {
        const grid = 8;
        const gx = (x / SIZE) * grid;
        const gy = (y / SIZE) * grid;
        const lx = Math.abs(gx - Math.round(gx));
        const ly = Math.abs(gy - Math.round(gy));
        const ridge = Math.max(lx < 0.04 ? 1 : 0, ly < 0.04 ? 1 : 0);
        const fine = 0.5 + 0.5 * Math.sin((x / SIZE) * 128 * TAU) * Math.sin((y / SIZE) * 128 * TAU);
        return ridge * 0.8 + fine * 0.25;
      };
    case 'kraft':
      return (x, y) => {
        const fibres = fbm(x * 0.35, y * 3, 32, 4, 31);
        return fibres * 0.6 + fbm(x, y, 8, 4, 13) * 0.4;
      };
    case 'paper':
      return (x, y) => fbm(x, y, 16, 5, 41);
    case 'brushed':
      return (x, y) => fbm(x * 0.02, y * 4, 64, 3, 51);
    case 'carbon':
      return (x, y) => {
        const n = 16;
        const cx = Math.floor((x / SIZE) * n);
        const cy = Math.floor((y / SIZE) * n);
        const fx = (x / SIZE) * n - cx;
        const fy = (y / SIZE) * n - cy;
        const horizontal = Math.floor((cx + cy) / 2) % 2 === 0;
        const t = horizontal ? fy : fx;
        return Math.sin(t * Math.PI);
      };
  }
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx, ctx.createImageData(SIZE, SIZE)];
}

function toTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function getProceduralTextures(kind: ProceduralKind): ProceduralTextureSet {
  const cached = cache.get(kind);
  if (cached) return cached;

  const h = heightFor(kind);
  const height = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) height[y * SIZE + x] = h(x, y);

  const at = (x: number, y: number) => height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];

  const [nCanvas, nCtx, nData] = makeCanvas();
  const strength = 2.5;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 4;
      nData.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nData.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nData.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nData.data[i + 3] = 255;
    }
  }
  nCtx.putImageData(nData, 0, 0);
  const set: ProceduralTextureSet = { normal: toTexture(nCanvas) };

  // Roughness variation: subtle, centred around white (multiplies material roughness)
  const [rCanvas, rCtx, rData] = makeCanvas();
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = 200 + height[i] * 55;
    rData.data[i * 4] = rData.data[i * 4 + 1] = rData.data[i * 4 + 2] = v;
    rData.data[i * 4 + 3] = 255;
  }
  rCtx.putImageData(rData, 0, 0);
  set.roughness = toTexture(rCanvas);

  if (kind === 'kraft' || kind === 'carbon' || kind === 'leather' || kind === 'plain-weave' || kind === 'twill') {
    const [aCanvas, aCtx, aData] = makeCanvas();
    for (let i = 0; i < SIZE * SIZE; i++) {
      const x = i % SIZE;
      const y = Math.floor(i / SIZE);
      let v: number;
      if (kind === 'carbon') v = 120 + height[i] * 135;
      else if (kind === 'kraft') v = 215 + (fbm(x, y, 64, 3, 77) - 0.5) * 70 + (height[i] - 0.5) * 30;
      else v = 225 + (height[i] - 0.5) * 50;
      v = Math.max(0, Math.min(255, v));
      aData.data[i * 4] = aData.data[i * 4 + 1] = aData.data[i * 4 + 2] = v;
      aData.data[i * 4 + 3] = 255;
    }
    aCtx.putImageData(aData, 0, 0);
    set.albedo = toTexture(aCanvas);
  }

  cache.set(kind, set);
  return set;
}
