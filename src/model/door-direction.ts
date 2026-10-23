import type { Point } from './types';

/** Fit both hinge ends and both opening sides, allowing the drawing's leaf to
 * sit on a wall face rather than exactly on its centreline. Swing is always
 * relative to the normal of a -> b, including when hinge b is selected. */
export function recognizeDoorDirection(
  a: Point,
  b: Point,
  width: number,
  mask: Uint8Array,
  w: number,
  h: number,
): { hinge: 'a' | 'b'; swing: 1 | -1 } | undefined {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 8) return;
  const ux = (b[0] - a[0]) / length,
    uy = (b[1] - a[1]) / length;
  const ink = (x: number, y: number) => {
    const r = Math.max(1, Math.round(length * 0.015));
    for (let yy = Math.max(0, Math.round(y) - r); yy <= Math.min(h - 1, Math.round(y) + r); yy++)
      for (let xx = Math.max(0, Math.round(x) - r); xx <= Math.min(w - 1, Math.round(x) + r); xx++)
        if (mask[yy * w + xx]) return 1;
    return 0;
  };
  const fits: { hinge: 'a' | 'b'; swing: 1 | -1; score: number }[] = [];
  for (const hinge of ['a', 'b'] as const)
    for (const swing of [-1, 1] as const) {
      const origin = hinge === 'a' ? a : b,
        along = hinge === 'a' ? 1 : -1;
      let best = 0;
      for (const offset of [-0.5, 0, 0.5])
        for (const inset of [0, 0.35])
          for (const ratio of [0.85, 0.925, 1, 1.05]) {
            const x = origin[0] - uy * width * offset + ux * along * width * inset,
              y = origin[1] + ux * width * offset + uy * along * width * inset,
              r = length * ratio;
            let arc = 0,
              leaf = 0;
            // Ignore endpoints: neighbouring walls alone must not count as an arc.
            for (let i = 2; i <= 14; i++) {
              const theta = (i * Math.PI) / 32;
              arc += ink(
                x + r * (along * ux * Math.cos(theta) - swing * uy * Math.sin(theta)),
                y + r * (along * uy * Math.cos(theta) + swing * ux * Math.sin(theta)),
              );
            }
            for (let i = 2; i <= 8; i++)
              leaf += ink(x - (swing * uy * r * i) / 10, y + (swing * ux * r * i) / 10);
            if (arc >= 10 && leaf >= 5) best = Math.max(best, arc + leaf * 1.5);
          }
      fits.push({ hinge, swing, score: best });
    }
  fits.sort((a, b) => b.score - a.score);
  if (!fits[0].score || fits[0].score - fits[1].score < 1.5) return;
  return { hinge: fits[0].hinge, swing: fits[0].swing };
}
