import { area, bounds, inside, projectPoint } from './geometry';
import type { Project, Room, RoomKind } from './types';

export const ROOM_TYPES: Record<RoomKind, { label: string; color: string }> = {
  unknown: { label: '未指定', color: '#9da39b' },
  living: { label: '客厅', color: '#b89a6e' },
  bedroom: { label: '卧室', color: '#9c8eb1' },
  kitchen: { label: '厨房', color: '#b88c72' },
  dining: { label: '餐厅', color: '#c1a470' },
  bathroom: { label: '卫生间', color: '#77a0b0' },
  balcony: { label: '阳台', color: '#85a47b' },
  laundry: { label: '洗衣房', color: '#77a9a4' },
  study: { label: '书房', color: '#8f9bba' },
  storage: { label: '储藏室', color: '#ad987d' },
  hallway: { label: '玄关 / 过道', color: '#a3a18f' },
};
export interface RoomSuggestion {
  kind: RoomKind;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}
export function kindFromName(name: string): RoomKind {
  // Separate bay/window-sill polygons are not bedrooms even when named after one.
  if (/飘窗|窗台/.test(name)) return 'unknown';
  const rules: [RegExp, RoomKind][] = [
    [/洗衣|laundry/i, 'laundry'],
    [/厨房|餐厨|kitchen/i, 'kitchen'],
    [/卫|浴|洗手|bath|toilet/i, 'bathroom'],
    [/阳台|露台|balcony/i, 'balcony'],
    [/书房|办公|study|office/i, 'study'],
    [/储|贮|杂物|衣帽间|storage/i, 'storage'],
    [/过道|走廊|玄关|门厅|hall|entry/i, 'hallway'],
    [/餐厅|dining/i, 'dining'],
    [/客厅|起居|living/i, 'living'],
    [/卧|儿童房|小孩房|子女房|客房|bedroom/i, 'bedroom'],
  ];
  return rules.find(([pattern]) => pattern.test(name))?.[1] ?? 'unknown';
}
export function inferRoomKind(p: Project, room: Pick<Room, 'name' | 'poly'>): RoomSuggestion {
  const named = kindFromName(room.name);
  if (named !== 'unknown')
    return { kind: named, confidence: 'high', reason: `名称包含${ROOM_TYPES[named].label}用途信息` };
  const items = p.furniture.filter((f) => inside([f.cx, f.cy], room.poly));
  const evidence: [RoomKind, string[], string][] = [
    ['bedroom', ['bed', 'bunkbed', 'crib'], '床具'],
    ['bathroom', ['toilet', 'shower', 'bathtub'], '卫浴洁具'],
    ['kitchen', ['stove', 'ksink', 'counter'], '灶台、水槽或橱柜'],
    ['laundry', ['washer', 'dryer', 'laundrytower'], '洗烘设备'],
    ['living', ['sofa', 'cornersofa', 'tvstand'], '沙发或电视柜'],
    ['dining', ['table', 'roundtable'], '餐桌'],
    ['study', ['desk', 'standingdesk', 'officechair'], '书桌或办公椅'],
    ['storage', ['wardrobe', 'pantry', 'chest'], '收纳柜'],
  ];
  for (const [kind, types, label] of evidence)
    if (items.some((f) => types.includes(f.type)))
      return { kind, confidence: 'high', reason: `房间内有${label}` };
  const close = (point: [number, number]) =>
    inside(point, room.poly) ||
    room.poly.some((a, i) => projectPoint(point, a, room.poly[(i + 1) % room.poly.length]).distance < 350);
  const a = area(room.poly),
    b = bounds(room.poly),
    aspect = Math.max(b.w, b.h) / Math.max(1, Math.min(b.w, b.h));
  if (p.shafts.some((s) => s.poly.some(close)) && a < 20)
    return { kind: 'kitchen', confidence: 'medium', reason: '邻近烟道或管井，可能是厨房，需核对' };
  if (p.devices.some((d) => ['water', 'drain', 'pipe'].includes(d.kind) && close([d.x, d.y])) && a < 12)
    return { kind: 'bathroom', confidence: 'medium', reason: '小空间内有用水或排水点，也可能是洗衣区' };
  if (p.openings.some((o) => o.type === 'railing' && close([(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2])))
    return { kind: 'balcony', confidence: 'medium', reason: '邻近开放护栏，可能是阳台' };
  if (aspect > 3 && a < 18)
    return { kind: 'hallway', confidence: 'low', reason: '轮廓较狭长，仅依据形状推测' };
  if (a > 22) return { kind: 'living', confidence: 'low', reason: '空间面积较大，也可能是餐客厅或大卧室' };
  if (a > 8 && a < 22 && aspect < 2.4)
    return { kind: 'bedroom', confidence: 'low', reason: '面积及比例接近卧室，仅供初步选择' };
  return { kind: 'unknown', confidence: 'low', reason: '用途证据不足，请手动选择' };
}
export const effectiveRoomKind = (p: Project, room: Room): RoomKind =>
  room.kind ?? inferRoomKind(p, room).kind;
