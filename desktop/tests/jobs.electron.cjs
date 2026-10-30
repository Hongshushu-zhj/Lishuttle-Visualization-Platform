const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
test('关闭窗口可保留活动检测；取消并退出会等待真实 MATLAB 所属进程清理', async () => {
  test.setTimeout(100000);
  const executable = 'D:\\Matlab\\R2022a\\bin\\matlab.exe'; test.skip(!fs.existsSync(executable), '本机无验证目标 MATLAB');
  const root = path.resolve(__dirname, '../..'), data = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-exit-ui-'));
  const env = { ...process.env, ANTENNA_DESKTOP_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [root], cwd: root, env });
    const page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    await page.evaluate(async executable => {
      await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matlabExe: executable }) });
      await fetch('/api/environment/check', { method: 'POST' });
    }, executable);
    await expect.poll(() => fs.existsSync(path.join(data, 'processes/active.json'))).toBe(true);
    await app.evaluate(({ dialog }) => { globalThis.exitPromptCount = 0; dialog.showMessageBox = async () => { globalThis.exitPromptCount++; return { response: 0 }; }; });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => app.evaluate(() => globalThis.exitPromptCount)).toBe(1);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed; app = null;
    expect(fs.existsSync(path.join(data, 'processes/active.json'))).toBe(false);
    const results = fs.readdirSync(path.join(data, 'processes')).filter(name => name.startsWith('run-')).map(name => JSON.parse(fs.readFileSync(path.join(data, 'processes', name, 'result.json'), 'utf8')));
    expect(results.length).toBeGreaterThan(0); expect(results.every(result => result.cleanupConfirmed === true)).toBe(true);
  } finally { if (app) { await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {}); await app.close(); } fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
test('强制结束 Electron 后重启将实际活动绘图标记中断，确认旧所属进程清理且不自动重跑', async () => {
  test.setTimeout(100000);
  const executable = 'D:\\Matlab\\R2022a\\bin\\matlab.exe'; test.skip(!fs.existsSync(executable), '本机无验证目标 MATLAB');
  const root = path.resolve(__dirname, '../..'), data = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-recovery-ui-'));
  const env = { ...process.env, ANTENNA_DESKTOP_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [root], cwd: root, env });
    let page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    const jobId = await page.evaluate(async executable => {
      const call = async (url, body, method = 'POST') => { const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
      await call('/settings', { matlabExe: executable }, 'PATCH'); await call('/onboarding/demo');
      const [source] = await call('/sources', undefined, 'GET');
      return (await call('/plot', { requests: [{ sourceId: source.id, taskId: source.tasks[0].id, dataType: 'RSRP', layers: ['all'] }] })).jobId;
    }, executable);
    await expect.poll(() => fs.existsSync(path.join(data, 'processes/active.json'))).toBe(true);
    const record = path.join(data, 'jobs', jobId, 'status.json'); expect(JSON.parse(fs.readFileSync(record, 'utf8')).status).toBe('running');
    const actualMainPid = await app.evaluate(() => process.pid);
    const exited = new Promise(resolve => app.process().once('exit', resolve)); process.kill(actualMainPid); await exited; app = null;
    app = await electron.launch({ args: [root], cwd: root, env });
    page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/, { timeout: 30000 });
    const result = await page.evaluate(id => fetch('/api/jobs/' + id).then(r => r.json()), jobId);
    expect(result.status).toBe('interrupted'); expect(result.figures.every(f => f.status === 'interrupted')).toBe(true);
    expect(fs.existsSync(path.join(data, 'processes/active.json'))).toBe(false);
    const runs = fs.readdirSync(path.join(data, 'processes')).filter(name => name.startsWith('run-'));
    expect(runs).toHaveLength(1); expect(JSON.parse(fs.readFileSync(path.join(data, 'processes', runs[0], 'result.json'), 'utf8')).cleanupConfirmed).toBe(true);
    await page.getByRole('button', { name: '先跳过 MATLAB 并进入' }).click();
    await page.getByRole('button', { name: '任务记录', exact: true }).click();
    await expect(page.getByText('上次运行被中断', { exact: true })).toBeVisible();
  } finally { if (app) { await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {}); await app.close(); } try { fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (error) { console.error('RECOVERY_TEST_DATA_PRESERVED', data, error.message); } }
});
