import { useStudio } from './StudioContext';
import { imagePoint } from '../model/files';
import { splitRoomPolygon } from '../model/room-topology';
export default function CandidateEditOverlay({ radius }: { radius: number }) {
  const s = useStudio(),
    ref = s.project.reference,
    e = s.candidateEdit;
  if (!ref || !e) return null;
  const poly = e.poly.map((p) => imagePoint(ref, p)),
    line = e.line.map((p) => imagePoint(ref, p));
  let halves: (typeof poly)[] = [];
  try {
    if (line.length === 2) halves = splitRoomPolygon(poly, line[0], line[1]).polys;
  } catch {
    /* Invalid cuts stay visible for correction. */
  }
  const points = (p: typeof poly) => p.map((p) => p.join(',')).join(' ');
  return (
    <g data-editor-only="true" data-testid="candidate-edit-overlay">
      {halves.map((p, i) => (
        <polygon
          key={i}
          data-testid="candidate-split-half"
          points={points(p)}
          fill={i ? '#e5a35f' : '#56a3c5'}
          fillOpacity={0.35}
          stroke="none"
          pointerEvents="none"
        />
      ))}
      <polygon
        points={points(poly)}
        fill="none"
        stroke="#19796d"
        strokeWidth={radius / 2}
        pointerEvents="none"
      />
      {poly.map((p, i) => (
        <circle
          key={i}
          data-candidate-vertex={i}
          cx={p[0]}
          cy={p[1]}
          r={radius * 1.2}
          fill="white"
          stroke="#19796d"
          strokeWidth={radius / 3}
          style={{ cursor: 'grab' }}
        >
          <title>候选轮廓顶点 {i + 1}</title>
        </circle>
      ))}
      {line.length === 2 && (
        <line
          x1={line[0][0]}
          y1={line[0][1]}
          x2={line[1][0]}
          y2={line[1][1]}
          stroke="#276fbc"
          strokeWidth={radius / 2}
          strokeDasharray={`${radius} ${radius}`}
          pointerEvents="none"
        />
      )}
      {line.map((p, i) => (
        <circle
          key={i}
          data-candidate-line={i}
          cx={p[0]}
          cy={p[1]}
          r={radius * 1.35}
          fill="#276fbc"
          stroke="white"
          strokeWidth={radius / 3}
          style={{ cursor: 'grab' }}
        >
          <title>分割线端点 {i + 1}</title>
        </circle>
      ))}
    </g>
  );
}
