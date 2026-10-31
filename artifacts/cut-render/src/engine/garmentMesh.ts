/**
 * Helpers for building sewn-garment surfaces straight from pattern outlines.
 *
 * A garment is modelled as its flat silhouette (pattern pieces joined at their seams, in
 * drafting mm, y down), meshed with a constrained Delaunay triangulation, then lifted into
 * a front and a back layer. Closed seams (side, shoulder, underarm...) stay at z = 0 so the
 * two layers meet there; open edges (hem, neckline, sleeve hem) keep their depth and form
 * the openings. This keeps the 3D shape identical to the cut plan and the sleeves attached.
 */
import cdt2d from 'cdt2d';
import type { Point } from './types';

/** Segments packed as [ax, ay, bx, by, ...]. */
export type SegList = Float64Array;

export function segsOf(polylines: Point[][]): SegList {
  const out: number[] = [];
  for (const pl of polylines) {
    for (let i = 0; i < pl.length - 1; i++) out.push(pl[i].x, pl[i].y, pl[i + 1].x, pl[i + 1].y);
  }
  return Float64Array.from(out);
}

export function distToSegs(x: number, y: number, s: SegList): number {
  let best = Infinity;
  for (let i = 0; i < s.length; i += 4) {
    const ax = s[i];
    const ay = s[i + 1];
    const dx = s[i + 2] - ax;
    const dy = s[i + 3] - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - x;
    const ey = ay + dy * t - y;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Subdivide every segment so no piece is longer than `step`, keeping the original vertices. */
export function densify(pts: Point[], step: number, closed: boolean): Point[] {
  const out: Point[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}

export interface RegionMesh {
  pts: Point[];
  /** triangle vertex indices, 3 per triangle */
  tris: number[];
}

/**
 * Triangulate a simple polygon with optional interior constraint polylines (seams) whose
 * vertices are kept as mesh edges, plus a hexagonal lattice of interior points.
 */
export function meshRegion(outline: Point[], constraints: Point[][], step: number): RegionMesh {
  const pts: [number, number][] = [];
  const index = new Map<string, number>();
  const add = (p: Point) => {
    const key = `${Math.round(p.x * 50)},${Math.round(p.y * 50)}`;
    const hit = index.get(key);
    if (hit !== undefined) return hit;
    pts.push([p.x, p.y]);
    index.set(key, pts.length - 1);
    return pts.length - 1;
  };
  const edges: [number, number][] = [];
  const addLine = (pl: Point[], closed: boolean) => {
    const d = densify(pl, step * 0.75, closed);
    const ids = d.map(add);
    const n = closed ? ids.length : ids.length - 1;
    for (let i = 0; i < n; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % ids.length];
      if (a !== b) edges.push([a, b]);
    }
    return d;
  };
  const border = addLine(outline, true);
  const inner = constraints.map((c) => addLine(c, false));
  const avoid = segsOf([[...border, border[0]], ...inner]);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outline) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const rowH = step * 0.866;
  for (let r = 0, y = minY + rowH / 2; y < maxY; r++, y += rowH) {
    for (let x = minX + (r % 2 ? step / 2 : 0); x < maxX; x += step) {
      if (!pointInPolygon(x, y, outline)) continue;
      if (distToSegs(x, y, avoid) < step * 0.55) continue;
      add({ x, y });
    }
  }

  const cells = cdt2d(pts, edges, { exterior: true, interior: true, delaunay: true });
  const tris: number[] = [];
  for (const [a, b, c] of cells) {
    const cx = (pts[a][0] + pts[b][0] + pts[c][0]) / 3;
    const cy = (pts[a][1] + pts[b][1] + pts[c][1]) / 3;
    if (pointInPolygon(cx, cy, outline)) tris.push(a, b, c);
  }
  return { pts: pts.map(([x, y]) => ({ x, y })), tris };
}

/** Rounded quarter-ellipse profile: 0 at the seam, 1 once `t` reaches 1. */
export function roundProfile(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return Math.sqrt(1 - (1 - u) * (1 - u));
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
