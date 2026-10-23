import type { Point, Project, Room, Wall } from './types';
export const uid = () => crypto.randomUUID();
export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const area = (p: Point[]) =>
  Math.abs(
    p.reduce((n, a, i) => {
      const b = p[(i + 1) % p.length];
      return n + a[0] * b[1] - b[0] * a[1];
    }, 0),
  ) /
  2 /
  1e6;
export const bounds = (p: Point[]) => {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of p) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
};
export const center = (p: Point[]): Point => {
  const b = bounds(p);
  return [b.x + b.w / 2, b.y + b.h / 2];
};
export const length = (p: Point[]) => p.slice(1).reduce((sum, v, i) => sum + distance(p[i], v), 0);
export const snapPoint = (p: Point, step = 50): Point => p.map((v) => Math.round(v / step) * step) as Point;
export const rect = (a: Point, b: Point): Point[] => [
  [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
  [Math.max(a[0], b[0]), Math.min(a[1], b[1])],
  [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  [Math.min(a[0], b[0]), Math.max(a[1], b[1])],
];
export const move = (p: Point, d: Point): Point => [p[0] + d[0], p[1] + d[1]];
export function openingPolygon(a: Point, b: Point, width: number): Point[] {
  const len = distance(a, b) || 1,
    dx = (-(b[1] - a[1]) * width) / (2 * len),
    dy = ((b[0] - a[0]) * width) / (2 * len);
  return [
    [a[0] + dx, a[1] + dy],
    [b[0] + dx, b[1] + dy],
    [b[0] - dx, b[1] - dy],
    [a[0] - dx, a[1] - dy],
  ];
}
export function projectPoint(p: Point, a: Point, b: Point) {
  const d = distance(a, b) ** 2;
  const t = d
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / d))
    : 0;
  const point: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return { point, t, distance: distance(p, point) };
}
export function inside(p: Point, poly: Point[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
/** Find an interior label / placement point even for concave rooms. */
export function roomCenter(poly: Point[]): Point {
  const middle = center(poly);
  if (inside(middle, poly)) return middle;
  const ys = [...new Set(poly.map((p) => p[1]))].sort((a, b) => a - b);
  let best = poly[0],
    span = 0;
  for (let k = 1; k < ys.length; k++) {
    const y = (ys[k - 1] + ys[k]) / 2,
      xs: number[] = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    });
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2)
      if (xs[i + 1] - xs[i] > span) {
        span = xs[i + 1] - xs[i];
        best = [(xs[i] + xs[i + 1]) / 2, y];
      }
  }
  return best;
}
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function validPolygon(p: Point[]) {
  if (p.length < 3 || area(p) < 0.05 || p.some((a, i) => distance(a, p[(i + 1) % p.length]) < 1))
    return false;
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.length - 1)) continue;
      const a = p[i],
        b = p[(i + 1) % p.length],
        c = p[j],
        d = p[(j + 1) % p.length];
      if (
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0 &&
        Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <=
          Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) &&
        Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <=
          Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
      )
        return false;
    }
  return true;
}
export function allWalls(p: Project): Wall[] {
  const found = new Set(p.walls.map((w) => [w.a.join(','), w.b.join(',')].sort().join('|')));
  const out = [...p.walls];
  for (const r of p.rooms.filter((r) => r.boundary))
    r.poly.forEach((a, i) => {
      const b = r.poly[(i + 1) % r.poly.length];
      const key = [a.join(','), b.join(',')].sort().join('|');
      if (!found.has(key)) {
        out.push({
          id: `${r.id}:edge:${i}`,
          a,
          b,
          width: r.edgeWidths?.[i] ?? r.wallWidth,
          bearing: false,
          height: 2800,
        });
        found.add(key);
      }
    });
  return out;
}
export function wallSegments(
  w: Wall,
  openings: Project['openings'],
): { a: Point; b: Point; bottom: number; top: number }[] {
  const len = distance(w.a, w.b);
  if (len < 1) return [];
  const dx = (w.b[0] - w.a[0]) / len,
    dy = (w.b[1] - w.a[1]) / len;
  const cuts = openings
    .filter((o) => o.type !== 'threshold')
    .flatMap((o) => {
      const openingLength = distance(o.a, o.b);
      if (
        openingLength < 1 ||
        Math.abs(((o.b[0] - o.a[0]) * dx + (o.b[1] - o.a[1]) * dy) / openingLength) < 0.98
      )
        return [];
      const project = (p: Point) => ({
        t: ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / len,
        distance: Math.abs((p[0] - w.a[0]) * dy - (p[1] - w.a[1]) * dx),
      });
      const a = project(o.a),
        b = project(o.b);
      if (a.distance > Math.max(12, w.width * 0.55) || b.distance > Math.max(12, w.width * 0.55)) return [];
      const start = Math.max(0, Math.min(a.t, b.t)),
        end = Math.min(1, Math.max(a.t, b.t));
      const sill = o.type === 'window' ? (o.sill ?? 900) : 0;
      return end - start > 1 / len
        ? [
            {
              start,
              end,
              sill,
              head:
                o.type === 'railing' ? w.height : sill + (o.height ?? (o.type === 'window' ? 1300 : 2100)),
            },
          ]
        : [];
    })
    .sort((a, b) => a.start - b.start);
  const point = (t: number): Point => [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t];
  const result = [];
  const stops = [...new Set([0, 1, ...cuts.flatMap((c) => [c.start, c.end])])].sort((a, b) => a - b);
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1],
      to = stops[i],
      middle = (from + to) / 2;
    const active = cuts.filter((c) => c.start <= middle && c.end >= middle);
    if (!active.length) {
      result.push({ a: point(from), b: point(to), bottom: 0, top: w.height });
      continue;
    }
    const sill = Math.min(...active.map((c) => c.sill)),
      bottom = Math.max(...active.map((c) => c.head));
    if (sill > 0) result.push({ a: point(from), b: point(to), bottom: 0, top: Math.min(sill, w.height) });
    if (w.height > bottom) result.push({ a: point(from), b: point(to), bottom, top: w.height });
  }
  return result;
}
export function projectBounds(p: Project) {
  const points = [
    ...p.rooms.flatMap((r) => r.poly),
    ...p.walls.flatMap((w) => [w.a, w.b]),
    ...p.shafts.flatMap((s) => s.poly),
  ];
  for (const item of p.furniture) {
    const r = Math.hypot(item.w, item.d) / 2;
    points.push([item.cx - r, item.cy - r], [item.cx + r, item.cy + r]);
  }
  for (const item of p.openings) {
    points.push(item.a, item.b);
    if (item.type === 'window' && item.windowStyle === 'bay') {
      const len = distance(item.a, item.b) || 1,
        offset = (item.baySide ?? -1) * (item.width / 2 + (item.bayDepth ?? 600));
      const dx = (-(item.b[1] - item.a[1]) / len) * offset,
        dy = ((item.b[0] - item.a[0]) / len) * offset;
      points.push([item.a[0] + dx, item.a[1] + dy], [item.b[0] + dx, item.b[1] + dy]);
    }
  }
  for (const item of p.routes) for (const point of item.points) points.push(point);
  for (const item of p.devices) points.push([item.x, item.y]);
  for (const item of p.measures) points.push(item.a, item.b);
  if (p.reference?.visible) {
    const r = p.reference;
    const h = (r.width * r.pixelHeight) / r.pixelWidth,
      a = (r.rotation * Math.PI) / 180;
    for (const [x, y] of [
      [0, 0],
      [r.width, 0],
      [r.width, h],
      [0, h],
    ])
      points.push([r.x + x * Math.cos(a) - y * Math.sin(a), r.y + x * Math.sin(a) + y * Math.cos(a)]);
  }
  return bounds(
    points.length
      ? points
      : [
          [0, 0],
          [12000, 10000],
        ],
  );
}
export function resizeRoom(r: Room, width: number, height: number): Point[] {
  const b = bounds(r.poly);
  return r.poly.map(([x, y]) => [
    b.x + ((x - b.x) * width) / (b.w || 1),
    b.y + ((y - b.y) * height) / (b.h || 1),
  ]);
}
