const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-web-config-'));
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Web 配置保留本地数据根与端口，读取配置不创建运行文件', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'backend/config.json'), JSON.stringify({ port: 8123, matlabExe: 'D:\\MATLAB\\R2022a\\bin\\matlab.exe', maxConcurrentJobs: 4, _说明: '原配置' }));
  const { loadWebConfiguration } = require('../src/config');
  assert.equal(typeof loadWebConfiguration, 'function', '需要无副作用的 Web 配置加载器');
  const result = loadWebConfiguration({ sourceRoot: root });
  assert.equal(result.port, 8123);
  assert.equal(result.paths.dataDir, path.join(root, 'backend/data'));
  assert.equal(result.paths.sourceRoot, root);
  assert.equal(result.initialSettings.outputMode, 'source');
  assert.equal(result.initialSettings.maxConcurrentJobs, 1);
  assert.equal(result.initialSettings.jobTimeoutMinutes, 30);
  assert.match(result.warnings.join(' '), /并发/);
  assert.equal(fs.existsSync(result.paths.dataDir), false);
});

test('旧配置仅迁入一次并备份；更新后不再被 config.json 覆盖', t => {
  const root = fixture(t), file = path.join(root, 'backend/config.json');
  fs.writeFileSync(file, JSON.stringify({ port: 8000, matlabExe: 'D:\\MATLAB\\old\\bin\\matlab.exe', _说明: '保留' }));
  const { loadWebConfiguration, createWebSettingsStore } = require('../src/config');
  assert.equal(typeof createWebSettingsStore, 'function', '需要一次迁移及备份');
  const first = loadWebConfiguration({ sourceRoot: root });
  const store = createWebSettingsStore(first);
  assert.equal(store.get().matlabExe, 'D:\\MATLAB\\old\\bin\\matlab.exe');
  assert.ok(fs.existsSync(path.join(first.paths.dataDir, 'migration/config.json')));
  store.update({ matlabExe: 'D:\\MATLAB\\new\\bin\\matlab.exe' });
  assert.equal(createWebSettingsStore(loadWebConfiguration({ sourceRoot: root })).get().matlabExe, 'D:\\MATLAB\\new\\bin\\matlab.exe');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))._说明, '保留');
});

test('配置损坏或非法端口明确报错，显式测试数据根覆盖默认目录', t => {
  const root = fixture(t), file = path.join(root, 'backend/config.json');
  const { loadWebConfiguration } = require('../src/config');
  assert.equal(typeof loadWebConfiguration, 'function');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => loadWebConfiguration({ sourceRoot: root }), /配置/);
  fs.writeFileSync(file, JSON.stringify({ port: 70000 }));
  assert.throws(() => loadWebConfiguration({ sourceRoot: root }), /端口/);
  fs.writeFileSync(file, '{}');
  const dataDir = path.join(root, '独立 Web 数据');
  assert.equal(loadWebConfiguration({ sourceRoot: root, dataDir }).paths.dataDir, dataDir);
});
