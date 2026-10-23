import { describe, expect, it } from 'vitest';
import {
  allWalls,
  area,
  inside,
  rect,
  validPolygon,
  wallSegments,
  roomCenter,
  projectBounds,
} from '../src/model/geometry';
import { demoProject, emptyProject, parseProject } from '../src/model/project';
import { defaultFloor, FLOOR_PRESETS } from '../src/model/presets';
import { floorFor, floorInFrame, tilePolygons } from '../src/model/flooring';
import { recognize } from '../src/model/recognition';
import { imagePoint } from '../src/model/files';
import type { Point } from '../src/model/types';
import { LIB } from '../src/data/original';
import { buildFurniture, disposeModelMaterials } from '../src/render/furniture-models';
import { furnSVG } from '../src/render/furniture-svg';
import * as THREE from 'three';
describe('retained furniture library', () => {
  it('builds every catalog model without missing global dependencies or invalid bounds', () => {
    for (const group of LIB)
      for (const item of group.items) {
        const svg = furnSVG(item[0], item[2], item[3], item[4]);
        expect(svg, String(item[1])).not.toMatch(/NaN|Infinity|undefined/);
        expect(svg, String(item[1])).not.toBe(furnSVG('unknown', item[2], item[3], item[4]));
        const model = buildFurniture({
          id: 'test',
          type: item[0],
          name: item[1],
          w: item[2],
          d: item[3],
          color: item[4],
          cx: 0,
          cy: 0,
          rot: 0,
        });
        const box = new THREE.Box3().setFromObject(model);
        expect([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite), String(item[0])).toBe(
          true,
        );
        let meshCount = 0;
        model.traverse((node: THREE.Object3D) => {
          if (node instanceof THREE.Mesh) {
            meshCount++;
            node.geometry.dispose();
          }
        });
        expect(meshCount, String(item[1])).toBeGreaterThan(1);
      }
    disposeModelMaterials();
  });
  it('round trips every catalog entry with editable sizes, colors and rotation', () => {
    const p = emptyProject();
    p.furniture = LIB.flatMap((group) => group.items).map((item, i) => ({
      id: `catalog-${i}`,
      type: String(item[0]),
      name: String(item[1]),
      w: Number(item[2]) + 100,
      d: Number(item[3]) + 50,
      cx: i * 100,
      cy: -(i + 1) * 100,
      rot: 90,
      color: '#aabbcc',
    }));
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
describe('geometry and project files', () => {
  it('retains the complete original sample and validates a round trip', () => {
    const sample = demoProject();
    expect(sample.rooms.length).toBe(13);
    expect(sample.furniture.length).toBeGreaterThan(40);
    expect(parseProject(JSON.parse(JSON.stringify(sample)))).toEqual(sample);
  });
  it('uses sliding doors for both sample balconies and keeps interior doors hinged', () => {
    const sample = demoProject();
    for (const id of ['slide0', 'slide1']) {
      expect(sample.openings.find((o) => o.id === id)).toMatchObject({
        type: 'door',
        doorStyle: 'sliding',
        slideOpen: 0,
      });
    }
    expect(
      sample.openings.filter((o) => o.id.startsWith('door')).every((o) => o.doorStyle !== 'sliding'),
    ).toBe(true);
  });
  it('repairs old sample balcony doors without modifying the input or losing their opening amount', () => {
    const old = demoProject();
    const balconies = old.openings.filter((o) => o.id.startsWith('slide'));
    balconies.forEach((o) => {
      delete o.doorStyle;
    });
    balconies[0].slideOpen = 35;
    delete balconies[1].slideOpen;
    const fixed = parseProject(old);
    expect(fixed.openings.find((o) => o.id === 'slide0')).toMatchObject({
      doorStyle: 'sliding',
      slideOpen: 35,
    });
    expect(fixed.openings.find((o) => o.id === 'slide1')).toMatchObject({
      doorStyle: 'sliding',
      slideOpen: 0,
    });
    expect(balconies.every((o) => o.doorStyle === undefined)).toBe(true);
    expect(parseProject(fixed)).toEqual(fixed);
  });
  it('preserves explicit door choices and edited openings during sample repair', () => {
    const p = demoProject();
    const first = p.openings.find((o) => o.id === 'slide0')!;
    first.doorStyle = 'swing';
    const second = p.openings.find((o) => o.id === 'slide1')!;
    delete second.doorStyle;
    second.a[0] += 100;
    expect(parseProject(p)).toEqual(p);
    second.a[0] -= 100;
    second.type = 'window';
    expect(parseProject(p)).toEqual(p);
  });
  it('rejects malformed / crossing rooms, unsafe SVG images and duplicate IDs', () => {
    expect(
      validPolygon([
        [0, 0],
        [1000, 1000],
        [0, 1000],
        [1000, 0],
      ]),
    ).toBe(false);
    const p = demoProject();
    p.rooms[1].id = p.rooms[0].id;
    expect(() => parseProject(p)).toThrow();
    const q = emptyProject();
    expect(() => parseProject({ ...q, reference: { src: 'data:image/svg+xml;base64,a' } })).toThrow();
  });
  it('supports concave rooms without replacing them with bounding rectangles', () => {
    const l: Point[] = [
      [0, 0],
      [4000, 0],
      [4000, 2000],
      [2000, 2000],
      [2000, 4000],
      [0, 4000],
    ];
    expect(validPolygon(l)).toBe(true);
    expect(area(l)).toBe(12);
    expect(inside([3000, 3000], l)).toBe(false);
  });
  it('deduplicates exactly shared generated walls', () => {
    const p = emptyProject();
    p.rooms = [
      {
        id: 'a',
        name: 'A',
        poly: rect([0, 0], [3000, 3000]),
        flooring: defaultFloor(),
        boundary: true,
        counted: true,
        wallWidth: 200,
      },
      {
        id: 'b',
        name: 'B',
        poly: rect([3000, 0], [6000, 3000]),
        flooring: defaultFloor(),
        boundary: true,
        counted: true,
        wallWidth: 200,
      },
    ];
    expect(allWalls(p)).toHaveLength(7);
  });
  it('cuts a door opening in a wall but retains its header', () => {
    const wall = {
      id: 'w',
      a: [0, 0] as Point,
      b: [4000, 0] as Point,
      width: 200,
      height: 2800,
      bearing: false,
    };
    const segments = wallSegments(wall, [
      { id: 'd', a: [1000, 0], b: [1900, 0], width: 240, type: 'door', color: '#bbbbbb' },
    ]);
    expect(segments.filter((s) => s.bottom === 0).reduce((n, s) => n + (s.b[0] - s.a[0]), 0)).toBe(3100);
    expect(segments.some((s) => s.bottom === 2100 && s.top === 2800)).toBe(true);
  });
  it('migrates old furniture and demolished walls', () => {
    const p = parseProject({
      furniture: [],
      rooms: { master: { name: '自定义主卧', mat: 'walnut' } },
      demolished: ['w2'],
    });
    expect(p.rooms[0].name).toBe('自定义主卧');
    expect(p.rooms[0].flooring.material).toBe('walnut');
    expect(p.walls.some((w) => w.id === 'w2')).toBe(false);
  });
  it('cuts long windows across multiple wall fragments and ignores perpendicular openings', () => {
    const wall = {
      id: 'fragment',
      a: [1000, 0] as Point,
      b: [2000, 0] as Point,
      width: 200,
      height: 2800,
      bearing: false,
    };
    const window = {
      id: 'window',
      a: [500, 0] as Point,
      b: [3000, 0] as Point,
      width: 200,
      type: 'window' as const,
      color: '#abcabc',
    };
    const segments = wallSegments(wall, [window]);
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => [s.bottom, s.top])).toEqual([
      [0, 900],
      [2200, 2800],
    ]);
    expect(segments.every((s) => s.a[0] === 1000 && s.b[0] === 2000)).toBe(true);
    const perpendicular = { ...window, a: [1500, -100] as Point, b: [1500, 100] as Point };
    expect(wallSegments(wall, [perpendicular])).toEqual([{ a: wall.a, b: wall.b, bottom: 0, top: 2800 }]);
  });
  it('unions overlapping openings without duplicating wall geometry', () => {
    const wall = {
      id: 'w',
      a: [0, 0] as Point,
      b: [4000, 0] as Point,
      width: 200,
      height: 2800,
      bearing: false,
    };
    const door = {
      id: 'd',
      a: [1000, 0] as Point,
      b: [2000, 0] as Point,
      width: 200,
      type: 'door' as const,
      color: '#abcabc',
    };
    const segments = wallSegments(wall, [door, { ...door, id: 'd2', a: [1500, 0], b: [2500, 0] }]);
    expect(segments.filter((s) => s.bottom === 0).reduce((sum, s) => sum + s.b[0] - s.a[0], 0)).toBe(2500);
    expect(segments.filter((s) => s.bottom === 2100).reduce((sum, s) => sum + s.b[0] - s.a[0], 0)).toBe(1500);
  });
});
describe('floor layout', () => {
  it('keeps continuous tiles aligned inside a rotated doorway', () => {
    const floor = defaultFloor();
    floor.origin = [200, 350];
    floor.angle = 17;
    const origin: Point = [3000, 1000],
      angle = 90;
    const local = floorInFrame(floor, origin, angle);
    expect(local.angle).toBe(-73);
    const a = (angle * Math.PI) / 180;
    const worldOrigin = [
      origin[0] + local.origin[0] * Math.cos(a) - local.origin[1] * Math.sin(a),
      origin[1] + local.origin[0] * Math.sin(a) + local.origin[1] * Math.cos(a),
    ];
    expect(worldOrigin[0]).toBeCloseTo(floor.origin[0]);
    expect(worldOrigin[1]).toBeCloseTo(floor.origin[1]);
  });
  it('keeps a shared global origin across separate rooms', () => {
    const p = demoProject();
    p.continuous = true;
    expect(floorFor(p, p.rooms[0])).toBe(floorFor(p, p.rooms[3]));
    const f = defaultFloor();
    f.origin = [123, 456];
    const a = tilePolygons(rect([0, 0], [2400, 2400]), f),
      b = tilePolygons(rect([1600, 0], [4000, 2400]), f);
    const shared = a.filter((t) => b.some((u) => JSON.stringify(t) === JSON.stringify(u)));
    expect(shared.length).toBeGreaterThan(2);
  });
  it('covers a herringbone floor once without overlapping planks', () => {
    const f = structuredClone(FLOOR_PRESETS.find((p) => p.id === 'herringbone')!.value);
    f.gap = 0;
    const tiles = tilePolygons(rect([0, 0], [4000, 4000]), f);
    for (let x = 173; x < 3900; x += 227)
      for (let y = 139; y < 3900; y += 263) expect(tiles.filter((t) => inside([x, y], t)).length).toBe(1);
  });
  it('uses millimetre dimensions and leaves the requested grout width', () => {
    const f = defaultFloor();
    f.width = 300;
    f.length = 600;
    f.gap = 3;
    const tiles = tilePolygons(rect([0, 0], [3000, 3000]), f);
    expect(area(tiles[0])).toBeCloseTo(0.18, 6);
    expect(tiles[0][1][0] - tiles[0][0][0]).toBe(600);
  });
});
describe('view and placement bounds', () => {
  it('places labels and new furniture inside a concave room', () => {
    const poly: Point[] = [
      [0, 0],
      [6000, 0],
      [6000, 1000],
      [1000, 1000],
      [1000, 5000],
      [0, 5000],
    ];
    expect(inside(roomCenter(poly), poly)).toBe(true);
  });
  it('fits rotated reference images and utility-only plans', () => {
    const p = emptyProject();
    p.reference = {
      src: '',
      x: 1000,
      y: 2000,
      width: 6000,
      pixelWidth: 600,
      pixelHeight: 300,
      rotation: 90,
      opacity: 0.5,
      visible: true,
      calibrated: true,
    };
    expect(projectBounds(p).x).toBeCloseTo(-2000);
    expect(projectBounds(p).h).toBeCloseTo(6000);
    p.reference = null;
    p.devices.push({
      id: 'd',
      kind: 'socket',
      name: 'socket',
      x: 24000,
      y: 18000,
      height: 300,
      circuit: '1',
      rotation: 0,
    });
    expect(projectBounds(p).x).toBe(24000);
  });
});
function fixture() {
  const w = 200,
    h = 160,
    pixels = new Uint8ClampedArray(w * h * 4).fill(255);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
      }
  };
  fill(15, 15, 185, 20);
  fill(15, 140, 185, 145);
  fill(15, 15, 20, 145);
  fill(180, 15, 185, 145);
  fill(95, 15, 100, 145);
  return { w, h, pixels, fill };
}
describe('local image recognition', () => {
  it('finds enclosed rooms, excluding the unbounded exterior', () => {
    const { w, h, pixels } = fixture();
    const rooms = recognize(pixels, w, h, { threshold: 160, closeRadius: 0, minArea: 0.01 });
    expect(rooms).toHaveLength(2);
    expect(rooms.every((r) => r.poly.length === 4)).toBe(true);
    expect(rooms.map((r) => r.areaPixels).sort((a, b) => a - b)).toEqual([9000, 9600]);
  });
  it('closes small door gaps before finding connected components', () => {
    const { w, h, pixels } = fixture();
    for (let y = 70; y < 78; y++)
      for (let x = 95; x < 100; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      }
    expect(recognize(pixels, w, h, { threshold: 160, closeRadius: 0, minArea: 0.01 })).toHaveLength(1);
    expect(recognize(pixels, w, h, { threshold: 160, closeRadius: 5, minArea: 0.01 })).toHaveLength(2);
  });
  it('keeps an L-shaped outline concave', () => {
    const { w, h, pixels, fill } = fixture();
    fill(100, 20, 180, 140);
    fill(20, 20, 60, 75);
    const rooms = recognize(pixels, w, h, { threshold: 160, closeRadius: 0, minArea: 0.01 });
    expect(rooms).toHaveLength(1);
    expect(rooms[0].poly.length).toBe(6);
  });
  it('does not invent rooms on a blank image', () => {
    expect(
      recognize(new Uint8ClampedArray(100 * 100 * 4).fill(255), 100, 100, {
        threshold: 160,
        closeRadius: 5,
        minArea: 0.01,
      }),
    ).toEqual([]);
  });
  it('maps calibrated pixel coordinates through translation and rotation', () => {
    const ref = {
      src: '',
      pixelWidth: 100,
      pixelHeight: 100,
      x: 1000,
      y: 2000,
      width: 5000,
      rotation: 90,
      opacity: 0.5,
      visible: true,
      calibrated: true,
    };
    expect(imagePoint(ref, [20, 10])[0]).toBeCloseTo(500);
    expect(imagePoint(ref, [20, 10])[1]).toBeCloseTo(3000);
  });
});
