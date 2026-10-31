import * as THREE from 'three';
import type { CutPlan, LineKind, PlanPath, Point } from './types';
import { boundsOf, centroid, chainSegments, offsetPolygon, pointKey, polygonArea, polylineLength } from './geom';
import { createPhysicalMaterial, getMaterial } from './materials';

export type BoxStyleId = 'rsc' | 'tuck-end' | 'mailer' | 'tray';

export interface BoxStyle {
  id: BoxStyleId;
  name: string;
  /** Industry code, e.g. FEFCO 0201 / ECMA A20.20 */
  code: string;
  description: string;
}

export const BOX_STYLES: BoxStyle[] = [
  { id: 'rsc', name: 'Klopová krabica', code: 'FEFCO 0201', description: 'Štandardná prepravná krabica: štyri steny, lepiaca chlopňa a štyri chlopne hore aj dole.' },
  { id: 'tuck-end', name: 'Skladačka so zasúvacími koncami', code: 'ECMA A20.20', description: 'Retailová skladačka so zasúvacími vekami zatváranými v opačnom smere.' },
  { id: 'mailer', name: 'Poštová krabica', code: 'FEFCO 0427', description: 'Výsekový mailer s pántovým vekom, zdvojenou prednou stenou a zasúvacou chlopňou.' },
  { id: 'tray', name: 'Otvorený podnos', code: 'FEFCO 0300', description: 'Jednoduchý displejový podnos so zaisťovacími rohovými chlopňami.' },
];

export interface BoxParams {
  style: BoxStyleId;
  /** Internal dimensions in mm */
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  /** Board caliper in mm */
  thicknessMm: number;
  glueFlapMm: number;
  /** Print bleed around the dieline in mm (0 = none) */
  bleedMm: number;
}

const STYLE_DEFAULTS: Record<BoxStyleId, Omit<BoxParams, 'style'>> = {
  rsc: { lengthMm: 300, widthMm: 200, heightMm: 200, thicknessMm: 3, glueFlapMm: 35, bleedMm: 0 },
  'tuck-end': { lengthMm: 90, widthMm: 50, heightMm: 160, thicknessMm: 0.5, glueFlapMm: 15, bleedMm: 3 },
  mailer: { lengthMm: 250, widthMm: 180, heightMm: 80, thicknessMm: 1.5, glueFlapMm: 0, bleedMm: 3 },
  tray: { lengthMm: 300, widthMm: 200, heightMm: 70, thicknessMm: 1.5, glueFlapMm: 0, bleedMm: 0 },
};

export function defaultBoxParams(style: BoxStyleId = 'rsc'): BoxParams {
  return { style, ...(STYLE_DEFAULTS[style] ?? STYLE_DEFAULTS.rsc) };
}

// ---------------------------------------------------------------------------
// Panel tree: every panel is an absolute polygon in sheet space (mm, y up).
// Children hinge on a segment shared with their parent.
// ---------------------------------------------------------------------------

interface Panel {
  name: string;
  /** Label printed on the dieline (main panels only) */
  label?: string;
  poly: Point[];
  /** Hinge segment shared with the parent (sheet coords) */
  hinge?: [Point, Point];
  hingeKind?: LineKind;
  /** Target fold angle in radians (positive folds toward the inside of the box) */
  angle: number;
  /** Fold timing within the overall 0..1 fold progress */
  stage: [number, number];
  /** Offset in board thicknesses along the panel normal once folded (+ = inside) */
  layer: number;
  glue?: boolean;
  children: Panel[];
}

interface BoxLayout {
  root: Panel;
  /** Root rotation about X at fold=0 and fold=1 (radians) */
  rootFlat: number;
  rootFolded: number;
  rootStage: [number, number];
}

const D90 = Math.PI / 2;

function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function panel(name: string, poly: Point[], opts: Partial<Panel> = {}): Panel {
  return { name, poly, angle: D90, stage: [0, 1], layer: 0, children: [], ...opts };
}

function attach(parent: Panel, child: Panel, a: Point, b: Point, kind: LineKind = 'fold'): Panel {
  child.hinge = [a, b];
  child.hingeKind = kind;
  parent.children.push(child);
  return child;
}

/** Trapezoid flap on a hinge running along +x from (x0,y) to (x1,y), extending by h in direction dir (+1 up / -1 down). */
function flapH(x0: number, x1: number, y: number, h: number, dir: 1 | -1, taperL: number, taperR: number): Point[] {
  const pts = [
    { x: x0, y },
    { x: x1, y },
    { x: x1 - taperR, y: y + dir * h },
    { x: x0 + taperL, y: y + dir * h },
  ];
  return dir === 1 ? pts : [pts[1], pts[0], pts[3], pts[2]];
}

/** Trapezoid flap on a vertical hinge at x from y0..y1 extending by w in direction dir (+1 right / -1 left). */
function flapV(y0: number, y1: number, x: number, w: number, dir: 1 | -1, taperB: number, taperT: number): Point[] {
  const pts = [
    { x, y: y0 },
    { x: x + dir * w, y: y0 + taperB },
    { x: x + dir * w, y: y1 - taperT },
    { x, y: y1 },
  ];
  return dir === 1 ? pts : [pts[0], pts[3], pts[2], pts[1]];
}

function layoutRsc(p: BoxParams): BoxLayout {
  const t = p.thicknessMm;
  const a = p.lengthMm + t;
  const b = p.widthMm + t;
  const H = p.heightMm + 2 * t;
  const fh = b / 2;
  const g = p.glueFlapMm;
  const xs = [0, a, a + b, 2 * a + b, 2 * a + 2 * b];
  const names = ['Predná stena', 'Bočná stena', 'Zadná stena', 'Bočná stena'];
  const bodies: Panel[] = [];
  for (let i = 0; i < 4; i++) {
    bodies.push(panel(`body-${i}`, rect(xs[i], 0, xs[i + 1], H), { label: names[i], stage: [0, 0.45] }));
  }
  const root = bodies[0];
  for (let i = 1; i < 4; i++) attach(bodies[i - 1], bodies[i], { x: xs[i], y: 0 }, { x: xs[i], y: H });
  const glue = panel('glue', flapV(0, H, 0, g, -1, Math.min(g * 0.4, 12), Math.min(g * 0.4, 12)), {
    stage: [0.3, 0.5],
    layer: 1,
    glue: true,
  });
  attach(root, glue, { x: 0, y: 0 }, { x: 0, y: H });
  for (let i = 0; i < 4; i++) {
    const major = i % 2 === 0;
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const top = panel(`top-${i}`, flapH(x0, x1, H, fh, 1, 0, 0), {
      stage: major ? [0.8, 1] : [0.68, 0.86],
      layer: major ? -1 : 0,
    });
    attach(bodies[i], top, { x: x0, y: H }, { x: x1, y: H });
    const bot = panel(`bottom-${i}`, flapH(x0, x1, 0, fh, -1, 0, 0), {
      stage: major ? [0.55, 0.72] : [0.45, 0.62],
      layer: major ? -1 : 0,
    });
    attach(bodies[i], bot, { x: x0, y: 0 }, { x: x1, y: 0 });
  }
  return { root, rootFlat: -D90, rootFolded: 0, rootStage: [0, 0.45] };
}

function layoutTuckEnd(p: BoxParams): BoxLayout {
  const t = p.thicknessMm;
  const a = p.lengthMm + t;
  const b = p.widthMm + t;
  const H = p.heightMm + 2 * t;
  const g = p.glueFlapMm;
  const tuck = Math.min(Math.max(12, b * 0.35), 30);
  const dust = b * 0.7;
  const xs = [0, a, a + b, 2 * a + b, 2 * a + 2 * b];
  const names = ['Predná strana', 'Bok', 'Zadná strana', 'Bok'];
  const bodies: Panel[] = [];
  for (let i = 0; i < 4; i++) bodies.push(panel(`body-${i}`, rect(xs[i], 0, xs[i + 1], H), { label: names[i], stage: [0, 0.4] }));
  const root = bodies[0];
  for (let i = 1; i < 4; i++) attach(bodies[i - 1], bodies[i], { x: xs[i], y: 0 }, { x: xs[i], y: H });
  const glue = panel('glue', flapV(0, H, 0, g, -1, Math.min(g * 0.5, 8), Math.min(g * 0.5, 8)), { stage: [0.25, 0.45], layer: 1, glue: true });
  attach(root, glue, { x: 0, y: 0 }, { x: 0, y: H });

  // Dust flaps on the side panels (top & bottom)
  for (const i of [1, 3]) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    attach(bodies[i], panel(`dust-top-${i}`, flapH(x0, x1, H, dust, 1, 1, b * 0.35), { stage: [0.45, 0.6], layer: 0 }), { x: x0, y: H }, { x: x1, y: H });
    attach(bodies[i], panel(`dust-bottom-${i}`, flapH(x0, x1, 0, dust, -1, 1, b * 0.35), { stage: [0.45, 0.6], layer: 0 }), { x: x0, y: 0 }, { x: x1, y: 0 });
  }
  // Top lid on the back panel, bottom lid on the front panel (reverse tuck)
  const lidTop = panel('lid-top', rect(xs[2], H, xs[3], H + b), { label: 'Veko', stage: [0.62, 0.82], layer: -1 });
  attach(bodies[2], lidTop, { x: xs[2], y: H }, { x: xs[3], y: H });
  const tuckTop = panel('tuck-top', roundedTuck(xs[2], xs[3], H + b, tuck, 1, t), { stage: [0.8, 1], layer: 0 });
  attach(lidTop, tuckTop, { x: xs[2] + t, y: H + b }, { x: xs[3] - t, y: H + b });
  const lidBot = panel('lid-bottom', rect(xs[0], -b, xs[1], 0), { label: 'Dno', stage: [0.62, 0.82], layer: -1 });
  attach(bodies[0], lidBot, { x: xs[0], y: 0 }, { x: xs[1], y: 0 });
  const tuckBot = panel('tuck-bottom', roundedTuck(xs[0], xs[1], -b, tuck, -1, t), { stage: [0.8, 1], layer: 0 });
  attach(lidBot, tuckBot, { x: xs[0] + t, y: -b }, { x: xs[1] - t, y: -b });
  return { root, rootFlat: -D90, rootFolded: 0, rootStage: [0, 0.4] };
}

function roundedTuck(x0: number, x1: number, y: number, h: number, dir: 1 | -1, inset: number): Point[] {
  const a = x0 + inset;
  const b = x1 - inset;
  const r = Math.min(h * 0.8, (b - a) * 0.2);
  const steps = 6;
  const pts: Point[] = [{ x: a, y: 0 }, { x: b, y: 0 }];
  for (let i = 0; i <= steps; i++) {
    const ang = (i / steps) * D90;
    pts.push({ x: b - r + r * Math.cos(ang), y: h - r + r * Math.sin(ang) });
  }
  for (let i = 0; i <= steps; i++) {
    const ang = D90 + (i / steps) * D90;
    pts.push({ x: a + r + r * Math.cos(ang), y: h - r + r * Math.sin(ang) });
  }
  return pts.map((q) => ({ x: q.x, y: y + dir * q.y }));
}

function layoutMailer(p: BoxParams): BoxLayout {
  const t = p.thicknessMm;
  const a = p.lengthMm + 2 * t;
  const b = p.widthMm + 2 * t;
  const H = p.heightMm + t;
  const base = panel('base', rect(0, 0, a, b), { label: 'Dno' });
  // Front wall (double)
  const front = panel('front', rect(0, -H, a, 0), { label: 'Predná stena', stage: [0, 0.3] });
  attach(base, front, { x: 0, y: 0 }, { x: a, y: 0 });
  const frontInner = panel('front-inner', rect(t, -2 * H + t, a - t, -H), { label: 'Vnútorná stena', angle: Math.PI, stage: [0.3, 0.5], layer: -1 });
  attach(front, frontInner, { x: t, y: -H }, { x: a - t, y: -H });
  // Ears on the front wall ends
  const ear = Math.min(b * 0.45, H * 1.4);
  attach(front, panel('ear-fl', flapV(-H + 2, -2, 0, ear, -1, 2, H * 0.3), { stage: [0.18, 0.32], layer: 1 }), { x: 0, y: -H + 2 }, { x: 0, y: -2 });
  attach(front, panel('ear-fr', flapV(-H + 2, -2, a, ear, 1, 2, H * 0.3), { stage: [0.18, 0.32], layer: 1 }), { x: a, y: -H + 2 }, { x: a, y: -2 });
  // Side walls
  const left = panel('side-l', rect(-H, 0, 0, b), { label: 'Bok', stage: [0.3, 0.48] });
  attach(base, left, { x: 0, y: 0 }, { x: 0, y: b });
  const right = panel('side-r', rect(a, 0, a + H, b), { label: 'Bok', stage: [0.3, 0.48] });
  attach(base, right, { x: a, y: 0 }, { x: a, y: b });
  // Back wall + ears
  const back = panel('back', rect(0, b, a, b + H), { label: 'Zadná stena', stage: [0, 0.3] });
  attach(base, back, { x: 0, y: b }, { x: a, y: b });
  attach(back, panel('ear-bl', flapV(b + 2, b + H - 2, 0, ear, -1, H * 0.3, 2), { stage: [0.18, 0.32], layer: 1 }), { x: 0, y: b + 2 }, { x: 0, y: b + H - 2 });
  attach(back, panel('ear-br', flapV(b + 2, b + H - 2, a, ear, 1, H * 0.3, 2), { stage: [0.18, 0.32], layer: 1 }), { x: a, y: b + 2 }, { x: a, y: b + H - 2 });
  // Lid + lid side flaps + front tuck
  const lid = panel('lid', rect(0, b + H, a, b + H + b + t), { label: 'Veko', stage: [0.62, 0.85] });
  attach(back, lid, { x: 0, y: b + H }, { x: a, y: b + H });
  const lidFlap = H * 0.8;
  attach(lid, panel('lid-flap-l', flapV(b + H + 3, b + H + b - 3, 0, lidFlap, -1, lidFlap * 0.35, lidFlap * 0.35), { stage: [0.5, 0.65], layer: 2 }), { x: 0, y: b + H + 3 }, { x: 0, y: b + H + b - 3 });
  attach(lid, panel('lid-flap-r', flapV(b + H + 3, b + H + b - 3, a, lidFlap, 1, lidFlap * 0.35, lidFlap * 0.35), { stage: [0.5, 0.65], layer: 2 }), { x: a, y: b + H + 3 }, { x: a, y: b + H + b - 3 });
  const tuckH = H * 0.85;
  const tuck = panel('tuck', flapH(2 * t, a - 2 * t, b + H + b + t, tuckH, 1, tuckH * 0.25, tuckH * 0.25), { label: 'Zasúvacia chlopňa', stage: [0.8, 1], layer: 1 });
  attach(lid, tuck, { x: 2 * t, y: b + H + b + t }, { x: a - 2 * t, y: b + H + b + t });
  return { root: base, rootFlat: -D90, rootFolded: -D90, rootStage: [0, 1] };
}

function layoutTray(p: BoxParams): BoxLayout {
  const t = p.thicknessMm;
  const a = p.lengthMm + 2 * t;
  const b = p.widthMm + 2 * t;
  const H = p.heightMm;
  const base = panel('base', rect(0, 0, a, b), { label: 'Dno' });
  const front = panel('front', rect(0, -H, a, 0), { label: 'Predná stena', stage: [0, 0.45] });
  attach(base, front, { x: 0, y: 0 }, { x: a, y: 0 });
  const back = panel('back', rect(0, b, a, b + H), { label: 'Zadná stena', stage: [0, 0.45] });
  attach(base, back, { x: 0, y: b }, { x: a, y: b });
  const ear = H - t;
  attach(front, panel('ear-fl', flapV(-H + 1, -1, 0, ear, -1, 1, ear * 0.3), { stage: [0.3, 0.6], layer: 1 }), { x: 0, y: -H + 1 }, { x: 0, y: -1 });
  attach(front, panel('ear-fr', flapV(-H + 1, -1, a, ear, 1, 1, ear * 0.3), { stage: [0.3, 0.6], layer: 1 }), { x: a, y: -H + 1 }, { x: a, y: -1 });
  attach(back, panel('ear-bl', flapV(b + 1, b + H - 1, 0, ear, -1, ear * 0.3, 1), { stage: [0.3, 0.6], layer: 1 }), { x: 0, y: b + 1 }, { x: 0, y: b + H - 1 });
  attach(back, panel('ear-br', flapV(b + 1, b + H - 1, a, ear, 1, ear * 0.3, 1), { stage: [0.3, 0.6], layer: 1 }), { x: a, y: b + 1 }, { x: a, y: b + H - 1 });
  attach(base, panel('side-l', rect(-H, 0, 0, b), { label: 'Bok', stage: [0.55, 1] }), { x: 0, y: 0 }, { x: 0, y: b });
  attach(base, panel('side-r', rect(a, 0, a + H, b), { label: 'Bok', stage: [0.55, 1] }), { x: a, y: 0 }, { x: a, y: b });
  return { root: base, rootFlat: -D90, rootFolded: -D90, rootStage: [0, 1] };
}

function buildLayout(p: BoxParams): BoxLayout {
  switch (p.style) {
    case 'tuck-end':
      return layoutTuckEnd(p);
    case 'mailer':
      return layoutMailer(p);
    case 'tray':
      return layoutTray(p);
    default:
      return layoutRsc(p);
  }
}

function allPanels(root: Panel): Panel[] {
  const out: Panel[] = [];
  const visit = (p: Panel) => {
    out.push(p);
    p.children.forEach(visit);
  };
  visit(root);
  return out;
}

function validate(p: BoxParams): string[] {
  const w: string[] = [];
  if (p.lengthMm < 20 || p.widthMm < 20 || p.heightMm < 10) w.push('Rozmery sú veľmi malé — skontrolujte, či sú zadané v milimetroch.');
  if (p.style === 'rsc' && p.widthMm > p.lengthMm) w.push('Pri klopovej krabici by šírka nemala byť väčšia ako dĺžka — vonkajšie chlopne sa nezatvoria.');
  if (p.thicknessMm > 8) w.push('Hrúbka materiálu nad 8 mm je mimo bežného rozsahu vlnitej lepenky.');
  if (p.style === 'tuck-end' && p.thicknessMm > 1) w.push('Zasúvacie skladačky sa zvyčajne vyrábajú z kartónu do 1 mm.');
  return w;
}

/** Generate the flat dieline (cut + fold plan) for a box. */
export function generateBoxPlan(params: BoxParams): CutPlan {
  const p = sanitize(params);
  const layout = buildLayout(p);
  const panels = allPanels(layout.root);

  // Flip to plan space (y down) and offset to margin
  const allPts = panels.flatMap((x) => x.poly);
  const bb = boundsOf(allPts);
  const margin = 10 + p.bleedMm;
  const tx = (q: Point): Point => ({ x: q.x - bb.minX + margin, y: bb.maxY - q.y + margin });

  // Edges, counted by occurrence
  const hingeKeys = new Map<string, LineKind>();
  const segKey = (a: Point, b: Point) => {
    const ka = pointKey(a);
    const kb = pointKey(b);
    return ka < kb ? ka + '|' + kb : kb + '|' + ka;
  };
  for (const pnl of panels) {
    if (pnl.hinge) hingeKeys.set(segKey(pnl.hinge[0], pnl.hinge[1]), pnl.hingeKind ?? 'fold');
  }

  // Split polygon edges at hinge endpoints so partial hinges are detected
  const hingeSegs = panels.filter((x) => x.hinge).map((x) => x.hinge!);
  const edgeCount = new Map<string, { a: Point; b: Point; n: number }>();
  for (const pnl of panels) {
    const n = pnl.poly.length;
    for (let i = 0; i < n; i++) {
      const a = pnl.poly[i];
      const b = pnl.poly[(i + 1) % n];
      for (const [s0, s1] of splitAtHinges(a, b, hingeSegs)) {
        const k = segKey(s0, s1);
        const e = edgeCount.get(k);
        if (e) e.n++;
        else edgeCount.set(k, { a: s0, b: s1, n: 1 });
      }
    }
  }

  const outline: [Point, Point][] = [];
  const slits: [Point, Point][] = [];
  const folds: { kind: LineKind; a: Point; b: Point }[] = [];
  for (const [k, e] of edgeCount) {
    const hk = hingeKeys.get(k);
    if (hk) folds.push({ kind: hk, a: e.a, b: e.b });
    else if (e.n === 1) outline.push([e.a, e.b]);
    else slits.push([e.a, e.b]);
  }

  const paths: PlanPath[] = [];
  let id = 0;
  const loops = chainSegments(outline);
  let cutLength = 0;
  let foldLength = 0;
  for (const loop of loops) {
    const pts = loop.points.map(tx);
    cutLength += polylineLength(pts, loop.closed);
    paths.push({ id: `cut-${id++}`, kind: 'cut', points: pts, closed: loop.closed });
    if (p.bleedMm > 0 && loop.closed) {
      paths.push({ id: `bleed-${id++}`, kind: 'bleed', points: offsetPolygon(pts, -p.bleedMm * Math.sign(polygonArea(pts))), closed: true });
    }
  }
  for (const s of slits) {
    const pts = [tx(s[0]), tx(s[1])];
    cutLength += polylineLength(pts, false);
    paths.push({ id: `slit-${id++}`, kind: 'cut', points: pts, closed: false });
  }
  for (const f of folds) {
    const pts = [tx(f.a), tx(f.b)];
    foldLength += polylineLength(pts, false);
    paths.push({ id: `fold-${id++}`, kind: f.kind, points: pts, closed: false });
  }
  for (const pnl of panels) {
    if (pnl.glue) {
      const c = centroid(pnl.poly);
      const inset = pnl.poly.map((q) => ({ x: c.x + (q.x - c.x) * 0.7, y: c.y + (q.y - c.y) * 0.8 }));
      paths.push({ id: `glue-${id++}`, kind: 'glue', points: inset.map(tx), closed: true });
    }
  }

  const area = panels.reduce((s, x) => s + Math.abs(polygonArea(x.poly)), 0);
  const labels = panels
    .filter((x) => x.label || x.glue)
    .map((x) => {
      const c = tx(centroid(x.poly));
      const b = boundsOf(x.poly);
      const size = Math.max(4, Math.min(14, Math.min(b.maxX - b.minX, b.maxY - b.minY) * 0.12));
      return { text: x.glue ? 'Lepenie' : x.label!, position: c, size, rotation: x.glue ? -90 : 0 };
    });

  const sheetW = bb.maxX - bb.minX + margin * 2;
  const sheetH = bb.maxY - bb.minY + margin * 2;
  const allPlanPts = paths.flatMap((x) => x.points);
  const pieceBounds = boundsOf(allPlanPts);
  const style = BOX_STYLES.find((s) => s.id === p.style)!;
  const dims = `${p.lengthMm} × ${p.widthMm} × ${p.heightMm} mm`;

  const legend = Array.from(new Set(paths.map((x) => x.kind)));
  return {
    productType: 'packaging',
    title: `${style.name} ${dims}`,
    units: 'mm',
    sheet: { width: sheetW, height: sheetH, label: `Hárok ${Math.ceil(sheetW)} × ${Math.ceil(sheetH)} mm` },
    pieces: [
      {
        id: 'dieline',
        name: `${style.name} (${style.code})`,
        quantity: 1,
        color: '#f97316',
        paths,
        labels,
        bounds: pieceBounds,
        areaMm2: area,
        cutLengthMm: cutLength,
        foldLengthMm: foldLength,
        meta: {
          'Vnútorné rozmery': dims,
          'Hrúbka materiálu': `${p.thicknessMm} mm`,
          'Počet panelov': panels.length,
          Štandard: style.code,
        },
      },
    ],
    stats: {
      pieceCount: 1,
      totalAreaMm2: area,
      cutLengthMm: cutLength,
      foldLengthMm: foldLength,
      sheetWidthMm: sheetW,
      sheetHeightMm: sheetH,
      utilization: area / (sheetW * sheetH),
    },
    legend,
    warnings: validate(p),
  };
}

function splitAtHinges(a: Point, b: Point, hinges: [Point, Point][]): [Point, Point][] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return [];
  const ts = [0, 1];
  for (const h of hinges) {
    for (const q of h) {
      const t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2;
      if (t <= 1e-6 || t >= 1 - 1e-6) continue;
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      if (Math.hypot(px - q.x, py - q.y) < 1e-3) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  const out: [Point, Point][] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i + 1] - ts[i] < 1e-7) continue;
    out.push([
      { x: a.x + dx * ts[i], y: a.y + dy * ts[i] },
      { x: a.x + dx * ts[i + 1], y: a.y + dy * ts[i + 1] },
    ]);
  }
  return out;
}

function sanitize(p: BoxParams): BoxParams {
  const d = defaultBoxParams(p.style);
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    style: BOX_STYLES.some((s) => s.id === p.style) ? p.style : 'rsc',
    lengthMm: num(p.lengthMm, d.lengthMm, 5, 3000),
    widthMm: num(p.widthMm, d.widthMm, 5, 3000),
    heightMm: num(p.heightMm, d.heightMm, 2, 3000),
    thicknessMm: num(p.thicknessMm, d.thicknessMm, 0.1, 15),
    glueFlapMm: num(p.glueFlapMm, d.glueFlapMm, 0, 100),
    bleedMm: num(p.bleedMm, d.bleedMm, 0, 20),
  };
}

// ---------------------------------------------------------------------------
// 3D folding box
// ---------------------------------------------------------------------------

export interface BoxObjectOptions {
  /** 0 = lying flat as a dieline, 1 = fully folded box. Animate this for the fold transition. */
  fold: number;
  color?: string | null;
}

const smooth = (x: number) => x * x * (3 - 2 * x);
function stageProgress(f: number, [s, e]: [number, number]): number {
  if (e <= s) return f >= e ? 1 : 0;
  return smooth(Math.min(1, Math.max(0, (f - s) / (e - s))));
}

/** Build panel geometry: extruded polygon with faces grouped as outside (0), inside (1), edges (2). */
function panelGeometry(poly: Point[], thickness: number): THREE.BufferGeometry {
  const ccw = polygonArea(poly) > 0 ? poly : [...poly].reverse();
  const shape = new THREE.Shape(ccw.map((q) => new THREE.Vector2(q.x, q.y)));
  const ex = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 4 });
  const pos = ex.getAttribute('position');
  const nor = ex.getAttribute('normal');
  const uv = ex.getAttribute('uv');
  const tri = pos.count / 3;
  const buckets: number[][] = [[], [], []];
  for (let i = 0; i < tri; i++) {
    const nz = nor.getZ(i * 3) + nor.getZ(i * 3 + 1) + nor.getZ(i * 3 + 2);
    buckets[nz < -1.5 ? 0 : nz > 1.5 ? 1 : 2].push(i);
  }
  const order = [...buckets[0], ...buckets[1], ...buckets[2]];
  const P = new Float32Array(order.length * 9);
  const N = new Float32Array(order.length * 9);
  const U = new Float32Array(order.length * 6);
  order.forEach((t, j) => {
    for (let k = 0; k < 3; k++) {
      const s = t * 3 + k;
      const d = j * 3 + k;
      P.set([pos.getX(s), pos.getY(s), pos.getZ(s)], d * 3);
      N.set([nor.getX(s), nor.getY(s), nor.getZ(s)], d * 3);
      U.set([uv.getX(s), uv.getY(s)], d * 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  let start = 0;
  buckets.forEach((b, i) => {
    g.addGroup(start * 3, b.length * 3, i);
    start += b.length;
  });
  ex.dispose();
  return g;
}

function boardMaterials(materialId: string, color?: string | null): THREE.Material[] {
  const preset = getMaterial(materialId);
  const outside = createPhysicalMaterial(materialId, color, 0.001);
  const corrugated = preset.category === 'Corrugated' || preset.id.includes('corrugated');
  const innerId = corrugated ? 'kraft-corrugated' : 'sbs-board';
  const inside = createPhysicalMaterial(innerId, null, 0.001);
  if (!corrugated) {
    inside.clearcoat = 0;
    inside.roughness = 0.75;
  }
  const edge = createPhysicalMaterial(corrugated ? 'kraft-corrugated' : 'sbs-board', null, 0.001);
  edge.roughness = 0.95;
  if (corrugated) edge.color.multiplyScalar(0.85);
  return [outside, inside, edge];
}

/** Build a 3D folding box made of panels with board thickness. */
export function buildBoxObject(params: BoxParams, materialId: string, options: BoxObjectOptions): THREE.Object3D {
  const p = sanitize(params);
  const layout = buildLayout(p);
  const t = p.thicknessMm;
  const mats = boardMaterials(materialId, options.color);

  const outer = new THREE.Group();
  outer.name = 'box';
  const scaleGroup = new THREE.Group();
  scaleGroup.scale.setScalar(0.001); // mm -> m
  outer.add(scaleGroup);
  const rootGroup = new THREE.Group();
  scaleGroup.add(rootGroup);

  interface Node {
    panel: Panel;
    group: THREE.Group;
    pivot: THREE.Vector3;
    axis: THREE.Vector3;
  }
  const nodes: Node[] = [];

  const build = (pnl: Panel, parentGroup: THREE.Group) => {
    const group = new THREE.Group();
    group.name = pnl.name;
    parentGroup.add(group);
    const mesh = new THREE.Mesh(panelGeometry(pnl.poly, t), mats);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    let pivot = new THREE.Vector3();
    let axis = new THREE.Vector3(1, 0, 0);
    if (pnl.hinge) {
      const [a, b] = pnl.hinge;
      pivot = new THREE.Vector3(a.x, a.y, 0);
      axis = new THREE.Vector3(b.x - a.x, b.y - a.y, 0).normalize();
      const c = centroid(pnl.poly);
      const n = new THREE.Vector3(c.x - a.x, c.y - a.y, 0);
      n.sub(axis.clone().multiplyScalar(n.dot(axis)));
      const cross = new THREE.Vector3().crossVectors(axis, n);
      if (cross.z < 0) axis.negate();
    }
    nodes.push({ panel: pnl, group, pivot, axis });
    pnl.children.forEach((c) => build(c, group));
  };
  build(layout.root, rootGroup);

  const tmp = new THREE.Matrix4();
  const setFold = (fRaw: number) => {
    const f = Math.min(1, Math.max(0, fRaw));
    for (const n of nodes) {
      if (!n.panel.hinge) continue;
      const s = stageProgress(f, n.panel.stage);
      const m = new THREE.Matrix4().makeTranslation(n.pivot.x, n.pivot.y, 0);
      m.multiply(tmp.makeRotationAxis(n.axis, n.panel.angle * s));
      m.multiply(tmp.makeTranslation(-n.pivot.x, -n.pivot.y, n.panel.layer * t * s));
      n.group.matrixAutoUpdate = false;
      n.group.matrix.copy(m);
    }
    const rs = stageProgress(f, layout.rootStage);
    rootGroup.rotation.set(layout.rootFlat + (layout.rootFolded - layout.rootFlat) * rs, 0, 0);
    rootGroup.position.set(0, 0, 0);
    rootGroup.updateMatrixWorld(true);
    // centre on the origin, standing on y = 0
    scaleGroup.position.set(0, 0, 0);
    outer.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scaleGroup);
    const c = box.getCenter(new THREE.Vector3());
    scaleGroup.position.set(-c.x, -box.min.y, -c.z);
    outer.updateMatrixWorld(true);
  };
  setFold(options.fold);
  outer.userData.setFold = setFold;
  outer.userData.kind = 'box';
  return outer;
}
