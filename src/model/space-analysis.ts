import { floorIgnored, furniturePolygon, regionArea, storageTypes } from './space-geometry';
import { allWalls, openingPolygon, wallSegments } from './geometry';
import { resolvedOpening } from './architecture';
import type { Project, Room } from './types';
export const DEFAULT_ANALYSIS: NonNullable<Project['analysis']> = {
  flows: [],
  showAreas: false,
  showTypes: false,
  clearance: 600,
};
export interface AreaMetrics {
  net: number;
  occupied: number;
  free: number;
  storage: number;
}
export function spaceMetrics(p: Project, rooms: Room[] = p.rooms.filter((r) => r.counted)): AreaMetrics {
  const regions = rooms.map((r) => r.poly),
    walls = allWalls(p),
    openings = p.openings.map((o) => resolvedOpening(o, walls)),
    structure = [
      ...p.shafts.map((s) => s.poly),
      ...walls.flatMap((w) =>
        wallSegments(w, openings)
          .filter((s) => s.bottom < 1 && s.top > 0)
          .map((s) => openingPolygon(s.a, s.b, w.width)),
      ),
    ];
  const floorItems = p.furniture.filter((f) => !floorIgnored.has(f.type));
  const net = regionArea(regions, structure),
    free = regionArea(regions, [...structure, ...floorItems.map((f) => furniturePolygon(f))]);
  const storage =
    net -
    regionArea(regions, [
      ...structure,
      ...floorItems.filter((f) => storageTypes.has(f.type)).map((f) => furniturePolygon(f)),
    ]);
  return { net, occupied: Math.max(0, net - free), free, storage: Math.max(0, storage) };
}
export function areaCsv(p: Project) {
  const cell = (v: unknown) =>
    '"' +
    String(v)
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const rows: unknown[][] = [
    ['房间', '计入全屋', '净面积 ㎡', '家具占地 ㎡', '可活动面积 ㎡', '收纳占地 ㎡'],
  ];
  for (const r of p.rooms) {
    const a = spaceMetrics(p, [r]);
    rows.push([
      r.name,
      r.counted ? '是' : '否',
      a.net.toFixed(2),
      a.occupied.toFixed(2),
      a.free.toFixed(2),
      a.storage.toFixed(2),
    ]);
  }
  const a = spaceMetrics(p);
  rows.push([
    '全屋合计（空间去重）',
    '',
    a.net.toFixed(2),
    a.occupied.toFixed(2),
    a.free.toFixed(2),
    a.storage.toFixed(2),
  ]);
  return '\ufeff' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
