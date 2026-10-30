const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resolveRuntimePaths } = require('../src/runtimePaths');
const { resolveOutput, prepareOutput } = require('../src/outputPaths');
const { createJobStore } = require('../src/jobStore');
const { createServer } = require('../src/serverApp');
const { png } = require('./fixtures/png.cjs');
test('history image and ZIP use saved output snapshot after settings change and source removal', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-history-'));
  const paths = resolveRuntimePaths({ channel: 'dev', dataDir: path.join(root, 'state'), sourceRoot: path.resolve(__dirname, '../..') });
  const output = resolveOutput({ source: { path: root, id: 'a' }, taskId: '0', dataType: 'RSRP', fileName: 'old.png', settings: { outputMode: 'source' } });
  prepareOutput(output); fs.writeFileSync(output.file, png());
  createJobStore({ directory: paths.jobsDir }).save({ schemaVersion: 1, id: 'history', status: 'done', createdAt: new Date().toISOString(), total: 1, done: 1,
    figures: [{ key: 'a:0:RSRP:F1', sourceId: 'a', sourceName: 'old source', taskId: '0', taskName: 'old task', dataType: 'RSRP', layer: 'F1', status: 'done', pngFile: output.file, output, url: '/api/images/a/RSRP/F1.png?taskId=0' }] });
  const server = createServer({ paths });
  t.after(async () => { await server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const { origin } = await server.listen();
  server.settingsStore.update({ outputMode: 'separate', outputRoot: path.join(root, 'new') });
  const job = await (await fetch(origin + '/api/jobs/history')).json();
  assert.deepEqual(Buffer.from(await (await fetch(origin + job.figures[0].url)).arrayBuffer()), png());
  const result = await fetch(origin + '/api/jobs/history/export', { method: 'POST' }); assert.equal(result.status, 200);
  const zip = await result.json(); assert.equal(zip.count, 1);
  const saved = Buffer.from(await (await fetch(origin + zip.url)).arrayBuffer()); assert.equal(saved.toString('ascii',0,2), 'PK'); assert.ok(saved.includes(Buffer.from('old source')));
});
