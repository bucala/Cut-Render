import * as THREE from 'three';

export interface ClothPanel {
  geometry: THREE.BufferGeometry;
  /** Coincident closed-edge vertices are sewn; open hems and necklines stay open. */
  sewn: (vertex: number) => boolean;
  /** Vertices held at their drafted position, e.g. a neckline braced by its rib band. */
  pinned?: (vertex: number) => boolean;
}

export interface ClothSupport {
  halfWidth: number;
  neckWidth: number;
  top: number;
  slope: number;
  /** Forward curvature at the shoulder tips, in metres. */
  depthBow?: number;
}

export function hangerHeight(s: ClothSupport, x: number): number {
  const d = Math.max(0, Math.abs(x) - s.neckWidth * 0.7);
  return s.top - 0.008 - s.slope * d - 0.07 * d * d / s.halfWidth;
}

export function hangerDepth(s: ClothSupport, x: number): number {
  return (s.depthBow ?? 0) * (x / s.halfWidth) ** 2;
}

/**
 * Deterministic, bounded PBD settle in metres. Edge stretch, opposite-triangle bending,
 * sewn front/back edges and a shaped hanger collider share the same solver.
 * The returned displacement field also carries trims and artwork with the cloth.
 */
export function settleCloth(panels: ClothPanel[], support: ClothSupport) {
  const offsets: number[] = [];
  let count = 0;
  for (const p of panels) { offsets.push(count); count += p.geometry.getAttribute('position').count; }
  const original = new Float64Array(count * 3);
  panels.forEach((p, k) => original.set(p.geometry.getAttribute('position').array, offsets[k] * 3));
  const pos = original.slice();
  const previous = original.slice();
  const weight = new Float64Array(count).fill(1);
  const edges: number[] = [];
  const rests: number[] = [];
  const stiffness: number[] = [];
  const add = (a: number, b: number, rest: number, strength: number) => {
    edges.push(a, b); rests.push(rest); stiffness.push(strength);
  };
  const distance = (a: number, b: number) => Math.hypot(
    original[a * 3] - original[b * 3], original[a * 3 + 1] - original[b * 3 + 1],
    original[a * 3 + 2] - original[b * 3 + 2],
  );
  const sewn = new Map<string, number>();
  panels.forEach((panel, k) => {
    const base = offsets[k];
    const index = panel.geometry.index!;
    const shared = new Map<string, number>();
    for (let t = 0; t < index.count; t += 3) {
      const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      for (let e = 0; e < 3; e++) {
        const a = base + tri[e], b = base + tri[(e + 1) % 3], c = base + tri[(e + 2) % 3];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const opposite = shared.get(key);
        if (opposite === undefined) {
          shared.set(key, c);
          add(a, b, distance(a, b), 1);
        } else add(c, opposite, distance(c, opposite), 0.035);
      }
    }
    for (let i = 0; i < panel.geometry.getAttribute('position').count; i++) {
      const v = base + i;
      const x = original[v * 3], y = original[v * 3 + 1];
      // A narrow support strip, not the whole upper body, holds the shoulder on the wood.
      if (Math.abs(x) >= support.neckWidth && Math.abs(x) <= support.halfWidth &&
          Math.abs(y - hangerHeight(support, x)) < 0.014) {
        weight[v] = 0;
        pos[v * 3 + 2] += hangerDepth(support, x);
      }
      if (panel.pinned?.(i)) weight[v] = 0;
      if (panel.sewn(i)) {
        const key = `${Math.round(x * 1e6)}:${Math.round(y * 1e6)}`;
        const other = sewn.get(key);
        if (other === undefined) sewn.set(key, v);
        else add(other, v, 0, 1);
      }
    }
  });
  const ids = Uint32Array.from(edges);
  const rest = Float64Array.from(rests);
  const strength = Float64Array.from(stiffness);
  for (let step = 0; step < 48; step++) {
    for (let v = 0; v < count; v++) {
      if (!weight[v]) continue;
      for (let d = 0; d < 3; d++) {
        const i = v * 3 + d, current = pos[i];
        pos[i] += (current - previous[i]) * 0.78 + (d === 1 ? -9.81 / (120 * 120) : 0);
        previous[i] = current;
      }
    }
    for (let iteration = 0; iteration < 5; iteration++) {
      for (let e = 0; e < rest.length; e++) {
        const a = ids[e * 2], b = ids[e * 2 + 1], w = weight[a] + weight[b];
        if (!w) continue;
        const ai = a * 3, bi = b * 3;
        const dx = pos[bi] - pos[ai], dy = pos[bi + 1] - pos[ai + 1], dz = pos[bi + 2] - pos[ai + 2];
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (length < 1e-10) continue;
        const correction = (length - rest[e]) / length * strength[e] / w;
        for (let d = 0; d < 3; d++) {
          const delta = (d === 0 ? dx : d === 1 ? dy : dz) * correction;
          pos[ai + d] += delta * weight[a];
          pos[bi + d] -= delta * weight[b];
        }
      }
      for (let v = 0; v < count; v++) {
        if (!weight[v]) continue;
        const i = v * 3, x = pos[i];
        if (Math.abs(x) > support.halfWidth + 0.016) continue;
        const cy = hangerHeight(support, x) - 0.013;
        const cz = hangerDepth(support, x);
        const dy = (pos[i + 1] - cy) / 0.018, dz = (pos[i + 2] - cz) / 0.012;
        const r = Math.sqrt(dy * dy + dz * dz);
        if (r < 1) {
          const zSign = original[i + 2] < 0 ? -1 : 1;
          const safe = Math.max(r, 0.0001);
          pos[i + 1] = cy + dy / safe * 0.018;
          pos[i + 2] = cz + (Math.abs(dz) < 1e-7 ? zSign * 0.012 : dz / safe * 0.012);
        }
        // Two-sided cloth thickness barrier; prevents front/back inversion.
        if (Math.abs(original[i + 2]) > 0.001)
          pos[i + 2] = cz + Math.sign(original[i + 2]) *
            Math.max(0.0007, Math.sign(original[i + 2]) * (pos[i + 2] - cz));
      }
    }
  }
  panels.forEach((panel, k) => {
    const attr = panel.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < attr.count; i++) {
      const j = (offsets[k] + i) * 3;
      attr.setXYZ(i, pos[j], pos[j + 1], pos[j + 2]);
    }
    attr.needsUpdate = true;
    panel.geometry.computeVertexNormals();
    panel.geometry.computeBoundingSphere();
  });

  // Spatial lookup keeps attachment transfer linear in the number of trim vertices.
  const cell = 0.025;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x}:${y}:${z}`;
  for (let v = 0; v < count; v++) {
    const i = v * 3;
    const k = key(Math.floor(original[i] / cell), Math.floor(original[i + 1] / cell), Math.floor(original[i + 2] / cell));
    const bucket = grid.get(k) ?? [];
    bucket.push(v); grid.set(k, bucket);
  }
  // Compactly supported smooth kernel: neighbouring trim vertices get continuous offsets.
  // Nearest-k inverse-distance weights jumped between neighbour sets and tore rib bands into teeth.
  const h2 = 0.022 * 0.022;
  const displacement = (point: THREE.Vector3) => {
    const cx = Math.floor(point.x / cell), cy = Math.floor(point.y / cell), cz = Math.floor(point.z / cell);
    const out = new THREE.Vector3();
    let sum = 0, nearest = -1, best = Infinity;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      for (const v of grid.get(key(cx + x, cy + y, cz + z)) ?? []) {
        const i = v * 3;
        const d = (point.x - original[i]) ** 2 + (point.y - original[i + 1]) ** 2 + (point.z - original[i + 2]) ** 2;
        if (d < best) { best = d; nearest = v; }
        if (d >= h2) continue;
        const w = (1 - d / h2) ** 2;
        out.x += (pos[i] - original[i]) * w;
        out.y += (pos[i + 1] - original[i + 1]) * w;
        out.z += (pos[i + 2] - original[i + 2]) * w;
        sum += w;
      }
    }
    if (sum) return out.divideScalar(sum);
    if (nearest < 0) return out;
    const i = nearest * 3;
    return out.set(pos[i] - original[i], pos[i + 1] - original[i + 1], pos[i + 2] - original[i + 2]);
  };
  return { displacement, particles: count, constraints: rest.length };
}
