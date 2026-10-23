import { area, bounds } from './geometry';
import type { Point, Project, Room } from './types';
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
function spans(poly: Point[], x: number) {
  const ys: number[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    if (a[0] > x !== b[0] > x) ys.push(a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]));
  });
  ys.sort((a, b) => a - b);
  return ys.filter((_, i) => i % 2 === 0).map((y, i) => [y, ys[i * 2 + 1]] as Point);
}
/** Exact vertical sweep of room minus the union of shafts, including rotated and overlapping rectangles. */
export function usableArea(project: Project, room: Room) {
  const rb = bounds(room.poly),
    shafts = (project.shafts ?? []).filter((s) => {
      const b = bounds(s.poly);
      return b.x < rb.x + rb.w && b.x + b.w > rb.x && b.y < rb.y + rb.h && b.y + b.h > rb.y;
    });
  if (!shafts.length) return area(room.poly);
  const polys = [room.poly, ...shafts.map((s) => s.poly)],
    xs = polys.flatMap((p) => p.map((v) => v[0]));
  const edges = polys.flatMap((p, k) => p.map((a, i) => ({ a, b: p[(i + 1) % p.length], k })));
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i],
        b = edges[j];
      if (a.k === b.k) continue;
      const d = subtract(a.b, a.a),
        e = subtract(b.b, b.a),
        den = cross(d, e);
      if (Math.abs(den) < 1e-9) continue;
      const offset = subtract(b.a, a.a),
        t = cross(offset, e) / den,
        u = cross(offset, d) / den;
      if (t > 0 && t < 1 && u > 0 && u < 1) xs.push(a.a[0] + t * d[0]);
    }
  const cuts = [...new Set(xs)].sort((a, b) => a - b);
  let net = 0;
  for (let i = 1; i < cuts.length; i++) {
    const x = (cuts[i] + cuts[i - 1]) / 2,
      roomSpans = spans(room.poly, x),
      blocked = shafts.flatMap((s) => spans(s.poly, x)).sort((a, b) => a[0] - b[0]);
    const merged: Point[] = [];
    for (const v of blocked) {
      const last = merged.at(-1);
      if (last && v[0] <= last[1]) last[1] = Math.max(last[1], v[1]);
      else merged.push([...v]);
    }
    let length = 0;
    for (const [a, b] of roomSpans) {
      length += b - a;
      for (const [c, d] of merged) length -= Math.max(0, Math.min(b, d) - Math.max(a, c));
    }
    net += length * (cuts[i] - cuts[i - 1]);
  }
  return Math.max(0, net / 1e6);
}
