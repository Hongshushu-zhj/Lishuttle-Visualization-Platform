const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');

function options(dir, extra = {}) {
  const env = { ...process.env, ANTENNA_DESKTOP_DATA_DIR: dir, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return { args: [root], env, cwd: root };
}
test('Electron sandbox、后端握手、单实例聚焦、关闭后释放端口', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-electron-'));
  let app;
  try {
    app = await electron.launch(options(data));
    const window = await app.firstWindow();
    await window.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    await expect(window.locator('body')).toContainText('天线');
    const info = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { preferences: w.webContents.getLastWebPreferences(), url: w.webContents.getURL() };
    });
    expect(info.preferences.nodeIntegration).toBe(false);
    expect(info.preferences.contextIsolation).toBe(true);
    expect(info.preferences.sandbox).toBe(true);
    expect(await window.evaluate(() => typeof require)).toBe('undefined');
    expect(await window.evaluate(() => fetch('/api/sources').then(r => r.status))).toBe(200);
    const downloadFile = path.join(data, 'canvas-preview.png');
    await app.evaluate(({ BrowserWindow }, file) => {
      globalThis.__downloadState = 'waiting';
      BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (event, item) => {
        try {
          item.setSavePath(file);
          item.once('done', (event, state) => { globalThis.__downloadState = state; });
        } catch (error) { globalThis.__downloadState = error.message; item.cancel(); }
      });
    }, downloadFile);
    await window.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 10;
      canvas.toBlob(blob => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'canvas-preview.png';
        document.body.append(a); a.click(); a.remove();
      }, 'image/png');
    });
    await expect.poll(() => app.evaluate(() => globalThis.__downloadState)).toBe('completed');
    expect(fs.readFileSync(downloadFile).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
    const { spawn } = require('node:child_process');
    const second = spawn(require('electron'), [root], { env: options(data).env, cwd: root, windowsHide: true });
    expect(await new Promise((resolve, reject) => { second.once('exit', resolve); second.once('error', reject); })).toBe(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    const screenshots = path.join(root, '.desktop-test-data/screenshots');
    fs.mkdirSync(screenshots, { recursive: true });
    await window.screenshot({ path: path.join(screenshots, 'desktop-baseline.png'), fullPage: true });
    const port = Number(new URL(info.url).port);
    await app.close(); app = null;
    const probe = net.createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
  } finally {
    if (app) await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('后端启动失败显示可读错误而不是空白窗口', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-electron-fail-'));
  let app;
  try {
    app = await electron.launch(options(data, { ANTENNA_DESKTOP_TEST_FAIL: '1' }));
    const window = await app.firstWindow();
    await expect(window.locator('body')).toContainText('本地服务启动失败');
    await expect(window.locator('body')).toContainText('BACKEND_START_FAILED');
  } finally { if (app) await app.close(); fs.rmSync(data, { recursive: true, force: true }); }
});
