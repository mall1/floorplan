import { useState } from 'react';
import { useStudio } from './StudioContext';
import { NumberField, Section } from './Fields';
import { distance } from '../model/geometry';
import { calibrateProject } from '../model/calibration';
import { parseProject } from '../model/project';
import type { Room } from '../model/types';
export default function RoomCalibrationControls({ room }: { room: Room }) {
  const s = useStudio(),
    [edge, setEdge] = useState(0),
    [known, setKnown] = useState(Math.round(distance(room.poly[0], room.poly[1])));
  const index = Math.min(edge, room.poly.length - 1),
    from = room.poly[index],
    to = room.poly[(index + 1) % room.poly.length],
    measured = distance(from, to),
    factor = known / measured;
  return (
    <Section title="按房间校准全屋 · 可选">
      <p className="help">已知这个房间任意一条边的实际长度，可据此等比例校准整套户型；不需要校准时可跳过。</p>
      <label className="field">
        <span>校准参考边</span>
        <select
          aria-label="校准参考边"
          value={index}
          onChange={(e) => {
            const i = Number(e.target.value);
            setEdge(i);
            setKnown(Math.round(distance(room.poly[i], room.poly[(i + 1) % room.poly.length])));
          }}
        >
          {room.poly.map((pt, i) => (
            <option key={i} value={i}>
              边 {i + 1} · 顶点 {i + 1} → {((i + 1) % room.poly.length) + 1} ·{' '}
              {Math.round(distance(pt, room.poly[(i + 1) % room.poly.length]))} mm
            </option>
          ))}
        </select>
      </label>
      <NumberField label="参考边实际长度" value={known} min={100} max={100000} onChange={setKnown} />
      <p className="help">
        当前 {Math.round(measured)} mm → 实际 {known} mm，全屋比例 × {factor.toFixed(3)}
        。墙厚重新匹配预设；家具、板砖规格和高度保持不变。
      </p>
      <button
        className="wide secondary"
        onClick={() => {
          try {
            const next = structuredClone(s.project);
            calibrateProject(next, factor, from);
            s.commit(parseProject(next));
            s.setRecognition(null);
            s.setCandidates([]);
            s.fit();
            s.notify('已按房间参考边等比例校准全屋，可撤销');
          } catch {
            s.notify('校准后尺寸超出范围，请核对实际长度');
          }
        }}
      >
        按此房间校准全屋
      </button>
    </Section>
  );
}
