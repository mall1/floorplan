import { allWalls, distance, inside } from './geometry';
import { openingLevels, resolvedOpening } from './architecture';
import type { Opening, Point, Project, Wall } from './types';

type Span = [number, number];
type Surface = { from: number; to: number; bottom: number; top: number };
const EPS = 1e-6;
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const stops = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

function merged(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of spans.filter(([a, b]) => b - a > EPS).sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Clip a wall-face probe to any simple room polygon, including concave and rotated rooms. */
function roomSpans(a: Point, direction: Point, len: number, poly: Point[]): Span[] {
  const cuts = [0, len];
  poly.forEach((p, i) => {
    const edge = sub(poly[(i + 1) % poly.length], p),
      den = cross(direction, edge);
    if (Math.abs(den) < EPS) return;
    const offset = sub(p, a),
      t = cross(offset, edge) / den,
      u = cross(offset, direction) / den;
    if (t > 0 && t < len && u >= 0 && u <= 1) cuts.push(t);
  });
  const ordered = stops(cuts);
  return ordered.slice(1).flatMap((to, i) => {
    const from = ordered[i],
      mid = (from + to) / 2;
    return inside([a[0] + direction[0] * mid, a[1] + direction[1] * mid], poly) ? [[from, to] as Span] : [];
  });
}

function openingCuts(
  wall: Wall,
  direction: Point,
  len: number,
  height: number,
  openings: Opening[],
): Surface[] {
  return openings.flatMap((o) => {
    if (o.type === 'threshold') return [];
    const delta = sub(o.b, o.a),
      openingLength = distance(o.a, o.b);
    if (openingLength < 1 || Math.abs(dot(delta, direction) / openingLength) < 0.98) return [];
    const a = sub(o.a, wall.a),
      b = sub(o.b, wall.a),
      tolerance = Math.max(12, wall.width * 0.55);
    if (Math.abs(cross(a, direction)) > tolerance || Math.abs(cross(b, direction)) > tolerance) return [];
    const from = Math.max(0, Math.min(dot(a, direction), dot(b, direction))),
      to = Math.min(len, Math.max(dot(a, direction), dot(b, direction))),
      levels = openingLevels(o),
      bottom = o.type === 'railing' ? 0 : Math.max(0, levels.bottom),
      top = o.type === 'railing' ? height : Math.min(height, levels.top);
    return to > from && top > bottom ? [{ from, to, bottom, top }] : [];
  });
}

/** Apertures are a union in two dimensions, so overlapping doors/windows are deducted only once. */
function solidSurfaces(len: number, height: number, cuts: Surface[]): Surface[] {
  const xs = stops([0, len, ...cuts.flatMap((c) => [c.from, c.to])]),
    out: Surface[] = [];
  xs.slice(1).forEach((to, i) => {
    const from = xs[i],
      mid = (from + to) / 2;
    const blocked = merged(cuts.filter((c) => c.from <= mid && c.to >= mid).map((c) => [c.bottom, c.top]));
    let bottom = 0;
    for (const [a, b] of blocked) {
      if (a > bottom) out.push({ from, to, bottom, top: a });
      bottom = b;
    }
    if (height > bottom) out.push({ from, to, bottom, top: height });
  });
  return out;
}

function surfaceArea(rectangles: Surface[]) {
  const xs = stops(rectangles.flatMap((r) => [r.from, r.to]));
  return xs.slice(1).reduce((sum, to, i) => {
    const from = xs[i],
      mid = (from + to) / 2;
    const height = merged(
      rectangles.filter((r) => r.from <= mid && r.to >= mid).map((r) => [r.bottom, r.top]),
    ).reduce((sum, [a, b]) => sum + b - a, 0);
    return sum + ((to - from) * height) / 1e6;
  }, 0);
}

export interface WallAreaTotals {
  gross: number;
  deduction: number;
  net: number;
  purchase: number;
}
export interface RoomWallArea extends WallAreaTotals {
  id: string;
  name: string;
  included: boolean;
  height?: number;
}
export interface WallAreaReport {
  rooms: RoomWallArea[];
  total: WallAreaTotals;
  waste: number;
  unassignedLength: number;
}

/** Interior-facing sides only. Shared walls contribute one face to each room; internal partitions contribute both.
 * Lengths follow wall axes (no corner mitres, reveals, shaft cladding or bay returns).
 */
export function wallAreaReport(project: Project): WallAreaReport {
  const walls = allWalls(project),
    openings = project.openings.map((o) => resolvedOpening(o, walls)),
    waste = project.wallFinish?.waste ?? 10,
    assigned = new Map<string, Span[]>();
  const prepared = walls
    .filter((w) => distance(w.a, w.b) >= 1)
    .map((wall) => {
      // Canonical direction makes reversed/overlapping fragments share the same surface plane.
      if (wall.b[0] < wall.a[0] || (wall.b[0] === wall.a[0] && wall.b[1] < wall.a[1]))
        wall = { ...wall, a: wall.b, b: wall.a };
      const len = distance(wall.a, wall.b),
        direction: Point = [(wall.b[0] - wall.a[0]) / len, (wall.b[1] - wall.a[1]) / len],
        normal: Point = [-direction[1], direction[0]];
      return { wall, len, direction, normal, surfaces: new Map<number, Surface[]>() };
    });
  const rooms = project.rooms.map((room): RoomWallArea => {
    const groups = new Map<string, { gross: Surface[]; net: Surface[] }>(),
      heightOverride = room.wallFinish?.height ?? project.wallFinish?.height;
    for (const { wall, len, direction, normal, surfaces } of prepared) {
      const height = heightOverride ?? wall.height,
        origin = dot(wall.a, direction);
      for (const side of [-1, 1]) {
        // Probe just inside the room-facing side, supporting outlines on either the wall axis or inner face.
        const offset = side * (wall.width / 2 + 0.5),
          probe: Point = [wall.a[0] + normal[0] * offset, wall.a[1] + normal[1] * offset],
          spans = roomSpans(probe, direction, len, room.poly);
        if (!spans.length) continue;
        let solid = surfaces.get(height);
        if (!solid) {
          solid = solidSurfaces(len, height, openingCuts(wall, direction, len, height, openings));
          surfaces.set(height, solid);
        }
        assigned.set(wall.id, [...(assigned.get(wall.id) ?? []), ...spans]);
        const key = `${direction.map((v) => v.toFixed(6)).join(',')}:${(dot(wall.a, normal) + (side * wall.width) / 2).toFixed(2)}:${side}`;
        let group = groups.get(key);
        if (!group) {
          group = { gross: [], net: [] };
          groups.set(key, group);
        }
        for (const [from, to] of spans) {
          group.gross.push({ from: origin + from, to: origin + to, bottom: 0, top: height });
          for (const r of solid) {
            const a = Math.max(from, r.from),
              b = Math.min(to, r.to);
            if (b > a) group.net.push({ ...r, from: origin + a, to: origin + b });
          }
        }
      }
    }
    const gross = [...groups.values()].reduce((sum, g) => sum + surfaceArea(g.gross), 0),
      net = [...groups.values()].reduce((sum, g) => sum + surfaceArea(g.net), 0);
    return {
      id: room.id,
      name: room.name,
      included: room.wallFinish?.included !== false,
      height: heightOverride,
      gross,
      deduction: Math.max(0, gross - net),
      net,
      purchase: net * (1 + waste / 100),
    };
  });
  const total = rooms
    .filter((r) => r.included)
    .reduce(
      (sum, r) => ({
        gross: sum.gross + r.gross,
        deduction: sum.deduction + r.deduction,
        net: sum.net + r.net,
        purchase: sum.purchase + r.purchase,
      }),
      { gross: 0, deduction: 0, net: 0, purchase: 0 },
    );
  const unassignedLength =
    prepared.reduce(
      (sum, { wall, len }) =>
        sum + Math.max(0, len - merged(assigned.get(wall.id) ?? []).reduce((n, [a, b]) => n + b - a, 0)),
      0,
    ) / 1000;
  return { rooms, total, waste, unassignedLength };
}

export function wallAreaCsv(report: WallAreaReport): string {
  const header = [
    '房间',
    '计入合计',
    '估算高度 mm',
    '墙面毛面积 ㎡',
    '洞口扣除 ㎡',
    '墙面净面积 ㎡',
    '损耗 %',
    '含损耗参考面积 ㎡',
  ];
  const rows = report.rooms.map((r) => [
    r.name,
    r.included ? '是' : '否',
    r.height ?? '按模型墙高',
    r.gross.toFixed(2),
    r.deduction.toFixed(2),
    r.net.toFixed(2),
    report.waste,
    r.purchase.toFixed(2),
  ]);
  rows.push([
    '全屋合计（已勾选房间）',
    '',
    '',
    report.total.gross.toFixed(2),
    report.total.deduction.toFixed(2),
    report.total.net.toFixed(2),
    report.waste,
    report.total.purchase.toFixed(2),
  ]);
  rows.push([
    '口径：按墙轴长度估算，共用墙两侧分别计入；扣除门窗洞口及护栏整段；不含洞口侧壁、烟道包柱、飘窗内侧及墙角搭接修正。',
  ]);
  rows.push(['自定义估算高度替代模型墙高；含损耗面积不等于卷数，需结合卷宽、卷长及对花裁切。']);
  if (report.unassignedLength > 0.01)
    rows.push([`未归属房间的墙段约 ${report.unassignedLength.toFixed(2)} m，未计入。`]);
  const cell = (v: unknown) =>
    '"' +
    String(v)
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return '\ufeff' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
