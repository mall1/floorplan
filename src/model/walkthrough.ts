import { allWalls, bounds, inside, projectPoint, roomCenter, wallSegments } from './geometry';
import { resolvedOpening } from './architecture';
import type { Point, Project, Room } from './types';
export interface WalkObstacle {
  a: Point;
  b: Point;
  radius: number;
  solid?: Point[];
}
export function walkObstacles(p: Project): WalkObstacle[] {
  const walls = allWalls(p),
    openings = p.openings.map((o) => resolvedOpening(o, walls));
  return [
    ...openings.filter((o) => o.type === 'railing').map((o) => ({ a: o.a, b: o.b, radius: 170 })),
    ...p.devices
      .filter((d) => d.kind === 'pipe' && d.height > 200)
      .map((d) => ({
        a: [d.x, d.y] as Point,
        b: [d.x, d.y] as Point,
        radius: (d.diameter ?? 110) / 2 + 140,
      })),
    ...walls.flatMap((w) =>
      wallSegments(w, openings)
        .filter((s) => s.bottom < 1800 && s.top > 200)
        .map((s) => ({ a: s.a, b: s.b, radius: w.width / 2 + 140 })),
    ),
    ...p.shafts
      .filter((s) => s.height > 200)
      .flatMap((s) =>
        s.poly.map((a, i) => ({ a, b: s.poly[(i + 1) % s.poly.length], radius: 140, solid: s.poly })),
      ),
  ];
}
export const canWalk = (point: Point, obstacles: WalkObstacle[]) =>
  obstacles.every(
    (w) => (!w.solid || !inside(point, w.solid)) && projectPoint(point, w.a, w.b).distance >= w.radius,
  );
export function walkStep(from: Point, delta: Point, obstacles: WalkObstacle[]): Point {
  // Substeps prevent tunnelling. Sliding along an axis avoids getting stuck when moving diagonally into a wall.
  const count = Math.max(1, Math.ceil(Math.hypot(...delta) / 50));
  let at: Point = [...from];
  for (let i = 0; i < count; i++) {
    const dx = delta[0] / count,
      dy = delta[1] / count,
      next: Point = [at[0] + dx, at[1] + dy];
    if (canWalk(next, obstacles)) at = next;
    else {
      const x: Point = [at[0] + dx, at[1]];
      if (canWalk(x, obstacles)) at = x;
      const y: Point = [at[0], at[1] + dy];
      if (canWalk(y, obstacles)) at = y;
    }
  }
  return at;
}
export function walkStart(room: Room, obstacles: WalkObstacle[]): Point | null {
  const at = roomCenter(room.poly);
  if (canWalk(at, obstacles)) return at;
  const b = bounds(room.poly);
  for (let y = 1; y < 20; y++)
    for (let x = 1; x < 20; x++) {
      const p: Point = [b.x + (b.w * x) / 20, b.y + (b.h * y) / 20];
      if (inside(p, room.poly) && canWalk(p, obstacles)) return p;
    }
  return null;
}
