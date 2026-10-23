import { useMemo } from 'react';
import { useStudio } from './StudioContext';
import { DEFAULT_ANALYSIS, spaceMetrics } from '../model/space-analysis';
import { effectiveRoomKind, ROOM_TYPES } from '../model/room-types';
import { floorIgnored, furniturePolygon, storageTypes } from '../model/space-geometry';
import { bounds, roomCenter } from '../model/geometry';
import { FLOW_TYPES } from '../model/circulation';
export default function SpaceAnalysisOverlay({ background = false }: { background?: boolean }) {
  const s = useStudio(),
    p = s.project,
    settings = p.analysis ?? DEFAULT_ANALYSIS;
  const metrics = useMemo(
    () => (!background && settings.showAreas ? p.rooms.map((r) => spaceMetrics(p, [r])) : []),
    [p, settings.showAreas, background],
  );
  const points = (poly: number[][]) => poly.map((p) => p.join(',')).join(' ');
  if (background)
    return settings.showTypes ? (
      <g pointerEvents="none" data-testid="room-type-overlay">
        {p.rooms.map((r) => (
          <polygon
            key={r.id}
            points={points(r.poly)}
            fill={ROOM_TYPES[effectiveRoomKind(p, r)].color}
            fillOpacity=".3"
          />
        ))}
      </g>
    ) : null;
  return (
    <g pointerEvents="none" data-testid="space-analysis-overlay">
      <defs>
        {Object.entries(FLOW_TYPES).map(([kind, value]) => (
          <marker
            key={kind}
            id={`flow-arrow-${kind}`}
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill={value.color} />
          </marker>
        ))}
      </defs>
      {settings.showAreas &&
        p.furniture
          .filter((f) => !floorIgnored.has(f.type))
          .map((f) => (
            <polygon
              key={f.id}
              points={points(furniturePolygon(f))}
              fill={storageTypes.has(f.type) ? '#8a6aaf' : '#d59b58'}
              fillOpacity=".18"
              stroke={storageTypes.has(f.type) ? '#8a6aaf' : '#b8894e'}
              strokeWidth="12"
              strokeDasharray="40 25"
            />
          ))}
      {(settings.showAreas || settings.showTypes) &&
        p.rooms.map((r, i) => {
          if (!r.counted || !s.layers.labels) return null;
          const c = roomCenter(r.poly),
            a = metrics[i],
            kind = effectiveRoomKind(p, r);
          const hasTypeLine =
            settings.showTypes && (ROOM_TYPES[kind].label !== r.name || r.kind === undefined);
          const lines = [
            ...(hasTypeLine ? [ROOM_TYPES[kind].label + (r.kind === undefined ? ' · 推测' : '')] : []),
            ...(settings.showAreas
              ? [`活动 ${a.free.toFixed(1)} ㎡`, `收纳 ${a.storage.toFixed(1)} ㎡`]
              : []),
          ];
          const width = Math.max(1250, Math.min(2200, r.name.length * 175 + 180));
          const scale = Math.max(0.15, Math.min(1, (bounds(r.poly).w - 100) / width));
          return (
            <g key={r.id} data-testid="room-analysis-label" transform={`translate(${c}) scale(${scale})`}>
              <rect
                x={-width / 2}
                y={-150}
                width={width}
                height={240 + lines.length * 190}
                rx={70}
                fill="#fffdf7"
                fillOpacity=".92"
              />
              <text textAnchor="middle" fontSize="165" fontWeight="600" fill="#38473f">
                {r.name}
              </text>
              {lines.map((line, j) => (
                <text
                  key={j}
                  y={200 + j * 190}
                  textAnchor="middle"
                  fontSize="145"
                  fill={j === 0 && hasTypeLine ? ROOM_TYPES[kind].color : '#486054'}
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      {s.circulation.paths.map((path, i) =>
        path.status === 'clear' ? (
          <g key={i} data-testid="circulation-path">
            <title>
              {path.label} · {path.distance.toFixed(1)} m
            </title>
            <polyline
              points={points(path.points)}
              fill="none"
              stroke="#fffdf7"
              strokeWidth="70"
              strokeOpacity=".8"
              strokeLinejoin="round"
            />
            <polyline
              points={points(path.points)}
              fill="none"
              stroke={FLOW_TYPES[path.kind].color}
              strokeWidth="35"
              strokeLinejoin="round"
              markerEnd={`url(#flow-arrow-${path.kind})`}
            />
            <circle
              cx={path.points[0][0]}
              cy={path.points[0][1]}
              r="55"
              fill={FLOW_TYPES[path.kind].color}
              stroke="#fff"
              strokeWidth="15"
            />
          </g>
        ) : path.bottleneck ? (
          <g key={i} data-testid="circulation-blocked" transform={`translate(${path.bottleneck})`}>
            <title>
              {path.label}：{path.reason}
            </title>
            <circle r="170" fill="#fff1e9" fillOpacity=".8" stroke="#c45f4d" strokeWidth="25" />
            <path d="M-60,-60 L60,60 M60,-60 L-60,60" stroke="#c45f4d" strokeWidth="25" />
          </g>
        ) : null,
      )}
    </g>
  );
}
