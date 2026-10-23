import type { Opening, Point, Project, Wall } from './types';
import { allWalls, bounds, distance, projectPoint } from './geometry';

const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Point, n: number): Point => [a[0] * n, a[1] * n];
const unit = (a: Point, b: Point) => mul(sub(b, a), 1 / (distance(a, b) || 1));
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];

/** A stable wall axis is the reference for depth; the opening's drawn width is not a search radius. */
export function openingHost(o: Opening, walls: Wall[]) {
  const axis = unit(o.a, o.b),
    len = distance(o.a, o.b);
  return walls
    .map((w) => {
      if (Math.abs(dot(axis, unit(w.a, w.b))) < 0.985) return null;
      const lateral = Math.max(Math.abs(cross(sub(w.a, o.a), axis)), Math.abs(cross(sub(w.b, o.a), axis)));
      if (lateral > Math.max(12, w.width * 0.55)) return null;
      const t = [dot(sub(w.a, o.a), axis), dot(sub(w.b, o.a), axis)].sort((a, b) => a - b);
      const gap = Math.max(0, -t[1], t[0] - len);
      if (gap > Math.max(80, w.width)) return null;
      return {
        wall: w,
        score: lateral * 4 + gap - Math.min(len, Math.max(0, Math.min(t[1], len) - Math.max(t[0], 0))) * 0.01,
      };
    })
    .filter((v) => v !== null)
    .sort((a, b) => a.score - b.score)[0]?.wall;
}
export function resolvedOpening(o: Opening, walls: Wall[]): Opening {
  const host = openingHost(o, walls);
  let result = o;
  if (o.type !== 'threshold' && o.autoDepth !== false && host) {
    const dir = unit(host.a, host.b),
      normal: Point = [-dir[1], dir[0]],
      offset = dot(sub(host.a, o.a), normal);
    result = { ...o, width: host.width, a: add(o.a, mul(normal, offset)), b: add(o.b, mul(normal, offset)) };
  }
  if (result.type !== 'door') return result;
  const axis = unit(result.a, result.b),
    normal: Point = [-axis[1], axis[0]],
    len = distance(result.a, result.b);
  let lo = 0,
    hi = len;
  // Door cuts stop at the inner face of perpendicular walls, including after wall preset changes.
  for (const w of walls) {
    const direction = unit(w.a, w.b);
    if (Math.abs(dot(axis, direction)) > 0.3) continue;
    const n: Point = [(-direction[1] * w.width) / 2, (direction[0] * w.width) / 2];
    const poly = [add(w.a, n), sub(w.a, n), add(w.b, n), sub(w.b, n)].map((pt) => sub(pt, result.a));
    const xs = poly.map((pt) => dot(pt, axis)),
      ys = poly.map((pt) => dot(pt, normal)),
      start = Math.min(...xs),
      end = Math.max(...xs);
    if (Math.max(...ys) < -result.width / 2 - 2 || Math.min(...ys) > result.width / 2 + 2) continue;
    if (start <= lo + 2 && end > lo && end < len * 0.35) lo = end;
    if (end >= hi - 2 && start < hi && start > len * 0.65) hi = start;
  }
  const available = Math.max(1, hi - lo),
    reserve = (result.jambStart ?? 0) + (result.jambEnd ?? 0),
    scale = reserve > available - 50 ? Math.max(0, (available - 50) / reserve) : 1;
  lo += (result.jambStart ?? 0) * scale;
  hi -= (result.jambEnd ?? 0) * scale;
  return { ...result, a: add(result.a, mul(axis, lo)), b: add(result.a, mul(axis, hi)) };
}
export function openingLevels(o: Opening) {
  if (o.type === 'railing') return { bottom: 0, top: o.railingHeight ?? 1100 };
  const bottom = o.type === 'window' ? (o.sill ?? 900) : 0;
  return { bottom, top: bottom + (o.height ?? (o.type === 'window' ? 1300 : 2100)) };
}
export function bayFootprint(o: Opening): Point[] {
  const axis = unit(o.a, o.b),
    side = o.baySide ?? -1;
  const near = mul([-axis[1], axis[0]], (-side * o.width) / 2);
  const far = mul([-axis[1], axis[0]], side * (o.width / 2 + (o.bayDepth ?? 600)));
  return [add(o.a, near), add(o.b, near), add(o.b, far), add(o.a, far)];
}

/** Join only true endpoint corners. T junctions keep the through wall intact. */
export function wallFootprint(w: Wall, walls: Wall[]): Point[] {
  const dir = unit(w.a, w.b),
    normal: Point = [-dir[1], dir[0]];
  const ends = ([w.a, w.b] as Point[]).map((at, i) => {
    const neighbors = walls.filter((v) => v.id !== w.id && (distance(v.a, at) < 2 || distance(v.b, at) < 2));
    return ([1, -1] as const).map((side) => {
      const edge = add(at, mul(normal, (side * w.width) / 2));
      if (neighbors.length !== 1) return edge;
      const v = neighbors[0],
        away = unit(at, distance(v.a, at) < 2 ? v.b : v.a);
      const denominator = cross(dir, away);
      if (Math.abs(denominator) < 0.1) return edge;
      const otherNormal: Point = [-away[1] * (i ? 1 : -1), away[0] * (i ? 1 : -1)];
      const otherEdge = add(at, mul(otherNormal, (side * v.width) / 2));
      const joined = add(edge, mul(dir, cross(sub(otherEdge, edge), away) / denominator));
      return distance(joined, at) <= Math.max(w.width, v.width) * 2 ? joined : edge;
    });
  });
  return [ends[0][0], ends[1][0], ends[1][1], ends[0][1]];
}

/** Rectangular detector returns faces. Reconcile their near-touching centre lines at L/T corners. */
export function joinWallAxes(walls: Wall[]) {
  const before = structuredClone(walls);
  for (const w of walls)
    for (const key of ['a', 'b'] as const) {
      const original = before.find((v) => v.id === w.id)!;
      const dir = unit(original.a, original.b),
        at = original[key];
      const span = distance(original.a, original.b);
      const throughJamb = before.some((v) => {
        if (v.id === w.id) return false;
        const axis = unit(v.a, v.b),
          den = cross(dir, axis);
        if (Math.abs(den) < 0.2) return false;
        const joint = add(at, mul(dir, cross(sub(v.a, at), axis) / den)),
          along = dot(sub(joint, original.a), dir);
        return (
          along > v.width / 2 + 2 &&
          span - along > v.width / 2 + 2 &&
          distance(joint, at) <= w.width + v.width &&
          projectPoint(joint, v.a, v.b).distance <= (w.width + v.width) / 2 + 4
        );
      });
      let best: { point: Point; score: number } | undefined;
      for (const v of before) {
        if (v.id === w.id) continue;
        const axis = unit(v.a, v.b),
          den = cross(dir, axis);
        if (Math.abs(den) < 0.2) continue;
        const joint = add(at, mul(dir, cross(sub(v.a, at), axis) / den));
        const along = dot(sub(joint, original.a), dir);
        // A T's through wall continues beyond both faces of its stem. Keep
        // those ends: snapping them to the stem axis would erase the jamb arms.
        if (along > v.width / 2 + 2 && span - along > v.width / 2 + 2) continue;
        // A second doorway can meet an arm of that same T. It must not shorten
        // the already established through-jamb either.
        if (throughJamb && (key === 'a' ? along > 0 : along < span)) continue;
        const d = distance(joint, at),
          reach = (w.width + v.width) / 2 + 4;
        if (d > reach || projectPoint(joint, v.a, v.b).distance > reach) continue;
        if (distance(joint, original[key === 'a' ? 'b' : 'a']) < w.width) continue;
        if (!best || d < best.score) best = { point: joint, score: d };
      }
      if (best) w[key] = best.point;
    }
}

/** Monotone coordinate deformation keeps shared boundaries and adjacent rooms connected.
 * Geometry outside the resized span translates, retaining its dimensions and all wall thicknesses. */
export function resizeRoomLayout(p: Project, id: string, width: number, height: number) {
  const room = p.rooms.find((r) => r.id === id);
  if (!room) return;
  const b = bounds(room.poly);
  const warp = (v: number, start: number, size: number, target: number) =>
    v <= start ? v : v >= start + size ? v + target - size : start + ((v - start) * target) / size;
  const map = ([x, y]: Point): Point => [warp(x, b.x, b.w, width), warp(y, b.y, b.h, height)];
  p.rooms.forEach((r) => {
    r.poly = r.poly.map(map);
    if (!p.continuous) r.flooring.origin = map(r.flooring.origin);
  });
  p.shafts.forEach((s) => {
    s.poly = s.poly.map(map);
  });
  [...p.walls, ...p.openings, ...p.measures].forEach((v) => {
    v.a = map(v.a);
    v.b = map(v.b);
  });
  p.furniture.forEach((v) => {
    [v.cx, v.cy] = map([v.cx, v.cy]);
  });
  p.devices.forEach((v) => {
    [v.x, v.y] = map([v.x, v.y]);
  });
  p.routes.forEach((v) => {
    v.points = v.points.map(map);
  });
}
export function setWallWidth(p: Project, id: string, width: number) {
  const wall = p.walls.find((w) => w.id === id);
  if (wall) {
    wall.width = width;
    return;
  }
  const source = allWalls(p).find((w) => w.id === id);
  if (!source) return;
  // Both owners of a shared wall use the same width, regardless of which room is rendered first.
  p.rooms
    .filter((r) => r.boundary)
    .forEach((r) =>
      r.poly.forEach((a, i) => {
        const b = r.poly[(i + 1) % r.poly.length];
        if (
          (distance(a, source.a) < 1 && distance(b, source.b) < 1) ||
          (distance(a, source.b) < 1 && distance(b, source.a) < 1)
        ) {
          r.edgeWidths ??= {};
          r.edgeWidths[i] = width;
        }
      }),
    );
}
