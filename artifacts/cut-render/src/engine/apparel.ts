import * as THREE from 'three';
import type { CutPlan, PlanLabel, PlanPath, PlanPiece, Point } from './types';
import { bezier, boundsOf, centroid, mirrorX, pieceColor, polygonArea, polylineLength, rotatePoints, translatePoints } from './geom';
import { createPhysicalMaterial } from './materials';
import { createInkMaterial, createPanelTexture, type ArtworkLayer, type PanelId, type PanelTexture, type PrintPanel } from './artwork';

export type GarmentId = 'tshirt' | 'hoodie' | 'trousers' | 'skirt' | 'tote';

export interface GarmentTemplate {
  id: GarmentId;
  name: string;
  description: string;
  /** Names of the pattern pieces, for display */
  pieces: string[];
  /** Whether the sleeve option applies */
  hasSleeves: boolean;
}

export const GARMENT_TEMPLATES: GarmentTemplate[] = [
  { id: 'tshirt', name: 'Tričko', description: 'Tričko s okrúhlym výstrihom a všitými rukávmi.', pieces: ['Predný diel', 'Zadný diel', 'Rukáv ×2', 'Lemovka výstrihu'], hasSleeves: true },
  { id: 'hoodie', name: 'Mikina s kapucňou', description: 'Mikina cez hlavu s dvojdielnou kapucňou a klokaním vreckom.', pieces: ['Predný diel', 'Zadný diel', 'Rukáv ×2', 'Kapucňa ×2', 'Vrecko', 'Manžeta ×2', 'Pás'], hasSleeves: true },
  { id: 'trousers', name: 'Nohavice', description: 'Nohavice s rovnými nohavicami a pásom.', pieces: ['Predná nohavica ×2', 'Zadná nohavica ×2', 'Pás'], hasSleeves: false },
  { id: 'skirt', name: 'A-línia sukňa', description: 'Rozšírená sukňa v tvare A s pásom.', pieces: ['Predný diel', 'Zadný diel', 'Pás'], hasSleeves: false },
  { id: 'tote', name: 'Taška (tote)', description: 'Nákupná taška s vyformovaným dnom a uchami.', pieces: ['Telo ×2', 'Ucho ×2'], hasSleeves: false },
];

export type SizeId = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export const SIZES: SizeId[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/** Body measurements in mm */
export interface BodyMeasurements {
  chest: number;
  waist: number;
  hip: number;
  /** nape to hem of a standard top */
  backLength: number;
  shoulder: number;
  sleeveLength: number;
  inseam: number;
  neck: number;
}

export const SIZE_CHART: Record<SizeId, BodyMeasurements> = {
  XS: { chest: 840, waist: 700, hip: 860, backLength: 660, shoulder: 410, sleeveLength: 590, inseam: 780, neck: 360 },
  S: { chest: 900, waist: 760, hip: 920, backLength: 690, shoulder: 430, sleeveLength: 610, inseam: 800, neck: 375 },
  M: { chest: 980, waist: 840, hip: 990, backLength: 720, shoulder: 450, sleeveLength: 630, inseam: 810, neck: 390 },
  L: { chest: 1060, waist: 920, hip: 1060, backLength: 740, shoulder: 470, sleeveLength: 650, inseam: 820, neck: 405 },
  XL: { chest: 1140, waist: 1000, hip: 1140, backLength: 760, shoulder: 490, sleeveLength: 660, inseam: 825, neck: 420 },
  XXL: { chest: 1220, waist: 1090, hip: 1220, backLength: 780, shoulder: 510, sleeveLength: 670, inseam: 830, neck: 435 },
};

export type FitId = 'slim' | 'regular' | 'oversized';
export type SleeveId = 'short' | 'long';

export interface GarmentParams {
  garment: GarmentId;
  size: SizeId;
  fit: FitId;
  sleeve: SleeveId;
  seamAllowanceMm: number;
  hemAllowanceMm: number;
  /** Lengthen (+) or shorten (-) the body / leg in mm */
  lengthAdjustMm: number;
  /** Fabric roll width used for the cutting marker layout */
  fabricWidthMm: number;
  /** Optional overrides of the size chart */
  measurements?: Partial<BodyMeasurements>;
}

export function defaultGarmentParams(garment: GarmentId = 'tshirt'): GarmentParams {
  return {
    garment,
    size: 'M',
    fit: 'regular',
    sleeve: garment === 'hoodie' ? 'long' : 'short',
    seamAllowanceMm: 10,
    hemAllowanceMm: garment === 'tote' ? 30 : 25,
    lengthAdjustMm: 0,
    fabricWidthMm: 1500,
  };
}

const FIT_EASE: Record<FitId, number> = { slim: 40, regular: 100, oversized: 220 };

// ---------------------------------------------------------------------------
// Drafting primitives
// ---------------------------------------------------------------------------

interface DraftEdge {
  /** Seam-line polyline, start and end included */
  pts: Point[];
  allowance: number;
  /** Positions of notches along the edge (0..1) */
  notches?: number[];
}

interface DraftPiece {
  name: string;
  edges: DraftEdge[];
  /** Grain line in drafting space (vertical) */
  grain: [Point, Point];
  /** Additional internal lines (fold lines, pocket placement) */
  extra?: PlanPath[];
  count: number;
  /** Second copy is mirrored (left / right pair) */
  mirrorPair?: boolean;
  /** Printable panel carried by each copy (index = copy number) */
  print?: PanelId[];
}

interface Measures {
  m: BodyMeasurements;
  ease: number;
  sa: number;
  hem: number;
  lenAdj: number;
}

function line(a: Point, b: Point): Point[] {
  return [a, b];
}

function rev(p: Point[]): Point[] {
  return [...p].reverse();
}

function mir(p: Point[]): Point[] {
  return p.map((q) => ({ x: -q.x, y: q.y }));
}

function concat(...parts: Point[][]): Point[] {
  const out: Point[] = [];
  for (const part of parts) {
    for (const q of part) {
      const last = out[out.length - 1];
      if (last && Math.hypot(last.x - q.x, last.y - q.y) < 1e-6) continue;
      out.push(q);
    }
  }
  return out;
}

function rectEdges(w: number, h: number, sa: number, notchMid = true): DraftEdge[] {
  return [
    { pts: line({ x: 0, y: 0 }, { x: w, y: 0 }), allowance: sa, notches: notchMid ? [0.5] : [] },
    { pts: line({ x: w, y: 0 }, { x: w, y: h }), allowance: sa },
    { pts: line({ x: w, y: h }, { x: 0, y: h }), allowance: sa, notches: notchMid ? [0.5] : [] },
    { pts: line({ x: 0, y: h }, { x: 0, y: 0 }), allowance: sa },
  ];
}

/** Offset an open polyline to its right (relative to travel direction) when s=1. */
function offsetPolyline(pts: Point[], d: number, s: number): Point[] {
  if (d === 0) return pts.map((p) => ({ ...p }));
  const n = pts.length;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    let nx = dy * s;
    let ny = -dx * s;
    // mitre correction for interior vertices
    if (i > 0 && i < n - 1) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      const n1x = ((p1.y - p0.y) / l1) * s;
      const n1y = (-(p1.x - p0.x) / l1) * s;
      const cos = nx * n1x + ny * n1y;
      const k = 1 / Math.max(cos, 0.5);
      nx *= k;
      ny *= k;
      void p2;
    }
    out.push({ x: pts[i].x + nx * d, y: pts[i].y + ny * d });
  }
  return out;
}

function intersect(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  return { x: a1.x + (a2.x - a1.x) * t, y: a1.y + (a2.y - a1.y) * t };
}

function pointAt(pts: Point[], t: number): { p: Point; dir: Point } {
  const total = polylineLength(pts, false);
  let target = total * t;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (target <= l || i === pts.length - 2) {
      const k = l > 0 ? Math.min(1, target / l) : 0;
      return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, dir: { x: (b.x - a.x) / (l || 1), y: (b.y - a.y) / (l || 1) } };
    }
    target -= l;
  }
  return { p: pts[0], dir: { x: 1, y: 0 } };
}

interface BuiltPiece {
  seam: Point[];
  cut: Point[];
  notches: [Point, Point][];
  grain: [Point, Point];
  extra: PlanPath[];
}

function buildPiece(piece: DraftPiece): BuiltPiece {
  const seam = concat(...piece.edges.map((e) => e.pts));
  if (seam.length > 2) {
    const f = seam[0];
    const l = seam[seam.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) seam.pop();
  }
  const s = polygonArea(seam) > 0 ? 1 : -1;
  const offs = piece.edges.map((e) => offsetPolyline(e.pts, e.allowance, s));
  const cut: Point[] = [];
  for (let i = 0; i < offs.length; i++) {
    const cur = offs[i];
    const next = offs[(i + 1) % offs.length];
    const pts = cur.slice(i === 0 ? 1 : 1, -1);
    // start of this edge was handled by the previous join; add interior points + join with next
    cut.push(...pts);
    const a1 = cur[cur.length - 2];
    const a2 = cur[cur.length - 1];
    const b1 = next[0];
    const b2 = next[1];
    const x = intersect(a1, a2, b1, b2);
    const corner = piece.edges[i].pts[piece.edges[i].pts.length - 1];
    const maxD = Math.max(piece.edges[i].allowance, piece.edges[(i + 1) % offs.length].allowance) * 3 + 1;
    if (x && Math.hypot(x.x - corner.x, x.y - corner.y) < maxD) cut.push(x);
    else cut.push(a2, b1);
  }
  const notches: [Point, Point][] = [];
  for (const e of piece.edges) {
    for (const t of e.notches ?? []) {
      const { p, dir } = pointAt(e.pts, t);
      const n = { x: dir.y * s, y: -dir.x * s };
      const a = e.allowance;
      if (a > 0) notches.push([{ x: p.x + n.x * a, y: p.y + n.y * a }, { x: p.x + n.x * Math.max(0, a - 6), y: p.y + n.y * Math.max(0, a - 6) }]);
      else notches.push([p, { x: p.x - n.x * 4, y: p.y - n.y * 4 }]);
    }
  }
  return { seam, cut, notches, grain: piece.grain, extra: piece.extra ?? [] };
}

// ---------------------------------------------------------------------------
// Garment drafts
// ---------------------------------------------------------------------------

function measures(p: GarmentParams): Measures {
  const base = SIZE_CHART[p.size] ?? SIZE_CHART.M;
  const m = { ...base, ...(p.measurements ?? {}) };
  return { m, ease: FIT_EASE[p.fit] ?? 100, sa: p.seamAllowanceMm, hem: p.hemAllowanceMm, lenAdj: p.lengthAdjustMm };
}

interface TopDraft {
  front: DraftPiece;
  back: DraftPiece;
  sleeve: DraftPiece;
  neckLength: number;
  hemWidth: number;
  sleeveHem: number;
  dims: { chest: number; length: number; armhole: number; shoulder: number; sleeveLen: number; bicep: number };
}

function draftTop(M: Measures, opts: { extraEase: number; lengthExtra: number; sleeve: SleeveId; frontNeckExtra: number; hemBand: number; cuff: number }): TopDraft {
  const { m, sa, hem } = M;
  const C = m.chest + M.ease + opts.extraEase;
  const qw = C / 4;
  const sh = m.shoulder / 2 + (M.ease > 150 ? 30 : M.ease > 60 ? 8 : 0);
  const nw = m.neck / 6 + 12;
  const sd = 40;
  const ad = C / 8 + 95;
  const L = m.backLength + M.lenAdj + opts.lengthExtra - opts.hemBand;
  const flare = 10;
  const hemA = opts.hemBand > 0 ? sa : hem;

  const makeBody = (name: string, neckDepth: number): DraftPiece => {
    const neckHalf = [{ x: 0, y: neckDepth }, ...bezier({ x: 0, y: neckDepth }, { x: nw * 0.62, y: neckDepth }, { x: nw, y: neckDepth * 0.45 }, { x: nw, y: 0 }, 10)];
    const shoulder = line({ x: nw, y: 0 }, { x: sh, y: sd });
    const armhole = [{ x: sh, y: sd }, ...bezier({ x: sh, y: sd }, { x: sh - 14, y: sd + (ad - sd) * 0.55 }, { x: sh + (qw - sh) * 0.25, y: ad }, { x: qw, y: ad }, 14)];
    const side = line({ x: qw, y: ad }, { x: qw + flare, y: L });
    const hemHalf = [{ x: qw + flare, y: L }, ...bezier({ x: qw + flare, y: L }, { x: qw * 0.6, y: L + 6 }, { x: qw * 0.3, y: L + 8 }, { x: 0, y: L + 8 }, 8)];
    return {
      name,
      count: 1,
      edges: [
        { pts: concat(mir(rev(neckHalf)), neckHalf), allowance: sa / 2 + 2, notches: [0.5] },
        { pts: shoulder, allowance: sa },
        { pts: armhole, allowance: sa, notches: name.startsWith('Zad') ? [0.55, 0.62] : [0.55] },
        { pts: side, allowance: sa, notches: [0.35] },
        { pts: concat(hemHalf, mir(rev(hemHalf))), allowance: hemA },
        { pts: mir(rev(side)), allowance: sa, notches: [0.65] },
        { pts: mir(rev(armhole)), allowance: sa, notches: name.startsWith('Zad') ? [0.38, 0.45] : [0.45] },
        { pts: mir(rev(shoulder)), allowance: sa },
      ],
      grain: [{ x: 0, y: neckDepth + 60 }, { x: 0, y: L - 60 }],
    };
  };
  const frontNeck = m.neck / 6 + 25 + opts.frontNeckExtra;
  const front = makeBody('Predný diel', frontNeck);
  const back = makeBody('Zadný diel', 22);
  front.print = ['front'];
  back.print = ['back'];

  // Sleeve
  const bw = C * 0.36;
  const ch = (ad - sd) * 0.62;
  const longLen = m.sleeveLength - (sh - m.shoulder / 2) - opts.cuff;
  const sleeveLen = opts.sleeve === 'long' ? longLen : Math.max(ch + 70, 210 + M.ease * 0.2);
  const hw = opts.sleeve === 'long' ? (opts.cuff > 0 ? bw * 0.62 : bw * 0.55) : bw * 0.86;
  const capL = [{ x: -bw / 2, y: ch }, ...bezier({ x: -bw / 2, y: ch }, { x: -bw * 0.3, y: ch * 0.88 }, { x: -bw * 0.2, y: 0 }, { x: 0, y: 0 }, 12)];
  const capR = mir(rev(capL));
  const seamR = line({ x: bw / 2, y: ch }, { x: hw / 2, y: sleeveLen });
  const sleeve: DraftPiece = {
    name: 'Rukáv',
    count: 2,
    mirrorPair: true,
    edges: [
      { pts: concat(capL, capR), allowance: sa, notches: [0.32, 0.5, 0.7, 0.74] },
      { pts: seamR, allowance: sa },
      { pts: line({ x: hw / 2, y: sleeveLen }, { x: -hw / 2, y: sleeveLen }), allowance: opts.cuff > 0 ? sa : hem },
      { pts: mir(rev(seamR)), allowance: sa },
    ],
    grain: [{ x: 0, y: 50 }, { x: 0, y: sleeveLen - 40 }],
    print: ['sleeveR', 'sleeveL'],
  };
  const neckLength = polylineLength(front.edges[0].pts, false) + polylineLength(back.edges[0].pts, false);
  return {
    front,
    back,
    sleeve,
    neckLength,
    hemWidth: (qw + flare) * 4,
    sleeveHem: hw,
    dims: { chest: C, length: L + opts.hemBand, armhole: ad, shoulder: sh * 2, sleeveLen: sleeveLen + opts.cuff, bicep: bw },
  };
}

function draftTshirt(M: Measures, sleeve: SleeveId): { pieces: DraftPiece[]; info: Record<string, string> } {
  const t = draftTop(M, { extraEase: 0, lengthExtra: 0, sleeve, frontNeckExtra: 0, hemBand: 0, cuff: 0 });
  const bandW = 25;
  const bandLen = t.neckLength * 0.86;
  const band: DraftPiece = {
    name: 'Lemovka výstrihu',
    count: 1,
    edges: rectEdges(bandLen, bandW * 2, M.sa / 2 + 2),
    grain: [{ x: bandLen * 0.3, y: bandW }, { x: bandLen * 0.7, y: bandW }],
    extra: [{ id: 'band-fold', kind: 'fold', points: [{ x: 0, y: bandW }, { x: bandLen, y: bandW }], closed: false }],
  };
  // rib band: grain runs across, rotate grain to vertical
  band.grain = [{ x: bandLen / 2, y: 6 }, { x: bandLen / 2, y: bandW * 2 - 6 }];
  return {
    pieces: [t.front, t.back, t.sleeve, band],
    info: { 'Obvod hrudníka (hotový)': `${Math.round(t.dims.chest)} mm`, 'Dĺžka trupu': `${Math.round(t.dims.length)} mm`, 'Dĺžka rukáva': `${Math.round(t.dims.sleeveLen)} mm` },
  };
}

function draftHoodie(M: Measures): { pieces: DraftPiece[]; info: Record<string, string> } {
  const bandH = 60;
  const cuffH = 70;
  const t = draftTop(M, { extraEase: 60, lengthExtra: 40, sleeve: 'long', frontNeckExtra: 15, hemBand: bandH, cuff: cuffH });
  const k = M.m.chest / 980;
  const hh = 360 * Math.sqrt(k);
  const hd = 245 * Math.sqrt(k);
  const A = { x: 0, y: hh };
  const B = { x: 0, y: 25 };
  const C2 = { x: hd * 0.5, y: 0 };
  const D = { x: hd, y: hh * 0.42 };
  const E = { x: hd * 0.86, y: hh };
  const hood: DraftPiece = {
    name: 'Kapucňa',
    count: 2,
    mirrorPair: true,
    edges: [
      { pts: line(A, B), allowance: 30 },
      { pts: concat([B], bezier(B, { x: 0, y: 5 }, { x: hd * 0.2, y: 0 }, C2, 8), bezier(C2, { x: hd * 0.85, y: 0 }, { x: hd, y: hh * 0.15 }, D, 10)), allowance: M.sa, notches: [0.6] },
      { pts: concat([D], bezier(D, { x: hd, y: hh * 0.7 }, { x: hd * 0.9, y: hh * 0.9 }, E, 10)), allowance: M.sa },
      { pts: concat([E], bezier(E, { x: hd * 0.6, y: hh + 12 }, { x: hd * 0.25, y: hh + 8 }, A, 10)), allowance: M.sa, notches: [0.5] },
    ],
    grain: [{ x: hd * 0.45, y: 60 }, { x: hd * 0.45, y: hh - 60 }],
    extra: [{ id: 'casing', kind: 'fold', points: [{ x: 15, y: hh - 20 }, { x: 15, y: 40 }], closed: false }],
  };
  const pw = 360 * k;
  const pocket: DraftPiece = {
    name: 'Klokanie vrecko',
    count: 1,
    edges: [
      { pts: line({ x: -pw * 0.33, y: 0 }, { x: pw * 0.33, y: 0 }), allowance: M.sa, notches: [0.5] },
      { pts: line({ x: pw * 0.33, y: 0 }, { x: pw / 2, y: 95 * k }), allowance: 20 },
      { pts: line({ x: pw / 2, y: 95 * k }, { x: pw / 2, y: 230 * k }), allowance: M.sa },
      { pts: line({ x: pw / 2, y: 230 * k }, { x: -pw / 2, y: 230 * k }), allowance: M.sa },
      { pts: line({ x: -pw / 2, y: 230 * k }, { x: -pw / 2, y: 95 * k }), allowance: M.sa },
      { pts: line({ x: -pw / 2, y: 95 * k }, { x: -pw * 0.33, y: 0 }), allowance: 20 },
    ],
    grain: [{ x: 0, y: 40 }, { x: 0, y: 200 * k }],
  };
  const cuffLen = t.sleeveHem * 0.82;
  const cuff: DraftPiece = {
    name: 'Manžeta',
    count: 2,
    edges: rectEdges(cuffLen, cuffH * 2, M.sa),
    grain: [{ x: cuffLen / 2, y: 10 }, { x: cuffLen / 2, y: cuffH * 2 - 10 }],
    extra: [{ id: 'cuff-fold', kind: 'fold', points: [{ x: 0, y: cuffH }, { x: cuffLen, y: cuffH }], closed: false }],
  };
  const bandLen = t.hemWidth * 0.85;
  const band: DraftPiece = {
    name: 'Pás',
    count: 1,
    edges: rectEdges(bandLen, bandH * 2, M.sa),
    grain: [{ x: bandLen / 2, y: 10 }, { x: bandLen / 2, y: bandH * 2 - 10 }],
    extra: [{ id: 'band-fold', kind: 'fold', points: [{ x: 0, y: bandH }, { x: bandLen, y: bandH }], closed: false }],
  };
  return {
    pieces: [t.front, t.back, t.sleeve, hood, pocket, cuff, band],
    info: { 'Obvod hrudníka (hotový)': `${Math.round(t.dims.chest)} mm`, 'Dĺžka trupu': `${Math.round(t.dims.length)} mm`, 'Dĺžka rukáva': `${Math.round(t.dims.sleeveLen)} mm` },
  };
}

function draftTrousers(M: Measures): { pieces: DraftPiece[]; info: Record<string, string>; dims: { waist: number; hip: number; rise: number; inseam: number; hemCirc: number } } {
  const { m, sa, hem } = M;
  const H = m.hip + Math.max(40, M.ease * 0.6);
  const Wst = m.waist + 20;
  const rise = m.hip / 4 + 12;
  const ins = m.inseam + M.lenAdj;
  const L = rise + ins;
  const leg = (front: boolean): DraftPiece => {
    const w = front ? H / 4 - 10 : H / 4 + 10;
    const ww = front ? Wst / 4 + 5 : Wst / 4 + 25; // includes dart intake at back
    const ext = front ? H / 16 : H / 9;
    const hemW = front ? H * 0.2 : H * 0.235;
    const kneeY = rise + ins * 0.45;
    const kneeW = hemW * 1.06;
    const cbRaise = front ? 0 : 30;
    const cx = w / 2; // crotch line x (centre front/back)
    const side0 = { x: cx - ww - (front ? 0 : 8), y: 0 };
    const waistC = { x: cx - (front ? 8 : -12), y: -cbRaise };
    const hipSide = { x: -w / 2, y: rise * 0.62 };
    const crotchTop = { x: cx, y: rise * 0.55 };
    const crotchPt = { x: cx + ext, y: rise };
    const inKnee = { x: kneeW / 2, y: kneeY };
    const inHem = { x: hemW / 2, y: L };
    const outHem = { x: -hemW / 2, y: L };
    const outKnee = { x: -kneeW / 2, y: kneeY };
    const crotch = concat([waistC], line(waistC, crotchTop), bezier(crotchTop, { x: cx, y: rise * 0.85 }, { x: cx + ext * 0.4, y: rise }, crotchPt, 10));
    const inseam = concat([crotchPt], bezier(crotchPt, { x: cx + ext * 0.3, y: rise + 30 }, { x: inKnee.x + 15, y: kneeY - ins * 0.2 }, inKnee, 10), line(inKnee, inHem));
    const sideSeam = concat(line(outHem, outKnee), bezier(outKnee, { x: outKnee.x - 10, y: kneeY - ins * 0.25 }, { x: hipSide.x, y: rise }, hipSide, 10), bezier(hipSide, { x: hipSide.x, y: rise * 0.3 }, { x: side0.x - 5, y: rise * 0.1 }, side0, 8));
    const dart: PlanPath[] = front
      ? []
      : [{ id: 'dart', kind: 'relief', points: [{ x: (side0.x + waistC.x) / 2 - 10, y: -cbRaise / 2 }, { x: (side0.x + waistC.x) / 2, y: 110 }, { x: (side0.x + waistC.x) / 2 + 10, y: -cbRaise / 2 }], closed: false }];
    return {
      name: front ? 'Predná nohavica' : 'Zadná nohavica',
      count: 2,
      mirrorPair: true,
      edges: [
        { pts: line(side0, waistC), allowance: sa },
        { pts: crotch, allowance: sa, notches: [0.45] },
        { pts: inseam, allowance: sa, notches: [0.4] },
        { pts: line(inHem, outHem), allowance: hem },
        { pts: sideSeam, allowance: sa, notches: [0.6] },
      ],
      grain: [{ x: 0, y: rise + 40 }, { x: 0, y: L - 80 }],
      extra: dart,
    };
  };
  const bandH = 40;
  const bandLen = Wst + 40;
  const band: DraftPiece = {
    name: 'Pás',
    count: 1,
    edges: rectEdges(bandLen, bandH * 2, sa),
    grain: [{ x: bandLen / 2 - 100, y: bandH }, { x: bandLen / 2 + 100, y: bandH }],
    extra: [{ id: 'band-fold', kind: 'fold', points: [{ x: 0, y: bandH }, { x: bandLen, y: bandH }], closed: false }],
  };
  band.grain = [{ x: 30, y: bandH }, { x: 230, y: bandH }];
  return {
    pieces: [leg(true), leg(false), band],
    info: { 'Obvod bokov (hotový)': `${Math.round(H)} mm`, 'Sed': `${Math.round(rise)} mm`, 'Vnútorná dĺžka': `${Math.round(ins)} mm` },
    dims: { waist: Wst, hip: H, rise, inseam: ins, hemCirc: H * 0.435 },
  };
}

function draftSkirt(M: Measures): { pieces: DraftPiece[]; info: Record<string, string>; dims: { waist: number; hem: number; length: number } } {
  const { m, sa, hem } = M;
  const Wst = m.waist + 15;
  const len = 600 + M.lenAdj;
  const top = Wst / 2;
  const hip = (m.hip + 40) / 2;
  const flare = len * 0.32;
  const hw = Math.max(hip, top) + flare * 2;
  const piece = (name: string, dip: number): DraftPiece => {
    const tl = { x: -top / 2, y: 0 };
    const tr = { x: top / 2, y: 0 };
    const hipR = { x: hip / 2, y: 190 };
    const br = { x: hw / 2, y: len - 20 };
    const bl = { x: -hw / 2, y: len - 20 };
    const waist = concat([tl], bezier(tl, { x: -top / 6, y: dip }, { x: top / 6, y: dip }, tr, 12));
    const sideR = concat([tr], bezier(tr, { x: hip / 2, y: 60 }, { x: hip / 2, y: 140 }, hipR, 8), line(hipR, br));
    const hemC = concat([br], bezier(br, { x: hw / 6, y: len + 10 }, { x: -hw / 6, y: len + 10 }, bl, 14));
    return {
      name,
      count: 1,
      edges: [
        { pts: waist, allowance: sa, notches: [0.5] },
        { pts: sideR, allowance: sa, notches: [0.3] },
        { pts: hemC, allowance: hem },
        { pts: mir(rev(sideR)), allowance: sa, notches: [0.7] },
      ],
      grain: [{ x: 0, y: 80 }, { x: 0, y: len - 80 }],
    };
  };
  const bandH = 35;
  const bandLen = Wst + 40;
  const band: DraftPiece = {
    name: 'Pás',
    count: 1,
    edges: rectEdges(bandLen, bandH * 2, sa),
    grain: [{ x: 30, y: bandH }, { x: 230, y: bandH }],
    extra: [{ id: 'band-fold', kind: 'fold', points: [{ x: 0, y: bandH }, { x: bandLen, y: bandH }], closed: false }],
  };
  return {
    pieces: [piece('Predný diel', 8), piece('Zadný diel', 14), band],
    info: { 'Obvod pásu': `${Math.round(Wst)} mm`, 'Dĺžka sukne': `${Math.round(len)} mm`, 'Obvod lemu': `${Math.round(hw * 2)} mm` },
    dims: { waist: Wst, hem: hw * 2, length: len },
  };
}

const TOTE = { w: 400, h: 420, box: 50, strapLen: 650, strapW: 30 };

function draftTote(M: Measures): { pieces: DraftPiece[]; info: Record<string, string> } {
  const { sa, hem } = M;
  const w = TOTE.w + TOTE.box * 2;
  const h = TOTE.h + TOTE.box + M.lenAdj;
  const b = TOTE.box;
  const body: DraftPiece = {
    name: 'Telo tašky',
    count: 2,
    edges: [
      { pts: line({ x: 0, y: 0 }, { x: w, y: 0 }), allowance: hem, notches: [0.25, 0.75] },
      { pts: line({ x: w, y: 0 }, { x: w, y: h - b }), allowance: sa },
      { pts: concat(line({ x: w, y: h - b }, { x: w - b, y: h - b }), line({ x: w - b, y: h - b }, { x: w - b, y: h })), allowance: sa },
      { pts: line({ x: w - b, y: h }, { x: b, y: h }), allowance: sa, notches: [0.5] },
      { pts: concat(line({ x: b, y: h }, { x: b, y: h - b }), line({ x: b, y: h - b }, { x: 0, y: h - b })), allowance: sa },
      { pts: line({ x: 0, y: h - b }, { x: 0, y: 0 }), allowance: sa },
    ],
    grain: [{ x: w / 2, y: 60 }, { x: w / 2, y: h - b - 60 }],
    print: ['front', 'back'],
  };
  const sw = TOTE.strapW * 3;
  const strap: DraftPiece = {
    name: 'Ucho',
    count: 2,
    edges: rectEdges(sw, TOTE.strapLen, sa / 2, false),
    grain: [{ x: sw / 2, y: 40 }, { x: sw / 2, y: TOTE.strapLen - 40 }],
    extra: [
      { id: 'strap-f1', kind: 'fold', points: [{ x: sw / 3, y: 0 }, { x: sw / 3, y: TOTE.strapLen }], closed: false },
      { id: 'strap-f2', kind: 'fold', points: [{ x: (sw * 2) / 3, y: 0 }, { x: (sw * 2) / 3, y: TOTE.strapLen }], closed: false },
    ],
  };
  return { pieces: [body, strap], info: { 'Rozmer tašky': `${TOTE.w} × ${TOTE.h} × ${TOTE.box * 2} mm`, 'Dĺžka uch': `${TOTE.strapLen} mm` } };
}

function sanitize(p: GarmentParams): GarmentParams {
  const d = defaultGarmentParams(p.garment);
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    garment: GARMENT_TEMPLATES.some((g) => g.id === p.garment) ? p.garment : 'tshirt',
    size: SIZES.includes(p.size) ? p.size : 'M',
    fit: p.fit in FIT_EASE ? p.fit : 'regular',
    sleeve: p.sleeve === 'long' ? 'long' : 'short',
    seamAllowanceMm: num(p.seamAllowanceMm, d.seamAllowanceMm, 0, 40),
    hemAllowanceMm: num(p.hemAllowanceMm, d.hemAllowanceMm, 0, 80),
    lengthAdjustMm: num(p.lengthAdjustMm, d.lengthAdjustMm, -200, 300),
    fabricWidthMm: num(p.fabricWidthMm, d.fabricWidthMm, 400, 3200),
    measurements: p.measurements,
  };
}

function draftAll(p: GarmentParams) {
  const M = measures(p);
  switch (p.garment) {
    case 'hoodie':
      return draftHoodie(M);
    case 'trousers':
      return draftTrousers(M);
    case 'skirt':
      return draftSkirt(M);
    case 'tote':
      return draftTote(M);
    default:
      return draftTshirt(M, p.sleeve);
  }
}

// ---------------------------------------------------------------------------
// Printable panels (artwork placement)
// ---------------------------------------------------------------------------

const PANEL_NAME: Record<PanelId, string> = { front: 'Predný diel', back: 'Zadný diel', sleeveL: 'Ľavý rukáv', sleeveR: 'Pravý rukáv' };

/** Garments that support print artwork. */
export function garmentSupportsArtwork(garment: unknown): boolean {
  return garment === 'tshirt' || garment === 'hoodie' || garment === 'tote' || garment === undefined;
}

/** Printable panels of the garment in their drafting frames (mm, y down). */
export function getPrintPanels(params: GarmentParams): PrintPanel[] {
  const p = sanitize(params);
  if (!garmentSupportsArtwork(p.garment)) return [];
  const out: PrintPanel[] = [];
  for (const dp of draftAll(p).pieces) {
    if (!dp.print) continue;
    const built = buildPiece(dp);
    const sb = boundsOf(built.seam);
    const bounds = boundsOf(built.cut);
    const H = sb.maxY - sb.minY;
    const W = sb.maxX - sb.minX;
    const cx = (sb.minX + sb.maxX) / 2;
    for (const id of dp.print) {
      let presets: PrintPanel['presets'];
      if (p.garment === 'tote') {
        presets = [
          { id: 'center', label: 'Stred', x: cx, y: sb.minY + H * 0.42, width: Math.round(W * 0.55) },
          { id: 'top', label: 'Hore', x: cx, y: sb.minY + H * 0.22, width: Math.round(W * 0.5) },
        ];
      } else if (id === 'front') {
        const hood = p.garment === 'hoodie';
        presets = [
          { id: 'center-chest', label: 'Stred hrude', x: 0, y: H * (hood ? 0.3 : 0.34), width: Math.round(Math.min(300, W * 0.55)) },
          { id: 'left-chest', label: 'Ľavá hruď', x: W * 0.2, y: H * 0.24, width: 90 },
          { id: 'full-front', label: 'Celá predná', x: 0, y: H * 0.45, width: Math.round(W * 0.72) },
        ];
      } else if (id === 'back') {
        presets = [
          { id: 'upper-back', label: 'Hore na chrbte', x: 0, y: H * 0.2, width: Math.round(Math.min(320, W * 0.6)) },
          { id: 'center-back', label: 'Stred chrbta', x: 0, y: H * 0.42, width: Math.round(Math.min(340, W * 0.65)) },
          { id: 'neck', label: 'Pod golierom', x: 0, y: 75, width: 70 },
        ];
      } else {
        presets = [{ id: 'sleeve', label: 'Na rukáv', x: 0, y: Math.min(H * 0.45, 140), width: Math.round(Math.min(80, W * 0.35)) }];
      }
      out.push({ id, name: PANEL_NAME[id], seam: built.seam, cut: built.cut, bounds, anchor: { x: presets[0].x, y: presets[0].y }, printWidth: presets[0].width, presets });
    }
  }
  const order: PanelId[] = ['front', 'back', 'sleeveL', 'sleeveR'];
  return out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

type Mat = [number, number, number, number, number, number];
/** Affine matrix of a point transform (must map points independently, in order). */
function matrixOf(fn: (pts: Point[]) => Point[]): Mat {
  const [o, ex, ey] = fn([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  return [ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y];
}

// ---------------------------------------------------------------------------
// Marker (nesting on the fabric width)
// ---------------------------------------------------------------------------

interface Instance {
  name: string;
  built: BuiltPiece;
  color: string;
  index: number;
  total: number;
  print?: PanelId;
}

function transformBuilt(b: BuiltPiece, fn: (pts: Point[]) => Point[]): BuiltPiece {
  return {
    seam: fn(b.seam),
    cut: fn(b.cut),
    notches: b.notches.map(([a, c]) => fn([a, c]) as [Point, Point]),
    grain: fn(b.grain) as [Point, Point],
    extra: b.extra.map((e) => ({ ...e, points: fn(e.points) })),
  };
}

function grainArrow(g: [Point, Point]): PlanPath[] {
  const [a, b] = g;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const head = (p: Point, s: number): Point[] => [
    { x: p.x - s * ux * 12 + uy * 6, y: p.y - s * uy * 12 - ux * 6 },
    p,
    { x: p.x - s * ux * 12 - uy * 6, y: p.y - s * uy * 12 + ux * 6 },
  ];
  return [
    { id: 'grain', kind: 'grain', points: [a, b], closed: false },
    { id: 'grain-h1', kind: 'grain', points: head(b, 1), closed: false },
    { id: 'grain-h2', kind: 'grain', points: head(a, -1), closed: false },
  ];
}

/** Generate the cutting marker (all pattern pieces laid on the fabric width). */
export function generateGarmentPlan(params: GarmentParams): CutPlan {
  const p = sanitize(params);
  const drafted = draftAll(p);
  const tpl = GARMENT_TEMPLATES.find((g) => g.id === p.garment)!;
  const warnings: string[] = [];

  const instances: Instance[] = [];
  drafted.pieces.forEach((dp, pi) => {
    const built = buildPiece(dp);
    for (let k = 0; k < dp.count; k++) {
      const b = dp.mirrorPair && k % 2 === 1 ? transformBuilt(built, (pts) => mirrorX(pts).reverse()) : built;
      instances.push({ name: dp.name, built: b, color: pieceColor(pi), index: k + 1, total: dp.count, print: dp.print?.[k] });
    }
  });

  // Rotate every piece so the grain runs along the selvage (x axis), then column-pack on the fabric width.
  const fabricW = p.fabricWidthMm;
  const gap = 12;
  const margin = 15;
  const prepared = instances.map((inst) => {
    const [g0, g1] = inst.built.grain;
    const grainAngle = Math.atan2(g1.y - g0.y, g1.x - g0.x);
    let b = transformBuilt(inst.built, (pts) => rotatePoints(pts, -grainAngle));
    let bb = boundsOf(b.cut);
    let crossGrain = false;
    if (bb.maxY - bb.minY > fabricW - 2 * margin) {
      // too wide for the fabric even with grain along the selvage: rotate back (cross grain)
      b = inst.built;
      bb = boundsOf(b.cut);
      crossGrain = true;
    }
    b = transformBuilt(b, (pts) => translatePoints(pts, -bb.minX, -bb.minY));
    // panel frame -> prepared frame (the mirror of the second copy is left out: prints are never mirrored)
    const ox = -bb.minX;
    const oy = -bb.minY;
    const frame = (pts: Point[]) => translatePoints(crossGrain ? pts : rotatePoints(pts, -grainAngle), ox, oy);
    return { inst, b, w: bb.maxX - bb.minX, h: bb.maxY - bb.minY, crossGrain, frame };
  });
  prepared.sort((a, b) => b.h - a.h || b.w - a.w);

  interface Column {
    x: number;
    width: number;
    y: number;
  }
  const columns: Column[] = [];
  let cursorX = margin;
  const placed: { item: (typeof prepared)[number]; x: number; y: number }[] = [];
  for (const item of prepared) {
    if (item.h > fabricW - 2 * margin) warnings.push(`Diel „${item.inst.name}“ je širší ako látka (${Math.round(item.h)} mm > ${fabricW} mm).`);
    let col = columns.find((c) => c.y + item.h <= fabricW - margin && item.w <= c.width + 1);
    const last = columns[columns.length - 1];
    if (!col && last && last.y + item.h <= fabricW - margin) {
      // widen the last column instead of opening a new one
      last.width = Math.max(last.width, item.w);
      cursorX = last.x + last.width + gap;
      col = last;
    }
    if (!col) {
      col = { x: cursorX, width: item.w, y: margin };
      columns.push(col);
      cursorX += item.w + gap;
    }
    placed.push({ item, x: col.x, y: col.y });
    col.y += item.h + gap;
    if (item.crossGrain) warnings.push(`Diel „${item.inst.name}“ musel byť otočený naprieč osnovou.`);
  }
  const markerLen = Math.max(cursorX - gap + margin, 100);

  const pieces: PlanPiece[] = placed.map(({ item, x, y }, i) => {
    const b = transformBuilt(item.b, (pts) => translatePoints(pts, x, y));
    const id = `p${i}`;
    const paths: PlanPath[] = [
      { id: `${id}-cut`, kind: 'cut', points: b.cut, closed: true },
      { id: `${id}-seam`, kind: 'seam', points: b.seam, closed: true },
      ...b.notches.map((n, k) => ({ id: `${id}-notch-${k}`, kind: 'notch' as const, points: n, closed: false })),
      ...grainArrow(b.grain).map((g) => ({ ...g, id: `${id}-${g.id}` })),
      ...b.extra.map((e, k) => ({ ...e, id: `${id}-x${k}` })),
    ];
    const c = centroid(b.seam);
    const bb = boundsOf(b.cut);
    const size = Math.max(6, Math.min(18, Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY) * 0.09));
    const name = item.inst.total > 1 ? `${item.inst.name} ${item.inst.index}/${item.inst.total}` : item.inst.name;
    const labels: PlanLabel[] = [
      { text: name, position: { x: c.x, y: c.y - size * 0.8 }, size },
      { text: `${tpl.name} · ${p.size}`, position: { x: c.x, y: c.y + size * 0.7 }, size: size * 0.6 },
    ];
    const cutLen = polylineLength(b.cut, true);
    const fold = b.extra.filter((e) => e.kind === 'fold').reduce((s, e) => s + polylineLength(e.points, false), 0);
    return {
      id,
      name,
      quantity: 1,
      color: item.inst.color,
      paths,
      labels,
      bounds: bb,
      areaMm2: Math.abs(polygonArea(b.cut)),
      cutLengthMm: cutLen,
      foldLengthMm: fold,
      meta: {
        'Obvod švu': `${Math.round(polylineLength(b.seam, true))} mm`,
        'Rozmer': `${Math.round(bb.maxX - bb.minX)} × ${Math.round(bb.maxY - bb.minY)} mm`,
        ...(item.crossGrain ? { Poznámka: 'naprieč osnovou' } : {}),
      },
      ...(item.inst.print ? { print: { panel: item.inst.print, matrix: matrixOf((pts) => translatePoints(item.frame(pts), x, y)) } } : {}),
    };
  });

  const area = pieces.reduce((s, x) => s + x.areaMm2, 0);
  const cut = pieces.reduce((s, x) => s + x.cutLengthMm, 0);
  const fold = pieces.reduce((s, x) => s + x.foldLengthMm, 0);
  const legend = Array.from(new Set(pieces.flatMap((x) => x.paths.map((pp) => pp.kind))));
  const fitName = { slim: 'priliehavý', regular: 'klasický', oversized: 'oversized' }[p.fit];
  void drafted.info;
  return {
    productType: 'apparel',
    title: `${tpl.name} · veľkosť ${p.size} · ${fitName} strih`,
    units: 'mm',
    sheet: { width: markerLen, height: fabricW, label: `Látka ${fabricW} mm × ${(markerLen / 1000).toFixed(2)} m` },
    pieces,
    stats: {
      pieceCount: pieces.length,
      totalAreaMm2: area,
      cutLengthMm: cut,
      foldLengthMm: fold,
      sheetWidthMm: markerLen,
      sheetHeightMm: fabricW,
      utilization: area / (markerLen * fabricW),
    },
    legend,
    warnings: Array.from(new Set(warnings)),
  };
}

/** Key finished-garment measurements for the UI. */
export function garmentInfo(params: GarmentParams): Record<string, string> {
  return draftAll(sanitize(params)).info;
}

// ---------------------------------------------------------------------------
// 3D garment (ghost-mannequin style shell)
// ---------------------------------------------------------------------------

export interface GarmentObjectOptions {
  color?: string | null;
  /** print artwork shown on the garment */
  artwork?: ArtworkLayer[];
  /** fold / wrinkle strength multiplier (0 = smooth, 1 = default, 2 = very wrinkled) */
  wrinkles?: number;
  /** show a clothes hanger in the neck (tops only) */
  hanger?: boolean;
}

/** Wrinkle multiplier for the garment currently being built (set by buildGarmentObject). */
let FOLD_K = 1;

/** A tube surface that carries a printable panel. */
interface PrintSurface {
  panel: PanelId;
  geo: THREE.BufferGeometry;
  /** column whose arc position maps to panel x = xOffset */
  refCol: number;
  /** panel y (mm) for a row / vertex */
  mapY: (row: number, pos: THREE.Vector3) => number;
  xOffset?: number;
}

interface Ring {
  c: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  a: number;
  b: number;
  /** fold amplitude in metres */
  fold?: number;
  /** squareness 0 = ellipse, 1 = rounded rectangle */
  square?: number;
}

function ringPoint(r: Ring, theta: number, t: number, seed: number): THREE.Vector3 {
  let cx = Math.cos(theta);
  let sy = Math.sin(theta);
  if (r.square) {
    const e = 1 - r.square * 0.8;
    cx = Math.sign(cx) * Math.pow(Math.abs(cx), e);
    sy = Math.sign(sy) * Math.pow(Math.abs(sy), e);
  }
  const fold = (r.fold ?? 0) * FOLD_K;
  const d = fold * (0.6 * Math.sin(5 * theta + seed + t * 9) + 0.4 * Math.sin(11 * theta + 2.1 * seed + t * 17));
  const k = 1 + d / Math.max(0.02, (r.a + r.b) / 2);
  return r.c.clone().addScaledVector(r.u, r.a * cx * k).addScaledVector(r.v, r.b * sy * k);
}

function tubeGeometry(rings: Ring[], segs = 64, seed = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let dist = 0;
  let prevCenter = rings[0].c;
  const sub = 3;
  const dense: Ring[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i];
    const r1 = rings[i + 1];
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      const ss = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
      dense.push({
        c: r0.c.clone().lerp(r1.c, ss),
        u: r0.u.clone().lerp(r1.u, ss).normalize(),
        v: r0.v.clone().lerp(r1.v, ss).normalize(),
        a: r0.a + (r1.a - r0.a) * ss,
        b: r0.b + (r1.b - r0.b) * ss,
        fold: (r0.fold ?? 0) + ((r1.fold ?? 0) - (r0.fold ?? 0)) * ss,
        square: (r0.square ?? 0) + ((r1.square ?? 0) - (r0.square ?? 0)) * ss,
      });
    }
  }
  dense.push(rings[rings.length - 1]);
  dense.forEach((r, i) => {
    dist += r.c.distanceTo(prevCenter);
    prevCenter = r.c;
    const perim = Math.PI * (3 * (r.a + r.b) - Math.sqrt((3 * r.a + r.b) * (r.a + 3 * r.b)));
    const t = i / (dense.length - 1);
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      const p = ringPoint(r, th, t, seed);
      pos.push(p.x, p.y, p.z);
      uv.push((j / segs) * perim, dist);
    }
  });
  const row = segs + 1;
  for (let i = 0; i < dense.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const dists: number[] = [];
  {
    let acc = 0;
    let prev = dense[0].c;
    for (const r of dense) {
      acc += r.c.distanceTo(prev);
      prev = r.c;
      dists.push(acc);
    }
  }
  g.userData.tube = { rows: dense.length, segs, dist: dists };
  // weld the seam normals (first/last column share position)
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < dense.length; i++) {
    const a = i * row;
    const b = a + segs;
    const nx = n.getX(a) + n.getX(b);
    const ny = n.getY(a) + n.getY(b);
    const nz = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l);
    n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function hRing(y: number, a: number, b: number, fold = 0.002, zOff = 0, xOff = 0): Ring {
  return { c: V(xOff, y, zOff), u: X.clone(), v: Z.clone(), a, b, fold };
}

function ellipseFromCirc(circMm: number, aspect = 1.45): [number, number] {
  const c = circMm / 1000;
  // perimeter ≈ π (a + b) roughly; choose b = a / aspect
  const a = c / (Math.PI * (1 + 1 / aspect));
  return [a, a / aspect];
}

function sleeveRings(start: THREE.Vector3, dir: THREE.Vector3, length: number, r0: number, r1: number, fold: number, cuff: number): Ring[] {
  const u = Z.clone();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const rings: Ring[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = r0 + (r1 - r0) * t;
    rings.push({ c: start.clone().addScaledVector(dir, length * t), u, v, a: r * 0.92, b: r * 1.05, fold: fold * (0.4 + t) });
  }
  if (cuff > 0) {
    const end = start.clone().addScaledVector(dir, length);
    rings.push({ c: end.clone().addScaledVector(dir, 0.004), u, v, a: r1 * 0.75, b: r1 * 0.85, fold: 0 });
    rings.push({ c: end.clone().addScaledVector(dir, cuff), u, v, a: r1 * 0.72, b: r1 * 0.8, fold: 0 });
  }
  return rings;
}

function addMesh(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

function buildTop(group: THREE.Group, p: GarmentParams, mat: THREE.Material, hoodie: boolean, hanger: boolean): PrintSurface[] {
  const surfaces: PrintSurface[] = [];
  const M = measures(p);
  const t = draftTop(M, {
    extraEase: hoodie ? 60 : 0,
    lengthExtra: hoodie ? 40 : 0,
    sleeve: hoodie ? 'long' : p.sleeve,
    frontNeckExtra: hoodie ? 15 : 0,
    hemBand: hoodie ? 60 : 0,
    cuff: hoodie ? 70 : 0,
  });
  const L = t.dims.length / 1000;
  const [ca, cb] = ellipseFromCirc(t.dims.chest);
  const [wa, wb] = ellipseFromCirc(Math.max(M.m.waist + M.ease, t.dims.chest * 0.92));
  const sh = t.dims.shoulder / 2000;
  const ad = t.dims.armhole / 1000;
  const neckR = M.m.neck / 1000 / (2 * Math.PI) * 1.25;
  const looseness = M.ease / 1000;
  const fold = 0.003 + looseness * 0.02;
  const base = hoodie ? 0.06 : 0;
  const rings: Ring[] = [];
  if (hoodie) {
    rings.push(hRing(0, wa * 0.9, wb * 0.92, 0));
    rings.push(hRing(base - 0.004, wa * 0.92, wb * 0.95, 0));
  }
  rings.push(
    hRing(base, wa * 1.02, wb * 1.03, fold),
    hRing(base + (L - base) * 0.35, wa, wb, fold * 1.2),
    hRing(L - ad * 1.05, ca, cb, fold * 0.6),
    hRing(L - ad * 0.45, ca * 0.98, cb * 0.95, fold * 0.3),
    hRing(L - 0.05, sh * 0.98, cb * 0.62, 0),
    hRing(L - 0.012, neckR * 1.45, neckR * 1.15, 0, -0.008),
    hRing(L - 0.004, neckR * 1.05, neckR * 0.92, 0, -0.012),
  );
  const bodyGeo = tubeGeometry(rings, 72, 1.3);
  addMesh(group, bodyGeo, mat);
  // pattern y is measured down from the high shoulder point (≈ top of the tube)
  const mapBodyY = (_row: number, pos: THREE.Vector3) => (L - pos.y) * 1000;
  surfaces.push({ panel: 'front', geo: bodyGeo, refCol: 18, mapY: mapBodyY }, { panel: 'back', geo: bodyGeo, refCol: 54, mapY: mapBodyY });

  // Neck band
  const band = tubeGeometry([hRing(L - 0.006, neckR * 1.05, neckR * 0.92, 0, -0.012), hRing(L + 0.012, neckR * 0.98, neckR * 0.86, 0, -0.014)], 48);
  addMesh(group, band, mat);

  // Sleeves
  const long = hoodie || p.sleeve === 'long';
  const sleeveLen = t.dims.sleeveLen / 1000 - (hoodie ? 0.07 : 0);
  const r0 = t.dims.bicep / 1000 / (2 * Math.PI);
  const r1 = t.sleeveHem / 1000 / (2 * Math.PI);
  for (const s of [-1, 1]) {
    const ang = long ? 0.32 : 0.75;
    const dir = V(s * Math.sin(ang), -Math.cos(ang), 0.02).normalize();
    const start = V(s * (sh - 0.035), L - 0.07 - r0 * 0.6, 0);
    const sg = tubeGeometry(sleeveRings(start, dir, sleeveLen, r0, r1, fold * 0.8, hoodie ? 0.07 : 0), 40, s);
    addMesh(group, sg, mat);
    // the wearer's left sleeve is world +x; its top (cap centre) is at θ = 3π/2, the right sleeve's at π/2
    const dist = sg.userData.tube.dist as number[];
    surfaces.push({ panel: s > 0 ? 'sleeveL' : 'sleeveR', geo: sg, refCol: s > 0 ? 30 : 10, mapY: (row) => dist[row] * 1000 });
  }

  if (hanger) addHanger(group, L, sh, neckR);

  if (hoodie) {
    // hood lying on the back
    const hood = new THREE.SphereGeometry(0.15, 48, 24, Math.PI * 0.15, Math.PI * 1.7, 0, Math.PI * 0.62);
    hood.scale(1.0, 0.85, 1.15);
    const hm = addMesh(group, hood, mat);
    hm.rotation.set(-1.15, Math.PI, 0);
    hm.position.set(0, L + 0.01, -cb * 0.9);
    // kangaroo pocket
    const k = M.m.chest / 980;
    const shape = new THREE.Shape();
    const pw = 0.36 * k;
    const ph = 0.23 * k;
    shape.moveTo(-pw * 0.33, ph);
    shape.lineTo(pw * 0.33, ph);
    shape.lineTo(pw / 2, ph - 0.095 * k);
    shape.lineTo(pw / 2, 0);
    shape.lineTo(-pw / 2, 0);
    shape.lineTo(-pw / 2, ph - 0.095 * k);
    shape.closePath();
    const pg = new THREE.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 });
    const pocket = addMesh(group, pg, mat);
    pocket.position.set(0, base + 0.03, wb * 1.0);
    pocket.rotation.x = -0.05;
    // drawcords
    const cordMat = new THREE.MeshPhysicalMaterial({ color: 0xf5f5f0, roughness: 0.7, sheen: 1, sheenRoughness: 0.5 });
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([V(s * 0.035, L - 0.03, neckR * 1.1), V(s * 0.04, L - 0.12, cb * 0.95), V(s * 0.045, L - 0.24, cb * 1.0)]);
      addMesh(group, new THREE.TubeGeometry(curve, 24, 0.0035, 8), cordMat);
    }
  }
  return surfaces;
}

/** Chrome wire hanger: hook above the neck and a bar hidden inside the shoulders. */
function addHanger(group: THREE.Group, L: number, sh: number, neckR: number) {
  const metal = new THREE.MeshPhysicalMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.22 });
  const wood = new THREE.MeshPhysicalMaterial({ color: 0x8a5a36, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  const z = -neckR * 0.35;
  // hook: a 3/4 circle opening to the front-left
  const hookR = 0.034;
  const hook = new THREE.TorusGeometry(hookR, 0.0026, 10, 48, Math.PI * 1.45);
  const hm = addMesh(group, hook, metal);
  hm.rotation.z = -Math.PI * 0.42;
  hm.position.set(-hookR * 0.15, L + 0.075, z);
  // stem from the hook down into the neck
  const stem = new THREE.CylinderGeometry(0.0026, 0.0026, 0.07, 10);
  const st = addMesh(group, stem, metal);
  st.position.set(0, L + 0.03, z);
  // wooden bar sitting just under the shoulder line
  const bar = new THREE.CatmullRomCurve3([V(-sh * 0.92, L - 0.06, z), V(-sh * 0.45, L - 0.03, z), V(0, L - 0.012, z), V(sh * 0.45, L - 0.03, z), V(sh * 0.92, L - 0.06, z)]);
  addMesh(group, new THREE.TubeGeometry(bar, 48, 0.008, 10), wood);
}

/**
 * Transparent overlay mesh that follows a tube surface and shows a panel texture.
 * Columns are mapped to panel x by arc length around the ring, rows to panel y.
 */
function printOverlay(s: PrintSurface, tex: PanelTexture): THREE.Mesh {
  const { rows, segs } = s.geo.userData.tube as { rows: number; segs: number };
  const cols = segs + 1;
  const pos = s.geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = s.geo.getAttribute('normal') as THREE.BufferAttribute;
  const b = tex.bounds;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const outPos = new Float32Array(rows * cols * 3);
  const outNrm = new Float32Array(rows * cols * 3);
  const outUv = new Float32Array(rows * cols * 2);
  const px = new Float32Array(rows * cols);
  const py = new Float32Array(rows * cols);
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  const arc = new Float64Array(cols);
  let perim = 0;
  for (let r = 0; r < rows; r++) {
    arc[0] = 0;
    for (let j = 1; j < cols; j++) {
      a.fromBufferAttribute(pos, r * cols + j - 1);
      c.fromBufferAttribute(pos, r * cols + j);
      arc[j] = arc[j - 1] + a.distanceTo(c);
    }
    perim = Math.max(perim, arc[segs]);
    const P = arc[segs];
    for (let j = 0; j < cols; j++) {
      const i = r * cols + j;
      let rel = arc[s.refCol] - arc[j];
      if (rel > P / 2) rel -= P;
      if (rel < -P / 2) rel += P;
      a.fromBufferAttribute(pos, i);
      c.fromBufferAttribute(nrm, i);
      const x = (s.xOffset ?? 0) + rel * 1000;
      const y = s.mapY(r, a);
      px[i] = x;
      py[i] = y;
      outPos[i * 3] = a.x + c.x * 0.0009;
      outPos[i * 3 + 1] = a.y + c.y * 0.0009;
      outPos[i * 3 + 2] = a.z + c.z * 0.0009;
      outNrm[i * 3] = c.x;
      outNrm[i * 3 + 1] = c.y;
      outNrm[i * 3 + 2] = c.z;
      outUv[i * 2] = (x - b.minX) / bw;
      outUv[i * 2 + 1] = 1 - (y - b.minY) / bh;
    }
  }
  const idx: number[] = [];
  const jump = perim * 250; // a quarter of the circumference in mm: a triangle across the wrap
  const out = (i: number) => px[i] < b.minX || px[i] > b.maxX || py[i] < b.minY || py[i] > b.maxY;
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < segs; j++) {
      const i0 = r * cols + j;
      const i1 = i0 + 1;
      const i2 = i0 + cols;
      const i3 = i2 + 1;
      const xs = [px[i0], px[i1], px[i2], px[i3]];
      if (Math.max(...xs) - Math.min(...xs) > jump) continue;
      if (out(i0) && out(i1) && out(i2) && out(i3)) continue;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(outNrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(outUv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, createInkMaterial(tex.texture));
  m.name = `print-${s.panel}`;
  m.renderOrder = 1;
  m.receiveShadow = true;
  return m;
}

function buildTrousers(group: THREE.Group, p: GarmentParams, mat: THREE.Material) {
  const M = measures(p);
  const d = draftTrousers(M).dims;
  const Lt = (d.rise + d.inseam) / 1000;
  const rise = d.rise / 1000;
  const [wa, wb] = ellipseFromCirc(d.waist, 1.3);
  const [ha, hb] = ellipseFromCirc(d.hip, 1.3);
  addMesh(
    group,
    tubeGeometry([hRing(Lt + 0.04, wa, wb, 0), hRing(Lt, wa, wb, 0.001), hRing(Lt - rise * 0.5, ha, hb, 0.003), hRing(Lt - rise - 0.02, ha * 0.98, hb * 1.0, 0.003)], 64),
    mat,
  );
  const thighR = (d.hip * 0.6) / 1000 / (2 * Math.PI);
  const hemR = d.hemCirc / 1000 / (2 * Math.PI);
  for (const s of [-1, 1]) {
    const x0 = s * ha * 0.5;
    const rings: Ring[] = [
      hRing(Lt - rise * 0.55, thighR * 1.05, thighR, 0.002, 0, x0),
      hRing(Lt - rise - 0.04, thighR, thighR * 0.98, 0.003, 0, x0 * 1.02),
      hRing(Lt * 0.45, hemR * 1.06, hemR * 1.0, 0.004, 0, x0 * 1.08 + s * 0.01),
      hRing(0.04, hemR * 1.02, hemR, 0.006, 0, x0 * 1.12 + s * 0.015),
      hRing(0, hemR * 1.02, hemR * 1.0, 0.005, 0, x0 * 1.12 + s * 0.015),
    ];
    addMesh(group, tubeGeometry(rings, 48, s * 2), mat);
  }
}

function buildSkirt(group: THREE.Group, p: GarmentParams, mat: THREE.Material) {
  const M = measures(p);
  const d = draftSkirt(M).dims;
  const L = d.length / 1000;
  const [wa, wb] = ellipseFromCirc(d.waist, 1.3);
  const [ha, hb] = ellipseFromCirc((M.m.hip + 60), 1.3);
  const [ea, eb] = ellipseFromCirc(d.hem, 1.15);
  addMesh(
    group,
    tubeGeometry(
      [
        hRing(L + 0.035, wa, wb, 0),
        hRing(L, wa, wb, 0),
        hRing(L - 0.19, ha, hb, 0.004),
        hRing(L * 0.4, (ha + ea) / 2, (hb + eb) / 2, 0.018),
        hRing(0, ea, eb, 0.03),
      ],
      96,
      0.7,
    ),
    mat,
  );
}

function buildTote(group: THREE.Group, p: GarmentParams, mat: THREE.Material): PrintSurface[] {
  const M = measures(p);
  const w = TOTE.w / 2000;
  const dpt = TOTE.box / 1000;
  const h = (TOTE.h + M.lenAdj) / 1000;
  const r = (y: number, fold: number): Ring => ({ c: V(0, y, 0), u: X.clone(), v: Z.clone(), a: w, b: dpt, fold, square: 1 });
  const bodyGeo = tubeGeometry([r(0.003, 0), r(h * 0.5, 0.002), r(h, 0.003)], 96, 0.4);
  addMesh(group, bodyGeo, mat);
  const mapY = (_row: number, pos: THREE.Vector3) => (h - pos.y) * 1000;
  const xOffset = (TOTE.w + TOTE.box * 2) / 2;
  const bottom = new THREE.Shape();
  bottom.moveTo(-w, -dpt);
  bottom.lineTo(w, -dpt);
  bottom.lineTo(w, dpt);
  bottom.lineTo(-w, dpt);
  bottom.closePath();
  const bg = new THREE.ShapeGeometry(bottom);
  bg.rotateX(Math.PI / 2);
  bg.translate(0, 0.003, 0);
  addMesh(group, bg, mat);
  for (const s of [-1, 1]) {
    const z = s * dpt * 0.98;
    const curve = new THREE.CatmullRomCurve3([V(-w * 0.45, h - 0.03, z), V(-w * 0.5, h + 0.18, z * 1.2), V(0, h + 0.3, z * 1.3), V(w * 0.5, h + 0.18, z * 1.2), V(w * 0.45, h - 0.03, z)]);
    const strap = new THREE.TubeGeometry(curve, 48, 0.006, 12);
    strap.scale(1, 1, 1);
    addMesh(group, strap, mat);
  }
  return [
    { panel: 'front', geo: bodyGeo, refCol: 24, mapY, xOffset },
    { panel: 'back', geo: bodyGeo, refCol: 72, mapY, xOffset },
  ];
}

/** Build a 3D draped preview of the sewn garment. */
export function buildGarmentObject(params: GarmentParams, materialId: string, options: GarmentObjectOptions): THREE.Object3D {
  const p = sanitize(params);
  const mat = createPhysicalMaterial(materialId, options.color, 1);
  const outer = new THREE.Group();
  outer.name = 'garment';
  const group = new THREE.Group();
  outer.add(group);
  FOLD_K = Math.max(0, Math.min(3, options.wrinkles ?? 1));
  let surfaces: PrintSurface[] = [];
  switch (p.garment) {
    case 'hoodie':
      surfaces = buildTop(group, p, mat, true, !!options.hanger);
      break;
    case 'trousers':
      buildTrousers(group, p, mat);
      break;
    case 'skirt':
      buildSkirt(group, p, mat);
      break;
    case 'tote':
      surfaces = buildTote(group, p, mat);
      break;
    default:
      surfaces = buildTop(group, p, mat, false, !!options.hanger);
  }
  FOLD_K = 1;

  // printed artwork: one transparent overlay per panel, redrawn in place when layers change
  const prints: { tex: PanelTexture; meshes: THREE.Mesh[] }[] = [];
  if (surfaces.length) {
    for (const panel of getPrintPanels(p)) {
      const own = surfaces.filter((s) => s.panel === panel.id);
      if (!own.length) continue;
      const tex = createPanelTexture(panel.id, panel.bounds, panel.seam);
      const meshes = own.map((s) => printOverlay(s, tex));
      meshes.forEach((m) => group.add(m));
      prints.push({ tex, meshes });
    }
  }
  const updateArtwork = (layers: ArtworkLayer[]) => {
    for (const pr of prints) {
      const any = pr.tex.redraw(layers);
      for (const m of pr.meshes) m.visible = any;
    }
  };
  updateArtwork(options.artwork ?? []);
  outer.userData.updateArtwork = updateArtwork;
  outer.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const c = box.getCenter(new THREE.Vector3());
  group.position.set(-c.x, -box.min.y + 0.002, -c.z);
  outer.userData.kind = 'garment';
  return outer;
}
