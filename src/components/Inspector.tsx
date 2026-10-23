import { Copy, RotateCw, Trash2, SlidersHorizontal, ChevronRight, Download } from 'lucide-react';
import { useStudio } from './StudioContext';
import RoomCalibrationControls from './RoomCalibrationControls';
import WallAreaPanel from './WallAreaPanel';
import RoomPlanning from './RoomPlanning';
import { detachUtilityRoute, routeLengths } from '../model/utility-connections';
import { deviceStyle, resolvedDeviceKind, routeStyle } from '../model/utility-style';
import { NumberField, Section, TextField } from './Fields';
import {
  allWalls,
  bounds,
  center,
  distance,
  length,
  projectPoint,
  resizeRoom,
  validPolygon,
} from '../model/geometry';
import { openingHost, resolvedOpening, resizeRoomLayout, setWallWidth } from '../model/architecture';
import { floorFor } from '../model/flooring';
import { usableArea } from '../model/shafts';
import { DEVICE_KINDS, ROUTE_KINDS } from '../model/presets';
import { PIPE_DIAMETERS } from '../model/pipe-presets';
import { download } from '../model/files';
import type { Point, DeviceKind, Route } from '../model/types';
export default function Inspector({ onClose }: { onClose: () => void }) {
  const s = useStudio(),
    p = s.project,
    sel = s.selection,
    room = p.rooms.find((r) => sel?.kind === 'room' && r.id === sel.id),
    furniture = p.furniture.find((f) => sel?.kind === 'furniture' && f.id === sel.id),
    device = p.devices.find((d) => sel?.kind === 'device' && d.id === sel.id),
    route = p.routes.find((r) => sel?.kind === 'route' && r.id === sel.id),
    wall = allWalls(p).find((w) => sel?.kind === 'wall' && w.id === sel.id),
    opening = p.openings.find((o) => sel?.kind === 'opening' && o.id === sel.id),
    shaft = p.shafts.find((o) => sel?.kind === 'shaft' && o.id === sel.id),
    measure = p.measures.find((m) => sel?.kind === 'measure' && m.id === sel.id);
  const total = p.rooms.filter((r) => r.counted).reduce((sum, r) => sum + usableArea(p, r), 0),
    cost = p.rooms
      .filter((r) => r.counted)
      .reduce((sum, r) => {
        const f = floorFor(p, r);
        return sum + usableArea(p, r) * f.price * (1 + f.waste / 100);
      }, 0);
  const editPoly = (poly: Point[]) => {
    if (!room) return;
    if (!validPolygon(poly)) {
      s.notify('房间轮廓不能相交，面积需大于 0.05 ㎡');
      return;
    }
    s.commit((d) => {
      const r = d.rooms.find((r) => r.id === room.id)!;
      if (r.poly.length !== poly.length) r.edgeWidths = undefined;
      r.poly = poly;
    });
  };
  const resize = (width: number, height: number) => {
    if (!room || !validPolygon(resizeRoom(room, width, height))) return;
    const next = structuredClone(p);
    resizeRoomLayout(next, room.id, width, height);
    if (next.rooms.some((r) => !validPolygon(r.poly))) {
      s.notify('调整后存在无效房间轮廓，请缩小调整幅度');
      return;
    }
    s.commit(next);
  };
  const exportList = () => {
    const cell = (value: unknown) =>
      '"' +
      String(value)
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const rows: unknown[][] = [['类别', '名称', '数量/长度', '单位', '规格/回路', '高度 mm']];
    for (const r of p.rooms) {
      const f = floorFor(p, r);
      rows.push([
        '铺装',
        r.name,
        usableArea(p, r).toFixed(2),
        '㎡',
        `${f.width}×${f.length};${f.pattern}`,
        '',
      ]);
    }
    for (const r of p.routes)
      rows.push([
        '管线',
        routeStyle(r).name,
        (length(r.points) / 1000).toFixed(2),
        'm',
        `${r.circuit};管径${r.diameter}`,
        r.height,
      ]);
    for (const r of p.routes.filter((r) => routeLengths(p, r).vertical > 0))
      rows.push([
        '管线竖向段',
        routeStyle(r).name,
        routeLengths(p, r).vertical.toFixed(2),
        'm',
        r.circuit,
        r.height,
      ]);
    for (const d of p.devices)
      rows.push([
        d.kind === 'pipe' ? '竖管' : '点位',
        d.name,
        1,
        '个',
        d.kind === 'pipe'
          ? `外径Ø${d.diameter ?? 110};${d.pipeSystem === 'drain' ? '排水' : d.pipeSystem === 'water' ? '给水' : '用途待核对'};${d.circuit}`
          : `${deviceStyle(d).name};${d.circuit}`,
        d.height,
      ]);
    for (const o of p.openings.filter((o) => o.type === 'threshold'))
      rows.push(['收口', '门槛石', (distance(o.a, o.b) / 1000).toFixed(2), 'm', `宽${o.width}`, '']);
    download(
      `${p.name}-材料点位清单.csv`,
      new Blob(['\ufeff' + rows.map((row) => row.map(cell).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8;',
      }),
    );
  };
  return (
    <aside className="inspector" key={sel ? `${sel.kind}:${sel.id}` : 'overview'}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PROJECT INSPECTOR</span>
          <h2>{sel ? '对象属性' : '方案概览'}</h2>
        </div>
        <SlidersHorizontal size={19} />
        <button className="panel-close" aria-label="关闭属性面板" onClick={onClose}>
          ×
        </button>
      </div>
      <Section title="空间选择">
        <label className="field">
          <span>选择房间</span>
          <select
            aria-label="选择房间"
            value={room?.id ?? ''}
            onChange={(e) => {
              s.select(e.target.value ? { kind: 'room', id: e.target.value } : null);
              s.setTool('select');
            }}
          >
            <option value="">从列表选择房间</option>
            {p.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {room && (
          <label className="field">
            <span>选择房间附近的墙</span>
            <select
              aria-label="选择房间附近的墙"
              value=""
              onChange={(e) => s.select({ kind: 'wall', id: e.target.value })}
            >
              <option value="">点击墙面或选择墙段调整厚度</option>
              {allWalls(p)
                .filter((w) =>
                  room.poly.some((a, i) => {
                    const b = room.poly[(i + 1) % room.poly.length];
                    return (
                      projectPoint(w.a, a, b).distance < w.width + 100 ||
                      projectPoint(w.b, a, b).distance < w.width + 100
                    );
                  }),
                )
                .map((w, i) => (
                  <option key={w.id} value={w.id}>
                    墙段 {i + 1} · {Math.round(w.width)} mm
                  </option>
                ))}
            </select>
          </label>
        )}
      </Section>
      <button
        className="wide secondary wall-area-shortcut"
        onClick={() =>
          document.getElementById('wall-area-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        }
      >
        查看墙面面积 / 壁纸用量
      </button>
      {sel && (
        <div className="object-actions">
          <button onClick={s.deleteSelected} title="删除对象">
            <Trash2 size={15} />
            删除
          </button>
          {(furniture || room || device) && (
            <button onClick={s.duplicateSelected} title="复制对象">
              <Copy size={15} />
              复制
            </button>
          )}
          {(furniture || device) && (
            <button onClick={s.rotateSelected} title="旋转 90°">
              <RotateCw size={15} />
              旋转
            </button>
          )}
          <button onClick={() => s.select(null)}>取消选择</button>
        </div>
      )}
      {room && (
        <>
          <RoomPlanning key={room.id} room={room} />
          <Section title="房间信息">
            <TextField
              label="房间名称"
              value={room.name}
              onChange={(v) =>
                s.commit((d) => {
                  d.rooms.find((r) => r.id === room.id)!.name = v;
                })
              }
            />
            <div className="metrics">
              <div>
                <strong>{usableArea(p, room).toFixed(2)}</strong>
                <span>轮廓面积（扣烟道）/ ㎡</span>
              </div>
              <div>
                <strong>{room.poly.length}</strong>
                <span>轮廓顶点</span>
              </div>
            </div>
            <div className="fields">
              <NumberField
                label="包围宽度"
                min={100}
                max={100000}
                value={bounds(room.poly).w}
                onChange={(v) => resize(v, bounds(room.poly).h)}
              />
              <NumberField
                label="包围深度"
                min={100}
                max={100000}
                value={bounds(room.poly).h}
                onChange={(v) => resize(bounds(room.poly).w, v)}
              />
              <NumberField
                label="边界墙厚"
                min={50}
                max={1000}
                value={room.wallWidth}
                onChange={(v) =>
                  s.commit((d) => {
                    d.rooms.find((r) => r.id === room.id)!.wallWidth = v;
                    d.rooms.find((r) => r.id === room.id)!.edgeWidths = undefined;
                  })
                }
              />
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={room.boundary}
                onChange={(e) =>
                  s.commit((d) => {
                    d.rooms.find((r) => r.id === room.id)!.boundary = e.target.checked;
                  })
                }
              />
              随轮廓生成边界墙
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={room.counted}
                onChange={(e) =>
                  s.commit((d) => {
                    d.rooms.find((r) => r.id === room.id)!.counted = e.target.checked;
                  })
                }
              />
              计入总面积和费用
            </label>
            <p className="help">
              修改宽深会联动墙体、门窗、相邻房间和点位，保持连接；左上角固定，墙厚和家具尺寸不变。支持撤销。
            </p>
            <button className="wide secondary" onClick={() => s.setWorkspace('flooring')}>
              设置这个房间的地面 <ChevronRight size={14} />
            </button>
          </Section>
          <RoomCalibrationControls key={room.id} room={room} />
          <Section title="顶点精调">
            <p className="help">画布拖动顶点，双击边线添加顶点；坐标单位 mm。</p>
            <div className="vertex-list">
              {room.poly.map((pt, i) => (
                <div key={i}>
                  <b>{i + 1}</b>
                  <NumberField
                    label="X"
                    value={pt[0]}
                    onChange={(v) => editPoly(room.poly.map((a, j) => (j === i ? [v, a[1]] : a)))}
                  />
                  <NumberField
                    label="Y"
                    value={pt[1]}
                    onChange={(v) => editPoly(room.poly.map((a, j) => (j === i ? [a[0], v] : a)))}
                  />
                  <button
                    title={`删除顶点 ${i + 1}`}
                    disabled={room.poly.length <= 3}
                    onClick={() => editPoly(room.poly.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
      {shaft && (
        <Section title="烟道属性">
          <TextField
            label="烟道名称"
            value={shaft.name}
            onChange={(v) =>
              s.commit((d) => {
                d.shafts.find((a) => a.id === shaft.id)!.name = v;
              })
            }
          />
          <div className="fields">
            {([0, 1] as const).map((axis) => (
              <NumberField
                key={axis}
                label={axis ? '烟道深度' : '烟道宽度'}
                min={50}
                max={5000}
                value={distance(shaft.poly[0], shaft.poly[axis ? 3 : 1])}
                onChange={(v) =>
                  s.commit((d) => {
                    const item = d.shafts.find((a) => a.id === shaft.id)!,
                      a = item.poly[0],
                      b = item.poly[axis ? 3 : 1],
                      len = distance(a, b),
                      delta: Point = [(b[0] - a[0]) * (v / len - 1), (b[1] - a[1]) * (v / len - 1)];
                    item.poly = item.poly.map((pt, i) =>
                      i === 2 || i === (axis ? 3 : 1) ? [pt[0] + delta[0], pt[1] + delta[1]] : pt,
                    );
                  })
                }
              />
            ))}
            {([0, 1] as const).map((axis) => (
              <NumberField
                key={`position-${axis}`}
                label={axis ? '烟道中心 Y' : '烟道中心 X'}
                value={center(shaft.poly)[axis]}
                onChange={(v) =>
                  s.commit((d) => {
                    const item = d.shafts.find((a) => a.id === shaft.id)!,
                      delta = v - center(item.poly)[axis];
                    item.poly = item.poly.map((pt) =>
                      axis ? [pt[0], pt[1] + delta] : [pt[0] + delta, pt[1]],
                    );
                  })
                }
              />
            ))}
            <NumberField
              label="烟道高度"
              min={100}
              max={10000}
              value={shaft.height}
              onChange={(v) =>
                s.commit((d) => {
                  d.shafts.find((a) => a.id === shaft.id)!.height = v;
                })
              }
            />
          </div>
          <p className="help">
            可在画布拖动位置。烟道占地从房间净面积和铺装用量中扣除；修改房间整体尺寸时同步调整。
          </p>
        </Section>
      )}
      {furniture && (
        <Section title="家具属性">
          <TextField
            label="名称"
            value={furniture.name}
            onChange={(v) =>
              s.commit((d) => {
                d.furniture.find((f) => f.id === furniture.id)!.name = v;
              })
            }
          />
          <div className="fields">
            {(['cx', 'cy', 'w', 'd', 'rot'] as const).map((key) => (
              <NumberField
                key={key}
                label={{ cx: '中心 X', cy: '中心 Y', w: '宽度', d: '深度', rot: '旋转角度' }[key]}
                value={furniture[key]}
                min={key === 'w' || key === 'd' ? 10 : key === 'rot' ? -360 : -100000}
                max={key === 'rot' ? 360 : key === 'w' || key === 'd' ? 20000 : 100000}
                unit={key === 'rot' ? '°' : 'mm'}
                onChange={(v) =>
                  s.commit((d) => {
                    d.furniture.find((f) => f.id === furniture.id)![key] = v;
                  })
                }
              />
            ))}
          </div>
          <label className="field">
            <span>颜色</span>
            <input
              type="color"
              value={furniture.color}
              onChange={(e) =>
                s.commit((d) => {
                  d.furniture.find((f) => f.id === furniture.id)!.color = e.target.value;
                })
              }
            />
          </label>
        </Section>
      )}
      {device && (
        <Section title={deviceStyle(device).name}>
          {device.kind !== 'pipe' && (
            <label className="field">
              <span>点位类型</span>
              <select
                aria-label="点位类型"
                value={resolvedDeviceKind(device)}
                onChange={(e) =>
                  s.commit((d) => {
                    const item = d.devices.find((v) => v.id === device.id)!;
                    item.kind = e.target.value as DeviceKind;
                    item.name = DEVICE_KINDS[item.kind].name;
                    delete item.autoUtility;
                    for (const r of d.routes.filter(
                      (r) => r.startDeviceId === item.id || r.endDeviceId === item.id,
                    ))
                      detachUtilityRoute(r);
                  })
                }
              >
                {Object.entries(DEVICE_KINDS)
                  .filter(([k]) => k !== 'water' && k !== 'pipe')
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {['acindoor', 'acoutdoor'].includes(device.kind) && (
            <label className="field">
              <span>空调设备形式</span>
              <select
                aria-label="空调设备形式"
                value={device.acMode ?? 'split'}
                onChange={(e) =>
                  s.commit((d) => {
                    d.devices.find((v) => v.id === device.id)!.acMode = e.target.value as 'split' | 'central';
                  })
                }
              >
                <option value="split">分体空调</option>
                <option value="central">中央空调</option>
              </select>
            </label>
          )}
          {device.kind === 'pipe' && (
            <>
              <label className="field">
                <span>管道用途</span>
                <select
                  aria-label="管道用途"
                  value={device.pipeSystem ?? 'unknown'}
                  onChange={(e) =>
                    s.commit((d) => {
                      d.devices.find((v) => v.id === device.id)!.pipeSystem = e.target.value as
                        'drain' | 'water' | 'unknown';
                    })
                  }
                >
                  <option value="unknown">待核对竖管</option>
                  <option value="drain">排水立管</option>
                  <option value="water">给水立管</option>
                </select>
              </label>
              <NumberField
                label="管道外径"
                value={device.diameter ?? 110}
                min={10}
                max={1000}
                step={1}
                onChange={(v) =>
                  s.commit((d) => {
                    d.devices.find((a) => a.id === device.id)!.diameter = v;
                  })
                }
              />
              <label className="field">
                <span>常见管径</span>
                <select
                  aria-label="常见管径"
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      s.commit((d) => {
                        d.devices.find((a) => a.id === device.id)!.diameter = Number(e.target.value);
                      });
                  }}
                >
                  <option value="">选择外径预设…</option>
                  {[...new Set([...(p.reference?.pipeSettings?.diameters ?? []), ...PIPE_DIAMETERS])]
                    .sort((a, b) => a - b)
                    .map((v) => (
                      <option key={v} value={v}>
                        Ø{v} mm
                      </option>
                    ))}
                </select>
              </label>
              <p className="help">外径以实际产品为准，不等同于 DN 公称直径。可拖动位置，或输入坐标微调。</p>
            </>
          )}
          <TextField
            label="点位名称"
            value={device.name}
            onChange={(v) =>
              s.commit((d) => {
                d.devices.find((a) => a.id === device.id)!.name = v;
              })
            }
          />
          <TextField
            label="回路 / 管路分组"
            value={device.circuit}
            onChange={(v) =>
              s.commit((d) => {
                d.devices.find((a) => a.id === device.id)!.circuit = v;
              })
            }
          />
          <div className="fields">
            {(['x', 'y', 'height', 'rotation'] as const).map((key) => (
              <NumberField
                key={key}
                label={
                  {
                    x: '位置 X',
                    y: '位置 Y',
                    height: device.kind === 'pipe' ? '竖管高度' : '离地高度',
                    rotation: '旋转',
                  }[key]
                }
                value={device[key]}
                min={key === 'height' ? 0 : key === 'rotation' ? -360 : -100000}
                max={key === 'height' ? 10000 : key === 'rotation' ? 360 : 100000}
                unit={key === 'rotation' ? '°' : 'mm'}
                onChange={(v) =>
                  s.commit((d) => {
                    d.devices.find((a) => a.id === device.id)![key] = v;
                  })
                }
              />
            ))}
          </div>
        </Section>
      )}
      {route && (
        <>
          <Section title={routeStyle(route).name}>
            {route.kind === 'power' && (
              <label className="field">
                <span>强电回路用途</span>
                <select
                  aria-label="强电回路用途"
                  value={route.powerUse ?? 'socket'}
                  onChange={(e) =>
                    s.commit((d) => {
                      d.routes.find((r) => r.id === route.id)!.powerUse = e.target.value as Route['powerUse'];
                    })
                  }
                >
                  <option value="socket">插座回路</option>
                  <option value="lighting">开关 / 照明回路</option>
                  <option value="ac">空调专用回路</option>
                </select>
              </label>
            )}
            <TextField
              label="回路 / 管路分组"
              value={route.circuit}
              onChange={(v) =>
                s.commit((d) => {
                  d.routes.find((a) => a.id === route.id)!.circuit = v;
                })
              }
            />
            <div className="fields">
              <NumberField
                label="管径 / 线管直径"
                min={1}
                max={1000}
                value={route.diameter}
                onChange={(v) =>
                  s.commit((d) => {
                    d.routes.find((a) => a.id === route.id)!.diameter = v;
                  })
                }
              />
              <NumberField
                label="水平段离地高度"
                min={0}
                max={10000}
                value={route.height}
                onChange={(v) =>
                  s.commit((d) => {
                    d.routes.find((a) => a.id === route.id)!.height = v;
                  })
                }
              />
            </div>
            <div className="estimate">
              <span>平面路径长度</span>
              <strong>{(length(route.points) / 1000).toFixed(2)} m</strong>
            </div>
            {route.startDeviceId || route.endDeviceId ? (
              <>
                <div className="estimate">
                  <span>含竖向连接段</span>
                  <strong>{routeLengths(p, route).total.toFixed(2)} m</strong>
                </div>
                <p className="help">
                  自动管线连接点位高度，移动点位会联动端点；编辑线路节点后转为手动管线。改变墙体后请重新生成并检查路径。
                </p>
              </>
            ) : (
              <p className="help">长度不含连接点位的竖向段；工程清单需结合现场复核。</p>
            )}
          </Section>
          <Section title="线路节点">
            <div className="vertex-list">
              {route.points.map((pt, i) => (
                <div key={i}>
                  <b>{i + 1}</b>
                  {([0, 1] as const).map((axis) => (
                    <NumberField
                      key={axis}
                      label={axis ? 'Y' : 'X'}
                      value={pt[axis]}
                      onChange={(v) =>
                        s.commit((d) => {
                          const item = d.routes.find((a) => a.id === route.id)!;
                          detachUtilityRoute(item);
                          item.points[i][axis] = v;
                        })
                      }
                    />
                  ))}
                  <button
                    title="删除节点"
                    disabled={route.points.length <= 2}
                    onClick={() =>
                      s.commit((d) => {
                        const item = d.routes.find((a) => a.id === route.id)!;
                        detachUtilityRoute(item);
                        item.points.splice(i, 1);
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
      {sel?.kind === 'wall' && !wall && (
        <Section title="房间边界墙">
          <p className="help">
            这面墙由房间轮廓生成。选中相邻房间并编辑顶点或边界墙厚度；取消「随轮廓生成边界墙」可改用独立墙体。
          </p>
        </Section>
      )}
      {(wall || opening || measure) &&
        (() => {
          const item = wall || opening || measure!;
          const edit = (fn: (v: typeof item) => void) =>
            s.commit((d) => {
              if (wall && !d.walls.some((w) => w.id === wall.id)) {
                const copy = structuredClone(wall);
                fn(copy);
                const owner = d.rooms.find((r) => wall.id.startsWith(`${r.id}:edge:`));
                const index = Number(wall.id.split(':edge:')[1]);
                if (owner) {
                  owner.poly[index] = copy.a;
                  owner.poly[(index + 1) % owner.poly.length] = copy.b;
                }
                return;
              }
              const list = wall ? d.walls : opening ? d.openings : d.measures;
              fn(list.find((v) => v.id === item.id)!);
            });
          return (
            <Section
              title={
                wall
                  ? '墙体属性'
                  : opening
                    ? { door: '门洞', window: '窗户', threshold: '门槛石', railing: '开放阳台 · 玻璃护栏' }[
                        opening.type
                      ]
                    : '尺寸标注'
              }
            >
              <div className="fields">
                {(['a', 'b'] as const).flatMap((end, i) =>
                  ([0, 1] as const).map((axis) => (
                    <NumberField
                      key={`${end}${axis}`}
                      label={`${i ? '终' : '起'}点 ${axis ? 'Y' : 'X'}`}
                      value={item[end][axis]}
                      onChange={(v) =>
                        edit((o) => {
                          o[end][axis] = v;
                        })
                      }
                    />
                  )),
                )}
                {(wall || opening) && (
                  <NumberField
                    label={wall ? '墙厚' : '洞口进深'}
                    value={wall ? wall.width : resolvedOpening(opening!, allWalls(p)).width}
                    min={20}
                    max={2000}
                    onChange={(v) =>
                      s.commit((d) => {
                        if (wall) setWallWidth(d, wall.id, v);
                        else {
                          const o = d.openings.find((o) => o.id === opening!.id)!;
                          o.width = v;
                          o.autoDepth = false;
                        }
                      })
                    }
                  />
                )}
                <NumberField
                  label="长度"
                  value={distance(item.a, item.b)}
                  min={50}
                  max={100000}
                  onChange={(v) =>
                    edit((o) => {
                      const old = distance(o.a, o.b) || 1;
                      o.b = [o.a[0] + ((o.b[0] - o.a[0]) * v) / old, o.a[1] + ((o.b[1] - o.a[1]) * v) / old];
                    })
                  }
                />
                {wall && p.walls.some((w) => w.id === wall.id) && (
                  <NumberField
                    label="墙高"
                    value={wall.height}
                    min={100}
                    max={10000}
                    onChange={(v) =>
                      s.commit((d) => {
                        d.walls.find((w) => w.id === wall.id)!.height = v;
                      })
                    }
                  />
                )}
              </div>
              {wall && p.walls.some((w) => w.id === wall.id) && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={wall.bearing}
                    onChange={(e) =>
                      s.commit((d) => {
                        d.walls.find((w) => w.id === wall.id)!.bearing = e.target.checked;
                      })
                    }
                  />
                  标记为承重墙
                </label>
              )}
              {opening && (
                <>
                  {opening.type === 'railing' && (
                    <>
                      <NumberField
                        label="护栏高度"
                        min={300}
                        max={2200}
                        value={opening.railingHeight ?? 1100}
                        onChange={(v) =>
                          s.commit((d) => {
                            d.openings.find((o) => o.id === opening.id)!.railingHeight = v;
                          })
                        }
                      />
                      <p className="help">
                        下部玻璃护栏，上方敞开。两端为护栏范围，转换后该范围不再生成窗台墙或窗上墙。
                      </p>
                    </>
                  )}
                  {opening.type !== 'threshold' && (
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={opening.autoDepth !== false}
                        onChange={(e) =>
                          s.commit((d) => {
                            d.openings.find((o) => o.id === opening.id)!.autoDepth = e.target.checked;
                          })
                        }
                      />
                      洞口进深跟随墙厚
                    </label>
                  )}
                  {opening.type !== 'threshold' && opening.type !== 'railing' && (
                    <div className="fields">
                      <NumberField
                        label="洞口净高"
                        value={opening.height ?? (opening.type === 'window' ? 1300 : 2100)}
                        min={100}
                        max={6000}
                        onChange={(v) =>
                          s.commit((d) => {
                            d.openings.find((o) => o.id === opening.id)!.height = v;
                          })
                        }
                      />
                      {opening.type === 'window' && (
                        <NumberField
                          label="窗台离地"
                          value={opening.sill ?? 900}
                          min={0}
                          max={5000}
                          onChange={(v) =>
                            s.commit((d) => {
                              d.openings.find((o) => o.id === opening.id)!.sill = v;
                            })
                          }
                        />
                      )}
                    </div>
                  )}
                  {opening.type === 'window' && (
                    <>
                      <label className="field">
                        <span>窗型</span>
                        <select
                          aria-label="窗型"
                          value={opening.windowStyle ?? 'flat'}
                          onChange={(e) =>
                            s.commit((d) => {
                              d.openings.find((o) => o.id === opening.id)!.windowStyle = e.target.value as
                                'flat' | 'bay';
                            })
                          }
                        >
                          <option value="flat">平窗</option>
                          <option value="bay">矩形飘窗</option>
                        </select>
                      </label>
                      {opening.windowStyle === 'bay' && (
                        <>
                          <NumberField
                            label="飘窗挑出深度"
                            min={100}
                            max={3000}
                            value={opening.bayDepth ?? 600}
                            onChange={(v) =>
                              s.commit((d) => {
                                d.openings.find((o) => o.id === opening.id)!.bayDepth = v;
                              })
                            }
                          />
                          <button
                            className="wide secondary"
                            onClick={() =>
                              s.commit((d) => {
                                const o = d.openings.find((o) => o.id === opening.id)!;
                                o.baySide = (o.baySide ?? -1) === -1 ? 1 : -1;
                              })
                            }
                          >
                            翻转飘窗朝向
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {opening.type === 'door' && (
                    <>
                      <div className="fields">
                        {(['jambStart', 'jambEnd'] as const).map((key, i) => (
                          <NumberField
                            key={key}
                            label={i ? '终点门垛预留' : '起点门垛预留'}
                            value={opening[key] ?? 0}
                            min={0}
                            max={Math.min(
                              1000,
                              Math.max(
                                0,
                                distance(opening.a, opening.b) -
                                  (opening[i ? 'jambStart' : 'jambEnd'] ?? 0) -
                                  50,
                              ),
                            )}
                            step={10}
                            onChange={(v) =>
                              s.commit((d) => {
                                d.openings.find((o) => o.id === opening.id)![key] = v;
                              })
                            }
                          />
                        ))}
                      </div>
                      <p className="help">
                        洞口净宽（含门框）：
                        {Math.round(
                          distance(
                            resolvedOpening(opening, allWalls(p)).a,
                            resolvedOpening(opening, allWalls(p)).b,
                          ),
                        )}{' '}
                        mm。端点自动避让相交墙体；门垛预留在当前跨度内收窄洞口，不扩大原有开口。
                      </p>
                      <label className="field">
                        <span>门型</span>
                        <select
                          aria-label="门型"
                          value={opening.doorStyle ?? 'swing'}
                          onChange={(e) =>
                            s.commit((d) => {
                              d.openings.find((o) => o.id === opening.id)!.doorStyle = e.target.value as
                                'swing' | 'sliding';
                            })
                          }
                        >
                          <option value="swing">平开门</option>
                          <option value="sliding">推拉门</option>
                        </select>
                      </label>
                      {opening.doorStyle === 'sliding' ? (
                        <NumberField
                          label="推拉开启比例"
                          min={0}
                          max={100}
                          step={5}
                          unit="%"
                          value={opening.slideOpen ?? 0}
                          onChange={(v) =>
                            s.commit((d) => {
                              d.openings.find((o) => o.id === opening.id)!.slideOpen = v;
                            })
                          }
                        />
                      ) : (
                        <>
                          <NumberField
                            label="门扇开启角度"
                            min={0}
                            max={110}
                            step={5}
                            unit="°"
                            value={opening.openAngle ?? 90}
                            onChange={(v) =>
                              s.commit((d) => {
                                d.openings.find((o) => o.id === opening.id)!.openAngle = v;
                              })
                            }
                          />
                          <div className="fields">
                            <button
                              onClick={() =>
                                s.commit((d) => {
                                  const o = d.openings.find((o) => o.id === opening.id)!;
                                  o.hinge = o.hinge === 'b' ? 'a' : 'b';
                                })
                              }
                            >
                              合页：{opening.hinge === 'b' ? '终点' : '起点'}
                            </button>
                            <button
                              onClick={() =>
                                s.commit((d) => {
                                  const o = d.openings.find((o) => o.id === opening.id)!;
                                  o.swing = (o.swing ?? -1) === -1 ? 1 : -1;
                                })
                              }
                            >
                              翻转开门方向
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                  {opening.autoDepth !== false && opening.type !== 'threshold' && (
                    <p className="help">
                      {openingHost(opening, allWalls(p))
                        ? '已匹配相邻墙体，修改墙厚后洞口和门窗框同步更新。'
                        : '未匹配到墙体，暂用手动进深；可将洞口拖到墙轴线上。'}
                    </p>
                  )}
                </>
              )}
              {opening && (
                <label className="field">
                  <span>洞口类型</span>
                  <select
                    aria-label="洞口类型"
                    value={opening.type}
                    onChange={(e) =>
                      s.commit((d) => {
                        d.openings.find((o) => o.id === opening.id)!.type = e.target.value as
                          'door' | 'window' | 'threshold' | 'railing';
                      })
                    }
                  >
                    <option value="door">门洞</option>
                    <option value="window">窗户</option>
                    <option value="threshold">门槛石</option>
                    <option value="railing">开放阳台（玻璃护栏）</option>
                  </select>
                </label>
              )}
              {opening && (
                <label className="field">
                  <span>颜色</span>
                  <input
                    type="color"
                    value={opening.color}
                    onChange={(e) =>
                      s.commit((d) => {
                        d.openings.find((o) => o.id === opening.id)!.color = e.target.value;
                      })
                    }
                  />
                </label>
              )}
            </Section>
          );
        })()}
      <WallAreaPanel />
      <Section title="空间统计">
        <div className="metrics">
          <div>
            <strong>
              {total.toFixed(1)}
              <small> ㎡</small>
            </strong>
            <span>铺装计量面积</span>
          </div>
          <div>
            <strong>
              {p.rooms.length}
              <small> 间</small>
            </strong>
            <span>房间 / 空间</span>
          </div>
        </div>
        <div className="room-list">
          {p.rooms.map((r) => (
            <button
              key={r.id}
              className={room?.id === r.id ? 'active' : ''}
              onClick={() => {
                s.select({ kind: 'room', id: r.id });
                s.setTool('select');
              }}
            >
              <i style={{ background: floorFor(p, r).color }} />
              <span>{r.name}</span>
              <small>{usableArea(p, r).toFixed(1)} ㎡</small>
            </button>
          ))}
        </div>
        {!p.rooms.length && <p className="help">从左侧绘制房间，或上传户型图生成。</p>}
      </Section>
      <Section title="水电与材料">
        <div className="summary-row">
          <span>设备点位</span>
          <b>{p.devices.length} 个</b>
        </div>
        {Object.entries(ROUTE_KINDS).map(([key, v]) => (
          <div className="summary-row" key={key}>
            <span>
              <i style={{ background: v.color }} />
              {v.name}
            </span>
            <b>
              {(
                p.routes.filter((r) => r.kind === key).reduce((a, r) => a + length(r.points), 0) / 1000
              ).toFixed(2)}{' '}
              m
            </b>
          </div>
        ))}
        <div className="summary-row">
          <span>门槛石</span>
          <b>{p.openings.filter((o) => o.type === 'threshold').length} 处</b>
        </div>
        <div className="estimate">
          <span>地面材料估算</span>
          <strong>¥ {Math.ceil(cost).toLocaleString()}</strong>
        </div>
        <button className="wide secondary" onClick={exportList}>
          <Download size={14} />
          导出材料 / 点位清单
        </button>
      </Section>
      <Section title="画布图层">
        <div className="layer-grid">
          {Object.entries({
            grid: '网格',
            labels: '房间名称',
            furniture: '家具',
            flooring: '铺装缝线',
            utilities: '水电点位',
            dimensions: '尺寸标注',
          }).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={s.layers[key as keyof typeof s.layers]}
                onChange={(e) => s.setLayers((v) => ({ ...v, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
      </Section>
    </aside>
  );
}
