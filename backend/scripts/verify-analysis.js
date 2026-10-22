// 全量统计、HTTP、缓存与逐层容错；使用临时文件，不启动 MATLAB。
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const store = require('../src/sourcesStore');
const { scanSource } = require('../src/scanner');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-analysis-'));
  const oldSources = store.sources, oldSave = store.save;
  let server;
  store.sources = []; store.save = () => {};
  try {
    const pred = path.join(root, 'pred', '分析任务');
    fs.mkdirSync(pred, { recursive: true });
    const write = (file, values) => {
      const raw = Buffer.alloc(values.length * 2);
      values.forEach((v, i) => raw.writeInt16LE(v, i * 2)); fs.writeFileSync(path.join(pred, file), raw);
    };
    fs.writeFileSync(path.join(pred, 'index.txt'), 'RSRP_1.dem 0 2 0 2 1\nRSRP_2.dem 0 2 0 2 1\nBESTSERVER_1.dem 0 2 0 2 1\n');
    write('RSRP_1.dem', [-11000, -10000, -10000, -9000, -8000, -32768]);
    write('RSRP_2.dem', [-32768, -32768, -32768, -32768, -32768, -32768]);
    write('BESTSERVER_1.dem', [0, 1, 1, 12, 12, -32768]);
    const source = store.add(root, scanSource(root));
    const app = express(); app.use(express.json()); app.use('/api', require('../src/routes'));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const post = async body => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/analysis`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const text = await res.text();
      assert.equal(res.headers.get('content-type')?.includes('application/json'), true, `分析 API 应返回 JSON，实际 HTTP ${res.status}`);
      return { status: res.status, body: JSON.parse(text) };
    };
    const request = { sourceId: source.id, taskId: '分析任务', dataType: 'RSRP', layers: ['F1', 'F2', 'F9'] };
    const result = await post(request);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const [one, two, missing] = result.body.layers;
    assert.equal(one.totalCount, 6); assert.equal(one.validCount, 5); assert.equal(one.invalidCount, 1);
    assert.equal(one.min, -110); assert.equal(one.max, -80); assert.equal(one.mean, -96);
    assert.equal(one.median, -100); assert.equal(one.p10, -110); assert.equal(one.p90, -80);
    assert.deepEqual(one.frequencies, [[-11000, 1], [-10000, 2], [-9000, 1], [-8000, 1]]);
    assert.equal(two.validCount, 0); assert.equal(two.mean, null); assert.equal(two.median, null);
    assert.match(missing.error, /层|数据/);
    const cells = (await post({ ...request, dataType: 'BESTSERVER', layers: ['F1'] })).body.layers[0];
    assert.equal(cells.categoryCount, 3); assert.equal(cells.mean, null); assert.deepEqual(cells.frequencies, [[0, 1], [1, 2], [12, 2]]);
    write('RSRP_1.dem', [-7000, -7000, -7000, -7000, -7000, -7000]);
    const stamp = new Date(Date.now() + 1000); fs.utimesSync(path.join(pred, 'RSRP_1.dem'), stamp, stamp);
    assert.equal((await post(request)).body.layers[0].mean, -70, '源文件更新必须使缓存失效');
    fs.writeFileSync(path.join(pred, 'RSRP_1.dem'), Buffer.alloc(3));
    const partial = await post(request); assert.equal(partial.status, 200); assert.match(partial.body.layers[0].error, /int16/); assert.equal(partial.body.layers[1].validCount, 0);
    fs.writeFileSync(path.join(pred, 'RSRP_1.dem'), Buffer.alloc(0));
    assert.match((await post(request)).body.layers[0].error, /空|大小/);
    write('RSRP_1.dem', [1, 2, 3, 4, 5, 6, 7]);
    assert.match((await post(request)).body.layers[0].error, /大小/);
    for (const body of [{ ...request, taskId: '../bad' }, { ...request, dataType: 'NOPE' }, { ...request, layers: [] }, { ...request, layers: 'all' }]) {
      assert.equal((await post(body)).status, 400);
    }
    const { analyzeRaster } = require('../src/analysisStats');
    write('zeros.dem', [0, -32768, 100, -100]);
    const figure = { demFile: path.join(pred, 'zeros.dem'), indoor: false, bounds: { left: 0, right: 2, bottom: 0, top: 2, res: 1 } };
    assert.equal(analyzeRaster({ ...figure, dataType: 'DLRSSINR' }).validCount, 2);
    assert.equal(analyzeRaster({ ...figure, dataType: 'SCR' }).validCount, 3);
    assert.equal(analyzeRaster({ ...figure, indoor: true, dataType: 'DLRSSINR' }).validCount, 3);
    console.log('ANALYSIS_OK: 精确频数/分位数/分类/有效规则/更新缓存/空文件/损坏尺寸/部分失败/HTTP 校验');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    store.sources = oldSources; store.save = oldSave;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
