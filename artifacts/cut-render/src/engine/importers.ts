import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ProductType, ProgressCallback } from './types';

export type FormatFamily = 'mesh' | 'cad' | 'scene' | 'native';

export interface FormatInfo {
  id: string;
  label: string;
  extensions: string[];
  family: FormatFamily;
  /** false for formats that must be exported from their authoring tool first (Blender, Unreal) */
  supported: boolean;
  /** Guidance shown to the user, e.g. how to export from Blender */
  hint?: string;
}

export const SUPPORTED_FORMATS: FormatInfo[] = [
  { id: 'stl', label: 'STL', extensions: ['stl'], family: 'mesh', supported: true },
  { id: 'obj', label: 'Wavefront OBJ', extensions: ['obj'], family: 'mesh', supported: true },
  { id: 'ply', label: 'PLY', extensions: ['ply'], family: 'mesh', supported: true },
  { id: '3mf', label: '3MF', extensions: ['3mf'], family: 'mesh', supported: true },
  { id: 'gltf', label: 'glTF / GLB', extensions: ['glb', 'gltf'], family: 'scene', supported: true },
  { id: 'fbx', label: 'FBX', extensions: ['fbx'], family: 'scene', supported: true },
  { id: 'dae', label: 'Collada', extensions: ['dae'], family: 'scene', supported: true },
  { id: 'usdz', label: 'USDZ', extensions: ['usdz'], family: 'scene', supported: true },
  { id: 'step', label: 'STEP', extensions: ['step', 'stp'], family: 'cad', supported: true },
  { id: 'iges', label: 'IGES', extensions: ['iges', 'igs'], family: 'cad', supported: true },
  { id: 'brep', label: 'OpenCascade BREP', extensions: ['brep', 'brp'], family: 'cad', supported: true },
  {
    id: 'blend',
    label: 'Blender',
    extensions: ['blend'],
    family: 'native',
    supported: false,
    hint: 'Súbory .blend sú interný formát Blenderu. V Blenderi zvoľte File > Export > glTF 2.0 (.glb) alebo FBX a importujte vzniknutý súbor sem.',
  },
  {
    id: 'unreal',
    label: 'Unreal Engine asset',
    extensions: ['uasset', 'umap'],
    family: 'native',
    supported: false,
    hint: 'Assety Unreal Engine nie je možné čítať mimo editora. Kliknite pravým na asset > Asset Actions > Export, zvoľte FBX alebo glTF a importujte ten súbor.',
  },
];

/** Value for <input type="file" accept=...> */
export const ACCEPT_ATTRIBUTE = SUPPORTED_FORMATS.flatMap((f) => f.extensions.map((e) => '.' + e)).join(',');

export interface DetectionResult {
  format: FormatInfo;
  /** 'signature' = recognised from file contents, 'extension' = from file name only */
  confidence: 'signature' | 'extension';
  message: string;
}

export class UnsupportedFormatError extends Error {
  constructor(
    public format: FormatInfo | null,
    public hint: string,
  ) {
    super(hint);
    this.name = 'UnsupportedFormatError';
  }
}

const fmt = (id: string) => SUPPORTED_FORMATS.find((f) => f.id === id)!;

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

function formatFromExtension(name: string): FormatInfo | null {
  const ext = extensionOf(name);
  return SUPPORTED_FORMATS.find((f) => f.extensions.includes(ext)) ?? null;
}

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);

/** Signature based detection on the first bytes of a file. */
function detectFromBytes(head: Uint8Array, fileSize: number): FormatInfo | null {
  const text = new TextDecoder('latin1').decode(head);
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  const lower = trimmed.slice(0, 4096).toLowerCase();

  if (startsWith(head, [0x67, 0x6c, 0x54, 0x46])) return fmt('gltf'); // "glTF"
  if (text.startsWith('Kaydara FBX Binary')) return fmt('fbx');
  if (text.startsWith('BLENDER')) return fmt('blend');
  if (startsWith(head, [0xc1, 0x83, 0x2a, 0x9e])) return fmt('unreal');
  if (trimmed.startsWith('ISO-10303-21')) return fmt('step');
  if (lower.startsWith('ply')) return fmt('ply');
  if (lower.includes('dbrep_drawableshape') || lower.includes('casade topology') || lower.includes('cascade topology')) return fmt('brep');
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP container: 3MF or USDZ
    if (/3dmodel\.model|\[content_types\]\.xml/i.test(text) && !/\.usd[ca]?/i.test(text)) return fmt('3mf');
    if (/\.usd[ca]?/i.test(text)) return fmt('usdz');
    return null;
  }
  if (lower.includes('<collada')) return fmt('dae');
  if (trimmed.startsWith('{') && lower.includes('"asset"')) return fmt('gltf');
  if (lower.includes('fbxheaderextension') || lower.startsWith('; fbx')) return fmt('fbx');
  // IGES: fixed 80 column records, section letter in column 73
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  if (firstLine.length >= 73 && firstLine.length <= 82 && firstLine[72] === 'S' && /^\s*\d+$/.test(firstLine.slice(73, 80))) return fmt('iges');
  // STL
  if (lower.startsWith('solid') && lower.includes('facet')) return fmt('stl');
  if (head.length >= 84) {
    const n = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(80, true);
    if (84 + n * 50 === fileSize) return fmt('stl');
  }
  // OBJ: vertex / face records
  if (/^(v|vn|vt|f|o|g|mtllib|usemtl)\s/m.test(trimmed.slice(0, 4096)) && /^v\s+-?[\d.]/m.test(trimmed)) return fmt('obj');
  return null;
}

/** Recognise the file format from its magic bytes / header, falling back to the extension. */
export async function detectFormat(file: File): Promise<DetectionResult> {
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  const bySig = detectFromBytes(head, file.size);
  const byExt = formatFromExtension(file.name);
  if (bySig) {
    const mismatch = byExt && byExt.id !== bySig.id;
    return {
      format: bySig,
      confidence: 'signature',
      message: mismatch
        ? `Obsah súboru zodpovedá formátu ${bySig.label}, hoci prípona je .${extensionOf(file.name)}.`
        : `Rozpoznaný formát ${bySig.label} podľa obsahu súboru.`,
    };
  }
  if (byExt) return { format: byExt, confidence: 'extension', message: `Formát ${byExt.label} určený podľa prípony súboru.` };
  throw new UnsupportedFormatError(
    null,
    'Formát súboru sa nepodarilo rozpoznať. Podporované sú STEP, IGES, BREP, STL, OBJ, PLY, 3MF, glTF/GLB, FBX, Collada a USDZ.',
  );
}

export interface ShapeAnalysis {
  /** Product type that best fits the model */
  suggestedProduct: ProductType;
  /** Human readable explanation of the suggestion */
  reason: string;
  /** 0..1 how well the model fills its oriented bounding box (1 = a perfect box) */
  boxFit: number;
  /** Box dimensions in mm when the model looks like a box */
  boxDimsMm?: { length: number; width: number; height: number };
}

export interface ImportedModel {
  /** Display object, centred on the origin, sitting on y = 0 */
  object: THREE.Group;
  /** All meshes merged into one indexed geometry in the same space as object */
  geometry: THREE.BufferGeometry;
  fileName: string;
  format: FormatInfo;
  triangleCount: number;
  /** Bounding box size in model units */
  size: { x: number; y: number; z: number };
  /** Guessed unit of the source file */
  unitGuess: { unit: 'mm' | 'cm' | 'm' | 'in'; mmPerUnit: number };
  analysis: ShapeAnalysis;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

const CLAY = () => new THREE.MeshPhysicalMaterial({ color: '#b8bbbf', roughness: 0.45, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4, name: 'clay' });

function meshGroup(geometry: THREE.BufferGeometry): THREE.Group {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const mat = CLAY();
  if (geometry.attributes.color) mat.vertexColors = true;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geometry, mat));
  return g;
}

let occtPromise: Promise<import('occt-import-js').Occt> | null = null;
async function getOcct() {
  if (!occtPromise) {
    occtPromise = (async () => {
      const [{ default: init }, { default: wasmUrl }] = await Promise.all([
        import('occt-import-js'),
        import('occt-import-js/dist/occt-import-js.wasm?url'),
      ]);
      return init({ locateFile: () => wasmUrl });
    })();
    occtPromise.catch(() => (occtPromise = null));
  }
  return occtPromise;
}

async function loadCad(formatId: string, buffer: ArrayBuffer): Promise<THREE.Group> {
  const occt = await getOcct();
  const bytes = new Uint8Array(buffer);
  const params = { linearUnit: 'millimeter' as const, linearDeflectionType: 'bounding_box_ratio' as const, linearDeflection: 0.0015, angularDeflection: 0.35 };
  const res =
    formatId === 'step' ? occt.ReadStepFile(bytes, params) : formatId === 'iges' ? occt.ReadIgesFile(bytes, params) : occt.ReadBrepFile(bytes, params);
  if (!res.success || !res.meshes?.length) throw new Error('CAD súbor sa nepodarilo triangulovať. Skontrolujte, či obsahuje plochy alebo telesá (nie iba krivky).');
  const group = new THREE.Group();
  for (const m of res.meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    if (m.attributes.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
    g.setIndex(m.index.array);
    if (!m.attributes.normal) g.computeVertexNormals();
    const mat = CLAY();
    if (m.color) mat.color.setRGB(m.color[0], m.color[1], m.color[2], THREE.SRGBColorSpace);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = m.name ?? '';
    group.add(mesh);
  }
  return group;
}

async function loadGltf(buffer: ArrayBuffer): Promise<THREE.Group> {
  const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.parseAsync(buffer, '');
    const g = new THREE.Group();
    g.add(gltf.scene);
    return g;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/uri|fetch|load/i.test(msg)) throw new Error('Súbor .gltf odkazuje na externé súbory (.bin, textúry). Exportujte model ako jeden súbor .glb.');
    throw e;
  } finally {
    draco.dispose();
  }
}

async function loadByFormat(format: FormatInfo, buffer: ArrayBuffer): Promise<THREE.Group> {
  const text = () => new TextDecoder().decode(buffer);
  switch (format.id) {
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      return meshGroup(new STLLoader().parse(buffer));
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
      const geo = new PLYLoader().parse(buffer);
      if (!geo.index && geo.attributes.position.count % 3 !== 0) throw new Error('PLY súbor obsahuje iba mračno bodov bez plôch.');
      return meshGroup(geo);
    }
    case 'obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      const g = new THREE.Group();
      g.add(new OBJLoader().parse(text()));
      return g;
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
      const g = new THREE.Group();
      g.add(new ThreeMFLoader().parse(buffer));
      return g;
    }
    case 'gltf':
      return loadGltf(buffer);
    case 'fbx': {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
      const g = new THREE.Group();
      g.add(new FBXLoader().parse(buffer, ''));
      return g;
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
      const res = new ColladaLoader().parse(text(), '');
      if (!res) throw new Error('Collada súbor sa nepodarilo načítať.');
      const g = new THREE.Group();
      g.add(res.scene);
      return g;
    }
    case 'usdz': {
      const { USDZLoader } = await import('three/examples/jsm/loaders/USDZLoader.js');
      const g = new THREE.Group();
      g.add(new USDZLoader().parse(buffer) as THREE.Object3D);
      return g;
    }
    case 'step':
    case 'iges':
    case 'brep':
      return loadCad(format.id, buffer);
    default:
      throw new UnsupportedFormatError(format, format.hint ?? `Formát ${format.label} nie je podporovaný.`);
  }
}

/** Replace materials the path tracer doesn't understand (Phong, Lambert, Basic) with PBR ones. */
function upgradeMaterials(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const conv = (m: THREE.Material): THREE.Material => {
      if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m;
      const src = m as THREE.MeshPhongMaterial;
      const pbr = new THREE.MeshPhysicalMaterial({
        color: src.color ? src.color.clone() : new THREE.Color('#b8bbbf'),
        map: src.map ?? null,
        normalMap: src.normalMap ?? null,
        roughness: src.shininess !== undefined ? THREE.MathUtils.clamp(1 - src.shininess / 120, 0.15, 0.9) : 0.5,
        metalness: 0,
        transparent: src.transparent,
        opacity: src.opacity,
        vertexColors: src.vertexColors,
        side: src.side,
      });
      pbr.name = m.name;
      m.dispose();
      return pbr;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

/** Merge every mesh of the (already transformed) object into one welded position-only geometry. */
function mergeAll(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const chunks: Float32Array[] = [];
  let total = 0;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    if ((mesh as unknown as THREE.Points).isPoints || (mesh as unknown as THREE.Line).isLine) return;
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const out = new Float32Array(Math.floor(triCount) * 9);
    for (let t = 0; t < Math.floor(triCount) * 3; t++) {
      const vi = idx ? idx.getX(t) : t;
      v.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
      out[t * 3] = v.x;
      out[t * 3 + 1] = v.y;
      out[t * 3 + 2] = v.z;
    }
    chunks.push(out);
    total += out.length;
  });
  if (total === 0) throw new Error('Súbor neobsahuje žiadne plochy (trojuholníky).');
  const all = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(all, 3));
  geo.computeBoundingBox();
  const diag = geo.boundingBox!.getSize(new THREE.Vector3()).length() || 1;
  geo = mergeVertices(geo, diag * 1e-6);
  // drop degenerate triangles
  const index = geo.index!;
  const keep: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    if (a !== b && b !== c && a !== c) keep.push(a, b, c);
  }
  geo.setIndex(keep);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function guessUnit(format: FormatInfo, maxDim: number): ImportedModel['unitGuess'] {
  if (format.family === 'cad') return { unit: 'mm', mmPerUnit: 1 };
  if (format.id === 'fbx') {
    if (maxDim > 60) return { unit: 'cm', mmPerUnit: 10 };
    return { unit: 'm', mmPerUnit: 1000 };
  }
  if (format.id === 'gltf' || format.id === 'usdz' || format.id === 'dae') {
    if (maxDim > 150) return { unit: 'mm', mmPerUnit: 1 };
    return { unit: 'm', mmPerUnit: 1000 };
  }
  // STL / OBJ / PLY / 3MF are usually millimetres; tiny numbers mean metres
  if (maxDim < 4) return { unit: 'm', mmPerUnit: 1000 };
  return { unit: 'mm', mmPerUnit: 1 };
}

/** Volume, area and open-edge ratio of an indexed geometry. */
export function measureMesh(geo: THREE.BufferGeometry): { volume: number; area: number; openEdgeRatio: number } {
  const pos = geo.attributes.position;
  const idx = geo.index!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let volume = 0;
  let area = 0;
  const edges = new Map<number, number>();
  const n = pos.count;
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i);
    const ib = idx.getX(i + 1);
    const ic = idx.getX(i + 2);
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    volume += a.dot(ab.copy(b).cross(c)) / 6;
    area += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
    for (const [p, q] of [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ]) {
      const k = p < q ? p * n + q : q * n + p;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const cnt of edges.values()) if (cnt === 1) open++;
  return { volume: Math.abs(volume), area, openEdgeRatio: edges.size ? open / edges.size : 1 };
}

function analyseShape(geo: THREE.BufferGeometry, size: THREE.Vector3, mmPerUnit: number): ShapeAnalysis {
  const { volume, area, openEdgeRatio } = measureMesh(geo);
  const closed = openEdgeRatio < 0.002;
  const vBox = size.x * size.y * size.z;
  const aBox = 2 * (size.x * size.y + size.y * size.z + size.x * size.z);
  const areaScore = aBox > 0 && area > 0 ? Math.min(area / aBox, aBox / area) : 0;
  const volScore = vBox > 0 ? Math.min(1, volume / vBox) : 0;
  const boxFit = closed ? Math.min(volScore, areaScore) : areaScore * 0.5;
  const pct = Math.round(boxFit * 100);
  if (closed && boxFit >= 0.9) {
    const l = Math.max(size.x, size.z) * mmPerUnit;
    const w = Math.min(size.x, size.z) * mmPerUnit;
    const h = size.y * mmPerUnit;
    return {
      suggestedProduct: 'packaging',
      boxFit,
      reason: `Model vypĺňa ${pct} % svojho ohraničujúceho kvádra — vyzerá ako krabica, môžete ho riešiť ako obal.`,
      boxDimsMm: { length: Math.round(l), width: Math.round(w), height: Math.round(h) },
    };
  }
  return {
    suggestedProduct: 'ppf',
    boxFit,
    reason: closed
      ? 'Uzavretý zakrivený tvar — povrch rozdelíme na diely s obmedzeným napätím a rozvinieme ich do roviny.'
      : 'Otvorená tvarovaná plocha (napr. panel karosérie) — ideálna na strih PPF fólie.',
  };
}

/** Normalise a loaded object: Z-up conversion, centre on origin, sit on y = 0, merged geometry and analysis. */
export function finalizeModel(loaded: THREE.Object3D, fileName: string, format: FormatInfo, zUp: boolean, unitOverride?: ImportedModel['unitGuess']): ImportedModel {
  const inner = new THREE.Group();
  inner.add(loaded);
  if (zUp) inner.rotation.x = -Math.PI / 2;
  const object = new THREE.Group();
  object.name = fileName;
  object.add(inner);
  upgradeMaterials(object);

  const geometry = mergeAll(object);
  const box = geometry.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  const offset = new THREE.Vector3(-center.x, -box.min.y, -center.z);
  geometry.translate(offset.x, offset.y, offset.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  object.position.copy(offset);
  const wrapper = new THREE.Group();
  wrapper.name = fileName;
  wrapper.add(object);

  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  const unitGuess = unitOverride ?? guessUnit(format, Math.max(size.x, size.y, size.z));
  return {
    object: wrapper,
    geometry,
    fileName,
    format,
    triangleCount: geometry.index!.count / 3,
    size: { x: size.x, y: size.y, z: size.z },
    unitGuess,
    analysis: analyseShape(geometry, size, unitGuess.mmPerUnit),
  };
}

const Z_UP = new Set(['stl', 'ply', '3mf', 'step', 'iges', 'brep']);

/** Import any supported 3D/CAD file. Throws UnsupportedFormatError with guidance for Blender / Unreal files. */
export async function importModel(file: File, onProgress?: ProgressCallback): Promise<ImportedModel> {
  onProgress?.({ stage: 'Rozpoznávam formát', progress: 0.05 });
  const { format } = await detectFormat(file);
  if (!format.supported) throw new UnsupportedFormatError(format, format.hint ?? `Formát ${format.label} nie je možné načítať priamo.`);
  onProgress?.({ stage: 'Čítam súbor', progress: 0.15 });
  const buffer = await file.arrayBuffer();
  onProgress?.({ stage: format.family === 'cad' ? 'Triangulujem CAD geometriu (OpenCascade)' : `Načítavam ${format.label}`, progress: 0.3 });
  // let the progress UI paint before heavy synchronous parsing
  await new Promise((r) => setTimeout(r, 30));
  let loaded: THREE.Group;
  try {
    loaded = await loadByFormat(format, buffer);
  } catch (e) {
    if (e instanceof UnsupportedFormatError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Súbor ${file.name} sa nepodarilo načítať ako ${format.label}: ${msg}`);
  }
  onProgress?.({ stage: 'Spájam a analyzujem geometriu', progress: 0.8 });
  await new Promise((r) => setTimeout(r, 0));
  const model = finalizeModel(loaded, file.name, format, Z_UP.has(format.id));
  onProgress?.({ stage: 'Hotovo', progress: 1 });
  return model;
}
