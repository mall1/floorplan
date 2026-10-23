import { LIB } from '../data/original';
import {
  allWalls,
  bounds,
  distance,
  inside,
  openingPolygon,
  projectPoint,
  roomCenter,
  uid,
} from './geometry';
import { effectiveRoomKind } from './room-types';
import { floorIgnored, furniturePolygon, nearPolygon, polygonFits, polygonsOverlap } from './space-geometry';
import type { Furniture, Point, Project, Room, RoomKind } from './types';

// Ordered by function: major furniture is placed before optional accessories.
const TEMPLATES: Record<RoomKind, string[]> = {
  unknown: [],
  bedroom: ['bed', 'wardrobe', 'nightstand', 'desk'],
  living: ['sofa', 'tvstand', 'coffeetable', 'armchair'],
  kitchen: ['counter', 'fridge', 'pantry'],
  dining: ['table', 'chair', 'chair', 'chair', 'chair', 'cabinet'],
  bathroom: ['shower', 'toilet', 'vanity'],
  balcony: ['armchair', 'sidetable', 'plant'],
  laundry: ['washer', 'dryer', 'cabinet', 'laundrybasket'],
  study: ['desk', 'officechair', 'bookshelf'],
  storage: ['wardrobe', 'bookshelf', 'chest'],
  hallway: ['shoecab', 'bench', 'coatrack'],
};
const equivalents: Record<string, string[]> = {
  bed: ['bed', 'bunkbed', 'daybed'],
  sofa: ['sofa', 'cornersofa'],
  desk: ['desk', 'standingdesk'],
  washer: ['washer', 'laundrytower'],
  dryer: ['dryer', 'laundrytower'],
  table: ['table', 'roundtable'],
};
export interface LayoutResult {
  furniture: Furniture[];
  removed: string[];
  skipped: string[];
  warnings: string[];
}
export function autoLayout(
  p: Project,
  room: Room,
  options: { compact: boolean; replace: boolean },
): LayoutResult {
  const kind = effectiveRoomKind(p, room),
    template = TEMPLATES[kind];
  if (!template.length)
    return { furniture: [], removed: [], skipped: [], warnings: ['请先设置房间类型，再自动布置。'] };
  const members = p.furniture.filter((f) => inside([f.cx, f.cy], room.poly));
  const removed = options.replace ? members.map((f) => f.id) : [];
  const fixed = p.furniture.filter((f) => !removed.includes(f.id));
  const occupied = fixed
    .filter((f) => !floorIgnored.has(f.type))
    .map((f) => ({ id: f.id, poly: furniturePolygon(f, 40) }));
  const walls = allWalls(p).map((w) => openingPolygon(w.a, w.b, w.width + 40));
  const shafts = [
      ...p.shafts.map((s) => s.poly),
      ...p.devices
        .filter((d) => d.kind === 'pipe' && d.height > 200)
        .map((d) =>
          Array.from({ length: 12 }, (_, i): Point => [
            d.x + Math.cos((i * Math.PI) / 6) * ((d.diameter ?? 110) / 2 + 40),
            d.y + Math.sin((i * Math.PI) / 6) * ((d.diameter ?? 110) / 2 + 40),
          ]),
        ),
      ...p.openings.filter((o) => o.type === 'railing').map((o) => openingPolygon(o.a, o.b, 100)),
    ],
    rb = bounds(room.poly),
    center = roomCenter(room.poly);
  const doors = p.openings.filter(
    (o) =>
      o.type === 'door' &&
      nearPolygon([(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2], room.poly, o.width + 150),
  );
  const reserved = doors.map((o) => openingPolygon(o.a, o.b, Math.max(1200, o.width + 1000)));
  const chosen: Furniture[] = [],
    skipped: string[] = [];
  const used = new Map<string, number>();
  const candidates = (base: Furniture, target?: Furniture): Furniture[] => {
    const result: Furniture[] = [];
    if (target) {
      const angle = (target.rot * Math.PI) / 180;
      const relative = (x: number, y: number, rotation = 0) =>
        result.push({
          ...base,
          cx: target.cx + x * Math.cos(angle) - y * Math.sin(angle),
          cy: target.cy + x * Math.sin(angle) + y * Math.cos(angle),
          rot: target.rot + rotation,
        });
      if (base.type === 'chair') {
        for (const gap of [180, 300]) {
          relative(0, -target.d / 2 - base.d / 2 - gap, 0);
          relative(0, target.d / 2 + base.d / 2 + gap, 180);
          relative(-target.w / 2 - base.d / 2 - gap, 0, -90);
          relative(target.w / 2 + base.d / 2 + gap, 0, 90);
        }
        return result;
      }
      if (base.type === 'officechair') {
        for (const gap of [180, 300, 450]) relative(0, target.d / 2 + base.d / 2 + gap, 180);
        return result;
      }
      if (base.type === 'nightstand') {
        for (const side of [-1, 1])
          relative(side * (target.w / 2 + base.w / 2 + 140), -target.d / 2 + base.d / 2);
        return result;
      }
      if (base.type === 'coffeetable') {
        for (const gap of [450, 600, 800]) relative(0, target.d / 2 + base.d / 2 + gap);
        return result;
      }
    }
    for (let i = 0; i < room.poly.length; i++) {
      const a = room.poly[i],
        b = room.poly[(i + 1) % room.poly.length],
        len = distance(a, b);
      if (len < 200) continue;
      const ux = (b[0] - a[0]) / len,
        uy = (b[1] - a[1]) / len;
      for (const side of [-1, 1]) {
        const nx = -uy * side,
          ny = ux * side;
        const rot = (Math.atan2(-nx, ny) * 180) / Math.PI;
        for (const extra of [60, 180, 350]) {
          const offset = base.d / 2 + extra + (room.boundary ? room.wallWidth / 2 : 0);
          const count = Math.max(1, Math.ceil(len / 250));
          for (let j = 0; j <= count; j++) {
            const t = j / count;
            result.push({
              ...base,
              cx: a[0] + ux * len * t + nx * offset,
              cy: a[1] + uy * len * t + ny * offset,
              rot,
            });
          }
        }
      }
    }
    // Tables and small rooms also need positions away from the perimeter.
    for (const rot of [0, 90])
      for (const fx of [0.35, 0.5, 0.65])
        for (const fy of [0.35, 0.5, 0.65])
          result.push({ ...base, cx: rb.x + rb.w * fx, cy: rb.y + rb.h * fy, rot });
    return result;
  };
  for (const type of template) {
    const count = (used.get(type) ?? 0) + 1;
    used.set(type, count);
    if (
      !options.replace &&
      members.filter((f) => (equivalents[type] ?? [type]).includes(f.type)).length >= count
    )
      continue;
    const variants = LIB.flatMap((g) => g.items)
      .filter((item) => item[0] === type)
      .sort((a, b) => Number(a[2]) * Number(a[3]) - Number(b[2]) * Number(b[3]));
    const item = options.compact ? variants[0] : variants[Math.min(1, variants.length - 1)];
    if (!item) continue;
    const base: Furniture = {
      id: uid(),
      type,
      name: String(item[1]),
      w: Number(item[2]),
      d: Number(item[3]),
      color: String(item[4]),
      cx: 0,
      cy: 0,
      rot: 0,
    };
    let best: Furniture | null = null,
      bestScore = Infinity;
    const targetType =
      type === 'chair'
        ? 'table'
        : type === 'officechair'
          ? 'desk'
          : type === 'coffeetable'
            ? 'sofa'
            : type === 'nightstand'
              ? 'bed'
              : undefined;
    const target = [...chosen, ...(!options.replace ? members : [])].find(
      (f) => targetType && (equivalents[targetType] ?? [targetType]).includes(f.type),
    );
    if (targetType && !target) {
      skipped.push(String(item[1]));
      continue;
    }
    for (const f of candidates(base, target)) {
      const poly = furniturePolygon(f, 25);
      if (
        !polygonFits(poly, room.poly) ||
        [...walls, ...shafts, ...reserved, ...occupied.map((o) => o.poly)].some((o) =>
          polygonsOverlap(poly, o),
        )
      )
        continue;
      const angle = (f.rot * Math.PI) / 180;
      const front: Point = [
        f.cx - Math.sin(angle) * (f.d / 2 + 300),
        f.cy + Math.cos(angle) * (f.d / 2 + 300),
      ];
      if (
        !nearPolygon(front, room.poly) ||
        [
          ...walls,
          ...shafts,
          ...occupied
            .filter((o) => !(['chair', 'officechair'].includes(type) && o.id === target?.id))
            .map((o) => o.poly),
        ].some((o) => nearPolygon(front, o, 100))
      )
        continue;
      const wallDistance = Math.min(
        ...room.poly.map(
          (a, i) => projectPoint([f.cx, f.cy], a, room.poly[(i + 1) % room.poly.length]).distance,
        ),
      );
      let score = wallDistance + distance([f.cx, f.cy], center) * 0.03;
      if (type === 'table') score = distance([f.cx, f.cy], center);
      if (target) score = distance([f.cx, f.cy], [target.cx, target.cy]);
      if (type === 'tvstand') {
        const sofa = [...chosen, ...(!options.replace ? members : [])].find((f) =>
          equivalents.sofa.includes(f.type),
        );
        if (sofa) {
          const a = (sofa.rot * Math.PI) / 180,
            projection = (f.cx - sofa.cx) * -Math.sin(a) + (f.cy - sofa.cy) * Math.cos(a);
          score +=
            projection < 1000
              ? 10000
              : Math.abs((f.cx - sofa.cx) * Math.cos(a) + (f.cy - sofa.cy) * Math.sin(a));
        }
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    if (best) {
      chosen.push(best);
      occupied.push({ id: best.id, poly: furniturePolygon(best, 80) });
    } else skipped.push(String(item[1]));
  }
  return {
    furniture: chosen,
    removed: chosen.length ? removed : [],
    skipped,
    warnings: skipped.length ? ['部分家具因空间、门洞或障碍限制未放入，可改选紧凑方案或手动调整。'] : [],
  };
}
