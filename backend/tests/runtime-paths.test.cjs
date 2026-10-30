const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('stable/dev 用户根隔离，资源路径不依赖 cwd，解析本身不写入安装目录', t => {
  const { resolveRuntimePaths } = require('../src/runtimePaths');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resourcesDir = path.join(root, 'installed', 'resources');
  const localAppData = path.join(root, 'users');
  const stable = resolveRuntimePaths({ channel: 'stable', resourcesDir, localAppData });
  const dev = resolveRuntimePaths({ channel: 'dev', resourcesDir, localAppData });
  assert.equal(stable.dataDir, path.join(localAppData, 'AntennaDraw'));
  assert.equal(dev.dataDir, path.join(localAppData, 'AntennaDraw-Dev'));
  assert.notEqual(stable.dataDir, dev.dataDir);
  assert.equal(stable.matlabDir, path.join(resourcesDir, 'matlab'));
  assert.equal(stable.frontendDir, path.join(resourcesDir, 'frontend'));
  assert.equal(fs.existsSync(resourcesDir), false);
  assert.throws(() => resolveRuntimePaths({ channel: 'other', resourcesDir, localAppData }), /渠道/);
  assert.throws(() => resolveRuntimePaths({ channel: 'dev', resourcesDir, dataDir: path.join(resourcesDir, 'data') }), /安装资源/);
});

test('源码 CLI 的显式 dev 根与独立用户目录可用，拒绝相对路径', () => {
  const { resolveRuntimePaths } = require('../src/runtimePaths');
  const sourceRoot = path.resolve(__dirname, '../..');
  const dataDir = path.join(os.tmpdir(), 'antenna-explicit-dev');
  const result = resolveRuntimePaths({ channel: 'dev', sourceRoot, dataDir });
  assert.equal(result.frontendDir, path.join(sourceRoot, 'frontend/dist'));
  assert.equal(result.jobsDir, path.join(dataDir, 'jobs'));
  assert.throws(() => resolveRuntimePaths({ channel: 'dev', sourceRoot, dataDir: 'relative' }), /绝对路径/);
});
