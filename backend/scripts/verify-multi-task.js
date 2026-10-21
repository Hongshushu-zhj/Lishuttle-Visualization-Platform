// 临时夹具验证多任务发现、隔离、迁移与 API 链路,不改变本机注册表。
// 用法: node backend/scripts/verify-multi-task.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const express = require('express');
const sources = require('../src/sourcesStore');
const { scanSource } = require('../src/scanner');
const cache = require('../src/cache');
const queue = require('../src/jobQueue');
const { EXPORT_DIR } = require('../src/config');
const { openResultsFolder } = require('../src/openResultsFolder');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-multi-task-'));
  const originalSources = sources.sources;
  const originalSave = sources.save;
  const originalCreate = queue.create;
  const exports = [];
  let figures;
  let server;
  sources.sources = [];
  sources.save = () => {};
  queue.create = (items) => { figures = items; return { id: 'test-job' }; };
  function fixture(name, indoor) {
    const pred = path.join(root, 'pred', name);
    fs.mkdirSync(pred, { recursive: true });
    fs.writeFileSync(path.join(pred, 'index.txt'), indoor ? 'RSRP_1.dem 0 2 0 2 1\n' : 'UTM 49\nRSRP.dem 10 12 20 22 1\n');
    fs.writeFileSync(path.join(pred, indoor ? 'RSRP_1.dem' : 'RSRP.dem'), Buffer.alloc(12));
    return pred;
  }
  try {
    const a = fixture('任务 A & 方案一', true);
    const b = fixture('任务B', true);
    const c = fixture('室外任务', false);
    fs.mkdirSync(path.join(c, '10m'));
    fs.writeFileSync(path.join(c, '10m', 'RSRP.dem'), Buffer.alloc(12));
    fs.mkdirSync(path.join(root, 'pred', '无效任务'));
    fs.writeFileSync(path.join(root, 'pred', '无效任务', 'index.txt'), 'invalid');
    fs.writeFileSync(path.join(root, 'walls.txt'), '0 0 2 0\n');
    fs.writeFileSync(path.join(a, 'walls.txt'), '0 0 1 0\n');
    const scan = scanSource(root);
    assert.equal(scan.ok, true);
    assert.equal(Object.keys(scan.tasks).length, 3);
    assert.equal(scan.tasks['任务 A & 方案一'].wallsFile, path.join(a, 'walls.txt'));
    assert.equal(scan.tasks['任务B'].wallsFile, path.join(root, 'walls.txt'));
    assert.deepEqual(scan.tasks['室外任务'].types.RSRP.layers.map((l) => l.key), ['ground', '10m']);
    const source = sources.add(root, scan);
    const app = express(); app.use(express.json()); app.use('/api', require('../src/routes'));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (url, body) => {
      const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
    const request = (taskId, layers = ['F1']) => ({ sourceId: source.id, taskId, dataType: 'RSRP', layers });
    const listed = await (await fetch(base + '/api/sources')).json();
    assert.equal(listed[0].tasks.length, 3);
    assert.equal((await post('/api/plot', { requests: [request('missing')], dryRun: true })).status, 400);
    assert.equal((await post('/api/plot', { requests: [{ sourceId: source.id, dataType: 'RSRP' }], dryRun: true })).status, 400);
    await post('/api/plot', { requests: [request('任务 A & 方案一'), request('任务B')], options: { coordMode: 'rel-center' } });
    assert.equal(figures.length, 2);
    assert.notEqual(figures[0].key, figures[1].key);
    assert.notEqual(figures[0].pngFile, figures[1].pngFile);
    assert.equal(figures[0].preddir, a);
    assert.ok(figures[0].pngFile.includes('任务 A & 方案一_RSRP_1层_相对坐标-区域中心.png'));
    for (const f of figures) {
      fs.mkdirSync(path.dirname(f.pngFile), { recursive: true });
      fs.writeFileSync(f.pngFile, f.taskId);
      cache.markCached(f.sourceId, f.dataType, f.layer, f.demFile, f.variant, null, f.taskId);
    }
    const requests = [request('任务 A & 方案一'), request('任务B')];
    const result = (await post('/api/plot', { requests, options: { coordMode: 'rel-center' }, dryRun: true })).body;
    for (const f of result.figures) {
      assert.equal(f.status, 'cached');
      const image = await fetch(base + f.url + '&download=1&v=1');
      assert.equal(image.status, 200);
      assert.ok(image.headers.get('content-disposition').includes('attachment'));
      assert.equal(await image.text(), f.taskId);
    }
    const zip = await post('/api/export', { requests, options: { coordMode: 'rel-center' } });
    assert.equal(zip.body.count, 2);
    exports.push(path.join(EXPORT_DIR, zip.body.zipId + '.zip'));
    const bytes = fs.readFileSync(exports[0]);
    for (const f of figures) assert.ok(bytes.includes(Buffer.from(`${source.name}/${f.taskName}/RSRP/${path.basename(f.pngFile)}`)));
    fs.appendFileSync(path.join(a, 'index.txt'), '\n');
    const after = (await post('/api/plot', { requests, options: { coordMode: 'rel-center' }, dryRun: true })).body;
    assert.equal(after.figures[0].status, 'pending');
    assert.equal(after.figures[1].status, 'cached');
    if (process.platform === 'win32') {
      const folder = await openResultsFolder(source.id, 'RSRP', (exe, args, opts) => {
        assert.equal(exe, 'explorer.exe'); assert.equal(opts.shell, false);
        assert.deepEqual(args, [path.join(root, '路损结果图', '任务B', 'RSRP')]);
        const child = new EventEmitter(); child.unref = () => {};
        process.nextTick(() => child.emit('spawn')); return child;
      }, '任务B');
      assert.ok(fs.existsSync(folder));
    }
    // 模拟原 pred/0 的缓存与上轮易读命名,按 DEM 路径迁移且不归入其他任务。
    const zero = fixture('0', true);
    sources.updateScan(source.id, scanSource(root));
    const dem = path.join(zero, 'RSRP_1.dem');
    const modern = cache.pngPath(source.id, 'RSRP', 'F1', '', '0');
    fs.mkdirSync(path.dirname(modern), { recursive: true });
    fs.writeFileSync(modern, 'legacy'); cache.markCached(source.id, 'RSRP', 'F1', dem, '', null, '0');
    const oldDir = path.join(root, '路损结果图', 'RSRP'); fs.mkdirSync(oldDir);
    const old = path.join(oldDir, `${source.name}_RSRP_1层_绝对坐标.png`);
    fs.renameSync(modern, old); fs.renameSync(modern + '.meta.json', old + '.meta.json');
    assert.equal(cache.migrateSource(source.id), 1);
    assert.equal(cache.migrateSource(source.id), 0);
    assert.equal(cache.isCached(source.id, 'RSRP', 'F1', dem, '', '0'), true);
    assert.ok(fs.existsSync(old));
    assert.equal((await post('/api/plot', { requests: [{ sourceId: source.id, dataType: 'RSRP', layers: ['F1'] }], dryRun: true })).body.figures[0].taskId, '0');
    // 没有 0 的单任务也自动选中。
    fs.rmSync(path.join(root, 'pred'), { recursive: true }); fixture('唯一任务', true);
    sources.updateScan(source.id, scanSource(root));
    assert.equal((await post('/api/plot', { requests: [{ sourceId: source.id, dataType: 'RSRP', layers: ['F1'] }], dryRun: true })).body.figures[0].taskId, '唯一任务');
    console.log('MULTI_TASK_OK: 任务发现、室内外混合、任务墙线、同源多任务隔离、缓存与局部失效、中文 URL、下载、ZIP、打开目录、旧图迁移、单任务自动选择');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    sources.sources = originalSources; sources.save = originalSave; queue.create = originalCreate;
    for (const file of exports) fs.rmSync(file, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
