import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hangerHeight, settleCloth, type ClothPanel } from './cloth-drape';
import { applyFabricDetail } from './fabric-detail';
import type { CutPlan, PlanLabel, PlanPath, PlanPiece, Point } from './types';
import { bezier, boundsOf, centroid, mirrorX, pieceColor, polygonArea, polylineLength, rotatePoints, translatePoints } from './geom';
import { createPhysicalMaterial } from './materials';
import { cavityShade, distToSegs, meshRegion, pointInPolygon, roundProfile, segsOf, smoothstep, type RegionMesh } from './garmentMesh';
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
// 3D garment: flat-lay shells lifted straight from the drafted pattern
// ---------------------------------------------------------------------------

export interface GarmentObjectOptions {
  color?: string | null;
  /** print artwork shown on the garment */
  artwork?: ArtworkLayer[];
  /** fold / wrinkle strength multiplier (0 = smooth, 1 = default, 2 = very wrinkled) */
  wrinkles?: number;
  /** show a clothes hanger in the neck (tops only) */
  hanger?: boolean;
  hangerFinish?: 'white' | 'birch';
  knitSize?: number;
  fabricStrength?: number;
  sheen?: number;
}

/** Wrinkle multiplier for the garment currently being built (set by buildGarmentObject). */
let FOLD_K = 1;

/** Print surface on a pattern-built mesh: every vertex carries its panel coordinates (mm). */
interface MeshPrintSurface {
  panel: PanelId;
  geo: THREE.BufferGeometry;
  px: Float32Array;
  py: Float32Array;
  /** triangles (vertex indices) that belong to this panel */
  tris: number[];
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function addMesh(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material) {
  if (!geo.getAttribute('color')) {
    // the fabric material uses baked vertex shading; parts without it are plain white
    // (RGBA: the path tracer merges 3-component colour attributes incorrectly)
    const n = geo.getAttribute('position').count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 4));
  }
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/**
 * A garment shell is described in the drafting frame (mm, y down): the flat silhouette of the
 * sewn pieces, the seams where the front and back layers meet (closed, z = 0) and the seams
 * that only leave a crease. Everything else (hem, neckline, cuffs) stays open.
 */
interface ShellSpec {
  outline: Point[];
  constraints: Point[][];
  closed: SegList;
  creases: SegList;
  /** half thickness of the hanging garment (mm) */
  depth: number;
  /** width of the rounded roll at the closed seams (mm) */
  roll: number;
  /** position-dependent depth multiplier */
  profile: (q: Point) => number;
  /** wrinkle displacement (mm, already excluding FOLD_K) */
  fold: (q: Point, back: boolean) => number;
  /** world y (mm) of pattern y = 0 */
  topW: number;
  step?: number;
}

interface ShellLayer {
  mesh: RegionMesh;
  z: Float32Array;
  geo: THREE.BufferGeometry;
}

type SegList = Float64Array;

/** unsigned distance of a layer from the mid-plane (mm) */
function shellDepth(s: ShellSpec, q: Point, back: boolean): number {
  const d = distToSegs(q.x, q.y, s.closed);
  let z = s.depth * s.profile(q) * roundProfile(d / s.roll);
  if (s.creases.length) z *= 1 - 0.12 * Math.exp(-((distToSegs(q.x, q.y, s.creases) / 7) ** 2));
  return z + s.fold(q, back) * FOLD_K * smoothstep(0, 45, d);
}

function shellWorld(s: ShellSpec, q: Point, z: number): THREE.Vector3 {
  return V(q.x / 1000, (s.topW - q.y) / 1000, z / 1000);
}

/** Orient triangles so the layer faces outward (+z front, -z back). */
function orientTris(pts: Point[], tris: number[], back: boolean) {
  for (let k = 0; k < tris.length; k += 3) {
    const a = pts[tris[k]];
    const b = pts[tris[k + 1]];
    const c = pts[tris[k + 2]];
    // world y = -pattern y, so a positive pattern-space area is clockwise in world space
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if ((area > 0) !== back) {
      const tmp = tris[k + 1];
      tris[k + 1] = tris[k + 2];
      tris[k + 2] = tmp;
    }
  }
}

function buildShellLayer(group: THREE.Group, s: ShellSpec, back: boolean, mat: THREE.Material): ShellLayer {
  const mesh = meshRegion(s.outline, s.constraints, s.step ?? 10);
  const n = mesh.pts.length;
  const z = new Float32Array(n);
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const sgn = back ? -1 : 1;
  mesh.pts.forEach((q, i) => {
    z[i] = sgn * shellDepth(s, q, back);
    const v = shellWorld(s, q, z[i]);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
    uv[i * 2] = q.x / 1000;
    uv[i * 2 + 1] = -q.y / 1000;
  });
  orientTris(mesh.pts, mesh.tris, back);
  const shade = cavityShade(mesh, z, sgn, 0.55);
  const col = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = shade[i];
    col[i * 4 + 3] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setIndex(mesh.tris);
  geo.computeVertexNormals();
  addMesh(group, geo, mat);
  return { mesh, z, geo };
}

/** Mesh a region with given world positions (hood, pocket); outward = -z when `back`. */
function patchGeometry(m: RegionMesh, pos: number[], back: boolean): THREE.BufferGeometry {
  const tris = [...m.tris];
  orientTris(m.pts, tris, back);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(m.pts.flatMap((q) => [q.x / 1000, -q.y / 1000]), 2));
  g.setIndex(tris);
  g.computeVertexNormals();
  return g;
}

/**
 * Folded rib band around a closed opening (neckline, waist): rises from the seam, rolls over
 * at the top edge and comes back down on the inside.
 */
function ribBand(loop: THREE.Vector3[], height: number, tilt: number): THREE.BufferGeometry {
  // Sample at yarn scale so the rolled collar has real rib relief in both renderers.
  const dense: THREE.Vector3[] = [];
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length];
    const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.0006));
    for (let j = 0; j < steps; j++) dense.push(a.clone().lerp(b, j / steps));
  });
  loop = dense;
  const prof: [number, number][] = [
    [0, 0], [0.45, 0], [0.8, 0.0003], [0.96, 0.0011], [1, 0.0022], [0.95, 0.0033], [0.7, 0.0038], [0, 0.0038],
  ];
  const n = loop.length;
  const cols = prof.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const C = loop.reduce((a, p) => a.add(p), V(0, 0, 0)).multiplyScalar(1 / n);
  let run = 0;
  for (let i = 0; i <= n; i++) {
    const P = loop[i % n];
    if (i > 0) run += P.distanceTo(loop[i - 1]);
    // the band leans toward the middle of the opening, so it forms a ring that narrows upward
    const T = loop[(i + 1) % n].clone().sub(loop[(i + n - 1) % n]).normalize();
    const m = C.clone().sub(P);
    m.addScaledVector(T, -m.dot(T));
    if (m.lengthSq() < 1e-10) m.set(0, 0, -1);
    m.normalize();
    const up = V(0, 1, 0).addScaledVector(m, tilt).normalize();
    for (const [s, baseR] of prof) {
      const r = baseR + 0.00022 * Math.cos(run * Math.PI * 2 / 0.0015) * Math.sin(s * Math.PI / 2);
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

/** Closed opening loop: front edge on the front layer, back edge on the back layer. */
function openingLoop(s: ShellSpec, frontEdge: Point[], backEdge: Point[]): THREE.Vector3[] {
  const loop: THREE.Vector3[] = [];
  for (const q of frontEdge) loop.push(shellWorld(s, q, shellDepth(s, q, false)));
  for (const q of rev(backEdge).slice(1, -1)) loop.push(shellWorld(s, q, -shellDepth(s, q, true)));
  return loop;
}

function closeLoop(pts: Point[]): Point[] {
  const f = pts[0];
  const l = pts[pts.length - 1];
  return Math.hypot(f.x - l.x, f.y - l.y) < 1e-6 ? pts.slice(0, -1) : pts;
}

const mirP = (q: Point): Point => ({ x: -q.x, y: q.y });

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
function buildTop(group: THREE.Group, p: GarmentParams, mat: THREE.Material, hoodie: boolean, hanger: boolean, finish: 'white' | 'birch'): MeshPrintSurface[] {
  const M = measures(p);
  const hemBand = hoodie ? 60 : 0;
  const cuffH = hoodie ? 70 : 0;
  const longSleeve = hoodie || p.sleeve === 'long';
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
  const W = corner.x * 2;

  // ---- sleeve placement: half the sleeve piece (front layer), folded along its centre line ----
  const seamS = t.sleeve.edges[1].pts;
  const bw2 = seamS[0].x;
  const ch = seamS[0].y;
  const hw2 = seamS[1].x;
  const sLen = seamS[1].y;
  const cuffHalf = hw2 * 0.82;
  const sEnd = sLen + cuffH;
  // natural pose: the cap chord (top -> underarm) lies along the armhole chord SP -> UP
  const chordL = Math.hypot(UP.x - SP.x, UP.y - SP.y);
  let ux = (UP.x - SP.x) / chordL;
  let uy = (UP.y - SP.y) / chordL;
  const capL = Math.hypot(bw2, ch);
  const cosL = bw2 / capL;
  const sinL = ch / capL;
  let wx = uy;
  let wy = -ux;
  if (sinL * ux + cosL * wx < 0) {
    wx = -wx;
    wy = -wy;
  }
  // on a hanger the sleeves hang lower than in the flat lay: pivot about the shoulder point
  const poseAngle = (longSleeve ? 46 : 30) * (Math.PI / 180);
  const natural = Math.atan2(sinL * uy + cosL * wy, sinL * ux + cosL * wx);
  const rot = Math.max(0, poseAngle - natural);
  const rotate = (x: number, y: number): [number, number] => [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
  [ux, uy] = rotate(ux, uy);
  [wx, wy] = rotate(wx, wy);
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

  const outlineFor = (neck: Point[]) =>
    closeLoop(concat(neck, shoulderR, sleeveOut, sideR, bottom, mir(rev(sideR)), rev(sleeveOut).map(mirP), mir(rev(shoulderR))));
  const bodyPolyFor = (neck: Point[]) => closeLoop(concat(neck, shoulderR, armR, sideR, hemPts, mir(rev(sideR)), mir(rev(armR)), mir(rev(shoulderR))));
  const bandPoly = hemBand ? [...bottom, ...rev(hemPts).slice(1, -1)] : [];

  const constraints: Point[][] = [armR, mir(rev(armR))];
  if (hemBand) constraints.push(hemPts);
  if (cuffH) constraints.push(sleeveHemR, mir(sleeveHemR));

  // ---- shape of the two layers ----
  const sleeveLocal = (q: Point): [number, number] => unwarp(q.x >= 0 ? q : mirP(q));
  const bodyPolyF = bodyPolyFor(neckF);
  const bodyPolyB = bodyPolyFor(neckB);
  const tension = [-1, 1].map((s) => segsOf([[{ x: s * UP.x, y: UP.y }, { x: s * 0.2 * W, y: yBot }]]));
  const spec: ShellSpec = {
    outline: [],
    constraints,
    closed: segsOf([
      shoulderR, mir(shoulderR), foldR, mir(foldR), underR, mir(underR), sideR, mir(sideR),
      ...(hemBand ? [bandSideR, mir(bandSideR)] : []),
    ]),
    creases: segsOf(constraints),
    depth: hoodie ? 34 : 28,
    roll: 70,
    profile: (q) => 1 - 0.25 * Math.min(1, Math.max(0, (q.y - ad) / (yBot - ad))),
    fold: (q, back) => {
      const inBody = pointInPolygon(q.x, q.y, back ? bodyPolyB : bodyPolyF);
      if (inBody) {
        const ph = back ? 1.7 : 0;
        const tt = smoothstep(ad * 0.6, yBot, q.y);
        let w =
          0.55 * Math.sin((2 * Math.PI * q.x) / (0.42 * W) + 0.8 + ph + q.y * 0.0025) +
          0.3 * Math.sin((2 * Math.PI * q.x) / (0.21 * W) + 2.1 + 1.3 * ph + q.y * 0.004) +
          0.15 * Math.sin((2 * Math.PI * q.x) / (0.11 * W) + 4.2 + ph);
        w *= 1.2 + 4.3 * tt;
        // soft tension folds running from the underarm toward the hem
        for (const seg of tension) w += 2.2 * Math.exp(-((distToSegs(q.x, q.y, seg) / 28) ** 2)) * smoothstep(0, 120, q.y - ad) * (1 - 0.5 * tt);
        return w;
      }
      const [xl, yl] = sleeveLocal(q);
      return Math.sin(yl / 26 + (back ? 1.1 : 0) + xl * 0.012) * 2 * smoothstep(ch * 0.5, sLen, yl);
    },
    topW: yBot + 10,
  };
  const surfaces: MeshPrintSurface[] = [];
  const cloth: ClothPanel[] = [];

  const makeLayer = (neck: Point[], back: boolean) => {
    const layer = buildShellLayer(group, { ...spec, outline: outlineFor(neck) }, back, mat);
    cloth.push({ geometry: layer.geo, sewn: (i) => distToSegs(layer.mesh.pts[i].x, layer.mesh.pts[i].y, spec.closed) < 0.01 });
    const { pts, tris } = layer.mesh;
    const n = pts.length;
    const bodyPoly = back ? bodyPolyB : bodyPolyF;
    const region: number[] = [];
    for (let k = 0; k < tris.length; k += 3) {
      const a = pts[tris[k]];
      const b = pts[tris[k + 1]];
      const c = pts[tris[k + 2]];
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
    const pick = (want: number) => {
      const out: number[] = [];
      region.forEach((r, k) => {
        if (r === want) out.push(tris[k * 3], tris[k * 3 + 1], tris[k * 3 + 2]);
      });
      return out;
    };
    const bx = new Float32Array(n);
    const by = new Float32Array(n);
    pts.forEach((q, i) => {
      bx[i] = back ? -q.x : q.x;
      by[i] = q.y;
    });
    surfaces.push({ panel: back ? 'back' : 'front', geo: layer.geo, px: bx, py: by, tris: pick(REGION_BODY) });
    for (const [want, panel] of [[REGION_SLEEVE_POS, 'sleeveL'], [REGION_SLEEVE_NEG, 'sleeveR']] as const) {
      const tr = pick(want);
      if (!tr.length) continue;
      const sx = new Float32Array(n);
      const sy = new Float32Array(n);
      // sleeve pieces are seen from the outside: keep the artwork readable on both layers
      const flip = (want === REGION_SLEEVE_POS) !== back ? -1 : 1;
      for (const i of new Set(tr)) {
        const [xl, yl] = sleeveLocal(pts[i]);
        sx[i] = flip * xl;
        sy[i] = yl;
      }
      surfaces.push({ panel, geo: layer.geo, px: sx, py: sy, tris: tr });
    }
  };
  makeLayer(neckF, false);
  makeLayer(neckB, true);

  // ---- neckline: rib band (T-shirt) or the rim where the hood is sewn in (hoodie) ----
  addMesh(group, ribBand(openingLoop(spec, neckF, neckB), hoodie ? 0.032 : 0.022, hoodie ? 1.1 : 0.8), mat);
  const depthAt = (q: Point, back: boolean) => shellDepth(spec, q, back);
  const toWorld = (q: Point, z: number) => shellWorld(spec, q, z);
  const hemInset = bottom.map((q) => ({ x: q.x * 0.985, y: q.y - 5 }));
  const sleeveInset = endR.map((q) => {
    const dx = SP.x - q.x, dy = SP.y - q.y, len = Math.hypot(dx, dy) || 1;
    return { x: q.x + dx / len * 5, y: q.y + dy / len * 5 };
  });
  for (const back of [false, true]) {
    for (const path of [hemInset, sleeveInset, mir(sleeveInset), armR, mir(armR), shoulderR, mir(shoulderR), back ? neckB : neckF])
      addSewnDetail(group, path.map((q) => toWorld(q, (back ? -1 : 1) * (depthAt(q, back) + 0.7))), mat);
  }

  if (!hoodie) {
    // woven size label inside the back neck
    const ly = neckB[Math.floor(neckB.length / 2)].y + 12;
    const label = new THREE.PlaneGeometry(0.036, 0.012);
    const lm = addMesh(group, label, new THREE.MeshPhysicalMaterial({ color: 0xf4f1ea, roughness: 0.85 }));
    lm.position.copy(toWorld({ x: 0, y: ly }, -depthAt({ x: 0, y: ly }, true) + 1.2));
    lm.castShadow = false;
  }

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
      const v = toWorld(q, -depthAt(q, true) - 3 - lift);
      hpos.push(v.x, v.y, v.z);
    }
    addMesh(group, patchGeometry(hm, hpos, true), mat);
    addSewnDetail(group, hm.pts.filter((q) => Math.abs(q.x) < 0.01).sort((a, b) => a.y - b.y)
      .map((q) => toWorld(q, -depthAt(q, true) - 25)), mat);

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
      const v = toWorld(q, depthAt(q, false) + 1.2 + 2.6 * roundProfile(distToSegs(q.x, q.y, pocketSewn) / 12));
      ppos.push(v.x, v.y, v.z);
    }
    addMesh(group, patchGeometry(pm, ppos, false), mat);
    addSewnDetail(group, [...P, P[0]].map((q) => toWorld(q, depthAt(q, false) + 2)), mat);

    // drawcords hanging from the hood rim
    const cordMat = new THREE.MeshPhysicalMaterial({ color: 0xf5f5f0, roughness: 0.7, sheen: 1, sheenRoughness: 0.5 });
    const neckDepth = neckF.reduce((m, q) => Math.max(m, q.y), 0);
    for (const s of [-1, 1]) {
      const pts = [0, 0.35, 0.7, 1].map((f) => {
        const q = { x: s * (32 + f * 8), y: neckDepth - 8 + f * 230 };
        return toWorld(q, depthAt(q, false) + 4 + (pointInPolygon(q.x, q.y, P) ? 3.8 : 0));
      });
      addMesh(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.0032, 8), cordMat);
      const tip = new THREE.CylinderGeometry(0.0036, 0.0036, 0.022, 10);
      addMesh(group, tip, cordMat).position.copy(pts[3]).add(V(0, -0.01, 0));
    }
  }

  const slope = (SP.y - shoulderR[0].y) / (SP.x - nw);
  const support = { top: spec.topW / 1000, neckWidth: nw / 1000, halfWidth: Math.min(SP.x / 1000 - 0.028, 0.225), slope };
  const settled = settleCloth(cloth, support);
  const shells = new Set(cloth.map((c) => c.geometry));
  const vertex = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    if (!shells.has(geo)) {
      const inverse = mesh.matrixWorld.clone().invert();
      const attr = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < attr.count; i++) {
        vertex.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
        vertex.add(settled.displacement(vertex)).applyMatrix4(inverse);
        attr.setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
      attr.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    }
  });
  // Re-bake fold occlusion after relaxation, using the final cloth positions.
  for (const c of cloth) {
    const geo = c.geometry;
    const position = geo.getAttribute('position');
    const normal = geo.getAttribute('normal');
    const colors = geo.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const shade = Math.max(0.62, 1 - 0.24 * (1 - Math.abs(normal.getZ(i))));
      const ao = Math.min(colors.getX(i), shade);
      colors.setXYZW(i, ao, ao, ao, 1);
    }
    colors.needsUpdate = true;
  }
  group.userData.cloth = { particles: settled.particles, constraints: settled.constraints };
  if (hanger) addHanger(group, support.top, support.neckWidth, SP.x / 1000, slope, finish);
  return surfaces;
}

/** Raised seam cord plus short lockstitches, merged to keep draw calls bounded. */
function addSewnDetail(group: THREE.Group, path: THREE.Vector3[], fabric: THREE.Material) {
  if (path.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal');
  const length = curve.getLength();
  if (length < 0.001) return;
  const ridge = new THREE.TubeGeometry(curve, Math.max(8, Math.ceil(length / 0.003)), 0.00045, 5, false);
  addMesh(group, ridge, fabric).name = 'seam-relief';
  const parts: THREE.BufferGeometry[] = [];
  const count = Math.floor(length / 0.0032);
  for (let i = 0; i < count; i++) {
    const a = curve.getPointAt(i / count), b = curve.getPointAt((i + 0.6) / count);
    parts.push(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 0.00022, 4, false));
  }
  if (!parts.length) return;
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  if (merged) {
    const color = (fabric as THREE.MeshPhysicalMaterial).color.clone().multiplyScalar(0.84);
    addMesh(group, merged, new THREE.MeshPhysicalMaterial({ color, roughness: 0.95, sheen: 0.3 })).name = 'lockstitches';
  }
}

/**
 * Wooden clothes hanger in the style of a classic shaped shop hanger: white lacquered,
 * gently arched shoulder arms following the shoulder seams, a birch centre block carrying
 * the chrome hook, and a birch trouser bar between the arm tips. Everything is coplanar.
 */
function addHanger(group: THREE.Group, hpsY: number, nw: number, sh: number, slope: number, finish: 'white' | 'birch') {
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xd8dce2, metalness: 1, roughness: 0.16 });
  const wood = createBirchTexture();
  const body = new THREE.MeshPhysicalMaterial(finish === 'white'
    ? { color: 0xf3f1ec, roughness: 0.78, clearcoat: 0.08, clearcoatRoughness: 0.65 }
    : { color: 0xe4cfac, map: wood, roughness: 0.64, clearcoat: 0.12, clearcoatRoughness: 0.5 });
  if (finish === 'white') wood.dispose();
  body.name = `hanger-${finish}`;
  const thick = 0.013;
  const bevel = 0.003;
  const extrude = (shape: THREE.Shape) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: thick - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 8, curveSegments: 32 });
    g.translate(0, 0, -(thick - 2 * bevel) / 2);
    g.computeVertexNormals();
    return g;
  };

  // --- arched arms: top edge just under the shoulder seam, sagging a little toward the tips ---
  const half = Math.min(sh - 0.028, 0.225);
  const topC = hpsY - 0.008;
  const topY = (x: number) => hangerHeight({ top: topC + 0.008, neckWidth: nw, halfWidth: half, slope }, x);
  const armH = (x: number) => 0.03 - 0.007 * (Math.abs(x) / half);
  const arms = new THREE.Shape();
  const n = 28;
  const tipR = armH(half) / 2;
  arms.moveTo(-half, topY(-half));
  for (let i = 1; i <= n; i++) {
    const x = -half + (2 * half * i) / n;
    arms.lineTo(x, topY(x));
  }
  arms.quadraticCurveTo(half + tipR * 1.15, topY(half) - tipR, half, topY(half) - armH(half));
  for (let i = n - 1; i >= 0; i--) {
    const x = -half + (2 * half * i) / n;
    arms.lineTo(x, topY(x) - armH(x));
  }
  arms.quadraticCurveTo(-half - tipR * 1.15, topY(-half) - tipR, -half, topY(-half));
  addMesh(group, extrude(arms), body).name = 'hanger-arms';

  // --- birch centre block the hook is screwed into ---
  const bw = 0.056;
  const bt = 0.02;
  const bh = 0.036;
  const by = topY(bw) - 0.004;
  const block = new THREE.Shape();
  block.moveTo(-bw, by);
  block.lineTo(bw, by);
  block.lineTo(bw * 0.92, by + 0.004);
  block.quadraticCurveTo(bt * 1.4, by + bh * 0.78, bt, by + bh);
  block.lineTo(-bt, by + bh);
  block.quadraticCurveTo(-bt * 1.4, by + bh * 0.78, -bw * 0.92, by + 0.004);
  block.closePath();
  addMesh(group, extrude(block), body);

  // --- trouser bar between the arm tips ---
  const barY = topY(half) - armH(half) * 0.45;
  const bar = new THREE.CylinderGeometry(0.0045, 0.0045, half * 2 - 0.02, 32);
  bar.rotateZ(Math.PI / 2);
  addMesh(group, bar, body).position.set(0, barY, 0);

  // --- chrome hook: stem out of the block, "?" curl to one side, ball tip ---
  const wire = 0.0031;
  const R = 0.023;
  const stemBase = by + bh - 0.004;
  const stemTop = hpsY + 0.052;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) pts.push(V(0, stemBase + ((stemTop - stemBase) * i) / 8, 0));
  const endA = Math.PI * 1.25;
  for (let i = 1; i <= 40; i++) {
    const a = (endA * i) / 40;
    pts.push(V(-R + R * Math.cos(a), stemTop + R * Math.sin(a), 0));
  }
  const hookCurve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  addMesh(group, new THREE.TubeGeometry(hookCurve, 160, wire, 24), chrome).name = 'chrome-hook';
  addMesh(group, new THREE.SphereGeometry(wire * 1.3, 16, 12), chrome).position.copy(pts[pts.length - 1]);
  const ferrule = new THREE.CylinderGeometry(0.0046, 0.0054, 0.008, 16);
  addMesh(group, ferrule, chrome).position.set(0, stemBase + 0.003, 0);
}

function createBirchTexture(): THREE.DataTexture {
  const width = 256, height = 128;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const grain = Math.sin(y * 0.8 + Math.sin(x * 0.024) * 1.8) * 0.035 + Math.sin(y * 2.7 + x * 0.01) * 0.018;
    const i = (y * width + x) * 4;
    data[i] = (0.91 + grain) * 255; data[i + 1] = (0.86 + grain) * 255;
    data[i + 2] = (0.76 + grain) * 255; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 12);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Trousers hanging flat, legs side by side, built from the front leg silhouette. */
function buildTrousers(group: THREE.Group, p: GarmentParams, mat: THREE.Material) {
  const M = measures(p);
  const T = draftTrousers(M);
  const leg = T.pieces[0].edges;
  const d = T.dims;
  // front leg in its drafting frame: centre front at x = cx; move it so the centre front is x = 0
  const cx = (d.hip / 4 - 10) / 2;
  const sh = (pts: Point[]) => pts.map((q) => ({ x: q.x - cx, y: q.y }));
  const gap = 3; // the legs hang touching, with a hair of daylight between them
  const sideL = sh(leg[4].pts); // outer hem -> waist
  const hemL = sh(leg[3].pts); // inner hem -> outer hem
  const inner = sh(leg[2].pts).map((q) => ({ x: Math.min(q.x, -gap), y: q.y })); // crotch -> inner hem
  const crotchY = inner[0].y;
  const innerL: Point[] = [{ x: -gap, y: crotchY }, ...inner.slice(1).map((q) => ({ x: -gap, y: q.y }))];
  const waistL = sh(leg[0].pts); // side -> centre
  const waistFull = concat(waistL, [{ x: 0, y: 0 }], mir(rev(waistL)));
  const L = hemL[0].y;
  const outline = closeLoop(concat(sideL, waistFull, mir(rev(sideL)), mir(hemL), mir(rev(innerL)), [{ x: -gap, y: crotchY }], innerL, hemL));
  const spec: ShellSpec = {
    outline,
    constraints: [],
    closed: segsOf([sideL, mir(sideL), innerL, mir(innerL), [{ x: -gap, y: crotchY }, { x: gap, y: crotchY }]]),
    creases: new Float64Array(0),
    depth: 27,
    roll: 60,
    profile: (q) => 0.85 + 0.15 * smoothstep(L, d.rise * 0.6, q.y),
    fold: (q, back) => {
      const ph = back ? 1.3 : 0;
      const s = q.x < 0 ? -1 : 1;
      const lx = Math.abs(q.x);
      return (
        (0.6 * Math.sin((2 * Math.PI * lx) / 95 + ph + q.y * 0.003 + s) + 0.4 * Math.sin((2 * Math.PI * lx) / 47 + 2 + ph * 1.4 + q.y * 0.005)) *
        (1.2 + 2.8 * smoothstep(crotchY, L, q.y))
      );
    },
    topW: L + 10,
  };
  buildShellLayer(group, spec, false, mat);
  buildShellLayer(group, spec, true, mat);
  addMesh(group, ribBand(openingLoop(spec, waistFull, waistFull), 0.04, 0.25), mat);
}

/** A-line skirt hanging flat from its waistband. */
function buildSkirt(group: THREE.Group, p: GarmentParams, mat: THREE.Material) {
  const M = measures(p);
  const S = draftSkirt(M);
  const front = S.pieces[0].edges;
  const back = S.pieces[1].edges;
  const sideR = front[1].pts;
  const hem = front[2].pts;
  const outlineFor = (waist: Point[]) => closeLoop(concat(waist, sideR, hem, mir(rev(sideR))));
  const len = S.dims.length;
  const spec: ShellSpec = {
    outline: [],
    constraints: [],
    closed: segsOf([sideR, mir(sideR)]),
    creases: new Float64Array(0),
    depth: 26,
    roll: 60,
    profile: (q) => 0.8 + 0.2 * smoothstep(len, 150, q.y),
    fold: (q, back) => {
      // flared folds radiating from the hips to the hem
      const th = Math.atan2(q.x, q.y + 260);
      const ph = back ? 0.9 : 0;
      return (Math.sin(9 * th + 0.5 + ph) + 0.45 * Math.sin(21 * th + 2 + ph)) * 5 * smoothstep(120, len, q.y);
    },
    topW: len + 10,
  };
  buildShellLayer(group, { ...spec, outline: outlineFor(front[0].pts) }, false, mat);
  buildShellLayer(group, { ...spec, outline: outlineFor(back[0].pts) }, true, mat);
  addMesh(group, ribBand(openingLoop(spec, front[0].pts, back[0].pts), 0.035, 0.25), mat);
}

/** Empty tote hanging flat from its handles; the box bottom folds flat. */
function buildTote(group: THREE.Group, p: GarmentParams, mat: THREE.Material): MeshPrintSurface[] {
  const M = measures(p);
  const w = TOTE.w + TOTE.box * 2;
  const hh = TOTE.h + M.lenAdj;
  const outline: Point[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: hh }, { x: 0, y: hh }];
  const spec: ShellSpec = {
    outline,
    constraints: [],
    closed: segsOf([[{ x: w, y: 0 }, { x: w, y: hh }, { x: 0, y: hh }, { x: 0, y: 0 }]]),
    creases: new Float64Array(0),
    depth: 16,
    roll: 55,
    profile: (q) => 0.75 + 0.25 * smoothstep(hh, 0, q.y),
    fold: (q, back) => (0.5 * Math.sin((2 * Math.PI * q.x) / 150 + (back ? 1.5 : 0.3)) + 0.3 * Math.sin((2 * Math.PI * q.x) / 70 + 1.1)) * 1.6 * smoothstep(0, hh * 0.4, q.y),
    topW: hh + 10,
  };
  const surfaces: MeshPrintSurface[] = [];
  for (const back of [false, true]) {
    const layer = buildShellLayer(group, spec, back, mat);
    const n = layer.mesh.pts.length;
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    layer.mesh.pts.forEach((q, i) => {
      px[i] = back ? w - q.x : q.x;
      py[i] = q.y;
    });
    surfaces.push({ panel: back ? 'back' : 'front', geo: layer.geo, px, py, tris: layer.mesh.tris });
  }
  // handles: folded straps sewn to the top edge, hanging in a loop above the bag
  for (const back of [false, true]) {
    const z = (back ? -1 : 1) * (shellDepth(spec, { x: w * 0.25, y: 2 }, back) - 1.5);
    const pts = [
      shellWorld(spec, { x: w * 0.24, y: 20 }, z),
      shellWorld(spec, { x: w * 0.23, y: -120 }, z * 1.15),
      shellWorld(spec, { x: w * 0.5, y: -290 }, z * 1.3),
      shellWorld(spec, { x: w * 0.77, y: -120 }, z * 1.15),
      shellWorld(spec, { x: w * 0.76, y: 20 }, z),
    ];
    const strap = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.0055, 10);
    strap.scale(1, 1, 1);
    const sm = addMesh(group, strap, mat);
    sm.scale.set(1, 1, 1);
  }
  return surfaces;
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
  m.userData.printOverlay = true;
  m.renderOrder = 1;
  m.receiveShadow = true;
  return m;
}

/** Build a 3D draped preview of the sewn garment. */
export function buildGarmentObject(params: GarmentParams, materialId: string, options: GarmentObjectOptions): THREE.Object3D {
  const p = sanitize(params);
  const mat = createPhysicalMaterial(materialId, options.color, 1);
  applyFabricDetail(mat, options);
  mat.vertexColors = true; // baked fold shading
  const outer = new THREE.Group();
  outer.name = 'garment';
  const group = new THREE.Group();
  outer.add(group);
  FOLD_K = Math.max(0, Math.min(3, options.wrinkles ?? 1));
  let surfaces: MeshPrintSurface[] = [];
  switch (p.garment) {
    case 'hoodie':
      surfaces = buildTop(group, p, mat, true, !!options.hanger, options.hangerFinish ?? 'white');
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
      surfaces = buildTop(group, p, mat, false, !!options.hanger, options.hangerFinish ?? 'white');
  }
  FOLD_K = 1;

  // printed artwork: one transparent overlay per panel, redrawn in place when layers change
  const prints: { tex: PanelTexture; meshes: THREE.Mesh[] }[] = [];
  if (surfaces.length) {
    for (const panel of getPrintPanels(p)) {
      const own = surfaces.filter((s) => s.panel === panel.id);
      if (!own.length) continue;
      const tex = createPanelTexture(panel.id, panel.bounds, panel.seam);
      const meshes = own.map((s) => meshPrintOverlay(s, tex));
      meshes.forEach((m) => group.add(m));
      prints.push({ tex, meshes });
    }
  }
  const updateArtwork = (layers: ArtworkLayer[]) => {
    for (const pr of prints) {
      const any = pr.tex.redraw(layers);
      for (const m of pr.meshes) {
        m.userData.artworkVisible = any;
        m.visible = any;
      }
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
