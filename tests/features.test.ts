import { describe, it, expect } from 'vitest';
import { DEFAULT_WALL_SETTINGS, matchWallThickness } from '../src/model/wall-presets';
import {
  matchDoorWidth,
  DEFAULT_DOOR_SETTINGS,
  fitDetectedDoors,
  doorRecognitionSettings,
} from '../src/model/door-presets';
import { emptyProject, parseProject } from '../src/model/project';
import { defaultFloor } from '../src/model/presets';
import { rect, area, distance } from '../src/model/geometry';
import { usableArea } from '../src/model/shafts';
import { canWalk, walkObstacles, walkStep } from '../src/model/walkthrough';
import { calibrateProject } from '../src/model/calibration';
import { resizeRoomLayout, resolvedOpening } from '../src/model/architecture';
import { buildOpening } from '../src/render/architecture-models';
import type { Opening, Point } from '../src/model/types';
describe('wall presets and independent shafts', () => {
  it('calibrates the whole plan uniformly around a reference corner while retaining product sizes', () => {
    const p = emptyProject();
    p.rooms = [
      {
        id: 'r',
        name: 'r',
        poly: rect([100, 200], [4100, 3200]),
        boundary: true,
        wallWidth: 100,
        counted: true,
        flooring: defaultFloor(),
      },
    ];
    p.shafts = [{ id: 's', name: '烟道', poly: rect([100, 200], [500, 600]), height: 2800 }];
    p.walls = [{ id: 'w', a: [100, 200], b: [4100, 200], width: 100, bearing: false, height: 2800 }];
    p.furniture = [
      { id: 'f', type: 'bed', name: '床', cx: 2100, cy: 2200, w: 1800, d: 2000, rot: 0, color: '#ffffff' },
    ];
    p.routes = [
      {
        id: 'pipe',
        points: [
          [100, 200],
          [2100, 2200],
        ],
        kind: 'cold',
        circuit: '水',
        diameter: 20,
        height: 0,
      },
    ];
    p.globalFlooring.origin = [1100, 1200];
    calibrateProject(p, 1.2, [100, 200]);
    expect(p.rooms[0].poly[2]).toEqual([4900, 3800]);
    expect(p.walls[0].width).toBe(120);
    expect(p.shafts[0].poly[2]).toEqual([580, 680]);
    expect(p.routes[0].points[1]).toEqual([2500, 2600]);
    expect(p.furniture[0]).toMatchObject({ cx: 2500, cy: 2600, w: 1800, d: 2000 });
    expect(p.globalFlooring.origin).toEqual([1300, 1400]);
    expect(() => calibrateProject(p, 0, [0, 0])).toThrow();
    expect(() => parseProject(p)).not.toThrow();
  });
  it('snaps aperture widths only when near a preset and safe for the existing jambs', () => {
    expect(matchDoorWidth(940)).toBe(900);
    expect(matchDoorWidth(880)).toBe(850); // 900 would destroy part of a jamb; 850 fits
    for (const width of [750, 850, 950, 1050, 1150]) expect(matchDoorWidth(width + 20)).toBe(width);
    expect(matchDoorWidth(699)).toBe(699);
    expect(matchDoorWidth(1300)).toBe(1300); // outside tolerance
    expect(matchDoorWidth(1830, true)).toBe(1800);
    expect(matchDoorWidth(940, false, { ...DEFAULT_DOOR_SETTINGS, widths: [920], tolerance: 30 })).toBe(920);
    expect(matchDoorWidth(940, false, { ...DEFAULT_DOOR_SETTINGS, enabled: false })).toBe(940);
  });
  it('upgrades legacy default steps but preserves custom lists and disabled matching', () => {
    const legacy = {
      enabled: false,
      widths: [700, 800, 900, 1000, 1100, 1200],
      slidingWidths: [2700],
      tolerance: 30,
    };
    expect(doorRecognitionSettings(legacy)).toEqual({
      ...legacy,
      presetVersion: 2,
      widths: DEFAULT_DOOR_SETTINGS.widths,
    });
    expect(doorRecognitionSettings({ ...legacy, widths: [820, 920] }).widths).toEqual([820, 920]);
    expect(doorRecognitionSettings({ ...legacy, presetVersion: 2 }).widths).toEqual(legacy.widths);
  });
  it('stops a corner door at the near wall face instead of extending the cut across its width', () => {
    const detected = fitDetectedDoors(
      [{ type: 'door', a: [50, 104], b: [110, 104], width: 8, evidence: 'gap' }],
      [{ x: 100, y: 20, w: 10, h: 80, kind: 'solid' }],
      undefined,
    );
    expect(detected[0].b).toEqual([100, 104]);
    const o: Opening = { id: 'd', a: [0, 0], b: [1200, 0], width: 120, type: 'door', color: '#c8b199' };
    const corner = {
      id: 'cross',
      a: [0, -3000],
      b: [0, 0],
      width: 240,
      height: 2800,
      bearing: false,
    } as const;
    const walls = [{ ...corner, a: [...corner.a], b: [...corner.b] }] as import('../src/model/types').Wall[];
    expect(resolvedOpening(o, walls).a).toEqual([120, 0]);
    const adjusted = resolvedOpening({ ...o, jambStart: 30, jambEnd: 50 }, walls);
    expect(adjusted.a).toEqual([150, 0]);
    expect(adjusted.b).toEqual([1150, 0]);
    walls[0].width = 320;
    expect(resolvedOpening(o, walls).a).toEqual([160, 0]);
  });
  it('snaps within the tolerance and preserves outliers, custom settings and disabled matching', () => {
    expect([102, 145, 207, 271, 180, 330].map((n) => matchWallThickness(n))).toEqual([
      120, 120, 240, 240, 180, 330,
    ]);
    expect(matchWallThickness(160)).toBe(120);
    expect(matchWallThickness(160.1)).toBe(160.1);
    expect(matchWallThickness(143, { thin: 100, thick: 200, tolerance: 50, enabled: true })).toBe(100);
    expect(matchWallThickness(145, { ...DEFAULT_WALL_SETTINGS, enabled: false })).toBe(145);
  });
  const fixture = () => {
    const p = emptyProject();
    p.rooms = [
      {
        id: 'kitchen',
        name: '厨房',
        poly: rect([0, 0], [4000, 3000]),
        boundary: false,
        wallWidth: 120,
        counted: true,
        flooring: defaultFloor(),
      },
    ];
    return p;
  };
  it('subtracts only the shaft union inside a room, including rotated and overlapping footprints', () => {
    const p = fixture(),
      r = p.rooms[0];
    const add = (id: string, poly: Point[]) => p.shafts.push({ id, name: '烟道', poly, height: 2800 });
    add('a', rect([0, 0], [1000, 1000]));
    add('b', rect([500, 0], [1500, 1000]));
    add('outside', rect([-500, -500], [0, 0]));
    expect(usableArea(p, r)).toBeCloseTo(10.5);
    p.shafts = [];
    add('rotated', [
      [0, 500],
      [500, 0],
      [1000, 500],
      [500, 1000],
    ]);
    expect(usableArea(p, r)).toBeCloseTo(11.5);
    p.shafts[0].poly = p.shafts[0].poly.map(([x, y]) => [x - 500, y]);
    expect(usableArea(p, r)).toBeCloseTo(11.75);
    r.poly = [
      [0, 0],
      [4000, 0],
      [4000, 1000],
      [1000, 1000],
      [1000, 3000],
      [0, 3000],
    ];
    expect(usableArea(p, r)).toBeCloseTo(area(r.poly) - 0.25);
  });
  it('persists shafts, blocks their interior when walking, and resizes with the room', () => {
    const p = fixture();
    p.shafts = [{ id: 's', name: '烟道', poly: rect([0, 0], [1000, 1000]), height: 2800 }];
    const obstacles = walkObstacles(p);
    expect(canWalk([500, 500], obstacles)).toBe(false);
    expect(walkStep([2000, 500], [-1800, 0], obstacles)[0]).toBeGreaterThanOrEqual(1140);
    expect(parseProject(JSON.parse(JSON.stringify(p))).shafts).toEqual(p.shafts);
    resizeRoomLayout(p, 'kitchen', 6000, 3000);
    expect(distance(p.shafts[0].poly[0], p.shafts[0].poly[1])).toBe(1500);
    const { shafts: _, ...legacy } = p;
    expect(parseProject(legacy).shafts).toEqual([]);
  });
  it('builds two glass sliding panels that translate without changing height or rotating', () => {
    const o: Opening = {
      id: 'slider',
      type: 'door',
      doorStyle: 'sliding',
      a: [0, 0],
      b: [2400, 0],
      width: 240,
      color: '#839b9e',
      slideOpen: 0,
    };
    const closed = buildOpening(o, false),
      open = buildOpening({ ...o, slideOpen: 100 }, false);
    const c = closed.children.filter((n) => n.userData.doorId),
      a = open.children.filter((n) => n.userData.doorId);
    expect(c).toHaveLength(2);
    expect(a[0].position.x).toBeGreaterThan(c[0].position.x + 1);
    expect(a[0].rotation.y).toBe(0);
    expect(a[1].position.toArray()).toEqual(c[1].position.toArray());
    for (const group of [closed, open])
      group.traverse((n: any) => {
        n.geometry?.dispose();
        if (n.material) for (const m of Array.isArray(n.material) ? n.material : [n.material]) m.dispose();
      });
  });
});
