import { useStudio } from './StudioContext';
import { DEVICE_KINDS, ROUTE_KINDS } from '../model/presets';
export default function UtilityPreviewOverlay() {
  const s = useStudio(),
    preview = s.utilityPreview;
  if (!preview || s.workspace !== 'utilities') return null;
  return (
    <g data-testid="utility-preview-overlay" data-editor-only="true" pointerEvents="none">
      {preview.routes.map((r) => (
        <g key={r.id}>
          <title>
            {r.circuit} · H {r.height} mm
          </title>
          <polyline
            points={r.points.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke="#fff"
            strokeWidth={65}
          />
          <polyline
            points={r.points.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke={ROUTE_KINDS[r.kind].color}
            strokeWidth={35}
            strokeDasharray="90 40"
          />
        </g>
      ))}
      {preview.devices.map((d) => (
        <g key={d.id} transform={`translate(${d.x},${d.y})`}>
          <title>
            {d.name} · H {d.height} mm
          </title>
          <circle r={100} fill="#fffdf7" stroke={ROUTE_KINDS[d.autoUtility!.system].color} strokeWidth={25} />
          <text textAnchor="middle" y={45} fontSize={125} fill={ROUTE_KINDS[d.autoUtility!.system].color}>
            {DEVICE_KINDS[d.kind].symbol}
          </text>
        </g>
      ))}
    </g>
  );
}
