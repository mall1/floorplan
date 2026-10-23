import { bounds } from './geometry';
import type { Flooring, Point, Project, Room } from './types';
export function floorFor(p: Project, r: Room) {
  return p.continuous ? p.globalFlooring : r.flooring;
}
export function floorTransform(f: Flooring) {
  return f.angle + (f.pattern === 'diagonal' ? 45 : f.pattern === 'herringbone' ? 45 : 0);
}
/** Express the same world-space pattern in a rotated doorway's local frame. */
export function floorInFrame(f: Flooring, origin: Point, angle: number): Flooring {
  const radians = (angle * Math.PI) / 180,
    c = Math.cos(radians),
    s = Math.sin(radians);
  const x = f.origin[0] - origin[0],
    y = f.origin[1] - origin[1];
  return { ...f, angle: f.angle - angle, origin: [x * c + y * s, -x * s + y * c] };
}
export function tilePolygons(poly: Point[], f: Flooring, limit = 16000): Point[][] {
  const angle = (floorTransform(f) * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const local = poly.map(
    ([x, y]) =>
      [
        (x - f.origin[0]) * c + (y - f.origin[1]) * s,
        -(x - f.origin[0]) * s + (y - f.origin[1]) * c,
      ] as Point,
  );
  const b = bounds(local),
    out: Point[][] = [];
  const w = f.length + f.gap,
    h = f.width + f.gap;
  const world = (x: number, y: number): Point => [x * c - y * s + f.origin[0], x * s + y * c + f.origin[1]];
  const add = (x: number, y: number, ww: number, hh: number) => {
    if (out.length >= limit || x > b.x + b.w || y > b.y + b.h || x + ww < b.x || y + hh < b.y) return;
    const gap = f.gap / 2;
    out.push(
      [
        [x + gap, y + gap],
        [x + ww - gap, y + gap],
        [x + ww - gap, y + hh - gap],
        [x + gap, y + hh - gap],
      ].map(([x, y]) => world(x, y)),
    );
  };
  if (f.pattern === 'herringbone') {
    const ij = local.map(([x, y]) => [(x + y) / (2 * w), (y - x) / (2 * h)]);
    const i0 = Math.floor(Math.min(...ij.map((v) => v[0]))) - 2,
      i1 = Math.ceil(Math.max(...ij.map((v) => v[0]))) + 2;
    const j0 = Math.floor(Math.min(...ij.map((v) => v[1]))) - Math.ceil(w / h) - 2,
      j1 = Math.ceil(Math.max(...ij.map((v) => v[1]))) + Math.ceil(w / h) + 2;
    for (let i = i0; i <= i1 && out.length < limit; i++)
      for (let j = j0; j <= j1 && out.length < limit; j++) {
        const x = i * w - j * h,
          y = i * w + j * h;
        add(x, y, w, h);
        add(x + w, y, h, w);
      }
  } else {
    for (
      let row = Math.floor(b.y / h) - 1;
      row <= Math.ceil((b.y + b.h) / h) + 1 && out.length < limit;
      row++
    ) {
      const step = f.pattern === 'half' ? 2 : f.pattern === 'third' ? 3 : 1,
        offset = ((((row % step) + step) % step) * w) / step;
      for (
        let col = Math.floor((b.x - offset) / w) - 1;
        col <= Math.ceil((b.x + b.w - offset) / w) + 1 && out.length < limit;
        col++
      )
        add(col * w + offset, row * h, w, h);
    }
  }
  return out;
}
