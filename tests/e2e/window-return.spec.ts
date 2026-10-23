import { test, expect } from '@playwright/test';
import { windowReturnPixels, windowReturnSize } from '../fixtures/window-return';
import { imagePoint } from '../../src/model/files';
import { inside } from '../../src/model/geometry';
import { parseProject } from '../../src/model/project';

test('a closed window return creates no phantom door in preview or import', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建户型' }).click();
  const data = await page.evaluate(
    ({ pixels, size }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
      return canvas.toDataURL().split(',')[1];
    },
    { pixels: Array.from(windowReturnPixels()), size: windowReturnSize },
  );
  await page.locator('.upload-file-input').setInputFiles({
    name: 'window-return.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  });
  await page.getByLabel('图纸总宽', { exact: true }).fill('7200');
  await page.getByLabel('图纸总宽', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '识别房间轮廓', exact: true }).click();
  await expect(page.getByTestId('recognized-door')).toHaveCount(2); // Actual gap and balcony slider.
  expect(
    await page
      .locator('[data-testid="recognized-door"] > line')
      .evaluateAll((lines) =>
        lines.some(
          (l) => Math.abs(Number(l.getAttribute('x1')) - 285) < 3 && Number(l.getAttribute('y1')) < 120,
        ),
      ),
  ).toBe(false);
  await page.getByLabel('选择门窗 3', { exact: true }).check();
  await page.getByRole('button', { name: '添加选中的结果', exact: true }).click();
  await expect(page.locator('.saved')).toContainText('已保存');
  const project = parseProject(
    await page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!)),
  );
  expect(project.openings.filter((o) => o.type === 'door')).toHaveLength(2);
  const left = imagePoint(project.reference!, [270, 80]),
    right = imagePoint(project.reference!, [295, 80]);
  expect(project.rooms.some((r) => inside(left, r.poly) && inside(right, r.poly))).toBe(true);
  await page.screenshot({ path: 'artifacts/studio-window-return-fixed.png' });
  await page.reload();
  await expect(page.locator('#plan-canvas')).toBeVisible();
  expect(
    parseProject(await page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!))),
  ).toEqual(project);
  expect(errors).toEqual([]);
});
