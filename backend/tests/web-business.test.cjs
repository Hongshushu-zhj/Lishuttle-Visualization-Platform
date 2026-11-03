const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-web-business-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('preference patches merge metrics and individual fields without losing another tab updates', t => {
  const dataDir = fixture(t);
  const { createSettingsStore } = require('../src/settingsStore');
  const store = createSettingsStore({ paths: { channel: 'web', dataDir } });
  store.updatePreferences({ colorRanges: { RSRP: { range: [-110, -40], enabled: true } } });
  store.updatePreferences({ colorRanges: { SCR: { range: [-20, 30], enabled: true } } });
  store.updatePreferences({ colorRanges: { RSRP: { enabled: false } }, analysisConfig: { SCR: { threshold: 4 } } });
  const saved = createSettingsStore({ paths: { channel: 'web', dataDir } }).getPreferences();
  assert.deepEqual(saved.colorRanges.RSRP, { range: [-110, -40], enabled: false });
  assert.deepEqual(saved.colorRanges.SCR, { range: [-20, 30], enabled: true });
  assert.deepEqual(saved.analysisConfig.SCR.boundaries, [-20, -10, 0, 10]);
  assert.equal(saved.analysisConfig.SCR.threshold, 4);
  assert.equal(store.get().outputMode, 'source');
});

test('legacy JSON preference import preserves source IDs and is repeatable without duplicate records', t => {
  const dataDir = fixture(t), directory = path.join(dataDir, 'legacy');
  fs.mkdirSync(path.join(directory, 'backend/data'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'backend/config.json'), '{}');
  fs.writeFileSync(path.join(directory, 'backend/data/sources.json'), JSON.stringify([{ id: 'preserved-id', path: path.join(dataDir, 'offline-source') }]));
  const { createSettingsStore } = require('../src/settingsStore');
  const { createSourcesStore } = require('../src/sourcesStore');
  const { importLegacyDirectory } = require('../src/legacyImport');
  const settingsStore = createSettingsStore({ paths: { channel: 'web', dataDir } });
  const sourcesStore = createSourcesStore(path.join(dataDir, 'sources.json'));
  settingsStore.updatePreferences({ colorRanges: { SCR: { range: [-20, 20], enabled: true } } });
  const preferences = { schemaVersion: 1, colorRanges: { RSRP: { range: [-120, -60], enabled: true } }, analysisConfig: {} };
  for (let i = 0; i < 2; i++) importLegacyDirectory({ directory, settingsStore, sourcesStore, preferences });
  assert.equal(sourcesStore.list().length, 1);
  assert.equal(sourcesStore.list()[0].id, 'preserved-id');
  assert.deepEqual(settingsStore.getPreferences().colorRanges, { ...preferences.colorRanges, SCR: { range: [-20, 20], enabled: true } });
  assert.equal(settingsStore.getPreferences().analysisConfig.SCR.threshold, 0);
  const before = settingsStore.getPreferences();
  assert.throws(() => importLegacyDirectory({ directory, settingsStore, sourcesStore, preferences: { ...preferences, schemaVersion: 99 } }));
  assert.deepEqual(settingsStore.getPreferences(), before);
  assert.throws(() => importLegacyDirectory({ directory, settingsStore,
    sourcesStore: { list: sourcesStore.list.bind(sourcesStore), replace() { throw new Error('blocked registry'); } },
    preferences: { ...preferences, colorRanges: { ECHORP: { range: [-170, -80], enabled: true } } },
  }), /blocked registry/);
  assert.deepEqual(settingsStore.getPreferences(), before);
});

test('CRC32 uses standard vectors and PNG validation works without zlib.crc32', () => {
  const { crc32 } = require('../src/crc32');
  assert.equal(crc32(Buffer.alloc(0)), 0);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('The quick brown fox jumps over the lazy dog')), 0x414fa339);
  const zlib = require('node:zlib'), native = zlib.crc32;
  try {
    zlib.crc32 = undefined;
    const { validatePng } = require('../src/outputPaths');
    const { png } = require('./fixtures/png.cjs');
    assert.deepEqual(validatePng(png()), { width: 1, height: 1 });
    const broken = png(); broken[45] ^= 1;
    assert.throws(() => validatePng(broken), { code: 'PNG_INVALID' });
    assert.throws(() => validatePng(png().subarray(0, 50)), { code: 'PNG_INVALID' });
  } finally { zlib.crc32 = native; }
});

test('plot readiness gates real pending work and retries, while dry runs and cached plots remain available', async t => {
  const dataDir = fixture(t);
  const { createDemo } = require('../../scripts/create-demo.cjs');
  const { sourceDir } = createDemo(path.join(dataDir, 'fixture'));
  const { createSourcesStore } = require('../src/sourcesStore');
  const { createCache } = require('../src/cache');
  const { scanSource } = require('../src/scanner');
  const { createRoutes } = require('../src/routes');
  const express = require('express');
  const sourcesStore = createSourcesStore(path.join(dataDir, 'sources.json'));
  const source = sourcesStore.add(sourceDir, scanSource(sourceDir));
  const task = Object.values(source.scan.tasks)[0];
  const config = { outputMode: 'source' };
  const cache = createCache({ CACHE_DIR: path.join(dataDir, 'cache'), sourcesStore, config });
  let cached = false, ready = false, gates = 0, creations = 0, previous;
  cache.isCached = () => cached;
  const jobQueue = {
    get: () => previous,
    create(figures) { creations++; return { id: 'new-job', figures, total: figures.length, status: 'queued' }; },
  };
  const app = express(); app.use(express.json());
  app.use('/api', createRoutes({ config, sourcesStore, cache, jobQueue, ensurePlotReady: async () => {
    gates++; await Promise.resolve();
    if (!ready) throw Object.assign(new Error('请先检测 MATLAB'), { status: 409, code: 'MATLAB_NOT_READY' });
  } }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message, code: error.code }));
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(origin + '/api' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const request = { requests: [{ sourceId: source.id, taskId: task.id, dataType: 'RSRP', layers: ['all'] }] };
  const dry = await post('/plot', { ...request, dryRun: true });
  assert.equal(dry.status, 200); const dryBody = await dry.json();
  assert.equal(gates, 0); assert.equal(creations, 0);
  cached = true;
  assert.equal((await post('/plot', request)).status, 200);
  assert.equal(gates, 0); assert.equal(creations, 0);
  cached = false;
  assert.equal((await post('/plot', request)).status, 409);
  assert.equal(gates, 1); assert.equal(creations, 0);
  previous = { status: 'failed', figures: dryBody.figures.map(f => ({ ...f, status: 'failed' })) };
  assert.equal((await post('/jobs/old/retry', {})).status, 409);
  assert.equal(gates, 2); assert.equal(creations, 0);
  ready = true;
  assert.equal((await post('/plot', request)).status, 200);
  assert.equal(gates, 3); assert.equal(creations, 1);
  assert.equal((await post('/jobs/old/retry', {})).status, 200);
  assert.equal(gates, 4); assert.equal(creations, 2);
});
