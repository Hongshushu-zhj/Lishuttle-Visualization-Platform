const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');

test('验收入口可用，取消文件选择不改现有数据、不启动 MATLAB', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-acceptance-ui-'));
  let app;
  try {
    const env = { ...process.env, ANTENNA_DESKTOP_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [root], cwd: root, env });
    const page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    expect(await app.evaluate(({ Menu }) => !!Menu.getApplicationMenu()?.getMenuItemById('desktop-acceptance'))).toBe(true);
    await app.evaluate(({ Menu, dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      Menu.getApplicationMenu().getMenuItemById('desktop-acceptance').click();
    });
    await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('desktop-acceptance').enabled)).toBe(true);
    expect(await page.evaluate(() => fetch('/api/sources').then(r => r.json()))).toEqual([]);
    expect(fs.existsSync(path.join(data, 'acceptance'))).toBe(false);
  } finally { if (app) await app.close(); fs.rmSync(data, { recursive: true, force: true }); }
});
