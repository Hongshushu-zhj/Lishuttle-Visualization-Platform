const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { createDemo } = require('./fixtures.cjs');

test('导入 serverApp 不读取个人配置或创建运行目录', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const fs = require('fs');
    fs.mkdirSync = () => { throw Error('import wrote a directory'); };
    const read = fs.readFileSync;
    fs.readFileSync = function(p, ...args) {
      if (/[/\\\\](config|sources)\\.json$/.test(String(p))) throw Error('import read user config');
      return read.call(this, p, ...args);
    };
    require('./backend/src/serverApp');
  `], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('显式目录的两个服务隔离、随机本机端口、认证、真实统计线程和关闭释放', async () => {
  const { createServer } = require('../../backend/src/serverApp');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-server-'));
  const secret = 'a'.repeat(64), name = 'antenna_test';
  const servers = [];
  function makePaths(id) {
    const dataDir = path.join(root, id);
    const frontendDir = path.join(root, 'frontend');
    fs.mkdirSync(frontendDir, { recursive: true });
    fs.writeFileSync(path.join(frontendDir, 'index.html'), '<html>bundled frontend</html>');
    return { channel: 'dev', dataDir, matlabDir: path.resolve(__dirname, '../../matlab'), frontendDir,
      jobsDir: path.join(dataDir, 'jobs'), exportDir: path.join(dataDir, 'exports'), cacheDir: path.join(dataDir, 'cache') };
  }
  try {
    const settingsStore = { get: () => ({ matlabExe: '', maxConcurrentJobs: 1 }) };
    for (const id of ['a', 'b']) servers.push(createServer({ paths: makePaths(id), settingsStore, sessionSecret: secret, sessionCookieName: name }));
    const [{ origin: a }, { origin: b }] = await Promise.all(servers.map(s => s.listen({ host: '127.0.0.1', port: 0 })));
    assert.notEqual(a, b);
    const headers = { Cookie: `${name}=${secret}`, Origin: a, 'Content-Type': 'application/json' };
    assert.equal((await fetch(a + '/api/sources')).status, 403);
    assert.equal((await fetch(a + '/api/sources', { headers: { ...headers, Origin: 'https://evil.invalid' } })).status, 403);
    const demo = createDemo(root);
    const added = await fetch(a + '/api/sources', { method: 'POST', headers, body: JSON.stringify({ path: demo.sourceDir }) });
    assert.equal(added.status, 200); const source = await added.json();
    assert.deepEqual(await (await fetch(b + '/api/sources', { headers: { Cookie: `${name}=${secret}` } })).json(), []);
    const stats = await fetch(a + '/api/analysis', { method: 'POST', headers,
      body: JSON.stringify({ sourceId: source.id, taskId: '室内 A', dataType: 'RSRP', layers: ['F1'] }) });
    assert.equal(stats.status, 200);
    assert.equal((await stats.json()).layers[0].mean, -90);
    assert.match(await (await fetch(a)).text(), /bundled frontend/);
    const port = Number(new URL(a).port);
    await servers[0].close();
    const probe = net.createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
  } finally {
    await Promise.all(servers.map(s => s.close()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
