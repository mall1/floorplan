import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { analysisFixture, analysisFurniture } from '../fixtures/space-analysis';
import { demoProject, parseProject } from '../../src/model/project';
import { spaceMetrics } from '../../src/model/space-analysis';
import type { Project } from '../../src/model/types';

async function seed(page: Page, p: Project) {
  await page.addInitScript((p) => {
    if (!localStorage.getItem('floorplan-studio-v2'))
      localStorage.setItem('floorplan-studio-v2', JSON.stringify(p));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: '空间分析' }).click();
}
async function saved(page: Page) {
  await expect(page.locator('.saved')).toContainText('已保存');
  return parseProject(await page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!)));
}

test('room type, one-click layout, undo, areas and exports persist together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = analysisFixture();
  delete p.rooms[0].kind;
  await seed(page, p);
  await page.locator('.analysis-room-list button').first().click();
  await expect(page.getByLabel('房间类型', { exact: true })).toHaveValue('auto');
  await expect(page.getByTestId('room-type-suggestion')).toContainText('卧室');
  await page.getByLabel('房间类型', { exact: true }).selectOption('study');
  expect((await saved(page)).rooms[0].kind).toBe('study');
  await page.getByRole('button', { name: '采用房间类型建议' }).click();
  await expect(page.getByLabel('房间类型', { exact: true })).toHaveValue('bedroom');
  await page.getByRole('button', { name: '一键自动布置', exact: true }).click();
  const furnished = await saved(page);
  expect(furnished.furniture.length).toBeGreaterThanOrEqual(3);
  const area = spaceMetrics(furnished, [furnished.rooms[0]]);
  await expect(page.getByTestId('room-area-metrics')).toContainText(area.storage.toFixed(2));
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await saved(page)).furniture).toHaveLength(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await saved(page)).furniture).toEqual(furnished.furniture);
  await page.getByLabel('显示房间类型分区', { exact: true }).check();
  await page.getByLabel('显示家具占地与面积标注', { exact: true }).check();
  await expect(page.getByTestId('room-type-overlay')).toBeVisible();
  await expect(page.getByTestId('room-analysis-label')).toHaveCount(5);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出空间面积 CSV' }).click();
  const download = await downloadEvent,
    csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('收纳占地');
  expect(csv).toContain(area.storage.toFixed(2));
  expect(csv).toContain('全屋合计（空间去重）');
  await saved(page);
  await page.reload();
  await page.getByRole('button', { name: '空间分析' }).click();
  await expect(page.getByLabel('显示房间类型分区')).toBeChecked();
  await page.locator('.analysis-room-list button').first().click();
  await expect(page.getByLabel('房间类型', { exact: true })).toHaveValue('bedroom');
  expect((await saved(page)).furniture).toEqual(furnished.furniture);
  await page.screenshot({ path: 'artifacts/studio-auto-layout.png' });
  expect(errors).toEqual([]);
});

test('three flow layers show reachable routes and furniture bottlenecks with adjustable clearance', async ({
  page,
}) => {
  const p = analysisFixture();
  p.furniture = [analysisFurniture('wardrobe', 3600, 2000, 600, 3800)];
  await seed(page, p);
  for (const label of ['日常通行', '家务动线', '访客动线'])
    await page.getByLabel(new RegExp('^' + label)).check();
  await expect(page.getByTestId('circulation-path')).not.toHaveCount(0);
  await expect(page.getByTestId('circulation-blocked')).not.toHaveCount(0);
  await expect(page.getByTestId('flow-results')).toContainText('家具附近无法满足 600 mm');
  await expect(page.locator('.analysis-legend')).toContainText('家务动线');
  await page.getByLabel('参考通行宽度', { exact: true }).fill('1200');
  await page.getByLabel('参考通行宽度', { exact: true }).press('Tab');
  await expect(page.getByTestId('circulation-path')).toHaveCount(0);
  await expect(page.getByTestId('flow-results')).toContainText('未找到连通通道');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByTestId('circulation-path')).not.toHaveCount(0);
  expect((await saved(page)).analysis?.flows).toEqual(['daily', 'housework', 'guest']);
  await page.getByRole('button', { name: '方案文件' }).click();
  const pngEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前视图 PNG' }).click();
  const png = await pngEvent;
  expect((await readFile((await png.path())!)).byteLength).toBeGreaterThan(1000);
  await page.screenshot({ path: 'artifacts/studio-circulation.png' });
});

test('analysis fits a narrow screen and demo overlays render without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = demoProject();
  p.analysis = { flows: ['daily', 'housework', 'guest'], clearance: 600, showTypes: true, showAreas: true };
  await seed(page, p);
  await page.screenshot({ path: 'artifacts/studio-space-analysis.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '空间分析' }).click();
  if (!(await page.locator('.library').isVisible()))
    await page.getByRole('button', { name: '切换工具面板', exact: true }).click();
  await page.getByTestId('whole-area-metrics').scrollIntoViewIfNeeded();
  expect(await page.locator('.library').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/studio-space-analysis-mobile.png' });
  await page.locator('.analysis-room-list button').first().click();
  await expect(page.getByLabel('房间类型', { exact: true })).toBeVisible();
  await expect(page.locator('.library')).not.toBeVisible();
  expect(errors).toEqual([]);
});
