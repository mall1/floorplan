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
import { gridPath, navigationGrid, type NavigationGrid } from './circulation';
import { effectiveRoomKind } from './room-types';
import { nearPolygon } from './space-geometry';
import { ROUTE_KINDS } from './presets';
import { routeLengths, simplifyOrthogonal } from './utility-connections';
import { resolvedDeviceKind } from './utility-style';
import type {
  Device,
  DeviceKind,
  Point,
  Project,
  Room,
  RoomKind,
  Route,
  UtilityKind,
  UtilityLayoutSettings,
} from './types';

export const DEFAULT_UTILITY_LAYOUT: UtilityLayoutSettings = {
  mode: 'ceiling',
  floorHeight: 50,
  ceilingHeight: 2600,
  systems: ['power', 'weak', 'cold', 'hot', 'drain', 'refrigerant', 'condensate'],
  acMode: 'split',
  sources: {},
};
type Slot = {
  key: string;
  name: string;
  kind: DeviceKind;
  system: UtilityKind;
  height: number;
  at: Point;
  center?: boolean;
};
export interface UtilityLayoutResult {
  devices: Device[];
  routes: Route[];
  removeDevices: string[];
  removeRoutes: string[];
  rooms: { id: string; name: string; kind: RoomKind; devices: number; routes: number }[];
  warnings: string[];
  proposedSources: string[];
  length: number;
  vertical: number;
}
export function sourceCandidates(p: Project, system: UtilityKind) {
  return p.devices
    .filter((d) => d.autoUtility?.role !== 'terminal')
    .filter((d) =>
      system === 'power'
        ? d.kind === 'panel'
        : system === 'weak'
          ? d.kind === 'network'
          : system === 'drain'
            ? d.kind === 'drain' || (d.kind === 'pipe' && d.pipeSystem === 'drain')
            : system === 'refrigerant'
              ? d.kind === 'acoutdoor'
              : system === 'condensate'
                ? d.kind === 'acdrain' || (d.kind === 'pipe' && d.pipeSystem === 'drain')
                : resolvedDeviceKind(d) === (system === 'hot' ? 'hotwater' : 'coldwater') ||
                  (system === 'cold' && d.kind === 'pipe' && d.pipeSystem === 'water'),
    );
}
function slots(p: Project, room: Room, settings: UtilityLayoutSettings): Slot[] {
  const kind = effectiveRoomKind(p, room),
    b = bounds(room.poly),
    center = roomCenter(room.poly);
  const fraction = (x: number, y: number): Point => [b.x + b.w * x, b.y + b.h * y];
  const item = (types: string[], fallback: Point) => {
    const f = p.furniture.find((f) => types.includes(f.type) && inside([f.cx, f.cy], room.poly));
    return f ? ([f.cx, f.cy] as Point) : fallback;
  };
  const out: Slot[] = [];
  const add = (
    key: string,
    name: string,
    device: DeviceKind,
    system: UtilityKind,
    height: number,
    at: Point,
    center = false,
  ) => out.push({ key, name, kind: device, system, height, at, center });
  const socket = (key: string, name: string, at: Point, height = 300) =>
    add(key, name, 'socket', 'power', height, at);
  const wet = (key: string, name: string, at: Point, hot: boolean, drain = true, height = 500) => {
    add(key + '-cold', name + '冷水', 'coldwater', 'cold', height, at);
    if (hot) add(key + '-hot', name + '热水', 'hotwater', 'hot', height, [at[0] + 180, at[1]]);
    if (drain) add(key + '-drain', name + '排水', 'drain', 'drain', 0, [at[0] - 180, at[1]]);
  };
  if (kind === 'unknown') return [];
  const door = p.openings.find(
    (o) =>
      o.type === 'door' &&
      nearPolygon([(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2], room.poly, o.width + 100),
  );
  add('switch', '入口开关', 'switch', 'power', 1300, door?.b ?? fraction(0.1, 0.85));
  add('light', '主灯位', 'light', 'power', 2600, center, true);
  switch (kind) {
    case 'bedroom': {
      const at = item(['bed', 'bunkbed', 'daybed'], fraction(0.5, 0.15));
      const bed = p.furniture.find(
        (f) => ['bed', 'bunkbed', 'daybed'].includes(f.type) && inside([f.cx, f.cy], room.poly),
      );
      const bedside = (side: number): Point => {
        if (!bed) return [at[0] + side * 900, at[1]];
        const angle = (bed.rot * Math.PI) / 180,
          x = side * (bed.w / 2 + 180),
          y = -bed.d / 2 + 180;
        return [
          bed.cx + x * Math.cos(angle) - y * Math.sin(angle),
          bed.cy + x * Math.sin(angle) + y * Math.cos(angle),
        ];
      };
      socket('bed-left', '床头左插座', bedside(-1));
      socket('bed-right', '床头右插座', bedside(1));
      const desk = item(['desk', 'standingdesk'], fraction(0.85, 0.75));
      socket('desk', '书桌插座', desk);
      add('network', '网络点', 'network', 'weak', 300, [desk[0] + 200, desk[1]]);
      break;
    }
    case 'living': {
      const tv = item(['tvstand', 'tv'], fraction(0.5, 0.1));
      socket('tv', '电视插座', tv);
      socket('sofa', '沙发插座', item(['sofa', 'cornersofa'], fraction(0.2, 0.9)));
      add('network', '电视网络点', 'network', 'weak', 300, [tv[0] + 200, tv[1]]);
      break;
    }
    case 'kitchen': {
      socket('counter', '操作台插座', item(['counter', 'stove'], fraction(0.3, 0.1)), 1100);
      socket('appliance', '小家电插座', fraction(0.75, 0.1), 1100);
      socket('fridge', '冰箱插座', item(['fridge'], fraction(0.9, 0.8)));
      wet('sink', '水槽', item(['ksink', 'counter'], fraction(0.2, 0.9)), true);
      break;
    }
    case 'bathroom': {
      const basin = item(['vanity'], fraction(0.2, 0.1));
      socket('vanity', '浴室柜插座', basin, 1300);
      wet('basin', '面盆', basin, true);
      wet('shower', '淋浴', item(['shower', 'bathtub'], fraction(0.9, 0.8)), true, true, 1100);
      wet('toilet', '坐便器', item(['toilet'], fraction(0.1, 0.8)), false);
      break;
    }
    case 'laundry': {
      const washer = item(['washer', 'laundrytower'], fraction(0.2, 0.1));
      socket('washer', '洗衣机插座', washer, 1200);
      socket('dryer', '烘干机插座', item(['dryer'], fraction(0.8, 0.1)), 1200);
      wet('washer', '洗衣机', washer, false, true, 1100);
      wet('sink', '洗衣池', item(['vanity', 'ksink'], fraction(0.2, 0.9)), true);
      break;
    }
    case 'balcony':
      socket('outlet', '阳台插座', fraction(0.1, 0.2), 1100);
      wet('tap', '清洁用水', fraction(0.8, 0.9), false);
      break;
    case 'study': {
      const desk = item(['desk', 'standingdesk'], fraction(0.5, 0.1));
      socket('desk', '办公插座', desk);
      socket('reserve', '备用插座', fraction(0.8, 0.8));
      add('network', '办公网络点', 'network', 'weak', 300, [desk[0] + 200, desk[1]]);
      break;
    }
    case 'dining':
      socket('table', '餐边插座', item(['cabinet', 'table'], fraction(0.5, 0.1)), 1100);
      socket('reserve', '备用插座', fraction(0.9, 0.8));
      break;
    default:
      socket('reserve', '清洁备用插座', fraction(0.5, 0.1));
  }
  if (
    ['living', 'bedroom', 'study', 'dining'].includes(kind) &&
    settings.systems.some((v) => v === 'refrigerant' || v === 'condensate')
  ) {
    const central = settings.acMode === 'central';
    const at = item(['acwall', 'acfloor'], central ? center : fraction(0.85, 0.1));
    const height = central ? settings.ceilingHeight : 2300;
    add(
      'ac-indoor',
      central ? '中央空调室内末端' : '分体空调室内机',
      'acindoor',
      'refrigerant',
      height,
      at,
      central,
    );
    add('ac-condensate', '空调冷凝水出口', 'acdrain', 'condensate', height, at, central);
    add('ac-power', '空调专用电源', 'acsocket', 'power', central ? settings.ceilingHeight : 2200, at);
  }
  return out;
}
function location(
  p: Project,
  room: Room,
  target: Point,
  occupied: Device[],
  center = false,
): Point | undefined {
  const walls = allWalls(p),
    candidates: Point[] = [];
  const doors = p.openings
    .filter((o) => o.type === 'door' || o.type === 'window' || o.type === 'railing')
    .map((o) => openingPolygon(o.a, o.b, o.width + 260));
  if (center) {
    candidates.push(roomCenter(room.poly));
    const b = bounds(room.poly);
    for (let y = 1; y < 8; y++)
      for (let x = 1; x < 8; x++) candidates.push([b.x + (b.w * x) / 8, b.y + (b.h * y) / 8]);
  } else
    for (let i = 0; i < room.poly.length; i++) {
      const a = room.poly[i],
        b = room.poly[(i + 1) % room.poly.length],
        len = distance(a, b);
      if (len < 300) continue;
      const inset = (room.boundary ? (room.edgeWidths?.[i] ?? room.wallWidth) / 2 : 0) + 100;
      const count = Math.min(60, Math.max(2, Math.ceil(len / 180)));
      for (let n = 1; n < count; n++)
        for (const sign of [-1, 1])
          candidates.push([
            a[0] + ((b[0] - a[0]) * n) / count - ((b[1] - a[1]) / len) * inset * sign,
            a[1] + ((b[1] - a[1]) * n) / count + ((b[0] - a[0]) / len) * inset * sign,
          ]);
    }
  return candidates
    .filter(
      (at) =>
        inside(at, room.poly) &&
        !walls.some((w) => projectPoint(at, w.a, w.b).distance < w.width / 2 + 45) &&
        !p.shafts.some((s) => nearPolygon(at, s.poly, 80)) &&
        (center || !doors.some((poly) => nearPolygon(at, poly, 120))) &&
        !occupied.some((d) => distance(at, [d.x, d.y]) < 150),
    )
    .sort((a, b) => distance(a, target) - distance(b, target))[0];
}
function connector(grid: NavigationGrid, a: Point, b: Point): Point[] | null {
  for (const corner of [
    [a[0], b[1]],
    [b[0], a[1]],
  ] as Point[]) {
    if (grid.canSegment(a, corner, false) && grid.canSegment(corner, b, false))
      return simplifyOrthogonal([a, corner, b]);
  }
  return null;
}
/** Four-way pathfinding plus checked orthogonal endpoint connectors. */
export function utilityPath(grid: NavigationGrid, from: Point, to: Point): Point[] {
  const direct = connector(grid, from, to);
  if (direct) return direct;
  const anchor = (point: Point) => {
    const candidates = grid.points
      .map((p, i) => ({ p, i, d: distance(point, p) }))
      .filter((v) => grid.base[v.i])
      .sort((a, b) => a.d - b.d)
      .slice(0, 32);
    for (const v of candidates) {
      const stem = connector(grid, point, v.p);
      if (stem) return { ...v, stem };
    }
    return null;
  };
  const a = anchor(from),
    b = anchor(to);
  if (!a || !b) return [];
  const path = gridPath(grid, a.i, b.i, false, true);
  if (!path.length) return [];
  const raw = simplifyOrthogonal([...a.stem, ...path, ...[...b.stem].reverse()]);
  // Pull checked L-shaped shortcuts through the grid route to avoid stair-step conduits.
  const pulled: Point[] = [raw[0]];
  for (let i = 0; i < raw.length - 1;) {
    let next = raw.length - 1;
    let shortcut = connector(grid, raw[i], raw[next]);
    while (!shortcut && next > i + 1) shortcut = connector(grid, raw[i], raw[--next]);
    if (!shortcut) return [];
    pulled.push(...shortcut.slice(1));
    i = next;
  }
  return simplifyOrthogonal(pulled);
}
function exteriorAnchors(p: Project, room: Room) {
  const walls = allWalls(p),
    out: { inside: Point; outside: Point }[] = [];
  for (let i = 0; i < room.poly.length; i++) {
    const a = room.poly[i],
      b = room.poly[(i + 1) % room.poly.length],
      len = distance(a, b);
    if (len < 600) continue;
    for (const t of [0.25, 0.5, 0.75])
      for (const sign of [-1, 1]) {
        const mid: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const width = Math.max(
          room.boundary ? room.wallWidth : 0,
          ...walls.filter((w) => projectPoint(mid, w.a, w.b).distance < w.width).map((w) => w.width),
        );
        const offset = width / 2 + 220,
          dx = (-(b[1] - a[1]) / len) * offset * sign,
          dy = ((b[0] - a[0]) / len) * offset * sign;
        const inner: Point = [mid[0] + dx, mid[1] + dy],
          outer: Point = [mid[0] - dx, mid[1] - dy];
        if (
          !inside(inner, room.poly) ||
          p.rooms.some((r) => inside(outer, r.poly)) ||
          p.shafts.some((s) => nearPolygon(inner, s.poly, 80) || nearPolygon(outer, s.poly, 80))
        )
          continue;
        // Do not mistake a window bay or an internal boundary for an exterior connection.
        if (
          walls.some((w) => projectPoint(outer, w.a, w.b).distance < w.width / 2 + 40) ||
          walls.some((w) => projectPoint(inner, w.a, w.b).distance < w.width / 2 + 40)
        )
          continue;
        out.push({ inside: inner, outside: outer });
      }
  }
  return out;
}
function outdoorPath(p: Project, grid: NavigationGrid, from: Point, to: Point) {
  if (p.rooms.some((r) => inside(from, r.poly))) return utilityPath(grid, from, to);
  const walls = allWalls(p);
  const outsideClear = (a: Point, b: Point) => {
    const n = Math.max(1, Math.ceil(distance(a, b) / 75));
    for (let i = 0; i <= n; i++) {
      const at: Point = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
      if (
        p.rooms.some((r) => inside(at, r.poly)) ||
        p.shafts.some((s) => nearPolygon(at, s.poly, 40)) ||
        walls.some((w) => projectPoint(at, w.a, w.b).distance < w.width / 2 + 20)
      )
        return false;
    }
    return true;
  };
  const anchors = p.rooms
    .flatMap((r) => exteriorAnchors(p, r))
    .sort((a, b) => distance(from, a.outside) - distance(from, b.outside));
  for (const at of anchors) {
    const path = utilityPath(grid, at.inside, to);
    if (!path.length) continue;
    for (const corner of [
      [from[0], at.outside[1]],
      [at.outside[0], from[1]],
    ] as Point[])
      if (outsideClear(from, corner) && outsideClear(corner, at.outside))
        return simplifyOrthogonal([from, corner, at.outside, at.inside, ...path]);
  }
  return [];
}
export function planUtilities(
  p: Project,
  roomIds: string[],
  settings: UtilityLayoutSettings,
): UtilityLayoutResult {
  const chosen = p.rooms.filter((r) => roomIds.includes(r.id)),
    systems = new Set(settings.systems);
  const result: UtilityLayoutResult = {
    devices: [],
    routes: [],
    removeDevices: [],
    removeRoutes: [],
    rooms: [],
    warnings: [],
    proposedSources: [],
    length: 0,
    vertical: 0,
  };
  if (!chosen.length || !systems.size) return result;
  for (const system of [...systems]) {
    const id = settings.sources[system];
    if (id && !sourceCandidates(p, system).some((d) => d.id === id)) {
      result.warnings.push(`${ROUTE_KINDS[system].name}指定的接入点已失效，请重新选择。`);
      systems.delete(system);
    }
  }
  const updating = (tag: Device['autoUtility']) =>
    !!tag &&
    tag.role === 'terminal' &&
    chosen.some((r) => r.id === tag.roomId && effectiveRoomKind(p, r) !== 'unknown') &&
    systems.has(tag.system);
  result.removeRoutes = p.routes.filter((r) => updating(r.autoUtility)).map((r) => r.id);
  const retainedRoutes = p.routes.filter((r) => !result.removeRoutes.includes(r.id));
  const working = structuredClone(p.devices),
    used = new Set<string>(),
    wanted = new Set<string>();
  const remember = (d: Device) => {
    if (!result.devices.some((v) => v.id === d.id)) result.devices.push(d);
    wanted.add(d.id);
    used.add(d.id);
    return d;
  };
  const sourceCache = new Map<UtilityKind, Device>();
  const source = (system: UtilityKind, room: Room): Device | undefined => {
    const local =
      system === 'drain' ||
      system === 'condensate' ||
      (system === 'refrigerant' && settings.acMode !== 'central');
    if (!local && sourceCache.has(system)) return sourceCache.get(system);
    const explicit = settings.sources[system];
    const candidates = sourceCandidates({ ...p, devices: working }, system).filter(
      (d) => !updating(d.autoUtility),
    );
    let found = explicit
      ? candidates.find((d) => d.id === explicit)
      : candidates.find(
          (d) =>
            d.autoUtility?.role === 'source' &&
            d.autoUtility.system === system &&
            (!local || d.autoUtility.roomId === room.id) &&
            (system !== 'refrigerant' || d.acMode === (settings.acMode ?? 'split')),
        );
    if (explicit && !found) {
      result.warnings.push(`${ROUTE_KINDS[system].name}指定的接入点已失效，请重新选择。`);
      return;
    }
    if (!found && !explicit) {
      const ranked = [...candidates].sort(
        (a, b) => distance([a.x, a.y], roomCenter(room.poly)) - distance([b.x, b.y], roomCenter(room.poly)),
      );
      found = ranked.find(
        (d) =>
          !d.autoUtility &&
          (system === 'power'
            ? d.kind === 'panel'
            : system === 'drain'
              ? d.kind === 'pipe' && d.pipeSystem === 'drain'
              : system === 'cold'
                ? (d.kind === 'pipe' && d.pipeSystem === 'water') || /总进水|冷水进水/.test(d.name)
                : system === 'hot'
                  ? /热水源|热水供水|热水器/.test(d.name)
                  : system === 'refrigerant'
                    ? d.kind === 'acoutdoor'
                    : system === 'condensate'
                      ? d.kind === 'acdrain' || d.kind === 'pipe'
                      : /弱电箱|汇聚|路由|光猫/.test(d.name)),
      );
    }
    if (!found) {
      const owner =
        system === 'drain' || system === 'condensate' || system === 'refrigerant'
          ? room
          : system === 'power' || system === 'weak'
            ? (p.rooms.find((r) => effectiveRoomKind(p, r) === 'hallway') ??
              p.rooms.find((r) => effectiveRoomKind(p, r) === 'living') ??
              room)
            : (p.rooms.find((r) => effectiveRoomKind(p, r) === 'kitchen') ?? room);
      const at =
        system === 'refrigerant'
          ? exteriorAnchors(p, owner).find((v) => !working.some((d) => distance(v.outside, [d.x, d.y]) < 400))
              ?.outside
          : location(p, owner, owner.poly[0], working);
      if (!at) {
        result.warnings.push(`${owner.name}没有可放置${ROUTE_KINDS[system].name}接入点的位置。`);
        return;
      }
      const name = {
        power: '配电箱',
        weak: '弱电汇聚点',
        cold: '冷水总进水',
        hot: '热水供水',
        drain: '排水接入预留',
        refrigerant: settings.acMode === 'central' ? '中央空调室外机' : `${room.name}分体空调室外机`,
        condensate: `${room.name}冷凝水接入预留`,
      }[system];
      found = {
        id: uid(),
        kind:
          system === 'power'
            ? 'panel'
            : system === 'weak'
              ? 'network'
              : system === 'drain'
                ? 'drain'
                : system === 'refrigerant'
                  ? 'acoutdoor'
                  : system === 'condensate'
                    ? 'acdrain'
                    : system === 'hot'
                      ? 'hotwater'
                      : 'coldwater',
        x: at[0],
        y: at[1],
        height: system === 'drain' || system === 'condensate' ? 0 : system === 'power' ? 1600 : 500,
        name: `${name}（建议位置）`.slice(0, 150),
        circuit: name.slice(0, 150),
        rotation: 0,
        ...(system === 'refrigerant' ? { acMode: settings.acMode ?? 'split' } : {}),
        autoUtility: { roomId: owner.id, key: `source-${system}`, system, role: 'source' },
      };
      working.push(found);
      remember(found);
    }
    if (found.autoUtility?.role === 'source') {
      remember(found);
      result.proposedSources.push(found.name);
    }
    used.add(found.id);
    if (!local) sourceCache.set(system, found);
    return found;
  };
  const links: { room: Room; slot: Slot; from: Device; to: Device }[] = [];
  for (const room of chosen) {
    const kind = effectiveRoomKind(p, room),
      row = { id: room.id, name: room.name, kind, devices: 0, routes: 0 };
    result.rooms.push(row);
    if (kind === 'unknown') {
      result.warnings.push(`${room.name}尚未指定用途，已跳过。`);
      continue;
    }
    const schedule = slots(p, room, settings).filter((s) => systems.has(s.system));
    const byKey = new Map<string, Device>();
    for (const slot of schedule) {
      const supply = source(slot.system, room);
      if (!supply) continue;
      let device = working.find(
        (d) =>
          d.autoUtility?.roomId === room.id &&
          d.autoUtility.key === slot.key &&
          d.autoUtility.system === slot.system,
      );
      if (!device)
        device = working
          .filter(
            (d) =>
              !d.autoUtility &&
              !used.has(d.id) &&
              resolvedDeviceKind(d) === slot.kind &&
              inside([d.x, d.y], room.poly),
          )
          .sort((a, b) => distance([a.x, a.y], slot.at) - distance([b.x, b.y], slot.at))[0];
      if (!device) {
        const at = location(p, room, slot.at, working, slot.center);
        if (!at) {
          result.warnings.push(`${room.name}：${slot.name}没有合适点位，已跳过。`);
          continue;
        }
        device = {
          id: uid(),
          kind: slot.kind,
          name: `${room.name}·${slot.name}`.slice(0, 150),
          x: at[0],
          y: at[1],
          height: slot.kind === 'light' ? settings.ceilingHeight : slot.height,
          circuit:
            `${room.name}·${slot.kind === 'light' || slot.kind === 'switch' ? '照明' : slot.kind === 'acsocket' ? '空调专用电源' : slot.system === 'power' ? '插座' : ROUTE_KINDS[slot.system].name}`.slice(
              0,
              150,
            ),
          rotation: 0,
          autoUtility: { roomId: room.id, key: slot.key, system: slot.system, role: 'terminal' },
        };
        working.push(device);
      }
      if (device.autoUtility) {
        device.kind = slot.kind;
        if (device.kind === 'light') device.height = settings.ceilingHeight;
        if (slot.key.startsWith('ac-')) {
          const changedMode = device.acMode !== (settings.acMode ?? 'split');
          device.acMode = settings.acMode ?? 'split';
          device.height = slot.height;
          device.name = `${room.name}·${slot.name}`.slice(0, 150);
          if (changedMode && slot.kind === 'acindoor') {
            const at = location(
              p,
              room,
              slot.at,
              working.filter((v) => v.id !== device!.id),
              slot.center,
            );
            if (at) [device.x, device.y] = at;
          }
        }
        remember(device);
      } else used.add(device.id);
      wanted.add(device.id);
      byKey.set(slot.key, device);
      row.devices++;
      const from = slot.key === 'light' ? (byKey.get('switch') ?? supply) : supply;
      links.push({
        room,
        slot,
        from: slot.system === 'drain' || slot.system === 'condensate' ? device : from,
        to: slot.system === 'drain' || slot.system === 'condensate' ? supply : device,
      });
    }
  }
  const grid = navigationGrid({ ...p, devices: [] }, 80);
  for (const { room, slot, from, to } of links) {
    if (from.id === to.id) continue;
    // Keep existing hand-drawn connections to this terminal.
    const terminal = slot.system === 'drain' || slot.system === 'condensate' ? from : to;
    if (
      retainedRoutes.some(
        (r) =>
          r.kind === slot.system &&
          (r.startDeviceId === terminal.id ||
            r.endDeviceId === terminal.id ||
            distance(r.points[0], [terminal.x, terminal.y]) < 100 ||
            distance(r.points.at(-1)!, [terminal.x, terminal.y]) < 100),
      )
    )
      continue;
    const points = grid
      ? slot.system === 'refrigerant'
        ? outdoorPath(p, grid, [from.x, from.y], [to.x, to.y])
        : utilityPath(grid, [from.x, from.y], [to.x, to.y])
      : [];
    if (points.length < 2) {
      result.warnings.push(
        `${room.name}·${slot.name}未找到连通路径，点位保留待接线；请核对门洞、墙体和接入点。`,
      );
      continue;
    }
    const previous = p.routes.find(
      (r) => r.autoUtility?.roomId === room.id && r.autoUtility.key === slot.key && r.kind === slot.system,
    );
    const route: Route = {
      id: previous?.id ?? uid(),
      kind: slot.system,
      points,
      circuit: terminal.circuit,
      diameter: ROUTE_KINDS[slot.system].diameter,
      height:
        slot.system === 'drain'
          ? 0
          : slot.system === 'condensate'
            ? Math.min(from.height, settings.mode === 'floor' ? settings.floorHeight : settings.ceilingHeight)
            : settings.mode === 'floor'
              ? settings.floorHeight
              : settings.ceilingHeight,
      startDeviceId: from.id,
      endDeviceId: to.id,
      autoUtility: { roomId: room.id, key: slot.key, system: slot.system, role: 'terminal' },
      ...(slot.system === 'power'
        ? {
            powerUse:
              slot.kind === 'light' || slot.kind === 'switch'
                ? ('lighting' as const)
                : slot.kind === 'acsocket'
                  ? ('ac' as const)
                  : ('socket' as const),
          }
        : {}),
    };
    result.routes.push(route);
    result.rooms.find((r) => r.id === room.id)!.routes++;
    const lengths = routeLengths({ ...p, devices: working }, route);
    result.length += lengths.total;
    result.vertical += lengths.vertical;
  }
  result.removeDevices = p.devices
    .filter(
      (d) =>
        updating(d.autoUtility) &&
        !wanted.has(d.id) &&
        !retainedRoutes.some(
          (r) =>
            r.startDeviceId === d.id ||
            r.endDeviceId === d.id ||
            distance(r.points[0], [d.x, d.y]) < 100 ||
            distance(r.points.at(-1)!, [d.x, d.y]) < 100,
        ),
    )
    .map((d) => d.id);
  for (const d of p.devices) {
    const tag = d.autoUtility;
    if (
      tag?.role === 'source' &&
      tag.system === 'refrigerant' &&
      systems.has('refrigerant') &&
      !wanted.has(d.id) &&
      ![...retainedRoutes, ...result.routes].some(
        (r) =>
          r.startDeviceId === d.id ||
          r.endDeviceId === d.id ||
          distance(r.points[0], [d.x, d.y]) < 100 ||
          distance(r.points.at(-1)!, [d.x, d.y]) < 100,
      )
    )
      result.removeDevices.push(d.id);
  }
  if (result.routes.some((r) => r.kind === 'refrigerant'))
    result.warnings.push(
      '冷媒管组的外墙连接仅标示建议穿出位置，需核对机位、外墙开孔、冷媒液气管规格与设备选型。',
    );
  result.warnings = [...new Set(result.warnings)];
  result.proposedSources = [...new Set(result.proposedSources)];
  return result;
}
export function applyUtilityLayout(p: Project, result: UtilityLayoutResult, settings: UtilityLayoutSettings) {
  p.devices = p.devices.filter((d) => !result.removeDevices.includes(d.id));
  p.routes = p.routes.filter((r) => !result.removeRoutes.includes(r.id));
  for (const d of result.devices) {
    const i = p.devices.findIndex((v) => v.id === d.id);
    if (i < 0) p.devices.push(d);
    else p.devices[i] = structuredClone(d);
  }
  p.routes.push(...structuredClone(result.routes));
  p.utilityLayout = structuredClone(settings);
}
