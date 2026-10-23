import { analyzeFloorplan } from '../model/recognition';
self.onmessage = (e) => {
  try {
    const { pixels, width, height, options } = e.data;
    self.postMessage(analyzeFloorplan(new Uint8ClampedArray(pixels), width, height, options));
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '图形识别失败' });
  }
};
