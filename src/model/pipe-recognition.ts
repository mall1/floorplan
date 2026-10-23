import type { Point, PipeRecognitionSettings } from './types';
import type { ImageRect } from './recognition';
import { inside } from './geometry';
import { matchPipeDiameter } from './pipe-presets';

export interface RecognizedPipe {
  x: number;
  y: number;
  diameterPixels: number;
  measuredDiameter: number;
  diameter: number;
  pipeSystem: 'unknown' | 'drain' | 'water';
  selected: boolean;
}

/** Small enclosed circular holes work even when a pipe ring touches a wall.
 * Angular roundness rejects square shafts; interior and wall proximity reject
 * most dimension text. Purpose cannot reliably be read from a circle alone. */
function ringHoles(
  mask: Uint8Array,
  w: number,
  h: number,
  walls: ImageRect[],
  rooms: { poly: Point[] }[],
  mmPerPixel = 1,
  settings?: PipeRecognitionSettings,
): RecognizedPipe[] {
  const seen = new Uint8Array(mask.length),
    queue = new Int32Array(mask.length),
    result: RecognizedPipe[] = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (seen[seed] || mask[seed]) continue;
    let head = 0,
      tail = 1,
      left = w,
      top = h,
      right = 0,
      bottom = 0,
      sx = 0,
      sy = 0,
      border = false;
    queue[0] = seed;
    seen[seed] = 1;
    while (head < tail) {
      const i = queue[head++],
        x = i % w,
        y = Math.floor(i / w);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      sx += x;
      sy += y;
      if (!x || !y || x === w - 1 || y === h - 1) border = true;
      for (const j of [x ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y ? i - w : -1, y + 1 < h ? i + w : -1])
        if (j >= 0 && !mask[j] && !seen[j]) {
          seen[j] = 1;
          queue[tail++] = j;
        }
    }
    const bw = right - left + 1,
      bh = bottom - top + 1;
    if (
      border ||
      tail < 3 ||
      tail > 1000 ||
      bw < 2 ||
      bh < 2 ||
      bw > 36 ||
      bh > 36 ||
      bw / bh < 0.6 ||
      bw / bh > 1.67
    )
      continue;
    const x = sx / tail,
      y = sy / tail;
    if (!rooms.some((r) => inside([x, y], r.poly))) continue;
    const wallDistance = Math.min(
      ...walls.map((r) =>
        Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w), Math.max(r.y - y, 0, y - r.y - r.h)),
      ),
    );
    if (wallDistance > Math.max(12, Math.max(bw, bh) * 3)) continue;
    const radii: number[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i * Math.PI) / 16;
      let radius = 0.5;
      for (; radius < 30; radius += 0.25) {
        const xx = Math.round(x + Math.cos(a) * radius),
          yy = Math.round(y + Math.sin(a) * radius);
        if (xx < 0 || xx >= w || yy < 0 || yy >= h || mask[yy * w + xx]) break;
      }
      radii.push(radius);
    }
    const mean = radii.reduce((s, v) => s + v, 0) / 32,
      deviation = Math.sqrt(radii.reduce((s, v) => s + (v - mean) ** 2, 0) / 32) / mean,
      cardinal = [0, 8, 16, 24].reduce((s, i) => s + radii[i], 0),
      diagonal = [4, 12, 20, 28].reduce((s, i) => s + radii[i], 0);
    if (deviation > (tail < 9 ? 0.25 : 0.2) || diagonal / cardinal > 1.22 || diagonal / cardinal < 0.78)
      continue;
    const diameterPixels = 2 * (mean + 0.75),
      measuredDiameter = Math.round(diameterPixels * mmPerPixel);
    // A rounded door-track end can enclose a tiny hole too. A pipe's centre
    // must stand clear of the wall band by at least part of its own radius.
    if (wallDistance < diameterPixels * 0.3) continue;
    if (measuredDiameter < 10 || measuredDiameter > 500) continue;
    result.push({
      x,
      y,
      diameterPixels,
      measuredDiameter,
      diameter: matchPipeDiameter(measuredDiameter, settings),
      pipeSystem: 'unknown',
      selected: true,
    });
    if (result.length >= 100) break;
  }
  return result;
}

export function recognizePipes(
  mask: Uint8Array,
  w: number,
  h: number,
  walls: ImageRect[],
  rooms: { poly: Point[] }[],
  mmPerPixel = 1,
  settings?: PipeRecognitionSettings,
  gray?: Uint8Array,
  threshold = 220,
): RecognizedPipe[] {
  const groups: RecognizedPipe[][] = [];
  const passes = [mask];
  // Blurred ring centres can be grey instead of white. Sweep local contrast
  // levels independently from wall extraction, retaining the same wall context.
  if (gray)
    for (const level of [150, 170, 185, 190, 195, 200, 205, 210, 215]) {
      if (level >= threshold) continue;
      passes.push(Uint8Array.from(gray, (v) => +(v < level)));
    }
  for (const pass of passes)
    for (const pipe of ringHoles(pass, w, h, walls, rooms, mmPerPixel, settings)) {
      const group = groups.find(
        (g) => Math.hypot(g[0].x - pipe.x, g[0].y - pipe.y) < Math.max(2, g[0].diameterPixels * 0.4),
      );
      if (group) group.push(pipe);
      else groups.push([pipe]);
    }
  return groups
    .map((g) => {
      g.sort((a, b) => a.diameterPixels - b.diameterPixels);
      return g[Math.floor(g.length / 2)];
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, 100);
}
