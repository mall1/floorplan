import { emptyProject } from '../../src/model/project';
import { rect } from '../../src/model/geometry';
import { defaultFloor } from '../../src/model/presets';
import type { Room } from '../../src/model/types';

export function wallAreaFixture() {
  const project = emptyProject();
  project.name = '墙面用量测试';
  const room = (id: string, name: string, x: number, w: number): Room => ({
    id,
    name,
    poly: rect([x, 0], [x + w, 3000]),
    boundary: true,
    counted: true,
    wallWidth: 200,
    flooring: defaultFloor(),
  });
  project.rooms = [room('bedroom', '卧室', 0, 4000), room('study', '书房', 4000, 3000)];
  project.openings = [
    {
      id: 'door',
      type: 'door',
      a: [4000, 1000],
      b: [4000, 1900],
      width: 200,
      height: 2100,
      color: '#b99b77',
    },
    {
      id: 'window',
      type: 'window',
      a: [1000, 0],
      b: [2500, 0],
      width: 200,
      height: 1200,
      sill: 900,
      color: '#9dbbc0',
    },
  ];
  return project;
}
