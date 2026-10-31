import test from 'node:test';
import assert from 'node:assert/strict';
import { meshRegion } from '../src/engine/garmentMesh.ts';

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
