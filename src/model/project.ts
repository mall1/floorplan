import { z } from 'zod';
import { WALLS, WINS, DOORS, SLIDES, ROOMS, defaultFurniture } from '../data/original';
import { defaultFloor, FLOOR_PRESETS } from './presets';
import { validPolygon } from './geometry';
import { kindFromName } from './room-types';
import type { Point, Project } from './types';
const num = z.number().finite(),
  coord = num.min(-1000000).max(1000000),
  point = z.tuple([coord, coord]),
  color = z.string().regex(/^#[0-9a-f]{6}$/i),
  id = z.string().min(1).max(120),
  name = z.string().max(150);
const flooring = z.object({
  material: name,
  width: num.min(50).max(5000),
  length: num.min(50).max(10000),
  gap: num.min(0).max(30),
  pattern: z.enum(['straight', 'half', 'third', 'herringbone', 'diagonal']),
  angle: num.min(-360).max(360),
  origin: point,
  color,
  grout: color,
  price: num.min(0).max(100000),
  waste: num.min(0).max(100),
});
export const projectSchema = z
  .object({
    version: z.literal(2),
    name,
    analysis: z
      .object({
        flows: z.array(z.enum(['daily', 'housework', 'guest'])).max(3),
        showAreas: z.boolean(),
        showTypes: z.boolean(),
        clearance: num.min(300).max(1200),
      })
      .optional(),
    continuous: z.boolean(),
    globalFlooring: flooring,
    wallFinish: z
      .object({ height: num.min(100).max(10000).optional(), waste: num.min(0).max(100) })
      .optional(),
    rooms: z
      .array(
        z.object({
          id,
          name,
          kind: z
            .enum([
              'unknown',
              'living',
              'bedroom',
              'kitchen',
              'dining',
              'bathroom',
              'balcony',
              'laundry',
              'study',
              'storage',
              'hallway',
            ])
            .optional(),
          poly: z.array(point).min(3).max(300).refine(validPolygon, '房间轮廓面积过小或边线相交'),
          flooring,
          boundary: z.boolean(),
          counted: z.boolean(),
          wallWidth: num.min(50).max(1000),
          edgeWidths: z.record(z.string(), num.min(20).max(2000)).optional(),
          wallFinish: z
            .object({ included: z.boolean().optional(), height: num.min(100).max(10000).optional() })
            .optional(),
        }),
      )
      .max(200),
    walls: z
      .array(
        z.object({
          id,
          a: point,
          b: point,
          width: num.min(20).max(2000),
          bearing: z.boolean(),
          height: num.min(100).max(10000),
        }),
      )
      .max(2000),
    openings: z
      .array(
        z.object({
          id,
          type: z.enum(['door', 'window', 'threshold', 'railing']),
          railingHeight: num.min(300).max(2200).optional(),
          autoDepth: z.boolean().optional(),
          sill: num.min(0).max(5000).optional(),
          height: num.min(100).max(6000).optional(),
          windowStyle: z.enum(['flat', 'bay']).optional(),
          bayDepth: num.min(100).max(3000).optional(),
          baySide: z.union([z.literal(1), z.literal(-1)]).optional(),
          hinge: z.enum(['a', 'b']).optional(),
          swing: z.union([z.literal(1), z.literal(-1)]).optional(),
          openAngle: num.min(0).max(110).optional(),
          doorStyle: z.enum(['swing', 'sliding']).optional(),
          slideOpen: num.min(0).max(100).optional(),
          jambStart: num.min(0).max(1000).optional(),
          jambEnd: num.min(0).max(1000).optional(),
          a: point,
          b: point,
          width: num.min(20).max(2000),
          color,
        }),
      )
      .max(1000),
    shafts: z
      .array(
        z.object({
          id,
          name,
          poly: z
            .array(point)
            .length(4)
            .refine((p) => validPolygon(p.map(([x, y]) => [x * 10, y * 10])), '烟道轮廓无效'),
          height: num.min(100).max(10000),
        }),
      )
      .max(200)
      .default([]),
    furniture: z
      .array(
        z.object({
          id,
          type: name,
          name,
          cx: coord,
          cy: coord,
          w: num.min(10).max(20000),
          d: num.min(10).max(20000),
          rot: num.min(-360).max(360),
          color,
        }),
      )
      .max(2000),
    routes: z
      .array(
        z.object({
          id,
          kind: z.enum(['cold', 'hot', 'drain', 'power', 'weak']),
          points: z.array(point).min(2).max(500),
          circuit: name,
          diameter: num.min(1).max(1000),
          height: num.min(0).max(10000),
        }),
      )
      .max(1000),
    devices: z
      .array(
        z.object({
          id,
          kind: z.enum(['socket', 'switch', 'light', 'water', 'drain', 'network', 'panel', 'pipe']),
          diameter: num.min(10).max(1000).optional(),
          pipeSystem: z.enum(['drain', 'water', 'unknown']).optional(),
          x: coord,
          y: coord,
          height: num.min(0).max(10000),
          name,
          circuit: name,
          rotation: num.min(-360).max(360),
        }),
      )
      .max(2000),
    measures: z.array(z.object({ id, a: point, b: point })).max(1000),
    reference: z
      .object({
        src: z
          .string()
          .max(8000000)
          .regex(/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/),
        pixelWidth: num.positive().max(3000),
        pixelHeight: num.positive().max(3000),
        x: coord,
        y: coord,
        width: num.min(100).max(200000),
        rotation: num.min(-360).max(360),
        opacity: num.min(0).max(1),
        visible: z.boolean(),
        calibrated: z.boolean(),
        wallSettings: z
          .object({
            thin: num.min(50).max(1000),
            thick: num.min(50).max(1000),
            tolerance: num.min(0).max(200),
            enabled: z.boolean(),
          })
          .optional(),
        doorSettings: z
          .object({
            presetVersion: z.literal(2).optional(),
            enabled: z.boolean(),
            widths: z.array(num.min(300).max(6000)).min(1).max(20),
            slidingWidths: z.array(num.min(300).max(6000)).min(1).max(20),
            tolerance: num.min(0).max(300),
          })
          .optional(),
        pipeSettings: z
          .object({
            enabled: z.boolean(),
            diameters: z.array(num.min(10).max(1000)).min(1).max(30),
            tolerance: num.min(0).max(200),
          })
          .optional(),
      })
      .nullable(),
  })
  .superRefine((p, ctx) => {
    const ids = [
      ...p.rooms,
      ...p.walls,
      ...p.openings,
      ...p.shafts,
      ...p.furniture,
      ...p.routes,
      ...p.devices,
      ...p.measures,
    ].map((x) => x.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: '方案中存在重复 ID' });
  });
export function emptyProject(): Project {
  return {
    version: 2,
    name: '我的户型方案',
    rooms: [],
    walls: [],
    openings: [],
    shafts: [],
    furniture: [],
    routes: [],
    devices: [],
    measures: [],
    reference: null,
    continuous: false,
    globalFlooring: defaultFloor(),
  };
}
function wallRect(r: number[], i: number) {
  const [x0, y0, x1, y1] = r,
    horizontal = x1 - x0 > y1 - y0;
  return {
    id: `w${i}`,
    a: (horizontal ? [x0, (y0 + y1) / 2] : [(x0 + x1) / 2, y0]) as Point,
    b: (horizontal ? [x1, (y0 + y1) / 2] : [(x0 + x1) / 2, y1]) as Point,
    width: horizontal ? y1 - y0 : x1 - x0,
    bearing: false,
    height: 2800,
  };
}
export function demoProject(): Project {
  const p = emptyProject();
  p.name = '晴川居 · 三室两厅';
  p.rooms = ROOMS.map((r) => ({
    id: r.id,
    name: r.name,
    kind: kindFromName(r.name),
    poly: r.poly as Point[],
    flooring: structuredClone(FLOOR_PRESETS.find((v) => v.id === r.mat)?.value || defaultFloor()),
    boundary: false,
    counted: r.counted !== false,
    wallWidth: 200,
  }));
  p.walls = WALLS.map((r, i) => ({
    ...wallRect(r.slice(0, 4) as number[], i),
    bearing: r[4] === 'b',
    height: r[4] === 'low' ? 1000 : 2800,
  }));
  p.openings = [
    ...WINS.map((r, i) => ({ ...wallRect(r, i), id: `win${i}`, type: 'window' as const, color: '#9dbbc0' })),
    ...DOORS.map((r, i) => ({
      ...wallRect(r.rect, i),
      id: `door${i}`,
      type: 'door' as const,
      color: '#b99b77',
    })),
    ...SLIDES.map((r, i) => ({
      ...wallRect(r.rect, i),
      id: `slide${i}`,
      type: 'door' as const,
      doorStyle: 'sliding' as const,
      slideOpen: 0,
      color: '#b99b77',
    })),
  ];
  p.furniture = defaultFurniture();
  return projectSchema.parse(p);
}
export function parseProject(data: unknown): Project {
  if (data && typeof data === 'object' && !('version' in data) && 'furniture' in data) {
    const legacy = data as {
      furniture: unknown;
      rooms?: Record<string, { name?: string; mat?: string }>;
      demolished?: string[];
    };
    const p = demoProject();
    p.furniture = legacy.furniture as Project['furniture'];
    p.walls = p.walls.filter((w) => !legacy.demolished?.includes(w.id));
    for (const r of p.rooms) {
      const old = legacy.rooms?.[r.id];
      if (old?.name) {
        r.name = old.name;
        r.kind = kindFromName(old.name);
      }
      if (old?.mat)
        r.flooring = structuredClone(FLOOR_PRESETS.find((f) => f.id === old.mat)?.value || r.flooring);
    }
    return projectSchema.parse(p);
  }
  const p = projectSchema.parse(data);
  // Early v2 samples lost the sliding-door flag. Repair only the unchanged
  // sample openings; an explicit style or edited geometry belongs to the user.
  SLIDES.forEach((slide, i) => {
    const original = wallRect(slide.rect, i);
    const opening = p.openings.find((o) => o.id === `slide${i}`);
    if (
      opening?.type === 'door' &&
      opening.doorStyle === undefined &&
      opening.width === original.width &&
      opening.a.every((v, index) => v === original.a[index]) &&
      opening.b.every((v, index) => v === original.b[index])
    ) {
      opening.doorStyle = 'sliding';
      opening.slideOpen ??= 0;
    }
  });
  return p;
}
