const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function job(root, id = 'history') {
  return { schemaVersion: 1, id, status: 'done', createdAt: new Date().toISOString(), figures: [{ key: 'a|0|RSRP|F1',
    sourceId: 'a', taskId: '0', dataType: 'RSRP', layer: 'F1', status: 'done', pngFile: path.join(root, 'old.png'), url: '/api/images/a/RSRP/F1.png?taskId=0' }] };
}
test('malformed historical fields recover backup or quarantine safely instead of crashing queue initialization', t => {
  const root = temporary(t), directory = path.join(root, 'jobs'), record = job(root);
  const folder = path.join(directory, record.id); fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'status.json');
  fs.writeFileSync(file + '.bak', JSON.stringify(record));
  const { createJobStore } = require('../src/jobStore');
  for (const mutation of [{ figures: [null] }, { id: 'different-id' }, { createdAt: 1 }, { createdAt: 'yesterday' }, { finishedAt: {} }, { figures: [{ ...record.figures[0], url: 'https://outside.invalid/image.png' }] },
    { figures: [{ ...record.figures[0], status: 'invented' }] }, { figures: [{ ...record.figures[0], output: { root: 1 } }] }]) {
    fs.writeFileSync(file, JSON.stringify({ ...record, ...mutation }));
    const store = createJobStore({ directory });
    assert.deepEqual(store.load(), [record]);
    assert.ok(store.warnings.some(warning => warning.includes('history') && warning.includes('恢复')));
  }
  fs.writeFileSync(file, JSON.stringify({ ...record, figures: [null] })); fs.unlinkSync(file + '.bak');
  const { createJobQueue } = require('../src/jobQueue');
  const queue = createJobQueue({ JOBS_DIR: directory, config: {}, cache: {}, runMatlabJob() { throw new Error('must not run'); } });
  assert.deepEqual(queue.list(), []); assert.ok(queue.warnings.length);
  assert.ok(fs.readdirSync(folder).some(name => name.startsWith('status.json.invalid-')));
  const newer = JSON.stringify({ ...record, schemaVersion: 99 }); fs.writeFileSync(file, newer);
  assert.throws(() => createJobStore({ directory }).load(), { code: 'NEWER_SCHEMA' });
  assert.equal(fs.readFileSync(file, 'utf8'), newer);
});

test('recovered source, job and onboarding warnings are all visible in onboarding HTTP response', async t => {
  const root = temporary(t), { resolveWebPaths } = require('../src/runtimePaths');
  const paths = resolveWebPaths({ sourceRoot: path.resolve(__dirname, '../..'), dataDir: root });
  fs.mkdirSync(paths.jobsDir, { recursive: true });
  const source = { id: 'preserved-source', name: 'offline', path: path.join(root, 'missing') };
  fs.writeFileSync(path.join(root, 'sources.json'), '{broken'); fs.writeFileSync(path.join(root, 'sources.json.bak'), JSON.stringify([source]));
  fs.writeFileSync(path.join(root, 'onboarding.json'), '{broken');
  const folder = path.join(paths.jobsDir, 'history'); fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'status.json'), JSON.stringify({ ...job(root), figures: [null] }));
  fs.writeFileSync(path.join(folder, 'status.json.bak'), JSON.stringify(job(root)));
  const service = require('../src/serverApp').createServer({ paths });
  const { origin } = await service.listen(); t.after(() => service.close());
  const response = await (await fetch(origin + '/api/onboarding')).json();
  for (const file of ['sources.json', 'history', 'onboarding.json']) assert.ok(response.warnings.some(warning => warning.includes(file)), file);
  assert.deepEqual(service.getWarnings(), response.warnings);
  assert.equal(service.sourcesStore.list()[0].id, source.id);
  assert.equal(service.sourcesStore.list()[0].offline, true);
});

test('source registry malformed scan recovers backup and newer schema is preserved untouched', t => {
  const root = temporary(t), file = path.join(root, 'sources.json');
  const source = { id: 'keep-source', path: path.join(root, 'offline'), scan: { tasks: {} } };
  fs.writeFileSync(file + '.bak', JSON.stringify([source]));
  fs.writeFileSync(file, JSON.stringify([{ ...source, scan: { tasks: { broken: { types: { RSRP: { layers: [null] } } } } } }]));
  const { createSourcesStore } = require('../src/sourcesStore');
  const store = createSourcesStore(file);
  assert.equal(store.list()[0].id, source.id); assert.ok(store.warnings.some(warning => warning.includes('恢复')));
  const newer = JSON.stringify({ schemaVersion: 99, sources: [source] });
  fs.writeFileSync(file, newer);
  assert.throws(() => createSourcesStore(file), { code: 'NEWER_SCHEMA' });
  assert.equal(fs.readFileSync(file, 'utf8'), newer);
});

test('startup cleanup protects configured and historical output roots while retaining legacy cache', async t => {
  const root = temporary(t), { resolveWebPaths } = require('../src/runtimePaths');
  const paths = resolveWebPaths({ sourceRoot: path.resolve(__dirname, '../..'), dataDir: root });
  const { createSettingsStore } = require('../src/settingsStore');
  const settingsStore = createSettingsStore({ paths });
  settingsStore.update({ outputMode: 'separate', outputRoot: paths.exportDir });
  const oldExport = path.join(paths.exportDir, '00000000-0000-4000-8000-000000000001.zip');
  const oldCache = path.join(paths.cacheDir, 'source/RSRP/F1.png');
  for (const file of [oldExport, oldCache]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'preserve'); fs.utimesSync(file, new Date(0), new Date(0)); }
  let server = require('../src/serverApp').createServer({ paths, settingsStore });
  await server.listen();
  assert.ok(fs.existsSync(oldExport)); assert.ok(fs.existsSync(oldCache)); await server.close();
  const historical = job(root), { resolveOutput } = require('../src/outputPaths');
  historical.settingsSnapshot = { outputMode: 'separate', outputRoot: paths.exportDir };
  const output = resolveOutput({ source: { id: 'a', path: root }, taskId: '0', dataType: 'RSRP', fileName: 'F1.png', settings: { outputMode: 'separate', outputRoot: paths.exportDir } });
  historical.figures[0].output = output; historical.figures[0].pngFile = output.file;
  require('../src/jobStore').createJobStore({ directory: paths.jobsDir }).save(historical);
  settingsStore.update({ outputRoot: path.join(root, 'different-root') });
  server = require('../src/serverApp').createServer({ paths, settingsStore });
  t.after(() => server.close()); await server.listen();
  assert.ok(fs.existsSync(oldExport), 'history keeps the original output root protected after settings change');
});

test('analysis shutdown settles queued requests, terminates real active workers and rejects new work', async t => {
  const root = temporary(t), { createDemo } = require('../../scripts/create-demo.cjs');
  const { sourceDir } = createDemo(root), { scanSource } = require('../src/scanner');
  const tasks = Object.values(scanSource(sourceDir).tasks);
  const workerFile = path.join(root, 'delayed-worker.cjs');
  fs.writeFileSync(workerFile, 'setInterval(() => {}, 1000);');
  const workers = [], { Worker } = require('node:worker_threads');
  class ObservedWorker extends Worker { constructor(...args) { super(...args); workers.push(this); } }
  const analysis = require('../src/analysisService').createAnalysisService({ store: { get: () => ({ path: sourceDir, name: 'demo' }) }, workerFile, WorkerType: ObservedWorker });
  t.after(() => analysis.shutdown?.());
  const { resolveWebPaths } = require('../src/runtimePaths');
  const server = require('../src/serverApp').createServer({ paths: resolveWebPaths({ sourceRoot: path.resolve(__dirname, '../..'), dataDir: path.join(root, 'state') }), analysis });
  await server.listen(); t.after(() => server.close());
  const requests = tasks.map(task => analysis.analyzeRequest({ sourceId: 'a', taskId: task.id, dataType: 'RSRP', layers: task.types.RSRP.layers.map(layer => layer.key) }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(workers.length, 2);
  assert.equal(server.getActivity().analyzing, true);
  await server.close();
  const results = await Promise.all(requests);
  assert.ok(results.every(result => result.layers.every(layer => /关闭|停止/.test(layer.error))));
  assert.ok(workers.every(worker => worker.threadId === -1));
  assert.equal(analysis.hasActive(), false);
  await assert.rejects(analysis.analyzeRequest({}), { code: 'APP_CLOSING' });
});
