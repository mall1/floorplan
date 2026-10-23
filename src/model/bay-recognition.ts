import type { ImageRect, RecognizedOpening, RecognizedWall } from './recognition';
import type { Point } from './types';

/** Detect the U-shaped projection: a multi-line front window, two returns, and two main-wall jambs.
 * Work in either image axis. A lone parallel stripe is deliberately insufficient. */
export function recognizeBayWindows(
  openings: RecognizedOpening[],
  walls: RecognizedWall[],
  edges: ImageRect[] = [],
) {
  const removedWalls = new Set<RecognizedWall>(),
    removedOpenings = new Set<number>();
  const added: RecognizedWall[] = [],
    result = openings.map((o) => ({ ...o }));
  openings.forEach((o, index) => {
    if (o.type !== 'window' || removedOpenings.has(index)) return;
    const horizontal = Math.abs(o.b[0] - o.a[0]) >= Math.abs(o.b[1] - o.a[1]);
    const along = horizontal ? 0 : 1,
      across = horizontal ? 1 : 0;
    const lo = Math.min(o.a[along], o.b[along]),
      hi = Math.max(o.a[along], o.b[along]),
      front = (o.a[across] + o.b[across]) / 2;
    const size = hi - lo,
      tolerance = Math.max(4, o.width * 1.5);
    if (size < o.width * 5) return;
    const rect = (w: ImageRect) =>
      horizontal
        ? { s: w.x, e: w.x + w.w, c: w.y, d: w.y + w.h }
        : { s: w.y, e: w.y + w.h, c: w.x, d: w.x + w.w };
    const returns = (end: number) =>
      walls.filter((w) => {
        const r = rect(w);
        return (
          w.kind !== 'bridge' &&
          r.d - r.c > r.e - r.s &&
          Math.abs((r.s + r.e) / 2 - end) <= tolerance &&
          front >= r.c - tolerance &&
          front <= r.d + tolerance
        );
      });
    let match:
      | {
          a: RecognizedWall;
          b: RecognizedWall;
          base: number;
          hostWidth: number;
          sign: number;
          keepReturns?: boolean;
        }
      | undefined;
    // Recessed bays often share the exterior wall line. A thin inner sill edge,
    // enclosed by both deep jambs, is stronger evidence than their far endpoints.
    for (const a of returns(lo))
      for (const b of returns(hi)) {
        const ra = rect(a),
          rb = rect(b);
        const candidates = edges
          .map(rect)
          .filter((r) => {
            const at = (r.c + r.d) / 2,
              depth = Math.abs(at - front);
            return (
              r.e - r.s > size * 0.8 &&
              r.d - r.c <= 3 &&
              Math.min(r.e, hi) - Math.max(r.s, lo) > size * 0.8 &&
              depth >= Math.max(8, o.width * 1.5) &&
              depth <= Math.min(160, size / 3) &&
              size >= o.width * 8 &&
              at >= Math.max(ra.c, rb.c) - 3 &&
              at <= Math.min(ra.d, rb.d) + 3
            );
          })
          .sort((r, q) => Math.abs((r.c + r.d) / 2 - front) - Math.abs((q.c + q.d) / 2 - front));
        if (candidates.length) {
          const inner = candidates[0],
            base = (inner.c + inner.d) / 2,
            hostWidth = Math.max(3, Math.min(ra.e - ra.s, rb.e - rb.s));
          match = { a, b, base, hostWidth, sign: Math.sign(base - front), keepReturns: true };
          break;
        }
      }
    if (!match)
      for (const a of returns(lo))
        for (const b of returns(hi)) {
          const ra = rect(a),
            rb = rect(b);
          for (const sign of [-1, 1]) {
            const ca = sign < 0 ? ra.c : ra.d,
              cb = sign < 0 ? rb.c : rb.d,
              base = (ca + cb) / 2;
            const depth = (base - front) * sign;
            if (
              depth < Math.max(8, o.width * 2) ||
              depth > Math.min(size * 0.65, 160) ||
              Math.abs(ca - cb) > tolerance
            )
              continue;
            const jambs = [lo, hi].map((end, k) =>
              walls.find((w) => {
                if (w === a || w === b || w.kind === 'bridge') return false;
                const r = rect(w),
                  thickness = r.d - r.c;
                return (
                  r.e - r.s > thickness * 2 &&
                  Math.abs((r.c + r.d) / 2 - base) <= Math.max(tolerance, thickness) &&
                  end >= r.s - tolerance &&
                  end <= r.e + tolerance &&
                  (k === 0 ? r.s < lo - tolerance : r.e > hi + tolerance)
                );
              }),
            );
            if (!jambs[0] || !jambs[1]) continue;
            const j0 = rect(jambs[0]),
              j1 = rect(jambs[1]);
            const actualBase = (j0.c + j0.d + j1.c + j1.d) / 4;
            if (Math.abs((j0.c + j0.d) / 2 - (j1.c + j1.d) / 2) > tolerance) continue;
            match = { a, b, base: actualBase, hostWidth: (j0.d - j0.c + j1.d - j1.c) / 2, sign };
            break;
          }
          if (match) break;
        }
    if (!match) return;
    const { a, b, base, hostWidth, sign } = match;
    const returnA = rect(a),
      returnB = rect(b);
    const openingLo = returnA.e,
      openingHi = returnB.s;
    const bridgeLo = (returnA.s + returnA.e) / 2,
      bridgeHi = (returnB.s + returnB.e) / 2;
    const point = (s: number, c: number): Point => (horizontal ? [s, c] : [c, s]);
    // Positive local normal is down for horizontal windows, left for vertical windows.
    const baySide = (-sign * (horizontal ? 1 : -1)) as 1 | -1;
    result[index] = {
      ...o,
      a: point(openingLo, base),
      b: point(openingHi, base),
      width: hostWidth,
      windowStyle: 'bay',
      bayDepth: Math.max(2, Math.abs(front - base) - hostWidth / 2),
      baySide,
      evidence: 'bay',
    };
    if (!match.keepReturns) {
      removedWalls.add(a);
      removedWalls.add(b);
    }
    walls.forEach((w) => {
      const r = rect(w);
      if (
        Math.abs((r.c + r.d) / 2 - front) <= tolerance &&
        Math.min(r.e, hi) - Math.max(r.s, lo) > (hi - lo) * 0.7 &&
        r.d - r.c <= tolerance * 2
      )
        removedWalls.add(w);
    });
    openings.forEach((other, i) => {
      if (i === index || other.type !== 'window') return;
      if (
        Math.abs(other.a[across] - base) <= tolerance &&
        Math.abs(other.b[across] - base) <= tolerance &&
        Math.min(Math.max(other.a[along], other.b[along]), hi) -
          Math.max(Math.min(other.a[along], other.b[along]), lo) >
          size * 0.7
      )
        removedOpenings.add(i);
    });
    added.push(
      horizontal
        ? {
            x: bridgeLo,
            y: base - hostWidth / 2,
            w: bridgeHi - bridgeLo,
            h: hostWidth,
            kind: 'bridge',
            openingIndex: index,
          }
        : {
            x: base - hostWidth / 2,
            y: bridgeLo,
            w: hostWidth,
            h: bridgeHi - bridgeLo,
            kind: 'bridge',
            openingIndex: index,
          },
    );
  });
  const indices = new Map<number, number>();
  const kept = result.filter((_, i) => {
    if (removedOpenings.has(i)) return false;
    indices.set(i, indices.size);
    return true;
  });
  return {
    openings: kept,
    walls: [...walls.filter((w) => !removedWalls.has(w)), ...added].map((w) => ({
      ...w,
      openingIndex: w.openingIndex === undefined ? undefined : indices.get(w.openingIndex),
    })),
  };
}
