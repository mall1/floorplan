import { test, expect } from '@playwright/test';
import { distance, wallSegments } from '../../src/model/geometry';
import { imagePoint } from '../../src/model/files';
import { resolvedOpening } from '../../src/model/architecture';
import { parseProject } from '../../src/model/project';

for (const fixture of [
  { shape: 'T', head: [380, 303.5, 394], doorWidth: 850, count: 2, wallWidth: 120 },
  { shape: 'L', head: [345, 306, 363], doorWidth: 900, count: 1, wallWidth: 240 },
  { shape: 'long-return', head: [200, 306, 369], doorWidth: 850, count: 2, wallWidth: 240 },
])
  test(`hollow ${fixture.shape} jamb survives preview, sizing, import, 3D and reload`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('button', { name: '新建户型' }).click();
    const data = await page.evaluate((shape) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 600;
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 600, 600);
      g.fillStyle = '#000';
      g.fillRect(40, 40, 520, 8);
      g.fillRect(40, 550, 520, 8);
      g.fillRect(40, 40, 8, 518);
      g.fillRect(552, 40, 8, 518);
      const outline = (x: number, y: number, w: number, h: number) => {
        g.fillRect(x, y, w, 1);
        g.fillRect(x, y + h - 1, w, 1);
        g.fillRect(x, y, 1, h);
        g.fillRect(x + w - 1, y, 1, h);
      };
      g.fillStyle = '#969696';
      if (shape === 'T') {
        outline(48, 300, 282, 6);
        outline(444, 300, 108, 6);
        outline(380, 300, 14, 7);
        outline(384, 306, 6, 244);
        g.fillStyle = '#fff';
        g.fillRect(385, 306, 4, 1);
      } else {
        const long = shape === 'long-return';
        outline(48, 300, long ? 102 : 242, 12);
        outline(350, 48, 13, 253);
        outline(long ? 200 : 345, 300, long ? 169 : 18, 12);
        if (long) outline(419, 300, 133, 12);
        g.fillStyle = '#fff';
        g.fillRect(351, 300, 11, 1);
      }
      return canvas.toDataURL().split(',')[1];
    }, fixture.shape);
    await page.locator('.upload-file-input').setInputFiles({
      name: `hollow-${fixture.shape}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(data, 'base64'),
    });
    await page.getByLabel('图纸总宽', { exact: true }).fill('10200');
    await page.getByLabel('图纸总宽', { exact: true }).press('Tab');
    await expect(page.getByLabel('平开门洞宽度预设', { exact: true })).toHaveValue(
      '700, 750, 800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200',
    );
    await page.getByRole('button', { name: '识别房间轮廓', exact: true }).click();
    await expect(page.getByTestId('recognized-door')).toHaveCount(fixture.count);
    await expect(
      page.locator('.opening-candidate').filter({ hasText: `${fixture.doorWidth} mm` }),
    ).toHaveCount(fixture.count);
    for (let i = 1; i <= fixture.count; i++) await page.getByLabel(`选择门窗 ${i}`, { exact: true }).check();
    await page.getByRole('button', { name: '添加选中的结果', exact: true }).click();
    await expect(page.locator('.saved')).toContainText('已保存');
    const p = parseProject(
      await page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!)),
    );
    expect(p.openings).toHaveLength(fixture.count);
    expect(p.openings.every((o) => Math.abs(distance(o.a, o.b) - fixture.doorWidth) < 0.01)).toBe(true);
    const a = imagePoint(p.reference!, [fixture.head[0], fixture.head[1]]),
      b = imagePoint(p.reference!, [fixture.head[2], fixture.head[1]]);
    const head = p.walls.find((wall) => distance(wall.a, a) < 0.1 && distance(wall.b, b) < 0.1)!;
    expect(head).toBeDefined();
    expect(head.width).toBe(fixture.wallWidth);
    expect(
      wallSegments(
        head,
        p.openings.map((o) => resolvedOpening(o, p.walls)),
      ),
    ).toEqual([{ a, b, bottom: 0, top: 2800 }]);
    await page.screenshot({ path: `artifacts/studio-hollow-${fixture.shape}-plan.png` });
    await page.getByRole('button', { name: '3D 空间', exact: true }).click();
    await expect(page.locator('.scene-host canvas')).toBeVisible();
    await page.getByRole('button', { name: '剖切墙', exact: true }).click();
    await page.getByRole('button', { name: '俯视', exact: true }).click();
    await page.screenshot({ path: `artifacts/studio-hollow-${fixture.shape}-3d.png` });
    await page.reload();
    await expect(page.locator('#plan-canvas')).toBeVisible();
    expect(
      parseProject(await page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!))),
    ).toEqual(p);
    expect(errors).toEqual([]);
  });
