import { describe, expect, it } from 'vitest';
import { autoLayout } from '../src/model/auto-layout';
import { analyzeCirculation, navigationGrid } from '../src/model/circulation';
import { allWalls, distance, openingPolygon, rect } from '../src/model/geometry';
import { demoProject, emptyProject, parseProject } from '../src/model/project';
import { effectiveRoomKind, inferRoomKind, kindFromName } from '../src/model/room-types';
import { areaCsv, DEFAULT_ANALYSIS, spaceMetrics } from '../src/model/space-analysis';
import { furniturePolygon, polygonFits, polygonsOverlap, regionArea } from '../src/model/space-geometry';
import { analysisFixture, analysisFurniture, analysisRoom } from './fixtures/space-analysis';
import type { Point } from '../src/model/types';

describe('room use identification and persistence', () => {
  it('explains name, furniture and geometric suggestions without overriding a manual choice', () => {
    const p = emptyProject(),
      r = analysisRoom();
    p.rooms = [r];
    expect(kindFromName('主卧')).toBe('bedroom');
    expect(kindFromName('主卧飘窗')).toBe('unknown');
    expect(kindFromName('子女房飘窗')).toBe('unknown');
    expect(kindFromName('洗衣阳台')).toBe('laundry');
    expect(inferRoomKind(p, r)).toMatchObject({ kind: 'bedroom', confidence: 'low' });
    p.furniture = [analysisFurniture('toilet', 2000, 2000)];
    expect(inferRoomKind(p, r)).toMatchObject({ kind: 'bathroom', confidence: 'high' });
    r.kind = 'study';
    expect(effectiveRoomKind(p, r)).toBe('study');
    r.kind = 'unknown';
    expect(effectiveRoomKind(p, r)).toBe('unknown');
    delete r.kind;
    r.name = '厨房';
    expect(effectiveRoomKind(p, r)).toBe('kitchen');
  });
  it('uses plumbing evidence and preserves legacy projects and new settings on round trip', () => {
    const p = emptyProject(),
      r = analysisRoom('未命名', undefined, 0, 3000, 2000);
    p.rooms = [r];
    p.shafts = [{ id: 'shaft', name: '烟道', poly: rect([0, 0], [400, 400]), height: 2800 }];
    expect(inferRoomKind(p, r)).toMatchObject({ kind: 'kitchen', confidence: 'medium' });
    expect(parseProject(p)).toEqual(p);
    r.kind = 'laundry';
    p.analysis = { ...DEFAULT_ANALYSIS, flows: ['daily', 'guest'], showTypes: true };
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => parseProject({ ...p, analysis: { ...p.analysis, clearance: 0 } })).toThrow();
  });
});
describe('floor and storage area', () => {
  it('deduplicates overlap, clips items to rooms and shafts, and ignores wall mounted items and rugs', () => {
    const p = emptyProject(),
      r = analysisRoom();
    r.boundary = false;
    p.rooms = [r];
    p.shafts = [{ id: 'shaft', name: '烟道', poly: rect([0, 0], [1000, 1000]), height: 2800 }];
    p.furniture = [
      analysisFurniture('wardrobe', 1000, 1000, 2000, 2000),
      analysisFurniture('cabinet', 2000, 1000, 2000, 2000),
      analysisFurniture('bed', 4000, 3000, 2000, 2000),
      analysisFurniture('rug', 2000, 2000, 4000, 4000),
      analysisFurniture('acwall', 2000, 3000),
    ];
    expect(spaceMetrics(p)).toEqual({ net: 15, occupied: 7, free: 8, storage: 5 });
    p.rooms.push({ ...r, id: 'overlap' });
    expect(spaceMetrics(p).net).toBe(15);
    p.rooms.forEach((r) => (r.counted = false));
    expect(spaceMetrics(p).net).toBe(0);
  });
  it('subtracts wall footprints but retains the floor under a door opening', () => {
    const p = emptyProject();
    p.rooms = [analysisRoom()];
    expect(spaceMetrics(p).net).toBeCloseTo(3.8 * 3.8);
    p.openings = [{ id: 'door', type: 'door', a: [1500, 0], b: [2500, 0], width: 200, color: '#abcdef' }];
    expect(spaceMetrics(p).net).toBeCloseTo(3.8 * 3.8 + 0.1);
  });
  it('integrates rotated polygons and concave regions, including exact intersections', () => {
    const p = emptyProject();
    const r = analysisRoom();
    r.boundary = false;
    p.rooms = [r];
    const f = analysisFurniture('cabinet', 2000, 2000, 2000, 1000);
    f.rot = 37;
    p.furniture = [f];
    expect(spaceMetrics(p).storage).toBeCloseTo(2, 8);
    const concave: Point[] = [
      [0, 0],
      [4000, 0],
      [4000, 1000],
      [1000, 1000],
      [1000, 4000],
      [0, 4000],
    ];
    expect(regionArea([concave], [rect([500, 500], [2500, 2500])])).toBeCloseTo(5.25);
    const diamond: Point[] = [
      [0, 1000],
      [1000, 0],
      [2000, 1000],
      [1000, 2000],
    ];
    expect(regionArea([rect([0, 0], [1000, 2000])], [diamond])).toBeCloseTo(1);
    expect(polygonFits(rect([500, 500], [1500, 1500]), concave)).toBe(false);
  });
  it('exports all four metrics and safely quotes names', () => {
    const p = emptyProject();
    p.rooms = [analysisRoom('=SUM(1,2)')];
    const csv = areaCsv(p);
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain('"14.44","0.00","14.44","0.00"');
    expect(csv).toContain('全屋合计（空间去重）');
  });
  it('counts bathroom cabinets as storage without double-counting their footprint', () => {
    const p = emptyProject();
    p.rooms = [analysisRoom()];
    p.furniture = [analysisFurniture('vanity', 2000, 2000, 800, 500)];
    expect(spaceMetrics(p).storage).toBeCloseTo(0.4);
    expect(spaceMetrics(p).occupied).toBeCloseTo(0.4);
  });
});
describe('automatic room furnishing', () => {
  it('places a usable bedroom inside its walls without overlapping items or blocking door landings', () => {
    const p = analysisFixture(),
      r = p.rooms[0];
    const result = autoLayout(p, r, { compact: false, replace: false });
    expect(result.furniture.map((f) => f.type)).toEqual(
      expect.arrayContaining(['bed', 'wardrobe', 'nightstand']),
    );
    for (const [i, f] of result.furniture.entries()) {
      const poly = furniturePolygon(f);
      expect(polygonFits(poly, r.poly), f.type).toBe(true);
      for (const other of result.furniture.slice(i + 1))
        expect(polygonsOverlap(poly, furniturePolygon(other))).toBe(false);
      for (const w of allWalls(p))
        expect(polygonsOverlap(poly, openingPolygon(w.a, w.b, w.width))).toBe(false);
      for (const d of p.openings) expect(polygonsOverlap(poly, openingPolygon(d.a, d.b, 1000))).toBe(false);
    }
  });
  it('puts chairs at the table facing inward and office chairs at the desk', () => {
    const p = emptyProject(),
      r = analysisRoom('餐厅', 'dining', 0, 5000, 5000);
    p.rooms = [r];
    const result = autoLayout(p, r, { compact: false, replace: false });
    const table = result.furniture.find((f) => f.type === 'table')!,
      chairs = result.furniture.filter((f) => f.type === 'chair');
    expect(chairs).toHaveLength(4);
    for (const c of chairs) {
      const a = (c.rot * Math.PI) / 180;
      const toward = (table.cx - c.cx) * -Math.sin(a) + (table.cy - c.cy) * Math.cos(a);
      expect(toward / distance([table.cx, table.cy], [c.cx, c.cy])).toBeCloseTo(1);
    }
    r.kind = 'study';
    expect(autoLayout(p, r, { compact: true, replace: false }).furniture.map((f) => f.type)).toContain(
      'officechair',
    );
  });
  it('fills missing furniture, confines replacement to the selected room and leaves tiny rooms intact', () => {
    const p = analysisFixture(),
      r = p.rooms[0];
    p.furniture = [
      analysisFurniture('bed', 2000, 1200, 1500, 2000),
      analysisFurniture('sofa', 6500, 800, 2000, 700),
    ];
    const filled = autoLayout(p, r, { compact: true, replace: false });
    expect(filled.removed).toEqual([]);
    expect(filled.furniture.some((f) => f.type === 'bed')).toBe(false);
    const replaced = autoLayout(p, r, { compact: true, replace: true });
    expect(replaced.removed).toEqual([p.furniture[0].id]);
    r.poly = rect([1700, 900], [2300, 1500]);
    const tiny = autoLayout(p, r, { compact: false, replace: true });
    expect(tiny.furniture).toHaveLength(0);
    expect(tiny.removed).toHaveLength(0);
    expect(tiny.skipped.length).toBeGreaterThan(0);
  });
  it('never bridges a concave room notch', () => {
    const p = emptyProject(),
      r = analysisRoom('书房', 'study');
    r.poly = [
      [0, 0],
      [5000, 0],
      [5000, 1500],
      [2000, 1500],
      [2000, 5000],
      [0, 5000],
    ];
    p.rooms = [r];
    const result = autoLayout(p, r, { compact: true, replace: false });
    expect(result.furniture.length).toBeGreaterThan(0);
    for (const f of result.furniture) expect(polygonFits(furniturePolygon(f), r.poly)).toBe(true);
  });
});
describe('circulation paths', () => {
  it('routes all three scenarios through openings and never cuts through a wall', () => {
    const p = analysisFixture(),
      grid = navigationGrid(p)!;
    const result = analyzeCirculation(p, ['daily', 'housework', 'guest']);
    expect(new Set(result.paths.map((p) => p.kind)).size).toBe(3);
    expect(result.paths.length).toBeGreaterThanOrEqual(5);
    for (const path of result.paths) {
      expect(path.status, path.label).toBe('clear');
      for (let i = 1; i < path.points.length; i++)
        expect(grid.canSegment(path.points[i - 1], path.points[i], true)).toBe(true);
    }
  });
  it('reports furniture bottlenecks separately from missing doors and reacts to clearance', () => {
    const p = analysisFixture();
    p.rooms = p.rooms.slice(0, 2);
    p.openings = p.openings.slice(0, 2);
    p.furniture = [analysisFurniture('wardrobe', 3600, 2000, 600, 3800)];
    const blocked = analyzeCirculation(p, ['daily']).paths[0];
    expect(blocked.status).toBe('blocked');
    expect(blocked.bottleneck).toBeDefined();
    expect(blocked.points).toEqual([]);
    p.furniture = [];
    expect(analyzeCirculation(p, ['daily']).paths[0].status).toBe('clear');
    expect(analyzeCirculation(p, ['daily'], 1200).paths[0].status).toBe('unavailable');
    p.openings = [];
    expect(analyzeCirculation(p, ['daily']).paths[0].status).toBe('unavailable');
  });
  it('handles empty scenes and the furnished demo without invalid paths', () => {
    expect(analyzeCirculation(emptyProject(), ['daily']).paths).toEqual([]);
    const result = analyzeCirculation(demoProject(), ['daily', 'housework', 'guest']);
    expect(result.paths.length).toBeGreaterThan(5);
    expect(result.paths.some((p) => p.status === 'clear')).toBe(true);
    for (const path of result.paths) expect(Number.isFinite(path.distance)).toBe(true);
  });
  it('keeps rooms in circulation even when excluded from the area total', () => {
    const p = analysisFixture();
    p.rooms[0].counted = false;
    const paths = analyzeCirculation(p, ['daily']).paths;
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.status === 'clear')).toBe(true);
  });
});
