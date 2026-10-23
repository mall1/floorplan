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
  systems: ['power', 'weak', 'cold', 'hot', 'drain'],
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
            : d.kind === 'water' || (d.kind === 'pipe' && d.pipeSystem === 'water'),
    );
}
function slots(p: Project, room: Room): Slot[] {
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
    add(key + '-cold', name + '冷水', 'water', 'cold', height, at);
    if (hot) add(key + '-hot', name + '热水', 'water', 'hot', height, [at[0] + 180, at[1]]);
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
    if (system !== 'drain' && sourceCache.has(system)) return sourceCache.get(system);
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
            (system !== 'drain' || d.autoUtility.roomId === room.id),
        );
    if (explicit && !found) {
      result.warnings.push(`${ROUTE_KINDS[system].name}指定的接入点已失效，请重新选择。`);
      return;
    }
    if (!found && !explicit) {
      const ranked = [...candidates].sort(
        (a, b) => distance([a.x, a.y], roomCenter(room.poly)) - distance([b.x, b.y], roomCenter(room.poly)),
      );
      found = ranked.find((d) =>
        system === 'power'
          ? d.kind === 'panel'
          : system === 'drain'
            ? d.kind === 'pipe' && d.pipeSystem === 'drain'
            : system === 'cold'
              ? (d.kind === 'pipe' && d.pipeSystem === 'water') || /总进水|冷水进水/.test(d.name)
              : system === 'hot'
                ? /热水源|热水供水|热水器/.test(d.name)
                : /弱电箱|汇聚|路由|光猫/.test(d.name),
      );
    }
    if (!found) {
      const owner =
        system === 'drain'
          ? room
          : system === 'power' || system === 'weak'
            ? (p.rooms.find((r) => effectiveRoomKind(p, r) === 'hallway') ??
              p.rooms.find((r) => effectiveRoomKind(p, r) === 'living') ??
              room)
            : (p.rooms.find((r) => effectiveRoomKind(p, r) === 'kitchen') ?? room);
      const at = location(p, owner, owner.poly[0], working);
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
                : 'water',
        x: at[0],
        y: at[1],
        height: system === 'drain' ? 0 : system === 'power' ? 1600 : 500,
        name: `${name}（建议位置）`,
        circuit: name,
        rotation: 0,
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
    if (system !== 'drain') sourceCache.set(system, found);
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
    const schedule = slots(p, room).filter((s) => systems.has(s.system));
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
              d.kind === slot.kind &&
              inside([d.x, d.y], room.poly) &&
              (slot.kind !== 'water' || (slot.system === 'hot' ? /热/.test(d.name) : !/热/.test(d.name))),
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
            `${room.name}·${slot.kind === 'light' || slot.kind === 'switch' ? '照明' : slot.system === 'power' ? '插座' : ROUTE_KINDS[slot.system].name}`.slice(
              0,
              150,
            ),
          rotation: 0,
          autoUtility: { roomId: room.id, key: slot.key, system: slot.system, role: 'terminal' },
        };
        working.push(device);
      }
      if (device.autoUtility) {
        if (device.kind === 'light') device.height = settings.ceilingHeight;
        remember(device);
      } else used.add(device.id);
      wanted.add(device.id);
      byKey.set(slot.key, device);
      row.devices++;
      const from = slot.key === 'light' ? (byKey.get('switch') ?? supply) : supply;
      links.push({
        room,
        slot,
        from: slot.system === 'drain' ? device : from,
        to: slot.system === 'drain' ? supply : device,
      });
    }
  }
  const grid = navigationGrid({ ...p, devices: [] }, 80);
  for (const { room, slot, from, to } of links) {
    if (from.id === to.id) continue;
    // Keep existing hand-drawn connections to this terminal.
    const terminal = slot.system === 'drain' ? from : to;
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
    const points = grid ? utilityPath(grid, [from.x, from.y], [to.x, to.y]) : [];
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
          : settings.mode === 'floor'
            ? settings.floorHeight
            : settings.ceilingHeight,
      startDeviceId: from.id,
      endDeviceId: to.id,
      autoUtility: { roomId: room.id, key: slot.key, system: slot.system, role: 'terminal' },
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
