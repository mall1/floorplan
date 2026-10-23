import { DEVICE_KINDS, ROUTE_KINDS } from './presets';
import type { Device, DeviceKind, Route } from './types';
export function resolvedDeviceKind(d: Device): DeviceKind {
  if (d.kind !== 'water') return d.kind;
  return d.autoUtility?.system === 'hot' || /热/.test(d.name) ? 'hotwater' : 'coldwater';
}
export function deviceStyle(d: Device) {
  return DEVICE_KINDS[resolvedDeviceKind(d)];
}
export function routeStyle(r: Route) {
  if (r.kind !== 'power')
    return { ...ROUTE_KINDS[r.kind], dash: r.kind === 'condensate' ? '100 50' : undefined };
  const use = r.powerUse ?? (/light|switch/.test(r.autoUtility?.key ?? '') ? 'lighting' : 'socket');
  return {
    ...ROUTE_KINDS.power,
    name: use === 'lighting' ? '照明回路' : use === 'ac' ? '空调专用回路' : '插座回路',
    color: use === 'lighting' ? '#b38523' : use === 'ac' ? '#466ea9' : '#bf5c4d',
    dash: use === 'lighting' ? '110 45' : use === 'ac' ? '160 45 30 45' : undefined,
  };
}
