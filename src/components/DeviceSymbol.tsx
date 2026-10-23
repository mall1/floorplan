import { deviceStyle, resolvedDeviceKind } from '../model/utility-style';
import type { Device } from '../model/types';
export default function DeviceSymbol({ device, selected = false }: { device: Device; selected?: boolean }) {
  const kind = resolvedDeviceKind(device),
    style = deviceStyle(device);
  const color = selected ? '#203d38' : style.color;
  return (
    <g data-device-type={kind} fill="#fffdf8" stroke={color} strokeWidth={22}>
      {kind === 'light' ? (
        <>
          <circle r={140} />
          <path d="M -100 -100 L 100 100 M -100 100 L 100 -100" />
        </>
      ) : kind === 'coldwater' || kind === 'hotwater' ? (
        <circle r={130} />
      ) : kind === 'drain' || kind === 'acdrain' ? (
        <path d="M 0 -145 L 150 120 L -150 120 Z" />
      ) : kind === 'acindoor' ? (
        <>
          <rect x={-230} y={-105} width={460} height={210} rx={40} />
          <path d="M -170 60 H 170" />
        </>
      ) : kind === 'acoutdoor' ? (
        <>
          <rect x={-190} y={-140} width={380} height={280} rx={25} />
          <circle cx={-75} r={76} />
        </>
      ) : kind === 'switch' ? (
        <>
          <rect x={-125} y={-145} width={250} height={290} rx={25} />
          <path d="M -80 -65 H 80" />
        </>
      ) : (
        <rect x={-130} y={-130} width={260} height={260} rx={kind === 'panel' ? 5 : 30} />
      )}
      <text
        x={kind === 'acoutdoor' ? 90 : 0}
        y={45}
        textAnchor="middle"
        fontSize={kind === 'acoutdoor' ? 105 : 130}
        fill={style.color}
        stroke="none"
        fontFamily="sans-serif"
        pointerEvents="none"
      >
        {style.symbol}
      </text>
    </g>
  );
}
