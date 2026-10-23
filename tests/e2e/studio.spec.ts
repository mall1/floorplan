import { test, expect, type Page } from '@playwright/test';
import { parseProject } from '../../src/model/project';
import { distance, bounds } from '../../src/model/geometry';
const saved = async (page: Page) => {
  await expect(page.locator('.saved')).toContainText('已保存');
  return page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2') || 'null'));
};
async function world(page: Page, x: number, y: number) {
  return page.locator('#plan-canvas').evaluate(
    (svg, p) => {
      const pt = new DOMPoint(...p).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
      return { x: pt.x, y: pt.y };
    },
    [x, y],
  );
}
async function clickWorld(page: Page, x: number, y: number) {
  const p = await world(page, x, y);
  await page.mouse.click(p.x, p.y);
}

test('balcony doors, shafts, recognition presets and jamb edits persist together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建户型' }).click();
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 260;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 320, 260);
    g.fillStyle = '#000';
    g.fillRect(30, 30, 260, 12);
    g.fillRect(30, 222, 260, 12);
    g.fillRect(30, 30, 12, 204);
    g.fillRect(278, 30, 12, 204);
    g.fillRect(42, 165, 236, 8);
    g.fillStyle = '#fff';
    g.fillRect(90, 165, 140, 8);
    g.fillRect(48, 222, 222, 12);
    g.fillStyle = '#000';
    const outline = (x: number, y: number, w: number, h: number) => {
      g.fillRect(x, y, w, 1);
      g.fillRect(x, y + h - 1, w, 1);
      g.fillRect(x, y, 1, h);
      g.fillRect(x + w - 1, y, 1, h);
    };
    outline(90, 165, 140, 8);
    outline(48, 222, 222, 12);
    g.fillRect(48, 227, 222, 1);
    g.fillStyle = '#888';
    outline(254, 42, 25, 28);
    for (const y of [65, 90]) {
      g.strokeStyle = '#777';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(52, y, 3.5, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#fff';
    g.fillRect(30, 100, 12, 35);
    g.strokeStyle = '#444';
    g.beginPath();
    g.moveTo(36, 100);
    g.lineTo(1, 100);
    g.stroke();
    g.beginPath();
    g.arc(36, 100, 35, Math.PI / 2, Math.PI);
    g.stroke();
    return c.toDataURL().split(',')[1];
  });
  await page
    .locator('input[type=file][accept="image/png,image/jpeg,image/webp"]')
    .setInputFiles({ name: 'balcony-shaft.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await page.getByLabel('图纸总宽', { exact: true }).fill('6400');
  await page.getByLabel('图纸总宽', { exact: true }).press('Tab');
  await expect(page.locator('.badge')).toHaveText('尺寸估算');
  for (const [label, value] of [
    ['薄墙预设', '150'],
    ['厚墙预设', '250'],
    ['墙厚匹配容差', '25'],
    ['推拉门洞宽度预设', '2700'],
    ['门洞匹配容差', '80'],
    ['管道外径预设', '63, 90, 150'],
    ['管径匹配容差', '30'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Tab');
  }
  await page.getByRole('button', { name: '识别房间轮廓', exact: true }).click();
  await expect(page.getByTestId('recognized-shaft')).toHaveCount(1);
  await expect(page.getByTestId('recognized-door').filter({ hasText: '推拉门' })).toHaveCount(1);
  await expect(page.getByLabel('选择烟道 1', { exact: true })).toBeChecked();
  await expect(page.getByTestId('recognized-pipe')).toHaveCount(2);
  await page.getByLabel('竖管 1 用途', { exact: true }).selectOption('drain');
  await expect(page.getByLabel('竖管 1 外径', { exact: true })).toHaveValue('150');
  await page.screenshot({ path: 'artifacts/studio-balcony-recognition.png' });
  await page.getByRole('button', { name: '添加选中的结果', exact: true }).click();
  let p = await saved(page);
  expect(p.shafts).toHaveLength(1);
  expect(p.rooms).toHaveLength(2);
  expect(p.devices).toHaveLength(2);
  expect(p.devices[0]).toMatchObject({ kind: 'pipe', diameter: 150, pipeSystem: 'drain' });
  expect(p.reference.pipeSettings).toEqual({ enabled: true, diameters: [63, 90, 150], tolerance: 30 });
  expect(
    p.openings.find(
      (o: { type: string; doorStyle?: string }) => o.type === 'door' && o.doorStyle !== 'sliding',
    ),
  ).toMatchObject({ hinge: 'a', swing: 1 });
  expect(p.walls.some((w: { width: number }) => w.width === 250)).toBe(true);
  expect(p.walls.some((w: { width: number }) => w.width === 150)).toBe(true);
  const door = p.openings.find((o: { doorStyle?: string }) => o.doorStyle === 'sliding');
  expect(door).toBeDefined();
  expect(distance(door.a, door.b)).toBeCloseTo(2700);
  expect(p.reference.wallSettings).toMatchObject({ thin: 150, thick: 250, tolerance: 25 });
  expect(p.reference.doorSettings.slidingWidths).toEqual([2700]);
  expect(parseProject(p)).toEqual(p);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  p = await saved(page);
  expect(p.rooms).toHaveLength(0);
  expect(p.shafts).toHaveLength(0);
  expect(p.openings).toHaveLength(0);
  expect(p.devices).toHaveLength(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  p = await saved(page);
  const pipe = p.devices[0];
  await clickWorld(page, pipe.x, pipe.y);
  await expect(page.getByLabel('管道用途', { exact: true })).toHaveValue('drain');
  await page.getByLabel('常见管径', { exact: true }).selectOption('160');
  await page.getByLabel('竖管高度', { exact: true }).fill('2700');
  await page.getByLabel('竖管高度', { exact: true }).press('Tab');
  p = await saved(page);
  expect(p.devices[0]).toMatchObject({ diameter: 160, height: 2700 });
  const balconyWindow = p.openings.find(
    (o: { type: string; a: number[] }) => o.type === 'window' && o.a[1] > 4000,
  );
  expect(balconyWindow).toBeDefined();
  await clickWorld(page, (balconyWindow.a[0] + balconyWindow.b[0]) / 2, balconyWindow.a[1]);
  await page.getByLabel('洞口类型', { exact: true }).selectOption('railing');
  await page.getByLabel('护栏高度', { exact: true }).fill('1150');
  await page.getByLabel('护栏高度', { exact: true }).press('Tab');
  await expect(page.getByTestId('railing-plan')).toHaveCount(1);
  await expect(page.getByLabel('洞口净高', { exact: true })).toHaveCount(0);
  p = await saved(page);
  expect(p.openings.find((o: { id: string }) => o.id === balconyWindow.id)).toMatchObject({
    type: 'railing',
    railingHeight: 1150,
  });
  let bb = bounds(p.shafts[0].poly);
  await clickWorld(page, bb.x + bb.w / 2, bb.y + bb.h / 2);
  await page.getByLabel('烟道宽度', { exact: true }).fill('600');
  await page.getByLabel('烟道宽度', { exact: true }).press('Tab');
  await page.getByLabel('烟道深度', { exact: true }).fill('500');
  await page.getByLabel('烟道深度', { exact: true }).press('Tab');
  p = await saved(page);
  bb = bounds(p.shafts[0].poly);
  expect(bb.w).toBeCloseTo(600);
  expect(bb.h).toBeCloseTo(500);
  const from = await world(page, bb.x + bb.w / 2, bb.y + bb.h / 2),
    to = await world(page, bb.x + bb.w / 2 - 200, bb.y + bb.h / 2 + 100);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  p = await saved(page);
  expect(bounds(p.shafts[0].poly).x).toBeCloseTo(bb.x - 200);
  await clickWorld(page, (door.a[0] + door.b[0]) / 2, (door.a[1] + door.b[1]) / 2);
  await expect(page.getByLabel('门型', { exact: true })).toHaveValue('sliding');
  for (const [label, value] of [
    ['起点门垛预留', '40'],
    ['终点门垛预留', '60'],
    ['推拉开启比例', '50'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Tab');
  }
  await expect(page.locator(`g[data-id="${door.id}"] > rect`).first()).toHaveAttribute('width', '2600');
  p = await saved(page);
  expect(p.openings.find((o: { id: string }) => o.id === door.id)).toMatchObject({
    jambStart: 40,
    jambEnd: 60,
    slideOpen: 50,
  });
  expect(p.reference.calibrated).toBe(false);
  const beforeCalibration = structuredClone(p),
    room = p.rooms[0];
  const edge = room.poly
    .map((pt: [number, number], i: number) => ({
      i,
      len: distance(pt, room.poly[(i + 1) % room.poly.length]),
    }))
    .sort((a: { len: number }, b: { len: number }) => b.len - a.len)[0];
  await page.getByLabel('选择房间', { exact: true }).selectOption(room.id);
  await page.getByLabel('校准参考边', { exact: true }).selectOption(String(edge.i));
  const known = Math.round(edge.len * 1.25),
    factor = known / edge.len;
  await page.getByLabel('参考边实际长度', { exact: true }).fill(String(known));
  await page.getByLabel('参考边实际长度', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '按此房间校准全屋', exact: true }).click();
  p = await saved(page);
  expect(distance(p.rooms[0].poly[edge.i], p.rooms[0].poly[(edge.i + 1) % room.poly.length])).toBeCloseTo(
    known,
  );
  expect(p.reference.calibrated).toBe(true);
  expect(p.reference.width).toBeCloseTo(beforeCalibration.reference.width * factor);
  expect(bounds(p.shafts[0].poly).w).toBeCloseTo(600 * factor);
  expect(p.globalFlooring.width).toBe(beforeCalibration.globalFlooring.width);
  expect(p.devices[0].diameter).toBe(160);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await saved(page)).toEqual(beforeCalibration);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(await saved(page)).toEqual(p);
  await page.getByRole('button', { name: '3D 空间', exact: true }).click();
  await expect(page.locator('.scene-host canvas')).toBeVisible();
  await page.getByRole('button', { name: '剖切墙', exact: true }).click();
  await page.screenshot({ path: 'artifacts/studio-balcony-shaft-3d.png' });
  await page.reload();
  await expect(page.getByTestId('shaft-plan')).toHaveCount(1);
  await expect(page.getByTestId('sliding-door-plan')).toHaveCount(1);
  await expect(page.getByTestId('railing-plan')).toHaveCount(1);
  await expect(page.getByTestId('pipe-plan')).toHaveCount(2);
  const reloaded = await page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!));
  expect(parseProject(reloaded)).toEqual(p);
  await clickWorld(page, p.devices[0].x, p.devices[0].y);
  await expect(page.getByLabel('管道外径', { exact: true })).toBeVisible();
  await page.keyboard.press('Delete');
  expect((await saved(page)).devices).toHaveLength(1);
  await page.getByRole('button', { name: '识别房间轮廓', exact: true }).click();
  await expect(page.getByTestId('recognized-pipe')).toHaveCount(2);
  await page.getByRole('button', { name: '仅补充选中的竖管', exact: true }).click();
  const supplemented = await saved(page);
  expect(supplemented.devices).toHaveLength(2);
  expect(supplemented.devices).toContainEqual(p.devices[1]);
  expect(supplemented.rooms).toEqual(p.rooms);
  expect(supplemented.walls).toEqual(p.walls);
  expect(supplemented.openings).toEqual(p.openings);
  expect(errors).toEqual([]);
});
test('manual rooms, vertices, utilities, flooring, history and JSON round trip', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#plan-canvas')).toBeVisible();
  await page.screenshot({ path: 'artifacts/studio-overview.png' });
  await page.getByRole('button', { name: '新建户型' }).click();
  await page.getByRole('button', { name: '矩形房间', exact: true }).click();
  await clickWorld(page, 1000, 1000);
  await clickWorld(page, 5000, 4000);
  let p = await saved(page);
  expect(p.rooms).toHaveLength(1);
  expect(p.rooms[0].poly).toEqual([
    [1000, 1000],
    [5000, 1000],
    [5000, 4000],
    [1000, 4000],
  ]);
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  const a = await world(page, 5000, 4000),
    b = await world(page, 5500, 4500);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  p = await saved(page);
  expect(p.rooms[0].poly[2]).toEqual([5500, 4500]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  p = await saved(page);
  expect(p.rooms[0].poly[2]).toEqual([5000, 4000]);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  p = await saved(page);
  expect(p.rooms[0].poly[2]).toEqual([5500, 4500]);
  await page.getByRole('button', { name: '水电布局' }).click();
  await page.getByRole('button', { name: /五孔插座/ }).click();
  await clickWorld(page, 2000, 2000);
  await page.getByLabel('离地高度', { exact: true }).fill('450');
  await page.getByLabel('离地高度', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '强电线路', exact: true }).click();
  await clickWorld(page, 2000, 2000);
  await clickWorld(page, 4000, 2000);
  await clickWorld(page, 4000, 3000);
  await page.keyboard.press('Enter');
  p = await saved(page);
  expect(p.devices).toHaveLength(1);
  expect(p.devices[0].height).toBe(450);
  expect(p.routes[0].points).toEqual([
    [2000, 2000],
    [4000, 2000],
    [4000, 3000],
  ]);
  await page.getByRole('button', { name: '地面铺装' }).click();
  await page.getByRole('button', { name: '全屋通铺', exact: true }).click();
  await page.getByRole('button', { name: '120 × 600 人字拼' }).click();
  await page.getByLabel('板 / 砖宽').fill('150');
  await page.getByLabel('板 / 砖宽').press('Tab');
  p = await saved(page);
  expect(p.continuous).toBe(true);
  expect(p.globalFlooring.width).toBe(150);
  expect(p.globalFlooring.pattern).toBe('herringbone');
  await page.getByRole('button', { name: '＋ 绘制门槛石' }).click();
  await clickWorld(page, 2000, 1000);
  await clickWorld(page, 2900, 1000);
  p = await saved(page);
  expect(p.openings[0].type).toBe('threshold');
  await page.screenshot({ path: 'artifacts/studio-flooring.png' });
  await page.getByRole('button', { name: '方案文件' }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON 方案' }).click();
  const json = await event;
  await json.saveAs('artifacts/roundtrip.json');
  await page.getByRole('button', { name: '新建户型' }).click();
  await page
    .locator('input[type=file][accept="application/json,.json"]')
    .setInputFiles('artifacts/roundtrip.json');
  const imported = await saved(page);
  expect(imported).toEqual(p);
  await page.reload();
  await expect(page.locator('#plan-canvas')).toBeVisible();
  expect(await saved(page)).toEqual(p);
  expect(errors).toEqual([]);
});
test('upload, calibrate, recognize two rooms and refine generated geometry', async ({ page }) => {
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
    g.fillRect(40, 40, 520, 10);
    g.fillRect(40, 400, 520, 10);
    g.fillRect(40, 40, 10, 370);
    g.fillRect(550, 40, 10, 370);
    // White partition, a clear door gap and a triple-line window frame.
    for (const x of [295, 304]) {
      g.fillRect(x, 50, 1, 150);
      g.fillRect(x, 250, 1, 150);
    }
    g.fillRect(295, 199, 10, 1);
    g.fillRect(295, 250, 10, 1);
    g.fillStyle = '#fff';
    g.fillRect(100, 40, 100, 10);
    g.fillStyle = '#000';
    for (const y of [40, 45, 49]) g.fillRect(100, y, 100, 1);
    g.strokeStyle = '#000';
    g.lineWidth = 1;
    g.strokeRect(10.5, 10.5, 579, 429);
    g.fillRect(150, 100, 1, 250);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page
    .locator('input[type=file][accept="image/png,image/jpeg,image/webp"]')
    .setInputFiles({ name: 'two-rooms.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await expect(page.getByRole('button', { name: '点击图中两点校准' })).toBeVisible();
  await page.getByLabel('图中两点实际距离').fill('10000');
  await page.getByLabel('图中两点实际距离').press('Tab');
  await page.getByRole('button', { name: '点击图中两点校准' }).click();
  await clickWorld(page, 1000, 1000);
  await clickWorld(page, 11000, 1000);
  await expect(page.locator('.badge.success')).toHaveText('已校准');
  await page.getByRole('button', { name: '识别房间轮廓' }).click();
  await expect(page.locator('.candidate')).toHaveCount(2);
  await expect(page.getByTestId('recognized-window')).toHaveCount(1);
  await expect(page.getByTestId('recognized-door')).toHaveCount(1);
  await page.getByLabel('矩形分区', { exact: true }).check();
  await expect(page.getByTestId('recognition-grid')).toBeVisible();
  await page.getByLabel('矩形分区', { exact: true }).uncheck();
  await page.getByLabel('选择门窗 2', { exact: true }).check();
  await page.getByLabel('候选房间 1 名称').fill('客厅');
  await page.getByLabel('候选房间 2 名称').fill('卧室');
  await page.screenshot({ path: 'artifacts/studio-recognition.png' });
  await page.getByLabel('旋转', { exact: true }).fill('17');
  await page.getByLabel('旋转', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '添加选中的结果' }).click();
  let p = await saved(page);
  expect(p.rooms).toHaveLength(2);
  expect(p.rooms.every((r: { boundary: boolean }) => !r.boundary)).toBe(true);
  expect(p.walls.length).toBeGreaterThan(4);
  expect(p.openings.map((o: { type: string }) => o.type).sort()).toEqual(['door', 'window']);
  expect(parseProject(p)).toEqual(p);
  const window = p.openings.find((o: { type: string }) => o.type === 'window');
  expect((Math.atan2(window.b[1] - window.a[1], window.b[0] - window.a[0]) * 180) / Math.PI).toBeCloseTo(17);
  await expect(page.getByTestId('recognition-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  let reverted = await saved(page);
  expect(reverted.rooms).toHaveLength(0);
  expect(reverted.walls).toHaveLength(0);
  expect(reverted.openings).toHaveLength(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(await saved(page)).toEqual(p);
  await clickWorld(page, (window.a[0] + window.b[0]) / 2, (window.a[1] + window.b[1]) / 2);
  await page.getByLabel('洞口类型', { exact: true }).selectOption('door');
  reverted = await saved(page);
  expect(reverted.openings.find((o: { id: string }) => o.id === window.id).type).toBe('door');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await saved(page)).toEqual(p);
  expect(p.rooms.map((r: { name: string }) => r.name)).toEqual(['客厅', '卧室']);
  await page.locator('.room-list button').filter({ hasText: '客厅' }).click();
  await page.getByLabel('包围宽度').fill('4500');
  await page.getByLabel('包围宽度').press('Tab');
  p = await saved(page);
  const xs = p.rooms[0].poly.map((pt: number[]) => pt[0]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4500);
});
test('3D loads the original furniture, supports views and exports an image', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '3D 空间', exact: true }).click();
  await expect(page.locator('.scene-host canvas')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: '俯视', exact: true }).click();
  await page.getByRole('button', { name: '鸟瞰', exact: true }).click();
  await page.screenshot({ path: 'artifacts/studio-3d.png' });
  await page.getByRole('button', { name: '方案文件' }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前视图 PNG' }).click();
  const image = await event;
  expect(image.suggestedFilename()).toContain('-3D.png');
  await page.getByRole('button', { name: '2D 平面', exact: true }).click();
  await expect(page.locator('#plan-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});
test('2D PNG export and narrow layout remain usable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '方案文件' }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前视图 PNG' }).click();
  const image = await event;
  expect(image.suggestedFilename()).toContain('平面图.png');
  await image.saveAs('artifacts/plan-export.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '关闭属性面板' }).click();
  await page.getByRole('button', { name: '关闭工具面板' }).click();
  await page.getByRole('button', { name: '切换工具面板' }).click();
  await expect(page.getByRole('button', { name: '矩形房间', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭工具面板' }).click();
  await expect(page.locator('#plan-canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'artifacts/studio-mobile.png' });
});

// Isolated browser fixtures; never touch the user's open design.
test('linked room sizing, wall depth and per-room flooring anchors survive undo and reload', async ({
  page,
}) => {
  const { emptyProject } = await import('../../src/model/project');
  const { defaultFloor } = await import('../../src/model/presets');
  const p = emptyProject();
  p.rooms = [
    {
      id: 'living',
      name: '客厅',
      poly: [
        [0, 0],
        [4000, 0],
        [4000, 3000],
        [0, 3000],
      ],
      flooring: defaultFloor(),
      boundary: false,
      counted: true,
      wallWidth: 200,
    },
    {
      id: 'bed',
      name: '卧室',
      poly: [
        [4000, 0],
        [7000, 0],
        [7000, 3000],
        [4000, 3000],
      ],
      flooring: defaultFloor(),
      boundary: true,
      counted: true,
      wallWidth: 200,
    },
  ];
  p.walls = [{ id: 'partition', a: [4000, 0], b: [4000, 3000], width: 200, height: 2800, bearing: false }];
  p.openings = [{ id: 'door', type: 'door', a: [4000, 1000], b: [4000, 2000], width: 200, color: '#b6906a' }];
  await page.addInitScript((p) => {
    if (!localStorage.getItem('floorplan-studio-v2'))
      localStorage.setItem('floorplan-studio-v2', JSON.stringify(p));
  }, p);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('选择房间', { exact: true }).selectOption('living');
  await page.getByLabel('包围宽度').fill('5000');
  await page.getByLabel('包围宽度').press('Tab');
  let current = await saved(page);
  expect(current.walls[0].a).toEqual([5000, 0]);
  expect(current.openings[0].a).toEqual([5000, 1000]);
  expect(current.rooms[1].poly[0]).toEqual([5000, 0]);
  await clickWorld(page, 5000, 500);
  await page.getByLabel('墙厚', { exact: true }).fill('320');
  await page.getByLabel('墙厚', { exact: true }).press('Tab');
  await clickWorld(page, 5000, 1500);
  await expect(page.getByLabel('洞口进深', { exact: true })).toHaveValue('320');
  await page.getByLabel('洞口净高').fill('2300');
  await page.getByLabel('洞口净高').press('Tab');
  current = await saved(page);
  expect(current.openings[0].a).toEqual([5000, 1000]);
  expect(current.openings[0].b).toEqual([5000, 2000]);
  expect(current.openings[0].height).toBe(2300);
  await page.getByRole('button', { name: '地面铺装' }).click();
  await page.getByLabel('选择铺装房间').selectOption('living');
  await page.getByRole('button', { name: '角点 1', exact: true }).click();
  await page.getByRole('button', { name: '拖动排布', exact: true }).click();
  const from = await world(page, 2000, 1500),
    to = await world(page, 2300, 1700);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  current = await saved(page);
  expect(current.rooms[0].flooring.origin).toEqual([300, 200]);
  expect(current.rooms[0].poly[0]).toEqual([0, 0]);
  expect(current.rooms[1].flooring.origin).toEqual([0, 0]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await saved(page)).rooms[0].flooring.origin).toEqual([0, 0]);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await saved(page)).rooms[0].flooring.origin).toEqual([300, 200]);
  await page.getByLabel('选择铺装房间').selectOption('bed');
  await page.getByRole('button', { name: '点选起铺点', exact: true }).click();
  await clickWorld(page, 5000, 0);
  current = await saved(page);
  expect(current.rooms[1].flooring.origin).toEqual([5000, 0]);
  expect(current.rooms[0].flooring.origin).toEqual([300, 200]);
  await page.getByLabel('沿房间边铺设').selectOption('1');
  expect((await saved(page)).rooms[1].flooring.angle).toBe(90);
  await page.getByRole('button', { name: '全屋通铺', exact: true }).click();
  await page.getByRole('button', { name: '房间中心', exact: true }).click();
  current = await saved(page);
  expect(current.globalFlooring.origin).toEqual([6500, 1500]);
  expect(current.continuous).toBe(true);
  await page.screenshot({ path: 'artifacts/studio-precision-flooring.png' });
  expect(() => parseProject(current)).not.toThrow();
  await page.reload();
  expect(await saved(page)).toEqual(current);
  expect(errors).toEqual([]);
});

test('bay window and door detail render, walkthrough moves, pauses and exits without stuck keys', async ({
  page,
}) => {
  const { emptyProject } = await import('../../src/model/project');
  const { defaultFloor } = await import('../../src/model/presets');
  const p = emptyProject();
  p.name = '门窗与漫游回归方案';
  p.rooms = [
    {
      id: 'living',
      name: '客厅',
      poly: [
        [0, 0],
        [6000, 0],
        [6000, 5000],
        [0, 5000],
      ],
      flooring: defaultFloor(),
      boundary: true,
      counted: true,
      wallWidth: 220,
    },
  ];
  p.openings = [
    {
      id: 'bay',
      type: 'window',
      windowStyle: 'bay',
      a: [1500, 0],
      b: [4500, 0],
      width: 220,
      bayDepth: 650,
      baySide: -1,
      sill: 700,
      height: 1500,
      color: '#739ca5',
    },
    {
      id: 'door',
      type: 'door',
      a: [1500, 5000],
      b: [2500, 5000],
      width: 220,
      color: '#b6906a',
      openAngle: 45,
    },
  ];
  await page.addInitScript((p) => {
    if (!localStorage.getItem('floorplan-studio-v2'))
      localStorage.setItem('floorplan-studio-v2', JSON.stringify(p));
  }, p);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('bay-window-plan')).toBeVisible();
  await clickWorld(page, 3000, 0);
  await expect(page.getByLabel('窗型')).toHaveValue('bay');
  await page.getByLabel('飘窗挑出深度').fill('800');
  await page.getByLabel('飘窗挑出深度').press('Tab');
  expect((await saved(page)).openings[0].bayDepth).toBe(800);
  await page.getByRole('button', { name: '3D 空间', exact: true }).click();
  await expect(page.locator('.scene-host canvas')).toBeVisible();
  await page.getByRole('button', { name: '剖切墙', exact: true }).click();
  await page.screenshot({ path: 'artifacts/studio-precision-3d.png' });
  await page.getByLabel('选择房间', { exact: true }).selectOption('living');
  await page.getByRole('button', { name: '进入漫游', exact: true }).click();
  await expect(page.getByRole('button', { name: '漫游前进', exact: true })).toBeVisible();
  await expect(page.locator('.scene-hint')).toContainText('3.00, 2.50 m');
  await page.keyboard.down('w');
  await expect(page.locator('.scene-hint')).not.toContainText('3.00, 2.50 m');
  await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  await expect(page.locator('.walk-overlay')).toBeVisible();
  const paused = await page.locator('.scene-hint').innerText();
  await page.keyboard.down('w');
  await page.waitForTimeout(400);
  await page.keyboard.up('w');
  expect(await page.locator('.scene-hint').innerText()).toBe(paused);
  await page.locator('.walk-overlay button').click();
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.requestPointerLock = () =>
      Promise.reject(new DOMException('Pointer lock unavailable'));
  });
  await page.getByRole('button', { name: '锁定鼠标', exact: true }).click();
  await expect(page.getByText('浏览器未允许锁定鼠标，可直接拖动视角并用 WASD 移动')).toBeVisible();
  await expect(page.locator('.walk-overlay')).toBeHidden();
  const before = await page.locator('.scene-hint').innerText();
  await page.waitForTimeout(400);
  expect(await page.locator('.scene-hint').innerText()).toBe(before);
  const canvas = await page.locator('.scene-host canvas').boundingBox();
  await page.mouse.move(canvas!.x + canvas!.width * 0.5, canvas!.y + canvas!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(canvas!.x + canvas!.width * 0.5 + 120, canvas!.y + canvas!.height * 0.5, {
    steps: 6,
  });
  await page.mouse.up();
  await page.screenshot({ path: 'artifacts/studio-walkthrough.png' });
  await page.getByRole('button', { name: '退出漫游', exact: true }).click();
  await expect(page.getByRole('button', { name: '进入漫游', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '俯视', exact: true }).click();
  await page.getByRole('button', { name: '2D 平面', exact: true }).click();
  expect(errors).toEqual([]);
});
