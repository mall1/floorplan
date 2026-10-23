// A stepped exterior wall around a window. The little end cap belongs to the
// window frame; extending it downwards would create a door inside the return.
export const windowReturnSize = 360;
export function windowReturnPixels(rotation = 0, blur = false, openReturn = false) {
  const size = windowReturnSize;
  let pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  const fill = (x: number, y: number, w: number, h: number, gray = 150) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const i = (yy * size + xx) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = gray;
      }
  };
  const outline = (x: number, y: number, w: number, h: number) => {
    fill(x, y, w, 1);
    fill(x, y + h - 1, w, 1);
    fill(x, y, 1, h);
    fill(x + w - 1, y, 1, h);
  };
  fill(40, 40, 12, 260, 0);
  fill(40, 288, 276, 12, 0);
  fill(304, 104, 12, 196, 0);
  for (const y of [40, 48, 52, 60]) fill(52, y, 236, 1);
  outline(283, 40, 4, 9);
  fill(288, 40, 28, 1);
  fill(287, 60, 18, 1);
  if (!openReturn) outline(304, 40, 12, 64);
  fill(40, 104, 40, 12, 0);
  fill(276, 104, 40, 12, 0);
  for (const y of [104, 108, 111, 115]) fill(80, y, 196, 1);
  // A genuine doorway elsewhere remains available without a swing symbol.
  fill(40, 200, 84, 8, 0);
  fill(184, 200, 132, 8, 0);
  if (blur) {
    const before = pixels.slice();
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < size - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            sum += before[((y + dy) * size + x + dx) * 4] * (dx ? 1 : 2) * (dy ? 1 : 2);
        const i = (y * size + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = sum / 16;
      }
  }
  for (let turn = 0; turn < rotation; turn++) {
    const next = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        next.set(pixels.subarray(i, i + 4), (x * size + size - 1 - y) * 4);
      }
    pixels = next;
  }
  return pixels;
}
