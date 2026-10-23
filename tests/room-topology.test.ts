import { describe, it, expect } from 'vitest';
import { area, rect, validPolygon } from '../src/model/geometry';
import { mergeRoomPolygons, splitRoomPolygon, trimInteriorLine } from '../src/model/room-topology';
import type { Point } from '../src/model/types';
describe('manual room topology', () => {
  it('merges shared edges, overlap and narrow wall gaps without filling a concave corner', () => {
    const a = rect([0, 0], [4000, 4000]),
      b = rect([4000, 0], [7000, 2000]);
    const joined = mergeRoomPolygons(a, b);
    expect(area(joined)).toBe(22);
    expect(joined.length).toBe(6);
    expect(validPolygon(joined)).toBe(true);
    expect(area(mergeRoomPolygons(a, rect([3800, 0], [7000, 4000])))).toBe(28);
    expect(area(mergeRoomPolygons(a, rect([4200, 0], [8000, 4000])))).toBe(32);
    expect(() => mergeRoomPolygons(a, rect([4600, 0], [8000, 4000]), 400)).toThrow();
    expect(() => mergeRoomPolygons(a, rect([4000, 4000], [6000, 6000]))).toThrow();
  });
  it('preserves rotated shapes and area when cutting along a diagonal or through vertices', () => {
    const p = rect([0, 0], [4000, 3000]);
    const diagonal = splitRoomPolygon(p, [-1000, -750], [5000, 3750]);
    expect(diagonal.polys.every(validPolygon)).toBe(true);
    expect(diagonal.polys.map(area)).toEqual([6, 6]);
    const angle = 0.31,
      rotate = ([x, y]: Point): Point => [
        x * Math.cos(angle) - y * Math.sin(angle) + 700,
        y * Math.cos(angle) + x * Math.sin(angle) - 500,
      ];
    const result = splitRoomPolygon(p.map(rotate), rotate([1200, -1000]), rotate([1200, 5000]));
    expect(area(result.polys[0]) + area(result.polys[1])).toBeCloseTo(12);
    expect(Math.min(...result.polys.map(area))).toBeCloseTo(3.6);
  });
  it('rejects tangents, tiny rooms and cuts that create more than two components', () => {
    const p = rect([0, 0], [4000, 4000]);
    expect(() => splitRoomPolygon(p, [0, 0], [4000, 0])).toThrow();
    expect(() => splitRoomPolygon(p, [-100, 100], [100, -100])).toThrow();
    expect(() => splitRoomPolygon(p, [10, 0], [10, 4000])).toThrow();
    const u: Point[] = [
      [0, 0],
      [4000, 0],
      [4000, 4000],
      [3000, 4000],
      [3000, 1000],
      [1000, 1000],
      [1000, 4000],
      [0, 4000],
    ];
    expect(() => splitRoomPolygon(u, [-100, 2500], [4500, 2500])).toThrow();
  });
  it('trims internal partition spans while retaining exterior wall and outside extensions', () => {
    const poly = rect([0, 0], [8000, 4000]);
    expect(trimInteriorLine([4000, -500], [4000, 4500], poly, 200)).toEqual([
      [
        [4000, -500],
        [4000, 0],
      ],
      [
        [4000, 4000],
        [4000, 4500],
      ],
    ]);
    expect(trimInteriorLine([0, 0], [8000, 0], poly, 200)).toHaveLength(1);
    expect(trimInteriorLine([4000, 0], [4000, 4000], poly, 200)).toHaveLength(0);
  });
});
