import { describe, expect, it } from 'vitest';
import { analyzeFloorplan, type ImageRect } from '../src/model/recognition';
import { inside } from '../src/model/geometry';
import type { Point } from '../src/model/types';
import { windowReturnPixels, windowReturnSize as size } from './fixtures/window-return';

function unrotatePoint(p: Point, rotation: number): Point {
  for (let turn = 0; turn < rotation; turn++) p = [p[1], size - p[0]];
  return p;
}
function unrotateRect(r: ImageRect, rotation: number): ImageRect {
  for (let turn = 0; turn < rotation; turn++) r = { x: r.y, y: size - r.x - r.w, w: r.h, h: r.w };
  return r;
}
describe('window end caps at stepped exterior returns', () => {
  it.each([0, 1, 2, 3].flatMap((rotation) => [false, true].map((blur) => ({ rotation, blur }))))(
    'does not turn a frame corner into a doorway or room partition (%j)',
    ({ rotation, blur }) => {
      const result = analyzeFloorplan(windowReturnPixels(rotation, blur), size, size, {
        threshold: blur ? 230 : 180,
        closeRadius: 0,
        minArea: 0.005,
        maxOpening: 80,
        maxWallThickness: 32,
      });
      const openings = result.openings.map((o) => ({
        ...o,
        a: unrotatePoint(o.a, rotation),
        b: unrotatePoint(o.b, rotation),
      }));
      expect(openings.some((o) => o.type === 'door' && Math.abs(o.a[0] - 285) < 3 && o.a[1] < 120)).toBe(
        false,
      );
      const walls = result.walls.map((w) => ({ ...w, ...unrotateRect(w, rotation) }));
      expect(
        walls.some((w) => w.kind === 'bridge' && w.x >= 280 && w.x <= 288 && w.y < 100 && w.h > 30),
      ).toBe(false);
      expect(walls.some((w) => w.kind === 'outline' && w.x === 304 && w.w === 12 && w.h >= 60)).toBe(true);
      expect(openings.some((o) => o.type === 'window' && Math.abs(o.a[1] - 50.5) < 2)).toBe(true);
      expect(openings.some((o) => o.evidence === 'gap' && Math.abs(o.a[1] - 204) < 2)).toBe(true);
      const rooms = result.rooms.map((r) => r.poly.map((p) => unrotatePoint(p, rotation)));
      expect(rooms.some((p) => inside([270, 80], p) && inside([295, 80], p))).toBe(true);
      // Every hosted opening must still refer to its own intersecting bridge.
      for (const wall of result.walls.filter((w) => w.openingIndex !== undefined)) {
        const o = result.openings[wall.openingIndex!];
        expect(o).toBeDefined();
        expect(Math.max(o.a[0], o.b[0])).toBeGreaterThanOrEqual(wall.x);
        expect(Math.min(o.a[0], o.b[0])).toBeLessThanOrEqual(wall.x + wall.w);
        expect(Math.max(o.a[1], o.b[1])).toBeGreaterThanOrEqual(wall.y);
        expect(Math.min(o.a[1], o.b[1])).toBeLessThanOrEqual(wall.y + wall.h);
      }
    },
  );
  it.each([0, 1, 2, 3])('retains a real open passage next to a window (rotation %i)', (rotation) => {
    const result = analyzeFloorplan(windowReturnPixels(rotation, false, true), size, size, {
      threshold: 180,
      closeRadius: 0,
      minArea: 0.005,
      maxOpening: 80,
      maxWallThickness: 32,
    });
    expect(
      result.openings.some((o) => {
        const a = unrotatePoint(o.a, rotation);
        return o.type === 'door' && Math.abs(a[0] - 285) < 3 && a[1] < 120;
      }),
    ).toBe(true);
  });
});
