import { describe, it, expect } from 'vitest';
import { analysisFixture } from './fixtures/space-analysis';
import { applyUtilityLayout, DEFAULT_UTILITY_LAYOUT, planUtilities } from '../src/model/auto-utilities';
import { inside } from '../src/model/geometry';
import { parseProject } from '../src/model/project';
import { deviceStyle, routeStyle } from '../src/model/utility-style';
import type { UtilityLayoutSettings } from '../src/model/types';
describe('separate utility types and air conditioning', () => {
  it('distinguishes cold/hot points, sockets, switches and lights including legacy water points', () => {
    const p = analysisFixture(),
      s = structuredClone(DEFAULT_UTILITY_LAYOUT);
    const r = planUtilities(
      p,
      p.rooms.map((v) => v.id),
      s,
    );
    applyUtilityLayout(p, r, s);
    expect(p.devices.some((d) => d.kind === 'coldwater')).toBe(true);
    expect(p.devices.some((d) => d.kind === 'hotwater')).toBe(true);
    expect(
      new Set(
        ['socket', 'switch', 'light'].map(
          (kind) => deviceStyle(p.devices.find((d) => d.kind === kind)!).symbol,
        ),
      ).size,
    ).toBe(3);
    const cold = p.devices.find((d) => d.kind === 'coldwater')!,
      hot = p.devices.find((d) => d.kind === 'hotwater')!;
    expect(deviceStyle(cold).color).not.toBe(deviceStyle(hot).color);
    expect(deviceStyle({ ...hot, kind: 'water' }).symbol).toBe('热');
    expect(new Set(p.routes.filter((r) => r.kind === 'power').map((r) => routeStyle(r).name))).toEqual(
      new Set(['插座回路', '照明回路', '空调专用回路']),
    );
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it('places split outdoor units outside, routes cold media and drainage, then updates to one central unit', () => {
    const p = analysisFixture();
    p.rooms = p.rooms.slice(0, 2);
    p.openings = p.openings.slice(0, 2);
    const s: UtilityLayoutSettings = {
      ...structuredClone(DEFAULT_UTILITY_LAYOUT),
      systems: ['power', 'refrigerant', 'condensate'],
    };
    const ids = p.rooms.map((r) => r.id);
    const generate = () => {
      const r = planUtilities(p, ids, s);
      applyUtilityLayout(p, r, s);
      return r;
    };
    generate();
    const outside = p.devices.filter((d) => d.kind === 'acoutdoor');
    expect(outside).toHaveLength(2);
    expect(outside.every((d) => !p.rooms.some((r) => inside([d.x, d.y], r.poly)))).toBe(true);
    expect(p.routes.filter((r) => r.kind === 'refrigerant')).toHaveLength(2);
    expect(p.routes.filter((r) => r.kind === 'condensate')).toHaveLength(2);
    for (const r of p.routes.filter((r) => r.kind === 'condensate'))
      expect(r.height).toBeLessThanOrEqual(p.devices.find((d) => d.id === r.startDeviceId)!.height);
    const count = [p.devices.length, p.routes.length];
    generate();
    expect([p.devices.length, p.routes.length]).toEqual(count);
    s.acMode = 'central';
    generate();
    expect(p.devices.filter((d) => d.kind === 'acoutdoor')).toHaveLength(1);
    expect(
      p.devices
        .filter((d) => d.kind === 'acindoor')
        .every((d) => d.acMode === 'central' && d.height === s.ceilingHeight),
    ).toBe(true);
    expect(new Set(p.routes.filter((r) => r.kind === 'refrigerant').map((r) => r.startDeviceId)).size).toBe(
      1,
    );
    expect(p.routes.filter((r) => r.kind === 'refrigerant')).toHaveLength(2);
    const before = p.devices.length;
    generate();
    expect(p.devices).toHaveLength(before);
  });
  it('preserves unselected rooms when switching one room to central air and rejects invalid saved types', () => {
    const p = analysisFixture();
    p.rooms = p.rooms.slice(0, 2);
    p.openings = p.openings.slice(0, 2);
    const s = {
      ...structuredClone(DEFAULT_UTILITY_LAYOUT),
      systems: ['refrigerant', 'condensate'] as UtilityLayoutSettings['systems'],
    };
    applyUtilityLayout(
      p,
      planUtilities(
        p,
        p.rooms.map((r) => r.id),
        s,
      ),
      s,
    );
    const others = structuredClone(p.routes.filter((r) => r.autoUtility?.roomId === p.rooms[1].id));
    s.acMode = 'central';
    applyUtilityLayout(p, planUtilities(p, [p.rooms[0].id], s), s);
    expect(p.routes.filter((r) => r.autoUtility?.roomId === p.rooms[1].id)).toEqual(others);
    expect(
      others.every(
        (r) =>
          p.devices.some((d) => d.id === r.startDeviceId) && p.devices.some((d) => d.id === r.endDeviceId),
      ),
    ).toBe(true);
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() =>
      parseProject({ ...p, routes: p.routes.map((r) => ({ ...r, powerUse: 'invalid' })) }),
    ).toThrow();
  });
});
