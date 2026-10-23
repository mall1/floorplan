import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { useStudio } from './StudioContext';
import { NumberField, Section } from './Fields';
import { wallAreaCsv, wallAreaReport } from '../model/wall-area';
import { download } from '../model/files';

export default function WallAreaPanel() {
  const { project, commit, selection, select, setTool } = useStudio(),
    report = useMemo(() => wallAreaReport(project), [project]),
    room = project.rooms.find((r) => selection?.kind === 'room' && r.id === selection.id),
    selected = report.rooms.find((r) => r.id === room?.id);
  const update = (patch: Partial<NonNullable<typeof project.wallFinish>>) =>
    commit((d) => {
      d.wallFinish = { waste: 10, ...d.wallFinish, ...patch };
    });
  return (
    <div id="wall-area-panel" data-testid="wall-area-panel">
      <Section title="墙面面积 · 壁纸估算">
        {!report.rooms.length ? (
          <p className="help">先绘制或识别房间，即可按房间统计墙面用量。</p>
        ) : (
          <>
            <div className="metrics">
              <div>
                <strong data-testid="wall-area-total-net">
                  {report.total.net.toFixed(2)}
                  <small> ㎡</small>
                </strong>
                <span>全屋净墙面 · 已勾选房间</span>
              </div>
              <div>
                <strong data-testid="wall-area-total-purchase">
                  {report.total.purchase.toFixed(2)}
                  <small> ㎡</small>
                </strong>
                <span>含 {report.waste}% 损耗参考面积</span>
              </div>
            </div>
            <div className="summary-row">
              <span>墙面毛面积</span>
              <b data-testid="wall-area-total-gross">{report.total.gross.toFixed(2)} ㎡</b>
            </div>
            <div className="summary-row">
              <span>门窗 / 开放护栏扣除</span>
              <b data-testid="wall-area-total-deduction">−{report.total.deduction.toFixed(2)} ㎡</b>
            </div>
            <div className="fields">
              <NumberField
                label="墙面预留损耗"
                min={0}
                max={100}
                step={1}
                unit="%"
                value={report.waste}
                onChange={(waste) => update({ waste })}
              />
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={project.wallFinish?.height !== undefined}
                onChange={(e) => update({ height: e.target.checked ? 2800 : undefined })}
              />
              统一估算墙面高度
            </label>
            {project.wallFinish?.height !== undefined && (
              <NumberField
                label="全屋估算墙高"
                min={100}
                max={10000}
                value={project.wallFinish.height}
                onChange={(height) => update({ height })}
              />
            )}
            <p className="help">默认按模型墙高（房间边界墙为 2800 mm）；自定义高度仅用于用量估算。</p>
            <div className="wall-area-rooms" aria-label="分房间墙面统计">
              {report.rooms.map((r) => (
                <div
                  key={r.id}
                  data-testid={`wall-area-room-${r.id}`}
                  className={`wall-area-room ${r.id === room?.id ? 'active' : ''}`}
                >
                  <div className="wall-area-room-heading">
                    <input
                      type="checkbox"
                      aria-label={`${r.name}计入墙面合计`}
                      checked={r.included}
                      onChange={(e) =>
                        commit((d) => {
                          const target = d.rooms.find((v) => v.id === r.id)!;
                          target.wallFinish = { ...target.wallFinish, included: e.target.checked };
                        })
                      }
                    />
                    <button
                      onClick={() => {
                        select({ kind: 'room', id: r.id });
                        setTool('select');
                        requestAnimationFrame(() =>
                          document
                            .getElementById('wall-area-room-settings')
                            ?.scrollIntoView({ block: 'center' }),
                        );
                      }}
                    >
                      {r.name}
                    </button>
                    <strong>{r.net.toFixed(2)} ㎡</strong>
                  </div>
                  <div className="wall-area-breakdown">
                    毛 {r.gross.toFixed(2)} − 扣 {r.deduction.toFixed(2)} · 含损耗 {r.purchase.toFixed(2)} ㎡
                  </div>
                  {!r.included && <span className="wall-area-excluded">未计入全屋合计</span>}
                  {r.gross === 0 && <p className="help">未找到面向此房间的墙体，请检查轮廓或补画墙体。</p>}
                </div>
              ))}
            </div>
            {room && selected && (
              <div id="wall-area-room-settings" className="wall-area-selected">
                <h4>{room.name} · 估算设置</h4>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={room.wallFinish?.height !== undefined}
                    onChange={(e) =>
                      commit((d) => {
                        const target = d.rooms.find((r) => r.id === room.id)!;
                        target.wallFinish = {
                          ...target.wallFinish,
                          height: e.target.checked ? (project.wallFinish?.height ?? 2800) : undefined,
                        };
                      })
                    }
                  />
                  此房间单独设置估算高度
                </label>
                {room.wallFinish?.height !== undefined && (
                  <NumberField
                    label="本房间估算墙高"
                    min={100}
                    max={10000}
                    value={room.wallFinish.height}
                    onChange={(height) =>
                      commit((d) => {
                        const target = d.rooms.find((r) => r.id === room.id)!;
                        target.wallFinish = { ...target.wallFinish, height };
                      })
                    }
                  />
                )}
                <p className="help">
                  当前：{selected.height === undefined ? '按模型墙高' : `${selected.height} mm`} · 净墙面{' '}
                  {selected.net.toFixed(2)} ㎡
                </p>
              </div>
            )}
            <button
              className="wide secondary"
              onClick={() =>
                download(
                  `${project.name}-墙面面积清单.csv`,
                  new Blob([wallAreaCsv(report)], { type: 'text/csv;charset=utf-8;' }),
                )
              }
            >
              <Download size={14} />
              导出墙面面积清单
            </button>
            {report.unassignedLength > 0.01 && (
              <p className="help warning">
                约 {report.unassignedLength.toFixed(2)} m 墙段未归属房间，未计入统计，请核对房间轮廓。
              </p>
            )}
            {project.reference && !project.reference.calibrated && (
              <p className="help warning">底图尚未校准，面积随图纸比例估算，采购前请校准实际尺寸。</p>
            )}
            <details className="wall-area-notes">
              <summary>计算口径与用量说明</summary>
              <p className="help">
                按实际墙段的轴线长度 ×
                高度估算，开放通道不补墙。共用墙两面分别计入相邻房间；房间内独立隔墙计两面。重叠洞口只扣一次，护栏整段不计墙面，门槛石不扣墙面。
              </p>
              <p className="help">
                不含洞口侧壁、烟道包柱、飘窗内侧及墙角搭接修正；全屋合计为已勾选房间之和。壁纸采购还需结合卷宽、卷长和对花裁切，含损耗面积不是卷数。
              </p>
            </details>
          </>
        )}
      </Section>
    </div>
  );
}
