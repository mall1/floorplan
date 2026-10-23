import type { Point, Project } from './types';
import { matchWallThickness, DEFAULT_WALL_SETTINGS } from './wall-presets';
/** Uniform plan calibration. Product sizes and vertical heights remain specified in mm. */
export function calibrateProject(p: Project, factor: number, anchor: Point) {
  if (!Number.isFinite(factor) || factor < 0.05 || factor > 20) throw Error('校准比例需在 0.05–20 倍之间');
  const map = ([x, y]: Point): Point => [
    anchor[0] + (x - anchor[0]) * factor,
    anchor[1] + (y - anchor[1]) * factor,
  ];
  const settings = p.reference?.wallSettings ?? DEFAULT_WALL_SETTINGS;
  const width = (v: number) => matchWallThickness(v * factor, settings);
  p.rooms.forEach((r) => {
    r.poly = r.poly.map(map);
    r.wallWidth = width(r.wallWidth);
    if (r.edgeWidths)
      for (const key of Object.keys(r.edgeWidths)) r.edgeWidths[key] = width(r.edgeWidths[key]);
    r.flooring.origin = map(r.flooring.origin);
  });
  p.walls.forEach((w) => {
    w.a = map(w.a);
    w.b = map(w.b);
    w.width = width(w.width);
  });
  p.openings.forEach((o) => {
    o.a = map(o.a);
    o.b = map(o.b);
    o.width *= factor;
    if (o.bayDepth !== undefined) o.bayDepth *= factor;
    if (o.jambStart !== undefined) o.jambStart *= factor;
    if (o.jambEnd !== undefined) o.jambEnd *= factor;
  });
  p.shafts.forEach((s) => {
    s.poly = s.poly.map(map);
  });
  p.routes.forEach((r) => {
    r.points = r.points.map(map);
  });
  p.devices.forEach((d) => {
    [d.x, d.y] = map([d.x, d.y]);
  });
  p.furniture.forEach((f) => {
    [f.cx, f.cy] = map([f.cx, f.cy]);
  });
  p.measures.forEach((m) => {
    m.a = map(m.a);
    m.b = map(m.b);
  });
  p.globalFlooring.origin = map(p.globalFlooring.origin);
  if (p.reference) {
    [p.reference.x, p.reference.y] = map([p.reference.x, p.reference.y]);
    p.reference.width *= factor;
    p.reference.calibrated = true;
  }
}
