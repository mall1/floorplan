import {
  MousePointer2,
  RectangleHorizontal,
  Pentagon,
  BrickWall,
  DoorOpen,
  Square,
  Minus,
  Ruler,
  Plus,
  Cable,
} from 'lucide-react';
import { useState } from 'react';
import { useStudio } from './StudioContext';
import ReferenceControls from './ReferenceControls';
import FloorControls from './FloorControls';
import SpaceAnalysisPanel from './SpaceAnalysisPanel';
import { Section } from './Fields';
import { LIB } from '../data/original';
import { furnSVG } from '../render/furniture-svg';
import { DEVICE_KINDS, ROUTE_KINDS } from '../model/presets';
import { roomCenter, projectBounds, uid } from '../model/geometry';
import { joinWallAxes } from '../model/architecture';
import type { DeviceKind, Tool, UtilityKind } from '../model/types';
export default function Library({ onClose }: { onClose: () => void }) {
  const s = useStudio(),
    [category, setCategory] = useState('卧室'),
    [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const furnitureItems = LIB.flatMap((group) =>
    group.items
      .filter((item) =>
        query
          ? `${group.cat} ${item[0]} ${item[1]}`.toLowerCase().includes(query)
          : category === '全部' || group.cat === category,
      )
      .map((item) => ({ category: group.cat, item })),
  );
  const tools: { id: Tool; name: string; Icon: typeof Square }[] = [
    { id: 'select', name: '选择 / 编辑', Icon: MousePointer2 },
    { id: 'rectangle', name: '矩形房间', Icon: RectangleHorizontal },
    { id: 'polygon', name: '多边形房间', Icon: Pentagon },
    { id: 'wall', name: '绘制墙体', Icon: BrickWall },
    { id: 'door', name: '门洞', Icon: DoorOpen },
    { id: 'window', name: '窗户', Icon: Square },
    { id: 'measure', name: '测量', Icon: Ruler },
    { id: 'threshold', name: '门槛石', Icon: Minus },
    { id: 'railing', name: '玻璃护栏', Icon: Minus },
    { id: 'shaft', name: '烟道', Icon: Square },
  ];
  return (
    <aside className="library">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DESIGN TOOLKIT</span>
          <h2>
            {
              {
                plan: '户型设计',
                furniture: '家具布置',
                utilities: '水电布局',
                flooring: '地面铺装',
                analysis: '空间分析',
              }[s.workspace]
            }
          </h2>
        </div>
        <span className="step-number">
          0{['plan', 'furniture', 'utilities', 'flooring', 'analysis'].indexOf(s.workspace) + 1}
        </span>
        <button className="panel-close" aria-label="关闭工具面板" onClick={onClose}>
          ×
        </button>
      </div>
      {s.workspace === 'plan' && (
        <>
          <Section title="绘制与编辑">
            <div className="tool-grid">
              {tools.map(({ id, name, Icon }) => (
                <button key={id} className={s.tool === id ? 'active' : ''} onClick={() => s.setTool(id)}>
                  <Icon size={17} />
                  {name}
                </button>
              ))}
            </div>
            <p className="help">绘制房间后自动生成边界墙。选择房间可拖动顶点；双击边线插入顶点。</p>
            <button
              className="wide secondary"
              disabled={!s.project.walls.length}
              onClick={() => {
                s.commit((d) => joinWallAxes(d.walls));
                s.notify('已按墙厚校正相邻墙端的 L / T 接点，可撤销');
              }}
            >
              校正独立墙角
            </button>
          </Section>
          <ReferenceControls />
        </>
      )}
      {s.workspace === 'furniture' && (
        <>
          <Section title="家具分类">
            <label className="field furniture-search">
              <span>搜索家具</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索全部分类，如高低床、晾衣架"
              />
            </label>
            <div className="category-tabs">
              {['全部', ...LIB.map((g) => g.cat)].map((cat) => (
                <button
                  key={cat}
                  className={!query && category === cat ? 'active' : ''}
                  aria-pressed={!query && category === cat}
                  onClick={() => {
                    setCategory(cat);
                    setSearch('');
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
            <p className="help">点击添加到选中房间中央，或拖拽到画布；选择后可以调整尺寸和旋转。</p>
            <p className="help" role="status">
              {query ? '搜索结果' : category} · {furnitureItems.length} 款
            </p>
          </Section>
          {!furnitureItems.length && <p className="furniture-empty">没有找到匹配的家具，试试其他名称。</p>}
          <div className="furniture-grid">
            {furnitureItems.map(({ category: group, item: it }) => (
              <button
                key={`${group}-${it[1]}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/furniture', JSON.stringify(it));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => {
                  const r = s.project.rooms.find(
                      (r) => s.selection?.kind === 'room' && r.id === s.selection.id,
                    ),
                    b = projectBounds(s.project),
                    [x, y] = r ? roomCenter(r.poly) : [b.x + b.w / 2, b.y + b.h / 2],
                    id = uid();
                  s.commit((d) => {
                    d.furniture.push({
                      id,
                      type: String(it[0]),
                      name: String(it[1]),
                      w: Number(it[2]),
                      d: Number(it[3]),
                      cx: x,
                      cy: y,
                      rot: 0,
                      color: String(it[4]),
                    });
                  });
                  s.select({ kind: 'furniture', id });
                  s.setTool('select');
                }}
              >
                <svg
                  viewBox={`${-Number(it[2]) / 2 - 100} ${-Number(it[3]) / 2 - 100} ${Number(it[2]) + 200} ${Number(it[3]) + 200}`}
                  dangerouslySetInnerHTML={{ __html: furnSVG(it[0], it[2], it[3], it[4]) }}
                />
                <strong>{it[1]}</strong>
                <span>
                  {it[2]} × {it[3]}
                </span>
                <Plus size={12} className="add-badge" />
              </button>
            ))}
          </div>
        </>
      )}
      {s.workspace === 'utilities' && (
        <>
          <Section title="管线绘制" extra={<Cable size={16} />}>
            <div className="route-types">
              {Object.entries(ROUTE_KINDS).map(([key, v]) => (
                <button
                  className={s.tool === 'route' && s.routeKind === key ? 'active' : ''}
                  key={key}
                  onClick={() => {
                    s.setRouteKind(key as UtilityKind);
                    s.setTool('route');
                  }}
                >
                  <i style={{ background: v.color }} />
                  {v.name}
                </button>
              ))}
            </div>
            <label className="field">
              <span>回路 / 管路分组</span>
              <input
                maxLength={150}
                value={s.circuit}
                onChange={(e) => s.setCircuit(e.target.value)}
                placeholder="例如：厨房专用回路"
              />
            </label>
            <p className="help">
              连续点击布线，默认水平 / 垂直走线；按 Alt 自由走线。双击或 Enter 完成，Esc
              取消。端点靠近设备时吸附。
            </p>
          </Section>
          <Section title="插座、开关与用水点">
            <div className="device-grid">
              {Object.entries(DEVICE_KINDS).map(([key, v]) => (
                <button
                  key={key}
                  className={s.tool === 'device' && s.deviceKind === key ? 'active' : ''}
                  onClick={() => {
                    s.setDeviceKind(key as DeviceKind);
                    s.setTool('device');
                  }}
                >
                  <b style={{ color: v.color, borderColor: v.color }}>{v.symbol}</b>
                  <span>{v.name}</span>
                  <small>H {v.height} mm</small>
                </button>
              ))}
            </div>
            <p className="help">选中类型后在画布点击放置；点位与管线可编辑高度、分组及位置。</p>
          </Section>
        </>
      )}
      {s.workspace === 'flooring' && <FloorControls />}
      {s.workspace === 'analysis' && <SpaceAnalysisPanel />}
    </aside>
  );
}
