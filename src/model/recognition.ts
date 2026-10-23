import type { Point, WallRecognitionSettings } from './types';
import { recognizeBayWindows } from './bay-recognition';
import { recognizeBalconyDoors, recognizeShafts } from './feature-recognition';
import { matchWallThickness } from './wall-presets';
import { fitDetectedDoors } from './door-presets';
import type { DoorRecognitionSettings } from './types';
import type { PipeRecognitionSettings } from './types';
import { recognizeDoorDirection } from './door-direction';
import { recognizePipes, type RecognizedPipe } from './pipe-recognition';

// Pixel coordinates, never millimetres. Closing is applied only to confirmed
// wall ends: dimension strokes must not become walls when closing a door.
export interface RecognitionOptions {
  threshold: number;
  closeRadius: number;
  minArea: number;
  minWallThickness?: number;
  maxWallThickness?: number;
  maxOpening?: number;
  mmPerPixel?: number;
  wallSettings?: WallRecognitionSettings;
  doorSettings?: DoorRecognitionSettings;
  pipeSettings?: PipeRecognitionSettings;
}
export interface ImageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface RecognizedWall extends ImageRect {
  kind: 'solid' | 'outline' | 'bridge';
  openingIndex?: number;
  widthMm?: number;
}
export interface RecognizedOpening {
  type: 'door' | 'window' | 'railing';
  hinge?: 'a' | 'b';
  swing?: 1 | -1;
  a: Point;
  b: Point;
  width: number;
  evidence: 'arc' | 'parallel' | 'gap' | 'bay' | 'balcony';
  doorStyle?: 'swing' | 'sliding';
  windowStyle?: 'flat' | 'bay';
  bayDepth?: number;
  baySide?: 1 | -1;
}
export interface RecognitionResult {
  rooms: { poly: Point[]; areaPixels: number }[];
  walls: RecognizedWall[];
  openings: RecognizedOpening[];
  shafts: RecognizedShaft[];
  pipes: RecognizedPipe[];
  grid: { xs: number[]; ys: number[]; cellCount: number };
  warnings: string[];
}
export interface RecognizedShaft extends ImageRect {
  evidence: 'cross' | 'corner' | 'box';
  selected: boolean;
}
type Stroke = ImageRect & { axis: 'h' | 'v' };
type Proposal = Stroke & { kind: RecognizedWall['kind']; window: boolean; openingIndex?: number };
const endX = (r: ImageRect) => r.x + r.w;
const endY = (r: ImageRect) => r.y + r.h;
const thickness = (s: Stroke) => (s.axis === 'h' ? s.h : s.w);
const length = (s: Stroke) => (s.axis === 'h' ? s.w : s.h);
const start = (s: Stroke) => (s.axis === 'h' ? s.x : s.y);
const cross = (s: Stroke) => (s.axis === 'h' ? s.y : s.x);
const overlap = (a: number, b: number, c: number, d: number) => Math.min(b, d) - Math.max(a, c);
const makeRect = (axis: 'h' | 'v', a: number, b: number, c: number, d: number): Stroke =>
  axis === 'h' ? { axis, x: a, y: c, w: b - a, h: d - c } : { axis, x: c, y: a, w: d - c, h: b - a };
function integral(mask: Uint8Array, w: number, h: number) {
  const sums = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x];
      sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row;
    }
  }
  return (r: ImageRect) => {
    const x = Math.max(0, Math.floor(r.x)),
      y = Math.max(0, Math.floor(r.y));
    const right = Math.min(w, Math.ceil(endX(r))),
      bottom = Math.min(h, Math.ceil(endY(r)));
    if (right <= x || bottom <= y) return 0;
    return (
      (sums[bottom * (w + 1) + right] -
        sums[y * (w + 1) + right] -
        sums[bottom * (w + 1) + x] +
        sums[y * (w + 1) + x]) /
      ((right - x) * (bottom - y))
    );
  };
}
// Preserve separate edges of hollow walls. Endpoints must agree on consecutive
// scan rows, so T/L corners create cuts instead of oversized bounding boxes.
function strokes(mask: Uint8Array, w: number, h: number, axis: 'h' | 'v', minLength: number): Stroke[] {
  const along = axis === 'h' ? w : h,
    across = axis === 'h' ? h : w;
  const result: Stroke[] = [];
  let previous: Stroke[] = [];
  for (let c = 0; c < across; c++) {
    const current: Stroke[] = [];
    for (let a = 0; a < along;) {
      const value = (p: number) => mask[axis === 'h' ? c * w + p : p * w + c];
      if (!value(a)) {
        a++;
        continue;
      }
      const first = a;
      let last = a++;
      while (a < along) {
        if (value(a)) {
          last = a++;
          continue;
        }
        if (a + 1 < along && value(a + 1)) {
          a++;
          continue;
        }
        break;
      }
      if (last + 1 - first < minLength) continue;
      const old = previous.find(
        (s) => Math.abs(start(s) - first) <= 1 && Math.abs(start(s) + length(s) - last - 1) <= 1,
      );
      if (old) {
        if (axis === 'h') old.h++;
        else old.w++;
        current.push(old);
      } else {
        const line = makeRect(axis, first, last + 1, c, c + 1);
        result.push(line);
        current.push(line);
      }
    }
    previous = current;
  }
  return result;
}
function near(a: ImageRect, b: ImageRect, tolerance = 1) {
  return (
    overlap(a.x, endX(a), b.x, endX(b)) >= -tolerance && overlap(a.y, endY(a), b.y, endY(b)) >= -tolerance
  );
}
// Local intensity valleys locate blurred outline centres independently of their
// thresholded width. Directional support tolerates a one-pixel scan/JPEG wobble.
function edgeStrokes(
  gray: Uint8Array,
  w: number,
  h: number,
  axis: 'h' | 'v',
  minLength: number,
  threshold: number,
): Stroke[] {
  const ridge = new Uint8Array(w * h),
    supported = new Uint8Array(w * h);
  const step = axis === 'h' ? w : 1;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x,
        c = axis === 'h' ? y : x,
        limit = axis === 'h' ? h : w,
        value = gray[i];
      if (value >= threshold || value > gray[i - step] || value > gray[i + step]) continue;
      let before = value,
        after = value;
      for (let k = 1; k <= 4; k++) {
        if (c >= k) before = Math.max(before, gray[i - k * step]);
        if (c + k < limit) after = Math.max(after, gray[i + k * step]);
      }
      if (before - value >= 14 && after - value >= 14) ridge[i] = 1;
    }
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      supported[i] = +(ridge[i] || ridge[i - step] || ridge[i + step]);
    }
  const bands = mergeBands(
    strokes(supported, w, h, axis, minLength)
      .filter((s) => thickness(s) <= 7)
      .map((s) => ({ ...s, kind: 'outline' as const, window: false })),
  );
  const stable = strokes(ridge, w, h, axis, minLength)
    .filter((s) => thickness(s) <= 4)
    .map((s) =>
      makeRect(
        axis,
        start(s),
        start(s) + length(s),
        cross(s) + Math.floor(thickness(s) / 2),
        cross(s) + Math.floor(thickness(s) / 2) + 1,
      ),
    );
  return [
    ...stable,
    ...bands.map((s) => {
      let best = cross(s),
        score = Infinity;
      for (let c = cross(s); c < cross(s) + thickness(s); c++) {
        let sum = 0;
        for (let p = start(s); p < start(s) + length(s); p++)
          sum += gray[axis === 'h' ? c * w + p : p * w + c];
        if (sum < score) {
          score = sum;
          best = c;
        }
      }
      return makeRect(axis, start(s), start(s) + length(s), best, best + 1);
    }),
  ];
}
function mergeBands(input: Proposal[]) {
  const result: Proposal[] = [];
  for (const s of input.sort((a, b) => start(a) - start(b))) {
    const old = result.find(
      (r) =>
        r.axis === s.axis &&
        r.kind === s.kind &&
        ((Math.abs(cross(r) - cross(s)) <= 2 &&
          Math.abs(thickness(r) - thickness(s)) <= 2 &&
          overlap(start(r), start(r) + length(r), start(s), start(s) + length(s)) >= -2) ||
          (thickness(r) > 1 &&
            thickness(s) > 1 &&
            overlap(cross(r), cross(r) + thickness(r), cross(s), cross(s) + thickness(s)) >=
              Math.min(thickness(r), thickness(s)) * 0.85 &&
            overlap(start(r), start(r) + length(r), start(s), start(s) + length(s)) >=
              Math.min(length(r), length(s)) * 0.85)),
    );
    if (!old) {
      result.push({ ...s });
      continue;
    }
    const a = Math.min(start(old), start(s)),
      b = Math.max(start(old) + length(old), start(s) + length(s));
    const c = Math.min(cross(old), cross(s)),
      d = Math.max(cross(old) + thickness(old), cross(s) + thickness(s));
    Object.assign(old, makeRect(s.axis, a, b, c, d), { window: old.window || s.window });
  }
  return result;
}
function cornerGap(a: Stroke, b: Stroke, maxGap: number): Stroke | undefined {
  if (a.axis === b.axis) return;
  const across0 = a.axis === 'h' ? b.y : b.x,
    across1 = a.axis === 'h' ? endY(b) : endX(b);
  const crossOverlap = overlap(cross(a), cross(a) + thickness(a), across0, across1);
  if (crossOverlap < -2) return;
  const b0 = a.axis === 'h' ? b.x : b.y,
    b1 = a.axis === 'h' ? endX(b) : endY(b);
  const a0 = start(a),
    a1 = a0 + length(a);
  let from = a1 <= b0 ? a1 : b1,
    to = a1 <= b0 ? b0 : a0;
  if (to <= from || to - from > maxGap) return;
  let low = cross(a),
    high = low + thickness(a);
  if (crossOverlap < thickness(a) * 0.7) {
    // L-shaped jamb: the perpendicular wall can end at the corner instead of
    // crossing the opening's axis. Continue to its far face to join the corner.
    if (a1 <= b0) to = b1;
    else from = b0;
    if (across1 < low) low = across1;
    if (across0 > high) high = across0;
  }
  return makeRect(a.axis, from, to, low, high);
}
function gapBetween(a: Stroke, b: Stroke, maxGap: number): Stroke | undefined {
  if (a.axis !== b.axis) return;
  const lo = Math.max(cross(a), cross(b)),
    hi = Math.min(cross(a) + thickness(a), cross(b) + thickness(b));
  if (hi - lo < Math.min(thickness(a), thickness(b)) * 0.65) return;
  const first = start(a) <= start(b) ? a : b,
    second = first === a ? b : a;
  const from = start(first) + length(first),
    to = start(second);
  if (to <= from || to - from > maxGap) return;
  return makeRect(a.axis, from, to, lo, hi);
}
function centerline(s: Stroke): { a: Point; b: Point; width: number } {
  return s.axis === 'h'
    ? { a: [s.x, s.y + s.h / 2], b: [endX(s), s.y + s.h / 2], width: s.h }
    : { a: [s.x + s.w / 2, s.y], b: [s.x + s.w / 2, endY(s)], width: s.w };
}
function partition(proposals: Stroke[], w: number, h: number) {
  const xs = [...new Set([0, w, ...proposals.flatMap((r) => [r.x, endX(r)])])].sort((a, b) => a - b);
  const ys = [...new Set([0, h, ...proposals.flatMap((r) => [r.y, endY(r)])])].sort((a, b) => a - b);
  return { xs, ys, cellCount: (xs.length - 1) * (ys.length - 1) };
}
function findRooms(
  grid: RecognitionResult['grid'],
  walls: ImageRect[],
  w: number,
  h: number,
  minArea: number,
) {
  const { xs, ys } = grid,
    cols = xs.length - 1,
    rows = ys.length - 1;
  const xi = new Map(xs.map((x, i) => [x, i])),
    yi = new Map(ys.map((y, i) => [y, i]));
  const delta = new Int32Array(xs.length * ys.length);
  for (const r of walls) {
    const a = xi.get(r.x)!,
      b = xi.get(endX(r))!,
      c = yi.get(r.y)!,
      d = yi.get(endY(r))!;
    delta[c * xs.length + a]++;
    delta[c * xs.length + b]--;
    delta[d * xs.length + a]--;
    delta[d * xs.length + b]++;
  }
  const blocked = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    let count = 0;
    for (let x = 0; x < cols; x++) {
      const i = y * xs.length + x;
      count += delta[i];
      delta[i] = count + (y ? delta[i - xs.length] : 0);
      blocked[y * cols + x] = +(delta[i] > 0);
    }
  }
  const labels = new Int32Array(blocked.length),
    queue = new Int32Array(blocked.length);
  const result: RecognitionResult['rooms'] = [];
  let label = 0;
  for (let seed = 0; seed < blocked.length; seed++) {
    if (blocked[seed] || labels[seed]) continue;
    label++;
    let head = 0,
      tail = 1,
      exterior = false,
      size = 0;
    queue[0] = seed;
    labels[seed] = label;
    while (head < tail) {
      const i = queue[head++],
        x = i % cols,
        y = Math.floor(i / cols);
      size += (xs[x + 1] - xs[x]) * (ys[y + 1] - ys[y]);
      if (!x || !y || x === cols - 1 || y === rows - 1) exterior = true;
      for (const n of [
        x > 0 ? i - 1 : -1,
        x + 1 < cols ? i + 1 : -1,
        y > 0 ? i - cols : -1,
        y + 1 < rows ? i + cols : -1,
      ]) {
        if (n >= 0 && !blocked[n] && !labels[n]) {
          labels[n] = label;
          queue[tail++] = n;
        }
      }
    }
    if (exterior || size < minArea * w * h || size > 0.95 * w * h) continue;
    const edges = new Map<number, number[]>();
    const edge = (a: number, b: number) => edges.set(a, [...(edges.get(a) || []), b]);
    for (let q = 0; q < tail; q++) {
      const i = queue[q],
        x = i % cols,
        y = Math.floor(i / cols),
        corner = y * xs.length + x;
      if (!y || labels[i - cols] !== label) edge(corner, corner + 1);
      if (x === cols - 1 || labels[i + 1] !== label) edge(corner + 1, corner + 1 + xs.length);
      if (y === rows - 1 || labels[i + cols] !== label) edge(corner + 1 + xs.length, corner + xs.length);
      if (!x || labels[i - 1] !== label) edge(corner + xs.length, corner);
    }
    // Trace all rings; holes are retained as separate editable wall rectangles.
    let largest: Point[] = [],
      largestArea = 0;
    while (edges.size) {
      const first = edges.keys().next().value!,
        poly: Point[] = [];
      let cur = first,
        closed = false;
      for (let steps = 0, limit = edges.size + 1; steps < limit; steps++) {
        poly.push([xs[cur % xs.length], ys[Math.floor(cur / xs.length)]]);
        const targets = edges.get(cur),
          next = targets?.pop();
        if (!targets?.length) edges.delete(cur);
        if (next === undefined) break;
        cur = next;
        if (cur === first) {
          closed = true;
          break;
        }
      }
      if (!closed) continue;
      const reduced = poly.filter((p, i) => {
        const a = poly[(i + poly.length - 1) % poly.length],
          b = poly[(i + 1) % poly.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      });
      const area =
        Math.abs(
          reduced.reduce((sum, p, i) => {
            const b = reduced[(i + 1) % reduced.length];
            return sum + p[0] * b[1] - b[0] * p[1];
          }, 0),
        ) / 2;
      if (area > largestArea) {
        largestArea = area;
        largest = reduced;
      }
    }
    if (largest.length >= 4 && largest.length <= 200) result.push({ poly: largest, areaPixels: size });
  }
  return result.sort((a, b) => b.areaPixels - a.areaPixels).slice(0, 80);
}
export function analyzeFloorplan(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  opt: RecognitionOptions,
): RecognitionResult {
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    w * h > 4_000_000 ||
    rgba.length !== w * h * 4
  )
    throw Error('识别图片尺寸无效或超过 400 万像素');
  if (
    ![
      opt.threshold,
      opt.closeRadius,
      opt.minArea,
      opt.minWallThickness ?? 3,
      opt.maxWallThickness ?? 32,
      opt.maxOpening ?? 0,
      opt.mmPerPixel ?? 1,
      ...(opt.wallSettings
        ? [opt.wallSettings.thin, opt.wallSettings.thick, opt.wallSettings.tolerance]
        : []),
      ...(opt.doorSettings
        ? [opt.doorSettings.tolerance, ...opt.doorSettings.widths, ...opt.doorSettings.slidingWidths]
        : []),
    ].every(Number.isFinite)
  )
    throw Error('识别参数必须为有限数值');
  if (opt.mmPerPixel !== undefined && opt.mmPerPixel <= 0) throw Error('识别比例必须大于零');
  if (
    opt.pipeSettings &&
    (!Number.isFinite(opt.pipeSettings.tolerance) ||
      opt.pipeSettings.tolerance < 0 ||
      !opt.pipeSettings.diameters.length ||
      opt.pipeSettings.diameters.some((v) => !Number.isFinite(v) || v < 10 || v > 1000))
  )
    throw Error('管径预设需为 10–1000 mm，匹配容差不能为负数');
  if (
    opt.doorSettings &&
    (opt.doorSettings.tolerance < 0 ||
      !opt.doorSettings.widths.length ||
      !opt.doorSettings.slidingWidths.length ||
      [...opt.doorSettings.widths, ...opt.doorSettings.slidingWidths].some((v) => v <= 0))
  )
    throw Error('门洞预设需为正数，匹配容差不能为负数');
  const minThickness = Math.max(2, opt.minWallThickness ?? 3);
  const maxThickness = Math.max(
    minThickness + 1,
    opt.maxWallThickness ?? Math.max(12, Math.round(Math.min(w, h) * 0.035)),
  );
  const maxOpening = Math.max(0, Math.min(Math.max(w, h) / 3, opt.maxOpening ?? opt.closeRadius * 2));
  const minLength = Math.max(10, Math.round(Math.min(w, h) * 0.025));
  const mask = new Uint8Array(w * h),
    solidMask = new Uint8Array(w * h),
    grayValues = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    const alpha = rgba[i * 4 + 3] / 255;
    const gray =
      (rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114) * alpha + 255 * (1 - alpha);
    mask[i] = +(gray < opt.threshold);
    solidMask[i] = +(gray < Math.min(opt.threshold, 125));
    grayValues[i] = Math.round(gray);
  }
  const solidDensity = integral(solidMask, w, h);
  const lines = [
    ...edgeStrokes(grayValues, w, h, 'h', minLength, opt.threshold),
    ...edgeStrokes(grayValues, w, h, 'v', minLength, opt.threshold),
  ];
  const solidLines = [
    ...strokes(solidMask, w, h, 'h', minLength),
    ...strokes(solidMask, w, h, 'v', minLength),
  ];
  if (lines.length > 2000) throw Error('图纸线条过于密集，请裁剪户型区域或调低黑白阈值');
  const proposals: Proposal[] = solidLines
    .filter((s) => thickness(s) >= minThickness && solidDensity(s) >= 0.8)
    .map((s) => ({ ...s, kind: 'solid', window: false }));
  const widths = proposals
    .filter((s) => thickness(s) <= maxThickness && length(s) >= thickness(s) * 3)
    .sort((a, b) => thickness(a) - thickness(b));
  const totalSupport = widths.reduce((sum, s) => sum + length(s), 0);
  let support = 0,
    typical = 0;
  for (const s of widths) {
    support += length(s);
    if (support >= totalSupport / 2) {
      typical = thickness(s);
      break;
    }
  }
  // Dimension lines just outside a window can be parallel to its frame. Their
  // much larger separation must not become an extra hollow wall band.
  const hollowLimit = typical ? Math.min(maxThickness, Math.max(8, typical * 2)) : maxThickness;
  const thin = lines;
  const distinctEdges = (axis: 'h' | 'v', a: number, b: number, from: number, to: number) => {
    if (b - a < 3) return false;
    let contrast = 0,
      count = 0;
    for (let p = from; p < to; p += Math.max(1, Math.floor((to - from) / 24))) {
      const pixel = (c: number) => grayValues[axis === 'h' ? c * w + p : p * w + c];
      let brightest = 0;
      for (let c = a + 1; c < b; c++) brightest = Math.max(brightest, pixel(c));
      contrast += brightest - Math.max(pixel(a), pixel(b));
      count++;
    }
    return contrast / count >= 12;
  };
  for (let i = 0; i < thin.length; i++)
    for (let j = i + 1; j < thin.length; j++) {
      const a = thin[i],
        b = thin[j];
      if (a.axis !== b.axis) continue;
      const low = Math.min(cross(a), cross(b)),
        high = Math.max(cross(a) + thickness(a), cross(b) + thickness(b));
      const width = high - low;
      if (
        width < minThickness + 1 ||
        width > hollowLimit ||
        overlap(cross(a), cross(a) + thickness(a), cross(b), cross(b) + thickness(b)) >= 0
      )
        continue;
      let from = Math.max(start(a), start(b)),
        to = Math.min(start(a) + length(a), start(b) + length(b));
      if (to - from < Math.max(minLength, width * 2)) continue;
      // The ridge can end one pixel inside a closed outline corner. Include
      // the cap itself so a doorway starts at the wall face, not inside it.
      const closedCap = (at: number) => {
        let hits = 0;
        for (let c = low + 1; c < high - 1; c++) {
          const x = a.axis === 'h' ? at : c,
            y = a.axis === 'h' ? c : at;
          if (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]) hits++;
        }
        return hits / (width - 2) >= 0.8;
      };
      if (closedCap(from - 1)) from--;
      if (closedCap(to)) to++;
      const r = makeRect(a.axis, from, to, low, high);
      if (solidDensity(r) > 0.65) continue;
      const window = thin.some(
        (c) =>
          c !== a &&
          c !== b &&
          c.axis === a.axis &&
          cross(c) >= low + 3 &&
          cross(c) <= high - 4 &&
          overlap(from, to, start(c), start(c) + length(c)) >= (to - from) * 0.8 &&
          distinctEdges(a.axis, low, cross(c), from, to) &&
          distinctEdges(a.axis, cross(c), high - 1, from, to),
      );
      proposals.push({ ...r, kind: 'outline', window });
      if (proposals.length > 4000) throw Error('候选墙段过多，请裁剪图纸后重试');
    }
  const merged = mergeBands(proposals);
  const unique = merged.filter(
    (a, i) =>
      !merged.some(
        (b, j) =>
          i !== j &&
          a.kind === b.kind &&
          a.x >= b.x &&
          a.y >= b.y &&
          endX(a) <= endX(b) &&
          endY(a) <= endY(b) &&
          (a.w * a.h < b.w * b.h || j < i),
      ),
  );
  if (unique.length > 3000) throw Error('候选墙段过多，请裁剪图纸后重试');
  // Observed edges and corner endpoints define rectangular cuts. Candidate wall
  // bands are classified by thickness / ink density / parallel edges / connectivity.
  const initialGrid = partition([...lines, ...unique], w, h);
  const accepted = new Uint8Array(unique.length),
    seen = new Uint8Array(unique.length);
  for (let seed = 0; seed < unique.length; seed++) {
    if (seen[seed]) continue;
    const group = [seed];
    seen[seed] = 1;
    for (let head = 0; head < group.length; head++) {
      const a = unique[group[head]];
      for (let j = 0; j < unique.length; j++) {
        if (!seen[j] && (near(a, unique[j], 3) || gapBetween(a, unique[j], maxOpening))) {
          seen[j] = 1;
          group.push(j);
        }
      }
    }
    const members = group.map((i) => unique[i]),
      solid = members.some((s) => s.kind === 'solid');
    const spanX = Math.max(...members.map(endX)) - Math.min(...members.map((s) => s.x));
    const spanY = Math.max(...members.map(endY)) - Math.min(...members.map((s) => s.y));
    const network =
      members.length >= 4 &&
      members.some((s) => s.axis === 'h') &&
      members.some((s) => s.axis === 'v') &&
      Math.min(spanX, spanY) > maxThickness * 2 &&
      spanX * spanY > w * h * Math.max(0.01, opt.minArea);
    if (solid || network) for (const i of group) accepted[i] = 1;
  }
  const structural = unique.filter((_, i) => accepted[i]);
  const shortEdges = [
    ...edgeStrokes(grayValues, w, h, 'h', 7, opt.threshold),
    ...edgeStrokes(grayValues, w, h, 'v', 7, opt.threshold),
  ];
  // Short hollow T/L jambs are below the main wall length threshold. Recover only
  // capped double-line bands touching a perpendicular structural wall.
  const stubs: Proposal[] = [];
  const capSupport = (axis: 'h' | 'v', at: number, low: number, high: number) => {
    let hits = 0;
    for (let c = low; c < high; c++) {
      let found = false;
      for (let k = -1; k <= 1; k++) {
        const x = axis === 'h' ? at + k : c,
          y = axis === 'h' ? c : at + k;
        if (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]) found = true;
      }
      if (found) hits++;
    }
    return hits / (high - low);
  };
  const short = shortEdges.filter((s) => length(s) < minLength + 4);
  for (const a of short)
    for (const b of shortEdges) {
      if (a === b || a.axis !== b.axis) continue;
      const low = Math.min(cross(a), cross(b)),
        high = Math.max(cross(a), cross(b)) + 1,
        width = high - low;
      if (width < minThickness + 1 || width > hollowLimit) continue;
      let from = Math.max(start(a), start(b)),
        to = Math.min(start(a) + length(a), start(b) + length(b));
      if (to - from < Math.max(6, width * 1.6) || to - from > minLength + 4) continue;
      const exactCap = (at: number) => {
        let hits = 0;
        for (let c = low; c < high; c++) {
          const x = a.axis === 'h' ? at : c,
            y = a.axis === 'h' ? c : at;
          if (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]) hits++;
        }
        return hits / (high - low);
      };
      if (exactCap(from - 1) > 0.7) from--;
      if (exactCap(to) > 0.7) to++;
      const r: Proposal = { ...makeRect(a.axis, from, to, low, high), kind: 'outline', window: false };
      if (!structural.some((s) => s.axis !== r.axis && near(s, r, 3))) continue;
      if (capSupport(a.axis, from, low, high) < 0.7 && capSupport(a.axis, to - 1, low, high) < 0.7) continue;
      if (
        [...structural, ...stubs].some(
          (s) =>
            s.axis === r.axis &&
            near(s, r, 0) &&
            Math.max(0, overlap(r.x, endX(r), s.x, endX(s))) *
              Math.max(0, overlap(r.y, endY(r), s.y, endY(s))) >
              r.w * r.h * 0.8,
        )
      )
        continue;
      stubs.push(r);
    }
  structural.push(...stubs);
  // Continuous hollow T/L returns have no line across the stem. Recover their
  // outer cap, side caps and visible shoulders, excluding the stem interior.
  // Its arms can be only 2–4 pixels long, below the generic edge-length filter.
  const lineEvidence = (axis: 'h' | 'v', from: number, to: number, c: number) => {
    let hits = 0,
      contrast = 0;
    const pixel = (p: number, q: number) => {
      const x = axis === 'h' ? p : q,
        y = axis === 'h' ? q : p;
      return x >= 0 && y >= 0 && x < w && y < h ? grayValues[y * w + x] : 255;
    };
    for (let p = from; p < to; p++) {
      const value = pixel(p, c);
      if (value < opt.threshold) hits++;
      contrast += Math.max(0, Math.min(pixel(p, c - 2), pixel(p, c + 2)) - value);
    }
    return to > from && hits / (to - from) >= 0.65 ? contrast / (to - from) : 0;
  };
  const heads: Proposal[] = [];
  for (const stem of structural.filter((s) => !s.window && length(s) >= minLength)) {
    const axis = stem.axis === 'h' ? 'v' : 'h',
      stemLo = cross(stem),
      stemHi = stemLo + thickness(stem);
    for (const side of [1, -1]) {
      const tip = side === 1 ? start(stem) : start(stem) + length(stem) - 1;
      let best: { wall: Proposal; score: number } | undefined;
      for (const cap of shortEdges) {
        if (cap.axis !== axis) continue;
        const at = cross(cap),
          offset = (at - tip) * side;
        if (offset > 2 || offset < -hollowLimit) continue;
        // A long confirmed wall can continue past a stem by only a few pixels
        // (e.g. the kitchen jamb). Its full outer edge is not a short stroke.
        // Require that the long part is already structural before extending it.
        if (
          length(cap) > Math.max(minLength + 4, thickness(stem) * 8) &&
          !structural.some(
            (s) =>
              s.axis === axis &&
              !s.window &&
              at >= cross(s) - 1 &&
              at <= cross(s) + thickness(s) &&
              overlap(start(s), start(s) + length(s), start(cap), start(cap) + length(cap)) >=
                length(cap) - Math.max(hollowLimit, thickness(stem) * 2),
          )
        )
          continue;
        // An L has one flush side. Only a T requires shoulders on both sides.
        if (start(cap) > stemLo + 1 || start(cap) + length(cap) < stemHi - 1) continue;
        for (let depth = minThickness + 1; depth <= hollowLimit; depth++) {
          const shoulder = at + side * (depth - 1);
          if (Math.abs(shoulder - tip) > 4) continue;
          const low = Math.min(at, shoulder),
            high = Math.max(at, shoulder) + 1;
          // Side caps locate the actual ends even when a blurred horizontal
          // ridge stops one pixel short of its corner.
          const locateEnd = (around: number) =>
            [-1, 0, 1]
              .map((delta) => {
                const p = around + delta;
                return { p, score: lineEvidence(stem.axis, low + 1, high - 1, p) };
              })
              .sort((a, b) => b.score - a.score || Math.abs(a.p - around) - Math.abs(b.p - around))[0];
          const left = locateEnd(start(cap)),
            right = locateEnd(start(cap) + length(cap) - 1);
          const leftArm = stemLo - left.p >= 2,
            rightArm = right.p + 1 - stemHi >= 2;
          if ((!leftArm && !rightArm) || left.p > stemLo + 1 || right.p + 1 < stemHi - 1) continue;
          const evidence = [
            left.score,
            right.score,
            lineEvidence(axis, left.p, right.p + 1, at),
            ...(leftArm ? [lineEvidence(axis, left.p + 1, stemLo, shoulder)] : []),
            ...(rightArm ? [lineEvidence(axis, stemHi, right.p, shoulder)] : []),
          ];
          if (evidence.some((score) => score < 6)) continue;
          const score = evidence.reduce((sum, v) => sum + v, 0);
          if (!best || score > best.score)
            best = {
              score,
              wall: { ...makeRect(axis, left.p, right.p + 1, low, high), kind: 'outline', window: false },
            };
        }
      }
      if (
        best &&
        ![...structural, ...heads].some(
          (s) =>
            s.axis === axis &&
            s.x <= best!.wall.x &&
            s.y <= best!.wall.y &&
            endX(s) >= endX(best!.wall) &&
            endY(s) >= endY(best!.wall),
        )
      )
        heads.push(best.wall);
    }
  }
  for (const head of heads) {
    // Merge the recovered corner with its existing arm. Scan blur may shift
    // the cap endpoint by one pixel; don't leave two overlapping editable walls.
    for (let i = structural.length - 1; i >= 0; i--) {
      const s = structural[i];
      if (
        !s.window &&
        s.axis === head.axis &&
        s.kind === 'outline' &&
        Math.abs(cross(s) - cross(head)) <= 1 &&
        Math.abs(cross(s) + thickness(s) - cross(head) - thickness(head)) <= 1 &&
        overlap(start(s), start(s) + length(s), start(head), start(head) + length(head)) >=
          Math.min(length(s), length(head)) * 0.8
      ) {
        Object.assign(
          head,
          makeRect(
            head.axis,
            Math.min(start(s), start(head)),
            Math.max(start(s) + length(s), start(head) + length(head)),
            cross(head),
            cross(head) + thickness(head),
          ),
        );
        structural.splice(i, 1);
      }
    }
    structural.push(head);
  }
  const bridges: Proposal[] = [],
    openings: RecognizedOpening[] = [];
  const windowBands: Proposal[] = [];
  for (const wall of structural.filter((s) => s.window)) {
    // Split glazing at filled piers. An outline across several adjacent windows
    // must not cut a continuous opening through the intervening structural wall.
    let from = -1;
    for (let p = start(wall); p <= start(wall) + length(wall); p++) {
      const glass =
        p < start(wall) + length(wall) &&
        solidDensity(makeRect(wall.axis, p, p + 1, cross(wall), cross(wall) + thickness(wall))) < 0.6;
      if (glass && from < 0) from = p;
      if (!glass && from >= 0) {
        if (p - from >= minLength)
          windowBands.push({
            ...wall,
            ...makeRect(wall.axis, from, p, cross(wall), cross(wall) + thickness(wall)),
          });
        from = -1;
      }
    }
  }
  const glazing: Proposal[] = [];
  for (const s of windowBands.sort((a, b) => length(b) - length(a))) {
    if (
      !glazing.some(
        (a) =>
          a.axis === s.axis &&
          Math.abs(cross(a) + thickness(a) / 2 - cross(s) - thickness(s) / 2) <=
            Math.max(thickness(a), thickness(s)) / 2 &&
          overlap(start(a), start(a) + length(a), start(s), start(s) + length(s)) >
            Math.min(length(a), length(s)) * 0.7,
      )
    )
      glazing.push(s);
  }
  for (const wall of glazing) openings.push({ ...centerline(wall), type: 'window', evidence: 'parallel' });
  const isWindowEndCap = (s: Proposal) =>
    s.kind === 'outline' &&
    glazing.some(
      (glass) =>
        glass.axis !== s.axis &&
        overlap(s.x, endX(s), glass.x, endX(glass)) >= s.w * 0.85 &&
        overlap(s.y, endY(s), glass.y, endY(glass)) >= s.h * 0.85,
    );
  const backedByReturn = (gap: Stroke) =>
    structural.some((s) => {
      if (s.axis !== gap.axis || s.window) return false;
      const separation = Math.max(
        cross(s) - cross(gap) - thickness(gap),
        cross(gap) - cross(s) - thickness(s),
      );
      return (
        separation >= 0 &&
        separation <= Math.min(length(gap) * 0.5, Math.max(thickness(s) * 1.5, thickness(gap) * 2)) &&
        overlap(start(s), start(s) + length(s), start(gap), start(gap) + length(gap)) >= length(gap) * 0.7
      );
    });
  const gaps: Stroke[] = [];
  for (let i = 0; i < structural.length; i++)
    for (let j = i + 1; j < structural.length; j++) {
      const gap =
        gapBetween(structural[i], structural[j], Math.max(2, maxOpening)) ||
        cornerGap(structural[i], structural[j], Math.max(2, maxOpening)) ||
        cornerGap(structural[j], structural[i], Math.max(2, maxOpening));
      if (!gap) continue;
      // A window's short end cap can line up with a wall below the window.
      // If a nearby continuous return already closes this side, extending the
      // cap would invent both a door and a partition inside the window recess.
      // Keep genuinely open passages and explicit swing symbols eligible.
      if (
        [structural[i], structural[j]].some((s) => s.axis === gap.axis && isWindowEndCap(s)) &&
        backedByReturn(gap)
      ) {
        const axis = centerline(gap);
        if (!recognizeDoorDirection(axis.a, axis.b, axis.width, mask, w, h)) continue;
      }
      gaps.push(gap);
    }
  // Do not bridge through a nearer collinear wall to a farther perpendicular
  // wall: that would suppress the real, shorter doorway during deduplication.
  for (const gap of gaps) {
    if (
      structural.some(
        (s) =>
          s.axis === gap.axis &&
          overlap(cross(s), cross(s) + thickness(s), cross(gap), cross(gap) + thickness(gap)) >=
            Math.min(thickness(s), thickness(gap)) * 0.65 &&
          overlap(start(s), start(s) + length(s), start(gap), start(gap) + length(gap)) >
            Math.max(2, thickness(gap) * 0.25),
      )
    )
      continue;
    const covered = structural.some(
      (s) =>
        overlap(gap.x, endX(gap), s.x, endX(s)) * overlap(gap.y, endY(gap), s.y, endY(s)) >=
          gap.w * gap.h * 0.5 && near(gap, s, 0),
    );
    if (
      covered ||
      bridges.some(
        (s) =>
          s.axis === gap.axis &&
          near(s, gap, 0) &&
          overlap(gap.x, endX(gap), s.x, endX(s)) * overlap(gap.y, endY(gap), s.y, endY(s)) >
            Math.min(gap.w * gap.h, s.w * s.h) * 0.7,
      )
    )
      continue;
    const bridge: Proposal = { ...gap, kind: 'bridge', window: false };
    bridges.push(bridge);
    if (length(gap) >= Math.max(minLength, thickness(gap) * 1.5) && solidDensity(gap) < 0.15) {
      bridge.openingIndex = openings.length;
      const axis = centerline(gap),
        direction = recognizeDoorDirection(axis.a, axis.b, axis.width, mask, w, h);
      openings.push({
        ...axis,
        ...direction,
        type: 'door',
        evidence: direction ? 'arc' : 'gap',
      });
    }
  }
  const xs = [...new Set([...initialGrid.xs, ...bridges.flatMap((r) => [r.x, endX(r)])])].sort(
    (a, b) => a - b,
  );
  const ys = [...new Set([...initialGrid.ys, ...bridges.flatMap((r) => [r.y, endY(r)])])].sort(
    (a, b) => a - b,
  );
  const bay = recognizeBayWindows(openings, [...structural, ...bridges], lines);
  const finalXs = [...new Set([...xs, ...bay.walls.flatMap((r) => [r.x, endX(r)])])].sort((a, b) => a - b);
  const finalYs = [...new Set([...ys, ...bay.walls.flatMap((r) => [r.y, endY(r)])])].sort((a, b) => a - b);
  const grid = { xs: finalXs, ys: finalYs, cellCount: (finalXs.length - 1) * (finalYs.length - 1) };
  const walls = bay.walls,
    rooms = findRooms(grid, walls, w, h, Math.max(0, opt.minArea));
  const warnings: string[] = [];
  if (!rooms.length)
    warnings.push('未形成封闭房间：检查墙体预览，调整阈值、墙厚范围或门洞跨度，也可手动补墙。');
  if (openings.some((o) => o.evidence === 'gap'))
    warnings.push('虚线门洞仅根据墙段断口推测，可能是开放通道，请核对后导入。');
  warnings.push('适合横平竖直的平面图；门窗类型、承重属性和房间名称需人工核对。');
  const featureOpenings = recognizeBalconyDoors(walls, bay.openings, rooms);
  const shafts = recognizeShafts(shortEdges, walls, rooms, mask, w, h, opt.mmPerPixel);
  const pipes = recognizePipes(
    mask,
    w,
    h,
    walls,
    rooms,
    opt.mmPerPixel,
    opt.pipeSettings,
    grayValues,
    opt.threshold,
  );
  if (pipes.length)
    warnings.push('圆形竖管符号的用途待核对；管径按当前比例估算并匹配外径预设，示意符号可能不按比例绘制。');
  if (featureOpenings.some((o) => o.evidence === 'balcony'))
    warnings.push('阳台推拉门按轨道与两侧空间推测，请核对门窗用途。');
  if (shafts.length) warnings.push('烟道候选来自墙边封闭小框；可能与管井或柜体相似，请核对。');
  return {
    rooms,
    walls: walls.map(({ x, y, w, h, kind, openingIndex }) => ({
      x,
      y,
      w,
      h,
      kind,
      openingIndex,
      ...(opt.mmPerPixel
        ? { widthMm: matchWallThickness(Math.min(w, h) * opt.mmPerPixel, opt.wallSettings) }
        : {}),
    })),
    openings: fitDetectedDoors(featureOpenings, walls, opt.mmPerPixel, opt.doorSettings),
    shafts,
    pipes,
    grid,
    warnings,
  };
}
export function recognize(rgba: Uint8ClampedArray, w: number, h: number, opt: RecognitionOptions) {
  return analyzeFloorplan(rgba, w, h, opt).rooms;
}
