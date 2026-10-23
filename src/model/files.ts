import type { Point, ReferenceImage } from './types';
export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function readReference(file: File): Promise<ReferenceImage> {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) &&
    !(!file.type && /\.(png|jpe?g|webp)$/i.test(file.name))
  )
    throw Error('请选择 PNG、JPG 或 WebP 图片');
  if (file.size > 20 * 1024 * 1024) throw Error('图片不能超过 20 MB');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw Error('无法读取这张图片，请确认文件未损坏，或另存为 PNG / JPG 后重试');
  }
  try {
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('无法处理图片，请重新打开页面后重试');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return {
      src: canvas.toDataURL('image/jpeg', 0.88),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      x: 0,
      y: 0,
      width: 12000,
      rotation: 0,
      opacity: 0.5,
      visible: true,
      calibrated: false,
    };
  } finally {
    bitmap.close();
  }
}
export function imagePoint(ref: ReferenceImage, p: Point): Point {
  const s = ref.width / ref.pixelWidth,
    a = (ref.rotation * Math.PI) / 180;
  return [
    ref.x + s * (p[0] * Math.cos(a) - p[1] * Math.sin(a)),
    ref.y + s * (p[0] * Math.sin(a) + p[1] * Math.cos(a)),
  ];
}
export async function pngFromSvg(svg: SVGSVGElement, name: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '2000');
  const vb = svg.viewBox.baseVal;
  clone.setAttribute('height', String(Math.round((2000 * vb.height) / vb.width)));
  clone.querySelectorAll('[data-editor-only]').forEach((e) => e.remove());
  const text = new XMLSerializer().serializeToString(clone),
    url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(Error('平面图导出失败'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = img.height;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
    if (blob) download(name, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}
