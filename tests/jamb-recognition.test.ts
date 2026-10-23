import { describe, expect, it } from 'vitest';
import { analyzeFloorplan, type ImageRect } from '../src/model/recognition';
import { joinWallAxes, resolvedOpening, wallFootprint } from '../src/model/architecture';
import { distance, wallSegments } from '../src/model/geometry';
import type { Point, Wall, Opening } from '../src/model/types';

const size = 600;
function lOutline(blur: boolean, rotation: number, closed = true, longArm = false) {
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
  const fill = (x: number, y: number, w: number, h: number, gray = 150) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const i = (yy * size + xx) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = gray;
      }
  };
  const outline = (x: number, y: number, w: number, h: number) => {
    fill(x, y, w, 1);
    fill(x, y + h - 1, w, 1);
    fill(x, y, 1, h);
    fill(x + w - 1, y, 1, h);
  };
  fill(40, 40, 520, 8, 0);
  fill(40, 550, 520, 8, 0);
  fill(40, 40, 8, 518, 0);
  fill(552, 40, 8, 518, 0);
  outline(48, 300, longArm ? 102 : 242, 12);
  outline(350, 48, 13, 253);
  outline(longArm ? 200 : 345, 300, longArm ? 169 : 18, 12);
  if (longArm) outline(419, 300, 133, 12);
  fill(351, 300, 11, 1, 255); // Continuous L outline, with no internal seam.
  if (!closed) fill(345, 301, 1, 10, 255); // Two dimension strokes, without a closing face.
  if (blur) {
    const before = rgba.slice();
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < size - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            sum += before[((y + dy) * size + x + dx) * 4] * (dx ? 1 : 2) * (dy ? 1 : 2);
        const i = (y * size + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = sum / 16;
      }
  }
  let pixels = rgba;
  for (let turn = 0; turn < rotation; turn++) {
    const next = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        next.set(pixels.subarray(i, i + 4), (x * size + size - 1 - y) * 4);
      }
    pixels = next;
  }
  return analyzeFloorplan(pixels, size, size, {
    threshold: blur ? 230 : 180,
    closeRadius: 0,
    minArea: 0.01,
    maxOpening: 80,
    maxWallThickness: 24,
  });
}
function unrotateRect(r: ImageRect, rotation: number): ImageRect {
  for (let turn = 0; turn < rotation; turn++) r = { x: r.y, y: size - r.x - r.w, w: r.h, h: r.w };
  return r;
}
function unrotatePoint(p: Point, rotation: number): Point {
  for (let turn = 0; turn < rotation; turn++) p = [p[1], size - p[0]];
  return p;
}
describe('continuous hollow L returns', () => {
  it.each([0, 1].flatMap((rotation) => [false, true].map((blur) => ({ rotation, blur }))))(
    'recovers a short return attached to the end of a long wall (%j)',
    ({ rotation, blur }) => {
      const result = lOutline(blur, rotation, true, true);
      const walls = result.walls.filter((w) => w.kind === 'outline').map((w) => unrotateRect(w, rotation));
      expect(
        walls.some(
          (w) => w.x <= 200 && w.x + w.w >= 369 && w.y >= 299 && w.y <= 301 && w.h >= 11 && w.h <= 13,
        ),
      ).toBe(true);
      const doors = result.openings
        .filter((o) => o.type === 'door')
        .map((o) => [unrotatePoint(o.a, rotation), unrotatePoint(o.b, rotation)]);
      expect(
        doors.some(
          ([a, b]) =>
            Math.abs(a[1] - b[1]) < 1 &&
            a[1] >= 300 &&
            a[1] <= 312 &&
            Math.min(a[0], b[0]) >= 369 &&
            Math.max(a[0], b[0]) <= 419,
        ),
      ).toBe(true);
    },
  );
  it.each([0, 1, 2, 3].flatMap((rotation) => [false, true].map((blur) => ({ rotation, blur }))))(
    'retains the short arm, the clear doorway and the imported corner (%j)',
    ({ rotation, blur }) => {
      const result = lOutline(blur, rotation);
      const walls = result.walls.filter((w) => w.kind !== 'bridge').map((w) => unrotateRect(w, rotation));
      const head = walls.find(
        (w) => w.x <= 345 && w.x + w.w >= 363 && w.y >= 299 && w.y <= 301 && w.h >= 11 && w.h <= 13,
      );
      expect(head).toBeDefined();
      const doors = result.openings
        .filter((o) => o.type === 'door')
        .map((o) => {
          const a = unrotatePoint(o.a, rotation),
            b = unrotatePoint(o.b, rotation);
          return { a, b, left: Math.min(a[0], b[0]), right: Math.max(a[0], b[0]) };
        })
        .filter((o) => Math.abs(o.a[1] - o.b[1]) < 1 && o.a[1] >= 300 && o.a[1] <= 312);
      expect(doors.some((o) => o.left >= 290 && o.right <= 345 && o.right >= 340)).toBe(true);
      const worldWalls: Wall[] = result.walls.map((w, i) => ({
        id: `w${i}`,
        a: (w.w >= w.h ? [w.x, w.y + w.h / 2] : [w.x + w.w / 2, w.y]).map((v) => v * 17) as Point,
        b: (w.w >= w.h ? [w.x + w.w, w.y + w.h / 2] : [w.x + w.w / 2, w.y + w.h]).map((v) => v * 17) as Point,
        width: Math.min(w.w, w.h) * 17,
        height: 2800,
        bearing: false,
      }));
      joinWallAxes(worldWalls);
      const openings: Opening[] = result.openings.map((o, i) =>
        resolvedOpening(
          {
            ...o,
            id: `d${i}`,
            a: o.a.map((v) => v * 17) as Point,
            b: o.b.map((v) => v * 17) as Point,
            width: o.width * 17,
            color: '#b6906a',
          },
          worldWalls,
        ),
      );
      const headIndex = result.walls.findIndex(
        (w) => JSON.stringify(unrotateRect(w, rotation)) === JSON.stringify(head),
      );
      const imported = worldWalls[headIndex];
      // Wall cuts retain the end adjoining the door; the perpendicular joint may
      // shorten to a centreline, but its miter must still cover the outer corner.
      expect(wallSegments(imported, openings).some((s) => s.bottom === 0 && s.top === 2800)).toBe(true);
      const poly = wallFootprint(imported, worldWalls).map((p) =>
        unrotatePoint([p[0] / 17, p[1] / 17], rotation),
      );
      expect(Math.min(...poly.map((p) => p[0]))).toBeLessThanOrEqual(345.1);
      expect(Math.max(...poly.map((p) => p[0]))).toBeGreaterThanOrEqual(362.9);
      expect(distance(imported.a, imported.b)).toBeGreaterThan(1);
    },
  );
  it('does not manufacture a return from uncapped annotation strokes', () => {
    const result = lOutline(false, 0, false);
    expect(
      result.walls.some(
        (w) => w.kind === 'outline' && w.x < 349 && w.x + w.w >= 363 && w.y >= 299 && w.y <= 301 && w.h <= 13,
      ),
    ).toBe(false);
  });
});
