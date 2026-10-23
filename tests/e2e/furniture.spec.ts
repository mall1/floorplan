import { test, expect, type Page } from '@playwright/test';
import { demoProject } from '../../src/model/project';
import { LIB } from '../../src/data/original';
import { furnSVG } from '../../src/render/furniture-svg';

async function saved(page: Page) {
  await expect(page.locator('.saved')).toContainText('已保存');
  return page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!));
}

test('old sample balconies become sliding doors and explicit edits survive reload', async ({ page }) => {
  const old = demoProject();
  old.openings
    .filter((o) => o.id.startsWith('slide'))
    .forEach((o) => {
      delete o.doorStyle;
    });
  await page.addInitScript((project) => {
    if (!localStorage.getItem('floorplan-studio-v2'))
      localStorage.setItem('floorplan-studio-v2', JSON.stringify(project));
  }, old);
  await page.goto('/');
  await expect(page.getByTestId('sliding-door-plan')).toHaveCount(2);
  await page.locator('g[data-id="slide0"] > rect').first().click();
  await expect(page.getByLabel('门型', { exact: true })).toHaveValue('sliding');
  await page.getByLabel('推拉开启比例', { exact: true }).fill('50');
  await page.getByLabel('推拉开启比例', { exact: true }).press('Tab');
  expect((await saved(page)).openings.find((o: { id: string }) => o.id === 'slide0')).toMatchObject({
    doorStyle: 'sliding',
    slideOpen: 50,
  });
  await page.reload();
  await expect(page.getByTestId('sliding-door-plan')).toHaveCount(2);
  await page.locator('g[data-id="slide0"] > rect').first().click();
  await expect(page.getByLabel('推拉开启比例', { exact: true })).toHaveValue('50');
  await page.getByLabel('门型', { exact: true }).selectOption('swing');
  await saved(page);
  await page.reload();
  await expect(page.getByTestId('sliding-door-plan')).toHaveCount(1);
  await page.getByRole('button', { name: '方案文件' }).click();
  await page.getByRole('button', { name: '载入示例户型' }).click();
  await expect(page.getByTestId('sliding-door-plan')).toHaveCount(2);
  await page.screenshot({ path: 'artifacts/studio-sliding-balconies.png' });
});

test('expanded catalog searches across categories, adds, drags, edits and saves new models', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建户型' }).click();
  await page.getByRole('button', { name: '家具布置' }).click();
  await page.getByRole('button', { name: '全部', exact: true }).click();
  const cards = page.locator('.furniture-grid button');
  await expect(cards).toHaveCount(94);
  const invalid = await page.evaluate(
    (icons) =>
      icons.filter((svg) => {
        const doc = new DOMParser().parseFromString(
          `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
          'image/svg+xml',
        );
        return !!doc.querySelector('parsererror');
      }),
    LIB.flatMap((group) => group.items.map((item) => furnSVG(item[0], item[2], item[3], item[4]))),
  );
  expect(invalid).toEqual([]);
  await page.getByLabel('搜索家具', { exact: true }).fill('高低床');
  await expect(cards).toHaveCount(2);
  await cards.filter({ hasText: '上下铺高低床' }).click();
  await page.getByLabel('宽度', { exact: true }).fill('1250');
  await page.getByLabel('宽度', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '旋转', exact: true }).click();
  expect((await saved(page)).furniture[0]).toMatchObject({ type: 'bunkbed', w: 1250, rot: 90 });
  await page.getByLabel('搜索家具', { exact: true }).fill('晾衣架');
  await expect(cards).toHaveCount(2);
  await cards
    .filter({ hasText: '紧凑晾衣架' })
    .dragTo(page.locator('#plan-canvas'), { targetPosition: { x: 300, y: 300 } });
  expect((await saved(page)).furniture.map((f: { type: string }) => f.type)).toEqual([
    'bunkbed',
    'dryingrack',
  ]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await saved(page)).furniture).toHaveLength(1);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await saved(page)).furniture).toHaveLength(2);
  await page.getByLabel('搜索家具', { exact: true }).fill('不存在的家具');
  await expect(cards).toHaveCount(0);
  await expect(page.getByText('没有找到匹配的家具，试试其他名称。')).toBeVisible();
  await page.getByRole('button', { name: '阳台 · 户外', exact: true }).click();
  await expect(page.getByLabel('搜索家具', { exact: true })).toHaveValue('');
  await expect(cards).toHaveCount(6);
  await page.reload();
  await expect(page.locator('g[data-kind="furniture"]')).toHaveCount(2);
  await page.getByRole('button', { name: '3D 空间', exact: true }).click();
  await expect(page.locator('.scene-host canvas')).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: 'artifacts/studio-new-furniture.png' });
  expect(errors).toEqual([]);
});
