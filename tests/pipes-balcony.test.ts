import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { recognizeDoorDirection } from '../src/model/door-direction';
import { analyzeFloorplan } from '../src/model/recognition';
import { matchPipeDiameter, DEFAULT_PIPE_SETTINGS } from '../src/model/pipe-presets';
import { emptyProject, parseProject } from '../src/model/project';
import { wallSegments } from '../src/model/geometry';
import { canWalk, walkObstacles } from '../src/model/walkthrough';
import { calibrateProject } from '../src/model/calibration';
import { buildOpening } from '../src/render/architecture-models';
import type { Point } from '../src/model/types';

describe('hinge and swing recognition', () => {
  for (const vertical of [false, true])
    for (const hinge of ['a', 'b'] as const)
      for (const swing of [-1, 1] as const)
        it(`fits ${vertical ? 'vertical' : 'horizontal'} ${hinge} / ${swing}`, () => {
          const mask = new Uint8Array(220 * 220),
            a: Point = [85, 85],
            b: Point = vertical ? [85, 145] : [145, 85],
            u: Point = vertical ? [0, 1] : [1, 0],
            start = hinge === 'a' ? a : b,
            along = hinge === 'a' ? 1 : -1;
          // Offset the ink hinge to a wall face, shorten the drawn leaf slightly.
          const origin: Point = [start[0] - u[1] * 6, start[1] + u[0] * 6],
            radius = 55.5;
          const pixel = (x: number, y: number) => {
            mask[Math.round(y) * 220 + Math.round(x)] = 1;
          };
          for (let t = 0; t <= Math.PI / 2; t += 0.005)
            pixel(
              origin[0] + radius * (along * u[0] * Math.cos(t) - swing * u[1] * Math.sin(t)),
              origin[1] + radius * (along * u[1] * Math.cos(t) + swing * u[0] * Math.sin(t)),
            );
          for (let r = 0; r <= radius; r += 0.3)
            pixel(origin[0] - swing * u[1] * r, origin[1] + swing * u[0] * r);
          expect(recognizeDoorDirection(a, b, 12, mask, 220, 220)).toEqual({ hinge, swing });
        });
  it('does not guess direction from straight dimension lines or an empty gap', () => {
    const mask = new Uint8Array(220 * 220);
    for (let i = 20; i < 200; i++) {
      mask[70 * 220 + i] = 1;
      mask[i * 220 + 70] = 1;
    }
    expect(recognizeDoorDirection([85, 85], [145, 85], 12, mask, 220, 220)).toBeUndefined();
  });
});

describe('pipe symbols and diameter presets', () => {
  it('snaps only within tolerance and supports custom lists or disabled matching', () => {
    expect(matchPipeDiameter(104)).toBe(110);
    expect(matchPipeDiameter(275)).toBe(275);
    expect(matchPipeDiameter(63, { enabled: true, diameters: [63, 90], tolerance: 8 })).toBe(63);
    expect(matchPipeDiameter(85, { enabled: true, diameters: [63, 90], tolerance: 8 })).toBe(90);
    expect(matchPipeDiameter(104, { ...DEFAULT_PIPE_SETTINGS, enabled: false })).toBe(104);
  });
  it('detects clear and blurred circular pipes while excluding square boxes, dots and exterior annotation', () => {
    const w = 320,
      h = 260,
      rgba = new Uint8ClampedArray(w * h * 4).fill(255);
    const set = (x: number, y: number, gray = 0) => {
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = gray;
    };
    for (let y = 30; y < 230; y++)
      for (let x = 30; x < 290; x++) if (x < 40 || x >= 280 || y < 40 || y >= 220) set(x, y);
    for (const [cx, cy, blurred] of [
      [50, 60, 0],
      [50, 85, 1],
      [50, 110, 1],
      [18, 80, 0],
    ]) {
      for (let y = cy - 7; y <= cy + 7; y++)
        for (let x = cx - 7; x <= cx + 7; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (blurred) set(x, y, Math.round(255 - 60 * Math.exp(-((d - 2.8) ** 2) / 3.8)));
          else if (d >= 2.3 && d <= 3.5) set(x, y);
        }
    }
    // Small solid dot and hollow square next to the wall are not pipes.
    for (let y = 135; y <= 141; y++)
      for (let x = 47; x <= 53; x++) if (Math.hypot(x - 50, y - 138) <= 3) set(x, y);
    for (let y = 160; y <= 172; y++)
      for (let x = 44; x <= 56; x++) if (x === 44 || x === 56 || y === 160 || y === 172) set(x, y);
    const result = analyzeFloorplan(rgba, w, h, {
      threshold: 220,
      closeRadius: 0,
      minArea: 0.01,
      mmPerPixel: 20,
    });
    expect(result.pipes).toHaveLength(3);
    for (const y of [60, 85, 110])
      expect(result.pipes.some((p) => Math.hypot(p.x - 50, p.y - y) < 2)).toBe(true);
    expect(result.pipes.every((p) => p.pipeSystem === 'unknown' && p.diameter > 10)).toBe(true);
  });
  it('preserves editable physical diameter through project save and whole-plan calibration', () => {
    const p = emptyProject();
    p.devices.push({
      id: 'pipe',
      kind: 'pipe',
      x: 1000,
      y: 2000,
      height: 2800,
      diameter: 110,
      pipeSystem: 'drain',
      name: '排水立管',
      circuit: '卫生间',
      rotation: 0,
    });
    const saved = parseProject(JSON.parse(JSON.stringify(p)));
    expect(saved.devices).toEqual(p.devices);
    calibrateProject(saved, 2, [0, 0]);
    expect(saved.devices[0]).toMatchObject({ x: 2000, y: 4000, diameter: 110, height: 2800 });
    const obstacles = walkObstacles(p);
    expect(canWalk([1000, 2000], obstacles)).toBe(false);
    expect(canWalk([1300, 2000], obstacles)).toBe(true);
  });
});

describe('open balcony glass railing', () => {
  it('cuts the entire wall height, contains only low glass and rail hardware, and blocks walking', () => {
    const p = emptyProject();
    p.walls.push({ id: 'wall', a: [0, 0], b: [4000, 0], width: 240, height: 2800, bearing: false });
    p.openings.push({
      id: 'railing',
      type: 'railing',
      a: [500, 0],
      b: [3500, 0],
      width: 240,
      color: '#8bbfcb',
      railingHeight: 1100,
      sill: 900,
      height: 1300,
      windowStyle: 'bay',
      bayDepth: 600,
    }); // converting a bay must ignore stale window fields
    expect(wallSegments(p.walls[0], p.openings)).toEqual([
      { a: [0, 0], b: [500, 0], bottom: 0, top: 2800 },
      { a: [3500, 0], b: [4000, 0], bottom: 0, top: 2800 },
    ]);
    const mesh = buildOpening(p.openings[0], false),
      box = new THREE.Box3().setFromObject(mesh);
    expect(box.max.y).toBeCloseTo(1.1);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.z - box.min.z).toBeLessThan(0.07);
    expect(
      mesh.children.some(
        (c) =>
          c instanceof THREE.Mesh &&
          c.material instanceof THREE.MeshPhysicalMaterial &&
          c.material.transparent,
      ),
    ).toBe(true);
    expect(canWalk([2000, 0], walkObstacles(p))).toBe(false);
    expect(parseProject(JSON.parse(JSON.stringify(p))).openings[0]).toEqual(p.openings[0]);
  });
});
