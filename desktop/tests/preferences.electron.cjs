const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('Electron 随机端口重新启动后从用户文件恢复色标，而非浏览器端口存储', async () => {
  const root = path.resolve(__dirname, '../..'), data = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-preferences-ui-'));
  const env = { ...process.env, ANTENNA_DESKTOP_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [root], env });
    let page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    await page.getByRole('button', { name: '全局色标配置' }).click();
    const row = page.locator('.preset-row').first();
    await row.locator('input').nth(0).fill('-111');
    await row.getByRole('button', { name: '保存并应用' }).click();
    await expect.poll(() => page.evaluate(() => fetch('/api/preferences').then(r => r.json()).then(p => p.colorRanges.RSRP?.range[0]))).toBe(-111);
    await app.close(); app = null;
    app = await electron.launch({ args: [root], env });
    page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    await page.getByRole('button', { name: '全局色标配置' }).click();
    await expect(page.locator('.preset-row').first().locator('input').nth(0)).toHaveValue('-111.00');
  } finally { if (app) await app.close(); fs.rmSync(data, { recursive: true, force: true }); }
});
