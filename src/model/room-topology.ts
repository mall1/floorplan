import { area, distance, inside, projectPoint, validPolygon } from './geometry';
import type { Point } from './types';
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const key = (p: Point) => p.map((n) => Math.round(n * 1e5) / 1e5).join(',');
function clean(poly: Point[]) {
  const out = poly.filter((p, i) => distance(p, poly[(i + 1) % poly.length]) > 1e-5);
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++)
      if (
        projectPoint(out[i], out[(i + out.length - 1) % out.length], out[(i + 1) % out.length]).distance <
        1e-5
      ) {
        out.splice(i, 1);
        changed = true;
        break;
      }
  }
  return out;
}
function cuts(a: Point, b: Point, c: Point, d: Point): number[] {
  const u = sub(b, a),
    v = sub(d, c),
    den = cross(u, v),
    w = sub(c, a);
  if (Math.abs(den) > 1e-8) {
    const t = cross(w, v) / den,
      s = cross(w, u) / den;
    return t >= 0 && t <= 1 && s >= 0 && s <= 1 ? [t] : [];
  }
  if (Math.abs(cross(w, u)) > 1e-6) return [];
  return [c, d]
    .map((p) => projectPoint(p, a, b))
    .filter((p) => p.distance < 1e-5)
    .map((p) => p.t);
}
/** Extract only union boundary edges. Multiple rings (holes/disconnected rooms) are rejected. */
function union(polys: Point[][]): Point[] {
  const edges = polys.flatMap((p) => p.map((a, i) => ({ a, b: p[(i + 1) % p.length] })));
  const pieces = new Map<string, { a: Point; b: Point }>();
  for (const e of edges) {
    const ts = [...new Set([0, 1, ...edges.flatMap((f) => cuts(e.a, e.b, f.a, f.b))])].sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) {
      let a = lerp(e.a, e.b, ts[i - 1]),
        b = lerp(e.a, e.b, ts[i]);
      const len = distance(a, b);
      if (len < 1e-5) continue;
      const mid = lerp(a, b, 0.5),
        eps = Math.min(0.01, len / 100),
        dx = (-(b[1] - a[1]) / len) * eps,
        dy = ((b[0] - a[0]) / len) * eps;
      const left = polys.some((p) => inside([mid[0] + dx, mid[1] + dy], p)),
        right = polys.some((p) => inside([mid[0] - dx, mid[1] - dy], p));
      if (left === right) continue;
      if (!left) [a, b] = [b, a];
      pieces.set(`${key(a)}|${key(b)}`, { a, b });
    }
  }
  const rest = [...pieces.values()],
    out: Point[] = [];
  if (!rest.length) throw Error('没有可合并的有效轮廓');
  let current = rest.shift()!;
  const start = key(current.a);
  out.push(current.a);
  for (let limit = 0; limit <= pieces.size; limit++) {
    if (key(current.b) === start) break;
    out.push(current.b);
    const next = rest.filter((e) => key(e.a) === key(current.b));
    if (next.length !== 1) throw Error('两个房间必须共边或相邻，不能只在一个角相接');
    current = next[0];
    rest.splice(rest.indexOf(current), 1);
  }
  if (rest.length || key(current.b) !== start) throw Error('合并后产生分离区域或孔洞，请先调整房间边界');
  return clean(out);
}
/** Merge adjacent rooms, optionally bridging only a narrow parallel wall gap. Units: mm. */
export function mergeRoomPolygons(a: Point[], b: Point[], maxGap = 400): Point[] {
  if (!validPolygon(a) || !validPolygon(b)) throw Error('请先修正无效的房间轮廓');
  let merged: Point[];
  try {
    merged = union([a, b]);
  } catch {
    const bridges: { poly: Point[]; gap: number; span: number }[] = [];
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++) {
        const p = a[i],
          q = a[(i + 1) % a.length],
          r = b[j],
          s = b[(j + 1) % b.length],
          u = sub(q, p),
          v = sub(s, r),
          len = distance(p, q);
        if (Math.abs(cross(u, v)) > 1e-6 * len * distance(r, s)) continue;
        const gap = Math.abs(cross(sub(r, p), u)) / len;
        if (gap < 0.01 || gap > maxGap) continue;
        const dot = (point: Point) => ((point[0] - p[0]) * u[0] + (point[1] - p[1]) * u[1]) / (len * len);
        const lo = Math.max(0, Math.min(dot(r), dot(s))),
          hi = Math.min(1, Math.max(dot(r), dot(s)));
        if ((hi - lo) * len < 100) continue;
        const c = lerp(p, q, lo),
          d = lerp(p, q, hi),
          cc = projectPoint(c, r, s).point,
          dd = projectPoint(d, r, s).point;
        const middle = lerp(lerp(c, d, 0.5), lerp(cc, dd, 0.5), 0.5);
        if (inside(middle, a) || inside(middle, b)) continue;
        bridges.push({ poly: [c, d, dd, cc], gap, span: (hi - lo) * len });
      }
    bridges.sort((x, y) => x.gap - y.gap || y.span - x.span);
    if (!bridges.length) throw Error('房间不相邻；请调整边界或增大合理的隔墙间距');
    merged = union([a, b, bridges[0].poly]);
  }
  if (!validPolygon(merged) || merged.length > 300) throw Error('合并轮廓无效或过于复杂');
  return merged;
}
/** An infinite cut line must cross the outline exactly twice, yielding two simple rooms. */
export function splitRoomPolygon(
  poly: Point[],
  a: Point,
  b: Point,
): { polys: [Point[], Point[]]; seam: [Point, Point] } {
  if (!validPolygon(poly) || distance(a, b) < 1) throw Error('分割线过短或房间轮廓无效');
  const dir = sub(b, a),
    signed = (p: Point) => cross(dir, sub(p, a)) / distance(a, b);
  const hits: Point[] = [];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length],
      s = signed(p),
      t = signed(q);
    if (Math.abs(s) < 0.001 && Math.abs(t) < 0.001) throw Error('分割线不能与房间边线重合');
    if (Math.abs(s) < 0.001) hits.push(p);
    else if (s * t < 0) hits.push(lerp(p, q, s / (s - t)));
  });
  const unique = [...new Map(hits.map((p) => [key(p), p])).values()];
  if (unique.length !== 2 || !inside(lerp(unique[0], unique[1], 0.5), poly))
    throw Error('分割线需穿过房间并仅分成两块，请移动端点');
  const halves = [1, -1].map((sign) => {
    const out: Point[] = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length],
        s = signed(p) * sign,
        t = signed(q) * sign;
      if (s >= -0.001) out.push(p);
      if (s * t < 0) out.push(lerp(p, q, s / (s - t)));
    });
    return clean(out);
  }) as [Point[], Point[]];
  if (halves.some((p) => !validPolygon(p) || area(p) < 0.2))
    throw Error('分割后每个房间至少 0.2 ㎡，且轮廓不能相交');
  if (Math.abs(area(halves[0]) + area(halves[1]) - area(poly)) > 1e-5)
    throw Error('此分割线无法生成两个完整房间');
  return { polys: halves, seam: [unique[0], unique[1]] };
}
/** Keep line parts outside the merged interior; preserve its perimeter walls. */
export function trimInteriorLine(a: Point, b: Point, poly: Point[], width: number): [Point, Point][] {
  const ts = [...new Set([0, 1, ...poly.flatMap((p, i) => cuts(a, b, p, poly[(i + 1) % poly.length]))])].sort(
    (x, y) => x - y,
  );
  const len = distance(a, b) || 1,
    dx = (-(b[1] - a[1]) / len) * (width / 2 + 0.1),
    dy = ((b[0] - a[0]) / len) * (width / 2 + 0.1);
  const out: [Point, Point][] = [];
  for (let i = 1; i < ts.length; i++) {
    const c = lerp(a, b, ts[i - 1]),
      d = lerp(a, b, ts[i]),
      m = lerp(c, d, 0.5);
    if (!(inside([m[0] + dx, m[1] + dy], poly) && inside([m[0] - dx, m[1] - dy], poly))) out.push([c, d]);
  }
  return out;
}
