import { test, expect, type Page } from '@playwright/test';

async function savedReference(page: Page) {
  await expect(page.locator('.saved')).toContainText('已保存');
  return page.evaluate(() => JSON.parse(localStorage.getItem('floorplan-studio-v2')!).reference);
}

test('native upload click, cancel, keyboard retry, and corrupt-file feedback', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建户型' }).click();
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 64, 48);
    context.strokeRect(5, 5, 50, 35);
    return canvas.toDataURL().split(',')[1];
  });
  const image = { name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
  const choose = async (keyboard = false) => {
    const picker = page.waitForEvent('filechooser');
    const input = page.locator('.upload-file-input');
    if (keyboard) {
      await input.focus();
      await input.press('Enter');
    } else await input.click();
    return picker;
  };
  const cancelled = await choose();
  expect(cancelled.isMultiple()).toBe(false);
  await cancelled.setFiles([]);
  expect(await savedReference(page)).toBeNull();
  await expect(page.getByLabel('上传户型图', { exact: true })).toBeEnabled();
  await (await choose()).setFiles(image);
  await expect(page.getByLabel('更换参考底图', { exact: true })).toBeEnabled();
  const original = await savedReference(page);
  expect(original).toMatchObject({ pixelWidth: 64, pixelHeight: 48 });
  await expect(page.locator('#plan-canvas image')).toHaveAttribute('href', original.src);
  // Cancelling and choosing the same file again must still work.
  await (await choose(true)).setFiles(image);
  await expect(page.getByLabel('更换参考底图', { exact: true })).toBeEnabled();
  expect(await savedReference(page)).toEqual(original);
  await (
    await choose()
  ).setFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') });
  await expect(page.getByRole('alert')).toContainText('无法读取这张图片');
  expect(await savedReference(page)).toEqual(original);
  await expect(page.getByLabel('更换参考底图', { exact: true })).toBeEnabled();
  await (await choose()).setFiles({ ...image, mimeType: '' });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await savedReference(page)).toEqual(original);
  await page.screenshot({ path: 'artifacts/studio-upload-fixed.png' });
});

test('drop and paste images work without a file dialog and text fields retain normal paste', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建户型' }).click();
  const imageEvent = async (kind: 'drop' | 'paste', width: number, inTextField = false) => {
    await page.evaluate(
      ({ kind, width, inTextField }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = 50;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#eee';
        ctx.fillRect(0, 0, width, 50);
        const binary = atob(canvas.toDataURL().split(',')[1]),
          bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'paste.png', { type: 'image/png' }));
        const target = document.querySelector(
          inTextField ? '[aria-label="方案名称"]' : kind === 'drop' ? '.upload-zone' : '#plan-canvas',
        )!;
        target.dispatchEvent(
          kind === 'drop'
            ? new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
            : new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
      },
      { kind, width, inTextField },
    );
  };
  await imageEvent('drop', 80);
  await expect(page.getByLabel('更换参考底图', { exact: true })).toBeEnabled();
  expect((await savedReference(page)).pixelWidth).toBe(80);
  await imageEvent('paste', 96);
  await expect(page.getByLabel('更换参考底图', { exact: true })).toBeEnabled();
  expect((await savedReference(page)).pixelWidth).toBe(96);
  await imageEvent('paste', 120, true);
  expect((await savedReference(page)).pixelWidth).toBe(96);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await savedReference(page)).pixelWidth).toBe(80);
});
