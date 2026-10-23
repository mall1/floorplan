import { emptyProject } from '../../src/model/project';
import { rect } from '../../src/model/geometry';
import { defaultFloor } from '../../src/model/presets';
import type { Furniture, Room, RoomKind } from '../../src/model/types';

export const analysisRoom = (id = 'room', kind?: RoomKind, x = 0, w = 4000, h = 4000): Room => ({
  id,
  name: id,
  kind,
  poly: rect([x, 0], [x + w, h]),
  boundary: true,
  counted: true,
  wallWidth: 200,
  flooring: defaultFloor(),
});
export const analysisFurniture = (type: string, cx: number, cy: number, w = 1000, d = 1000): Furniture => ({
  id: `${type}-${cx}-${cy}`,
  name: type,
  type,
  cx,
  cy,
  w,
  d,
  rot: 0,
  color: '#abcabc',
});
export function analysisFixture() {
  const p = emptyProject();
  p.name = '空间分析测试';
  p.rooms = [
    analysisRoom('卧室', 'bedroom'),
    analysisRoom('客厅', 'living', 4000),
    analysisRoom('餐厅', 'dining', 8000),
    analysisRoom('厨房', 'kitchen', 12000),
    analysisRoom('卫生间', 'bathroom', 16000),
  ];
  p.openings = [0, 4000, 8000, 12000, 16000].map((x, i) => ({
    id: `door-${i}`,
    type: 'door',
    a: [x, 1500],
    b: [x, 2500],
    width: 200,
    height: 2100,
    color: '#abcdef',
  }));
  return p;
}
