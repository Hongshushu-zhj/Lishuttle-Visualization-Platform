// 隔离验证 API 坐标和缓存变体；实际 MATLAB 轴范围另由 .m 回归及产物 smoke 验证。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createDemo } = require('../../desktop/tests/fixtures.cjs');
const { scanSource } = require('../src/scanner');
const store = require('../src/sourcesStore');
const queue = require('../src/jobQueue');
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-render-options-'));
  const original = { sources: store.sources, save: store.save, create: queue.create };
  let server, figures;
  store.sources = []; store.save = () => {};
  queue.create = items => { figures = items; return { id: 'isolated-render-test' }; };
  try {
    const a = createDemo(path.join(root, 'a'));
    const b = createDemo(path.join(root, 'b'));
    const index = path.join(b.sourceDir, 'pred', '室外', 'index.txt');
    fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/ 0 2 0 2 1/g, ' 500 502 500 502 1'));
    const s1 = store.add(a.sourceDir, scanSource(a.sourceDir));
    const s2 = store.add(b.sourceDir, scanSource(b.sourceDir));
    const app = express(); app.use(express.json()); app.use('/api', require('../src/routes'));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function plot(mode, requests) {
      const res = await fetch(base + '/api/plot', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests, options: { coordMode: mode } }) });
      assert.equal(res.status, 200); return res.json();
    }
    const outdoor = [s1, s2].map(s => ({ sourceId: s.id, taskId: '室外', dataType: 'SCR', layers: ['ground'] }));
    await plot('abs', outdoor);
    assert.equal(figures.length, 2);
    for (const f of figures) { assert.deepEqual(f.xlim, [0, 502]); assert.deepEqual(f.ylim, [0, 502]); }
    const absolute = figures.map(f => f.pngFile);
    await plot('rel-center', outdoor);
    figures.forEach((f, i) => { assert.equal(f.coordMode, 'rel-center'); assert.notEqual(f.pngFile, absolute[i]); });
    for (const mode of ['abs', 'rel-ll', 'rel-center']) {
      await plot(mode, [{ sourceId: s1.id, taskId: '室内 A', dataType: 'RSRP', layers: ['F1', 'F2'] }]);
      assert.equal(figures.length, 2);
      for (const f of figures) { assert.deepEqual(f.xlim, [0, 2]); assert.deepEqual(f.ylim, [0, 1]); assert.equal(f.coordMode, mode); }
    }
    await plot('unknown', outdoor); assert.ok(figures.every(f => f.coordMode === 'abs'));
    console.log('RENDER_OPTIONS_OK: 随机端口/临时注册表/跨源并集/室内三种坐标/缓存变体/非法模式回退；未调用 MATLAB');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    store.sources = original.sources; store.save = original.save; queue.create = original.create;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
