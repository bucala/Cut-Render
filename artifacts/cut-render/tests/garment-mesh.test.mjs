import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryFlags, cachedMeshRegion, densify, distToSegs, meshRegion, segsOf } from '../src/engine/garmentMesh.ts';

const outline = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 120 }, { x: 140, y: 120 }, { x: 140, y: 400 }, { x: 0, y: 400 }];
const seam = [{ x: 0, y: 200 }, { x: 140, y: 200 }];

test('fast Delaunay meshing covers the outline, keeps seams and is locally Delaunay', () => {
  const started = performance.now();
  const { pts, tris } = meshRegion(outline, [seam], 8);
  assert.ok(performance.now() - started < 1000);
  let area = 0;
  const edges = new Map();
  for (let k = 0; k < tris.length; k += 3) {
    const [a, b, c] = [pts[tris[k]], pts[tris[k + 1]], pts[tris[k + 2]]];
    area += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    for (let e = 0; e < 3; e++) {
      const i = tris[k + e], j = tris[k + (e + 1) % 3], o = tris[k + (e + 2) % 3];
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      edges.set(key, [...(edges.get(key) ?? []), [i, j, o]]);
    }
  }
  assert.ok(Math.abs(area - (300 * 120 + 140 * 280)) < 1e-6);
  const onSeam = (p) => Math.abs(p.y - 200) < 1e-6 && p.x >= 0 && p.x <= 140;
  let seamEdges = 0, illegal = 0;
  for (const [key, list] of edges) {
    const [i, j] = key.split(':').map(Number);
    if (onSeam(pts[i]) && onSeam(pts[j])) { seamEdges++; continue; }
    if (list.length !== 2) continue;
    const [a, b, c] = list[0].map((n) => pts[n]);
    const d = pts[list[1][2]];
    const ax = a.x - d.x, ay = a.y - d.y, bx = b.x - d.x, by = b.y - d.y, cx = c.x - d.x, cy = c.y - d.y;
    const orient = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const det = ((ax * ax + ay * ay) * (bx * cy - by * cx) - (bx * bx + by * by) * (ax * cy - ay * cx) + (cx * cx + cy * cy) * (ax * by - ay * bx)) * Math.sign(orient);
    if (det > 1e-6 * (ax * ax + ay * ay + bx * bx + by * by + cx * cx + cy * cy) ** 2) illegal++;
  }
  assert.ok(seamEdges >= Math.floor(140 / 6));
  assert.equal(illegal, 0);
});

test('lattice clearance is unchanged when using drafting segments instead of their subdivisions', () => {
  const denseOutline = densify(outline, 6, true), denseSeam = densify(seam, 6, false);
  const raw = segsOf([[...outline, outline[0]], seam]);
  const dense = segsOf([[...denseOutline, denseOutline[0]], denseSeam]);
  for (let y = -10; y < 420; y += 17) for (let x = -10; x < 320; x += 19) {
    assert.ok(Math.abs(distToSegs(x, y, raw) - distToSegs(x, y, dense)) < 1e-9);
  }
});

test('topology cache includes outlines, seams and density and never shares mutable winding or points', () => {
  const a = cachedMeshRegion(outline, [seam], 8), original = structuredClone(a);
  a.pts[0].x += 1000;
  a.tris.reverse();
  const b = cachedMeshRegion(outline, [seam], 8);
  assert.deepEqual(b, original);
  assert.notEqual(a.pts, b.pts);
  assert.notEqual(a.tris, b.tris);
  assert.deepEqual(cachedMeshRegion(outline, [seam], 12), meshRegion(outline, [seam], 12));
  const secondSeam = [{ x: 0, y: 300 }, { x: 140, y: 300 }];
  assert.deepEqual(cachedMeshRegion(outline, [seam, secondSeam], 8), meshRegion(outline, [seam, secondSeam], 8));
  const shifted = outline.map((p) => ({ x: p.x + 12, y: p.y + 7 }));
  const shiftedSeam = seam.map((p) => ({ x: p.x + 12, y: p.y + 7 }));
  assert.deepEqual(cachedMeshRegion(shifted, [shiftedSeam], 8), meshRegion(shifted, [shiftedSeam], 8));
});

test('packed boundary edges distinguish opposite winding and keep interior vertices unmarked', () => {
  const pts = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 1 }];
  const tris = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4];
  assert.deepEqual([...boundaryFlags({ pts, tris })], [1, 1, 1, 1, 0]);
  assert.deepEqual([...boundaryFlags({ pts: [], tris: [] })], []);
});

test('rotated densely sampled borders do not grow zero-area fins or pinched openings', () => {
  const angle = 50 * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const outline = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 500 }, { x: 0, y: 500 }]
    .map((p) => ({ x: 186 + p.x * c - p.y * s, y: 20 + p.x * s + p.y * c }));
  const { pts, tris } = meshRegion(outline, [], 7);
  let totalArea = 0;
  const edges = new Map();
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = tris.slice(i, i + 3).map((j) => pts[j]);
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    assert.ok(area > 1e-6, 'a flat sliver becomes a real fin when the garment is curved');
    totalArea += area;
    for (let e = 0; e < 3; e++) {
      const a = tris[i + e], b = tris[i + (e + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  assert.ok(Math.abs(totalArea - 300 * 500) < 1e-6);
  const degree = new Map();
  for (const [key, count] of edges) {
    assert.ok(count <= 2);
    if (count === 1) for (const id of key.split(':')) degree.set(id, (degree.get(id) ?? 0) + 1);
  }
  assert.ok([...degree.values()].every((n) => n === 2), 'each opening must be a simple loop');
});
