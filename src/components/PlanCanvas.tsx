import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from './StudioContext';
import RecognitionOverlay from './RecognitionOverlay';
import SpaceAnalysisOverlay from './SpaceAnalysisOverlay';
import UtilityPreviewOverlay from './UtilityPreviewOverlay';
import { detachUtilityRoute, syncUtilityConnections } from '../model/utility-connections';
import {
  allWalls,
  bounds,
  center,
  roomCenter,
  distance,
  inside,
  move,
  projectBounds,
  projectPoint,
  rect,
  snapPoint,
  uid,
  validPolygon,
} from '../model/geometry';
import { resolvedOpening, wallFootprint } from '../model/architecture';
import { usableArea } from '../model/shafts';
import { floorFor, floorInFrame, tilePolygons } from '../model/flooring';
import { DEVICE_KINDS, ROUTE_KINDS } from '../model/presets';
import { imagePoint } from '../model/files';
import { furnSVG } from '../render/furniture-svg';
import type { Point, Project, Selection } from '../model/types';
const points = (p: Point[]) => p.map((v) => v.join(',')).join(' ');
const FloorTiles = memo(function FloorTiles({
  poly,
  floor,
  id,
}: {
  poly: Point[];
  floor: ReturnType<typeof floorFor>;
  id: string;
}) {
  const tiles = useMemo(() => tilePolygons(poly, floor), [poly, floor]);
  if (tiles.length >= 16000) {
    const at = center(poly);
    return (
      <g pointerEvents="none">
        <polygon points={points(poly)} fill={floor.color} />
        <text x={at[0]} y={at[1] + 450} fontSize="150" textAnchor="middle" fill="#786951">
          铺装过密，请增大板砖规格
        </text>
      </g>
    );
  }
  return (
    <g pointerEvents="none">
      <defs>
        <clipPath id={`floor-${id}`}>
          <polygon points={points(poly)} />
        </clipPath>
      </defs>
      <g clipPath={`url(#floor-${id})`}>
        <polygon points={points(poly)} fill={floor.grout} />
        {tiles.map((p, i) => (
          <polygon key={i} points={points(p)} fill={floor.color} />
        ))}
      </g>
    </g>
  );
});
interface Drag {
  start: Point;
  before: Project;
  selection: Selection;
  index?: number;
  pan?: { x: number; y: number; w: number; h: number };
  preview?: Project;
  flooring?: boolean;
}
export default function PlanCanvas({
  fitToken,
  zoomToken,
}: {
  fitToken: number;
  zoomToken: { seq: number; factor: number };
}) {
  const s = useStudio(),
    svg = useRef<SVGSVGElement>(null),
    [view, setView] = useState({ x: -1200, y: -1200, w: 14600, h: 13200 }),
    [draft, setDraft] = useState<Point[]>([]),
    [hover, setHover] = useState<Point | null>(null),
    [preview, setPreview] = useState<Project | null>(null),
    [space, setSpace] = useState(false);
  const drag = useRef<Drag | null>(null),
    p = preview || s.project,
    wallList = useMemo(() => allWalls(p), [p]),
    openingList = useMemo(() => p.openings.map((o) => resolvedOpening(o, wallList)), [p.openings, wallList]);
  const radius = svg.current?.getScreenCTM() ? 7 / svg.current.getScreenCTM()!.a : 100;
  const local = (e: { clientX: number; clientY: number }): Point => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [pt.x, pt.y];
  };
  const fit = () => {
    const b = projectBounds(s.project),
      pad = Math.max(b.w, b.h) * 0.1 + 300;
    setView({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad });
  };
  useEffect(fit, [fitToken]);
  useEffect(() => {
    if (!zoomToken.seq) return;
    setView((v) => {
      const w = v.w * zoomToken.factor,
        h = v.h * zoomToken.factor;
      if (w < 1500 || w > 250000) return v;
      return { ...v, x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
    });
  }, [zoomToken]);
  useEffect(() => {
    setDraft([]);
    setHover(null);
    drag.current = null;
    setPreview(null);
  }, [s.tool, s.project.reference?.src]);
  const finish = (poly = draft) => {
    if (s.tool === 'polygon') {
      const clean = poly.filter((v, i) => !i || distance(v, poly[i - 1]) > 1);
      if (clean.length > 3 && distance(clean[0], clean.at(-1)!) < 1) clean.pop();
      if (!validPolygon(clean)) {
        s.notify('房间至少需要三个顶点，边线不能相交');
        return;
      }
      const id = uid();
      s.commit((d) =>
        d.rooms.push({
          id,
          name: `房间 ${d.rooms.length + 1}`,
          poly: clean,
          flooring: structuredClone(d.globalFlooring),
          boundary: true,
          counted: true,
          wallWidth: 200,
        }),
      );
      s.select({ kind: 'room', id });
      setDraft([]);
      s.setTool('select');
    } else if (s.tool === 'route') {
      const clean = poly.filter((v, i) => !i || distance(v, poly[i - 1]) > 1);
      if (clean.length < 2) {
        s.notify('管线至少需要两个点');
        return;
      }
      const id = uid();
      s.commit((d) =>
        d.routes.push({
          id,
          kind: s.routeKind,
          points: clean,
          circuit: s.circuit || '未分组',
          diameter: ROUTE_KINDS[s.routeKind].diameter,
          height: 0,
        }),
      );
      s.select({ kind: 'route', id });
      setDraft([]);
    }
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,select,textarea')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setSpace(true);
      }
      if (e.key === 'Escape') {
        setDraft([]);
        setPreview(null);
        drag.current = null;
        s.setTool('select');
      }
      if (e.key === 'Enter') finish();
      if (e.key === 'Backspace' && draft.length) {
        e.preventDefault();
        setDraft(draft.slice(0, -1));
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [draft, s.tool, s.routeKind, s.circuit]);
  const snap = (point: Point, e: { altKey: boolean; shiftKey: boolean }) => {
    if (s.tool === 'calibrate') return point;
    let result = e.altKey ? point : snapPoint(point);
    if (s.tool === 'route' && !e.altKey) {
      const device = p.devices
        .map((d) => ({ point: [d.x, d.y] as Point, d: distance(point, [d.x, d.y]) }))
        .sort((a, b) => a.d - b.d)[0];
      if (device && device.d < radius * 3) return device.point;
    }
    if (draft.length && (s.tool === 'route' || e.shiftKey) && !e.altKey) {
      const a = draft.at(-1)!;
      result =
        Math.abs(result[0] - a[0]) > Math.abs(result[1] - a[1]) ? [result[0], a[1]] : [a[0], result[1]];
    }
    if (['door', 'window', 'railing', 'threshold'].includes(s.tool)) {
      const nearest = wallList
        .map((w) => projectPoint(point, w.a, w.b))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearest && nearest.distance < radius * 4) result = nearest.point;
    }
    return result;
  };
  const addPoint = (pos: Point) => {
    if (s.tool === 'device') {
      const id = uid(),
        preset = DEVICE_KINDS[s.deviceKind];
      s.commit((d) =>
        d.devices.push({
          id,
          kind: s.deviceKind,
          x: pos[0],
          y: pos[1],
          height: preset.height,
          name: preset.name,
          circuit: s.circuit || '未分组',
          rotation: 0,
          ...(s.deviceKind === 'pipe' ? { diameter: 110, pipeSystem: 'unknown' as const } : {}),
        }),
      );
      s.select({ kind: 'device', id });
      return;
    }
    if (s.tool === 'polygon' && draft.length >= 3 && distance(pos, draft[0]) < radius * 2) {
      finish();
      return;
    }
    if (
      [
        'rectangle',
        'shaft',
        'wall',
        'door',
        'window',
        'railing',
        'threshold',
        'measure',
        'calibrate',
      ].includes(s.tool) &&
      draft.length === 1
    ) {
      const a = draft[0],
        b = pos,
        id = uid();
      if (distance(a, b) < 20) {
        s.notify('两点距离过短');
        return;
      }
      if (s.tool === 'rectangle') {
        const poly = rect(a, b);
        if (!validPolygon(poly)) {
          s.notify('房间面积过小');
          return;
        }
        s.commit((d) =>
          d.rooms.push({
            id,
            name: `房间 ${d.rooms.length + 1}`,
            poly,
            flooring: structuredClone(d.globalFlooring),
            boundary: true,
            counted: true,
            wallWidth: 200,
          }),
        );
        s.select({ kind: 'room', id });
      }
      if (s.tool === 'wall') {
        s.commit((d) => d.walls.push({ id, a, b, width: 200, bearing: false, height: 2800 }));
        s.select({ kind: 'wall', id });
      }
      if (s.tool === 'shaft') {
        const poly = rect(a, b);
        if (Math.min(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) < 50) {
          s.notify('烟道宽深至少 50 mm');
          return;
        }
        s.commit((d) => d.shafts.push({ id, name: '烟道', poly, height: 2800 }));
        s.select({ kind: 'shaft', id });
        s.setTool('select');
      }
      if (['door', 'window', 'railing', 'threshold'].includes(s.tool)) {
        const type = s.tool as 'door' | 'window' | 'railing' | 'threshold';
        s.commit((d) =>
          d.openings.push({
            id,
            a,
            b,
            type,
            width: type === 'threshold' ? 160 : 240,
            color: type === 'threshold' ? '#8c8376' : type === 'railing' ? '#65939a' : '#b9a58c',
          }),
        );
        s.select({ kind: 'opening', id });
      }
      if (s.tool === 'measure') s.commit((d) => d.measures.push({ id, a, b }));
      if (s.tool === 'calibrate') {
        const factor = s.calibrationLength / distance(a, b);
        if (p.reference && p.reference.width * factor >= 100 && p.reference.width * factor <= 200000) {
          s.commit((d) => {
            if (d.reference) {
              d.reference.width *= factor;
              d.reference.calibrated = true;
            }
          });
          s.notify('比例已校准，可开始识别或描绘房间');
          s.setTool('select');
        } else {
          s.notify('校准比例超出范围，请检查已知尺寸');
        }
      }
      setDraft([]);
      return;
    }
    setDraft((v) => (v.length && distance(v.at(-1)!, pos) < 1 ? v : [...v, pos]));
  };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    // Commit the focused field while it still belongs to the previous selection.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    const raw = local(e);
    svg.current!.setPointerCapture(e.pointerId);
    if (space || e.button === 1 || s.tool === 'pan') {
      drag.current = { start: raw, before: p, selection: null, pan: { ...view } };
      return;
    }
    if (s.tool === 'floor-move' || s.tool === 'floor-origin') {
      const room = [...p.rooms]
        .reverse()
        .find((r) => inside(raw, r.poly) || r.poly.some((pt) => distance(pt, raw) < radius * 3));
      if (!room) return;
      const selection = { kind: 'room' as const, id: room.id };
      s.select(selection);
      if (s.tool === 'floor-origin') {
        const nearest = room.poly.map((pt) => ({ pt, d: distance(pt, raw) })).sort((a, b) => a.d - b.d)[0];
        const at = nearest.d < radius * 3 ? nearest.pt : e.altKey ? raw : snapPoint(raw, 10);
        s.commit((d) => {
          floorFor(
            d,
            d.rooms.find((r) => r.id === room.id)!,
          ).origin = [...at];
        });
      } else drag.current = { start: raw, before: p, selection, flooring: true };
      return;
    }
    if (s.tool !== 'select') {
      addPoint(snap(raw, e));
      return;
    }
    const target = (e.target as Element).closest('[data-kind]') as SVGElement | null;
    const selection = target ? ({ kind: target.dataset.kind, id: target.dataset.id } as Selection) : null;
    s.select(selection);
    if (selection) {
      const index = target!.dataset.index;
      drag.current = {
        start: raw,
        before: p,
        selection,
        index: index === undefined ? undefined : Number(index),
      };
    }
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const raw = local(e);
    setHover(snap(raw, e));
    const d = drag.current;
    if (!d) return;
    if (d.pan) {
      const dx = raw[0] - d.start[0],
        dy = raw[1] - d.start[1];
      setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
      return;
    }
    if (!d.selection) return;
    const delta: Point = e.altKey
      ? [raw[0] - d.start[0], raw[1] - d.start[1]]
      : snapPoint([raw[0] - d.start[0], raw[1] - d.start[1]], d.flooring ? 10 : 50);
    if (distance(delta, [0, 0]) < 1) {
      d.preview = undefined;
      setPreview(null);
      return;
    }
    const next = structuredClone(d.before),
      { kind, id } = d.selection;
    if (d.flooring) {
      const f = floorFor(
        next,
        next.rooms.find((r) => r.id === id)!,
      );
      f.origin = move(f.origin, delta);
      d.preview = next;
      setPreview(next);
      return;
    }
    if (kind === 'room') {
      const r = next.rooms.find((v) => v.id === id)!;
      r.poly = r.poly.map((v, i) => (d.index === undefined || d.index === i ? move(v, delta) : v));
    }
    if (kind === 'furniture') {
      const f = next.furniture.find((v) => v.id === id)!;
      f.cx += delta[0];
      f.cy += delta[1];
    }
    if (kind === 'shaft') {
      const shaft = next.shafts.find((v) => v.id === id)!;
      shaft.poly = shaft.poly.map((v) => move(v, delta));
    }
    if (kind === 'device') {
      const f = next.devices.find((v) => v.id === id)!;
      f.x += delta[0];
      f.y += delta[1];
    }
    if (kind === 'route') {
      const r = next.routes.find((v) => v.id === id)!;
      detachUtilityRoute(r);
      r.points = r.points.map((v, i) => (d.index === undefined || d.index === i ? move(v, delta) : v));
    }
    if (kind === 'wall' || kind === 'opening' || kind === 'measure') {
      const arr = kind === 'wall' ? next.walls : kind === 'opening' ? next.openings : next.measures;
      const item = arr.find((v) => v.id === id);
      if (item) {
        if (d.index !== 1) item.a = move(item.a, delta);
        if (d.index !== 0) item.b = move(item.b, delta);
      }
    }
    syncUtilityConnections(next);
    d.preview = next;
    setPreview(next);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setPreview(null);
    if (d?.preview) {
      if (d.preview.rooms.some((r) => !validPolygon(r.poly))) {
        s.notify('轮廓边线不能相交，已恢复原位置');
        return;
      }
      s.commit(d.preview);
    }
  };
  const selected = s.selection;
  const activeRoom = p.rooms.find((r) => selected?.kind === 'room' && r.id === selected.id),
    activeRoute = p.routes.find((r) => selected?.kind === 'route' && r.id === selected.id);
  const handles = (poly: Point[], kind: NonNullable<Selection>['kind'], id: string) =>
    poly.map((v, i) => (
      <circle
        key={i}
        data-editor-only="true"
        data-kind={kind}
        data-id={id}
        data-index={i}
        cx={v[0]}
        cy={v[1]}
        r={radius}
        fill="#fff"
        stroke="#2d7169"
        strokeWidth={radius / 3}
        style={{ cursor: 'grab' }}
      >
        <title>拖动顶点 {i + 1}</title>
      </circle>
    ));
  const transient = draft.length && hover ? [...draft, hover] : draft;
  return (
    <svg
      id="plan-canvas"
      ref={svg}
      role="img"
      aria-label="可编辑的户型设计画布"
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if (s.tool === 'polygon' || s.tool === 'route') finish();
        else if (s.tool === 'select') {
          const at = local(e);
          const edges = p.rooms
            .flatMap((r) =>
              r.poly.map((a, i) => ({
                r,
                i,
                a,
                b: r.poly[(i + 1) % r.poly.length],
                hit: projectPoint(at, a, r.poly[(i + 1) % r.poly.length]),
              })),
            )
            .sort((a, b) => a.hit.distance - b.hit.distance);
          const edge = edges[0];
          if (
            edge &&
            edge.hit.distance < radius * 2 &&
            distance(edge.a, edge.hit.point) > radius &&
            distance(edge.b, edge.hit.point) > radius
          ) {
            s.commit((d) => {
              const r = d.rooms.find((r) => r.id === edge.r.id)!;
              r.poly.splice(edge.i + 1, 0, edge.hit.point);
              r.edgeWidths = undefined;
            });
            s.select({ kind: 'room', id: edge.r.id });
          }
        }
      }}
      onWheel={(e) => {
        const a = local(e),
          factor = e.deltaY > 0 ? 1.12 : 0.89;
        setView((v) => {
          if (v.w * factor < 1500 || v.w * factor > 250000) return v;
          return {
            x: a[0] + (v.x - a[0]) * factor,
            y: a[1] + (v.y - a[1]) * factor,
            w: v.w * factor,
            h: v.h * factor,
          };
        });
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('application/furniture');
        if (!raw) return;
        try {
          const it = JSON.parse(raw);
          if (!Array.isArray(it) || it.length !== 5) return;
          const [x, y] = snapPoint(local(e)),
            id = uid();
          s.commit((d) =>
            d.furniture.push({
              id,
              type: String(it[0]),
              name: String(it[1]),
              w: Number(it[2]),
              d: Number(it[3]),
              color: String(it[4]),
              cx: x,
              cy: y,
              rot: 0,
            }),
          );
          s.select({ kind: 'furniture', id });
          s.setTool('select');
        } catch {
          /* ignore unsupported drops */
        }
      }}
      style={{ cursor: space || s.tool === 'pan' ? 'grab' : s.tool !== 'select' ? 'crosshair' : 'default' }}
    >
      <defs>
        <pattern id="grid-small" width="250" height="250" patternUnits="userSpaceOnUse">
          <path
            d="M 250 0 L 0 0 0 250"
            fill="none"
            stroke="#dedbd2"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </pattern>
        <pattern id="grid-big" width="1000" height="1000" patternUnits="userSpaceOnUse">
          <rect width="1000" height="1000" fill="url(#grid-small)" />
          <path
            d="M 1000 0 L 0 0 0 1000"
            fill="none"
            stroke="#ccc7bc"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </pattern>
      </defs>
      <rect x={view.x - 250000} y={view.y - 250000} width={500000} height={500000} fill="#f2f1eb" />
      {s.layers.grid && (
        <rect
          x={view.x - 250000}
          y={view.y - 250000}
          width={500000}
          height={500000}
          fill="url(#grid-big)"
          opacity=".5"
          pointerEvents="none"
        />
      )}
      {p.reference?.visible && (
        <image
          href={p.reference.src}
          x="0"
          y="0"
          width={p.reference.width}
          height={(p.reference.width * p.reference.pixelHeight) / p.reference.pixelWidth}
          transform={`translate(${p.reference.x},${p.reference.y}) rotate(${p.reference.rotation})`}
          opacity={p.reference.opacity}
          pointerEvents="none"
        />
      )}
      {p.rooms.map((r) => (
        <g key={r.id}>
          <polygon
            data-kind="room"
            data-id={r.id}
            points={points(r.poly)}
            fill={floorFor(p, r).color}
            fillOpacity={p.reference?.visible && s.workspace === 'plan' ? 0.3 : 1}
            stroke="#b4aa98"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {s.layers.flooring && <FloorTiles poly={r.poly} floor={floorFor(p, r)} id={r.id} />}
        </g>
      ))}
      <SpaceAnalysisOverlay background />
      {wallList.map((w) => (
        <g key={w.id} data-kind="wall" data-id={w.id}>
          <polygon points={points(wallFootprint(w, wallList))} fill={w.bearing ? '#444b47' : '#747a71'} />
          <line
            x1={w.a[0]}
            y1={w.a[1]}
            x2={w.b[0]}
            y2={w.b[1]}
            stroke="transparent"
            strokeWidth={Math.max(w.width, radius * 2)}
          />
        </g>
      ))}
      {openingList.map((o) => {
        const len = distance(o.a, o.b),
          angle = (Math.atan2(o.b[1] - o.a[1], o.b[0] - o.a[0]) * 180) / Math.PI;
        return (
          <g key={o.id} data-kind="opening" data-id={o.id} transform={`translate(${o.a}) rotate(${angle})`}>
            <rect
              x="0"
              y={-o.width / 2}
              width={len}
              height={o.width}
              fill={
                o.type === 'threshold'
                  ? o.color
                  : o.type === 'door' && p.continuous
                    ? p.globalFlooring.color
                    : '#f4f2ec'
              }
              stroke={o.color}
              strokeWidth={15}
            />
            {o.type === 'door' && p.continuous && s.layers.flooring && (
              <FloorTiles
                poly={rect([0, -o.width / 2], [len, o.width / 2])}
                floor={floorInFrame(p.globalFlooring, o.a, angle)}
                id={`${o.id}-opening`}
              />
            )}
            {o.type === 'railing' ? (
              <g data-testid="railing-plan" stroke="#65939a" fill="#b7dce0">
                <rect x={0} y={-20} width={len} height={40} strokeWidth={12} />
                {Array.from({ length: Math.max(1, Math.ceil(len / 1100)) + 1 }, (_, i) => (
                  <rect
                    key={i}
                    x={(len * i) / Math.max(1, Math.ceil(len / 1100)) - 20}
                    y={-30}
                    width={40}
                    height={60}
                  />
                ))}
              </g>
            ) : o.type === 'window' ? (
              <>
                {o.windowStyle === 'bay' && (
                  <g data-testid="bay-window-plan">
                    <rect
                      x={0}
                      y={(o.baySide ?? -1) < 0 ? -o.width / 2 - (o.bayDepth ?? 600) : -o.width / 2}
                      width={len}
                      height={o.width + (o.bayDepth ?? 600)}
                      fill="#cee2e1"
                      fillOpacity=".75"
                      stroke="#65939a"
                      strokeWidth={30}
                    />
                    <line
                      x1={0}
                      y1={(o.baySide ?? -1) * (o.width / 2 + (o.bayDepth ?? 600) - 50)}
                      x2={len}
                      y2={(o.baySide ?? -1) * (o.width / 2 + (o.bayDepth ?? 600) - 50)}
                      stroke="#65939a"
                      strokeWidth={20}
                    />
                  </g>
                )}
                <line x1="0" y1={-o.width / 4} x2={len} y2={-o.width / 4} stroke="#65939a" strokeWidth={25} />
                <line x1="0" y1={o.width / 4} x2={len} y2={o.width / 4} stroke="#65939a" strokeWidth={25} />
              </>
            ) : o.type === 'door' && o.doorStyle === 'sliding' ? (
              <g data-testid="sliding-door-plan" stroke="#587c81" strokeWidth={18}>
                <path d={`M 0 ${-o.width * 0.38} H ${len} M 0 ${o.width * 0.38} H ${len}`} fill="none" />
                <rect
                  x={((len / 2 - 30) * (o.slideOpen ?? 0)) / 100}
                  y={-o.width * 0.3}
                  width={len / 2 + 15}
                  height={Math.min(40, o.width * 0.25)}
                  fill="#bdd9dc"
                />
                <rect
                  x={len / 2 - 15}
                  y={o.width * 0.1}
                  width={len / 2 + 15}
                  height={Math.min(40, o.width * 0.25)}
                  fill="#bdd9dc"
                />
              </g>
            ) : o.type === 'door' ? (
              <g
                transform={`translate(${o.hinge === 'b' ? len : 0},0) scale(${o.hinge === 'b' ? -1 : 1},${-(o.swing ?? -1)})`}
              >
                <path
                  d={`M ${len} 0 A ${len} ${len} 0 0 0 0 ${-len}`}
                  fill="none"
                  stroke={o.color}
                  strokeWidth={15}
                  pointerEvents="none"
                />
                <line
                  x1="0"
                  y1="0"
                  x2={Math.cos(((o.openAngle ?? 90) * Math.PI) / 180) * len}
                  y2={-Math.sin(((o.openAngle ?? 90) * Math.PI) / 180) * len}
                  stroke={o.color}
                  strokeWidth={40}
                />
              </g>
            ) : (
              <line x1="0" y1="0" x2={len} y2="0" stroke="#fff" strokeOpacity=".35" strokeWidth={10} />
            )}
          </g>
        );
      })}
      {p.shafts.map((shaft) => {
        const at = center(shaft.poly),
          active = selected?.kind === 'shaft' && selected.id === shaft.id;
        return (
          <g
            key={shaft.id}
            data-kind="shaft"
            data-id={shaft.id}
            data-testid="shaft-plan"
            style={{ cursor: 'move' }}
          >
            <polygon
              points={points(shaft.poly)}
              fill="#ded9d0"
              stroke={active ? '#2d7169' : '#79756c'}
              strokeWidth={active ? 35 : 20}
            />
            <path
              d={`M ${shaft.poly[0]} L ${shaft.poly[2]} M ${shaft.poly[1]} L ${shaft.poly[3]}`}
              stroke="#9d978c"
              strokeWidth={12}
              pointerEvents="none"
            />
            {s.layers.labels && (
              <text
                x={at[0]}
                y={at[1]}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.min(120, distance(shaft.poly[0], shaft.poly[1]) / 3)}
                fill="#554f46"
                paintOrder="stroke"
                stroke="#ded9d0"
                strokeWidth={25}
                pointerEvents="none"
              >
                {shaft.name}
              </text>
            )}
          </g>
        );
      })}
      {s.layers.furniture &&
        p.furniture.map((f) => (
          <g
            key={f.id}
            data-kind="furniture"
            data-id={f.id}
            transform={`translate(${f.cx},${f.cy}) rotate(${f.rot})`}
            style={{ cursor: 'move' }}
          >
            <rect x={-f.w / 2} y={-f.d / 2} width={f.w} height={f.d} fill="transparent" />
            <g dangerouslySetInnerHTML={{ __html: furnSVG(f.type, f.w, f.d, f.color) }} />
            {selected?.kind === 'furniture' && selected.id === f.id && (
              <rect
                x={-f.w / 2 - 40}
                y={-f.d / 2 - 40}
                width={f.w + 80}
                height={f.d + 80}
                fill="none"
                stroke="#2d7169"
                strokeWidth={20}
              />
            )}
          </g>
        ))}
      {s.layers.labels &&
        p.rooms
          .filter((r) => !r.counted || !(p.analysis?.showAreas || p.analysis?.showTypes))
          .map((r) => {
            const c = roomCenter(r.poly);
            return (
              <g key={r.id} pointerEvents="none" transform={`translate(${c})`}>
                <rect
                  x={-Math.max(330, r.name.length * 75)}
                  y="-120"
                  width={Math.max(660, r.name.length * 150)}
                  height="430"
                  rx="60"
                  fill="#fffdf7"
                  fillOpacity=".87"
                />
                <text
                  textAnchor="middle"
                  fontSize="170"
                  fontWeight="600"
                  fill="#38473f"
                  fontFamily="sans-serif"
                >
                  {r.name}
                </text>
                <text y="225" textAnchor="middle" fontSize="145" fill="#7e887c" fontFamily="sans-serif">
                  {usableArea(p, r).toFixed(2)} ㎡
                </text>
              </g>
            );
          })}
      {s.layers.utilities && (
        <>
          {p.routes.map((r) => (
            <g key={r.id} data-kind="route" data-id={r.id}>
              <title>
                {r.circuit} · {ROUTE_KINDS[r.kind].name} · 水平段 H {r.height} mm
              </title>
              <polyline points={points(r.points)} fill="none" stroke="transparent" strokeWidth={radius * 3} />
              <polyline
                points={points(r.points)}
                fill="none"
                stroke={ROUTE_KINDS[r.kind].color}
                strokeWidth={selected?.id === r.id ? 55 : 35}
                strokeDasharray={r.kind === 'weak' ? '90 60' : undefined}
                strokeLinejoin="round"
              />
            </g>
          ))}
          {p.devices.map((d) => {
            const kind = DEVICE_KINDS[d.kind],
              color = d.autoUtility ? ROUTE_KINDS[d.autoUtility.system].color : kind.color;
            if (d.kind === 'pipe')
              return (
                <g
                  key={d.id}
                  data-kind="device"
                  data-id={d.id}
                  data-testid="pipe-plan"
                  transform={`translate(${d.x},${d.y})`}
                  style={{ cursor: 'move' }}
                >
                  <title>
                    {d.name} · 外径 Ø{d.diameter ?? 110} mm
                  </title>
                  <circle r={Math.max((d.diameter ?? 110) / 2, radius)} fill="transparent" />
                  <circle
                    r={(d.diameter ?? 110) / 2}
                    fill="#fffdf8"
                    stroke={selected?.id === d.id ? '#203d38' : kind.color}
                    strokeWidth={Math.min(12, (d.diameter ?? 110) / 8)}
                  />
                  {s.layers.labels && (
                    <text
                      x={(d.diameter ?? 110) / 2 + 25}
                      y={30}
                      fontSize={100}
                      fill={kind.color}
                      pointerEvents="none"
                    >
                      Ø{d.diameter ?? 110}
                    </text>
                  )}
                </g>
              );
            return (
              <g
                key={d.id}
                data-kind="device"
                data-id={d.id}
                transform={`translate(${d.x},${d.y}) rotate(${d.rotation})`}
                style={{ cursor: 'move' }}
              >
                <title>
                  {d.name} · H {d.height} mm
                </title>
                <rect
                  x="-130"
                  y="-130"
                  width="260"
                  height="260"
                  rx={d.kind === 'light' ? 130 : 30}
                  fill="#fffdf8"
                  stroke={selected?.id === d.id ? '#203d38' : color}
                  strokeWidth={25}
                />
                <text
                  textAnchor="middle"
                  y="55"
                  fontSize="150"
                  fill={color}
                  fontFamily="sans-serif"
                  pointerEvents="none"
                >
                  {kind.symbol}
                </text>
              </g>
            );
          })}
        </>
      )}
      {s.layers.dimensions &&
        p.measures.map((m) => {
          const c = center([m.a, m.b]);
          return (
            <g key={m.id} data-kind="measure" data-id={m.id}>
              <line x1={m.a[0]} y1={m.a[1]} x2={m.b[0]} y2={m.b[1]} stroke="#6a8279" strokeWidth="20" />
              <text
                x={c[0]}
                y={c[1] - 80}
                textAnchor="middle"
                fontSize="150"
                fill="#426254"
                fontFamily="sans-serif"
              >
                {Math.round(distance(m.a, m.b))} mm
              </text>
            </g>
          );
        })}
      {activeRoom && s.tool === 'select' && (
        <g data-editor-only="true">
          <polygon
            points={points(activeRoom.poly)}
            fill="none"
            stroke="#28786c"
            strokeWidth={radius / 3}
            pointerEvents="none"
          />
          {handles(activeRoom.poly, 'room', activeRoom.id)}
        </g>
      )}
      {activeRoute && s.tool === 'select' && handles(activeRoute.points, 'route', activeRoute.id)}
      {selected &&
        ['wall', 'opening', 'measure'].includes(selected.kind) &&
        (() => {
          const item = (
            selected.kind === 'wall' ? p.walls : selected.kind === 'opening' ? p.openings : p.measures
          ).find((v) => v.id === selected.id);
          return item ? handles([item.a, item.b], selected.kind, item.id) : null;
        })()}
      {p.reference && s.recognition?.source === p.reference.src && (
        <RecognitionOverlay result={s.recognition} reference={p.reference} />
      )}
      {p.reference &&
        s.candidates
          .filter((c) => c.selected)
          .map((c, i) => {
            const poly = c.poly.map((pt) => imagePoint(p.reference!, pt)),
              at = center(poly);
            return (
              <g key={c.id} pointerEvents="none">
                <polygon
                  points={points(poly)}
                  fill="#54ad9b"
                  fillOpacity=".3"
                  stroke="#237d6d"
                  strokeWidth="25"
                  strokeDasharray="90 50"
                />
                <text x={at[0]} y={at[1]} textAnchor="middle" fontSize="210" fill="#184f43" fontWeight="bold">
                  {i + 1} · {c.name}
                </text>
              </g>
            );
          })}
      {s.workspace === 'flooring' &&
        activeRoom &&
        (() => {
          const floor = floorFor(p, activeRoom),
            at = floor.origin;
          return (
            <g
              data-editor-only="true"
              data-testid="floor-origin-marker"
              pointerEvents="none"
              transform={`translate(${at}) rotate(${floor.angle})`}
            >
              <circle r={radius * 1.7} fill="#fff" stroke="#2d7169" strokeWidth={radius / 3} />
              <path
                d={`M ${-radius * 3} 0 H ${radius * 5} M 0 ${-radius * 3} V ${radius * 5}`}
                stroke="#2d7169"
                strokeWidth={radius / 3}
              />
              <text
                transform={`rotate(${-floor.angle})`}
                x={radius * 2}
                y={-radius * 2}
                fontSize={radius * 2}
                fill="#24594f"
              >
                起铺点
              </text>
            </g>
          );
        })()}
      <SpaceAnalysisOverlay />
      <UtilityPreviewOverlay />
      {transient.length > 0 && (
        <g data-editor-only="true" pointerEvents="none">
          {['rectangle', 'shaft'].includes(s.tool) && transient.length >= 2 ? (
            <polygon
              points={points(rect(transient[0], transient.at(-1)!))}
              fill="#2d7169"
              fillOpacity=".12"
              stroke="#2d7169"
              strokeWidth={20}
            />
          ) : (
            <polyline
              points={points(transient)}
              fill={s.tool === 'polygon' ? '#2d716922' : 'none'}
              stroke={s.tool === 'route' ? ROUTE_KINDS[s.routeKind].color : '#2d7169'}
              strokeWidth={25}
              strokeDasharray="80 45"
            />
          )}
          {draft.map((v, i) => (
            <circle key={i} cx={v[0]} cy={v[1]} r={radius * 0.7} fill="#2d7169" />
          ))}
          {transient.length >= 2 && (
            <text x={transient.at(-1)![0] + 100} y={transient.at(-1)![1] - 100} fontSize="160" fill="#2d7169">
              {Math.round(distance(transient.at(-2)!, transient.at(-1)!))} mm
            </text>
          )}
        </g>
      )}
    </svg>
  );
}
