import { bounds, inside } from './geometry';
import type { Point } from './types';
import type {
  ImageRect,
  RecognizedOpening,
  RecognizedShaft,
  RecognizedWall,
  RecognitionResult,
} from './recognition';
const overlap = (a: number, b: number, c: number, d: number) => Math.min(b, d) - Math.max(a, c);
export function recognizeBalconyDoors(
  walls: RecognizedWall[],
  openings: RecognizedOpening[],
  rooms: RecognitionResult['rooms'],
) {
  const result = openings.map((o) => ({ ...o }));
  const roomAt = (point: Point) => rooms.find((r) => inside(point, r.poly));
  for (const wall of walls) {
    if (wall.kind !== 'outline') continue;
    const horizontal = wall.w >= wall.h,
      len = horizontal ? wall.w : wall.h,
      thick = horizontal ? wall.h : wall.w;
    if (len < thick * 5) continue;
    const a: Point = horizontal ? [wall.x, wall.y + wall.h / 2] : [wall.x + wall.w / 2, wall.y];
    const b: Point = horizontal ? [wall.x + wall.w, a[1]] : [a[0], wall.y + wall.h];
    const middle: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      axis = horizontal ? 0 : 1,
      cross = horizontal ? 1 : 0;
    const p1: Point = [...middle],
      p2: Point = [...middle];
    p1[cross] += thick / 2 + 2;
    p2[cross] -= thick / 2 + 2;
    const r1 = roomAt(p1),
      r2 = roomAt(p2);
    if (!r1 || !r2 || r1 === r2) continue;
    const balcony = [r1, r2].some((room) => {
      const bb = bounds(room.poly),
        long = horizontal ? bb.w : bb.h,
        depth = horizontal ? bb.h : bb.w;
      if (long / depth < 2 || depth < thick * 3 || depth > long * 0.5) return false;
      return openings.some((o) => {
        if (o.type !== 'window' || o.windowStyle === 'bay' || Math.abs(o.a[cross] - o.b[cross]) > 1)
          return false;
        const c: Point = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
        if (
          Math.abs(c[cross] - middle[cross]) < depth * 0.65 ||
          Math.abs(c[cross] - middle[cross]) > depth + o.width + thick
        )
          return false;
        const first = horizontal ? bb.x : bb.y;
        if (
          overlap(Math.min(o.a[axis], o.b[axis]), Math.max(o.a[axis], o.b[axis]), first, first + long) <
          long * 0.45
        )
          return false;
        const u: Point = [...c],
          v: Point = [...c];
        u[cross] += o.width / 2 + 2;
        v[cross] -= o.width / 2 + 2;
        return (roomAt(u) === room && !roomAt(v)) || (roomAt(v) === room && !roomAt(u));
      });
    });
    if (!balcony) continue;
    const prior = result.find(
      (o) =>
        Math.abs(o.a[cross] - a[cross]) <= Math.max(thick, o.width) &&
        Math.abs(o.b[cross] - b[cross]) <= Math.max(thick, o.width) &&
        overlap(Math.min(o.a[axis], o.b[axis]), Math.max(o.a[axis], o.b[axis]), a[axis], b[axis]) >
          len * 0.65,
    );
    if (prior) {
      if (prior.windowStyle === 'bay') continue;
      Object.assign(prior, {
        type: 'door',
        doorStyle: 'sliding',
        evidence: 'balcony',
        windowStyle: undefined,
      });
    } else result.push({ type: 'door', doorStyle: 'sliding', evidence: 'balcony', a, b, width: thick });
  }
  return result;
}

/** Small closed hollow symbols near structural walls. Use short strokes, independent of room area filtering. */
export function recognizeShafts(
  edges: ImageRect[],
  walls: RecognizedWall[],
  rooms: RecognitionResult['rooms'],
  mask: Uint8Array,
  width: number,
  height: number,
  mmPerPixel?: number,
): RecognizedShaft[] {
  const minSide = mmPerPixel ? Math.max(7, 180 / mmPerPixel) : 10,
    maxSide = mmPerPixel ? Math.min(120, 1100 / mmPerPixel) : Math.min(width, height) * 0.13;
  // A corner shaft can share two sides with thick walls, which have no thin-line ridge.
  const wallFaces = walls
    .filter((r) => r.kind !== 'bridge' && r.h > r.w * 2)
    .flatMap((r) => [r.x, r.x + r.w - 1].map((x) => ({ x, y: r.y, w: 1, h: r.h })));
  const vertical = [...edges.filter((s) => s.h >= minSide && s.w <= 3).slice(0, 1500), ...wallFaces],
    out: RecognizedShaft[] = [];
  const ink = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.round(x) + dx,
          yy = Math.round(y) + dy;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height && mask[yy * width + xx]) return true;
      }
    return false;
  };
  const line = (a: Point, b: Point) => {
    const n = Math.max(6, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    let hits = 0;
    for (let i = 1; i < n; i++)
      if (ink(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n)) hits++;
    return hits / (n - 1);
  };
  for (let i = 0; i < vertical.length; i++)
    for (let j = i + 1; j < vertical.length; j++) {
      const a = vertical[i],
        b = vertical[j],
        x = Math.min(a.x, b.x),
        right = Math.max(a.x, b.x);
      let y = Math.max(a.y, b.y),
        bottom = Math.min(a.y + a.h, b.y + b.h);
      // Antialiasing and junctions often shorten a ridge by a few pixels.
      const supportedY = (at: number) =>
        Array.from({ length: 7 }, (_, k) => at + k - 3)
          .filter((v) => v >= 0 && v < height)
          .map((v) => ({ v, score: line([x, v], [right, v]) }))
          .sort((a, b) => b.score - a.score || Math.abs(a.v - at) - Math.abs(b.v - at))[0].v;
      if (right - x < minSide || right - x > maxSide || bottom - y < minSide - 6 || bottom - y > maxSide + 6)
        continue;
      y = supportedY(y);
      bottom = supportedY(bottom);
      const w = right - x,
        h = bottom - y;
      if (w < minSide || h < minSide || w > maxSide || h > maxSide || w / h < 0.45 || w / h > 2.2) continue;
      if (!rooms.some((r) => inside([x + w / 2, y + h / 2], r.poly))) continue;
      if (line([x, y], [right, y]) < 0.78 || line([x, bottom], [right, bottom]) < 0.78) continue;
      const near = walls.filter(
        (r) =>
          r.kind !== 'bridge' &&
          Math.max(r.x - x - w, x - r.x - r.w, r.y - y - h, y - r.y - r.h) <=
            Math.max(3, Math.min(r.w, r.h) * 0.65),
      );
      const nearH = near.some((r) => r.w > r.h * 2 && overlap(x, right, r.x, r.x + r.w) > w * 0.5),
        nearV = near.some((r) => r.h > r.w * 2 && overlap(y, bottom, r.y, r.y + r.h) > h * 0.5);
      if (!nearH && !nearV) continue;
      let pixels = 0,
        count = 0;
      for (let yy = Math.ceil(y + 3); yy < bottom - 3; yy++)
        for (let xx = Math.ceil(x + 3); xx < right - 3; xx++) {
          pixels += mask[yy * width + xx];
          count++;
        }
      if (count && pixels / count > 0.45) continue;
      const diagonal =
        line([x + 4, y + 4], [right - 4, bottom - 4]) > 0.7 &&
        line([right - 4, y + 4], [x + 4, bottom - 4]) > 0.7;
      out.push({
        x,
        y,
        w,
        h,
        evidence: diagonal ? 'cross' : nearH && nearV ? 'corner' : 'box',
        selected: diagonal || (nearH && nearV),
      });
    }
  return out
    .sort((a, b) => a.w * a.h - b.w * b.h)
    .filter(
      (r, i, all) =>
        !all
          .slice(0, i)
          .some(
            (a) =>
              Math.max(0, overlap(r.x, r.x + r.w, a.x, a.x + a.w)) *
                Math.max(0, overlap(r.y, r.y + r.h, a.y, a.y + a.h)) >
              Math.min(r.w * r.h, a.w * a.h) * 0.8,
          ),
    )
    .slice(0, 60);
}
