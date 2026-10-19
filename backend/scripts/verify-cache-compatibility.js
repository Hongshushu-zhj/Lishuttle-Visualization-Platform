// 独立临时数据验证,不修改已注册的数据源或仿真结果。
// 用法: node backend/scripts/verify-cache-compatibility.js
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const sources = require('../src/sourcesStore');
const { scanSource } = require('../src/scanner');
const cache = require('../src/cache');
const router = require('../src/routes');
const queue = require('../src/jobQueue');

async function main() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'matlab-compat-'));
  const originalSources = sources.sources;
  const originalSave = sources.save;
  const originalCreate = queue.create;
  let requestedFigures;
  queue.create = figures => { requestedFigures = figures; return { id: 'compatibility-check' }; };
  const pred = path.join(fixture, 'pred', '0');
  fs.mkdirSync(pred, { recursive: true });
  const index = path.join(pred, 'index.txt');
  fs.writeFileSync(index, 'RSRP_1.dem 0 2 0 1 1\nRSRP_2.dem 10 13 20 22 1\n');
  for (const file of ['RSRP_1.dem', 'RSRP_2.dem']) fs.writeFileSync(path.join(pred, file), Buffer.alloc(12));
  sources.sources = [];
  sources.save = () => {};
  let server;
  try {
    const scan = scanSource(fixture);
    assert.deepEqual(scan.types.RSRP.layers[1].bounds, { left: 10, right: 13, bottom: 20, top: 22, res: 1 });
    const source = sources.add(fixture, scan);
    const app = express(); app.use(express.json()); app.use('/api', router);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    async function figures() {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/plot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ sourceId: source.id, dataType: 'RSRP', layers: ['F2'] }] }),
      });
      assert.equal(response.status, 200);
      return response.json();
    }
    await figures();
    assert.deepEqual(requestedFigures[0].bounds, { left: 10, right: 13, bottom: 20, top: 22, res: 1 });
    assert.deepEqual(requestedFigures[0].xlim, [10, 13]);
    // 请求前更改索引,确保重新扫描,而非继续使用注册时的旧坐标。
    fs.writeFileSync(index, 'RSRP_1.dem 0 2 0 1 1\nRSRP_2.dem 30 33 40 42 1\n');
    await figures();
    assert.equal(sources.get(source.id).scan.types.RSRP.layers[1].bounds.left, 30);
    assert.deepEqual(requestedFigures[0].bounds, { left: 30, right: 33, bottom: 40, top: 42, res: 1 });
    assert.deepEqual(requestedFigures[0].xlim, [30, 33]);
    const dem = path.join(pred, 'RSRP_1.dem');
    const png = cache.pngPath(source.id, 'RSRP', 'F1');
    fs.mkdirSync(path.dirname(png), { recursive: true }); fs.writeFileSync(png, 'test image');
    const mark = () => cache.markCached(source.id, 'RSRP', 'F1', dem);
    const cached = () => cache.isCached(source.id, 'RSRP', 'F1', dem);
    mark(); assert.equal(cached(), true);
    const wall = path.join(fixture, 'walls.txt');
    fs.writeFileSync(wall, '0 0 1 1\n'); assert.equal(cached(), false); // 新增
    mark(); assert.equal(cached(), true);
    const previous = fs.statSync(wall);
    fs.writeFileSync(wall, '0 0 2 2\n'); fs.utimesSync(wall, previous.atime, previous.mtime);
    assert.equal(cached(), false); // 内容变化,即使大小与时间不变
    mark(); fs.unlinkSync(wall); assert.equal(cached(), false); // 删除
    mark(); fs.appendFileSync(index, '\n'); assert.equal(cached(), false);
    // 室外新增/修改建筑和基站同样失效。
    fs.writeFileSync(index, 'UTM 49\nRSRP.dem 0 2 0 2 1\n');
    fs.writeFileSync(path.join(pred, 'RSRP.dem'), Buffer.alloc(8));
    sources.updateScan(source.id, scanSource(fixture));
    const outdoorDem = path.join(pred, 'RSRP.dem');
    const outdoorPng = cache.pngPath(source.id, 'RSRP', 'ground');
    fs.writeFileSync(outdoorPng, 'test image');
    const markOutdoor = () => cache.markCached(source.id, 'RSRP', 'ground', outdoorDem);
    const cachedOutdoor = () => cache.isCached(source.id, 'RSRP', 'ground', outdoorDem);
    for (const file of ['building1', 'cells1.txt']) {
      markOutdoor(); assert.equal(cachedOutdoor(), true);
      fs.writeFileSync(path.join(pred, file), 'changed'); assert.equal(cachedOutdoor(), false);
    }
    fs.unlinkSync(outdoorDem); fs.mkdirSync(path.join(pred, '10m'));
    fs.writeFileSync(path.join(pred, '10m', 'RSRP.dem'), Buffer.alloc(8));
    assert.deepEqual(scanSource(fixture).types.RSRP.layers.map(l => l.key), ['10m']);
    console.log('BACKEND_COMPATIBILITY_OK');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    sources.sources = originalSources; sources.save = originalSave; queue.create = originalCreate;
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
