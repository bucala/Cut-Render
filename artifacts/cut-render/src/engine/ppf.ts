import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CutPlan, LineKind, PlanPath, PlanPiece, Point, ProgressCallback } from './types';
import { finalizeModel, type FormatInfo, type ImportedModel } from './importers';
import { boundsOf, offsetPolygon, pieceColor, polygonArea, polylineLength, translatePoints, rotatePoints, round1 } from './geom';
import { createPaintMaterial, createPhysicalMaterial } from './materials';

export interface PpfParams {
  /** Millimetres per model unit (set from the import unit guess, user adjustable) */
  mmPerUnit: number;
  /** Max angle between surface normals inside one film piece; lower = more, flatter pieces */
  maxAngleDeg: number;
  /** Extra film added around each piece to wrap edges, in mm */
  wrapMm: number;
  /** Film roll width in mm */
  rollWidthMm: number;
  /** Gap between nested pieces on the roll in mm */
  spacingMm: number;
  /** Base paint of the object under the film */
  paintId: string;
}

export function defaultPpfParams(): PpfParams {
  return { mmPerUnit: 1, maxAngleDeg: 35, wrapMm: 15, rollWidthMm: 1524, spacingMm: 10, paintId: 'racing-red' };
}

export interface PpfResult {
  plan: CutPlan;
  /** For each triangle of model.geometry: index of the piece it belongs to */
  pieceOfTriangle: Int32Array;
  /** Flattened coordinates (mm, piece local) for each triangle corner: [u0,v0,u1,v1,u2,v2] per triangle */
  cornerUv?: Float32Array;
}

const yieldUi = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Mesh topology helpers
// ---------------------------------------------------------------------------

interface Topology {
  pos: Float32Array; // mm
  idx: Uint32Array;
  triCount: number;
  normals: Float32Array; // per triangle
  areas: Float64Array; // mm²
  /** 3 neighbour triangles per triangle (-1 = boundary) */
  nbr: Int32Array;
}

function buildTopology(geo: THREE.BufferGeometry, mmPerUnit: number): Topology {
  const src = geo.attributes.position;
  const pos = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) {
    pos[i * 3] = src.getX(i) * mmPerUnit;
    pos[i * 3 + 1] = src.getY(i) * mmPerUnit;
    pos[i * 3 + 2] = src.getZ(i) * mmPerUnit;
  }
  const index = geo.index!;
  const triCount = index.count / 3;
  const idx = new Uint32Array(index.count);
  for (let i = 0; i < index.count; i++) idx[i] = index.getX(i);
  const normals = new Float32Array(triCount * 3);
  const areas = new Float64Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const e1x = pos[b] - pos[a];
    const e1y = pos[b + 1] - pos[a + 1];
    const e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a];
    const e2y = pos[c + 1] - pos[a + 1];
    const e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    areas[t] = l / 2;
    normals[t * 3] = l ? nx / l : 0;
    normals[t * 3 + 1] = l ? ny / l : 1;
    normals[t * 3 + 2] = l ? nz / l : 0;
  }
  const nbr = new Int32Array(triCount * 3).fill(-1);
  const edgeMap = new Map<string, number>();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t * 3 + k];
      const b = idx[t * 3 + ((k + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const other = edgeMap.get(key);
      if (other === undefined) edgeMap.set(key, t * 3 + k);
      else if (other >= 0) {
        const ot = Math.floor(other / 3);
        nbr[t * 3 + k] = ot;
        nbr[other] = t;
        edgeMap.set(key, -1); // non-manifold beyond two faces: ignore further
      }
    }
  }
  return { pos, idx, triCount, normals, areas, nbr };
}

// ---------------------------------------------------------------------------
// Segmentation: region growing on normal deviation
// ---------------------------------------------------------------------------

function segment(topo: Topology, maxAngleDeg: number): { region: Int32Array; count: number } {
  const { triCount, normals, areas, nbr } = topo;
  const region = new Int32Array(triCount).fill(-1);
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  const cosSharp = Math.cos((Math.min(80, Math.max(maxAngleDeg * 1.6, 40)) * Math.PI) / 180);
  let count = 0;
  let remaining = triCount;
  const queue = new Int32Array(triCount);
  while (remaining > 0) {
    // seed: unassigned triangle whose normal is closest to the mean normal of the unassigned area
    let mx = 0,
      my = 0,
      mz = 0;
    for (let t = 0; t < triCount; t++) {
      if (region[t] !== -1) continue;
      mx += normals[t * 3] * areas[t];
      my += normals[t * 3 + 1] * areas[t];
      mz += normals[t * 3 + 2] * areas[t];
    }
    const ml = Math.hypot(mx, my, mz);
    let seed = -1;
    let best = -Infinity;
    for (let t = 0; t < triCount; t++) {
      if (region[t] !== -1) continue;
      const d = ml > 1e-9 ? (normals[t * 3] * mx + normals[t * 3 + 1] * my + normals[t * 3 + 2] * mz) / ml : areas[t];
      if (d > best) {
        best = d;
        seed = t;
      }
    }
    const r = count++;
    region[seed] = r;
    remaining--;
    let ax = normals[seed * 3] * areas[seed];
    let ay = normals[seed * 3 + 1] * areas[seed];
    let az = normals[seed * 3 + 2] * areas[seed];
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    while (head < tail) {
      const t = queue[head++];
      for (let k = 0; k < 3; k++) {
        const o = nbr[t * 3 + k];
        if (o < 0 || region[o] !== -1) continue;
        const ox = normals[o * 3];
        const oy = normals[o * 3 + 1];
        const oz = normals[o * 3 + 2];
        // sharp crease between neighbours always splits
        if (ox * normals[t * 3] + oy * normals[t * 3 + 1] + oz * normals[t * 3 + 2] < cosSharp) continue;
        const al = Math.hypot(ax, ay, az) || 1;
        if ((ox * ax + oy * ay + oz * az) / al < cosMax) continue;
        region[o] = r;
        remaining--;
        ax += ox * areas[o];
        ay += oy * areas[o];
        az += oz * areas[o];
        queue[tail++] = o;
      }
    }
  }
  return { region, count };
}

/** Merge tiny regions into their best neighbour and renumber regions 0..n-1. */
function mergeSmallRegions(topo: Topology, region: Int32Array, count: number): number {
  const { triCount, areas, nbr } = topo;
  let totalArea = 0;
  for (let t = 0; t < triCount; t++) totalArea += areas[t];
  for (let pass = 0; pass < 4; pass++) {
    const rArea = new Float64Array(count);
    const rTris = new Int32Array(count);
    for (let t = 0; t < triCount; t++) {
      rArea[region[t]] += areas[t];
      rTris[region[t]]++;
    }
    let changed = false;
    for (let r = 0; r < count; r++) {
      if (rTris[r] === 0) continue;
      if (rArea[r] > totalArea * 0.006 && rTris[r] > 12) continue;
      // shared boundary with each neighbour region
      const shared = new Map<number, number>();
      for (let t = 0; t < triCount; t++) {
        if (region[t] !== r) continue;
        for (let k = 0; k < 3; k++) {
          const o = nbr[t * 3 + k];
          if (o >= 0 && region[o] !== r) shared.set(region[o], (shared.get(region[o]) ?? 0) + 1);
        }
      }
      let target = -1;
      let bestShared = 0;
      for (const [rr, s] of shared) if (s > bestShared) ((bestShared = s), (target = rr));
      if (target < 0) continue;
      for (let t = 0; t < triCount; t++) if (region[t] === r) region[t] = target;
      changed = true;
    }
    if (!changed) break;
  }
  // renumber, largest region first
  const rArea = new Map<number, number>();
  for (let t = 0; t < triCount; t++) rArea.set(region[t], (rArea.get(region[t]) ?? 0) + areas[t]);
  const order = [...rArea.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  const remap = new Map(order.map((r, i) => [r, i]));
  for (let t = 0; t < triCount; t++) region[t] = remap.get(region[t])!;
  return order.length;
}

/** Split regions that are not edge-connected into separate regions. */
function splitDisconnected(topo: Topology, region: Int32Array, count: number): number {
  const { triCount, nbr } = topo;
  const out = new Int32Array(triCount).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let s = 0; s < triCount; s++) {
    if (out[s] !== -1) continue;
    const r = region[s];
    const id = next++;
    out[s] = id;
    stack.push(s);
    while (stack.length) {
      const t = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const o = nbr[t * 3 + k];
        if (o >= 0 && out[o] === -1 && region[o] === r) {
          out[o] = id;
          stack.push(o);
        }
      }
    }
  }
  region.set(out);
  void count;
  return next;
}

// ---------------------------------------------------------------------------
// LSCM flattening (least squares conformal maps) solved with Jacobi-PCG
// ---------------------------------------------------------------------------

interface Flattened {
  /** local vertex -> global vertex */
  verts: number[];
  /** uv in mm per local vertex */
  uv: Float64Array;
  /** triangles as local vertex indices */
  tris: Int32Array;
  /** global triangle ids */
  triIds: number[];
  maxStretch: number;
  avgStretch: number;
  flipped: number;
}

function flattenRegion(topo: Topology, triIds: number[]): Flattened {
  const { pos, idx, normals, areas } = topo;
  const local = new Map<number, number>();
  const verts: number[] = [];
  const tris = new Int32Array(triIds.length * 3);
  triIds.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const g = idx[t * 3 + k];
      let l = local.get(g);
      if (l === undefined) {
        l = verts.length;
        local.set(g, l);
        verts.push(g);
      }
      tris[i * 3 + k] = l;
    }
  });
  const n = verts.length;
  const T = triIds.length;

  // region frame from the area-weighted mean normal
  let nx = 0,
    ny = 0,
    nz = 0;
  for (const t of triIds) {
    nx += normals[t * 3] * areas[t];
    ny += normals[t * 3 + 1] * areas[t];
    nz += normals[t * 3 + 2] * areas[t];
  }
  const N = new THREE.Vector3(nx, ny, nz);
  if (N.lengthSq() < 1e-12) N.set(0, 1, 0);
  N.normalize();
  const helper = Math.abs(N.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const X = new THREE.Vector3().crossVectors(helper, N).normalize();
  const Y = new THREE.Vector3().crossVectors(N, X).normalize();

  // initial guess: orthographic projection on the region plane
  const x = new Float64Array(2 * n);
  for (let l = 0; l < n; l++) {
    const g = verts[l] * 3;
    x[l] = pos[g] * X.x + pos[g + 1] * X.y + pos[g + 2] * X.z;
    x[n + l] = pos[g] * Y.x + pos[g + 1] * Y.y + pos[g + 2] * Y.z;
  }

  // per-triangle LSCM coefficients (a_j, b_j) and weight
  const coef = new Float64Array(T * 6);
  const w = new Float64Array(T);
  const triLocal = new Float64Array(T * 6); // local 2D coordinates of each triangle (for stretch)
  for (let i = 0; i < T; i++) {
    const t = triIds[i];
    const pa = idx[t * 3] * 3;
    const pb = idx[t * 3 + 1] * 3;
    const pc = idx[t * 3 + 2] * 3;
    const e1 = new THREE.Vector3(pos[pb] - pos[pa], pos[pb + 1] - pos[pa + 1], pos[pb + 2] - pos[pa + 2]);
    const e2 = new THREE.Vector3(pos[pc] - pos[pa], pos[pc + 1] - pos[pa + 1], pos[pc + 2] - pos[pa + 2]);
    const l1 = e1.length() || 1e-9;
    const ex = e1.clone().divideScalar(l1);
    const tn = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const ey = new THREE.Vector3().crossVectors(tn, ex);
    const xs = [0, l1, e2.dot(ex)];
    const ys = [0, 0, e2.dot(ey)];
    for (let j = 0; j < 3; j++) {
      const k = (j + 1) % 3;
      const m = (j + 2) % 3;
      coef[i * 6 + j * 2] = xs[m] - xs[k];
      coef[i * 6 + j * 2 + 1] = ys[m] - ys[k];
      triLocal[i * 6 + j * 2] = xs[j];
      triLocal[i * 6 + j * 2 + 1] = ys[j];
    }
    w[i] = 1 / Math.sqrt(Math.max(areas[t], 1e-12));
  }

  // pins: the two most distant vertices along the dominant projected direction
  let p0 = 0,
    p1 = 0;
  {
    let minS = Infinity,
      maxS = -Infinity;
    for (let l = 0; l < n; l++) {
      const s = x[l] + 0.37 * x[n + l];
      if (s < minS) ((minS = s), (p0 = l));
      if (s > maxS) ((maxS = s), (p1 = l));
    }
    let far = -1;
    for (let l = 0; l < n; l++) {
      const d = (x[l] - x[p0]) ** 2 + (x[n + l] - x[n + p0]) ** 2;
      if (d > far) ((far = d), (p1 = l));
    }
    far = -1;
    for (let l = 0; l < n; l++) {
      const d = (x[l] - x[p1]) ** 2 + (x[n + l] - x[n + p1]) ** 2;
      if (d > far) ((far = d), (p0 = l));
    }
  }
  const pinned = new Uint8Array(2 * n);
  if (n >= 3 && p0 !== p1) {
    pinned[p0] = pinned[n + p0] = 1;
    pinned[p1] = pinned[n + p1] = 1;
    // pin distance = geodesic-ish 3D distance so the scale is close to 1:1
    const g0 = verts[p0] * 3;
    const g1 = verts[p1] * 3;
    const d3 = Math.hypot(pos[g1] - pos[g0], pos[g1 + 1] - pos[g0 + 1], pos[g1 + 2] - pos[g0 + 2]);
    const dx = x[p1] - x[p0];
    const dy = x[n + p1] - x[n + p0];
    const d2 = Math.hypot(dx, dy) || 1;
    x[p1] = x[p0] + (dx / d2) * d3;
    x[n + p1] = x[n + p0] + (dy / d2) * d3;
  }

  // operator y = AᵀA v (v with pinned components treated as given)
  const resid = new Float64Array(2 * T);
  const applyA = (v: Float64Array, out: Float64Array) => {
    for (let i = 0; i < T; i++) {
      let r = 0,
        s = 0;
      for (let j = 0; j < 3; j++) {
        const l = tris[i * 3 + j];
        const a = coef[i * 6 + j * 2];
        const b = coef[i * 6 + j * 2 + 1];
        const u = v[l];
        const vv = v[n + l];
        r += a * u - b * vv;
        s += b * u + a * vv;
      }
      out[i * 2] = r * w[i];
      out[i * 2 + 1] = s * w[i];
    }
  };
  const applyAt = (res: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let i = 0; i < T; i++) {
      const r = res[i * 2] * w[i];
      const s = res[i * 2 + 1] * w[i];
      for (let j = 0; j < 3; j++) {
        const l = tris[i * 3 + j];
        const a = coef[i * 6 + j * 2];
        const b = coef[i * 6 + j * 2 + 1];
        out[l] += a * r + b * s;
        out[n + l] += -b * r + a * s;
      }
    }
  };
  const diag = new Float64Array(2 * n);
  for (let i = 0; i < T; i++) {
    for (let j = 0; j < 3; j++) {
      const l = tris[i * 3 + j];
      const a = coef[i * 6 + j * 2];
      const b = coef[i * 6 + j * 2 + 1];
      const d = (a * a + b * b) * w[i] * w[i];
      diag[l] += d;
      diag[n + l] += d;
    }
  }

  if (n >= 3 && p0 !== p1) {
    // residual r = -AᵀA x (restricted to free vars)
    const r = new Float64Array(2 * n);
    const tmp = new Float64Array(2 * n);
    applyA(x, resid);
    applyAt(resid, tmp);
    for (let i = 0; i < 2 * n; i++) r[i] = pinned[i] ? 0 : -tmp[i];
    const z = new Float64Array(2 * n);
    for (let i = 0; i < 2 * n; i++) z[i] = pinned[i] ? 0 : r[i] / (diag[i] || 1);
    const p = Float64Array.from(z);
    let rz = 0;
    for (let i = 0; i < 2 * n; i++) rz += r[i] * z[i];
    const r0 = Math.sqrt(r.reduce((s, v) => s + v * v, 0)) || 1;
    const maxIter = Math.min(4000, 200 + n * 2);
    const Ap = new Float64Array(2 * n);
    for (let it = 0; it < maxIter; it++) {
      applyA(p, resid);
      applyAt(resid, Ap);
      let pAp = 0;
      for (let i = 0; i < 2 * n; i++) {
        if (pinned[i]) Ap[i] = 0;
        pAp += p[i] * Ap[i];
      }
      if (pAp <= 1e-30) break;
      const alpha = rz / pAp;
      let rr = 0;
      for (let i = 0; i < 2 * n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        rr += r[i] * r[i];
      }
      if (Math.sqrt(rr) < 1e-7 * r0) break;
      let rzNew = 0;
      for (let i = 0; i < 2 * n; i++) {
        z[i] = pinned[i] ? 0 : r[i] / (diag[i] || 1);
        rzNew += r[i] * z[i];
      }
      const beta = rzNew / (rz || 1e-30);
      rz = rzNew;
      for (let i = 0; i < 2 * n; i++) p[i] = z[i] + beta * p[i];
    }
  }

  // orientation: keep outside-view (positive signed area)
  let signed = 0;
  for (let i = 0; i < T; i++) {
    const a = tris[i * 3];
    const b = tris[i * 3 + 1];
    const c = tris[i * 3 + 2];
    signed += (x[b] - x[a]) * (x[n + c] - x[n + a]) - (x[c] - x[a]) * (x[n + b] - x[n + a]);
  }
  if (signed < 0) for (let l = 0; l < n; l++) x[n + l] = -x[n + l];

  // uniform scale so flat area == 3D area
  let area2 = 0;
  let area3 = 0;
  for (let i = 0; i < T; i++) {
    const a = tris[i * 3];
    const b = tris[i * 3 + 1];
    const c = tris[i * 3 + 2];
    area2 += Math.abs((x[b] - x[a]) * (x[n + c] - x[n + a]) - (x[c] - x[a]) * (x[n + b] - x[n + a])) / 2;
    area3 += areas[triIds[i]];
  }
  const k = area2 > 0 ? Math.sqrt(area3 / area2) : 1;
  const uv = new Float64Array(2 * n);
  for (let l = 0; l < n; l++) {
    uv[l * 2] = x[l] * k;
    uv[l * 2 + 1] = x[n + l] * k;
  }

  // stretch: singular values of the 3D->2D Jacobian per triangle
  const stretches: { s: number; a: number }[] = [];
  let flipped = 0;
  let sumS = 0;
  for (let i = 0; i < T; i++) {
    const [x0, y0, x1, y1, x2, y2] = triLocal.subarray(i * 6, i * 6 + 6);
    const a = tris[i * 3];
    const b = tris[i * 3 + 1];
    const c = tris[i * 3 + 2];
    const du1 = uv[b * 2] - uv[a * 2];
    const dv1 = uv[b * 2 + 1] - uv[a * 2 + 1];
    const du2 = uv[c * 2] - uv[a * 2];
    const dv2 = uv[c * 2 + 1] - uv[a * 2 + 1];
    const px1 = x1 - x0;
    const py1 = y1 - y0;
    const px2 = x2 - x0;
    const py2 = y2 - y0;
    const det = px1 * py2 - px2 * py1;
    if (Math.abs(det) < 1e-12) continue;
    // J = [du1 du2; dv1 dv2] * inv([px1 px2; py1 py2])
    const i00 = py2 / det;
    const i01 = -px2 / det;
    const i10 = -py1 / det;
    const i11 = px1 / det;
    const ja = du1 * i00 + du2 * i10;
    const jb = du1 * i01 + du2 * i11;
    const jc = dv1 * i00 + dv2 * i10;
    const jd = dv1 * i01 + dv2 * i11;
    const jdet = ja * jd - jb * jc;
    if (jdet <= 0) flipped++;
    const q = (ja * ja + jb * jb + jc * jc + jd * jd) / 2;
    const disc = Math.sqrt(Math.max(0, q * q - jdet * jdet));
    const s1 = Math.sqrt(q + disc);
    const s2 = Math.sqrt(Math.max(0, q - disc));
    // the film has to stretch by 1/s where the flat piece is smaller than the surface
    const s = Math.max(Math.abs(1 / Math.max(s2, 1e-6) - 1), Math.abs(s1 - 1));
    const ar = areas[triIds[i]];
    stretches.push({ s: Math.min(s, 5), a: ar });
    sumS += Math.min(s, 5) * ar;
  }
  stretches.sort((p, q) => p.s - q.s);
  // area-weighted 98th percentile ignores sliver artefacts
  let acc = 0;
  let maxStretch = 0;
  for (const st of stretches) {
    acc += st.a;
    maxStretch = st.s;
    if (acc >= area3 * 0.98) break;
  }
  return { verts, uv, tris, triIds, maxStretch, avgStretch: area3 ? sumS / area3 : 0, flipped };
}

// ---------------------------------------------------------------------------
// Boundary extraction
// ---------------------------------------------------------------------------

function boundaryLoops(f: Flattened): Point[][] {
  const { tris, uv } = f;
  const half = new Set<string>();
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) half.add(`${tris[i + k]}_${tris[i + ((k + 1) % 3)]}`);
  const next = new Map<number, number[]>();
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = tris[i + k];
      const b = tris[i + ((k + 1) % 3)];
      if (!half.has(`${b}_${a}`)) {
        if (!next.has(a)) next.set(a, []);
        next.get(a)!.push(b);
      }
    }
  }
  const loops: Point[][] = [];
  const used = new Set<string>();
  for (const [start, outs] of next) {
    for (const first of outs) {
      if (used.has(`${start}_${first}`)) continue;
      const loop: number[] = [start];
      let a = start;
      let b = first;
      let guard = 0;
      while (guard++ < 1e6) {
        used.add(`${a}_${b}`);
        if (b === start) break;
        loop.push(b);
        const cand = (next.get(b) ?? []).filter((c) => !used.has(`${b}_${c}`));
        if (!cand.length) break;
        a = b;
        b = cand[0];
      }
      if (loop.length >= 3) loops.push(loop.map((l) => ({ x: uv[l * 2], y: -uv[l * 2 + 1] })));
    }
  }
  return loops;
}

function douglasPeucker(points: Point[], tol: number): Point[] {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const a = points[s];
    const b = points[e];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((points[i].x - a.x) * dy - (points[i].y - a.y) * dx) / len;
      if (d > maxD) ((maxD = d), (idx = i));
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function simplifyLoop(loop: Point[], tol: number): Point[] {
  if (loop.length < 8) return loop;
  // split the closed loop at its two farthest points so DP keeps the shape
  let far = 0;
  let fi = 0;
  for (let i = 0; i < loop.length; i++) {
    const d = (loop[i].x - loop[0].x) ** 2 + (loop[i].y - loop[0].y) ** 2;
    if (d > far) ((far = d), (fi = i));
  }
  const a = douglasPeucker(loop.slice(0, fi + 1), tol);
  const b = douglasPeucker([...loop.slice(fi), loop[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}


/** Resample a closed loop to (roughly) uniform spacing. */
function resampleLoop(loop: Point[], step: number): Point[] {
  const per = polylineLength(loop, true);
  const n = Math.max(12, Math.min(4000, Math.round(per / Math.max(step, 1e-6))));
  const out: Point[] = [];
  const segLen: number[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    segLen.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  let seg = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k * per) / n;
    while (seg < loop.length - 1 && acc + segLen[seg] < target) acc += segLen[seg++];
    const a = loop[seg];
    const b = loop[(seg + 1) % loop.length];
    const t = segLen[seg] > 0 ? (target - acc) / segLen[seg] : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Taubin (shrink-free) smoothing of a closed loop. */
function taubinSmooth(loop: Point[], iterations: number): Point[] {
  let pts = loop.map((p) => ({ ...p }));
  const n = pts.length;
  const pass = (f: number) => {
    const next = pts.map((p, i) => {
      const a = pts[(i - 1 + n) % n];
      const b = pts[(i + 1) % n];
      return { x: p.x + f * ((a.x + b.x) / 2 - p.x), y: p.y + f * ((a.y + b.y) / 2 - p.y) };
    });
    pts = next;
  };
  for (let i = 0; i < iterations; i++) {
    pass(0.5);
    pass(-0.53);
  }
  return pts;
}


function segIntersect(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const q = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * q.y - r.y * q.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * q.y - (c.y - a.y) * q.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/** Cut away the small "swallowtail" loops an offset creates in tight concave spots. */
function removeSelfIntersections(poly: Point[]): Point[] {
  let pts = poly.slice();
  for (let guard = 0; guard < 400; guard++) {
    const n = pts.length;
    if (n < 4) return pts;
    let found = false;
    outer: for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const c = pts[j];
        const d = pts[(j + 1) % n];
        const x = segIntersect(a, b, c, d);
        if (!x) continue;
        // two candidate loops: (i+1..j) and the rest; drop the one with fewer points
        const inner = j - i;
        if (inner <= n - inner) pts = [...pts.slice(0, i + 1), x, ...pts.slice(j + 1)];
        else pts = [x, ...pts.slice(i + 1, j + 1)];
        found = true;
        break outer;
      }
    }
    if (!found) break;
  }
  return pts;
}

/** Smooth the stair-stepped triangle boundary into a clean cutting curve. */
function cleanLoop(loop: Point[], edgeLen: number): Point[] {
  const step = Math.max(edgeLen / 2, 0.5);
  const smooth = taubinSmooth(resampleLoop(loop, step), 60);
  return simplifyLoop(smooth, 0.12);
}

// ---------------------------------------------------------------------------
// Naming and nesting
// ---------------------------------------------------------------------------

function directionName(n: THREE.Vector3): string {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return n.y > 0 ? 'Vrch' : 'Spodok';
  if (az >= ax) return n.z > 0 ? 'Predok' : 'Zadok';
  return n.x > 0 ? 'Pravý bok' : 'Ľavý bok';
}

interface RawPiece {
  name: string;
  outer: Point[];
  holes: Point[][];
  net: Point[][];
  maxStretch: number;
  avgStretch: number;
  areaMm2: number;
  region: number;
}

function packOnRoll(pieces: RawPiece[], rollW: number, gap: number, warnings: string[]): { placed: RawPiece[]; length: number } {
  const margin = 10;
  const usable = rollW - 2 * margin;
  type Item = { p: RawPiece; angle: number; w: number; h: number; minX: number; minY: number };
  const items: Item[] = pieces.map((p) => {
    let best: Item | null = null;
    let bestFit: Item | null = null;
    for (let k = 0; k < 12; k++) {
      const angle = (k * Math.PI) / 12;
      const b = boundsOf(rotatePoints(p.outer, angle));
      const it: Item = { p, angle, w: b.maxX - b.minX, h: b.maxY - b.minY, minX: b.minX, minY: b.minY };
      if (it.h <= usable && (!bestFit || it.w * Math.max(it.h, 1) < bestFit.w * Math.max(bestFit.h, 1) - 1e-6 || (Math.abs(it.w * it.h - bestFit.w * bestFit.h) < 1e-6 && it.w < bestFit.w)))
        bestFit = it;
      if (!best || it.h < best.h) best = it;
    }
    if (!bestFit) warnings.push(`Diel „${p.name}“ je širší (${Math.round(best!.h)} mm) ako rola ${rollW} mm — zvoľte širšiu rolu alebo nižší max. uhol.`);
    return bestFit ?? best!;
  });
  items.sort((a, b) => b.h - a.h || b.w - a.w);
  const columns: { x: number; y: number; width: number }[] = [];
  let cursorX = margin;
  const placed: RawPiece[] = [];
  let length = margin;
  for (const it of items) {
    let col = columns.find((c) => c.y + it.h <= rollW - margin && it.w <= c.width + 1);
    const last = columns[columns.length - 1];
    if (!col && last && last.y + it.h <= rollW - margin) {
      last.width = Math.max(last.width, it.w);
      cursorX = last.x + last.width + gap;
      col = last;
    }
    if (!col) {
      col = { x: cursorX, y: margin, width: it.w };
      columns.push(col);
      cursorX += it.w + gap;
    }
    const dx = col.x - it.minX;
    const dy = col.y - it.minY;
    const tf = (pts: Point[]) => translatePoints(rotatePoints(pts, it.angle), dx, dy);
    placed.push({ ...it.p, outer: tf(it.p.outer), holes: it.p.holes.map(tf), net: it.p.net.map(tf) });
    col.y += it.h + gap;
    length = Math.max(length, col.x + it.w + margin);
  }
  // keep plan pieces in region order so pieceOfTriangle indices match
  placed.sort((a, b) => a.region - b.region);
  return { placed, length };
}

/** Segment the surface into film pieces, flatten each piece (conformal unfolding) and nest them on the roll. */
export async function generatePpfPlan(model: ImportedModel, params: PpfParams, onProgress?: ProgressCallback): Promise<PpfResult> {
  const p = { ...defaultPpfParams(), ...params };
  const warnings: string[] = [];
  onProgress?.({ stage: 'Pripravujem sieť', progress: 0.02 });
  await yieldUi();
  const topo = buildTopology(model.geometry, p.mmPerUnit);
  if (topo.triCount > 150000) warnings.push(`Model má ${topo.triCount.toLocaleString('sk-SK')} trojuholníkov — výpočet je pomalší, zvážte zjednodušenie siete.`);

  onProgress?.({ stage: 'Segmentujem povrch', progress: 0.08 });
  await yieldUi();
  const seg = segment(topo, THREE.MathUtils.clamp(p.maxAngleDeg, 3, 90));
  let count = mergeSmallRegions(topo, seg.region, seg.count);
  count = splitDisconnected(topo, seg.region, count);
  count = mergeSmallRegions(topo, seg.region, count);
  const region = seg.region;

  const byRegion: number[][] = Array.from({ length: count }, () => []);
  for (let t = 0; t < topo.triCount; t++) byRegion[region[t]].push(t);

  const cornerUv = new Float32Array(topo.triCount * 6);
  const raw: RawPiece[] = [];
  const dirCount = new Map<string, number>();
  for (let r = 0; r < count; r++) {
    onProgress?.({ stage: `Rozvíjam diel ${r + 1} / ${count}`, progress: 0.12 + (0.78 * r) / count });
    await yieldUi();
    const tris = byRegion[r];
    const f = flattenRegion(topo, tris);
    // corner uvs for textures following the film
    f.triIds.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const l = f.tris[i * 3 + k];
        cornerUv[t * 6 + k * 2] = f.uv[l * 2];
        cornerUv[t * 6 + k * 2 + 1] = f.uv[l * 2 + 1];
      }
    });
    let edgeSum = 0;
    for (let i = 0; i < f.tris.length; i += 3) {
      const a = f.tris[i];
      const b = f.tris[i + 1];
      edgeSum += Math.hypot(f.uv[b * 2] - f.uv[a * 2], f.uv[b * 2 + 1] - f.uv[a * 2 + 1]);
    }
    const edgeLen = f.tris.length ? edgeSum / (f.tris.length / 3) : 1;
    const loops = boundaryLoops(f).map((l) => cleanLoop(l, edgeLen));
    if (!loops.length) continue;
    loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
    const outerNet = loops[0];
    const holesNet = loops.slice(1).filter((h) => Math.abs(polygonArea(h)) > 25);
    const outer = p.wrapMm > 0 ? simplifyLoop(removeSelfIntersections(offsetPolygon(outerNet, p.wrapMm)), 0.12) : outerNet;
    const holes: Point[][] = [];
    for (const h of holesNet) {
      if (p.wrapMm <= 0) {
        holes.push(h);
        continue;
      }
      const shrunk = removeSelfIntersections(offsetPolygon(h, -p.wrapMm));
      const a0 = polygonArea(h);
      const a1 = polygonArea(shrunk);
      if (Math.sign(a0) === Math.sign(a1) && Math.abs(a1) > Math.abs(a0) * 0.15 && Math.abs(a1) < Math.abs(a0)) holes.push(shrunk);
    }
    let mx = 0,
      my = 0,
      mz = 0;
    let area3 = 0;
    for (const t of tris) {
      mx += topo.normals[t * 3] * topo.areas[t];
      my += topo.normals[t * 3 + 1] * topo.areas[t];
      mz += topo.normals[t * 3 + 2] * topo.areas[t];
      area3 += topo.areas[t];
    }
    const dir = directionName(new THREE.Vector3(mx, my, mz));
    const dn = (dirCount.get(dir) ?? 0) + 1;
    dirCount.set(dir, dn);
    const areaMm2 = Math.abs(polygonArea(outer)) - holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0);
    raw.push({ name: `${dir} ${dn}`, outer, holes, net: [outerNet, ...holesNet], maxStretch: f.maxStretch, avgStretch: f.avgStretch, areaMm2, region: r });
    void area3;
  }
  // rename pieces that have a unique direction name without the number
  for (const rp of raw) {
    const base = rp.name.replace(/ \d+$/, '');
    if (dirCount.get(base) === 1) rp.name = base;
    if (rp.maxStretch > 0.15) warnings.push(`Diel „${rp.name}“ vyžaduje ťah ${Math.round(rp.maxStretch * 100)} % — znížte max. uhol, aby sa rozdelil na menšie diely.`);
  }

  onProgress?.({ stage: 'Ukladám diely na rolu', progress: 0.93 });
  await yieldUi();
  const { placed, length } = packOnRoll(raw, p.rollWidthMm, p.spacingMm, warnings);

  const pieces: PlanPiece[] = placed.map((rp, i) => {
    const paths: PlanPath[] = [];
    paths.push({ id: `p${i}-cut`, kind: 'cut', points: rp.outer, closed: true });
    rp.holes.forEach((h, j) => paths.push({ id: `p${i}-hole${j}`, kind: 'cut', points: h, closed: true }));
    if (p.wrapMm > 0) rp.net.forEach((nl, j) => paths.push({ id: `p${i}-net${j}`, kind: 'annotation', points: nl, closed: true }));
    const b = boundsOf(rp.outer);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const minDim = Math.min(b.maxX - b.minX, b.maxY - b.minY);
    const size = THREE.MathUtils.clamp(minDim / 9, 6, 36);
    const cutLengthMm = polylineLength(rp.outer, true) + rp.holes.reduce((s, h) => s + polylineLength(h, true), 0);
    return {
      id: `piece-${i}`,
      name: rp.name,
      quantity: 1,
      color: pieceColor(rp.region),
      paths,
      labels: [
        { text: rp.name, position: { x: cx, y: cy - size * 0.3 }, size },
        { text: `ťah ${round1(rp.maxStretch * 100)} %`, position: { x: cx, y: cy + size * 0.9 }, size: size * 0.55 },
      ],
      bounds: b,
      areaMm2: rp.areaMm2,
      cutLengthMm,
      foldLengthMm: 0,
      meta: {
        'Max. ťah': `${round1(rp.maxStretch * 100)} %`,
        'Priem. ťah': `${round1(rp.avgStretch * 100)} %`,
        Rozmer: `${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxY - b.minY)} mm`,
      },
    };
  });

  const totalArea = pieces.reduce((s, pc) => s + pc.areaMm2, 0);
  const sheetW = Math.max(length, 100);
  const sheetH = p.rollWidthMm;
  const legend: LineKind[] = p.wrapMm > 0 ? ['cut', 'annotation'] : ['cut'];
  const plan: CutPlan = {
    productType: 'ppf',
    title: `PPF fólia · ${model.fileName}`,
    units: 'mm',
    sheet: { width: sheetW, height: sheetH, label: `Rola ${p.rollWidthMm} mm × ${round1(sheetW / 1000)} m` },
    pieces,
    stats: {
      pieceCount: pieces.length,
      totalAreaMm2: totalArea,
      cutLengthMm: pieces.reduce((s, pc) => s + pc.cutLengthMm, 0),
      foldLengthMm: 0,
      sheetWidthMm: sheetW,
      sheetHeightMm: sheetH,
      utilization: sheetW * sheetH > 0 ? Math.min(1, totalArea / (sheetW * sheetH)) : 0,
    },
    legend,
    warnings,
  };
  onProgress?.({ stage: 'Hotovo', progress: 1 });
  return { plan, pieceOfTriangle: Int32Array.from(region), cornerUv };
}

// ---------------------------------------------------------------------------
// 3D preview
// ---------------------------------------------------------------------------

export interface PpfObjectOptions {
  /** Tint each film piece with its plan colour */
  showPieces: boolean;
  color?: string | null;
}

/** Build the 3D preview: painted object + film layer (+ optional coloured piece overlay). */
export function buildPpfObject(model: ImportedModel, result: PpfResult | null, params: PpfParams, materialId: string, options: PpfObjectOptions): THREE.Object3D {
  const p = { ...defaultPpfParams(), ...params };
  const mmPerUnit = p.mmPerUnit > 0 ? p.mmPerUnit : 1;
  const root = new THREE.Group();
  root.name = 'ppf';
  root.scale.setScalar(mmPerUnit / 1000);

  const geo = model.geometry;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const index = geo.index!;
  const triCount = index.count / 3;

  const paint = new THREE.Mesh(geo.clone(), createPaintMaterial(p.paintId));
  paint.castShadow = true;
  paint.receiveShadow = true;
  paint.name = 'paint';
  root.add(paint);

  // film shell slightly above the paint
  const lift = 0.25 / mmPerUnit;
  const pieceCount = result ? result.plan.pieces.length : 1;
  const triLists: number[][] = Array.from({ length: Math.max(pieceCount, 1) }, () => []);
  for (let t = 0; t < triCount; t++) {
    const pi = result ? result.pieceOfTriangle[t] : 0;
    if (pi >= 0 && pi < triLists.length) triLists[pi].push(t);
  }

  // planar fallback uvs (mm) when no flattening is available
  const box = geo.boundingBox ?? new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
  const sz = box.getSize(new THREE.Vector3());
  const dropAxis = sz.x <= sz.y && sz.x <= sz.z ? 0 : sz.y <= sz.z ? 1 : 2;

  const baseMat = createPhysicalMaterial(materialId, options.color, 0.001);
  baseMat.polygonOffset = true;
  baseMat.polygonOffsetFactor = -2;
  baseMat.polygonOffsetUnits = -2;

  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  triLists.forEach((list, pi) => {
    if (!list.length) return;
    const P = new Float32Array(list.length * 9);
    const Nn = new Float32Array(list.length * 9);
    const U = new Float32Array(list.length * 6);
    list.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const vi = index.getX(t * 3 + k);
        v.fromBufferAttribute(pos, vi);
        nv.fromBufferAttribute(nrm, vi);
        P[i * 9 + k * 3] = v.x + nv.x * lift;
        P[i * 9 + k * 3 + 1] = v.y + nv.y * lift;
        P[i * 9 + k * 3 + 2] = v.z + nv.z * lift;
        Nn[i * 9 + k * 3] = nv.x;
        Nn[i * 9 + k * 3 + 1] = nv.y;
        Nn[i * 9 + k * 3 + 2] = nv.z;
        if (result?.cornerUv) {
          U[i * 6 + k * 2] = result.cornerUv[t * 6 + k * 2];
          U[i * 6 + k * 2 + 1] = result.cornerUv[t * 6 + k * 2 + 1];
        } else {
          const c = [v.x, v.y, v.z].filter((_, a) => a !== dropAxis);
          U[i * 6 + k * 2] = c[0] * mmPerUnit;
          U[i * 6 + k * 2 + 1] = c[1] * mmPerUnit;
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    let mat: THREE.MeshPhysicalMaterial = baseMat;
    if (options.showPieces && result) {
      mat = baseMat.clone();
      const tint = new THREE.Color(result.plan.pieces[pi]?.color ?? '#ffffff');
      if (mat.transmission > 0) {
        // tinted clear film: colour the transmitted light
        mat.attenuationColor = tint;
        mat.attenuationDistance = 0.6 / mmPerUnit;
        mat.color = tint.clone().lerp(new THREE.Color('#ffffff'), 0.35);
      } else {
        mat.color = mat.color.clone().lerp(tint, 0.45);
      }
    }
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `film-${pi}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    root.add(mesh);
  });

  // piece seams as thin lines (raster view)
  if (result && options.showPieces) {
    const seg: number[] = [];
    const edgeOwner = new Map<string, number>();
    const lift2 = lift * 2;
    const pushV = (vi: number) => {
      v.fromBufferAttribute(pos, vi);
      nv.fromBufferAttribute(nrm, vi);
      seg.push(v.x + nv.x * lift2, v.y + nv.y * lift2, v.z + nv.z * lift2);
    };
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const a = index.getX(t * 3 + k);
        const b = index.getX(t * 3 + ((k + 1) % 3));
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const o = edgeOwner.get(key);
        if (o === undefined) edgeOwner.set(key, t);
        else {
          if (result.pieceOfTriangle[o] !== result.pieceOfTriangle[t]) {
            pushV(a);
            pushV(b);
          }
          edgeOwner.set(key, -1);
        }
      }
    }
    if (seg.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#111318', transparent: true, opacity: 0.85 }));
      lines.name = 'seams';
      root.add(lines);
    }
  }
  return root;
}

// ---------------------------------------------------------------------------
// Built-in sample objects
// ---------------------------------------------------------------------------

export interface SampleModelInfo {
  id: string;
  name: string;
  description: string;
}

/** Built-in sample objects so the PPF flow can be tried without a file. */
export const SAMPLE_MODELS: SampleModelInfo[] = [
  { id: 'hood', name: 'Kapota auta', description: 'Veľký dvojito zakrivený panel karosérie.' },
  { id: 'mirror', name: 'Kryt spätného zrkadla', description: 'Malý, hlboko zakrivený diel — klasická výzva pre PPF.' },
  { id: 'phone', name: 'Telo telefónu', description: 'Zaoblený kryt zariadenia.' },
  { id: 'helmet', name: 'Škrupina prilby', description: 'Kupola s výrezom pre priezor.' },
];

/** Grid surface helper; fn returns null to leave a hole. Triangles wind counter-clockwise seen from the outside when outward=true. */
function gridSurface(nu: number, nv: number, fn: (u: number, v: number) => THREE.Vector3 | null, wrapU = false, flip = false): THREE.BufferGeometry {
  const cols = wrapU ? nu : nu + 1;
  const pts: (THREE.Vector3 | null)[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) pts.push(fn(i / nu, j / nv));
  const positions: number[] = [];
  const indexMap = new Map<number, number>();
  const id = (i: number, j: number) => {
    const k = j * cols + (wrapU ? i % nu : i);
    const p = pts[k];
    if (!p) return -1;
    let m = indexMap.get(k);
    if (m === undefined) {
      m = positions.length / 3;
      positions.push(p.x, p.y, p.z);
      indexMap.set(k, m);
    }
    return m;
  };
  const index: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = id(i, j);
      const b = id(i + 1, j);
      const c = id(i + 1, j + 1);
      const d = id(i, j + 1);
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      if (flip) index.push(a, c, b, a, d, c);
      else index.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function sampleGeometry(id: string): THREE.BufferGeometry {
  switch (id) {
    case 'hood': {
      // ~1500 x 1250 mm bonnet, crowned, rolled front edge and side flanges
      const L = 1250;
      const W = 1520;
      return gridSurface(
        90,
        72,
        (s, t) => {
          const u = s * 2 - 1; // across
          const v = t; // 0 windscreen -> 1 nose
          const halfW = (W / 2) * (1 - 0.13 * v * v);
          const x = u * halfW;
          const z = (v - 0.5) * L;
          let y = 95 * (1 - u * u) * (1 - 0.35 * v) - 170 * Math.pow(v, 1.7);
          y += 10 * Math.exp(-(((u - 0.35) / 0.06) ** 2)) + 10 * Math.exp(-(((u + 0.35) / 0.06) ** 2)); // character lines
          y -= 55 * smooth(0.9, 1, Math.abs(u)); // side roll-down
          y -= 45 * smooth(0.93, 1, v); // nose roll-down
          return new THREE.Vector3(x, y + 250, z);
        },
        false,
        true,
      );
    }
    case 'mirror': {
      // ellipsoidal cap open towards the door
      const rx = 115;
      const ry = 72;
      const rz = 95;
      return gridSurface(
        96,
        44,
        (s, t) => {
          const phi = s * Math.PI * 2;
          const th = t * Math.PI * 0.5; // 0 = pole (front), pi/2 = rim
          const x = Math.sin(th) * Math.cos(phi) * rx * (1 + 0.18 * Math.cos(phi));
          const y = Math.sin(th) * Math.sin(phi) * ry;
          const z = Math.cos(th) * rz;
          return new THREE.Vector3(x, y + 90, z);
        },
        true,
        true,
      );
    }
    case 'phone': {
      const g = new RoundedBoxGeometry(72, 8.2, 150, 6, 4);
      g.translate(0, 4.1, 0);
      return g;
    }
    case 'helmet':
    default: {
      const R = 145;
      return gridSurface(
        120,
        56,
        (s, t) => {
          const phi = s * Math.PI * 2;
          const th = t * Math.PI * 0.62; // from crown down past the equator
          const dir = new THREE.Vector3(Math.sin(th) * Math.sin(phi), Math.cos(th), Math.sin(th) * Math.cos(phi));
          // visor opening at the front (phi ~ 0), between 55° and 100° from the crown
          const front = Math.cos(phi);
          const thDeg = (th * 180) / Math.PI;
          if (front > 0.55 && thDeg > 62 && thDeg < 104) return null;
          const stretch = 1 + 0.12 * dir.z; // longer towards the back
          return new THREE.Vector3(dir.x * R * 0.92, dir.y * R * 1.02 + 150, dir.z * R * 1.08 * stretch);
        },
        true,
        true,
      );
    }
  }
}

const SAMPLE_FORMAT: FormatInfo = { id: 'sample', label: 'Ukážkový model', extensions: [], family: 'mesh', supported: true };

export function createSampleModel(id: string): ImportedModel {
  const info = SAMPLE_MODELS.find((s) => s.id === id);
  if (!info) throw new Error(`Neznámy ukážkový model: ${id}`);
  const geo = sampleGeometry(id);
  const mat = new THREE.MeshPhysicalMaterial({ color: '#b8bbbf', roughness: 0.45 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));
  const model = finalizeModel(group, info.name, SAMPLE_FORMAT, false, { unit: 'mm', mmPerUnit: 1 });
  model.analysis = { suggestedProduct: 'ppf', boxFit: model.analysis.boxFit, reason: info.description };
  return model;
}
