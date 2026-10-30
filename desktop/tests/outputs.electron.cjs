const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { validatePng } = require('../../backend/src/outputPaths');
test('both output policies preserve history; native PNG/ZIP/CSV/Canvas saving, cancellation and write failure', async () => {
  test.setTimeout(240000);
  const root = path.resolve(__dirname, '../..'), data = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-output-ui-'));
  const env = { ...process.env, ANTENNA_DESKTOP_DATA_DIR: data, ANTENNA_DESKTOP_MATLAB: 'D:\\Matlab\\R2022a\\bin\\matlab.exe' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [root], cwd: root, env }); const page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    const api = (url, body, method = 'POST') => page.evaluate(async ({ url, body, method }) => { const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const x = await r.json(); if (!r.ok) throw Error(JSON.stringify(x)); return x; }, { url, body, method });
    const source = await api('/onboarding/demo');
    const sourceId = source.source?.id || source.id;
    const sources = await api('/sources', undefined, 'GET'); const record = sources.find(s => s.id === sourceId) || sources[0];
    const request = [{ sourceId: record.id, taskId: '室内 A', dataType: 'RSRP', layers: ['F1'] }]; let oldUrl;
    for (const outputMode of ['source', 'separate']) {
      await api('/settings', { outputMode }, 'PATCH');
      const created = await api('/plot', { requests: request }); expect(created.jobId).toBeTruthy();
      await expect.poll(async () => (await api('/jobs/' + created.jobId, undefined, 'GET')).status, { timeout: 100000 }).toBe('done');
      const job = await api('/jobs/' + created.jobId, undefined, 'GET');
      const status = JSON.parse(fs.readFileSync(path.join(data, 'jobs', job.id, 'status.json'))); const figure = status.figures[0];
      expect(figure.pngFile.startsWith(outputMode === 'source' ? record.path : path.join(data, 'results'))).toBe(true);
      validatePng(fs.readFileSync(figure.pngFile)); expect(fs.existsSync(figure.pngFile + '.antenna-lock')).toBe(false);
      if (oldUrl) expect(await page.evaluate(url => fetch(url).then(r => r.status), oldUrl)).toBe(200); oldUrl = job.figures[0].url;
      const zip = await api('/jobs/' + job.id + '/export'); expect(zip.count).toBe(1);
      await save(zip.url, outputMode + '.zip'); await save(oldUrl + '&download=1', outputMode + '.png');
      expect(fs.readFileSync(path.join(data, outputMode + '.zip')).toString('ascii',0,2)).toBe('PK');
    }
    async function save(url, name, mode = 'save') {
      const target = path.join(data, name);
      await app.evaluate(({ BrowserWindow }, { target, mode }) => {
        globalThis.__outputDownload = 'waiting';
        BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => {
          item.once('done', (_event, state) => { globalThis.__outputDownload = state; });
          if (mode === 'cancel') item.cancel(); else item.setSavePath(target);
        });
      }, { target, mode });
      await page.evaluate(({ url, name }) => { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }, { url, name });
      await expect.poll(() => app.evaluate(() => globalThis.__outputDownload)).toBe(mode === 'cancel' ? 'cancelled' : mode === 'fail' ? 'interrupted' : 'completed');
    }
    const csv = await page.evaluate(() => URL.createObjectURL(new Blob(['name,value\n中文,42'], { type: 'text/csv;charset=utf-8' })));
    await save(csv, 'sample.csv'); expect(fs.readFileSync(path.join(data, 'sample.csv'), 'utf8')).toContain('中文,42');
    await expect(page.getByText('文件已保存：sample.csv', { exact: true })).toBeVisible();
    const canvas = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 8; return c.toDataURL('image/png'); });
    await save(canvas, 'canvas.png'); validatePng(fs.readFileSync(path.join(data, 'canvas.png')));
    await save(csv, 'cancel.csv', 'cancel'); expect(fs.existsSync(path.join(data, 'cancel.csv'))).toBe(false);
    fs.writeFileSync(path.join(data, 'blocked'), 'not a directory'); await save(csv, 'blocked/fail.csv', 'fail');
    await expect(page.getByText('文件保存失败，请检查目标目录和磁盘空间后重试。', { exact: true })).toBeVisible();
    await api('/onboarding/complete'); await page.reload(); await page.getByRole('button', { name: '任务记录', exact: true }).click();
    await page.waitForFunction(() => { const drawer=document.querySelector('.el-drawer');return drawer&&Math.abs(drawer.getBoundingClientRect().right-window.innerWidth)<2; });
    await page.screenshot({ path: path.join(root, '.desktop-test-data/screenshots/output-history.png') });
  } finally { if (app) await app.close(); fs.rmSync(data, { recursive: true, force: true }); }
});
