// 临时数据验证交互预览,不调用 MATLAB,不修改真实注册表。
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const store = require('../src/sourcesStore');
const queue = require('../src/jobQueue');
const { scanSource } = require('../src/scanner');
const { gridSize, wallSegments, rasterPreview } = require('../src/rasterPreview');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raster-preview-'));
  const oldSources = store.sources, oldSave = store.save, oldCreate = queue.create;
  let server;
  store.sources = []; store.save = () => {};
  queue.create = () => { throw new Error('预览不得调用 MATLAB'); };
  try {
    assert.deepEqual(gridSize({ left: 0, right: 2, bottom: 0, top: 2, res: 1 }, 6, true), { width: 2, height: 3 });
    assert.throws(() => gridSize({ left: 0, right: 2, bottom: 0, top: 2, res: 1 }, 7, true));
    const pred = path.join(root, 'pred', '中文任务'); fs.mkdirSync(pred, { recursive: true });
    fs.writeFileSync(path.join(pred, 'index.txt'), 'RSRP_1.dem 0 2 0 2 1\n');
    const values = [-10000, -32768, -9000, -8000, -7000, -6000];
    const raw = Buffer.alloc(12); values.forEach((v, i) => raw.writeInt16LE(v, i * 2));
    const demFile = path.join(pred, 'RSRP_1.dem'); fs.writeFileSync(demFile, raw);
    const wall = path.join(pred, 'walls.txt'); fs.writeFileSync(wall, '1 1\n1 0 0 2 2\nintersections\n');
    assert.deepEqual(wallSegments(wall), [[0, 0, 2, 2]]);
    const source = store.add(root, scanSource(root));
    const app = express(); app.use(express.json({ limit: '21mb' })); app.use('/api', require('../src/routes'));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (route, body) => {
      const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const req = { sourceId: source.id, taskId: '中文任务', dataType: 'RSRP', layer: 'F1' };
    const result = await post('/api/preview', req);
    assert.equal(result.status, 200); assert.deepEqual(result.body.defaultRange, [-110, -40]);
    assert.equal(result.body.min, -100); assert.equal(result.body.max, -60); assert.equal(result.body.validCount, 5);
    assert.deepEqual(Buffer.from(result.body.data, 'base64'), raw); assert.equal(result.body.sampled, false);
    assert.deepEqual(result.body.overlays.walls, [[0, 0, 2, 2]]);
    assert.equal((await post('/api/preview', { ...req, taskId: '../bad' })).status, 400);
    assert.equal((await post('/api/preview', { ...req, layer: 'F9' })).status, 404);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const saved = await post('/api/preview/save', { ...req, range: [-100, -50], png });
    assert.equal(saved.status, 200); assert.ok(fs.existsSync(saved.body.path));
    assert.ok(saved.body.path.startsWith(path.join(root, '路损结果图', '中文任务', 'RSRP')));
    assert.ok(saved.body.path.includes('交互预览_色标-100至-50'));
    assert.equal((await post('/api/preview/save', { ...req, range: [1, -1], png })).status, 400);
    assert.equal((await post('/api/preview/save', { ...req, range: [-100, -50], png: 'data:image/png;base64,bad' })).status, 400);
    // 大栅格采样、行序与端点保留,统计仍覆盖所有原始数据。
    const big = Buffer.alloc(2048 * 2 * 2); big.fill(0);
    big.writeInt16LE(-32768, 0); big.writeInt16LE(-12000, 2); big.writeInt16LE(-4000, big.length - 2);
    fs.writeFileSync(demFile, big);
    const sampled = rasterPreview({ indoor: false, dataType: 'RSRP', preddir: pred, demFile, bounds: { left: 0, right: 2048, bottom: 0, top: 2, res: 1 } });
    assert.equal(sampled.sampled, true); assert.equal(sampled.width, 1024); assert.equal(sampled.height, 1);
    assert.equal(sampled.min, -120); assert.equal(sampled.max, 0);
    console.log('RASTER_PREVIEW_OK: 栅格尺寸、字节与行序、无效值、墙线、采样统计、任务隔离、保存与参数校验,全程不调用 MATLAB');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    store.sources = oldSources; store.save = oldSave; queue.create = oldCreate;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
