const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
test('首次引导、演示数据、原生取消、设置失败保留草稿、保存重启与真实 MATLAB 检测取消', async () => {
  test.setTimeout(180000);
  const root = path.resolve(__dirname, '../..'), data = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-settings-ui-'));
  const env = { ...process.env, ANTENNA_DESKTOP_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = 'D:\\Matlab\\R2022a\\bin\\matlab.exe';
  let app;
  try {
    app = await electron.launch({ args: [root], cwd: root, env });
    let page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    await expect(page.getByRole('dialog', { name: '欢迎使用桌面版' })).toBeVisible();
    await page.getByRole('button', { name: '使用演示数据' }).click();
    await expect(page.getByText('已登记 1 个数据源，可在主界面选择任务。')).toBeVisible();
    await page.getByRole('button', { name: '先跳过 MATLAB 并进入' }).click();
    await expect(page.getByRole('dialog', { name: '欢迎使用桌面版' })).not.toBeVisible();
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '应用设置' });
    const input = dialog.getByRole('textbox', { name: 'MATLAB 路径' });
    await expect(input).toHaveValue('');
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await dialog.getByRole('button', { name: '选择…', exact: true }).first().click(); await expect(input).toHaveValue('');
    await input.fill(executable);
    await page.route('**/api/settings', async route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '测试磁盘不可写' }) }) : route.continue());
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(dialog.getByText('测试磁盘不可写')).toBeVisible(); await expect(input).toHaveValue(executable);
    await page.unroute('**/api/settings');
    await dialog.getByRole('spinbutton', { name: '绘图超时分钟' }).fill('45');
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect.poll(() => page.evaluate(() => fetch('/api/settings').then(r => r.json()).then(x => x.jobTimeoutMinutes))).toBe(45);
    expect(JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8')).matlabExe).toBe(executable);
    if (fs.existsSync(executable)) {
      await dialog.getByRole('button', { name: '保存并检测', exact: true }).click();
      await expect(dialog.getByRole('button', { name: '取消检测', exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: '取消检测', exact: true }).click();
      await expect(dialog.getByText('检测已取消', { exact: true })).toBeVisible({ timeout: 40000 });
      await dialog.getByRole('button', { name: '保存并检测', exact: true }).click();
      await expect(dialog.getByText('MATLAB 就绪', { exact: true })).toBeVisible({ timeout: 100000 });
      await expect(dialog).toContainText('R2022a');
    }
    const screenshots = path.join(root, '.desktop-test-data/screenshots'); fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'settings-environment.png'), fullPage: true });
    await app.close(); app = null;
    app = await electron.launch({ args: [root], cwd: root, env });
    page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'MATLAB 路径' })).toHaveValue(executable);
    await expect(page.getByRole('spinbutton', { name: '绘图超时分钟' })).toHaveValue('45');
    await expect(page.getByRole('dialog', { name: '欢迎使用桌面版' })).not.toBeVisible();
    expect(await page.evaluate(() => fetch('/api/sources').then(r => r.json()).then(x => x.length))).toBe(1);
  } finally { if (app) await app.close(); fs.rmSync(data, { recursive: true, force: true }); }
});
