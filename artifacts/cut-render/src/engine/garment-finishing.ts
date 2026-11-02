import * as THREE from 'three';
import type { Point } from './types';

/** Round a draped corner without changing the drafting coordinates used by artwork or seams. */
export function cornerRounder(before: Point, corner: Point, after: Point, radius: number) {
  const incoming = new THREE.Vector2(corner.x - before.x, corner.y - before.y).normalize();
  const outgoing = new THREE.Vector2(after.x - corner.x, after.y - corner.y).normalize();
  const tangent = incoming.clone().add(outgoing).normalize();
  const projection = incoming.dot(tangent);
  const r = Math.min(radius, Math.hypot(corner.x - before.x, corner.y - before.y) / 2,
    Math.hypot(after.x - corner.x, after.y - corner.y) / 2);
  return (q: Point): Point => {
    if (r <= 0 || projection < 0.01) return q;
    const s = ((q.x - corner.x) * tangent.x + (q.y - corner.y) * tangent.y) / projection;
    if (Math.abs(s) >= r) return q;
    const direction = s < 0 ? incoming : outgoing;
    const ox = corner.x + direction.x * s, oy = corner.y + direction.y * s;
    const distance = Math.hypot(q.x - ox, q.y - oy) / (2 * r);
    if (distance >= 1) return q;
    const weight = 1 - distance * distance * (3 - 2 * distance);
    const t = (s + r) / (2 * r), u = 1 - t;
    const x = u * u * (corner.x - r * incoming.x) + 2 * u * t * corner.x + t * t * (corner.x + r * outgoing.x);
    const y = u * u * (corner.y - r * incoming.y) + 2 * u * t * corner.y + t * t * (corner.y + r * outgoing.y);
    return { x: q.x + (x - ox) * weight, y: q.y + (y - oy) * weight };
  };
}

/** Keep the assembled sleeve edge clear of the body, without changing its cut coordinates. */
export function sleeveSideClearance(edge: Point, underarm: Point, hem: Point, opening: number): number {
  if (edge.y < underarm.y || opening <= 0) return 0;
  const t = THREE.MathUtils.clamp((edge.y - underarm.y) / (hem.y - underarm.y), 0, 1);
  const side = underarm.x + (hem.x - underarm.x) * t;
  return Math.max(0, side + 8 * THREE.MathUtils.clamp(opening, 0, 1) - edge.x);
}

interface SewnLayer {
  geometry: THREE.BufferGeometry;
  points: Point[];
  sewn: (index: number) => boolean;
}

/** Close independently meshed cloth layers and give both sides one continuous seam normal. */
export function weldClosedSeams(layers: SewnLayer[]): number {
  const seams = new Map<string, { layer: SewnLayer; index: number }[]>();
  for (const layer of layers) layer.points.forEach((q, index) => {
    if (!layer.sewn(index)) return;
    const key = `${Math.round(q.x * 10000)},${Math.round(q.y * 10000)}`;
    const entries = seams.get(key) ?? [];
    entries.push({ layer, index });
    seams.set(key, entries);
  });
  const pairs = [...seams.values()].filter((entries) => new Set(entries.map((e) => e.layer)).size > 1);
  const average = new THREE.Vector3(), value = new THREE.Vector3();
  for (const entries of pairs) {
    average.set(0, 0, 0);
    for (const { layer, index } of entries) average.add(value.fromBufferAttribute(layer.geometry.getAttribute('position'), index));
    average.divideScalar(entries.length);
    for (const { layer, index } of entries) (layer.geometry.getAttribute('position') as THREE.BufferAttribute).setXYZ(index, average.x, average.y, average.z);
  }
  for (const { geometry } of layers) {
    geometry.getAttribute('position').needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }
  for (const entries of pairs) {
    average.set(0, 0, 0);
    for (const { layer, index } of entries) average.add(value.fromBufferAttribute(layer.geometry.getAttribute('normal'), index));
    if (average.lengthSq() < 1e-12) continue;
    average.normalize();
    for (const { layer, index } of entries) (layer.geometry.getAttribute('normal') as THREE.BufferAttribute).setXYZ(index, average.x, average.y, average.z);
  }
  for (const { geometry } of layers) geometry.getAttribute('normal').needsUpdate = true;
  return pairs.length;
}

/** Short four-sided thread tubes, written directly instead of allocating one geometry per stitch. */
export function lockstitchGeometry(curve: THREE.Curve<THREE.Vector3>, shade: (u: number) => number): THREE.BufferGeometry {
  const count = Math.floor(curve.getLength() / 0.0032);
  const position = new Float32Array(count * 8 * 3), normal = new Float32Array(position.length);
  const color = new Float32Array(count * 8 * 3), indices: number[] = [];
  const tangent = new THREE.Vector3(), across = new THREE.Vector3(), up = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const a = curve.getPointAt(i / count), b = curve.getPointAt((i + 0.6) / count);
    tangent.copy(b).sub(a).normalize();
    across.set(-tangent.y, tangent.x, 0);
    if (across.lengthSq() < 1e-8) across.set(1, 0, 0);
    across.normalize();
    up.crossVectors(tangent, across).normalize();
    const grey = shade((i + 0.3) / count);
    for (let end = 0; end < 2; end++) for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2;
      const n = across.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle));
      const vertex = (i * 8 + end * 4 + side) * 3, p = end ? b : a;
      position.set([p.x + n.x * 0.00022, p.y + n.y * 0.00022, p.z + n.z * 0.00022], vertex);
      normal.set(n.toArray(), vertex);
      color.fill(grey, vertex, vertex + 3);
    }
    for (let side = 0; side < 4; side++) {
      const a = i * 8 + side, b = i * 8 + (side + 1) % 4;
      indices.push(a, b, a + 4, b, b + 4, a + 4);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setIndex(indices);
  return geometry;
}
