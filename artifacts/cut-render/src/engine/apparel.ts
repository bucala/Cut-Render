import * as THREE from 'three';
import type { CutPlan, PlanLabel, PlanPath, PlanPiece, Point } from './types';
import { bezier, boundsOf, centroid, mirrorX, pieceColor, polygonArea, polylineLength, rotatePoints, translatePoints } from './geom';
import { createPhysicalMaterial } from './materials';
import { distToSegs, meshRegion, pointInPolygon, roundProfile, segsOf, smoothstep, type RegionMesh } from './garmentMesh';
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

function addMesh(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/** Print surface on a pattern-built mesh: every vertex carries its panel coordinates (mm). */
interface MeshPrintSurface {
  panel: PanelId;
  geo: THREE.BufferGeometry;
  px: Float32Array;
  py: Float32Array;
  /** triangles (vertex indices) that belong to this panel */
  tris: number[];
}

const REGION_BODY = 0;
const REGION_SLEEVE_POS = 1; // world +x: the wearer's left sleeve
const REGION_SLEEVE_NEG = 2; // world -x: the wearer's right sleeve
const REGION_BAND = 3;
const REGION_CUFF = 4;

/**
 * Tops (T-shirt, hoodie) built straight from the drafted pattern: the front and back pieces
 * with both sleeves sewn into the armholes form one flat silhouette that is meshed and lifted
 * into a front and a back layer. Silhouette, neckline, sleeve length and hem width are exactly
 * the ones in the cut plan, and the sleeves are part of the same surface as the body.
 */
function buildTop(group: THREE.Group, p: GarmentParams, mat: THREE.Material, hoodie: boolean, hanger: boolean): MeshPrintSurface[] {
  const M = measures(p);
  const hemBand = hoodie ? 60 : 0;
  const cuffH = hoodie ? 70 : 0;
  const t = draftTop(M, {
    extraEase: hoodie ? 60 : 0,
    lengthExtra: hoodie ? 40 : 0,
    sleeve: hoodie ? 'long' : p.sleeve,
    frontNeckExtra: hoodie ? 15 : 0,
    hemBand,
    cuff: cuffH,
  });
  const F = t.front.edges;
  const neckF = F[0].pts;
  const neckB = t.back.edges[0].pts;
  const shoulderR = F[1].pts;
  const armR = F[2].pts;
  const sideR = F[3].pts;
  const hemPts = F[4].pts;
  const SP = armR[0];
  const UP = armR[armR.length - 1];
  const nw = shoulderR[0].x;
  const corner = sideR[sideR.length - 1];
  const ad = UP.y;
  const hemY = corner.y;
  const yBot = hemY + hemBand + 8;
  const mirP = (q: Point): Point => ({ x: -q.x, y: q.y });

  // ---- sleeve placement: half the sleeve piece (front layer), folded along its centre line ----
  const seamS = t.sleeve.edges[1].pts;
  const bw2 = seamS[0].x;
  const ch = seamS[0].y;
  const hw2 = seamS[1].x;
  const sLen = seamS[1].y;
  const cuffHalf = hw2 * 0.82;
  const sEnd = sLen + cuffH;
  // orient the sleeve so its cap chord (top -> underarm) lies along the armhole chord SP -> UP
  const chordL = Math.hypot(UP.x - SP.x, UP.y - SP.y);
  const ux = (UP.x - SP.x) / chordL;
  const uy = (UP.y - SP.y) / chordL;
  const capL = Math.hypot(bw2, ch);
  const cosL = bw2 / capL;
  const sinL = ch / capL;
  let wx = uy;
  let wy = -ux;
  if (sinL * ux + cosL * wx < 0) {
    wx = -wx;
    wy = -wy;
  }
  const dX = sinL * ux + cosL * wx; // along the sleeve (cap -> hem)
  const dY = sinL * uy + cosL * wy;
  const nX = cosL * ux - sinL * wx; // across the sleeve (fold -> underarm seam)
  const nY = cosL * uy - sinL * wy;
  // the cap is eased into the armhole: pull the underarm corner onto UP, fading out toward the hem
  const eX = UP.x - (SP.x + ux * capL);
  const eY = UP.y - (SP.y + uy * capL);
  const ease = (yl: number) => (yl <= ch ? 1 : 1 - smoothstep(ch, sLen, yl));
  const warp = (xl: number, yl: number): Point => {
    const w = (xl / bw2) * ease(yl);
    return { x: SP.x + nX * xl + dX * yl + eX * w, y: SP.y + nY * xl + dY * yl + eY * w };
  };
  const unwarp = (q: Point): [number, number] => {
    let xl = (q.x - SP.x) * nX + (q.y - SP.y) * nY;
    let yl = (q.x - SP.x) * dX + (q.y - SP.y) * dY;
    for (let it = 0; it < 10; it++) {
      const f = warp(xl, yl);
      const ex = f.x - q.x;
      const ey = f.y - q.y;
      if (ex * ex + ey * ey < 1e-6) break;
      const fx = warp(xl + 0.5, yl);
      const fy = warp(xl, yl + 0.5);
      const a = (fx.x - f.x) / 0.5;
      const b = (fy.x - f.x) / 0.5;
      const c = (fx.y - f.y) / 0.5;
      const d = (fy.y - f.y) / 0.5;
      const det = a * d - b * c || 1;
      xl -= (d * ex - b * ey) / det;
      yl -= (-c * ex + a * ey) / det;
    }
    return [xl, yl];
  };

  const foldR: Point[] = cuffH ? [SP, warp(0, sLen), warp(0, sEnd)] : [SP, warp(0, sEnd)];
  const endHalf = cuffH ? cuffHalf : hw2;
  const endR: Point[] = [];
  for (let i = 0; i <= 8; i++) endR.push(warp((endHalf * i) / 8, sEnd));
  const underR: Point[] = [];
  if (cuffH) underR.push(warp(cuffHalf, sEnd), warp(cuffHalf, sLen + 10));
  for (let i = 0; i <= 18; i++) {
    const k = i / 18;
    underR.push(i === 18 ? UP : warp(hw2 + (bw2 - hw2) * k, sLen + (ch - sLen) * k));
  }
  const sleeveHemR: Point[] = [];
  if (cuffH) for (let i = 0; i <= 8; i++) sleeveHemR.push(warp((hw2 * i) / 8, sLen));
  const sleeveOut = concat(foldR, endR, underR);

  const bandHalf = corner.x * 0.85;
  const bandSideR: Point[] = [corner, { x: bandHalf, y: hemY + hemBand }];
  const bottom: Point[] = hemBand ? [corner, { x: bandHalf, y: hemY + hemBand }, { x: 0, y: hemY + hemBand }, { x: -bandHalf, y: hemY + hemBand }, mirP(corner)] : hemPts;

  const closeLoop = (pts: Point[]) => {
    const f = pts[0];
    const l = pts[pts.length - 1];
    return Math.hypot(f.x - l.x, f.y - l.y) < 1e-6 ? pts.slice(0, -1) : pts;
  };
  const outlineFor = (neck: Point[]) =>
    closeLoop(concat(neck, shoulderR, sleeveOut, sideR, bottom, mir(rev(sideR)), rev(sleeveOut).map(mirP), mir(rev(shoulderR))));
  const bodyPolyFor = (neck: Point[]) => closeLoop(concat(neck, shoulderR, armR, sideR, hemPts, mir(rev(sideR)), mir(rev(armR)), mir(rev(shoulderR))));
  const bandPoly = hemBand ? [...bottom, ...rev(hemPts).slice(1, -1)] : [];

  const constraints: Point[][] = [armR, mir(rev(armR))];
  if (hemBand) constraints.push(hemPts);
  if (cuffH) constraints.push(sleeveHemR, mir(sleeveHemR));

  // ---- depth of the two layers ----
  const closedSegs = segsOf([
    shoulderR, mir(shoulderR), foldR, mir(foldR), underR, mir(underR), sideR, mir(sideR),
    ...(hemBand ? [bandSideR, mir(bandSideR)] : []),
  ]);
  const creaseSegs = segsOf(constraints);
  const H = hoodie ? 34 : 28; // half depth of the body on the hanger (mm)
  const RD = 70; // width of the rounded roll at the closed seams (mm)
  const sleeveLocal = (q: Point): [number, number] => unwarp(q.x >= 0 ? q : mirP(q));
  /** distance of a layer from the mid-plane, in mm (front: +z, back: -z) */
  const depth = (q: Point, back: boolean, inBody: boolean): number => {
    const d = distToSegs(q.x, q.y, closedSegs);
    const ty = Math.min(1, Math.max(0, (q.y - ad) / (yBot - ad)));
    let z = H * (1 - 0.25 * ty) * roundProfile(d / RD);
    z *= 1 - 0.12 * Math.exp(-((distToSegs(q.x, q.y, creaseSegs) / 7) ** 2));
    let fold: number;
    if (inBody) {
      const ph = back ? 1.7 : 0;
      const w = 0.6 * Math.sin((2 * Math.PI * q.x) / 170 + 0.8 + ph + q.y * 0.002) + 0.4 * Math.sin((2 * Math.PI * q.x) / 83 + 2.1 + ph * 1.3 + q.y * 0.004);
      fold = w * 3.4 * (0.15 + 0.85 * smoothstep(ad * 0.7, yBot, q.y));
    } else {
      const [xl, yl] = sleeveLocal(q);
      fold = Math.sin(yl / 26 + (back ? 1.1 : 0) + xl * 0.012) * 1.6 * smoothstep(ch * 0.5, sLen, yl);
    }
    return z + fold * FOLD_K * smoothstep(0, 45, d);
  };

  const topW = yBot + 10; // world y (mm) of the pattern origin (high shoulder point)
  const toWorld = (q: Point, z: number) => V(q.x / 1000, (topW - q.y) / 1000, z / 1000);
  const surfaces: MeshPrintSurface[] = [];

  const makeLayer = (neck: Point[], back: boolean) => {
    const outline = outlineFor(neck);
    const mesh = meshRegion(outline, constraints, 10);
    const bodyPoly = bodyPolyFor(neck);
    const n = mesh.pts.length;
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const sgn = back ? -1 : 1;
    mesh.pts.forEach((q, i) => {
      const z = sgn * depth(q, back, pointInPolygon(q.x, q.y, bodyPoly));
      const v = toWorld(q, z);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      uv[i * 2] = q.x / 1000;
      uv[i * 2 + 1] = -q.y / 1000;
    });
    // orient every triangle outward (front faces +z, back faces -z) and sort them by panel
    const tris = mesh.tris;
    const region: number[] = [];
    for (let k = 0; k < tris.length; k += 3) {
      const a = mesh.pts[tris[k]];
      const b = mesh.pts[tris[k + 1]];
      const c = mesh.pts[tris[k + 2]];
      // world y = -pattern y, so a positive pattern-space area means clockwise in world space
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if ((area > 0) !== back) {
        const tmp = tris[k + 1];
        tris[k + 1] = tris[k + 2];
        tris[k + 2] = tmp;
      }
      const cx = (a.x + b.x + c.x) / 3;
      const cy = (a.y + b.y + c.y) / 3;
      let r = REGION_BODY;
      if (!pointInPolygon(cx, cy, bodyPoly)) {
        if (hemBand && pointInPolygon(cx, cy, bandPoly)) r = REGION_BAND;
        else {
          r = cx >= 0 ? REGION_SLEEVE_POS : REGION_SLEEVE_NEG;
          if (cuffH && sleeveLocal({ x: cx, y: cy })[1] > sLen) r = REGION_CUFF;
        }
      }
      region.push(r);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(tris);
    geo.computeVertexNormals();
    addMesh(group, geo, mat);

    // panel coordinates for the printed artwork
    const pick = (want: number) => {
      const out: number[] = [];
      region.forEach((r, k) => {
        if (r === want) out.push(tris[k * 3], tris[k * 3 + 1], tris[k * 3 + 2]);
      });
      return out;
    };
    const bx = new Float32Array(n);
    const by = new Float32Array(n);
    mesh.pts.forEach((q, i) => {
      bx[i] = back ? -q.x : q.x;
      by[i] = q.y;
    });
    surfaces.push({ panel: back ? 'back' : 'front', geo, px: bx, py: by, tris: pick(REGION_BODY) });
    for (const [want, panel] of [[REGION_SLEEVE_POS, 'sleeveL'], [REGION_SLEEVE_NEG, 'sleeveR']] as const) {
      const tr = pick(want);
      if (!tr.length) continue;
      const sx = new Float32Array(n);
      const sy = new Float32Array(n);
      // sleeve pieces are seen from the outside: keep the artwork readable on both layers
      const flip = (want === REGION_SLEEVE_POS) !== back ? -1 : 1;
      for (const i of new Set(tr)) {
        const [xl, yl] = sleeveLocal(mesh.pts[i]);
        sx[i] = flip * xl;
        sy[i] = yl;
      }
      surfaces.push({ panel, geo, px: sx, py: sy, tris: tr });
    }
  };
  makeLayer(neckF, false);
  makeLayer(neckB, true);

  // ---- neckline: rib band (T-shirt) or the rim where the hood is sewn in (hoodie) ----
  const loop: THREE.Vector3[] = [];
  for (const q of neckF) loop.push(toWorld(q, depth(q, false, true)));
  for (const q of rev(neckB).slice(1, -1)) loop.push(toWorld(q, -depth(q, true, true)));
  addMesh(group, neckBand(loop, hoodie ? 0.032 : 0.022, hoodie ? 0.4 : 0.16), mat);

  if (hoodie) {
    const k = M.m.chest / 980;
    // hood laid down over the back: a padded two-layer shield hanging from the back neckline
    const hk = Math.sqrt(k);
    const hd = 360 * hk * 0.9;
    const top = nw + 18;
    const wide = nw + 105 * hk;
    const hoodOutline = closeLoop(
      concat(
        [{ x: -top, y: 6 }, { x: 0, y: 6 }, { x: top, y: 6 }],
        bezier({ x: top, y: 6 }, { x: wide + 30, y: hd * 0.25 }, { x: wide + 10, y: hd * 0.82 }, { x: 0, y: hd }, 16),
        bezier({ x: 0, y: hd }, { x: -wide - 10, y: hd * 0.82 }, { x: -wide - 30, y: hd * 0.25 }, { x: -top, y: 6 }, 16),
      ),
    );
    const hoodEdge = segsOf([[...hoodOutline.slice(2), hoodOutline[0]]]);
    const hm = meshRegion(hoodOutline, [[{ x: 0, y: 6 }, { x: 0, y: hd }]], 10);
    const hpos: number[] = [];
    for (const q of hm.pts) {
      const lift = 22 * roundProfile(distToSegs(q.x, q.y, hoodEdge) / 45) * (1 - 0.2 * Math.exp(-((q.x / 8) ** 2)));
      const v = toWorld(q, -depth(q, true, true) - 3 - lift);
      hpos.push(v.x, v.y, v.z);
    }
    addMesh(group, layerGeometry(hm, hpos, true), mat);

    // kangaroo pocket stitched onto the front, open along the slanted edges
    const pw = 360 * k;
    const pb = hemY - 25;
    const pt = pb - 230 * k;
    const P = [
      { x: -pw * 0.33, y: pt }, { x: pw * 0.33, y: pt }, { x: pw / 2, y: pt + 95 * k }, { x: pw / 2, y: pb },
      { x: -pw / 2, y: pb }, { x: -pw / 2, y: pt + 95 * k },
    ];
    const pocketSewn = segsOf([[P[5], P[0], P[1]], [P[2], P[3], P[4], P[5]]]);
    const pm = meshRegion(P, [], 9);
    const ppos: number[] = [];
    for (const q of pm.pts) {
      const v = toWorld(q, depth(q, false, true) + 1.2 + 2.6 * roundProfile(distToSegs(q.x, q.y, pocketSewn) / 12));
      ppos.push(v.x, v.y, v.z);
    }
    addMesh(group, layerGeometry(pm, ppos, false), mat);

    // drawcords hanging from the hood rim
    const cordMat = new THREE.MeshPhysicalMaterial({ color: 0xf5f5f0, roughness: 0.7, sheen: 1, sheenRoughness: 0.5 });
    const neckDepth = neckF.reduce((m, q) => Math.max(m, q.y), 0);
    for (const s of [-1, 1]) {
      const pts = [0, 0.35, 0.7, 1].map((f) => {
        const q = { x: s * (32 + f * 8), y: neckDepth - 8 + f * 230 };
        return toWorld(q, depth(q, false, true) + 4 + (pointInPolygon(q.x, q.y, P) ? 3.8 : 0));
      });
      addMesh(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.0032, 8), cordMat);
      const tip = new THREE.CylinderGeometry(0.0036, 0.0036, 0.022, 10);
      addMesh(group, tip, cordMat).position.copy(pts[3]).add(V(0, -0.01, 0));
    }
  }

  if (hanger) {
    const slope = (SP.y - shoulderR[0].y) / (SP.x - nw);
    addHanger(group, topW / 1000, nw / 1000, SP.x / 1000, slope);
  }
  return surfaces;
}

/** Mesh a meshRegion result with given world positions; outward = -z when `back`. */
function layerGeometry(m: RegionMesh, pos: number[], back: boolean): THREE.BufferGeometry {
  const tris = [...m.tris];
  for (let k = 0; k < tris.length; k += 3) {
    const a = m.pts[tris[k]];
    const b = m.pts[tris[k + 1]];
    const c = m.pts[tris[k + 2]];
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if ((area > 0) !== back) {
      const tmp = tris[k + 1];
      tris[k + 1] = tris[k + 2];
      tris[k + 2] = tmp;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(m.pts.flatMap((q) => [q.x / 1000, -q.y / 1000]), 2));
  g.setIndex(tris);
  g.computeVertexNormals();
  return g;
}

/**
 * Folded rib band around a closed neckline loop: rises from the seam, rolls over at the top
 * edge and comes back down on the inside.
 */
function neckBand(loop: THREE.Vector3[], height: number, tilt: number): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0, 0], [0.45, 0], [0.8, 0.0003], [0.96, 0.0011], [1, 0.0022], [0.95, 0.0033], [0.7, 0.0038], [0, 0.0038],
  ];
  const n = loop.length;
  const cols = prof.length;
  const pos: number[] = [];
  const uv: number[] = [];
  let run = 0;
  for (let i = 0; i <= n; i++) {
    const P = loop[i % n];
    if (i > 0) run += P.distanceTo(loop[i - 1]);
    const m = V(-P.x, 0, -P.z);
    if (m.lengthSq() < 1e-10) m.set(0, 0, -1);
    m.normalize();
    const up = V(0, 1, 0).addScaledVector(m, tilt).normalize();
    for (const [s, r] of prof) {
      pos.push(P.x + up.x * s * height + m.x * r, P.y + up.y * s * height + m.y * r, P.z + up.z * s * height + m.z * r);
      uv.push(run, s * height);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Wooden clothes hanger: a flat, lacquered body following the shoulder slope just under the
 * shoulder seams, and a chrome "?" hook in the same plane rising out of the neck opening
 * (as on a real hanger, the hook and the body are coplanar).
 */
function addHanger(group: THREE.Group, hpsY: number, nw: number, sh: number, slope: number) {
  const metal = new THREE.MeshPhysicalMaterial({ color: 0xd4d8de, metalness: 1, roughness: 0.18 });
  const wood = new THREE.MeshPhysicalMaterial({ color: 0x9a6438, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const zc = 0;
  const thick = 0.011;

  // --- wooden body (profile in the XY plane, extruded along z) ---
  const half = sh - 0.025;
  const topC = hpsY - 0.007; // just under the high shoulder point
  const topY = (x: number) => topC - slope * Math.max(0, Math.abs(x) - nw);
  const depthAt = (x: number) => 0.036 - 0.014 * (Math.abs(x) / half); // taller in the middle
  const shape = new THREE.Shape();
  const n = 24;
  const endR = depthAt(half) / 2;
  shape.moveTo(-half, topY(-half));
  for (let i = 1; i <= n; i++) {
    const x = -half + (2 * half * i) / n;
    shape.lineTo(x, topY(x));
  }
  shape.quadraticCurveTo(half + endR * 1.1, topY(half) - endR, half, topY(half) - depthAt(half));
  for (let i = n - 1; i >= 0; i--) {
    const x = -half + (2 * half * i) / n;
    shape.lineTo(x, topY(x) - depthAt(x));
  }
  shape.quadraticCurveTo(-half - endR * 1.1, topY(-half) - endR, -half, topY(-half));
  const bevel = 0.0025;
  const bodyGeo = new THREE.ExtrudeGeometry(shape, {
    depth: thick - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 12,
  });
  bodyGeo.translate(0, 0, zc - (thick - 2 * bevel) / 2);
  bodyGeo.computeVertexNormals();
  addMesh(group, bodyGeo, wood);

  // --- chrome ferrule where the hook enters the wood ---
  const ferrule = new THREE.CylinderGeometry(0.0048, 0.0058, 0.012, 16);
  addMesh(group, ferrule, metal).position.set(0, topC + 0.005, zc);

  // --- hook: straight stem, then a "?" curl over to one side ending in a ball tip ---
  const wire = 0.0026;
  const R = 0.026;
  const stemTop = hpsY + 0.05;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) pts.push(V(0, topC + ((stemTop - topC) * i) / 8, zc));
  const endA = Math.PI * 1.22;
  for (let i = 1; i <= 40; i++) {
    const a = (endA * i) / 40;
    pts.push(V(-R + R * Math.cos(a), stemTop + R * Math.sin(a), zc));
  }
  const hookCurve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  addMesh(group, new THREE.TubeGeometry(hookCurve, 96, wire, 12), metal);
  const tip = pts[pts.length - 1];
  addMesh(group, new THREE.SphereGeometry(wire * 1.35, 16, 12), metal).position.copy(tip);
}

/** Transparent overlay that carries a panel texture on a pattern-built garment mesh. */
function meshPrintOverlay(s: MeshPrintSurface, tex: PanelTexture): THREE.Mesh {
  const pos = s.geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = s.geo.getAttribute('normal') as THREE.BufferAttribute;
  const used = [...new Set(s.tris)];
  const remap = new Map<number, number>();
  const b = tex.bounds;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const outPos = new Float32Array(used.length * 3);
  const outNrm = new Float32Array(used.length * 3);
  const outUv = new Float32Array(used.length * 2);
  used.forEach((v, i) => {
    remap.set(v, i);
    const nx = nrm.getX(v);
    const ny = nrm.getY(v);
    const nz = nrm.getZ(v);
    outPos[i * 3] = pos.getX(v) + nx * 0.0009;
    outPos[i * 3 + 1] = pos.getY(v) + ny * 0.0009;
    outPos[i * 3 + 2] = pos.getZ(v) + nz * 0.0009;
    outNrm[i * 3] = nx;
    outNrm[i * 3 + 1] = ny;
    outNrm[i * 3 + 2] = nz;
    outUv[i * 2] = (s.px[v] - b.minX) / bw;
    outUv[i * 2 + 1] = 1 - (s.py[v] - b.minY) / bh;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(outNrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(outUv, 2));
  g.setIndex(s.tris.map((v) => remap.get(v)!));
  const m = new THREE.Mesh(g, createInkMaterial(tex.texture));
  m.name = `print-${s.panel}`;
  m.renderOrder = 1;
  m.receiveShadow = true;
  return m;
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
  let surfaces: (PrintSurface | MeshPrintSurface)[] = [];
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
      const meshes = own.map((s) => ('tris' in s ? meshPrintOverlay(s, tex) : printOverlay(s, tex)));
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
