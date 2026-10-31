import type { Bounds, Point } from './types';

export const pt = (x: number, y: number): Point => ({ x, y });

export function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polylineLength(points: Point[], closed: boolean): number {
  let len = 0;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    len += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return len;
}

export function boundsOf(points: Iterable<Point>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function centroid(poly: Point[]): Point {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    const b = boundsOf(poly);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Offset a closed polygon by d (positive = outward for CCW polygons) using mitred joins, clamped. */
export function offsetPolygon(poly: Point[], d: number): Point[] {
  const n = poly.length;
  const ccw = polygonArea(poly) > 0;
  const s = ccw ? 1 : -1;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const e1 = norm({ x: cur.x - prev.x, y: cur.y - prev.y });
    const e2 = norm({ x: next.x - cur.x, y: next.y - cur.y });
    // outward normals (right-hand side for CCW)
    const n1 = { x: e1.y * s, y: -e1.x * s };
    const n2 = { x: e2.y * s, y: -e2.x * s };
    const bis = norm({ x: n1.x + n2.x, y: n1.y + n2.y });
    const cos = bis.x * n2.x + bis.y * n2.y;
    const len = d / Math.max(cos, 0.35);
    if (cos < 0.35 && d > 0) {
      // sharp corner: bevel with two points
      out.push({ x: cur.x + n1.x * d, y: cur.y + n1.y * d });
      out.push({ x: cur.x + n2.x * d, y: cur.y + n2.y * d });
    } else {
      out.push({ x: cur.x + bis.x * len, y: cur.y + bis.y * len });
    }
  }
  return out;
}

export function norm(v: Point): Point {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

const KEY_PREC = 1000;
export const pointKey = (p: Point) => `${Math.round(p.x * KEY_PREC)},${Math.round(p.y * KEY_PREC)}`;

/** Chain a set of undirected segments into polylines / loops. */
export function chainSegments(segments: [Point, Point][]): { points: Point[]; closed: boolean }[] {
  const adj = new Map<string, { seg: number; other: Point; self: Point }[]>();
  segments.forEach(([a, b], i) => {
    const ka = pointKey(a);
    const kb = pointKey(b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push({ seg: i, other: b, self: a });
    adj.get(kb)!.push({ seg: i, other: a, self: b });
  });
  const used = new Set<number>();
  const result: { points: Point[]; closed: boolean }[] = [];

  const walk = (startSeg: number, from: Point) => {
    const pts: Point[] = [from];
    let cur = from;
    let seg = startSeg;
    for (;;) {
      used.add(seg);
      const [a, b] = segments[seg];
      const next = pointKey(a) === pointKey(cur) ? b : a;
      pts.push(next);
      cur = next;
      const options = (adj.get(pointKey(cur)) ?? []).filter((o) => !used.has(o.seg));
      if (options.length === 0) break;
      seg = options[0].seg;
    }
    const closed = pts.length > 2 && pointKey(pts[0]) === pointKey(pts[pts.length - 1]);
    if (closed) pts.pop();
    result.push({ points: pts, closed });
  };

  // start from open ends first
  for (const [k, list] of adj) {
    if (list.length === 1 && !used.has(list[0].seg)) walk(list[0].seg, list[0].self);
    void k;
  }
  for (let i = 0; i < segments.length; i++) if (!used.has(i)) walk(i, segments[i][0]);
  return result;
}

/** Simplify nearly collinear consecutive points. */
export function simplifyCollinear(points: Point[], closed: boolean, tol = 1e-4): Point[] {
  if (points.length < 3) return points;
  const out: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(points[i]);
      continue;
    }
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const l = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y);
    if (l > 0 && Math.abs(cross) / l < tol) continue;
    out.push(b);
  }
  return out;
}

/** Sample a cubic bezier (excluding the start point). */
export function bezier(p0: Point, p1: Point, p2: Point, p3: Point, steps = 12): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

/** Rounded corner fillet between three points (returns points replacing the corner). */
export function filletCorner(a: Point, b: Point, c: Point, r: number, steps = 6): Point[] {
  const d1 = norm({ x: a.x - b.x, y: a.y - b.y });
  const d2 = norm({ x: c.x - b.x, y: c.y - b.y });
  const l1 = Math.hypot(a.x - b.x, a.y - b.y);
  const l2 = Math.hypot(c.x - b.x, c.y - b.y);
  const rr = Math.min(r, l1 * 0.45, l2 * 0.45);
  const s = { x: b.x + d1.x * rr, y: b.y + d1.y * rr };
  const e = { x: b.x + d2.x * rr, y: b.y + d2.y * rr };
  const out: Point[] = [s];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({ x: u * u * s.x + 2 * u * t * b.x + t * t * e.x, y: u * u * s.y + 2 * u * t * b.y + t * t * e.y });
  }
  out.push(e);
  return out;
}

export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function rotatePoints(points: Point[], angle: number, about: Point = { x: 0, y: 0 }): Point[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points.map((p) => {
    const x = p.x - about.x;
    const y = p.y - about.y;
    return { x: about.x + x * c - y * s, y: about.y + x * s + y * c };
  });
}

export function mirrorX(points: Point[], axisX = 0): Point[] {
  return points.map((p) => ({ x: 2 * axisX - p.x, y: p.y })).reverse();
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

const PALETTE = ['#f97316', '#0ea5e9', '#a855f7', '#22c55e', '#eab308', '#ef4444', '#14b8a6', '#6366f1', '#ec4899', '#84cc16', '#f59e0b', '#06b6d4'];
export function pieceColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}
