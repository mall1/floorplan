import { useState } from 'react';
import { useStudio } from './StudioContext';
import { NumberField } from './Fields';
import { area, bounds, distance, uid, validPolygon } from '../model/geometry';
import { imagePoint, imageLocalPoint } from '../model/files';
import { mergeRoomPolygons, splitRoomPolygon, trimInteriorLine } from '../model/room-topology';
import { regionArea } from '../model/space-geometry';
import type { Point } from '../model/types';
export default function CandidateEditor() {
  const s = useStudio(),
    ref = s.project.reference,
    edit = s.candidateEdit,
    rec = s.recognition;
  const [second, setSecond] = useState(''),
    [gap, setGap] = useState(400),
    [correctWalls, setCorrectWalls] = useState(true),
    [addWall, setAddWall] = useState(true);
  if (!ref || !rec || !s.candidates.length) return null;
  const factor = ref.width / ref.pixelWidth;
  const avoidOverlap = (world: Point[], ignore: string[]) => {
    if (
      s.candidates
        .filter((c) => !ignore.includes(c.id))
        .some((c) => {
          const poly = c.poly.map((p) => imagePoint(ref, p));
          return area(world) + area(poly) - regionArea([world, poly]) > 0.01;
        })
    )
      throw Error('新轮廓与其他候选房间重叠，请先调整边界');
  };
  const current = s.candidates.find((v) => v.id === edit?.id);
  const act = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      s.notify((e as Error).message);
    }
  };
  const split = () => {
    if (!edit || edit.line.length !== 2) return null;
    try {
      return splitRoomPolygon(
        edit.poly.map((p) => imagePoint(ref, p)),
        imagePoint(ref, edit.line[0]),
        imagePoint(ref, edit.line[1]),
      );
    } catch {
      return null;
    }
  };
  const parts = split();
  return (
    <div className="candidate-editor" data-testid="candidate-editor">
      <h4>修正房间分区</h4>
      <label className="field">
        <span>编辑候选房间</span>
        <select
          aria-label="编辑候选房间"
          value={current?.id ?? ''}
          onChange={(e) => {
            const c = s.candidates.find((v) => v.id === e.target.value);
            s.setCandidateEdit(
              c ? { id: c.id, poly: structuredClone(c.poly), line: [], drawing: false } : null,
            );
            s.setTool('select');
          }}
        >
          <option value="">选择房间，或点击画布候选</option>
          {s.candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {edit && current && (
        <>
          <p className="help">
            拖动高亮轮廓顶点修正位置；蓝橙色预览表示切分后的两个房间。所有调整在导入前完成。
          </p>
          <details>
            <summary>精确调整顶点位置</summary>
            <div className="candidate-vertices">
              {edit.poly.map((p, i) => {
                const at = imagePoint(ref, p);
                return (
                  <div className="fields" key={i}>
                    {([0, 1] as const).map((axis) => (
                      <NumberField
                        key={axis}
                        label={`候选顶点 ${i + 1} ${axis ? 'Y' : 'X'}`}
                        value={at[axis]}
                        onChange={(v) =>
                          s.setCandidateEdit((old) => {
                            if (!old) return old;
                            const world: Point = [...at];
                            world[axis] = v;
                            return {
                              ...old,
                              poly: old.poly.map((pt, j) => (j === i ? imageLocalPoint(ref, world) : pt)),
                            };
                          })
                        }
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </details>
          <button
            className="wide secondary"
            onClick={() =>
              act(() => {
                if (!validPolygon(edit.poly.map((p) => imagePoint(ref, p))))
                  throw Error('轮廓不能相交或面积过小，请调整顶点');
                avoidOverlap(
                  edit.poly.map((p) => imagePoint(ref, p)),
                  [edit.id],
                );
                s.editCandidates(
                  s.candidates.map((c) =>
                    c.id === edit.id
                      ? {
                          ...c,
                          poly: edit.poly,
                          areaPixels: area(edit.poly) * 1e6,
                          typeReason: '手动修正轮廓',
                        }
                      : c,
                  ),
                  rec,
                );
                s.notify('候选轮廓已更新，可撤销候选编辑');
              })
            }
          >
            应用轮廓调整
          </button>
          <label className="field">
            <span>合并到另一个房间</span>
            <select aria-label="另一个候选房间" value={second} onChange={(e) => setSecond(e.target.value)}>
              <option value="">选择相邻房间</option>
              {s.candidates
                .filter((c) => c.id !== edit.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <NumberField label="允许隔墙间距" value={gap} min={0} max={1000} onChange={setGap} />
          <label className="check-row">
            <input
              type="checkbox"
              checked={correctWalls}
              onChange={(e) => setCorrectWalls(e.target.checked)}
            />
            同步修正合并区域内部识别墙和门洞
          </label>
          <button
            className="wide secondary"
            disabled={!second || second === edit.id}
            onClick={() =>
              act(() => {
                const other = s.candidates.find((c) => c.id === second);
                if (!other) throw Error('请重新选择另一个房间');
                const world = mergeRoomPolygons(
                  edit.poly.map((p) => imagePoint(ref, p)),
                  other.poly.map((p) => imagePoint(ref, p)),
                  gap,
                );
                const poly = world.map((p) => imageLocalPoint(ref, p)),
                  next = structuredClone(rec);
                avoidOverlap(world, [edit.id, other.id]);
                if (correctWalls) {
                  next.walls = next.walls.flatMap((w) => {
                    const h = w.w >= w.h,
                      a: Point = h ? [w.x, w.y + w.h / 2] : [w.x + w.w / 2, w.y],
                      b: Point = h ? [w.x + w.w, w.y + w.h / 2] : [w.x + w.w / 2, w.y + w.h];
                    return trimInteriorLine(
                      a,
                      b,
                      poly,
                      w.widthMm === undefined ? Math.min(w.w, w.h) : w.widthMm / factor,
                    )
                      .filter(([a, b]) => distance(a, b) > 0.1)
                      .map(([a, b]) => ({
                        ...w,
                        x: h ? Math.min(a[0], b[0]) : w.x,
                        y: h ? w.y : Math.min(a[1], b[1]),
                        w: h ? distance(a, b) : w.w,
                        h: h ? w.h : distance(a, b),
                      }));
                  });
                  next.openings = next.openings.map((o) =>
                    trimInteriorLine(o.a, o.b, poly, o.width).length ? o : { ...o, selected: false },
                  );
                  next.extraWalls = (next.extraWalls ?? []).flatMap((w) =>
                    trimInteriorLine(w.a, w.b, poly, w.width).map(([a, b]) => ({ ...w, a, b })),
                  );
                }
                s.editCandidates(
                  s.candidates
                    .filter((c) => c.id !== other.id)
                    .map((c) =>
                      c.id === edit.id
                        ? {
                            ...c,
                            name: `${c.name} / ${other.name}`.slice(0, 150),
                            kind: c.kind === other.kind ? c.kind : 'unknown',
                            poly,
                            areaPixels: area(poly) * 1e6,
                            selected: true,
                            typeReason: '手动合并，请核对用途',
                          }
                        : c,
                    ),
                  next,
                );
                setSecond('');
                s.notify('两个候选房间已合并，可撤销候选编辑');
              })
            }
          >
            合并两个候选房间
          </button>
          <div className="fields">
            {(['vertical', 'horizontal'] as const).map((axis) => (
              <button
                key={axis}
                className="secondary"
                onClick={() => {
                  const b = bounds(edit.poly);
                  s.setCandidateEdit({
                    ...edit,
                    line:
                      axis === 'vertical'
                        ? [
                            [b.x + b.w / 2, b.y],
                            [b.x + b.w / 2, b.y + b.h],
                          ]
                        : [
                            [b.x, b.y + b.h / 2],
                            [b.x + b.w, b.y + b.h / 2],
                          ],
                    drawing: false,
                  });
                }}
              >
                {axis === 'vertical' ? '竖向分割' : '横向分割'}
              </button>
            ))}
          </div>
          <button
            className="wide secondary"
            onClick={() => {
              s.setTool('select');
              s.setCandidateEdit({ ...edit, line: [], drawing: true });
              s.notify('在画布点击分割线两端；可在房间外点击，完成后拖动蓝色端点调整');
            }}
          >
            在画布画分割线
          </button>
          {edit.line.length === 2 && (
            <details open>
              <summary>分割线位置 · 可拖动蓝色端点</summary>
              <div className="candidate-vertices">
                {edit.line.map((p, i) => {
                  const at = imagePoint(ref, p);
                  return (
                    <div className="fields" key={i}>
                      {([0, 1] as const).map((axis) => (
                        <NumberField
                          key={axis}
                          label={`分割端点 ${i + 1} ${axis ? 'Y' : 'X'}`}
                          value={at[axis]}
                          onChange={(v) => {
                            const pt: Point = [...at];
                            pt[axis] = v;
                            s.setCandidateEdit({
                              ...edit,
                              line: edit.line.map((p, j) => (i === j ? imageLocalPoint(ref, pt) : p)),
                            });
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </details>
          )}
          <label className="check-row">
            <input type="checkbox" checked={addWall} onChange={(e) => setAddWall(e.target.checked)} />
            沿分割线添加隔墙
          </label>
          <p className="help">
            {parts
              ? `切分面积：${area(parts.polys[0]).toFixed(2)} / ${area(parts.polys[1]).toFixed(2)} ㎡`
              : '请设置一条穿过房间的分割线；复杂凹形一次只分为两块。'}
          </p>
          <button
            className="wide primary"
            disabled={!parts}
            onClick={() =>
              act(() => {
                const split = splitRoomPolygon(
                  edit.poly.map((p) => imagePoint(ref, p)),
                  imagePoint(ref, edit.line[0]),
                  imagePoint(ref, edit.line[1]),
                );
                const children = split.polys.map((poly, i) => ({
                  ...current,
                  id: i ? uid() : current.id,
                  name: `${current.name} ${i + 1}`.slice(0, 150),
                  poly: poly.map((p) => imageLocalPoint(ref, p)),
                  selected: true,
                  boundary: false,
                  areaPixels: (area(poly) * 1e6) / factor ** 2,
                  typeReason: '手动切分，请核对用途',
                }));
                const next = structuredClone(rec);
                for (const poly of split.polys) avoidOverlap(poly, [edit.id]);
                if (!rec.importWalls && current.boundary !== false)
                  next.extraWalls = [
                    ...(next.extraWalls ?? []),
                    ...edit.poly.map((a, i) => ({
                      a,
                      b: edit.poly[(i + 1) % edit.poly.length],
                      width: (ref.wallSettings?.thin ?? 120) / factor,
                    })),
                  ];
                if (addWall)
                  next.extraWalls = [
                    ...(next.extraWalls ?? []),
                    {
                      a: imageLocalPoint(ref, split.seam[0]),
                      b: imageLocalPoint(ref, split.seam[1]),
                      width: (ref.wallSettings?.thin ?? 120) / factor,
                    },
                  ];
                s.editCandidates(
                  s.candidates.flatMap((c) => (c.id === edit.id ? children : [c])),
                  next,
                );
                s.notify('已切分为两个候选房间，可分别命名和设置用途');
              })
            }
          >
            确认切分为两个房间
          </button>
          <button className="wide secondary" onClick={() => s.setCandidateEdit(null)}>
            取消当前调整
          </button>
        </>
      )}
      <button className="wide secondary" disabled={!s.canUndoCandidateEdit} onClick={s.undoCandidateEdit}>
        撤销候选编辑
      </button>
    </div>
  );
}
