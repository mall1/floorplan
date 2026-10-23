import {
  allWalls,
  bounds,
  distance,
  inside,
  length,
  openingPolygon,
  roomCenter,
  wallSegments,
} from './geometry';
import { resolvedOpening } from './architecture';
import { effectiveRoomKind } from './room-types';
import { floorIgnored, furniturePolygon, nearPolygon } from './space-geometry';
import type { FlowKind, Point, Project, Room } from './types';

export const FLOW_TYPES: Record<FlowKind, { label: string; color: string; description: string }> = {
  daily: { label: '日常通行', color: '#397fbe', description: '卧室 → 卫生间、客厅' },
  housework: { label: '家务动线', color: '#bc8634', description: '厨房 → 餐厅 → 洗衣区 → 阳台' },
  guest: { label: '访客动线', color: '#9569b5', description: '入口 → 客厅 → 餐厅' },
};
export interface FlowPath {
  kind: FlowKind;
  label: string;
  points: Point[];
  status: 'clear' | 'blocked' | 'unavailable';
  reason: string;
  bottleneck?: Point;
  distance: number;
}
export interface NavigationGrid {
  step: number;
  cols: number;
  rows: number;
  points: Point[];
  base: Uint8Array;
  free: Uint8Array;
  canSegment: (a: Point, b: Point, furniture: boolean) => boolean;
}
export function navigationGrid(p: Project, clearance = 600): NavigationGrid | null {
  if (!p.rooms.length) return null;
  const b = bounds(p.rooms.flatMap((r) => r.poly));
  const step = Math.max(150, Math.ceil(Math.sqrt((b.w * b.h) / 22000) / 25) * 25);
  const cols = Math.ceil(b.w / step) + 1,
    rows = Math.ceil(b.h / step) + 1;
  const walls = allWalls(p),
    openings = p.openings.map((o) => resolvedOpening(o, walls));
  const obstaclePolys = [
    ...walls.flatMap((w) =>
      wallSegments(w, openings)
        .filter((s) => s.bottom < 1800 && s.top > 200)
        .map((s) => openingPolygon(s.a, s.b, w.width)),
    ),
    ...p.shafts.filter((s) => s.height > 200).map((s) => s.poly),
    ...openings.filter((o) => o.type === 'railing').map((o) => openingPolygon(o.a, o.b, 60)),
  ].map((poly) => ({ poly, box: bounds(poly) }));
  const pipes = p.devices.filter((d) => d.kind === 'pipe' && d.height > 200);
  const doors = openings
    .filter((o) => o.type === 'door')
    .map((o) => openingPolygon(o.a, o.b, o.width + step * 2));
  const items = p.furniture
    .filter((f) => !floorIgnored.has(f.type))
    .map((f) => {
      const poly = furniturePolygon(f),
        box = bounds(poly);
      return { poly, box };
    });
  const freeAt = (point: Point, furniture: boolean) => {
    if (!p.rooms.some((r) => inside(point, r.poly)) && !doors.some((poly) => inside(point, poly)))
      return false;
    for (const { poly, box } of obstaclePolys) {
      const margin = clearance / 2;
      if (
        point[0] < box.x - margin ||
        point[0] > box.x + box.w + margin ||
        point[1] < box.y - margin ||
        point[1] > box.y + box.h + margin
      )
        continue;
      if (nearPolygon(point, poly, margin - 0.01)) return false;
    }
    if (pipes.some((d) => distance(point, [d.x, d.y]) < (d.diameter ?? 110) / 2 + clearance / 2))
      return false;
    if (furniture)
      for (const item of items) {
        const { box } = item,
          margin = clearance / 2;
        if (
          point[0] < box.x - margin ||
          point[0] > box.x + box.w + margin ||
          point[1] < box.y - margin ||
          point[1] > box.y + box.h + margin
        )
          continue;
        if (nearPolygon(point, item.poly, margin)) return false;
      }
    return true;
  };
  const points: Point[] = [],
    base = new Uint8Array(cols * rows),
    free = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const point: Point = [b.x + x * step, b.y + y * step],
        index = y * cols + x;
      points.push(point);
      base[index] = freeAt(point, false) ? 1 : 0;
      free[index] = base[index] && freeAt(point, true) ? 1 : 0;
    }
  const canSegment = (a: Point, b: Point, furniture: boolean) => {
    const count = Math.max(1, Math.ceil(distance(a, b) / 75));
    for (let i = 0; i <= count; i++)
      if (!freeAt([a[0] + ((b[0] - a[0]) * i) / count, a[1] + ((b[1] - a[1]) * i) / count], furniture))
        return false;
    return true;
  };
  return { step, cols, rows, points, base, free, canSegment };
}
function nearest(grid: NavigationGrid, room: Room, target: Point, furniture: boolean) {
  let best = -1,
    score = Infinity;
  const mask = furniture ? grid.free : grid.base;
  grid.points.forEach((p, i) => {
    if (!mask[i] || !inside(p, room.poly)) return;
    const d = distance(p, target);
    if (d < score) {
      best = i;
      score = d;
    }
  });
  return best;
}
/** A* with checked edges; diagonal moves and path simplification cannot cut corners. */
export function gridPath(grid: NavigationGrid, start: number, goal: number, furniture = true): Point[] {
  if (start < 0 || goal < 0) return [];
  const mask = furniture ? grid.free : grid.base;
  if (!mask[start] || !mask[goal]) return [];
  const scores = new Float64Array(mask.length).fill(Infinity),
    previous = new Int32Array(mask.length).fill(-1),
    closed = new Uint8Array(mask.length);
  const heap: { index: number; score: number }[] = [];
  const push = (index: number, score: number) => {
    let at = heap.length;
    heap.push({ index, score });
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (heap[parent].score <= score) break;
      heap[at] = heap[parent];
      at = parent;
    }
    heap[at] = { index, score };
  };
  const pop = () => {
    const result = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let at = 0;
      while (at * 2 + 1 < heap.length) {
        let child = at * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
        if (heap[child].score >= last.score) break;
        heap[at] = heap[child];
        at = child;
      }
      heap[at] = last;
    }
    return result.index;
  };
  scores[start] = 0;
  push(start, 0);
  while (heap.length) {
    const at = pop();
    if (closed[at]) continue;
    if (at === goal) {
      const path: Point[] = [];
      for (let i = goal; i !== -1; i = previous[i]) path.push(grid.points[i]);
      path.reverse();
      const simplified: Point[] = [path[0]];
      for (let i = 0; i < path.length - 1;) {
        let next = Math.min(path.length - 1, i + 20);
        while (next > i + 1 && !grid.canSegment(path[i], path[next], furniture)) next--;
        simplified.push(path[next]);
        i = next;
      }
      return simplified;
    }
    closed[at] = 1;
    const x = at % grid.cols,
      y = Math.floor(at / grid.cols);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const nx = x + dx,
        ny = y + dy,
        next = ny * grid.cols + nx;
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows || !mask[next] || closed[next]) continue;
      const score = scores[at] + grid.step * Math.hypot(dx, dy);
      if (score >= scores[next] || !grid.canSegment(grid.points[at], grid.points[next], furniture)) continue;
      scores[next] = score;
      previous[next] = at;
      push(next, score + distance(grid.points[next], grid.points[goal]));
    }
  }
  return [];
}
function entrance(p: Project) {
  for (const door of p.openings.filter((o) => o.type === 'door')) {
    const len = distance(door.a, door.b) || 1,
      middle: Point = [(door.a[0] + door.b[0]) / 2, (door.a[1] + door.b[1]) / 2];
    const sides = [-1, 1].map(
      (s) =>
        [
          middle[0] - ((door.b[1] - door.a[1]) / len) * (door.width / 2 + 120) * s,
          middle[1] + ((door.b[0] - door.a[0]) / len) * (door.width / 2 + 120) * s,
        ] as Point,
    );
    const rooms = sides.map((point) => p.rooms.find((r) => inside(point, r.poly)));
    if (Boolean(rooms[0]) !== Boolean(rooms[1])) {
      const side = rooms[0] ? 0 : 1;
      return { room: rooms[side]!, point: sides[side] };
    }
  }
  const room =
    p.rooms.find((r) => effectiveRoomKind(p, r) === 'hallway') ||
    p.rooms.find((r) => effectiveRoomKind(p, r) === 'living') ||
    p.rooms[0];
  return room ? { room, point: roomCenter(room.poly) } : null;
}
export function analyzeCirculation(p: Project, kinds: FlowKind[], clearance = 600) {
  if (!kinds.length || !p.rooms.length) return { paths: [] as FlowPath[], step: 150 };
  const grid = navigationGrid(p, clearance)!;
  const rooms = (kind: string) => p.rooms.filter((r) => effectiveRoomKind(p, r) === kind);
  const tasks: { kind: FlowKind; from: Room; to: Room; start?: Point; label: string }[] = [];
  const add = (kind: FlowKind, from: Room | undefined, to: Room | undefined, start?: Point) => {
    if (from && to && (from.id !== to.id || start))
      tasks.push({ kind, from, to, start, label: `${start ? '入口参考点' : from.name} → ${to.name}` });
  };
  if (kinds.includes('daily'))
    for (const bedroom of rooms('bedroom').slice(0, 6)) {
      const bath = [...rooms('bathroom')].sort(
        (a, b) =>
          distance(roomCenter(a.poly), roomCenter(bedroom.poly)) -
          distance(roomCenter(b.poly), roomCenter(bedroom.poly)),
      )[0];
      add('daily', bedroom, bath);
      add('daily', bedroom, rooms('living')[0]);
    }
  if (kinds.includes('housework')) {
    const chain = ['kitchen', 'dining', 'laundry', 'balcony']
      .map((kind) => rooms(kind)[0])
      .filter((r): r is Room => Boolean(r));
    chain.slice(1).forEach((room, i) => add('housework', chain[i], room));
  }
  if (kinds.includes('guest')) {
    const entry = entrance(p),
      living = rooms('living')[0];
    if (entry) add('guest', entry.room, living || rooms('dining')[0], entry.point);
    add('guest', living, rooms('dining')[0]);
  }
  const paths: FlowPath[] = tasks.map(({ kind, from, to, start, label }) => {
    const a = start ?? roomCenter(from.poly),
      b = roomCenter(to.poly);
    const startNode = nearest(grid, from, a, true),
      endNode = nearest(grid, to, b, true);
    const points = gridPath(grid, startNode, endNode);
    if (points.length)
      return { kind, label, points, status: 'clear', reason: '', distance: length(points) / 1000 };
    const baseline = gridPath(
      grid,
      startNode >= 0 ? startNode : nearest(grid, from, a, false),
      endNode >= 0 ? endNode : nearest(grid, to, b, false),
      false,
    );
    let bottleneck: Point | undefined;
    for (let i = 1; i < baseline.length && !bottleneck; i++) {
      const a = baseline[i - 1],
        b = baseline[i],
        count = Math.ceil(distance(a, b) / 75);
      for (let j = 0; j <= count; j++) {
        const point: Point = [a[0] + ((b[0] - a[0]) * j) / count, a[1] + ((b[1] - a[1]) * j) / count];
        if (!grid.canSegment(point, point, true)) {
          bottleneck = point;
          break;
        }
      }
    }
    return {
      kind,
      label,
      points: [],
      status: baseline.length ? 'blocked' : 'unavailable',
      reason: baseline.length
        ? `家具附近无法满足 ${clearance} mm 参考通行宽度`
        : '未找到连通通道，请检查门洞、墙体及参考通行宽度',
      bottleneck: baseline.length ? (bottleneck ?? a) : undefined,
      distance: 0,
    };
  });
  return { paths, step: grid.step };
}
