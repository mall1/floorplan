import type { DoorRecognitionSettings, Point } from './types';
import type { RecognizedOpening, RecognizedWall } from './recognition';
export const DEFAULT_DOOR_SETTINGS: DoorRecognitionSettings = {
  enabled: true,
  presetVersion: 2,
  widths: [700, 750, 800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200],
  slidingWidths: [1400, 1600, 1800, 2000, 2400],
  tolerance: 80,
};
/** Upgrade only the old built-in list; keep custom widths and the matching toggle. */
export function doorRecognitionSettings(settings = DEFAULT_DOOR_SETTINGS): DoorRecognitionSettings {
  if (settings.presetVersion === 2) return settings;
  const legacy = [700, 800, 900, 1000, 1100, 1200];
  return {
    ...settings,
    presetVersion: 2,
    widths:
      settings.widths.length === legacy.length && settings.widths.every((v, i) => v === legacy[i])
        ? [...DEFAULT_DOOR_SETTINGS.widths]
        : settings.widths,
  };
}
/** Presets describe the aperture including its frame, not the door leaf. Never enlarge through a jamb. */
export function matchDoorWidth(measured: number, sliding = false, settings = DEFAULT_DOOR_SETTINGS) {
  if (!settings.enabled) return measured;
  const current = doorRecognitionSettings(settings);
  const widths = sliding ? current.slidingWidths : current.widths;
  const nearest = widths.filter((v) => v <= measured + 1e-6).sort((a, b) => b - a)[0];
  return nearest !== undefined &&
    Math.abs(nearest - measured) <= settings.tolerance + 1e-6 &&
    nearest <= measured + 1e-6
    ? nearest
    : measured;
}
export function fitDetectedDoors(
  openings: RecognizedOpening[],
  walls: RecognizedWall[],
  mmPerPixel?: number,
  settings = DEFAULT_DOOR_SETTINGS,
) {
  return openings.map((o) => {
    if (o.type !== 'door') return o;
    const axis = Math.abs(o.b[0] - o.a[0]) >= Math.abs(o.b[1] - o.a[1]) ? 0 : 1,
      cross = axis ? 0 : 1;
    let lo = Math.min(o.a[axis], o.b[axis]),
      hi = Math.max(o.a[axis], o.b[axis]);
    const original = hi - lo,
      c = (o.a[cross] + o.b[cross]) / 2,
      guard = Math.min(original * 0.3, o.width * 3 + 2);
    for (const w of walls) {
      if (w.kind === 'bridge') continue;
      const start = axis ? w.y : w.x,
        end = start + (axis ? w.h : w.w),
        near = axis ? w.x : w.y,
        far = near + (axis ? w.w : w.h);
      if (far < c - o.width / 2 - 2 || near > c + o.width / 2 + 2) continue;
      // A longitudinal track / host band is not a jamb. Only inspect the ends.
      if (end - start > original * 0.6) continue;
      if (start <= lo + 2 && end > lo && end - lo <= guard) lo = end;
      if (end >= hi - 2 && start < hi && hi - start <= guard) hi = start;
    }
    if (hi - lo < Math.max(5, original * 0.4)) return o;
    const native = hi - lo,
      width = mmPerPixel
        ? matchDoorWidth(native * mmPerPixel, o.doorStyle === 'sliding', settings) / mmPerPixel
        : native;
    lo += (native - width) / 2;
    hi -= (native - width) / 2;
    const a: Point = [...o.a],
      b: Point = [...o.b];
    a[axis] = o.a[axis] <= o.b[axis] ? lo : hi;
    b[axis] = o.a[axis] <= o.b[axis] ? hi : lo;
    return { ...o, a, b };
  });
}
