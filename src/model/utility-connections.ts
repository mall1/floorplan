import { distance, length } from './geometry';
import type { Point, Project, Route } from './types';

export function simplifyOrthogonal(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length && distance(out.at(-1)!, p) < 0.01) continue;
    const a = out.at(-2),
      b = out.at(-1);
    if (a && b && ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1]))) out.pop();
    out.push([...p]);
  }
  return out;
}
/** Keep attached endpoints aligned after a point moves. Edited routes become manual. */
export function syncUtilityConnections(next: Project) {
  const devices = new Map(next.devices.map((d) => [d.id, d]));
  next.routes = next.routes.filter(
    (r) =>
      !r.autoUtility ||
      ((!r.startDeviceId || devices.has(r.startDeviceId)) && (!r.endDeviceId || devices.has(r.endDeviceId))),
  );
  for (const r of next.routes) {
    if (!r.startDeviceId && !r.endDeviceId) continue;
    const points = r.points.map((p) => [...p] as Point);
    for (const end of ['startDeviceId', 'endDeviceId'] as const) {
      const id = r[end];
      if (!id) continue;
      const d = devices.get(id);
      if (!d) {
        delete r[end];
        continue;
      }
      const i = end === 'startDeviceId' ? 0 : points.length - 1;
      const old = r.points[i],
        at: Point = [d.x, d.y];
      if (distance(old, at) < 0.01) continue;
      const j = i === 0 ? 1 : i - 1;
      const horizontal = Math.abs(r.points[j][0] - old[0]) >= Math.abs(r.points[j][1] - old[1]);
      points[i] = at;
      if (points.length > 2) points[j][horizontal ? 1 : 0] = at[horizontal ? 1 : 0];
    }
    if (points.length === 2 && points[0][0] !== points[1][0] && points[0][1] !== points[1][1])
      points.splice(1, 0, [points[1][0], points[0][1]]);
    r.points = simplifyOrthogonal(points);
    if (r.points.length === 1) r.points.push([...r.points[0]]);
  }
}
export function detachUtilityRoute(r: Route) {
  delete r.startDeviceId;
  delete r.endDeviceId;
  delete r.autoUtility;
}
export function routeElevations(p: Project, r: Route): [number, number, number][] {
  const path: [number, number, number][] = r.points.map(([x, y]) => [x, r.height, y]);
  const start = p.devices.find((d) => d.id === r.startDeviceId),
    end = p.devices.find((d) => d.id === r.endDeviceId);
  if (start && start.kind !== 'pipe') path.unshift([r.points[0][0], start.height, r.points[0][1]]);
  if (end && end.kind !== 'pipe') path.push([r.points.at(-1)![0], end.height, r.points.at(-1)![1]]);
  return path;
}
export function routeLengths(p: Project, r: Route) {
  const vertices = routeElevations(p, r),
    plan = length(r.points) / 1000;
  let total = 0;
  for (let i = 1; i < vertices.length; i++)
    total += Math.hypot(...vertices[i].map((v, k) => v - vertices[i - 1][k]));
  return { plan, total: total / 1000, vertical: total / 1000 - plan };
}
