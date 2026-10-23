import type { DeviceKind, Flooring, UtilityKind } from './types';
export const FLOOR_PRESETS: { id: string; name: string; value: Flooring }[] = [
  ['tile600', '600 × 600 哑光砖', 600, 600, 'straight', '#e0e3dc', 160],
  ['tile800', '800 × 800 柔光砖', 800, 800, 'straight', '#e9e4db', 220],
  ['tile750', '750 × 1500 大板', 750, 1500, 'straight', '#e9e6de', 260],
  ['tile900', '900 × 1800 大板', 900, 1800, 'straight', '#e4e2df', 320],
  ['antislip', '300 × 300 防滑砖', 300, 300, 'straight', '#ccd7d1', 140],
  ['wood', '180 × 1200 橡木地板', 180, 1200, 'third', '#d8ba91', 320],
  ['woodwide', '220 × 1800 宽木板', 220, 1800, 'half', '#c2a480', 360],
  ['walnut', '150 × 900 胡桃木', 150, 900, 'half', '#a78162', 380],
  ['herringbone', '120 × 600 人字拼', 120, 600, 'herringbone', '#ccb18b', 420],
  ['marble', '600 × 1200 石材', 600, 1200, 'straight', '#eeebe5', 650],
].map(([id, name, width, length, pattern, color, price]) => ({
  id: String(id),
  name: String(name),
  value: {
    material: String(id),
    width: Number(width),
    length: Number(length),
    pattern: pattern as Flooring['pattern'],
    color: String(color),
    price: Number(price),
    gap: 2,
    grout: '#b4ab9f',
    angle: 0,
    origin: [0, 0],
    waste: 8,
  },
}));
export const defaultFloor = (): Flooring => structuredClone(FLOOR_PRESETS[1].value);
export const PATTERNS = {
  straight: '正铺对缝',
  half: '二分之一错缝',
  third: '三分之一错缝',
  herringbone: '人字拼',
  diagonal: '45° 斜铺',
};
export const ROUTE_KINDS: Record<UtilityKind, { name: string; color: string; diameter: number }> = {
  cold: { name: '冷水管', color: '#298cba', diameter: 20 },
  hot: { name: '热水管', color: '#e17a58', diameter: 20 },
  drain: { name: '排水管', color: '#708174', diameter: 50 },
  power: { name: '强电线路', color: '#bf5c4d', diameter: 20 },
  weak: { name: '弱电网线', color: '#8b75b6', diameter: 16 },
};
export const DEVICE_KINDS: Record<
  DeviceKind,
  { name: string; symbol: string; height: number; color: string }
> = {
  socket: { name: '五孔插座', symbol: '插', height: 300, color: '#b6684d' },
  switch: { name: '照明开关', symbol: '开', height: 1300, color: '#b6684d' },
  light: { name: '灯位', symbol: '灯', height: 2600, color: '#b7924e' },
  water: { name: '给水点', symbol: '水', height: 500, color: '#298cba' },
  drain: { name: '地漏', symbol: '排', height: 0, color: '#708174' },
  network: { name: '网络插座', symbol: '网', height: 300, color: '#8b75b6' },
  panel: { name: '配电箱', symbol: '箱', height: 1600, color: '#ae5750' },
  pipe: { name: '竖管', symbol: '○', height: 2800, color: '#708174' },
};
