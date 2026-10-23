import { test, expect, type Page } from '@playwright/test';
import { area } from '../../src/model/geometry';
import { parseProject } from '../../src/model/project';
async function world(page: Page, x: number, y: number) {
  return page.locator('#plan-canvas').evaluate(
    (svg, p) => {
      const at = new DOMPoint(...p).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
      return { x: at.x, y: at.y };
    },
    [x, y],
  );
}
async function seed(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建户型' }).click();
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 450;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 600, 450);
    g.fillStyle = '#000';
    for (const [x, y, w, h] of [
      [40, 40, 520, 10],
      [40, 400, 520, 10],
      [40, 40, 10, 370],
      [550, 40, 10, 370],
      [295, 50, 10, 150],
      [295, 250, 10, 150],
    ])
      g.fillRect(x, y, w, h);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page
    .locator('input[type=file][accept="image/png,image/jpeg,image/webp"]')
    .setInputFiles({ name: 'room-edit.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await page.getByRole('button', { name: '识别房间轮廓', exact: true }).click();
  await expect(page.locator('.candidate')).toHaveCount(2);
}
async function merge(page: Page) {
  await page.getByLabel('编辑候选房间', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('另一个候选房间', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: '合并两个候选房间', exact: true }).click();
  await expect(page.locator('.candidate')).toHaveCount(1);
}
async function saved(page: Page) {
  await expect(page.locator('.saved')).toContainText('已保存');
  return parseProject(await page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!)));
}
test('image candidates merge with wall corrections, undo, draw a split, move its endpoints and import', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seed(page);
  await merge(page);
  await page.getByRole('button', { name: '撤销候选编辑', exact: true }).click();
  await expect(page.locator('.candidate')).toHaveCount(2);
  await merge(page);
  await page.getByLabel('编辑候选房间', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: '在画布画分割线', exact: true }).click();
  for (const [x, y] of [
    [1500, 4000],
    [10500, 4000],
  ]) {
    const p = await world(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await expect(page.getByTestId('candidate-split-half')).toHaveCount(2);
  await page.getByLabel('分割端点 1 Y', { exact: true }).fill('4600');
  await page.getByLabel('分割端点 1 Y', { exact: true }).press('Tab');
  const handle = page.locator('[data-candidate-line="1"]'),
    box = await handle.boundingBox();
  const target = await world(page, 10500, 4600);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByLabel('分割端点 2 Y', { exact: true })).toHaveValue('4600');
  await page.screenshot({ path: 'artifacts/studio-room-split-preview.png' });
  await page.getByRole('button', { name: '确认切分为两个房间', exact: true }).click();
  await expect(page.locator('.candidate')).toHaveCount(2);
  await expect(page.getByTestId('manual-recognition-wall')).toHaveCount(1);
  await page.getByLabel('候选房间 1 名称').fill('客厅');
  await page.getByLabel('候选房间 2 名称').fill('餐厅');
  await page.getByRole('button', { name: '添加选中的结果', exact: true }).click();
  const p = await saved(page);
  expect(p.rooms).toHaveLength(2);
  expect(p.rooms.map((r) => r.name)).toEqual(['客厅', '餐厅']);
  expect(p.walls.some((w) => Math.abs(w.a[1] - 4600) < 1 && Math.abs(w.b[1] - 4600) < 1)).toBe(true);
  expect(
    p.walls.some(
      (w) => Math.abs(w.a[0] - 6000) < 50 && Math.abs(w.b[0] - 6000) < 50 && Math.abs(w.a[1] - w.b[1]) > 1000,
    ),
  ).toBe(false);
  expect(p.rooms.reduce((n, r) => n + area(r.poly), 0)).toBeGreaterThan(60);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await saved(page)).rooms).toHaveLength(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await saved(page)).rooms).toEqual(p.rooms);
  await page.reload();
  expect((await saved(page)).rooms).toEqual(p.rooms);
  expect(errors).toEqual([]);
});
test('candidate vertices can be dragged and reverted, and invalid split lines never apply', async ({
  page,
}) => {
  await seed(page);
  await page.getByLabel('编辑候选房间', { exact: true }).selectOption({ index: 1 });
  const vertex = page.locator('[data-candidate-vertex="0"]'),
    before = await vertex.getAttribute('cx'),
    box = await vertex.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 8, box!.y + box!.height / 2 + 8, { steps: 4 });
  await page.mouse.up();
  expect(await vertex.getAttribute('cx')).not.toEqual(before);
  await page.getByRole('button', { name: '应用轮廓调整', exact: true }).click();
  await page.getByRole('button', { name: '撤销候选编辑', exact: true }).click();
  await page.getByLabel('编辑候选房间', { exact: true }).selectOption({ index: 1 });
  await expect(vertex).toHaveAttribute('cx', before!);
  await page.getByRole('button', { name: '竖向分割', exact: true }).click();
  for (const label of ['分割端点 1 X', '分割端点 2 X']) {
    await page.getByLabel(label, { exact: true }).fill('-500');
    await page.getByLabel(label, { exact: true }).press('Tab');
  }
  await expect(page.getByRole('button', { name: '确认切分为两个房间', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '户型设计' }).click();
  expect(await page.locator('.library').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});
test('an open-space split adds no divider while keeping perimeter walls without importing detected walls', async ({
  page,
}) => {
  await seed(page);
  await merge(page);
  await page.getByLabel(/导入 \d+ 段独立墙体/).uncheck();
  await page.getByLabel('编辑候选房间', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: '横向分割', exact: true }).click();
  await page.getByLabel('沿分割线添加隔墙', { exact: true }).uncheck();
  await page.getByRole('button', { name: '确认切分为两个房间', exact: true }).click();
  await page.getByRole('button', { name: '添加选中的结果', exact: true }).click();
  const p = await saved(page);
  expect(p.rooms).toHaveLength(2);
  expect(p.rooms.every((r) => !r.boundary)).toBe(true);
  expect(p.walls).toHaveLength(4);
  expect(p.walls.every((w) => Math.abs(w.a[1] - w.b[1]) < 1 || Math.abs(w.a[0] - w.b[0]) < 1)).toBe(true);
});
