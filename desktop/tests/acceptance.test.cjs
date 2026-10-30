const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDemo } = require('./fixtures.cjs');

test('验收报告如实保留失败项和未执行项，不包含会话信息或机器路径', async () => {
  const { runAcceptanceChecks } = require('../acceptanceChecks.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-acceptance-'));
  try {
    const report = await runAcceptanceChecks({
      reportDir: root, sourceDir: createDemo(root).sourceDir,
      buildInfo: { revision: 'abc', workingTreeDirty: false, version: '1.0.0-alpha.2' },
      environment: { platform: 'win32', release: '10.0', arch: 'x64', electron: '45.1.0', node: '24.22.1' },
      cleanEnvironmentConfirmed: false,
      request: async (url, body) => {
        if (url === '/sources') return { id: 'synthetic' };
        if (url === '/analysis') throw new Error('线程无法启动');
        throw new Error('不应该启动后续绘图');
      },
    });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.cleanEnvironmentConfirmed, false);
    assert.equal(report.checks.find(c => c.id === 'worker').status, 'FAIL');
    assert.equal(report.checks.find(c => c.id === 'matlab').status, 'NOT_RUN');
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'acceptance-report.json'), 'utf8'));
    assert.deepEqual(saved, report);
    assert.ok(!JSON.stringify(saved).includes(root));
    assert.ok(!JSON.stringify(saved).includes('sessionSecret'));
    assert.equal(saved.checks.find(c => c.id === 'worker').message, '线程无法启动');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('验收使用包内资源且依次验证真实 API、PNG 签名、统计值和下载文件', async () => {
  const { runAcceptanceChecks } = require('../acceptanceChecks.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-acceptance-'));
  const requestLog = [];
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const downloaded = [];
  try {
    const report = await runAcceptanceChecks({
      reportDir: root, sourceDir: createDemo(root).sourceDir,
      buildInfo: { version: 'test', revision: 'abc', workingTreeDirty: false }, environment: {}, cleanEnvironmentConfirmed: true,
      request: async (url, body) => {
        requestLog.push({ url, body });
        if (url === '/sources') return { id: 'synthetic' };
        if (url === '/analysis') return { layers: [{ mean: -90, validCount: 3 }, { mean: -90, validCount: 3 }] };
        if (url === '/plot') return { jobId: 'test' };
        if (url === '/jobs/test') return { status: 'done', total: 3, done: 3, failed: 0, figures: [1, 2, 3].map(i => ({ url: '/api/images/' + i + '?taskId=test' })) };
        if (url === '/export') return { count: 3, url: '/api/export/test/download' };
        throw Error('unexpected API ' + url);
      },
      readBytes: async url => png,
      decodePng: bytes => ({ width: 823, height: 426 }),
      download: async (url, file) => { fs.writeFileSync(file, url.includes('/export/') ? Buffer.from('504b030400000000', 'hex') : png); downloaded.push(file); },
    });
    assert.equal(report.status, 'PASS');
    assert.ok(report.checks.every(c => c.status === 'PASS'));
    assert.equal(downloaded.length, 2);
    assert.ok(downloaded.every(file => path.dirname(file) === path.join(root, 'downloads')));
    const plot = requestLog.find(r => r.url === '/plot');
    assert.deepEqual(plot.body.requests.map(r => r.dataType), ['RSRP', 'SCR', 'BESTSERVER']);
    assert.equal(report.checks.find(c => c.id === 'matlab').details.done, 3);
    assert.equal(report.manualChecks.imageAppearance, 'NOT_RUN');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('损坏的 PNG 不能通过解码或下载验收', async () => {
  const { verifyPng } = require('../acceptanceChecks.cjs');
  assert.throws(() => verifyPng(Buffer.from('bad'), () => ({ width: 1000, height: 1000 })), /PNG/);
  assert.throws(() => verifyPng(Buffer.from('89504e470d0a1a0a', 'hex'), () => ({ width: 0, height: 0 })), /PNG/);
});
