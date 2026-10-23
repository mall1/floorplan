import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { analysisFixture } from '../fixtures/space-analysis';
import { demoProject, parseProject } from '../../src/model/project';
import type { Project } from '../../src/model/types';

async function seed(page: Page, p: Project) {
  await page.addInitScript((p) => {
    if (!localStorage.getItem('floorplan-studio-v2'))
      localStorage.setItem('floorplan-studio-v2', JSON.stringify(p));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: '水电布局' }).click();
}
async function saved(page: Page) {
  await expect(page.locator('.saved')).toContainText('已保存');
  return parseProject(await page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!)));
}
const fixture = () => {
  const p = analysisFixture();
  p.rooms = p.rooms.slice(0, 2);
  p.rooms[1].kind = 'kitchen';
  p.openings = p.openings.slice(0, 2);
  p.devices = [
    {
      id: 'existing-panel',
      kind: 'panel',
      name: '原配电箱',
      x: 250,
      y: 400,
      height: 1600,
      circuit: '总箱',
      rotation: 0,
    },
  ];
  return p;
};
const preview = async (page: Page) => {
  await page.getByRole('button', { name: '生成水电布置预览', exact: true }).click();
  await expect(page.getByTestId('utility-preview-overlay')).toBeVisible();
};
const apply = async (page: Page) => {
  await page.getByRole('button', { name: '应用自动水电布置', exact: true }).click();
  await expect(page.getByTestId('utility-preview-overlay')).toHaveCount(0);
  return saved(page);
};

test('floor/ceiling previews apply once, update existing auto layouts, undo and persist with connections', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = fixture();
  await seed(page, p);
  await page.getByLabel('管路敷设方式', { exact: true }).selectOption('floor');
  await page.getByLabel('走地水平段高度', { exact: true }).fill('80');
  await page.getByLabel('走地水平段高度', { exact: true }).press('Tab');
  await preview(page);
  expect((await saved(page)).routes).toHaveLength(0);
  await expect(page.getByTestId('utility-preview-report')).toContainText('冷水总进水');
  await page.getByRole('button', { name: '取消水电预览', exact: true }).click();
  expect((await saved(page)).devices).toEqual(p.devices);
  await preview(page);
  const floor = await apply(page);
  expect(floor.routes.length).toBeGreaterThan(8);
  expect(floor.routes.every((r) => r.height === (r.kind === 'drain' ? 0 : 80))).toBe(true);
  expect(floor.devices.find((d) => d.id === 'existing-panel')).toEqual(p.devices[0]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await saved(page)).devices).toEqual(p.devices);
  expect((await saved(page)).routes).toHaveLength(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await saved(page)).routes).toEqual(floor.routes);
  await page.getByLabel('管路敷设方式', { exact: true }).selectOption('ceiling');
  await page.getByLabel('走顶及灯位高度', { exact: true }).fill('2750');
  await page.getByLabel('走顶及灯位高度', { exact: true }).press('Tab');
  await preview(page);
  const ceiling = await apply(page);
  expect(ceiling.devices).toHaveLength(floor.devices.length);
  expect(ceiling.routes).toHaveLength(floor.routes.length);
  expect(ceiling.routes.every((r) => r.height === (r.kind === 'drain' ? 0 : 2750))).toBe(true);
  expect(ceiling.routes.every((r) => r.startDeviceId && r.endDeviceId)).toBe(true);
  await page.getByRole('button', { name: '方案文件' }).click();
  const jsonEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON 方案', exact: true }).click();
  const json = await jsonEvent;
  expect(parseProject(JSON.parse(await readFile((await json.path())!, 'utf8')))).toEqual(ceiling);
  await page.reload();
  await page.getByRole('button', { name: '水电布局' }).click();
  await expect(page.getByLabel('管路敷设方式', { exact: true })).toHaveValue('ceiling');
  await expect(page.getByLabel('走顶及灯位高度', { exact: true })).toHaveValue('2750');
  await page.getByRole('button', { name: '3D 空间', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.screenshot({ path: 'artifacts/studio-auto-utilities-3d.png' });
  expect(errors).toEqual([]);
});

test('single room and system selection preserves other rooms and invalidates a stale preview', async ({
  page,
}) => {
  await seed(page, fixture());
  await preview(page);
  const initial = await apply(page);
  await page.getByLabel('选择房间', { exact: true }).selectOption('卧室');
  await page.getByLabel('水电布置范围', { exact: true }).selectOption('current');
  for (const label of ['冷水管', '热水管', '排水管', '弱电网线'])
    await page.locator('.utility-systems').getByLabel(label, { exact: true }).uncheck();
  await preview(page);
  await expect(page.getByTestId('utility-preview-report')).toContainText('1 个房间');
  await page.getByLabel('管路敷设方式', { exact: true }).selectOption('floor');
  await expect(page.getByTestId('utility-preview-overlay')).toHaveCount(0);
  await preview(page);
  const changed = await apply(page);
  expect(changed.routes.filter((r) => r.autoUtility?.roomId !== '卧室')).toEqual(
    initial.routes.filter((r) => r.autoUtility?.roomId !== '卧室'),
  );
  expect(
    changed.routes
      .filter((r) => r.autoUtility?.roomId === '卧室' && r.kind === 'power')
      .every((r) => r.height === 50),
  ).toBe(true);
  await page.screenshot({ path: 'artifacts/studio-auto-utilities-scope.png' });
});

test('sample utility preview and narrow controls render without horizontal overflow', async ({ page }) => {
  await seed(page, demoProject());
  await preview(page);
  await page.screenshot({ path: 'artifacts/studio-auto-utilities-preview.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '水电布局' }).click();
  expect(await page.locator('.library').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/studio-auto-utilities-mobile.png' });
});
