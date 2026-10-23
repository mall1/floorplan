import { describe, expect, it } from 'vitest';
import { analyzeFloorplan, type RecognitionOptions } from '../src/model/recognition';
import { inside } from '../src/model/geometry';
const options: RecognitionOptions = { threshold: 180, closeRadius: 0, minArea: 0.01, maxWallThickness: 16 };
function drawing(w = 320, h = 260) {
  const pixels = new Uint8ClampedArray(w * h * 4).fill(255);
  const fill = (x: number, y: number, width: number, height: number, gray = 0) => {
    for (let yy = y; yy < y + height; yy++)
      for (let xx = x; xx < x + width; xx++) {
        const i = (yy * w + xx) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = gray;
      }
  };
  const outline = (x: number, y: number, width: number, height: number, gray = 0) => {
    fill(x, y, width, 1, gray);
    fill(x, y + height - 1, width, 1, gray);
    fill(x, y, 1, height, gray);
    fill(x + width - 1, y, 1, height, gray);
  };
  const box = () => {
    fill(30, 30, 260, 8);
    fill(30, 222, 260, 8);
    fill(30, 30, 8, 200);
    fill(282, 30, 8, 200);
  };
  const run = (extra: Partial<RecognitionOptions> = {}) =>
    analyzeFloorplan(pixels, w, h, { ...options, ...extra });
  return { pixels, fill, outline, box, run };
}
describe('rectangular wall decomposition', () => {
  it('uses the nearest jamb before a farther perpendicular wall when bridging an entrance', () => {
    const d = drawing();
    d.box();
    d.fill(30, 100, 8, 35, 255);
    d.fill(38, 165, 244, 8);
    d.fill(0, 100, 35, 1, 100);
    for (let angle = Math.PI / 2; angle <= Math.PI; angle += 0.005)
      d.fill(Math.round(34 + 35 * Math.cos(angle)), Math.round(100 + 35 * Math.sin(angle)), 1, 1, 100);
    const result = d.run({ maxOpening: 80 });
    const door = result.openings.find(
      (o) => o.type === 'door' && o.a[0] < 40 && o.a[1] >= 99 && o.a[1] <= 102,
    );
    expect(door).toMatchObject({ hinge: 'a', swing: 1, evidence: 'arc' });
    expect(door!.b[1]).toBeLessThanOrEqual(135);
  });
  it('rejects thin exterior dimension frames and interior annotation strokes', () => {
    const d = drawing();
    d.box();
    d.outline(8, 8, 304, 244);
    d.fill(10, 120, 300, 1);
    d.fill(150, 8, 1, 244);
    const r = d.run({ maxOpening: 50 });
    expect(r.rooms).toHaveLength(1);
    expect(r.rooms[0].areaPixels).toBe(244 * 184);
    expect(r.walls.every((w) => w.x >= 30 && w.y >= 30 && w.x + w.w <= 290 && w.y + w.h <= 230)).toBe(true);
  });
  it('fills white non-bearing wall bands, excluding the wall interior as a room', () => {
    const d = drawing();
    d.box();
    d.outline(150, 38, 8, 184, 135);
    const r = d.run();
    expect(r.rooms).toHaveLength(2);
    expect(r.walls.some((w) => w.kind === 'outline' && w.x === 150 && w.w === 8)).toBe(true);
    expect(r.rooms.some((room) => inside([154, 130], room.poly))).toBe(false);
    expect(r.openings).toHaveLength(0);
  });
  it('joins hollow L and T corners and merges free cells into concave rooms', () => {
    const d = drawing();
    d.box();
    d.outline(150, 38, 8, 104);
    d.outline(38, 134, 120, 8);
    d.outline(158, 90, 124, 8);
    const r = d.run();
    expect(r.rooms).toHaveLength(3);
    expect(r.rooms.some((room) => room.poly.length >= 6)).toBe(true);
  });
  it('recognizes an all-hollow outer shell without solid black wall seeds', () => {
    const d = drawing();
    d.outline(30, 30, 260, 8);
    d.outline(30, 222, 260, 8);
    d.outline(30, 38, 8, 184);
    d.outline(282, 38, 8, 184);
    expect(d.run().rooms).toHaveLength(1);
  });
  it('ignores detached narrow furniture rectangles and keeps a narrow corridor', () => {
    const d = drawing();
    d.box();
    d.outline(60, 60, 9, 70);
    d.outline(160, 38, 8, 184);
    d.outline(200, 38, 8, 184);
    const r = d.run();
    expect(r.rooms).toHaveLength(3);
    expect(r.rooms.some((room) => inside([184, 130], room.poly))).toBe(true);
    expect(r.walls.some((w) => w.x === 60)).toBe(false);
  });
  it('keeps transparent black pixels from becoming walls', () => {
    const d = drawing();
    d.box();
    d.fill(150, 38, 8, 184);
    for (let y = 38; y < 222; y++) for (let x = 150; x < 158; x++) d.pixels[(y * 320 + x) * 4 + 3] = 0;
    expect(d.run().rooms).toHaveLength(1);
  });
  it('validates malformed dimensions and options', () => {
    expect(() => analyzeFloorplan(new Uint8ClampedArray(8), 2, 2, options)).toThrow();
    const d = drawing();
    expect(() => d.run({ minWallThickness: NaN })).toThrow();
  });
  it('recognizes a balcony sliding track using two rooms and an exterior window, in both orientations', () => {
    const d = drawing();
    d.box();
    d.fill(38, 165, 244, 8);
    d.fill(90, 165, 140, 8, 255);
    d.outline(90, 165, 140, 8);
    d.fill(48, 222, 222, 8, 255);
    d.outline(48, 222, 222, 8);
    d.fill(48, 225, 222, 1);
    const r = d.run({ mmPerPixel: 20 });
    expect(r.rooms).toHaveLength(2);
    expect(r.openings.filter((o) => o.doorStyle === 'sliding')).toHaveLength(1);
    const sliding = r.openings.find((o) => o.doorStyle === 'sliding')!;
    expect(sliding).toMatchObject({ type: 'door', evidence: 'balcony' });
    expect(Math.abs(sliding.a[0] - 90)).toBeLessThanOrEqual(2);
    expect(Math.abs(sliding.b[0] - 230)).toBeLessThanOrEqual(2);
    const transposed = new Uint8ClampedArray(d.pixels.length);
    for (let y = 0; y < 260; y++)
      for (let x = 0; x < 320; x++)
        for (let k = 0; k < 4; k++) transposed[(x * 260 + y) * 4 + k] = d.pixels[(y * 320 + x) * 4 + k];
    const vertical = analyzeFloorplan(transposed, 260, 320, { ...options, mmPerPixel: 20 });
    expect(vertical.openings.filter((o) => o.doorStyle === 'sliding')).toHaveLength(1);
    expect(r.walls.filter((w) => Math.min(w.w, w.h) === 8).every((w) => w.widthMm === 120)).toBe(true);
  });
  it('recognizes small hollow shafts that share two wall faces without selecting detached cabinets or solid columns', () => {
    const d = drawing();
    d.box();
    d.outline(258, 38, 25, 28, 145); // two sides coincide with thick wall faces
    d.outline(110, 80, 25, 28, 145); // detached cabinet
    d.fill(38, 195, 25, 27); // solid column, not a hollow shaft
    const r = d.run({ mmPerPixel: 20 });
    expect(r.shafts).toHaveLength(1);
    expect(r.shafts[0]).toMatchObject({ selected: true, evidence: 'corner' });
    expect(r.shafts[0].x).toBeCloseTo(258, 0);
    expect(r.shafts[0].w).toBeGreaterThanOrEqual(22);
    expect(r.shafts[0].w).toBeLessThanOrEqual(26);
    expect(r.rooms).toHaveLength(1);
  });
  it('handles blurred pale hollow walls without including gray dimension lines', () => {
    const d = drawing();
    d.box();
    d.outline(150, 38, 9, 184, 175);
    d.fill(10, 10, 3, 240, 155);
    d.fill(10, 10, 300, 2, 155);
    const original = d.pixels.slice();
    for (let y = 1; y < 259; y++)
      for (let x = 1; x < 319; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            sum += original[((y + dy) * 320 + x + dx) * 4] * (dx ? 1 : 2) * (dy ? 1 : 2);
        const i = (y * 320 + x) * 4;
        d.pixels[i] = d.pixels[i + 1] = d.pixels[i + 2] = sum / 16;
      }
    const r = d.run({ threshold: 230, maxOpening: 30 });
    expect(r.rooms).toHaveLength(2);
    expect(r.walls.some((w) => w.x < 20 || w.y < 20)).toBe(false);
    expect(r.openings.filter((o) => o.type === 'window')).toHaveLength(0);
  });
});
describe('door and window candidates', () => {
  it.each(
    [false, true].flatMap((transpose) =>
      [false, true].flatMap((flip) => [false, true].map((blur) => ({ transpose, flip, blur }))),
    ),
  )(
    'preserves both arms of a continuous hollow T between adjacent doors (%j)',
    ({ transpose, flip, blur }) => {
      const d = drawing(600, 600);
      d.fill(40, 40, 520, 8);
      d.fill(40, 550, 520, 8);
      d.fill(40, 40, 8, 518);
      d.fill(552, 40, 8, 518);
      d.outline(48, 300, 282, 6, 150);
      d.outline(444, 300, 108, 6, 150);
      // One T-shaped outline: no internal cap between its arms and stem.
      d.outline(380, 300, 14, 7, 150);
      d.outline(384, 306, 6, 244, 150);
      d.fill(385, 306, 4, 1, 255);
      if (blur) {
        const original = d.pixels.slice();
        for (let y = 1; y < 599; y++)
          for (let x = 1; x < 599; x++) {
            let sum = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++)
                sum += original[((y + dy) * 600 + x + dx) * 4] * (dx ? 1 : 2) * (dy ? 1 : 2);
            const i = (y * 600 + x) * 4;
            d.pixels[i] = d.pixels[i + 1] = d.pixels[i + 2] = sum / 16;
          }
      }
      let pixels = d.pixels;
      if (transpose || flip) {
        pixels = new Uint8ClampedArray(pixels.length);
        for (let y = 0; y < 600; y++)
          for (let x = 0; x < 600; x++) {
            const yy = flip ? 599 - y : y;
            pixels.set(
              d.pixels.subarray((y * 600 + x) * 4, (y * 600 + x) * 4 + 4),
              (transpose ? x * 600 + yy : yy * 600 + x) * 4,
            );
          }
      }
      const r = analyzeFloorplan(pixels, 600, 600, {
        ...options,
        threshold: blur ? 230 : 180,
        maxOpening: 130,
      });
      const axis = transpose ? 1 : 0,
        cross = transpose ? 0 : 1;
      const low = flip ? 293 : 300,
        high = flip ? 300 : 307;
      const doors = r.openings.filter((o) => o.type === 'door' && o.a[cross] >= low && o.a[cross] <= high);
      expect(doors).toHaveLength(2);
      expect(doors.some((o) => o.a[axis] >= 330 && o.b[axis] <= 380)).toBe(true);
      expect(doors.some((o) => o.a[axis] >= 394 && o.b[axis] <= 444)).toBe(true);
      expect(
        r.walls.some(
          (w) =>
            w.kind === 'outline' &&
            (transpose
              ? w.y <= 380 && w.y + w.h >= 394 && w.x >= low - 1 && w.x <= low + 1 && w.w <= 8
              : w.x <= 380 && w.x + w.w >= 394 && w.y >= low - 1 && w.y <= low + 1 && w.h <= 8),
        ),
      ).toBe(true);
    },
  );
  it('preserves a short white T-jamb instead of spanning the door to the far wall face', () => {
    const d = drawing(600, 600);
    d.fill(40, 40, 520, 8);
    d.fill(40, 550, 520, 8);
    d.fill(40, 40, 8, 518);
    d.fill(552, 40, 8, 518);
    d.outline(48, 300, 282, 6);
    d.outline(384, 306, 6, 244);
    d.outline(380, 300, 14, 6);
    const r = d.run({ maxOpening: 80 });
    const door = r.openings.find((o) => o.type === 'door' && o.a[0] >= 329 && o.a[0] < 340 && o.b[0] > 370);
    expect(door, JSON.stringify(r.openings)).toBeDefined();
    expect(door!.b[0]).toBeLessThanOrEqual(380);
    expect(r.walls.some((w) => w.x === 380 && w.y >= 300 && w.y <= 301 && w.w >= 12)).toBe(true);
  });
  it('finds a door break without turning a nearby thin door leaf into a wall', () => {
    const d = drawing();
    d.box();
    d.fill(150, 38, 8, 72);
    d.fill(150, 145, 8, 77);
    d.fill(115, 110, 36, 1);
    const r = d.run({ maxOpening: 40 });
    expect(r.rooms).toHaveLength(2);
    expect(r.openings).toEqual([{ type: 'door', a: [154, 111], b: [154, 145], width: 8, evidence: 'gap' }]);
    expect(d.run({ maxOpening: 20 }).rooms).toHaveLength(1);
  });
  it('uses a quarter-circle swing arc as door evidence', () => {
    const d = drawing();
    d.box();
    d.fill(150, 38, 8, 72);
    d.fill(150, 145, 8, 77);
    d.fill(119, 110, 35, 1);
    for (let i = 0; i <= 100; i++) {
      const angle = ((i / 100) * Math.PI) / 2;
      d.fill(Math.round(154 - 35 * Math.sin(angle)), Math.round(110 + 35 * Math.cos(angle)), 1, 1);
    }
    const r = d.run({ maxOpening: 40 });
    expect(r.openings.some((o) => o.type === 'door' && o.evidence === 'arc')).toBe(true);
  });
  it('closes a doorway whose perpendicular jamb ends exactly at an L corner', () => {
    const d = drawing();
    d.box();
    d.outline(150, 38, 8, 100);
    d.outline(38, 138, 72, 8);
    const r = d.run({ maxOpening: 45 });
    expect(r.rooms).toHaveLength(2);
    const door = r.openings.find((o) => o.type === 'door' && o.a[0] <= 110 && o.b[0] >= 150);
    expect(door).toBeDefined();
    expect(
      r.walls.some(
        (w) => w.kind === 'bridge' && w.openingIndex !== undefined && r.openings[w.openingIndex] === door,
      ),
    ).toBe(true);
  });
  it('recognizes horizontal and vertical multi-line windows, not plain double-line walls', () => {
    const d = drawing();
    d.box();
    d.fill(90, 30, 90, 8, 255);
    for (const y of [30, 34, 37]) d.fill(90, y, 90, 1);
    d.fill(282, 90, 8, 90, 255);
    for (const x of [282, 286, 289]) d.fill(x, 90, 1, 90);
    const r = d.run();
    expect(r.rooms).toHaveLength(1);
    expect(r.openings.filter((o) => o.type === 'window')).toHaveLength(2);
    expect(r.openings.some((o) => o.type === 'door')).toBe(false);
  });
  it('splits adjacent windows at an intervening solid wall pier', () => {
    const d = drawing();
    d.box();
    d.fill(70, 30, 180, 8, 255);
    for (const y of [30, 34, 37]) d.fill(70, y, 180, 1);
    d.fill(150, 30, 10, 8);
    const r = d.run();
    const windows = r.openings.filter((o) => o.type === 'window');
    expect(windows).toHaveLength(2);
    expect(windows.every((o) => o.b[0] <= 150 || o.a[0] >= 160)).toBe(true);
  });
});

it('recognizes a projecting bay front with two returns and keeps it out of the room list', () => {
  const d = drawing();
  d.fill(30, 80, 78, 8);
  d.fill(212, 80, 78, 8);
  d.fill(30, 80, 8, 150);
  d.fill(282, 80, 8, 150);
  d.fill(30, 222, 260, 8);
  d.fill(100, 30, 8, 58);
  d.fill(212, 30, 8, 58);
  for (const y of [30, 34, 38]) d.fill(108, y, 104, 1);
  const r = d.run({ maxOpening: 120 });
  const bay = r.openings.find((o) => o.windowStyle === 'bay');
  expect(bay, JSON.stringify(r.openings)).toBeDefined();
  expect(bay?.baySide).toBe(-1);
  expect(bay?.bayDepth).toBeGreaterThan(30);
  expect(r.rooms.every((room) => !inside([160, 55], room.poly))).toBe(true);
  expect(r.rooms.some((room) => inside([160, 150], room.poly))).toBe(true);
});

it('recognizes an inset bay using a thin sill line without leaking the main room', () => {
  const d = drawing(400, 350);
  d.fill(30, 30, 340, 8);
  d.fill(30, 310, 340, 8);
  d.fill(30, 30, 8, 288);
  d.fill(362, 30, 8, 60);
  d.fill(362, 270, 8, 48);
  d.fill(330, 82, 40, 8);
  d.fill(300, 270, 70, 8);
  for (const x of [362, 366, 370]) d.fill(x, 91, 1, 178);
  d.fill(330, 90, 1, 180, 120);
  const r = d.run({ maxOpening: 60 });
  expect(r.openings.filter((o) => o.windowStyle === 'bay')).toHaveLength(1);
  expect(r.rooms.some((room) => inside([200, 150], room.poly))).toBe(true);
  expect(r.rooms.every((room) => !inside([350, 150], room.poly))).toBe(true);
});
