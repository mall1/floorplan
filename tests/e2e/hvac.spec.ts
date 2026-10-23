import { test, expect } from '@playwright/test';
import { analysisFixture } from '../fixtures/space-analysis';
import { parseProject } from '../../src/model/project';
test('manual cold/hot placement and lighting circuit purpose save as separate types', async ({ page }) => {
  const p = analysisFixture();
  p.rooms = p.rooms.slice(0, 1);
  p.openings = [];
  await page.addInitScript((p) => localStorage.setItem('floorplan-studio-v2', JSON.stringify(p)), p);
  await page.goto('/');
  await page.getByRole('button', { name: '水电布局' }).click();
  const click = async (x: number, y: number) => {
    const pt = await page.locator('#plan-canvas').evaluate(
      (svg, at) => {
        const p = new DOMPoint(...at).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
        return { x: p.x, y: p.y };
      },
      [x, y],
    );
    await page.mouse.click(pt.x, pt.y);
  };
  await page.getByRole('button', { name: /冷水点/ }).click();
  await click(1000, 500);
  await page.getByRole('button', { name: /热水点/ }).click();
  await click(1500, 500);
  await page.getByRole('button', { name: '强电线路', exact: true }).click();
  await page.getByLabel('新线路用途', { exact: true }).selectOption('lighting');
  await click(500, 1000);
  await click(2500, 1000);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('强电回路用途', { exact: true })).toHaveValue('lighting');
  await expect(page.locator('.saved')).toContainText('已保存');
  const saved = parseProject(
    await page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!)),
  );
  expect(saved.devices.map((d) => d.kind)).toEqual(['coldwater', 'hotwater']);
  expect(saved.routes[0].powerUse).toBe('lighting');
});
test('distinct water/electrical devices and both AC configurations render, persist and undo', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = analysisFixture();
  p.rooms = p.rooms.slice(0, 3);
  p.openings = p.openings.slice(0, 3);
  p.rooms[2].kind = 'bathroom';
  p.rooms[2].name = '卫生间';
  await page.addInitScript((p) => {
    if (!localStorage.getItem('floorplan-studio-v2'))
      localStorage.setItem('floorplan-studio-v2', JSON.stringify(p));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: '水电布局' }).click();
  const apply = async () => {
    await page.getByRole('button', { name: '生成水电布置预览', exact: true }).click();
    await page.getByRole('button', { name: '应用自动水电布置', exact: true }).click();
    await expect(page.locator('.saved')).toContainText('已保存');
    return parseProject(await page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!)));
  };
  const split = await apply();
  expect(split.devices.filter((d) => d.kind === 'acoutdoor')).toHaveLength(2);
  for (const type of [
    'coldwater',
    'hotwater',
    'socket',
    'switch',
    'light',
    'acindoor',
    'acoutdoor',
    'acsocket',
    'acdrain',
  ])
    expect(await page.locator(`[data-device-type="${type}"]`).count()).toBeGreaterThan(0);
  await page.getByLabel('空调系统形式', { exact: true }).selectOption('central');
  const central = await apply();
  expect(central.devices.filter((d) => d.kind === 'acoutdoor')).toHaveLength(1);
  expect(central.devices.filter((d) => d.kind === 'acindoor').every((d) => d.acMode === 'central')).toBe(
    true,
  );
  await page.locator('.library').evaluate((e) => {
    e.scrollTop = 200;
  });
  await page.screenshot({ path: 'artifacts/studio-utilities-types.png' });
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('空调系统形式', { exact: true })).toHaveValue('split');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByLabel('空调系统形式', { exact: true })).toHaveValue('central');
  await page.getByRole('button', { name: '3D 空间', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.screenshot({ path: 'artifacts/studio-hvac-3d.png' });
  await page.reload();
  await page.getByRole('button', { name: '水电布局' }).click();
  await expect(page.getByLabel('空调系统形式', { exact: true })).toHaveValue('central');
  expect(errors).toEqual([]);
});
