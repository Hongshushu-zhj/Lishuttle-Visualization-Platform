const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/serverApp');
const { resolveRuntimePaths } = require('../src/runtimePaths');

test('持久偏好经过随机端口重启恢复，两个渠道不互读；坏更新返回 400 且不改变有效值', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-api-settings-'));
  const instances = [];
  t.after(async () => { await Promise.all(instances.map(s => s.close())); fs.rmSync(root, { recursive: true, force: true }); });
  async function start(channel) {
    const paths = resolveRuntimePaths({ channel, sourceRoot: path.resolve(__dirname, '../..'), localAppData: root });
    const service = createServer({ paths }); instances.push(service);
    const { origin } = await service.listen();
    return async (url, patch) => {
      const response = await fetch(origin + '/api' + url, patch === undefined ? {} : { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      return { status: response.status, data: await response.json() };
    };
  }
  const first = await start('dev');
  assert.equal((await first('/settings', { jobTimeoutMinutes: 50 })).status, 200);
  assert.equal((await first('/preferences', { colorRanges: { RSRP: { range: [-100, -50], enabled: true } } })).status, 200);
  await instances[0].close();
  const second = await start('dev'), stable = await start('stable');
  assert.equal((await second('/settings')).data.jobTimeoutMinutes, 50);
  assert.equal((await second('/preferences')).data.colorRanges.RSRP.range[0], -100);
  assert.deepEqual((await stable('/preferences')).data.colorRanges, {});
  assert.equal((await stable('/settings')).data.outputMode, 'source');
  assert.equal((await second('/settings', { maxConcurrentJobs: 9 })).status, 400);
  assert.equal((await second('/settings')).data.maxConcurrentJobs, 1);
});
