/**
 * Print artwork (images and text) placed on garment panels.
 *
 * Layers live in the panel's drafting frame: millimetres, y down, the same
 * coordinates the pattern piece is drafted in (see apparel.ts). The same
 * layer data drives the 2D design board, the marker / exports and the 3D
 * overlay textures, so the print lands in the same spot everywhere.
 */
import * as THREE from 'three';
import type { Bounds, Point } from './types';

export type PanelId = 'front' | 'back' | 'sleeveL' | 'sleeveR';

export const PANEL_IDS: PanelId[] = ['front', 'back', 'sleeveL', 'sleeveR'];

export interface ArtworkLayer {
  id: string;
  kind: 'image' | 'text';
  name: string;
  panel: PanelId;
  visible: boolean;
  /** centre of the layer in the panel drafting frame (mm) */
  x: number;
  y: number;
  /** degrees, clockwise on screen */
  rotation: number;
  opacity: number;
  /** image width in mm (height = width * aspect) */
  width: number;
  /** stored object path, e.g. /objects/uploads/<uuid> */
  src?: string;
  /** image height / width */
  aspect?: number;
  text?: string;
  font?: string;
  /** text size (font size) in mm */
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface PrintPanel {
  id: PanelId;
  name: string;
  /** seam line (finished edge) in the drafting frame */
  seam: Point[];
  /** cut line including seam allowance */
  cut: Point[];
  bounds: Bounds;
  /** good default position for new artwork */
  anchor: Point;
  /** typical print width for this panel (mm) */
  printWidth: number;
  /** named placements shown as quick presets */
  presets: { id: string; label: string; x: number; y: number; width: number }[];
}

export const ARTWORK_FONTS: { family: string; label: string }[] = [
  { family: 'Instrument Sans', label: 'Instrument Sans' },
  { family: 'Bricolage Grotesque', label: 'Bricolage' },
  { family: 'Anton', label: 'Anton' },
  { family: 'Bebas Neue', label: 'Bebas Neue' },
  { family: 'Oswald', label: 'Oswald' },
  { family: 'Rubik Mono One', label: 'Rubik Mono' },
  { family: 'Playfair Display', label: 'Playfair' },
  { family: 'Permanent Marker', label: 'Marker' },
  { family: 'Pacifico', label: 'Pacifico' },
  { family: 'JetBrains Mono', label: 'Mono' },
];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Validate artwork loaded from the database. Unknown fields are dropped. */
export function sanitizeArtwork(value: unknown): ArtworkLayer[] {
  if (!Array.isArray(value)) return [];
  const out: ArtworkLayer[] = [];
  for (const raw of value.slice(0, 60)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const kind = r.kind === 'text' ? 'text' : r.kind === 'image' ? 'image' : null;
    if (!kind) continue;
    const panel = PANEL_IDS.includes(r.panel as PanelId) ? (r.panel as PanelId) : 'front';
    const layer: ArtworkLayer = {
      id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : Math.random().toString(36).slice(2, 10),
      kind,
      name: typeof r.name === 'string' ? r.name.slice(0, 80) : kind === 'text' ? 'Text' : 'Obrázok',
      panel,
      visible: r.visible !== false,
      x: clamp(finite(r.x, 0), -2000, 2000),
      y: clamp(finite(r.y, 200), -2000, 2000),
      rotation: clamp(finite(r.rotation, 0), -360, 360),
      opacity: clamp(finite(r.opacity, 1), 0, 1),
      width: clamp(finite(r.width, 200), 5, 2000),
    };
    if (kind === 'image') {
      if (typeof r.src !== 'string' || !r.src.startsWith('/objects/')) continue;
      layer.src = r.src;
      layer.aspect = clamp(finite(r.aspect, 1), 0.02, 50);
    } else {
      layer.text = typeof r.text === 'string' ? r.text.slice(0, 400) : 'Text';
      layer.font = ARTWORK_FONTS.some((f) => f.family === r.font) ? (r.font as string) : ARTWORK_FONTS[0].family;
      layer.size = clamp(finite(r.size, 40), 3, 600);
      layer.color = typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#111111';
      layer.bold = r.bold === true;
      layer.italic = r.italic === true;
    }
    out.push(layer);
  }
  return out;
}

export function newLayerId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Assets: images and fonts load asynchronously; listeners re-render on arrival.
// ---------------------------------------------------------------------------

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/');

/** Same-origin URL that serves an uploaded object (keeps canvases untainted). */
export function artworkUrl(src: string): string {
  return `${BASE}api/storage${src}`;
}

type ImgEntry = { img: HTMLImageElement; state: 'loading' | 'ready' | 'error' };
const images = new Map<string, ImgEntry>();
const listeners = new Set<() => void>();
let emitQueued = false;

function emit() {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    for (const l of listeners) l();
  });
}

/** Subscribe to "an image or font finished loading". */
export function onArtworkAssets(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Loaded image for a stored object path, or null while it is still loading. */
export function getArtworkImage(src: string): HTMLImageElement | null {
  let e = images.get(src);
  if (!e) {
    const img = new Image();
    img.decoding = 'async';
    e = { img, state: 'loading' };
    images.set(src, e);
    const entry = e;
    img.onload = () => {
      entry.state = 'ready';
      emit();
    };
    img.onerror = () => {
      entry.state = 'error';
      emit();
    };
    img.src = artworkUrl(src);
  }
  return e.state === 'ready' ? e.img : null;
}

/** Best URL to show an image right now (local copy of a fresh upload, else the server URL). */
export function artworkHref(src: string): string {
  const e = images.get(src);
  return e && e.state === 'ready' ? e.img.src : artworkUrl(src);
}

/** Wait until every image and font used by the layers has loaded (or failed). */
export async function loadArtworkAssets(layers: ArtworkLayer[]): Promise<void> {
  ensureArtworkFonts(layers);
  const waits: Promise<unknown>[] = [];
  for (const l of layers) {
    if (l.kind === 'image' && l.src) {
      getArtworkImage(l.src);
      const e = images.get(l.src)!;
      if (e.state === 'loading') {
        waits.push(
          new Promise((r) => {
            e.img.addEventListener('load', r, { once: true });
            e.img.addEventListener('error', r, { once: true });
          }),
        );
      }
    } else if (l.kind === 'text' && typeof document !== 'undefined' && document.fonts) {
      waits.push(document.fonts.load(fontSpec(l), l.text || 'Aa').catch(() => undefined));
    }
  }
  await Promise.all(waits);
}

/** Data URL of a stored image, for self-contained SVG exports. */
export async function artworkDataUrl(src: string): Promise<string> {
  const res = await fetch(artworkHref(src));
  if (!res.ok) throw new Error('Obrázok potlače sa nepodarilo načítať.');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Obrázok potlače sa nepodarilo načítať.'));
    r.readAsDataURL(blob);
  });
}

export function artworkImageFailed(src: string): boolean {
  return images.get(src)?.state === 'error';
}

/** Register a just-uploaded image (local object URL) so it shows without a round trip. */
export function primeArtworkImage(src: string, img: HTMLImageElement): void {
  images.set(src, { img, state: 'ready' });
  emit();
}

const fontState = new Map<string, 'loading' | 'ready'>();

function fontSpec(l: ArtworkLayer, px = 64): string {
  return `${l.italic ? 'italic ' : ''}${l.bold ? 700 : 400} ${px}px "${l.font ?? ARTWORK_FONTS[0].family}"`;
}

/** Start loading every web font used by text layers; emits when one arrives. */
export function ensureArtworkFonts(layers: ArtworkLayer[]): void {
  if (typeof document === 'undefined' || !document.fonts) return;
  for (const l of layers) {
    if (l.kind !== 'text') continue;
    const key = fontSpec(l);
    if (fontState.has(key)) continue;
    fontState.set(key, 'loading');
    document.fonts
      .load(key, l.text || 'Aa')
      .then(() => {
        fontState.set(key, 'ready');
        emit();
      })
      .catch(() => fontState.set(key, 'ready'));
  }
}

// ---------------------------------------------------------------------------
// Geometry of a layer
// ---------------------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null;
const LINE_HEIGHT = 1.12;

function textLines(l: ArtworkLayer): string[] {
  return (l.text ?? '').split('\n');
}

/** Width/height (mm) of the layer before rotation. */
export function layerSize(l: ArtworkLayer): { w: number; h: number } {
  if (l.kind === 'image') return { w: l.width, h: l.width * (l.aspect ?? 1) };
  const size = l.size ?? 40;
  const lines = textLines(l);
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  let w = 0;
  if (measureCtx) {
    measureCtx.font = fontSpec(l, 100);
    for (const line of lines) w = Math.max(w, measureCtx.measureText(line).width / 100);
  } else {
    w = Math.max(...lines.map((s) => s.length)) * 0.6;
  }
  return { w: Math.max(w * size, size * 0.3), h: lines.length * size * LINE_HEIGHT };
}

/** Four corners of the (rotated) layer box in panel coordinates. */
export function layerCorners(l: ArtworkLayer): Point[] {
  const { w, h } = layerSize(l);
  const a = (l.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: l.x + x * c - y * s, y: l.y + x * s + y * c }));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function tracePoly(ctx: CanvasRenderingContext2D, pts: Point[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

/**
 * Draw the panel's visible layers onto a canvas whose current transform maps
 * panel millimetres to pixels. Optionally clipped to a polygon (panel frame).
 */
export function drawArtwork(ctx: CanvasRenderingContext2D, layers: ArtworkLayer[], panel: PanelId, clip?: Point[]): void {
  const list = layers.filter((l) => l.visible && l.panel === panel);
  if (!list.length) return;
  ctx.save();
  if (clip && clip.length > 2) {
    tracePoly(ctx, clip);
    ctx.clip();
  }
  for (const l of list) {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate((l.rotation * Math.PI) / 180);
    ctx.globalAlpha = l.opacity;
    if (l.kind === 'image' && l.src) {
      const img = getArtworkImage(l.src);
      const w = l.width;
      const h = w * (l.aspect ?? 1);
      if (img) ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else if (l.kind === 'text') {
      const size = l.size ?? 40;
      // canvas fonts misbehave at tiny pixel sizes: draw at 100px and scale down
      const k = size / 100;
      ctx.scale(k, k);
      ctx.font = fontSpec(l, 100);
      ctx.fillStyle = l.color ?? '#111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = textLines(l);
      const lh = 100 * LINE_HEIGHT;
      lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * lh));
    }
    ctx.restore();
  }
  ctx.restore();
}

const fx = (n: number) => (Math.round(n * 100) / 100).toString();

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** SVG markup (panel frame, mm) for the panel's visible layers. */
export function artworkSvg(layers: ArtworkLayer[], panel: PanelId, href: (src: string) => string = artworkUrl): string {
  const out: string[] = [];
  for (const l of layers) {
    if (!l.visible || l.panel !== panel) continue;
    const tr = `translate(${fx(l.x)} ${fx(l.y)})${l.rotation ? ` rotate(${fx(l.rotation)})` : ''}`;
    const op = l.opacity < 1 ? ` opacity="${fx(l.opacity)}"` : '';
    if (l.kind === 'image' && l.src) {
      const w = l.width;
      const h = w * (l.aspect ?? 1);
      out.push(`<image transform="${tr}"${op} x="${fx(-w / 2)}" y="${fx(-h / 2)}" width="${fx(w)}" height="${fx(h)}" preserveAspectRatio="none" href="${escapeXml(href(l.src))}"/>`);
    } else if (l.kind === 'text') {
      const size = l.size ?? 40;
      const lines = textLines(l);
      const lh = size * LINE_HEIGHT;
      const spans = lines
        .map((line, i) => `<tspan x="0" y="${fx((i - (lines.length - 1) / 2) * lh)}">${escapeXml(line) || ' '}</tspan>`)
        .join('');
      out.push(
        `<text transform="${tr}"${op} font-family="'${escapeXml(l.font ?? ARTWORK_FONTS[0].family)}', sans-serif" font-size="${fx(size)}" font-weight="${l.bold ? 700 : 400}"${l.italic ? ' font-style="italic"' : ''} fill="${l.color ?? '#111'}" text-anchor="middle" dominant-baseline="central">${spans}</text>`,
      );
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// 3D print textures
// ---------------------------------------------------------------------------

export interface PanelTexture {
  panel: PanelId;
  texture: THREE.CanvasTexture;
  bounds: Bounds;
  /** Redraw the texture; returns true when the panel shows any artwork. */
  redraw(layers: ArtworkLayer[]): boolean;
}

/** A transparent canvas texture covering `bounds` (panel mm), clipped to the seam line. */
export function createPanelTexture(panel: PanelId, bounds: Bounds, clip: Point[]): PanelTexture {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const k = Math.min(4, 2048 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, Math.round(w * k));
  canvas.height = Math.max(8, Math.round(h * k));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  const ctx = canvas.getContext('2d')!;
  return {
    panel,
    texture,
    bounds,
    redraw(layers) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const any = layers.some((l) => l.visible && l.panel === panel);
      if (any) {
        ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, (-bounds.minX * canvas.width) / w, (-bounds.minY * canvas.height) / h);
        drawArtwork(ctx, layers, panel, clip);
      }
      texture.needsUpdate = true;
      return any;
    },
  };
}

/** Material for printed ink sitting on top of the fabric. */
export function createInkMaterial(texture: THREE.Texture): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    roughness: 0.62,
    metalness: 0,
    sheen: 0.25,
    sheenRoughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
