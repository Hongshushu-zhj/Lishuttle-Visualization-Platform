// 只测试最终资源中的真实 worker 和 MATLAB；没有 MATLAB 时明确失败。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { verifyPackage } = require('./package-verify.cjs');
const { createDemo } = require('../desktop/tests/fixtures.cjs');
const args = process.argv.slice(2);
function option(name) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
async function main() {
  const { root } = verifyPackage(option('--artifact') || path.resolve(__dirname, '../release/win-unpacked'));
  const executablePath = option('--exe') || path.join(root, 'AntennaDraw Dev.exe');
  const matlab = option('--matlab') || process.env.ANTENNA_DESKTOP_MATLAB;
  assert.ok(matlab && fs.existsSync(matlab), '必须用 --matlab 显式指定真实 MATLAB，不能用假进程代替阶段 A');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-packaged-smoke-'));
  const evidence = path.resolve(__dirname, '../.desktop-test-data');
  const checks = [];
  let app;
  const record = (name, details) => { checks.push({ name, status: 'PASS', details }); console.log('PASS ' + name); };
  try {
    const prefs = path.join(scratch, 'matlab-prefs'); fs.mkdirSync(prefs);
    const env = { ...process.env, ANTENNA_DESKTOP_DATA_DIR: path.join(scratch, 'data'), ANTENNA_DESKTOP_MATLAB: matlab, MATLAB_PREFDIR: prefs };
    delete env.ELECTRON_RUN_AS_NODE;
    if (args.includes('--no-node-path')) {
      for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
      env.Path = path.join(process.env.SystemRoot, 'System32') + ';' + process.env.SystemRoot;
    }
    app = await electron.launch({ executablePath, args: [], env, cwd: root, timeout: 30000 });
    const page = await app.firstWindow();
    page.on('pageerror', error => console.error('RENDERER_ERROR ' + error.message));
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    const versions = await page.evaluate(() => window.desktopBridge.getAppInfo());
    record('bundled Electron/Node', versions);
    async function api(url, body) {
      const result = await page.evaluate(async ({ url, body }) => {
        const response = await fetch('/api' + url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: response.status, data: await response.json() };
      }, { url, body });
      assert.equal(result.status, 200, JSON.stringify(result)); return result.data;
    }
    const demo = createDemo(scratch);
    const source = await api('/sources', { path: demo.sourceDir });
    const stats = await api('/analysis', { sourceId: source.id, taskId: '室内 A', dataType: 'RSRP', layers: ['F1', 'F2'] });
    assert.equal(stats.layers[0].mean, -90); assert.equal(stats.layers[1].validCount, 3);
    record('real packaged worker_threads', { mean: stats.layers[0].mean, valid: stats.layers[1].validCount });
    const requests = [
      { sourceId: source.id, taskId: '室内 A', dataType: 'RSRP', layers: ['F1'] },
      { sourceId: source.id, taskId: '室外', dataType: 'SCR', layers: ['10m'] },
      { sourceId: source.id, taskId: '室内 A', dataType: 'BESTSERVER', layers: ['F1'] },
    ];
    const plot = await api('/plot', { requests });
    assert.ok(plot.jobId);
    const deadline = Date.now() + 180000;
    let job;
    while (Date.now() < deadline) {
      job = await api('/jobs/' + plot.jobId);
      if (['done', 'failed', 'partial', 'cancelled', 'timed_out'].includes(job.status)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(job.status, 'done', JSON.stringify(job));
    assert.equal(job.done, 3, JSON.stringify(job)); assert.equal(job.failed, 0);
    record('real MATLAB indoor/outdoor/BESTSERVER', { total: job.total, done: job.done });
    const dimensions = [];
    for (const figure of job.figures) {
      const bytes = await page.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), figure.url);
      assert.deepEqual(bytes.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
      const size = await app.evaluate(({ nativeImage }, bytes) => nativeImage.createFromBuffer(Buffer.from(bytes)).getSize(), bytes);
      assert.ok(size.width > 100 && size.height > 100); dimensions.push(size);
    }
    record('native PNG decoding', dimensions);
    const zip = await api('/export', { requests }); assert.equal(zip.count, 3);
    await app.evaluate(({ BrowserWindow }, destination) => {
      globalThis.__smokeDownloads = [];
      BrowserWindow.getAllWindows()[0].webContents.session.on('will-download', (event, item) => {
        item.setSavePath(destination + '/' + item.getFilename());
        const record = { name: item.getFilename(), file: item.getSavePath(), state: 'started' };
        globalThis.__smokeDownloads.push(record);
        item.once('done', (event, state) => { record.state = state; });
      });
    }, scratch);
    let completed = 0;
    for (const url of [job.figures[0].url + '&download=1', zip.url]) {
      await page.evaluate(url => { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.append(a); a.click(); a.remove(); }, url);
      const limit = Date.now() + 30000;
      let records;
      do {
        records = await app.evaluate(() => globalThis.__smokeDownloads);
        if (records.length > completed && records[completed].state !== 'started') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < limit);
      assert.equal(records[completed]?.state, 'completed', JSON.stringify(records));
      assert.ok(fs.statSync(records[completed].file).size > 8);
      completed++;
    }
    record('Electron PNG/ZIP downloads saved', { count: 2 });
    fs.mkdirSync(path.join(evidence, 'screenshots'), { recursive: true });
    await page.reload();
    await page.screenshot({ path: path.join(evidence, 'screenshots/packaged-smoke.png'), fullPage: true });
    await app.close(); app = null; record('clean app/backend exit');
    fs.writeFileSync(path.join(evidence, option('--report') || 'packaged-smoke.json'), JSON.stringify({ artifact: root,
      systemPathOnly: args.includes('--no-node-path'), at: new Date().toISOString(), checks }, null, 2));
    console.log('DESKTOP_SMOKE_OK');
  } finally {
    if (app) await app.close();
    // 仅清理本次 mkdtemp 创建的测试数据。
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
