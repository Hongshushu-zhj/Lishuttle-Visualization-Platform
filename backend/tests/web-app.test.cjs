const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function start(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-web-http-'));
  const { resolveWebPaths } = require('../src/runtimePaths');
  const { createServer } = require('../src/serverApp');
  const paths = resolveWebPaths({ sourceRoot: path.resolve(__dirname, '../..'), dataDir: root });
  const service = createServer({ paths, shutdownToken: 'test-'.repeat(10), ...options });
  const { origin } = await service.listen();
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  async function call(url, method = 'GET', body, headers = {}) {
    const response = await fetch(origin + '/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(method === 'GET' ? {} : { Origin: origin }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  return { root, paths, service, origin, call };
}

test('本机 Web 可无 MATLAB 使用演示分析，首次引导与偏好可持久保存', async t => {
  const { call, service } = await start(t);
  const health = await call('/health');
  assert.equal(health.data.app, 'antenna-draw-web');
  assert.equal((await call('/app-info')).data.mode, 'web');
  assert.equal((await call('/onboarding')).data.completed, false);
  assert.equal((await call('/onboarding/demo', 'POST')).status, 200);
  const sources = (await call('/sources')).data;
  assert.equal(sources.length, 1);
  assert.equal(sources[0].tasks.length, 3);
  const indoor = sources[0].tasks.find(task => task.indoor);
  const analyzed = await call('/analysis', 'POST', { sourceId: sources[0].id, taskId: indoor.id, dataType: 'RSRP', layers: ['F1'] });
  assert.equal(analyzed.status, 200);
  assert.equal(analyzed.data.layers[0].error, undefined);
  assert.equal(analyzed.data.layers[0].validCount, 3);
  assert.equal(analyzed.data.layers[0].mean, -90);
  const dry = await call('/plot', 'POST', { requests: [{ sourceId: sources[0].id, taskId: indoor.id, dataType: 'RSRP', layers: ['F1'] }], dryRun: true });
  assert.equal(dry.status, 200);
  const plot = await call('/plot', 'POST', { requests: [{ sourceId: sources[0].id, taskId: indoor.id, dataType: 'RSRP', layers: ['F1'] }] });
  assert.equal(plot.status, 409);
  assert.equal(plot.data.code, 'MATLAB_NOT_READY');
  assert.equal(service.jobs.list().length, 0);
  assert.equal((await call('/onboarding/complete', 'POST')).data.completed, true);
  await call('/preferences', 'PATCH', { colorRanges: { RSRP: { range: [-100, -50], enabled: true } } });
  await call('/preferences', 'PATCH', { colorRanges: { SCR: { range: [-20, 20], enabled: true } } });
  const prefs = (await call('/preferences')).data;
  assert.deepEqual(prefs.colorRanges.RSRP.range, [-100, -50]);
  assert.deepEqual(prefs.colorRanges.SCR.range, [-20, 20]);
  assert.equal((await call('/preferences/import', 'POST', { preferences: { ...prefs, colorRanges: { RSRP: { range: [-120, -40], enabled: false } } } })).status, 200);
  assert.deepEqual((await call('/preferences')).data.colorRanges.SCR.range, [-20, 20]);
  const migrated = await call('/preferences/import', 'POST', { preferences: { colorRanges: { RSRP: { range: [-115, -45], enabled: true } }, analysisConfig: {} } });
  assert.equal(migrated.status, 200, '旧浏览器偏好无需预先具有服务端 schema 字段');
  assert.deepEqual(migrated.data.colorRanges.RSRP.range, [-115, -45]);
  assert.deepEqual(migrated.data.colorRanges.SCR.range, [-20, 20]);
});

test('修改请求拒绝外部来源和缺失 Origin，诊断只包含受限信息', async t => {
  const { call, origin, service } = await start(t);
  assert.equal((await call('/settings', 'PATCH', { jobTimeoutMinutes: 60 }, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await call('/settings', 'PATCH', { jobTimeoutMinutes: 60 }, { Origin: '' })).status, 403);
  assert.equal((await call('/settings', 'PATCH', { jobTimeoutMinutes: 60 })).status, 200);
  service.diagnostics.log('test diagnostic', { password: 'private-secret' });
  const preview = (await call('/diagnostics')).data;
  assert.equal(preview.schemaVersion, 1);
  assert.match(JSON.stringify(preview), /test diagnostic/);
  assert.doesNotMatch(JSON.stringify(preview), /private-secret/);
  const downloaded = await fetch(origin + '/api/diagnostics/download');
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers.get('content-disposition'), /attachment/);
  assert.equal((await downloaded.json()).schemaVersion, 1);
});

test('MATLAB 文件浏览仅列出 matlab.exe，停止接口需要正确实例令牌', async t => {
  let requested = false;
  const { root, call } = await start(t, { onShutdown: () => { requested = true; } });
  const directory = path.join(root, 'files'); fs.mkdirSync(directory);
  for (const name of ['matlab.exe', 'other.exe', 'private.json']) fs.writeFileSync(path.join(directory, name), 'fixture');
  const result = await call('/fs/files?type=matlab&path=' + encodeURIComponent(directory));
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.files.map(file => file.name), ['matlab.exe']);
  assert.equal((await call('/runtime/shutdown', 'POST', {}, { 'X-Antenna-Shutdown-Token': 'wrong' })).status, 403);
  assert.equal(requested, false);
  assert.equal((await call('/runtime/shutdown', 'POST', {}, { 'X-Antenna-Shutdown-Token': 'test-'.repeat(10) })).status, 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requested, true);
});
