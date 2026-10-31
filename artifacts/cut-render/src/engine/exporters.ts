import { jsPDF } from 'jspdf';
import type { CutPlan, LineKind, LineStyle, PlanPath, PlanPiece, Point } from './types';
import { artworkDataUrl, artworkSvg, drawArtwork, loadArtworkAssets, type ArtworkLayer, type PanelId } from './artwork';

export const LINE_STYLES: Record<LineKind, LineStyle> = {
  cut: { label: 'Rez', color: '#e11d48', width: 0.35, dash: [], layer: 'CUT', aci: 1 },
  fold: { label: 'Ohyb', color: '#2563eb', width: 0.35, dash: [6, 3], layer: 'FOLD', aci: 5 },
  crease: { label: 'Bigovanie', color: '#0891b2', width: 0.3, dash: [2, 2], layer: 'CREASE', aci: 4 },
  perforation: { label: 'Perforácia', color: '#7c3aed', width: 0.3, dash: [1, 2], layer: 'PERF', aci: 6 },
  seam: { label: 'Šev', color: '#16a34a', width: 0.3, dash: [4, 2], layer: 'SEAM', aci: 3 },
  grain: { label: 'Smer osnovy', color: '#64748b', width: 0.3, dash: [], layer: 'GRAIN', aci: 8 },
  notch: { label: 'Značka (zárez)', color: '#e11d48', width: 0.35, dash: [], layer: 'NOTCH', aci: 1 },
  bleed: { label: 'Spadávka', color: '#f59e0b', width: 0.25, dash: [3, 3], layer: 'BLEED', aci: 2 },
  glue: { label: 'Plocha lepenia', color: '#a16207', width: 0.25, dash: [1, 1], layer: 'GLUE', aci: 30 },
  relief: { label: 'Odľahčovací rez', color: '#db2777', width: 0.3, dash: [], layer: 'RELIEF', aci: 210 },
  annotation: { label: 'Poznámka', color: '#94a3b8', width: 0.2, dash: [], layer: 'NOTES', aci: 9 },
};

export interface SvgOptions {
  includeLabels?: boolean;
  /** Draw the sheet / roll outline */
  includeSheet?: boolean;
  /** Fill pieces with a light tint of their colour */
  tint?: boolean;
  /** Print artwork drawn on garment pieces (clipped to the cut line) */
  artwork?: ArtworkLayer[];
  /** stored image path -> href (data URLs for self-contained files) */
  hrefs?: Map<string, string>;
}

function hasPrint(piece: PlanPiece, artwork: ArtworkLayer[] | undefined): artwork is ArtworkLayer[] {
  return !!piece.print && !!artwork && artwork.some((l) => l.visible && l.panel === piece.print!.panel);
}

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function pathD(p: PlanPath): string {
  if (p.points.length === 0) return '';
  const [first, ...rest] = p.points;
  return 'M' + f(first.x) + ' ' + f(first.y) + rest.map((q) => 'L' + f(q.x) + ' ' + f(q.y)).join('') + (p.closed ? 'Z' : '');
}

/** Order in which kinds are drawn (bottom to top). */
const DRAW_ORDER: LineKind[] = ['bleed', 'glue', 'annotation', 'grain', 'seam', 'relief', 'crease', 'perforation', 'fold', 'notch', 'cut'];

/** Real-scale SVG (1 unit = 1 mm, width/height in mm). */
export function planToSvg(plan: CutPlan, options: SvgOptions = {}): string {
  const { includeLabels = true, includeSheet = true, tint = false, artwork, hrefs } = options;
  const W = plan.sheet.width;
  const H = plan.sheet.height;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + f(W) + 'mm" height="' + f(H) + 'mm" viewBox="0 0 ' + f(W) + ' ' + f(H) + '">',
  );
  out.push('<title>' + escapeXml(plan.title) + '</title>');
  if (includeSheet) {
    out.push('<rect id="sheet" x="0" y="0" width="' + f(W) + '" height="' + f(H) + '" fill="none" stroke="#cbd5e1" stroke-width="0.2"/>');
  }
  for (const piece of plan.pieces) {
    out.push('<g id="' + escapeXml(piece.id) + '" data-name="' + escapeXml(piece.name) + '">');
    if (tint) {
      for (const p of piece.paths) {
        if (p.kind === 'cut' && p.closed) out.push('<path d="' + pathD(p) + '" fill="' + piece.color + '" fill-opacity="0.12" stroke="none"/>');
      }
    }
    const cutPath = piece.paths.find((p) => p.kind === 'cut' && p.closed);
    if (cutPath && hasPrint(piece, artwork)) {
      const clipId = 'print-clip-' + escapeXml(piece.id);
      const m = piece.print!.matrix.map(f).join(' ');
      out.push('<clipPath id="' + clipId + '"><path d="' + pathD(cutPath) + '"/></clipPath>');
      out.push(
        '<g class="print" data-layer="PRINT" clip-path="url(#' + clipId + ')"><g transform="matrix(' + m + ')">' +
          artworkSvg(artwork, piece.print!.panel as PanelId, (src) => hrefs?.get(src) ?? src) +
          '</g></g>',
      );
    }
    for (const kind of DRAW_ORDER) {
      const paths = piece.paths.filter((p) => p.kind === kind);
      if (!paths.length) continue;
      const s = LINE_STYLES[kind];
      const dash = s.dash.length ? ' stroke-dasharray="' + s.dash.join(' ') + '"' : '';
      out.push(
        '<g class="' + kind + '" data-layer="' + s.layer + '" fill="none" stroke="' + s.color + '" stroke-width="' + s.width + '"' + dash + ' stroke-linecap="round" stroke-linejoin="round">',
      );
      for (const p of paths) out.push('<path d="' + pathD(p) + '"/>');
      out.push('</g>');
    }
    if (includeLabels) {
      for (const l of piece.labels) {
        const rot = l.rotation ? ' transform="rotate(' + f(l.rotation) + ' ' + f(l.position.x) + ' ' + f(l.position.y) + ')"' : '';
        out.push(
          '<text x="' + f(l.position.x) + '" y="' + f(l.position.y) + '" font-family="Helvetica, Arial, sans-serif" font-size="' + f(l.size) + '" fill="#334155" text-anchor="middle" dominant-baseline="middle"' + rot + '>' + escapeXml(l.text) + '</text>',
        );
      }
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}

/** DXF R12 with one layer per line kind (CUT, FOLD, CREASE, ...). Y axis flipped so the drawing reads the same as the SVG. */
export function planToDxf(plan: CutPlan): string {
  const H = plan.sheet.height;
  const lines: string[] = [];
  const w = (code: number, value: string | number) => {
    lines.push(String(code));
    lines.push(typeof value === 'number' ? f(value) : value);
  };
  const usedKinds = new Set<LineKind>();
  for (const piece of plan.pieces) for (const p of piece.paths) usedKinds.add(p.kind);

  // HEADER
  w(0, 'SECTION');
  w(2, 'HEADER');
  w(9, '$ACADVER');
  w(1, 'AC1009');
  w(9, '$INSUNITS');
  w(70, '4');
  w(9, '$EXTMIN');
  w(10, 0);
  w(20, 0);
  w(9, '$EXTMAX');
  w(10, plan.sheet.width);
  w(20, plan.sheet.height);
  w(0, 'ENDSEC');
  // TABLES (line types + layers)
  w(0, 'SECTION');
  w(2, 'TABLES');
  w(0, 'TABLE');
  w(2, 'LTYPE');
  w(70, '2');
  w(0, 'LTYPE');
  w(2, 'CONTINUOUS');
  w(70, '0');
  w(3, 'Solid line');
  w(72, '65');
  w(73, '0');
  w(40, 0);
  w(0, 'LTYPE');
  w(2, 'DASHED');
  w(70, '0');
  w(3, '__ __ __');
  w(72, '65');
  w(73, '2');
  w(40, 9);
  w(49, 6);
  w(49, -3);
  w(0, 'ENDTAB');
  w(0, 'TABLE');
  w(2, 'LAYER');
  w(70, String(usedKinds.size + 1));
  for (const kind of usedKinds) {
    const s = LINE_STYLES[kind];
    w(0, 'LAYER');
    w(2, s.layer);
    w(70, '0');
    w(62, String(s.aci));
    w(6, s.dash.length ? 'DASHED' : 'CONTINUOUS');
  }
  w(0, 'LAYER');
  w(2, 'LABELS');
  w(70, '0');
  w(62, '7');
  w(6, 'CONTINUOUS');
  w(0, 'ENDTAB');
  w(0, 'ENDSEC');
  // ENTITIES
  w(0, 'SECTION');
  w(2, 'ENTITIES');
  const Y = (y: number) => H - y;
  for (const piece of plan.pieces) {
    for (const p of piece.paths) {
      if (p.points.length < 2) continue;
      const layer = LINE_STYLES[p.kind].layer;
      if (p.points.length === 2 && !p.closed) {
        w(0, 'LINE');
        w(8, layer);
        w(10, p.points[0].x);
        w(20, Y(p.points[0].y));
        w(11, p.points[1].x);
        w(21, Y(p.points[1].y));
        continue;
      }
      w(0, 'POLYLINE');
      w(8, layer);
      w(66, '1');
      w(70, p.closed ? '1' : '0');
      for (const q of p.points) {
        w(0, 'VERTEX');
        w(8, layer);
        w(10, q.x);
        w(20, Y(q.y));
      }
      w(0, 'SEQEND');
      w(8, layer);
    }
    for (const l of piece.labels) {
      w(0, 'TEXT');
      w(8, 'LABELS');
      w(10, l.position.x);
      w(20, Y(l.position.y));
      w(40, l.size);
      w(1, asciiFold(l.text));
      if (l.rotation) w(50, -l.rotation);
      w(72, '1');
      w(11, l.position.x);
      w(21, Y(l.position.y));
    }
  }
  w(0, 'ENDSEC');
  w(0, 'EOF');
  return lines.join('\r\n');
}

/** DXF R12 text is ASCII; strip diacritics so CAM software renders labels. */
function asciiFold(s: string): string {
  return s
    .replace(/[·•]/g, '-')
    .replace(/[×]/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[„“”]/g, '"')
    .replace(/°/g, ' deg')
    .replace(/²/g, '2')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '');
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Rasterise a piece's print (clipped to its cut line) as a PNG covering the piece bounds. */
function printRaster(piece: PlanPiece, artwork: ArtworkLayer[]): { url: string; x: number; y: number; w: number; h: number } | null {
  const cut = piece.paths.find((p) => p.kind === 'cut' && p.closed);
  if (!cut || !piece.print) return null;
  const b = piece.bounds;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const k = Math.min(6, 4000 / Math.max(w, h)); // ≈150 dpi for typical pieces
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.round(w * k));
  canvas.height = Math.max(4, Math.round(h * k));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, -b.minX * k, -b.minY * k);
  ctx.beginPath();
  cut.points.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
  ctx.clip();
  ctx.transform(...piece.print.matrix);
  drawArtwork(ctx, artwork, piece.print.panel as PanelId);
  return { url: canvas.toDataURL('image/png'), x: b.minX, y: b.minY, w, h };
}

/** Vector PDF at 1:1 scale (garment print is embedded as an image under the cut lines). */
export function planToPdf(plan: CutPlan, artwork?: ArtworkLayer[]): Blob {
  const W = Math.max(10, plan.sheet.width);
  const H = Math.max(10, plan.sheet.height);
  // PDF page size limit is 5080 mm (200 in); scale down larger sheets and say so.
  const MAX = 5000;
  const scale = Math.min(1, MAX / Math.max(W, H));
  const pw = W * scale;
  const ph = H * scale;
  const doc = new jsPDF({ unit: 'mm', format: [pw, ph], orientation: pw > ph ? 'landscape' : 'portrait', compress: true });
  doc.setProperties({ title: plan.title, creator: 'Cut & Render' });
  const S = (p: Point): [number, number] => [p.x * scale, p.y * scale];
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.2);
  doc.rect(0, 0, pw, ph);
  for (const piece of plan.pieces) {
    if (hasPrint(piece, artwork)) {
      const r = printRaster(piece, artwork);
      if (r) doc.addImage(r.url, 'PNG', r.x * scale, r.y * scale, r.w * scale, r.h * scale, undefined, 'FAST');
    }
    for (const kind of DRAW_ORDER) {
      const s = LINE_STYLES[kind];
      const paths = piece.paths.filter((p) => p.kind === kind);
      if (!paths.length) continue;
      doc.setDrawColor(...hexToRgb(s.color));
      doc.setLineWidth(s.width);
      doc.setLineDashPattern(s.dash.map((d) => d * scale), 0);
      for (const p of paths) {
        if (p.points.length < 2) continue;
        const [x0, y0] = S(p.points[0]);
        const segs: [number, number][] = [];
        let px = x0;
        let py = y0;
        for (let i = 1; i < p.points.length; i++) {
          const [x, y] = S(p.points[i]);
          segs.push([x - px, y - py]);
          px = x;
          py = y;
        }
        doc.lines(segs, x0, y0, [1, 1], 'S', p.closed);
      }
    }
    doc.setLineDashPattern([], 0);
    doc.setTextColor(51, 65, 85);
    for (const l of piece.labels) {
      doc.setFontSize(Math.max(4, l.size * scale * 2.835));
      const [x, y] = S(l.position);
      doc.text(asciiFold(l.text), x, y, { align: 'center', baseline: 'middle', angle: l.rotation ? -l.rotation : 0 });
    }
  }
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const note = scale < 1 ? 'Mierka ' + (Math.round(scale * 1000) / 1000) + ' : 1' : 'Mierka 1:1 - mm';
  doc.text(asciiFold(plan.title + ' · ' + note), 3, ph - 3);
  return doc.output('blob');
}

export function planToJson(plan: CutPlan): string {
  return JSON.stringify(plan, null, 2);
}

export function downloadBlob(data: Blob | string, fileName: string, mime = 'application/octet-stream'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export type PlanExportFormat = 'svg' | 'dxf' | 'pdf' | 'json';

export function safeFileName(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'cut-plan'
  );
}

/** Export and trigger a download. Returns the file name used. */
export async function exportPlan(plan: CutPlan, format: PlanExportFormat, baseName: string, artwork?: ArtworkLayer[]): Promise<string> {
  const fileName = safeFileName(baseName) + '.' + format;
  const used = (artwork ?? []).filter((l) => l.visible && plan.pieces.some((p) => p.print?.panel === l.panel));
  switch (format) {
    case 'svg': {
      const hrefs = new Map<string, string>();
      for (const l of used) if (l.kind === 'image' && l.src && !hrefs.has(l.src)) hrefs.set(l.src, await artworkDataUrl(l.src));
      downloadBlob(planToSvg(plan, { includeLabels: true, includeSheet: true, artwork: used, hrefs }), fileName, 'image/svg+xml');
      break;
    }
    case 'dxf':
      downloadBlob(planToDxf(plan), fileName, 'application/dxf');
      break;
    case 'pdf':
      if (used.length) await loadArtworkAssets(used);
      downloadBlob(planToPdf(plan, used), fileName, 'application/pdf');
      break;
    case 'json':
      downloadBlob(planToJson(plan), fileName, 'application/json');
      break;
  }
  return fileName;
}
