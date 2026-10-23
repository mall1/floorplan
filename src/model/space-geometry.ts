import { bounds, inside, projectPoint } from './geometry';
import type { Furniture, Point } from './types';

export const floorIgnored = new Set(['rug', 'tv', 'acwall', 'waterheater', 'stove', 'ksink', 'microwave']);
export const storageTypes = new Set([
  'wardrobe',
  'cabinet',
  'shoecab',
  'bookshelf',
  'nightstand',
  'dresser',
  'tvstand',
  'counter',
  'island',
  'chest',
  'pantry',
  'filingcabinet',
  'displaycabinet',
  'vanity',
]);
export function furniturePolygon(f: Furniture, margin = 0): Point[] {
  const angle = (f.rot * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => {
    const dx = x * (f.w / 2 + margin),
      dy = y * (f.d / 2 + margin);
    return [f.cx + dx * c - dy * s, f.cy + dx * s + dy * c];
  });
}
export const nearPolygon = (p: Point, poly: Point[], margin = 0) =>
  inside(p, poly) ||
  poly.some((a, i) => projectPoint(p, a, poly[(i + 1) % poly.length]).distance <= margin + 0.001);
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
function intersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const v = sub(b, a),
    w = sub(d, c),
    den = cross(v, w);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(c, a), w) / den,
    u = cross(sub(c, a), v) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * v[0], a[1] + t * v[1]] : null;
}
export function polygonsOverlap(a: Point[], b: Point[]) {
  const ab = bounds(a),
    bb = bounds(b);
  if (ab.x > bb.x + bb.w || bb.x > ab.x + ab.w || ab.y > bb.y + bb.h || bb.y > ab.y + ab.h) return false;
  return (
    a.some((p) => nearPolygon(p, b)) ||
    b.some((p) => nearPolygon(p, a)) ||
    a.some((p, i) => b.some((q, j) => intersection(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])))
  );
}
export function polygonFits(poly: Point[], room: Point[]) {
  // Edge samples also catch a rectangle bridging the notch of a concave room.
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length],
      steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 50));
    for (let n = 0; n <= steps; n++) {
      const p: Point = [a[0] + ((b[0] - a[0]) * n) / steps, a[1] + ((b[1] - a[1]) * n) / steps];
      if (!nearPolygon(p, room)) return false;
    }
    // Reject any proper crossing even when a narrow notch falls between samples.
    return !room.some((q, j) => {
      const hit = intersection(a, b, q, room[(j + 1) % room.length]);
      return (
        hit &&
        Math.hypot(hit[0] - a[0], hit[1] - a[1]) > 0.01 &&
        Math.hypot(hit[0] - b[0], hit[1] - b[1]) > 0.01
      );
    });
  });
}
function spans(poly: Point[], x: number): Point[] {
  const ys: number[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    if (a[0] > x !== b[0] > x) ys.push(a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]));
  });
  ys.sort((a, b) => a - b);
  return ys.filter((_, i) => i % 2 === 0).map((y, i) => [y, ys[i * 2 + 1]]);
}
function merge(spans: Point[]) {
  const result: Point[] = [];
  for (const span of spans.sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else result.push([...span]);
  }
  return result;
}
/** Exact polygon-union area minus excluded polygons, in square metres. */
export function regionArea(regions: Point[][], excluded: Point[][] = []) {
  if (!regions.length) return 0;
  const rb = bounds(regions.flat());
  const obstacles = excluded.filter((p) => {
    const b = bounds(p);
    return b.x < rb.x + rb.w && b.x + b.w > rb.x && b.y < rb.y + rb.h && b.y + b.h > rb.y;
  });
  const polys = [...regions, ...obstacles],
    cuts = polys.flatMap((p) => p.map((v) => v[0]));
  const edges = polys.flatMap((p, k) => p.map((a, i) => ({ a, b: p[(i + 1) % p.length], k })));
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i],
        b = edges[j];
      if (
        a.k === b.k ||
        Math.max(a.a[0], a.b[0]) < Math.min(b.a[0], b.b[0]) ||
        Math.max(b.a[0], b.b[0]) < Math.min(a.a[0], a.b[0])
      )
        continue;
      const hit = intersection(a.a, a.b, b.a, b.b);
      if (hit) cuts.push(hit[0]);
    }
  const xs = [...new Set(cuts)].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < xs.length; i++) {
    const x = (xs[i] + xs[i - 1]) / 2;
    const covered = merge(regions.flatMap((p) => spans(p, x))),
      blocked = merge(obstacles.flatMap((p) => spans(p, x)));
    let length = 0;
    for (const [a, b] of covered) {
      length += b - a;
      for (const [c, d] of blocked) length -= Math.max(0, Math.min(b, d) - Math.max(a, c));
    }
    total += length * (xs[i] - xs[i - 1]);
  }
  return Math.max(0, total / 1e6);
}
