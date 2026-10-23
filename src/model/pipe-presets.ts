import type { PipeRecognitionSettings } from './types';

// Editable outside diameters in mm, never nominal bore (DN).
export const PIPE_DIAMETERS = [20, 25, 32, 40, 50, 75, 110, 160, 200];
export const DEFAULT_PIPE_SETTINGS: PipeRecognitionSettings = {
  enabled: true,
  diameters: PIPE_DIAMETERS,
  tolerance: 20,
};
export function matchPipeDiameter(measured: number, settings = DEFAULT_PIPE_SETTINGS) {
  if (!settings.enabled || !settings.diameters.length) return measured;
  const nearest = settings.diameters.reduce((a, b) =>
    Math.abs(b - measured) < Math.abs(a - measured) ? b : a,
  );
  return Math.abs(nearest - measured) <= settings.tolerance ? nearest : measured;
}
