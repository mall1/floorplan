import type { RecognitionPreview } from './StudioContext';
import type { ReferenceImage } from '../model/types';
import { bayFootprint } from '../model/architecture';
export default function RecognitionOverlay({
  result,
  reference,
}: {
  result: RecognitionPreview;
  reference: ReferenceImage;
}) {
  const factor = reference.width / reference.pixelWidth;
  const pipeLabels: { x: number; y: number }[] = [];
  for (const pipe of result.pipes) {
    const x = pipe.x + pipe.diameter / factor / 2 + 4;
    let y = pipe.y;
    while (pipeLabels.some((label) => Math.abs(label.x - x) < 75 && Math.abs(label.y - y) < 12)) y += 12;
    pipeLabels.push({ x, y });
  }
  return (
    <g
      data-editor-only="true"
      data-testid="recognition-overlay"
      pointerEvents="none"
      transform={`translate(${reference.x} ${reference.y}) rotate(${reference.rotation}) scale(${factor})`}
    >
      {result.showGrid && (
        <g stroke="#466b8f" strokeOpacity=".18" strokeWidth=".7" data-testid="recognition-grid">
          {result.grid.xs.map((x) => (
            <line key={`x${x}`} x1={x} x2={x} y1={0} y2={reference.pixelHeight} />
          ))}
          {result.grid.ys.map((y) => (
            <line key={`y${y}`} y1={y} y2={y} x1={0} x2={reference.pixelWidth} />
          ))}
        </g>
      )}
      {result.showWalls &&
        result.walls.map((r, i) => {
          const horizontal = r.w >= r.h,
            thickness = r.widthMm === undefined ? Math.min(r.w, r.h) : r.widthMm / factor;
          return (
            <rect
              key={i}
              x={horizontal ? r.x : r.x + (r.w - thickness) / 2}
              y={horizontal ? r.y + (r.h - thickness) / 2 : r.y}
              width={horizontal ? r.w : thickness}
              height={horizontal ? thickness : r.h}
              fill={r.kind === 'solid' ? '#e88b39' : r.kind === 'outline' ? '#9361d0' : '#d49c4f'}
              fillOpacity={r.kind === 'bridge' ? '.15' : '.5'}
              stroke={r.kind === 'outline' ? '#7b4bb6' : '#bb712e'}
              strokeWidth=".7"
              strokeDasharray={r.kind === 'bridge' ? '3 3' : undefined}
            />
          );
        })}
      {result.shafts.map((o, i) => (
        <g key={o.id} data-testid="recognized-shaft" opacity={o.selected ? 1 : 0.45}>
          <rect
            x={o.x}
            y={o.y}
            width={o.w}
            height={o.h}
            fill="#b66687"
            fillOpacity=".6"
            stroke="#983f68"
            strokeWidth={2}
          />
          <path
            d={`M ${o.x} ${o.y} l ${o.w} ${o.h} M ${o.x + o.w} ${o.y} l ${-o.w} ${o.h}`}
            stroke="#983f68"
          />
          <text x={o.x + o.w + 3} y={o.y + o.h / 2} fontSize={12} fill="#983f68">
            烟道 {i + 1}
          </text>
        </g>
      ))}
      {result.pipes.map((o, i) => (
        <g key={o.id} data-testid="recognized-pipe" opacity={o.selected ? 1 : 0.4}>
          <circle
            cx={o.x}
            cy={o.y}
            r={o.diameter / factor / 2}
            fill="#dce9dc"
            stroke="#356d49"
            strokeWidth={1.2}
          />
          {pipeLabels[i].y !== o.y && (
            <line
              x1={o.x}
              y1={o.y}
              x2={pipeLabels[i].x - 2}
              y2={pipeLabels[i].y - 3}
              stroke="#356d49"
              strokeWidth={0.6}
            />
          )}
          <text
            x={pipeLabels[i].x}
            y={pipeLabels[i].y}
            fontSize={10}
            fill="#356d49"
            paintOrder="stroke"
            stroke="white"
            strokeWidth={2}
          >
            管 {i + 1} · Ø{o.diameter}
          </text>
        </g>
      ))}
      {result.openings.map((o, i) => {
        const color = o.type === 'window' ? '#167db7' : '#c26120';
        return (
          <g key={o.id} opacity={o.selected ? 1 : 0.55} data-testid={`recognized-${o.type}`}>
            {o.type === 'door' &&
              o.doorStyle !== 'sliding' &&
              o.hinge &&
              o.swing &&
              (() => {
                const len = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]),
                  angle = (Math.atan2(o.b[1] - o.a[1], o.b[0] - o.a[0]) * 180) / Math.PI;
                return (
                  <g data-testid="recognized-door-direction" transform={`translate(${o.a}) rotate(${angle})`}>
                    <g
                      transform={`translate(${o.hinge === 'b' ? len : 0},0) scale(${o.hinge === 'b' ? -1 : 1},${o.swing})`}
                    >
                      <path
                        d={`M ${len} 0 A ${len} ${len} 0 0 1 0 ${len} M 0 0 L 0 ${len}`}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.5}
                      />
                      <circle r={2.5} fill={color} />
                    </g>
                  </g>
                );
              })()}
            {o.windowStyle === 'bay' && o.type === 'window' && (
              <polygon
                data-testid="recognized-bay-window"
                points={bayFootprint({ ...o, color: '#167db7' })
                  .map((p) => p.join(','))
                  .join(' ')}
                fill="#167db7"
                fillOpacity=".15"
                stroke={color}
                strokeWidth={2}
              />
            )}
            <line
              x1={o.a[0]}
              y1={o.a[1]}
              x2={o.b[0]}
              y2={o.b[1]}
              stroke={color}
              strokeWidth={Math.max(3, o.width * 0.4)}
              strokeDasharray={o.evidence === 'gap' ? '4 3' : undefined}
            />
            <circle cx={o.a[0]} cy={o.a[1]} r={2.5} fill="white" stroke={color} />
            <circle cx={o.b[0]} cy={o.b[1]} r={2.5} fill="white" stroke={color} />
            <text
              x={(o.a[0] + o.b[0]) / 2 + 6}
              y={(o.a[1] + o.b[1]) / 2 - 6}
              fontSize="12"
              fill={color}
              paintOrder="stroke"
              stroke="white"
              strokeWidth="3"
            >
              {o.type === 'railing'
                ? '玻璃护栏'
                : o.type === 'window'
                  ? o.windowStyle === 'bay'
                    ? '飘窗'
                    : '窗'
                  : o.doorStyle === 'sliding'
                    ? '推拉门'
                    : '门'}{' '}
              {i + 1}
            </text>
          </g>
        );
      })}
    </g>
  );
}
