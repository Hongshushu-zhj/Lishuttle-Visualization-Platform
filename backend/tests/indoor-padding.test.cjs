const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDemo } = require('../../scripts/create-demo.cjs');
const { createSourcesStore } = require('../src/sourcesStore');
const { createCache } = require('../src/cache');
const { createRoutes } = require('../src/routes');
const { scanSource } = require('../src/scanner');
const { createJobStore } = require('../src/jobStore');

test('indoor padding API, persisted retry snapshot, legacy/outdoor paths and raw preview remain compatible', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-padding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { sourceDir } = createDemo(root);
  const store = createSourcesStore(path.join(root, 'sources.json'));
  const source = store.add(sourceDir, scanSource(sourceDir));
  const indoor = Object.values(source.scan.tasks).find(task => task.indoor && task.types.RSRP.layers.length === 2);
  const outdoor = Object.values(source.scan.tasks).find(task => !task.indoor);
  const cache = createCache({ CACHE_DIR: path.join(root, 'cache'), sourcesStore: store });
  const records = createJobStore({ directory: path.join(root, 'jobs') });
  let previous, created;
  const queue = { get: () => previous, create(figures) {
    created = { schemaVersion: 1, id: 'padding-job', createdAt: new Date().toISOString(), status: 'failed', figures };
    records.save(created); return created;
  } };
  const express = require('express'), app = express(); app.use(express.json());
  app.use('/api', createRoutes({ config: {}, sourcesStore: store, cache, jobQueue: queue }));
  app.use((e, req, res, next) => res.status(e.status || 500).json({ error: e.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await response.json(); assert.equal(response.status, 200, JSON.stringify(json)); return json;
  };
  const request = { sourceId: source.id, taskId: indoor.id, dataType: 'RSRP', layers: ['all'] };
  const raw = await call('/preview', { ...request, layer: indoor.types.RSRP.layers[0].key });
  const response = await call('/plot', { requests: [request, { ...request, taskId: outdoor.id }], options: { coordMode: 'rel-ll' } });
  for (const f of response.figures.filter(f => f.taskId === indoor.id)) {
    assert.deepEqual(f.xlim, [-2, 4]); assert.deepEqual(f.ylim, [-2, 3]);
    assert.deepEqual(f.coordBounds, { left: 0, right: 2, bottom: 0, top: 1 });
    assert.equal(f.renderPolicy, 'indoor-padding-v1'); assert.match(f.url, /@ip1_[a-f0-9]{16}_rel-ll/);
  }
  const inside = created.figures.find(f => f.indoor);
  assert.notEqual(inside.pngFile, cache.pngPath(source.id, 'RSRP', inside.layer, 'rel-ll', indoor.id), 'new image must not overwrite legacy output');
  const changed = inside.variant.replace(/ip1_[a-f0-9]{16}/, 'ip1_0000000000000000');
  assert.notEqual(inside.pngFile, cache.pngPath(source.id, 'RSRP', inside.layer, changed, indoor.id), 'exact variant must reach disk filename');
  const outside = created.figures.find(f => !f.indoor);
  assert.deepEqual(outside.xlim, [0, 2]); assert.deepEqual(outside.ylim, [0, 2]);
  assert.equal(outside.variant, 'rel-ll'); assert.equal(outside.coordBounds, undefined);
  assert.deepEqual(await call('/preview', { ...request, layer: inside.layer }), raw);
  assert.deepEqual(raw.bounds, inside.bounds);
  previous = records.load()[0];
  previous.figures.forEach(f => { f.status = f.key === inside.key ? 'failed' : 'done'; });
  // Make the saved batch wider than the single remaining failed layer.
  previous.figures.find(f => f.key === inside.key).xlim = [-12, 14];
  previous.figures.find(f => f.key === inside.key).coordBounds = { left: -10, right: 12, bottom: 0, top: 1 };
  const retry = await call('/jobs/old/retry', {});
  assert.equal(retry.figures.length, 1);
  assert.deepEqual(retry.figures[0].xlim, [-12, 14]);
  assert.deepEqual(retry.figures[0].coordBounds, { left: -10, right: 12, bottom: 0, top: 1 });
  assert.equal(created.figures[0].variant, inside.variant);
  previous = { ...created, figures: [{ ...inside, status: 'failed', xlim: [0, 2], ylim: [0, 1], variant: 'rel-ll' }] };
  delete previous.figures[0].coordBounds; delete previous.figures[0].renderPolicy;
  const legacy = await call('/jobs/old/retry', {});
  assert.deepEqual(legacy.figures[0].xlim, [0, 2]);
  assert.equal(legacy.figures[0].coordBounds, null); assert.equal(legacy.figures[0].renderPolicy, null);
  assert.equal(created.figures[0].variant, 'rel-ll');
  // Preserve the previous cross-source outdoor union regression with private data.
  const shifted = createDemo(path.join(root, 'shifted')).sourceDir;
  const index = path.join(shifted, 'pred', '室外', 'index.txt');
  fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/ 0 2 0 2 1/g, ' 500 502 500 502 1'));
  const second = store.add(shifted, scanSource(shifted));
  const secondTask = Object.values(second.scan.tasks).find(task => !task.indoor);
  const union = await call('/plot', { dryRun: true, requests: [
    { sourceId: source.id, taskId: outdoor.id, dataType: 'SCR', layers: ['ground'] },
    { sourceId: second.id, taskId: secondTask.id, dataType: 'SCR', layers: ['ground'] },
  ], options: { coordMode: 'rel-center' } });
  assert.equal(union.figures.length, 2);
  for (const f of union.figures) {
    assert.deepEqual(f.xlim, [0, 502]); assert.deepEqual(f.ylim, [0, 502]);
    assert.equal(f.coordBounds, null); assert.equal(f.renderPolicy, null);
    assert.match(f.url, /@u[a-f0-9]{8}_rel-center\.png/);
  }
});

test('MATLAB job receives original bounds and independent coordinate basis', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-padding-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { resolveOutput } = require('../src/outputPaths');
  const { createMatlabRunner } = require('../src/matlabRunner');
  const output = resolveOutput({ source: { id: 's', path: root }, taskId: 't', dataType: 'RSRP', fileName: 'new.png', settings: { outputMode: 'source' } });
  const bounds = { left: 0, right: 2, bottom: 0, top: 1, res: 1 };
  const coordBounds = { left: 0, right: 2, bottom: 0, top: 1 };
  const figure = { indoor: true, bounds, coordBounds, xlim: [-2, 4], ylim: [-2, 3], renderPolicy: 'indoor-padding-v1', output, pngFile: output.file, dataType: 'RSRP', layer: '1' };
  const runner = createMatlabRunner({ config: {}, JOBS_DIR: root, MATLAB_DIR: root, supervisor: { async run() {
    const json = JSON.parse(fs.readFileSync(path.join(root, 'job/job.json'))).figures[0];
    for (const key of ['bounds', 'coordBounds', 'xlim', 'ylim', 'renderPolicy']) assert.deepEqual(json[key], figure[key]);
    return { status: 'cancelled', cleanupConfirmed: true };
  } } });
  await runner.runMatlabJob({ id: 'job' }, [figure]);
});
