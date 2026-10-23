import { useMemo, useState } from 'react';
import { useStudio } from './StudioContext';
import { Section } from './Fields';
import { ROOM_TYPES, inferRoomKind } from '../model/room-types';
import { autoLayout } from '../model/auto-layout';
import { spaceMetrics } from '../model/space-analysis';
import type { Room, RoomKind } from '../model/types';

export default function RoomPlanning({ room }: { room: Room }) {
  const s = useStudio(),
    [compact, setCompact] = useState(false),
    [replace, setReplace] = useState(false),
    [report, setReport] = useState('');
  const suggestion = useMemo(() => inferRoomKind(s.project, room), [s.project, room]);
  const metrics = useMemo(() => spaceMetrics(s.project, [room]), [s.project, room]);
  const setKind = (kind: RoomKind) => {
    s.commit((p) => {
      p.rooms.find((r) => r.id === room.id)!.kind = kind;
    });
    setReport('');
  };
  return (
    <Section title="房间用途与自动布置">
      <label className="field">
        <span>房间类型</span>
        <select
          aria-label="房间类型"
          value={room.kind ?? 'auto'}
          onChange={(e) => {
            if (e.target.value === 'auto')
              s.commit((p) => {
                delete p.rooms.find((r) => r.id === room.id)!.kind;
              });
            else setKind(e.target.value as RoomKind);
          }}
        >
          <option value="auto">自动判断（待确认）</option>
          {Object.entries(ROOM_TYPES).map(([kind, value]) => (
            <option key={kind} value={kind}>
              {value.label}
            </option>
          ))}
        </select>
      </label>
      <div className="room-suggestion" data-testid="room-type-suggestion">
        <b>识别建议：{ROOM_TYPES[suggestion.kind].label}</b>
        <span>
          {suggestion.confidence === 'high' ? '依据较明确' : '需人工核对'} · {suggestion.reason}
        </span>
        {suggestion.kind !== 'unknown' && room.kind !== suggestion.kind && (
          <button className="wide secondary" onClick={() => setKind(suggestion.kind)}>
            采用房间类型建议
          </button>
        )}
      </div>
      <div className="area-metrics" data-testid="room-area-metrics">
        {(
          [
            ['net', '房间净面积'],
            ['occupied', '家具占地'],
            ['free', '可活动面积'],
            ['storage', '收纳占地'],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <strong>
              {metrics[key].toFixed(2)}
              <small> ㎡</small>
            </strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <label className="field">
        <span>布置方案</span>
        <select
          aria-label="布置方案"
          value={compact ? 'compact' : 'standard'}
          onChange={(e) => setCompact(e.target.value === 'compact')}
        >
          <option value="standard">标准家具</option>
          <option value="compact">紧凑家具</option>
        </select>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        替换本房间已有家具（可撤销）
      </label>
      <button
        className="wide primary"
        onClick={() => {
          const result = autoLayout(s.project, room, { compact, replace });
          if (result.furniture.length)
            s.commit((p) => {
              p.furniture = p.furniture.filter((f) => !result.removed.includes(f.id));
              p.furniture.push(...result.furniture);
            });
          const message = result.furniture.length
            ? `已布置 ${result.furniture.length} 件家具，可一步撤销。`
            : '没有新增家具：现有配置已满足，或可用空间不足。';
          setReport(
            [message, ...result.warnings, result.skipped.length ? `未放入：${result.skipped.join('、')}` : '']
              .filter(Boolean)
              .join(' '),
          );
          s.notify(result.furniture.length ? message : result.warnings[0] || message);
        }}
      >
        一键自动布置
      </button>
      <p className="help">
        默认补齐缺少的家具；避开墙体、烟道和门洞，布置后可继续移动、改尺寸。厨房台面与设备连接、柜门开启等细节仍可手动调整。
      </p>
      {report && (
        <p className="layout-report" role="status">
          {report}
        </p>
      )}
    </Section>
  );
}
