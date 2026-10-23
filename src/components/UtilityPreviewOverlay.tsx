import { useStudio } from './StudioContext';
import DeviceSymbol from './DeviceSymbol';
import { routeStyle } from '../model/utility-style';
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
            stroke={routeStyle(r).color}
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
          <g transform="scale(.85)">
            <DeviceSymbol device={d} />
          </g>
        </g>
      ))}
    </g>
  );
}
