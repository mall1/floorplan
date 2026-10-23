import { describe, expect, it } from 'vitest';
import {
  applyUtilityLayout,
  DEFAULT_UTILITY_LAYOUT,
  planUtilities,
  utilityPath,
} from '../src/model/auto-utilities';
import { navigationGrid } from '../src/model/circulation';
import { inside, rect } from '../src/model/geometry';
import { demoProject, emptyProject, parseProject } from '../src/model/project';
import {
  detachUtilityRoute,
  routeElevations,
  routeLengths,
  syncUtilityConnections,
} from '../src/model/utility-connections';
import { analysisFixture } from './fixtures/space-analysis';
import type { Device, Project, UtilityLayoutSettings } from '../src/model/types';
const fixture = () => {
  const p = analysisFixture();
  p.rooms = p.rooms.slice(0, 3);
  p.rooms[1].kind = 'kitchen';
  p.rooms[1].name = '厨房';
  p.rooms[2].kind = 'bathroom';
  p.rooms[2].name = '卫生间';
  p.openings = p.openings.slice(0, 3);
  return p;
};
const settings = (value: Partial<UtilityLayoutSettings> = {}): UtilityLayoutSettings => ({
  ...structuredClone(DEFAULT_UTILITY_LAYOUT),
  ...value,
});
function generate(p: Project, s = settings(), ids = p.rooms.map((r) => r.id)) {
  const result = planUtilities(p, ids, s);
  applyUtilityLayout(p, result, s);
  syncUtilityConnections(p);
  return result;
}
const manualPanel: Device = {
  id: 'manual-panel',
  kind: 'panel',
  name: '现有配电箱',
  x: 250,
  y: 500,
  height: 1600,
  circuit: '总箱',
  rotation: 0,
};

describe('automatic utility planning', () => {
  it('uses one clean elbow across open floor instead of a grid staircase', () => {
    const grid = navigationGrid(fixture(), 80)!;
    const path = utilityPath(grid, [300, 400], [3200, 3500]);
    expect(path).toHaveLength(3);
    expect(path[0]).toEqual([300, 400]);
    expect(path.at(-1)).toEqual([3200, 3500]);
  });
  it('places bedside outlets beside the rotated headboard', () => {
    const p = fixture();
    p.furniture = [
      { id: 'bed', type: 'bed', name: '床', cx: 2800, cy: 2000, w: 1800, d: 2000, rot: 90, color: '#fff' },
    ];
    const result = planUtilities(p, [p.rooms[0].id], settings({ systems: ['power'] }));
    const left = result.devices.find((d) => d.autoUtility?.key === 'bed-left')!;
    const right = result.devices.find((d) => d.autoUtility?.key === 'bed-right')!;
    expect(left.x).toBeGreaterThan(3500);
    expect(right.x).toBeGreaterThan(3500);
    expect(left.y).toBeLessThan(1500);
    expect(right.y).toBeGreaterThan(2500);
  });
  it('generates room-specific points with obstacle-checked orthogonal connections and a read-only preview', () => {
    const p = fixture();
    p.devices = [manualPanel];
    const before = structuredClone(p),
      result = planUtilities(
        p,
        p.rooms.map((r) => r.id),
        settings(),
      );
    expect(p).toEqual(before);
    expect(result.routes.length).toBeGreaterThan(15);
    expect(
      result.devices
        .filter((d) => d.autoUtility?.roomId === p.rooms[0].id)
        .every((d) => ['power', 'weak'].includes(d.autoUtility!.system)),
    ).toBe(true);
    expect(result.devices.some((d) => d.autoUtility?.key === 'shower-hot')).toBe(true);
    expect(result.devices.some((d) => d.autoUtility?.key === 'fridge')).toBe(true);
    const grid = navigationGrid({ ...p, devices: [] }, 80)!;
    for (const route of result.routes)
      for (let i = 1; i < route.points.length; i++) {
        const [a, b] = [route.points[i - 1], route.points[i]];
        expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
        expect(grid.canSegment(a, b, false), route.circuit).toBe(true);
      }
    for (const d of result.devices) expect(p.rooms.some((r) => inside([d.x, d.y], r.poly))).toBe(true);
  });
  it('switches floor/ceiling elevations, retains floor drainage, accounts for risers and round trips JSON', () => {
    const p = fixture();
    generate(p, settings({ mode: 'floor', floorHeight: 80, ceilingHeight: 2750 }));
    expect(p.routes.every((r) => r.height === (r.kind === 'drain' ? 0 : 80))).toBe(true);
    expect(p.devices.filter((d) => d.kind === 'light').every((d) => d.height === 2750)).toBe(true);
    const ids = p.routes.map((r) => r.id).sort(),
      deviceCount = p.devices.length;
    generate(p, settings({ mode: 'ceiling', ceilingHeight: 2800 }));
    expect(p.routes.every((r) => r.height === (r.kind === 'drain' ? 0 : 2800))).toBe(true);
    expect(p.routes.map((r) => r.id).sort()).toEqual(ids);
    expect(p.devices).toHaveLength(deviceCount);
    const socket = p.routes.find((r) => r.autoUtility?.key === 'bed-left')!;
    expect(routeElevations(p, socket).at(-1)![1]).toBe(300);
    expect(routeLengths(p, socket).vertical).toBeCloseTo((2800 - 1600 + 2800 - 300) / 1000);
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it('reuses manual points and lines, scopes updates to one room and remains idempotent', () => {
    const p = fixture();
    const socket: Device = {
      ...manualPanel,
      id: 'hand-socket',
      kind: 'socket',
      x: 1000,
      y: 250,
      height: 350,
      name: '已有床头插座',
    };
    p.devices = [manualPanel, socket];
    p.routes = [
      {
        id: 'hand-route',
        kind: 'power',
        points: [
          [250, 500],
          [1000, 500],
          [1000, 250],
        ],
        height: 100,
        circuit: '原有回路',
        diameter: 25,
      },
    ];
    const manualRoute = structuredClone(p.routes[0]);
    generate(p);
    expect(p.devices.find((d) => d.id === socket.id)).toEqual(socket);
    expect(p.routes.find((r) => r.id === 'hand-route')).toEqual(manualRoute);
    const others = structuredClone(p.routes.filter((r) => r.autoUtility?.roomId !== p.rooms[0].id));
    const size = [p.devices.length, p.routes.length];
    generate(p);
    expect([p.devices.length, p.routes.length]).toEqual(size);
    generate(p, settings({ mode: 'floor' }), [p.rooms[0].id]);
    expect(p.routes.filter((r) => r.autoUtility?.roomId !== p.rooms[0].id)).toEqual(others);
  });
  it('reports disconnected branches without crossing a partition or shaft', () => {
    const p = fixture();
    p.devices = [manualPanel];
    p.openings = [];
    p.shafts = [{ id: 'shaft', name: '烟道', height: 2800, poly: rect([5500, 1000], [6500, 3000]) }];
    const result = planUtilities(
      p,
      p.rooms.map((r) => r.id),
      settings({ systems: ['power'] }),
    );
    expect(result.warnings.some((v) => v.includes('未找到连通路径'))).toBe(true);
    expect(
      result.routes
        .filter((r) => r.startDeviceId === manualPanel.id)
        .every((r) => r.autoUtility?.roomId === p.rooms[0].id),
    ).toBe(true);
  });
  it('uses explicitly selected sources and reports stale IDs without silently substituting a source', () => {
    const p = fixture();
    p.devices = [manualPanel];
    const result = planUtilities(
      p,
      [p.rooms[0].id],
      settings({ systems: ['power'], sources: { power: 'missing' } }),
    );
    expect(result.routes).toHaveLength(0);
    expect(result.devices).toHaveLength(0);
    expect(result.warnings[0]).toContain('已失效');
    const valid = planUtilities(
      p,
      [p.rooms[0].id],
      settings({ systems: ['power'], sources: { power: manualPanel.id } }),
    );
    expect(valid.routes.some((r) => r.startDeviceId === manualPanel.id)).toBe(true);
    expect(valid.proposedSources).toEqual([]);
    applyUtilityLayout(p, valid, settings({ systems: ['power'] }));
    const before = structuredClone(p);
    generate(p, settings({ systems: ['power'], sources: { power: 'missing' } }));
    expect(p.routes).toEqual(before.routes);
    expect(p.devices).toEqual(before.devices);
  });
  it('keeps unknown rooms and only removes obsolete auto terminals when a room type changes', () => {
    const p = fixture();
    generate(p);
    const manual: Device = {
      ...manualPanel,
      id: 'manual-water',
      kind: 'water',
      x: 5000,
      y: 400,
      height: 500,
    };
    p.devices.push(manual);
    p.rooms[1].kind = 'study';
    generate(p, settings(), [p.rooms[1].id]);
    expect(
      p.devices
        .filter((d) => d.autoUtility?.roomId === p.rooms[1].id && d.autoUtility.role === 'terminal')
        .every((d) => ['power', 'weak'].includes(d.autoUtility!.system)),
    ).toBe(true);
    expect(p.devices.find((d) => d.id === manual.id)).toEqual(manual);
    const previous = structuredClone(p);
    p.rooms[1].kind = 'unknown';
    const result = generate(p, settings(), [p.rooms[1].id]);
    expect(result.warnings).toContain('厨房尚未指定用途，已跳过。');
    expect(p.routes).toEqual(previous.routes);
    expect(p.devices).toEqual(previous.devices);
  });
  it('handles empty scenes, system filters and the furnished sample', () => {
    expect(planUtilities(emptyProject(), [], settings()).devices).toEqual([]);
    const p = demoProject(),
      result = planUtilities(
        p,
        p.rooms.map((r) => r.id),
        settings({ systems: ['power', 'cold'] }),
      );
    expect(result.routes.length).toBeGreaterThan(10);
    expect(result.routes.every((r) => ['power', 'cold'].includes(r.kind))).toBe(true);
  });
});
describe('utility attachments', () => {
  it('follows moved points, preserves manual diagonals, detaches edited routes and removes deleted attachments', () => {
    const p = fixture();
    generate(p, settings({ systems: ['power'] }));
    const r = p.routes.find((r) => r.autoUtility?.key === 'bed-left')!;
    const d = p.devices.find((d) => d.id === r.endDeviceId)!;
    d.x += 100;
    d.y += 120;
    syncUtilityConnections(p);
    expect(r.points.at(-1)).toEqual([d.x, d.y]);
    for (let i = 1; i < r.points.length; i++)
      expect(r.points[i][0] === r.points[i - 1][0] || r.points[i][1] === r.points[i - 1][1]).toBe(true);
    detachUtilityRoute(r);
    r.points = [
      [10, 20],
      [350, 490],
    ];
    const snapshot = structuredClone(r);
    syncUtilityConnections(p);
    expect(r).toEqual(snapshot);
    const attached = p.routes.find((r) => r.endDeviceId)!;
    p.devices = p.devices.filter((d) => d.id !== attached.endDeviceId);
    syncUtilityConnections(p);
    expect(p.routes.some((r) => r.id === attached.id)).toBe(false);
  });
});
