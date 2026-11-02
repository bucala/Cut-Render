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
  };
  addLine(outline, true);
  constraints.forEach((c) => addLine(c, false));
  // Subdivision does not change distances to a polyline. Keep the short drafting paths for
  // lattice clearance rather than testing every point against hundreds of redundant segments.
  const avoid = segsOf([[...outline, outline[0]], ...constraints]);

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

  const constrained = new Set(edges.map(([a, b]) => (a < b ? a * pts.length + b : b * pts.length + a)));
  // Numerically collinear border cells have no cloth area, but grow into visible fins when
  // the flat outline is wrapped onto a curved form. Let refinement repair the initial
  // connectivity first, then discard the remaining zero-area cells.
  const significant = ([a, b, c]: number[]) => Math.abs(
    (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) -
    (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]),
  ) > Math.max(1, step * step) * 1e-8;
  const initial = cdt2d(pts, edges, { exterior: true, interior: true, delaunay: false });
  const cells = delaunayFlip(pts, initial, constrained);
  const tris: number[] = [];
  for (const [a, b, c] of cells) {
    if (!significant([a, b, c])) continue;
    const cx = (pts[a][0] + pts[b][0] + pts[c][0]) / 3;
    const cy = (pts[a][1] + pts[b][1] + pts[c][1]) / 3;
    if (pointInPolygon(cx, cy, outline)) tris.push(a, b, c);
  }
  return { pts: pts.map(([x, y]) => ({ x, y })), tris };
}

const REGION_CACHE = new Map<string, RegionMesh>();

/** Reuse topology across colour/material rebuilds, never sharing mutable points or winding. */
export function cachedMeshRegion(outline: Point[], constraints: Point[][], step: number): RegionMesh {
  const key = JSON.stringify([step, outline, constraints]);
  let mesh = REGION_CACHE.get(key);
  if (mesh) REGION_CACHE.delete(key);
  else mesh = meshRegion(outline, constraints, step);
  REGION_CACHE.set(key, mesh);
  if (REGION_CACHE.size > 8) REGION_CACHE.delete(REGION_CACHE.keys().next().value!);
  return { pts: mesh.pts.map((q) => ({ ...q })), tris: [...mesh.tris] };
}

/**
 * Lawson edge flips in floating point. cdt2d's own refinement evaluates every in-circle test
 * with exact arithmetic, which made garment meshing take several seconds.
 */
function delaunayFlip(pts: [number, number][], cells: number[][], constrained: Set<number>): number[][] {
  const n = pts.length;
  const T = cells.length;
  const v = new Int32Array(T * 3);
  cells.forEach(([a, b, c], t) => {
    const ccw = (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]) > 0;
    v[t * 3] = a;
    v[t * 3 + 1] = ccw ? b : c;
    v[t * 3 + 2] = ccw ? c : b;
  });
  // nb[t * 3 + i]: triangle across edge v[i] -> v[i + 1], or -1
  const nb = new Int32Array(T * 3).fill(-1);
  const owner = new Map<number, number>();
  for (let s = 0; s < T * 3; s++) {
    const a = v[s], b = v[s - (s % 3) + ((s % 3) + 1) % 3];
    const key = a < b ? a * n + b : b * n + a;
    const o = owner.get(key);
    if (o === undefined) owner.set(key, s);
    else { nb[s] = Math.floor(o / 3); nb[o] = Math.floor(s / 3); }
  }
  const slot = (t: number, x: number, y: number) => {
    for (let i = 0; i < 3; i++) if (v[t * 3 + i] === x && v[t * 3 + (i + 1) % 3] === y) return t * 3 + i;
    return -1;
  };
  const stack: number[] = [];
  for (let t = 0; t < T; t++) stack.push(t);
  let budget = T * 40;
  while (stack.length && budget-- > 0) {
    const t = stack.pop()!;
    for (let i = 0; i < 3; i++) {
      const u = nb[t * 3 + i];
      if (u < 0) continue;
      const a = v[t * 3 + i], b = v[t * 3 + (i + 1) % 3], c = v[t * 3 + (i + 2) % 3];
      if (constrained.has(a < b ? a * n + b : b * n + a)) continue;
      const su = slot(u, b, a);
      if (su < 0) continue;
      const j = su % 3;
      const d = v[u * 3 + (j + 2) % 3];
      const [dx, dy] = pts[d];
      const ax = pts[a][0] - dx, ay = pts[a][1] - dy;
      const bx = pts[b][0] - dx, by = pts[b][1] - dy;
      const cx = pts[c][0] - dx, cy = pts[c][1] - dy;
      const la = ax * ax + ay * ay, lb = bx * bx + by * by, lc = cx * cx + cy * cy;
      const det = ax * (by * lc - lb * cy) - ay * (bx * lc - lb * cx) + la * (bx * cy - by * cx);
      if (det <= 1e-9 * (la + lb + lc) ** 2) continue;
      const nBC = nb[t * 3 + (i + 1) % 3], nCA = nb[t * 3 + (i + 2) % 3];
      const nAD = nb[u * 3 + (j + 1) % 3], nDB = nb[u * 3 + (j + 2) % 3];
      // t = (a, d, c), u = (d, b, c)
      v[t * 3] = a; v[t * 3 + 1] = d; v[t * 3 + 2] = c;
      nb[t * 3] = nAD; nb[t * 3 + 1] = u; nb[t * 3 + 2] = nCA;
      v[u * 3] = d; v[u * 3 + 1] = b; v[u * 3 + 2] = c;
      nb[u * 3] = nDB; nb[u * 3 + 1] = nBC; nb[u * 3 + 2] = t;
      if (nBC >= 0) for (let k = 0; k < 3; k++) if (nb[nBC * 3 + k] === t) nb[nBC * 3 + k] = u;
      if (nAD >= 0) for (let k = 0; k < 3; k++) if (nb[nAD * 3 + k] === u) nb[nAD * 3 + k] = t;
      stack.push(t, u);
      break;
    }
  }
  const out: number[][] = [];
  for (let t = 0; t < T; t++) out.push([v[t * 3], v[t * 3 + 1], v[t * 3 + 2]]);
  return out;
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

/** Outline vertex indices of a region mesh (the first `n` points added by meshRegion are the border). */
export function boundaryFlags(m: RegionMesh): Uint8Array {
  // count edge usage: an edge used by a single triangle is on the boundary
  const use = new Map<number, number>();
  const vertexCount = m.pts.length;
  const key = (a: number, b: number) => (a < b ? a * vertexCount + b : b * vertexCount + a);
  const t = m.tris;
  for (let k = 0; k < t.length; k += 3) {
    for (let e = 0; e < 3; e++) {
      const kk = key(t[k + e], t[k + ((e + 1) % 3)]);
      use.set(kk, (use.get(kk) ?? 0) + 1);
    }
  }
  const flags = new Uint8Array(m.pts.length);
  for (const [kk, n] of use) {
    if (n === 1) {
      const a = Math.floor(kk / vertexCount), b = kk % vertexCount;
      flags[a] = 1;
      flags[b] = 1;
    }
  }
  return flags;
}

/**
 * Cheap baked fold shading: vertices lying in a valley of the depth field (relative to their
 * neighbours, seen from the outside) are darkened. Returns per-vertex grey levels 0..1.
 */
export function cavityShade(m: RegionMesh, z: ArrayLike<number>, outwardSign: number, strength: number): Float32Array {
  const n = m.pts.length;
  const sum = new Float64Array(n);
  const cnt = new Uint16Array(n);
  const t = m.tris;
  for (let k = 0; k < t.length; k += 3) {
    for (let e = 0; e < 3; e++) {
      const a = t[k + e];
      const b = t[k + ((e + 1) % 3)];
      sum[a] += z[b];
      cnt[a]++;
      sum[b] += z[a];
      cnt[b]++;
    }
  }
  const border = boundaryFlags(m);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!cnt[i] || border[i]) {
      raw[i] = 1;
      continue;
    }
    const cav = outwardSign * (sum[i] / cnt[i] - z[i]);
    raw[i] = 1 - strength * smoothstep(0.08, 1.4, cav);
  }
  // two neighbour-averaging passes so the shading follows the folds, not the mesh lattice
  let cur = raw;
  for (let pass = 0; pass < 2; pass++) {
    const acc = new Float64Array(n);
    const num = new Uint16Array(n);
    for (let k = 0; k < t.length; k += 3) {
      for (let e = 0; e < 3; e++) {
        const a = t[k + e];
        const b = t[k + ((e + 1) % 3)];
        acc[a] += cur[b];
        num[a]++;
        acc[b] += cur[a];
        num[b]++;
      }
    }
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) next[i] = num[i] ? (cur[i] + acc[i] / num[i]) / 2 : cur[i];
    cur = next;
  }
  return cur;
}
