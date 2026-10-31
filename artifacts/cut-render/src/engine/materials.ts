import * as THREE from 'three';
import type { ProductType } from './types';
import { getProceduralTextures, type ProceduralKind } from './textures';

/**
 * Physically based material presets. Each preset maps to a THREE.MeshPhysicalMaterial
 * that both the real-time renderer and the path tracer understand.
 */
export interface MaterialPreset {
  id: string;
  name: string;
  productType: ProductType;
  /** Short category used for grouping in the UI, e.g. "Natural fibres", "Board", "Film". */
  category: string;
  description: string;
  /** Swatch colour (hex) for UI chips. */
  swatch: string;
  /** Default colour (hex). Users may tint the material with any colour. */
  color: string;
  /** Whether a user colour override makes sense for this material. */
  tintable: boolean;
  /** Real-world physical properties shown in the UI. */
  properties: { label: string; value: string }[];
  physical: {
    roughness: number;
    metalness: number;
    sheen?: number;
    sheenRoughness?: number;
    sheenColor?: string;
    clearcoat?: number;
    clearcoatRoughness?: number;
    transmission?: number;
    thickness?: number;
    ior?: number;
    iridescence?: number;
    anisotropy?: number;
    specularIntensity?: number;
    opacity?: number;
    normalStrength?: number;
    texture?: ProceduralKind;
    /** Texture repeats per metre of surface. */
    textureScale?: number;
  };
}

export const MATERIALS: MaterialPreset[] = [
  // ---------------------------------------------------------------- apparel
  {
    id: 'cotton-jersey',
    name: 'Bavlnený úplet',
    productType: 'apparel',
    category: 'Natural fibres',
    description: 'Soft single-knit cotton, the classic T-shirt fabric with a velvety matte sheen.',
    swatch: '#e9e4da',
    color: '#ece7de',
    tintable: true,
    properties: [
      { label: 'Weight', value: '180 g/m²' },
      { label: 'Stretch', value: '15 % across' },
      { label: 'Width', value: '1800 mm' },
    ],
    physical: { roughness: 0.92, metalness: 0, sheen: 1, sheenRoughness: 0.55, sheenColor: '#ffffff', texture: 'knit', textureScale: 260, normalStrength: 0.35 },
  },
  {
    id: 'denim',
    name: 'Denim 12 oz',
    productType: 'apparel',
    category: 'Natural fibres',
    description: 'Indigo twill weave with a visible diagonal rib.',
    swatch: '#2f4a73',
    color: '#34507a',
    tintable: true,
    properties: [
      { label: 'Weight', value: '400 g/m²' },
      { label: 'Stretch', value: '2 %' },
      { label: 'Width', value: '1500 mm' },
    ],
    physical: { roughness: 0.85, metalness: 0, sheen: 0.6, sheenRoughness: 0.7, sheenColor: '#9fb4d6', texture: 'twill', textureScale: 160, normalStrength: 0.8 },
  },
  {
    id: 'linen',
    name: 'Pratý ľan',
    productType: 'apparel',
    category: 'Natural fibres',
    description: 'Plain weave linen with slubby yarns and a dry hand.',
    swatch: '#cfc2a8',
    color: '#d3c7ae',
    tintable: true,
    properties: [
      { label: 'Weight', value: '190 g/m²' },
      { label: 'Stretch', value: '0 %' },
      { label: 'Width', value: '1450 mm' },
    ],
    physical: { roughness: 0.9, metalness: 0, sheen: 0.7, sheenRoughness: 0.6, sheenColor: '#fff6e5', texture: 'plain-weave', textureScale: 120, normalStrength: 0.7 },
  },
  {
    id: 'silk-satin',
    name: 'Hodvábny satén',
    productType: 'apparel',
    category: 'Luxury',
    description: 'Fluid satin weave with strong anisotropic highlights.',
    swatch: '#8c1f3a',
    color: '#8f2340',
    tintable: true,
    properties: [
      { label: 'Weight', value: '90 g/m²' },
      { label: 'Stretch', value: '0 %' },
      { label: 'Width', value: '1400 mm' },
    ],
    physical: { roughness: 0.32, metalness: 0, sheen: 1, sheenRoughness: 0.25, sheenColor: '#ffd9e2', anisotropy: 0.8, specularIntensity: 1, texture: 'satin', textureScale: 300, normalStrength: 0.15 },
  },
  {
    id: 'leather',
    name: 'Lícová koža',
    productType: 'apparel',
    category: 'Luxury',
    description: 'Semi-aniline leather with natural pebble grain.',
    swatch: '#6b3d22',
    color: '#6e3f24',
    tintable: true,
    properties: [
      { label: 'Thickness', value: '1.1 mm' },
      { label: 'Stretch', value: '5 %' },
      { label: 'Hide size', value: '≈ 4.5 m²' },
    ],
    physical: { roughness: 0.55, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.45, sheen: 0.2, sheenRoughness: 0.5, texture: 'leather', textureScale: 40, normalStrength: 1 },
  },
  {
    id: 'tech-nylon',
    name: 'Technický nylon',
    productType: 'apparel',
    category: 'Synthetics',
    description: 'Ripstop nylon shell fabric with a light coating.',
    swatch: '#1d1f22',
    color: '#202327',
    tintable: true,
    properties: [
      { label: 'Weight', value: '70 g/m²' },
      { label: 'Stretch', value: '0 %' },
      { label: 'Width', value: '1500 mm' },
    ],
    physical: { roughness: 0.45, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.4, sheen: 0.3, sheenRoughness: 0.4, texture: 'ripstop', textureScale: 90, normalStrength: 0.5 },
  },
  {
    id: 'fleece',
    name: 'Počesaný fleece',
    productType: 'apparel',
    category: 'Synthetics',
    description: 'Heavy loopback fleece for hoodies and sweatshirts.',
    swatch: '#7c8478',
    color: '#7d8679',
    tintable: true,
    properties: [
      { label: 'Weight', value: '320 g/m²' },
      { label: 'Stretch', value: '10 %' },
      { label: 'Width', value: '1850 mm' },
    ],
    physical: { roughness: 1, metalness: 0, sheen: 1, sheenRoughness: 0.9, sheenColor: '#e9eee6', texture: 'knit', textureScale: 200, normalStrength: 0.25 },
  },

  // ---------------------------------------------------------------- packaging
  {
    id: 'kraft-corrugated',
    name: 'Kraftová vlnitá lepenka (vlna E)',
    productType: 'packaging',
    category: 'Corrugated',
    description: 'Brown kraft liner over a 1.5 mm E-flute — the go-to mailer board.',
    swatch: '#b88a57',
    color: '#bf9262',
    tintable: false,
    properties: [
      { label: 'Caliper', value: '1.5 mm' },
      { label: 'ECT', value: '32 lb/in' },
      { label: 'Grammage', value: '440 g/m²' },
    ],
    physical: { roughness: 0.88, metalness: 0, texture: 'kraft', textureScale: 6, normalStrength: 0.5 },
  },
  {
    id: 'white-corrugated',
    name: 'Vlnitá lepenka s bielym povrchom (vlna B)',
    productType: 'packaging',
    category: 'Corrugated',
    description: 'Bleached white top liner on a 3 mm B-flute, ideal for printed shipping boxes.',
    swatch: '#efece4',
    color: '#f1eee7',
    tintable: true,
    properties: [
      { label: 'Caliper', value: '3.0 mm' },
      { label: 'ECT', value: '44 lb/in' },
      { label: 'Grammage', value: '560 g/m²' },
    ],
    physical: { roughness: 0.8, metalness: 0, texture: 'paper', textureScale: 5, normalStrength: 0.3 },
  },
  {
    id: 'sbs-board',
    name: 'Skladačková lepenka SBS',
    productType: 'packaging',
    category: 'Folding carton',
    description: 'Solid bleached sulphate board for retail cartons — crisp folds, bright print surface.',
    swatch: '#f7f6f2',
    color: '#f8f7f3',
    tintable: true,
    properties: [
      { label: 'Caliper', value: '0.45 mm' },
      { label: 'Grammage', value: '350 g/m²' },
      { label: 'Coating', value: 'C1S' },
    ],
    physical: { roughness: 0.55, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.5, texture: 'paper', textureScale: 8, normalStrength: 0.15 },
  },
  {
    id: 'gloss-laminate',
    name: 'Lesklo laminovaná skladačka',
    productType: 'packaging',
    category: 'Finishes',
    description: 'Folding carton with gloss OPP lamination — deep colour, mirror reflections.',
    swatch: '#0f3b5f',
    color: '#123f66',
    tintable: true,
    properties: [
      { label: 'Caliper', value: '0.5 mm' },
      { label: 'Lamination', value: 'Gloss OPP 25 µm' },
      { label: 'Gloss', value: '90 GU' },
    ],
    physical: { roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, texture: 'paper', textureScale: 8, normalStrength: 0.05 },
  },
  {
    id: 'soft-touch',
    name: 'Soft-touch matná',
    productType: 'packaging',
    category: 'Finishes',
    description: 'Velvet soft-touch lamination for premium unboxing.',
    swatch: '#1b1b1d',
    color: '#1d1d20',
    tintable: true,
    properties: [
      { label: 'Caliper', value: '0.55 mm' },
      { label: 'Lamination', value: 'Soft-touch 30 µm' },
      { label: 'Gloss', value: '3 GU' },
    ],
    physical: { roughness: 0.78, metalness: 0, sheen: 0.4, sheenRoughness: 0.8, sheenColor: '#555555', texture: 'paper', textureScale: 8, normalStrength: 0.05 },
  },
  {
    id: 'metallic-foil',
    name: 'Metalizovaná lepenka',
    productType: 'packaging',
    category: 'Finishes',
    description: 'Metallised PET-laminated board for luxury cosmetics.',
    swatch: '#c9b37a',
    color: '#d4bd82',
    tintable: true,
    properties: [
      { label: 'Caliper', value: '0.4 mm' },
      { label: 'Film', value: 'Met-PET 12 µm' },
      { label: 'Gloss', value: 'Mirror' },
    ],
    physical: { roughness: 0.18, metalness: 1, clearcoat: 0.6, clearcoatRoughness: 0.05, texture: 'brushed', textureScale: 6, normalStrength: 0.1 },
  },

  // ---------------------------------------------------------------- ppf
  {
    id: 'ppf-gloss',
    name: 'PPF lesklá číra',
    productType: 'ppf',
    category: 'Clear film',
    description: 'Self-healing TPU film, 8 mil, crystal clear gloss top coat.',
    swatch: '#d8eef7',
    color: '#ffffff',
    tintable: false,
    properties: [
      { label: 'Thickness', value: '200 µm (8 mil)' },
      { label: 'Elongation', value: '≤ 25 % in use' },
      { label: 'Roll width', value: '1524 mm' },
    ],
    physical: { roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.01, transmission: 1, thickness: 0.2, ior: 1.5, opacity: 1 },
  },
  {
    id: 'ppf-matte',
    name: 'PPF matná / Stealth',
    productType: 'ppf',
    category: 'Clear film',
    description: 'Satin-matte TPU that turns gloss paint into a frozen stealth finish.',
    swatch: '#c7cdd1',
    color: '#ffffff',
    tintable: false,
    properties: [
      { label: 'Thickness', value: '200 µm (8 mil)' },
      { label: 'Elongation', value: '≤ 20 % in use' },
      { label: 'Roll width', value: '1524 mm' },
    ],
    physical: { roughness: 0.55, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.6, transmission: 0.95, thickness: 0.2, ior: 1.5, opacity: 1 },
  },
  {
    id: 'ppf-black-gloss',
    name: 'Farebná PPF lesklá čierna',
    productType: 'ppf',
    category: 'Colour film',
    description: 'Pigmented gloss TPU — a full colour change with paint protection.',
    swatch: '#0b0b0d',
    color: '#0b0b0e',
    tintable: true,
    properties: [
      { label: 'Thickness', value: '190 µm' },
      { label: 'Elongation', value: '≤ 20 % in use' },
      { label: 'Roll width', value: '1524 mm' },
    ],
    physical: { roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 },
  },
  {
    id: 'ppf-carbon',
    name: 'PPF s karbónovým vzhľadom',
    productType: 'ppf',
    category: 'Colour film',
    description: '2x2 twill carbon print under a gloss TPU top layer.',
    swatch: '#26282b',
    color: '#2b2e33',
    tintable: false,
    properties: [
      { label: 'Thickness', value: '210 µm' },
      { label: 'Elongation', value: '≤ 15 % in use' },
      { label: 'Roll width', value: '1520 mm' },
    ],
    physical: { roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, anisotropy: 0.5, texture: 'carbon', textureScale: 60, normalStrength: 0.4 },
  },
  {
    id: 'ppf-chrome',
    name: 'Chrómová farebná PPF',
    productType: 'ppf',
    category: 'Colour film',
    description: 'Mirror chrome TPU film with iridescent shift.',
    swatch: '#b9bec4',
    color: '#c9ced4',
    tintable: true,
    properties: [
      { label: 'Thickness', value: '180 µm' },
      { label: 'Elongation', value: '≤ 10 % in use' },
      { label: 'Roll width', value: '1520 mm' },
    ],
    physical: { roughness: 0.06, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.35 },
  },
];

/** Base paint options for the object underneath a PPF film. */
export interface PaintPreset {
  id: string;
  name: string;
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
}

export const BASE_PAINTS: PaintPreset[] = [
  { id: 'arctic-white', name: 'Arktická biela', color: '#f2f3f4', metalness: 0, roughness: 0.35, clearcoat: 1 },
  { id: 'obsidian', name: 'Obsidián metalíza', color: '#121316', metalness: 0.6, roughness: 0.35, clearcoat: 1 },
  { id: 'racing-red', name: 'Pretekárska červená', color: '#a5121b', metalness: 0.1, roughness: 0.3, clearcoat: 1 },
  { id: 'nardo-grey', name: 'Nardo sivá', color: '#7b7e80', metalness: 0, roughness: 0.4, clearcoat: 1 },
  { id: 'british-green', name: 'Britská pretekárska zelená', color: '#123a2a', metalness: 0.5, roughness: 0.3, clearcoat: 1 },
  { id: 'liquid-silver', name: 'Tekuté striebro', color: '#b8bcc1', metalness: 0.9, roughness: 0.25, clearcoat: 1 },
  { id: 'miami-blue', name: 'Miami modrá', color: '#1fa6c9', metalness: 0.2, roughness: 0.3, clearcoat: 1 },
];

export function getMaterial(id: string): MaterialPreset {
  const m = MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`Neznámy materiál: ${id}`);
  return m;
}

export function getMaterialsFor(productType: ProductType): MaterialPreset[] {
  return MATERIALS.filter((m) => m.productType === productType);
}

export function getDefaultMaterialId(productType: ProductType): string {
  return getMaterialsFor(productType)[0].id;
}

export function getPaint(id: string): PaintPreset {
  return BASE_PAINTS.find((p) => p.id === id) ?? BASE_PAINTS[0];
}

/**
 * Create a physically based THREE material for a preset.
 * @param colorOverride optional hex colour (only applied when the preset is tintable)
 * @param uvScaleMetres how many metres one UV unit represents on the target mesh (used to size textures)
 */
export function createPhysicalMaterial(
  presetId: string,
  colorOverride?: string | null,
  uvScaleMetres = 1,
): THREE.MeshPhysicalMaterial {
  const p = getMaterial(presetId);
  const ph = p.physical;
  const color = p.tintable && colorOverride ? colorOverride : p.color;
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: ph.roughness,
    metalness: ph.metalness,
    side: THREE.DoubleSide,
  });
  mat.name = p.id;
  if (ph.sheen !== undefined) {
    mat.sheen = ph.sheen;
    mat.sheenRoughness = ph.sheenRoughness ?? 0.5;
    // a fixed (usually near-white) preset sheen would wash out a custom colour into a pastel:
    // when the fabric is dyed, the sheen takes the dye colour, only slightly lighter
    const dyed = p.tintable && !!colorOverride;
    mat.sheenColor = dyed ? new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.15) : new THREE.Color(ph.sheenColor ?? color);
  }
  if (ph.clearcoat !== undefined) {
    mat.clearcoat = ph.clearcoat;
    mat.clearcoatRoughness = ph.clearcoatRoughness ?? 0.1;
  }
  if (ph.transmission !== undefined) {
    mat.transmission = ph.transmission;
    mat.thickness = ph.thickness ?? 0.1;
    mat.ior = ph.ior ?? 1.5;
    mat.transparent = false;
  }
  if (ph.iridescence !== undefined) mat.iridescence = ph.iridescence;
  if (ph.anisotropy !== undefined) mat.anisotropy = ph.anisotropy;
  if (ph.specularIntensity !== undefined) mat.specularIntensity = ph.specularIntensity;
  if (ph.texture) {
    const tex = getProceduralTextures(ph.texture);
    const rep = (ph.textureScale ?? 10) * uvScaleMetres;
    const normal = tex.normal.clone();
    normal.needsUpdate = true;
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.repeat.set(rep, rep);
    mat.normalMap = normal;
    const s = ph.normalStrength ?? 0.5;
    mat.normalScale = new THREE.Vector2(s, s);
    if (tex.roughness) {
      const r = tex.roughness.clone();
      r.needsUpdate = true;
      r.wrapS = r.wrapT = THREE.RepeatWrapping;
      r.repeat.set(rep, rep);
      mat.roughnessMap = r;
    }
    if (tex.albedo) {
      const a = tex.albedo.clone();
      a.needsUpdate = true;
      a.wrapS = a.wrapT = THREE.RepeatWrapping;
      a.repeat.set(rep, rep);
      a.colorSpace = THREE.SRGBColorSpace;
      mat.map = a;
    }
  }
  return mat;
}

export function createPaintMaterial(paintId: string): THREE.MeshPhysicalMaterial {
  const p = getPaint(paintId);
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(p.color),
    metalness: p.metalness,
    roughness: p.roughness,
    clearcoat: p.clearcoat,
    clearcoatRoughness: 0.03,
    side: THREE.DoubleSide,
  });
  m.name = `paint-${p.id}`;
  return m;
}
