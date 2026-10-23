import { useMemo } from 'react';
import { Section, NumberField } from './Fields';
import { useStudio } from './StudioContext';
import { areaCsv, DEFAULT_ANALYSIS, spaceMetrics } from '../model/space-analysis';
import { effectiveRoomKind, inferRoomKind, ROOM_TYPES } from '../model/room-types';
import { FLOW_TYPES } from '../model/circulation';
import { download } from '../model/files';
import type { FlowKind, Project } from '../model/types';

export default function SpaceAnalysisPanel() {
  const s = useStudio(),
    p = s.project,
    settings = p.analysis ?? DEFAULT_ANALYSIS;
  const areas = useMemo(() => spaceMetrics(p), [p]);
  const update = (fn: (settings: NonNullable<Project['analysis']>) => void) =>
    s.commit((p) => {
      p.analysis ??= structuredClone(DEFAULT_ANALYSIS);
      fn(p.analysis);
    });
  return (
    <>
      <Section title="房间用途">
        <p className="help">
          结合房间名称、家具、水电特征及形状给出用途建议；仅凭空白线图不能可靠区分所有房间。
        </p>
        <button
          className="wide secondary"
          disabled={!p.rooms.length}
          onClick={() => {
            let count = 0;
            s.commit((d) => {
              for (const room of d.rooms) {
                const suggestion = inferRoomKind(d, room);
                if (
                  room.kind === undefined &&
                  suggestion.kind !== 'unknown' &&
                  suggestion.confidence !== 'low'
                ) {
                  room.kind = suggestion.kind;
                  count++;
                }
              }
            });
            s.notify(`已确认 ${count} 个有明确依据的房间；手动设置及证据不足的房间保持原样。`);
          }}
        >
          识别并设置未指定房间
        </button>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.showTypes}
            onChange={(e) =>
              update((a) => {
                a.showTypes = e.target.checked;
              })
            }
          />
          显示房间类型分区
        </label>
        <div className="analysis-room-list">
          {p.rooms.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                s.select({ kind: 'room', id: r.id }, true);
                s.setTool('select');
              }}
            >
              <i style={{ background: ROOM_TYPES[effectiveRoomKind(p, r)].color }} />
              <span>{r.name}</span>
              <small>
                {ROOM_TYPES[effectiveRoomKind(p, r)].label}
                {r.kind === undefined ? ' · 推测' : ''}
              </small>
            </button>
          ))}
        </div>
      </Section>
      <Section title="全屋面积与收纳">
        <div className="area-metrics" data-testid="whole-area-metrics">
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
                {areas[key].toFixed(2)}
                <small> ㎡</small>
              </strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.showAreas}
            onChange={(e) =>
              update((a) => {
                a.showAreas = e.target.checked;
              })
            }
          />
          显示家具占地与面积标注
        </label>
        <p className="help">
          全屋仅统计勾选计入面积的房间，重叠空间和家具去重，扣除轮廓内的墙体与烟道。家具按旋转后的外包矩形计算（不计地毯与悬挂设备）；收纳是柜体占地，不是内部容积。可活动面积是剩余地面，不等同于连通通道。
        </p>
        {p.reference && !p.reference.calibrated && (
          <p className="layout-report">底图尚未校准，当前尺寸和面积为比例估算。</p>
        )}
        <button
          className="wide secondary"
          disabled={!p.rooms.length}
          onClick={() =>
            download(`${p.name}-空间面积.csv`, new Blob([areaCsv(p)], { type: 'text/csv;charset=utf-8;' }))
          }
        >
          导出空间面积 CSV
        </button>
      </Section>
      <Section title="动线与通行检查">
        {(Object.keys(FLOW_TYPES) as FlowKind[]).map((kind) => (
          <label className="flow-option" key={kind}>
            <input
              type="checkbox"
              checked={settings.flows.includes(kind)}
              onChange={(e) =>
                update((a) => {
                  a.flows = e.target.checked
                    ? [...a.flows.filter((v) => v !== kind), kind]
                    : a.flows.filter((v) => v !== kind);
                })
              }
            />
            <i style={{ background: FLOW_TYPES[kind].color }} />
            <span>
              {FLOW_TYPES[kind].label}
              <small>{FLOW_TYPES[kind].description}</small>
            </span>
          </label>
        ))}
        <NumberField
          label="参考通行宽度"
          value={settings.clearance}
          min={300}
          max={1200}
          step={50}
          onChange={(v) =>
            update((a) => {
              a.clearance = v;
            })
          }
        />
        <p className="help">
          按门洞打开估算通行，沿可用地面绕开墙体、烟道与家具。彩线表示可达路线，红圈表示受阻参考位置；不能连通时不会画出穿墙路线。空间分析显示在
          2D 平面中，可随 PNG 导出。
        </p>
        {!!settings.flows.length && !s.circulation.paths.length && (
          <p className="layout-report">尚无可分析的房间组合，请设置卧室、卫生间、客厅、餐厅、厨房等用途。</p>
        )}
        <div className="flow-results" data-testid="flow-results">
          {s.circulation.paths.map((path, i) => (
            <div key={i} className={path.status === 'clear' ? '' : 'blocked'}>
              <b style={{ color: FLOW_TYPES[path.kind].color }}>{path.label}</b>
              <span>{path.status === 'clear' ? `可通行 · ${path.distance.toFixed(1)} m` : path.reason}</span>
            </div>
          ))}
        </div>
        {!!settings.flows.length && (
          <p className="help">
            路径为平面近似分析，入口按外侧门洞推测；采样间隔 {s.circulation.step} mm，狭窄或复杂转角仍需核对。
          </p>
        )}
      </Section>
    </>
  );
}
