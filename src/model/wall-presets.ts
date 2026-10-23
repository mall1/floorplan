import type { WallRecognitionSettings } from './types';
export const DEFAULT_WALL_SETTINGS: WallRecognitionSettings = {
  thin: 120,
  thick: 240,
  tolerance: 40,
  enabled: true,
};
/** Snap only to the closest preset within an explicit absolute tolerance in millimetres. */
export function matchWallThickness(
  measured: number,
  settings: WallRecognitionSettings = DEFAULT_WALL_SETTINGS,
) {
  if (!settings.enabled) return measured;
  const nearest = [settings.thin, settings.thick].sort(
    (a, b) => Math.abs(a - measured) - Math.abs(b - measured) || a - b,
  )[0];
  return Math.abs(nearest - measured) <= settings.tolerance + 1e-6 ? nearest : measured;
}
