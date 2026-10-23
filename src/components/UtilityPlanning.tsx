import { useEffect, useState } from 'react';
import { useStudio } from './StudioContext';
import { NumberField, Section } from './Fields';
import {
  applyUtilityLayout,
  DEFAULT_UTILITY_LAYOUT,
  planUtilities,
  sourceCandidates,
} from '../model/auto-utilities';
import { ROOM_TYPES } from '../model/room-types';
import { ROUTE_KINDS } from '../model/presets';
import type { UtilityKind, UtilityLayoutSettings } from '../model/types';

export default function UtilityPlanning() {
  const s = useStudio(),
    p = s.project;
  const [settings, setSettings] = useState<UtilityLayoutSettings>(() =>
    structuredClone(p.utilityLayout ?? DEFAULT_UTILITY_LAYOUT),
  );
  const [scope, setScope] = useState('all'),
    [message, setMessage] = useState('');
  const selected = s.selection?.kind === 'room' ? s.selection.id : '';
  const preview = s.utilityPreview;
  useEffect(() => {
    setSettings(structuredClone(p.utilityLayout ?? DEFAULT_UTILITY_LAYOUT));
  }, [p.utilityLayout]);
  useEffect(() => {
    s.setUtilityPreview(null);
    setMessage('');
  }, [settings, scope, scope === 'current' ? selected : '']);
  const update = (change: Partial<UtilityLayoutSettings>) => setSettings((v) => ({ ...v, ...change }));
  return (
    <Section title="按房间自动布置水电">
      <p className="help">
        按房间用途与家具位置配置点位，连接到配电箱、给水或排水接入点；先查看预览，再应用到方案。
      </p>
      <label className="field">
        <span>布置范围</span>
        <select aria-label="水电布置范围" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">全屋房间</option>
          <option value="current">当前选中的房间</option>
        </select>
      </label>
      {scope === 'current' && (
        <p className="help">{p.rooms.find((r) => r.id === selected)?.name ?? '请先在画布或右侧选择房间。'}</p>
      )}
      <label className="field">
        <span>管路敷设方式</span>
        <select
          aria-label="管路敷设方式"
          value={settings.mode}
          onChange={(e) => update({ mode: e.target.value as UtilityLayoutSettings['mode'] })}
        >
          <option value="ceiling">走顶</option>
          <option value="floor">走地</option>
        </select>
      </label>
      <div className="fields">
        <NumberField
          label="走地水平段高度"
          value={settings.floorHeight}
          min={0}
          max={500}
          onChange={(floorHeight) => update({ floorHeight })}
        />
        <NumberField
          label="走顶及灯位高度"
          value={settings.ceilingHeight}
          min={1800}
          max={6000}
          onChange={(ceilingHeight) => update({ ceilingHeight })}
        />
      </div>
      <div className="utility-systems">
        {(Object.keys(ROUTE_KINDS) as UtilityKind[]).map((kind) => (
          <label className="check-row" key={kind}>
            <input
              type="checkbox"
              checked={settings.systems.includes(kind)}
              onChange={(e) =>
                update({
                  systems: e.target.checked
                    ? [...settings.systems, kind]
                    : settings.systems.filter((v) => v !== kind),
                })
              }
            />
            <i style={{ background: ROUTE_KINDS[kind].color }} />
            {ROUTE_KINDS[kind].name}
          </label>
        ))}
      </div>
      <details className="utility-sources">
        <summary>接入点 · 自动选择或手动指定</summary>
        {settings.systems.map((kind) => (
          <label className="field" key={kind}>
            <span>{ROUTE_KINDS[kind].name}起点</span>
            <select
              aria-label={`${ROUTE_KINDS[kind].name}接入点`}
              value={settings.sources[kind] ?? ''}
              onChange={(e) => {
                const sources = { ...settings.sources };
                if (e.target.value) sources[kind] = e.target.value;
                else delete sources[kind];
                update({ sources });
              }}
            >
              <option value="">优先已有接入点，否则建议位置</option>
              {sourceCandidates(p, kind).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </details>
      <p className="help">
        走地 /
        走顶用于给水和强弱电；排水单独按地面参考线生成。重复生成会更新本范围的自动方案，保留手工点位与管线。可整体撤销。
      </p>
      <button
        className="wide primary"
        disabled={!p.rooms.length || !settings.systems.length || (scope === 'current' && !selected)}
        onClick={() => {
          const result = planUtilities(
            p,
            scope === 'current' ? [selected] : p.rooms.map((r) => r.id),
            settings,
          );
          s.setUtilityPreview(result);
          s.setLayers((v) => ({ ...v, utilities: true }));
          setMessage('');
        }}
      >
        生成水电布置预览
      </button>
      {preview && (
        <div className="utility-preview-report" data-testid="utility-preview-report">
          <b>
            {preview.rooms.length} 个房间 · {preview.devices.length} 个自动点位 · {preview.routes.length}{' '}
            条管线
          </b>
          <p>
            含竖向连接约 {preview.length.toFixed(1)} m，其中竖向 {preview.vertical.toFixed(1)} m。
          </p>
          <div className="utility-room-results">
            {preview.rooms.map((r) => (
              <div key={r.id}>
                <span>
                  {r.name} · {ROOM_TYPES[r.kind].label}
                </span>
                <small>
                  {r.devices} 点 / {r.routes} 线
                </small>
              </div>
            ))}
          </div>
          {!!preview.proposedSources.length && (
            <p className="help">
              待核对接入点：{preview.proposedSources.join('、')}
              。可应用后移动点位，或先手动添加实际接入点再生成。
            </p>
          )}
          {!!preview.warnings.length && (
            <details open>
              <summary>{preview.warnings.length} 项待核对</summary>
              <ul>
                {preview.warnings.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </details>
          )}
          <button
            className="wide primary"
            disabled={
              !preview.devices.length &&
              !preview.routes.length &&
              !preview.removeDevices.length &&
              !preview.removeRoutes.length
            }
            onClick={() => {
              s.commit((d) => applyUtilityLayout(d, preview, settings));
              s.setUtilityPreview(null);
              setMessage(`已应用 ${preview.routes.length} 条自动管线，可一步撤销。`);
              s.notify('自动水电布置已应用，可在 3D 查看走地 / 走顶与竖向连接。');
            }}
          >
            应用自动水电布置
          </button>
          <button className="wide secondary" onClick={() => s.setUtilityPreview(null)}>
            取消水电预览
          </button>
        </div>
      )}
      {message && (
        <p className="layout-report" role="status">
          {message}
        </p>
      )}
      <p className="help">
        方案预排布不计算电气负荷、线径、排水坡度或穿梁可行性。走顶跨门口须核对过梁；具体施工配置需结合实际接入点和现场条件确认。
      </p>
    </Section>
  );
}
