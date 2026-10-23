import { Check, Layers } from 'lucide-react';
import { useStudio } from './StudioContext';
import { NumberField, Section } from './Fields';
import { FLOOR_PRESETS, PATTERNS } from '../model/presets';
import { floorFor } from '../model/flooring';
import { roomCenter } from '../model/geometry';
import { usableArea } from '../model/shafts';
import type { Flooring } from '../model/types';
export default function FloorControls() {
  const { project: p, selection, commit, notify, setTool, tool, select } = useStudio();
  const room = p.rooms.find((r) => selection?.kind === 'room' && r.id === selection.id);
  const floor = p.continuous ? p.globalFlooring : room?.flooring || p.globalFlooring;
  const update = (value: Partial<Flooring>) =>
    commit((d) => {
      const target = d.continuous
        ? d.globalFlooring
        : room
          ? d.rooms.find((r) => r.id === room.id)!.flooring
          : d.globalFlooring;
      Object.assign(target, value);
    });
  const total = p.rooms.filter((r) => r.counted).reduce((n, r) => n + usableArea(p, r), 0),
    a = p.continuous ? total : room ? usableArea(p, room) : 0;
  return (
    <>
      <Section title="铺装范围" extra={<Layers size={15} />}>
        <label className="field">
          <span>选择铺装房间</span>
          <select
            aria-label="选择铺装房间"
            value={room?.id ?? ''}
            onChange={(e) => select(e.target.value ? { kind: 'room', id: e.target.value } : null)}
          >
            <option value="">请选择房间</option>
            {p.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented">
          <button
            className={p.continuous ? 'active' : ''}
            onClick={() =>
              commit((d) => {
                d.globalFlooring = structuredClone(floor);
                d.continuous = true;
              })
            }
          >
            全屋通铺
          </button>
          <button
            className={!p.continuous ? 'active' : ''}
            onClick={() =>
              commit((d) => {
                if (d.continuous) d.rooms.forEach((r) => (r.flooring = structuredClone(d.globalFlooring)));
                d.continuous = false;
              })
            }
          >
            分房间铺设
          </button>
        </div>
        <p className="help">
          {p.continuous
            ? '所有房间共用尺寸、方向与起铺点，跨房间砖缝连续。'
            : room
              ? `正在编辑「${room.name}」的地面。`
              : '在画布选择房间后设置；当前设置作为新房间的默认值。'}
        </p>
      </Section>
      <Section title="排布与对齐">
        <div className="segmented">
          <button
            className={tool === 'floor-move' ? 'active' : ''}
            onClick={() => setTool(tool === 'floor-move' ? 'select' : 'floor-move')}
          >
            拖动排布
          </button>
          <button
            className={tool === 'floor-origin' ? 'active' : ''}
            onClick={() => setTool(tool === 'floor-origin' ? 'select' : 'floor-origin')}
          >
            点选起铺点
          </button>
        </div>
        {room && (
          <>
            <div className="anchor-grid">
              {room.poly.map((pt, i) => (
                <button key={i} title={`对齐房间顶点 ${i + 1}`} onClick={() => update({ origin: [...pt] })}>
                  角点 {i + 1}
                </button>
              ))}
              <button onClick={() => update({ origin: roomCenter(room.poly) })}>房间中心</button>
            </div>
            <label className="field">
              <span>沿房间边铺设</span>
              <select
                aria-label="沿房间边铺设"
                value=""
                onChange={(e) => {
                  const i = +e.target.value,
                    a = room.poly[i],
                    b = room.poly[(i + 1) % room.poly.length];
                  update({
                    origin: [...a],
                    angle:
                      (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI -
                      (floor.pattern === 'diagonal' || floor.pattern === 'herringbone' ? 45 : 0),
                  });
                }}
              >
                <option value="">选择基准边</option>
                {room.poly.map((_, i) => (
                  <option key={i} value={i}>
                    边 {i + 1} → {((i + 1) % room.poly.length) + 1}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <p className="help">
          起铺点为砖缝交点。拖动只移动铺装，不移动房间；通铺时调整全屋共用基准，分房间时单独保存。
        </p>
      </Section>
      <Section title="常用规格">
        <div className="preset-list">
          {FLOOR_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={floor.material === preset.id ? 'selected' : ''}
              onClick={() => update({ ...preset.value, origin: floor.origin })}
            >
              <i style={{ background: preset.value.color }} />
              <span>{preset.name}</span>
              {floor.material === preset.id && <Check size={13} />}
            </button>
          ))}
        </div>
      </Section>
      <Section title="铺法与尺寸">
        <div className="fields">
          <NumberField
            label="板 / 砖宽"
            value={floor.width}
            min={50}
            max={5000}
            onChange={(v) => update({ width: v, material: 'custom' })}
          />
          <NumberField
            label="板 / 砖长"
            value={floor.length}
            min={50}
            max={10000}
            onChange={(v) => update({ length: v, material: 'custom' })}
          />
          <NumberField
            label="留缝"
            value={floor.gap}
            min={0}
            max={30}
            step={0.5}
            onChange={(v) => update({ gap: v })}
          />
          <NumberField
            label="旋转角度"
            value={floor.angle}
            min={-360}
            max={360}
            unit="°"
            step={15}
            onChange={(v) => update({ angle: v })}
          />
        </div>
        <label className="field">
          <span>排布方式</span>
          <select
            value={floor.pattern}
            onChange={(e) => update({ pattern: e.target.value as Flooring['pattern'] })}
          >
            {Object.entries(PATTERNS).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="fields">
          <NumberField
            label="起铺点 X"
            value={floor.origin[0]}
            onChange={(v) => update({ origin: [v, floor.origin[1]] })}
          />
          <NumberField
            label="起铺点 Y"
            value={floor.origin[1]}
            onChange={(v) => update({ origin: [floor.origin[0], v] })}
          />
          <label className="field">
            <span>材料颜色</span>
            <input type="color" value={floor.color} onChange={(e) => update({ color: e.target.value })} />
          </label>
          <label className="field">
            <span>砖缝颜色</span>
            <input type="color" value={floor.grout} onChange={(e) => update({ grout: e.target.value })} />
          </label>
        </div>
        <button
          className="wide secondary"
          onClick={() => {
            commit((d) => d.rooms.forEach((r) => (r.flooring = structuredClone(floor))));
            notify('已将当前铺装应用到所有房间');
          }}
        >
          将当前规格应用到所有房间
        </button>
      </Section>
      <Section title="门口收口">
        <p className="help">
          通铺无需额外收口；需要分隔时，在门洞两端点击放置门槛石，可在属性中调整宽度和颜色。
        </p>
        <button className="wide secondary" onClick={() => setTool('threshold')}>
          ＋ 绘制门槛石
        </button>
      </Section>
      <Section title="材料估算">
        <div className="fields">
          <NumberField
            label="材料单价"
            value={floor.price}
            min={0}
            unit="元 / ㎡"
            onChange={(v) => update({ price: v })}
          />
          <NumberField
            label="预留损耗"
            value={floor.waste}
            min={0}
            max={100}
            unit="%"
            step={1}
            onChange={(v) => update({ waste: v })}
          />
        </div>
        <div className="estimate">
          <span>
            {a.toFixed(2)} ㎡ · 约{' '}
            {Math.ceil(((a * 1e6) / (floor.width * floor.length)) * (1 + floor.waste / 100))} 片
          </span>
          <strong>¥ {Math.ceil(a * (1 + floor.waste / 100) * floor.price).toLocaleString()}</strong>
        </div>
        <p className="help">按净面积加损耗估算，不含人工、辅料与门槛石；不是逐片切割清单。</p>
      </Section>
    </>
  );
}
