import { describe, expect, it } from 'vitest';
import { emptyProject, parseProject } from '../src/model/project';
import { allWalls, bounds, rect, wallSegments } from '../src/model/geometry';
import {
  bayFootprint,
  joinWallAxes,
  openingHost,
  resolvedOpening,
  resizeRoomLayout,
  setWallWidth,
  wallFootprint,
} from '../src/model/architecture';
import { canWalk, walkObstacles, walkStart, walkStep } from '../src/model/walkthrough';
import { defaultFloor } from '../src/model/presets';
import { buildOpening } from '../src/render/architecture-models';
import type { Opening, Room, Wall } from '../src/model/types';
const wall: Wall = { id: 'w', a: [0, 0], b: [4000, 0], width: 200, height: 2800, bearing: false };
const door: Opening = { id: 'd', type: 'door', a: [1000, 0], b: [2000, 0], width: 800, color: '#b6906a' };
const room = (id = 'r', x = 0): Room => ({
  id,
  name: id,
  poly: rect([x, 0], [x + 4000, 3000]),
  flooring: defaultFloor(),
  boundary: true,
  counted: true,
  wallWidth: 200,
});
describe('architectural editing', () => {
  it('uses the host wall depth and never cuts a nearby parallel wall just because an opening is deep', () => {
    expect(resolvedOpening(door, [wall]).width).toBe(200);
    expect(resolvedOpening({ ...door, autoDepth: false }, [wall]).width).toBe(800);
    const nearby = { ...wall, id: 'other', a: [0, 350], b: [4000, 350] } as Wall;
    expect(wallSegments(nearby, [door])).toEqual([{ a: nearby.a, b: nearby.b, bottom: 0, top: 2800 }]);
    expect(openingHost(door, [nearby, wall])?.id).toBe('w');
  });
  it('uses custom opening heights and sills in wall cuts', () => {
    const segments = wallSegments(wall, [{ ...door, type: 'window', sill: 600, height: 1700 }]);
    expect(segments.filter((s) => s.a[0] === 1000).map((s) => [s.bottom, s.top])).toEqual([
      [0, 600],
      [2300, 2800],
    ]);
  });
  it('mitres an L corner without overshooting the outside faces', () => {
    const a = { ...wall, b: [2000, 0] } as Wall,
      b = { ...wall, id: 'v', a: [2000, 0], b: [2000, 2000] } as Wall;
    expect(wallFootprint(a, [a, b])).toEqual([
      [0, 100],
      [1900, 100],
      [2100, -100],
      [0, -100],
    ]);
    const bpoly = wallFootprint(b, [a, b]);
    expect(bpoly).toContainEqual([1900, 100]);
    expect(bpoly).toContainEqual([2100, -100]);
  });
  it('reconciles detector face endpoints into a shared centreline corner', () => {
    const walls: Wall[] = [
      { ...wall, b: [1900, 0] },
      { ...wall, id: 'v', a: [2000, 100], b: [2000, 2000] },
    ];
    joinWallAxes(walls);
    expect(walls[0].b).toEqual([2000, 0]);
    expect(walls[1].a).toEqual([2000, 0]);
  });
  it('keeps the complete T head and both door jambs when joining and cutting walls', () => {
    const head: Wall = { ...wall, id: 'head', a: [0, 0], b: [260, 0], width: 120 };
    const stem: Wall = { ...wall, id: 'stem', a: [140, 60], b: [140, 3000], width: 120 };
    const above: Wall = { ...wall, id: 'bridge-above', a: [40, -900], b: [40, -60], width: 120 };
    const walls = [head, stem, above];
    joinWallAxes(walls);
    expect(head.a).toEqual([0, 0]);
    expect(head.b).toEqual([260, 0]);
    expect(stem.a).toEqual([140, 0]);
    const doors: Opening[] = [
      { ...door, a: [-900, 0], b: [0, 0], width: 120 },
      { ...door, id: 'right', a: [260, 0], b: [1160, 0], width: 120 },
    ];
    expect(
      wallSegments(
        head,
        doors.map((o) => resolvedOpening(o, walls)),
      ),
    ).toEqual([{ a: [0, 0], b: [260, 0], bottom: 0, top: 2800 }]);
    expect(wallFootprint(head, walls)).toEqual([
      [0, 60],
      [260, 60],
      [260, -60],
      [0, -60],
    ]);
  });
  it('resizes a room with adjoining rooms, walls, openings and routes without scaling wall thickness', () => {
    const p = emptyProject();
    p.rooms = [room(), room('neighbor', 4000)];
    p.walls = [{ ...wall, a: [4000, 0], b: [4000, 3000] }];
    p.openings = [{ ...door, a: [4000, 1000], b: [4000, 2000] }];
    p.routes = [
      {
        id: 'pipe',
        kind: 'cold',
        points: [
          [1000, 1000],
          [5000, 1000],
        ],
        height: 0,
        diameter: 20,
        circuit: 'c',
      },
    ];
    resizeRoomLayout(p, 'r', 5000, 3000);
    expect(bounds(p.rooms[0].poly).w).toBe(5000);
    expect(bounds(p.rooms[1].poly)).toEqual({ x: 5000, y: 0, w: 4000, h: 3000 });
    expect(p.walls[0].a).toEqual([5000, 0]);
    expect(p.walls[0].width).toBe(200);
    expect(p.openings[0].a).toEqual([5000, 1000]);
    expect(p.routes[0].points).toEqual([
      [1250, 1000],
      [6000, 1000],
    ]);
    expect(() => parseProject(p)).not.toThrow();
  });
  it('edits a shared derived wall thickness for both room owners and persists it', () => {
    const p = emptyProject();
    p.rooms = [room(), room('neighbor', 4000)];
    setWallWidth(p, 'r:edge:1', 320);
    expect(p.rooms[0].edgeWidths?.[1]).toBe(320);
    expect(p.rooms[1].edgeWidths?.[3]).toBe(320);
    const restored = parseProject(p);
    expect(allWalls(restored).find((w) => w.id === 'r:edge:1')?.width).toBe(320);
  });
  it('builds a bay window projection on either side with editable depth', () => {
    const o = {
      ...door,
      type: 'window',
      windowStyle: 'bay',
      bayDepth: 600,
      baySide: -1,
      width: 200,
    } as Opening;
    expect(bounds(bayFootprint(o))).toEqual({ x: 1000, y: -700, w: 1000, h: 800 });
    expect(bounds(bayFootprint({ ...o, baySide: 1 })).y).toBe(-100);
    const model = buildOpening(o, false);
    expect(model.children.length).toBeGreaterThan(4);
    expect(model.position.x).toBe(1);
  });
  it('builds framed doors with stable hinge pivots, handles and panel detail', () => {
    const model = buildOpening({ ...door, hinge: 'b', swing: 1, openAngle: 45, width: 200 }, false);
    const leaf = model.children.find((v) => v.userData.doorId === 'd')!;
    expect(leaf.rotation.y).toBeCloseTo(Math.PI / 4);
    expect(leaf.children.length).toBeGreaterThan(20);
  });
});
describe('walkthrough navigation', () => {
  it('prevents tunnelling through walls and slides along their face', () => {
    const obstacles = [{ a: [0, -3000], b: [0, 3000], radius: 240 } as const].map((v) => ({
      a: [...v.a] as [number, number],
      b: [...v.b] as [number, number],
      radius: v.radius,
    }));
    expect(walkStep([-1000, 0], [2000, 0], obstacles)[0]).toBeLessThanOrEqual(-240);
    const slide = walkStep([-250, 0], [500, 500], obstacles);
    expect(slide[0]).toBeLessThanOrEqual(-240);
    expect(slide[1]).toBeCloseTo(500);
  });
  it('passes through a door gap and blocks a window sill', () => {
    const p = emptyProject();
    p.walls = [wall];
    p.openings = [door];
    expect(canWalk([1500, 0], walkObstacles(p))).toBe(true);
    p.openings[0].type = 'window';
    expect(canWalk([1500, 0], walkObstacles(p))).toBe(false);
  });
  it('chooses an interior spawn away from walls, or rejects a room without clearance', () => {
    const r = room(),
      obstacles = [{ a: [2000, 0], b: [2000, 3000], radius: 240 }] as {
        a: [number, number];
        b: [number, number];
        radius: number;
      }[];
    const spawn = walkStart(r, obstacles);
    expect(spawn).not.toBeNull();
    expect(canWalk(spawn!, obstacles)).toBe(true);
    expect(
      walkStart({ ...r, poly: rect([0, 0], [300, 300]) }, [{ a: [0, 150], b: [300, 150], radius: 300 }]),
    ).toBeNull();
  });
});
