import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { wallAreaFixture } from '../fixtures/wall-area';
import { parseProject } from '../../src/model/project';

test('wall area estimates update, persist, undo and export by room', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(
    (p) => localStorage.setItem('floorplan-studio-v2', JSON.stringify(p)),
    wallAreaFixture(),
  );
  await page.reload();
  const panel = page.getByTestId('wall-area-panel');
  await page.getByRole('button', { name: '查看墙面面积 / 壁纸用量' }).click();
  await expect(page.getByTestId('wall-area-total-net')).toHaveText('67.22 ㎡');
  await expect(page.getByTestId('wall-area-total-purchase')).toHaveText('73.94 ㎡');
  await panel.getByLabel('书房计入墙面合计').uncheck();
  await expect(page.getByTestId('wall-area-total-net')).toHaveText('35.51 ㎡');
  await panel.getByLabel('墙面预留损耗', { exact: true }).fill('15');
  await panel.getByLabel('墙面预留损耗', { exact: true }).press('Tab');
  await panel.getByLabel('统一估算墙面高度', { exact: true }).check();
  await panel.getByLabel('全屋估算墙高', { exact: true }).fill('3000');
  await panel.getByLabel('全屋估算墙高', { exact: true }).press('Tab');
  await expect(page.getByTestId('wall-area-total-net')).toHaveText('38.31 ㎡');
  await panel.getByRole('button', { name: '卧室', exact: true }).click();
  await panel.getByLabel('此房间单独设置估算高度', { exact: true }).check();
  await panel.getByLabel('本房间估算墙高', { exact: true }).fill('2500');
  await panel.getByLabel('本房间估算墙高', { exact: true }).press('Tab');
  await expect(page.getByTestId('wall-area-total-net')).toHaveText('31.31 ㎡');
  await expect(page.getByTestId('wall-area-total-purchase')).toHaveText('36.01 ㎡');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByTestId('wall-area-total-net')).toHaveText('38.31 ㎡');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByTestId('wall-area-total-net')).toHaveText('31.31 ㎡');
  await expect(page.locator('.saved')).toContainText('已保存');
  const saved = parseProject(
    await page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!)),
  );
  expect(saved.wallFinish).toEqual({ height: 3000, waste: 15 });
  expect(saved.rooms[0].wallFinish?.height).toBe(2500);
  expect(saved.rooms[1].wallFinish?.included).toBe(false);
  await page.reload();
  await expect(page.getByTestId('wall-area-total-net')).toHaveText('31.31 ㎡');
  await expect(panel.getByLabel('书房计入墙面合计')).not.toBeChecked();
  const downloadEvent = page.waitForEvent('download');
  await panel.getByRole('button', { name: '导出墙面面积清单' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('墙面用量测试-墙面面积清单.csv');
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('"卧室","是","2500","35.00","3.69","31.31","15","36.01"');
  expect(csv).toContain('"书房","否","3000"');
  expect(csv).toContain('"全屋合计（已勾选房间）"');
  await page.getByRole('button', { name: '查看墙面面积 / 壁纸用量' }).click();
  await page.screenshot({ path: 'artifacts/studio-wall-area.png' });
  expect(errors).toEqual([]);
});

test('wall area panel handles empty plans and narrow screens', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建户型', exact: true }).click();
  await expect(page.getByTestId('wall-area-panel')).toContainText('先绘制或识别房间');
  // Seed on navigation, after the existing project's pagehide autosave has finished.
  await page.addInitScript(
    (p) => localStorage.setItem('floorplan-studio-v2', JSON.stringify(p)),
    wallAreaFixture(),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: '切换属性面板', exact: true }).click();
  await page.getByRole('button', { name: '查看墙面面积 / 壁纸用量' }).click();
  const panel = page.getByTestId('wall-area-panel');
  await expect(page.getByTestId('wall-area-total-net')).toBeVisible();
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/studio-wall-area-mobile.png' });
});
