import { describe, expect, it } from 'vitest';
import { allWalls, rect } from '../src/model/geometry';
import { parseProject, emptyProject } from '../src/model/project';
import { wallAreaCsv, wallAreaReport } from '../src/model/wall-area';
import { wallAreaFixture } from './fixtures/wall-area';
import type { Point } from '../src/model/types';

describe('room and whole-home wall finish estimates', () => {
  it('counts each interior face once and deducts a shared door from both rooms', () => {
    const report = wallAreaReport(wallAreaFixture());
    expect(report.rooms[0].gross).toBeCloseTo(39.2);
    expect(report.rooms[0].deduction).toBeCloseTo(3.69);
    expect(report.rooms[0].net).toBeCloseTo(35.51);
    expect(report.rooms[1].net).toBeCloseTo(31.71);
    expect(report.total.net).toBeCloseTo(67.22);
    expect(report.total.purchase).toBeCloseTo(73.942);
    expect(report.unassignedLength).toBe(0);
  });
  it('keeps independent selection and per-room height overrides in saved projects', () => {
    const p = wallAreaFixture();
    p.wallFinish = { height: 3000, waste: 15 };
    p.rooms[0].wallFinish = { height: 2500, included: true };
    p.rooms[0].counted = false; // Flooring selection must not change wall finish selection.
    p.rooms[1].wallFinish = { included: false };
    const saved = parseProject(JSON.parse(JSON.stringify(p)));
    expect(saved).toEqual(p);
    const r = wallAreaReport(saved);
    expect(r.rooms[0].net).toBeCloseTo(31.31);
    expect(r.rooms[1].gross).toBeCloseTo(36);
    expect(r.total.net).toBeCloseTo(31.31);
    expect(r.total.purchase).toBeCloseTo(31.31 * 1.15);
    p.rooms[0].wallFinish.included = false;
    expect(wallAreaReport(p).total).toEqual({ gross: 0, deduction: 0, net: 0, purchase: 0 });
  });
  it('uses individual model wall heights by default, including low walls', () => {
    const p = wallAreaFixture();
    p.walls = allWalls(p);
    p.rooms.forEach((r) => (r.boundary = false));
    p.walls.find((w) => w.id === 'bedroom:edge:0')!.height = 1000;
    const report = wallAreaReport(p);
    expect(report.rooms[0].gross).toBeCloseTo(32);
    // Only the first 100 mm of the window is below the top of this wall.
    expect(report.rooms[0].deduction).toBeCloseTo(1.89 + 0.15);
  });
  it('clips deductions to height and span and unions overlapping apertures in both dimensions', () => {
    const p = wallAreaFixture();
    p.rooms = p.rooms.slice(0, 1);
    p.openings = [
      { ...p.openings[1], a: [1000, 0], b: [3000, 0], sill: 0, height: 1000 },
      { ...p.openings[1], id: 'upper', a: [2000, 0], b: [5000, 0], sill: 2000, height: 5000 },
      { ...p.openings[1], id: 'duplicate', a: [1000, 0], b: [3000, 0], sill: 0, height: 1000 },
    ];
    const result = wallAreaReport(p);
    expect(result.total.deduction).toBeCloseTo(2 + 1.6);
    p.wallFinish = { height: 500, waste: 0 };
    expect(wallAreaReport(p).total.deduction).toBeCloseTo(1);
  });
  it('removes the full railing span, ignores thresholds and respects door jamb reserves', () => {
    const p = wallAreaFixture();
    p.rooms = p.rooms.slice(0, 1);
    p.openings = [
      { ...p.openings[0], jambStart: 100, jambEnd: 50 },
      { ...p.openings[1], type: 'railing' },
      { ...p.openings[1], id: 'threshold', type: 'threshold', a: [1000, 3000], b: [2000, 3000] },
    ];
    expect(wallAreaReport(p).total.deduction).toBeCloseTo(0.75 * 2.1 + 1.5 * 2.8);
  });
  it('does not invent walls across open passages and includes both faces of internal partitions', () => {
    const p = wallAreaFixture();
    p.rooms = p.rooms.slice(0, 1);
    p.rooms[0].boundary = false;
    p.openings = [];
    p.walls = [
      { id: 'left', a: [0, 0], b: [1500, 0], width: 200, height: 2800, bearing: false },
      { id: 'right', a: [2500, 0], b: [4000, 0], width: 200, height: 2800, bearing: false },
      { id: 'partition', a: [1000, 1500], b: [3000, 1500], width: 100, height: 2000, bearing: false },
    ];
    expect(wallAreaReport(p).total.net).toBeCloseTo(3 * 2.8 + 2 * 2 * 2);
  });
  it('clips imported wall axes to room faces and merges reversed overlapping wall fragments', () => {
    const p = wallAreaFixture();
    p.rooms = p.rooms.slice(0, 1);
    p.walls = allWalls(p);
    p.rooms[0].boundary = false;
    p.rooms[0].poly = rect([100, 100], [3900, 2900]);
    p.openings = [];
    p.walls.push({ ...p.walls[0], id: 'overlap', a: [3000, 0], b: [1000, 0] });
    expect(wallAreaReport(p).total.net).toBeCloseTo(2 * (3.8 + 2.8) * 2.8);
  });
  it('clips walls crossing a concave room into separate interior intervals', () => {
    const p = wallAreaFixture();
    p.rooms = p.rooms.slice(0, 1);
    p.rooms[0].boundary = false;
    p.rooms[0].poly = [
      [0, 0],
      [4000, 0],
      [4000, 3000],
      [3000, 3000],
      [3000, 1000],
      [1000, 1000],
      [1000, 3000],
      [0, 3000],
    ];
    p.openings = [];
    p.walls = [{ id: 'cross', a: [-1000, 2000], b: [5000, 2000], width: 100, height: 2800, bearing: false }];
    const r = wallAreaReport(p);
    expect(r.total.net).toBeCloseTo(2 * 2 * 2.8);
    expect(r.unassignedLength).toBeCloseTo(4);
  });
  it('keeps diagonal room results invariant under rotation and reversed winding', () => {
    const p = wallAreaFixture(),
      expected = wallAreaReport(p).total.net;
    const rotate = ([x, y]: Point): Point => [(x - y) / Math.sqrt(2), (x + y) / Math.sqrt(2)];
    p.rooms.forEach((r) => (r.poly = r.poly.map(rotate).reverse()));
    p.openings.forEach((o) => {
      o.a = rotate(o.a);
      o.b = rotate(o.b);
    });
    expect(wallAreaReport(p).total.net).toBeCloseTo(expected);
  });
  it('does not deduct an unrelated nearby window from another parallel wall', () => {
    const p = wallAreaFixture();
    p.rooms = p.rooms.slice(0, 1);
    p.walls = [{ id: 'inside', a: [1000, 350], b: [2500, 350], width: 100, height: 2800, bearing: false }];
    expect(wallAreaReport(p).total.net).toBeCloseTo(35.51 + 1.5 * 2 * 2.8);
  });
  it('exports per-room and selected totals, escapes names and works with old or empty projects', () => {
    expect(wallAreaReport(emptyProject()).total.net).toBe(0);
    const p = parseProject(wallAreaFixture());
    expect(p.wallFinish).toBeUndefined();
    p.rooms[0].name = '=SUM(1,2)"卧室';
    const csv = wallAreaCsv(wallAreaReport(p));
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain('"\'=SUM(1,2)""卧室"');
    expect(csv).toContain('"全屋合计（已勾选房间）","","","72.80","5.58","67.22","10","73.94"');
    p.wallFinish = { height: -100, waste: 10 };
    expect(() => parseProject(p)).toThrow();
  });
});
