const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('检测路径必须为实际 matlab.exe；发现只检查常见目录，不执行候选', t => {
  const { validateMatlabExecutable, discoverMatlab } = require('../src/matlabEnvironment');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-matlab-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const exe = path.join(root, 'MATLAB', 'R2024b', 'bin', 'matlab.exe'); fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, 'fixture');
  assert.equal(validateMatlabExecutable(exe), exe);
  assert.throws(() => validateMatlabExecutable(path.join(root, 'matlab.exe')), /不存在/);
  assert.throws(() => validateMatlabExecutable(__filename), /matlab.exe/);
  assert.deepEqual(discoverMatlab({ roots: [path.join(root, 'MATLAB')] }), [exe]);
});

test('启动失败与许可失败使用不同错误码，检测报告不可仅凭文件存在就绪', async t => {
  const { createMatlabEnvironment } = require('../src/matlabEnvironment');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-environment-errors-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const executable = path.join(dir, 'matlab.exe'); fs.writeFileSync(executable, 'fixture');
  for (const [result, expected] of [
    [{ status: 'failed', cleanupConfirmed: true, exitCode: -1, error: 'CreateProcess failed' }, 'MATLAB_LAUNCH_FAILED'],
    [{ status: 'failed', cleanupConfirmed: true, exitCode: 1, stderr: 'License checkout failed. License Manager Error -15' }, 'MATLAB_LICENSE_FAILED'],
    [{ status: 'done', cleanupConfirmed: true, exitCode: 0 }, 'MATLAB_CHECK_FAILED'],
  ]) {
    const service = createMatlabEnvironment({ paths: { dataDir: dir, matlabDir: path.resolve(__dirname, '../../matlab') }, supervisor: { isBusy: () => false, run: async () => result } });
    assert.equal(service.getState(executable).status, 'not_checked');
    const detection = service.startDetection({ executable }); await service.waitForIdle();
    assert.equal(service.getDetection(detection.id).error.code, expected);
  }
});

test('环境检测真实能力协议、取消和超时状态；旧路径检测结果不会变成新路径就绪', async t => {
  const { createMatlabEnvironment } = require('../src/matlabEnvironment');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-environment-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const exe = path.join(dir, 'matlab.exe'); fs.writeFileSync(exe, 'fixture');
  let complete;
  const service = createMatlabEnvironment({ paths: { dataDir: dir, matlabDir: path.resolve(__dirname, '../../matlab') },
    supervisor: { isBusy: () => false, run: () => new Promise(r => { complete = r; }) } });
  const detection = service.startDetection({ executable: exe });
  assert.equal(detection.status, 'running');
  assert.throws(() => service.startDetection({ executable: exe }), /正在|占用/);
  await new Promise(r => setImmediate(r));
  complete({ status: 'timed_out', cleanupConfirmed: true, stdout: '', stderr: '' });
  await service.waitForIdle(); assert.equal(service.getDetection(detection.id).status, 'timed_out');
  const second = service.startDetection({ executable: exe });
  await new Promise(r => setImmediate(r)); service.cancelDetection(second.id);
  complete({ status: 'cancelled', cleanupConfirmed: true, stdout: '', stderr: '' });
  await service.waitForIdle(); assert.equal(service.getDetection(second.id).status, 'cancelled');
});

test('退出未确认后重新检测先恢复归属状态，恢复成功即释放检测槽位', async t => {
  const { createMatlabEnvironment } = require('../src/matlabEnvironment');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-retry-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const executable = path.join(dir, 'matlab.exe'); fs.writeFileSync(executable, 'fixture');
  let blocked = '上次所属进程是否退出尚未确认', recoveries = 0, runs = 0, recovered = 0;
  const supervisor = { isBusy: () => !!blocked, getBlockedReason: () => blocked,
    recover: async () => { recoveries++; blocked = null; },
    run: async () => { runs++; return { status: 'cancelled', cleanupConfirmed: true }; } };
  const service = createMatlabEnvironment({ paths: { dataDir: dir, matlabDir: path.resolve(__dirname, '../../matlab') }, supervisor,
    onRecovered: () => { assert.equal(blocked, null); recovered++; } });
  const check = service.startDetection({ executable }); await service.waitForIdle();
  assert.equal(recoveries, 1); assert.equal(recovered, 1); assert.equal(runs, 1);
  assert.equal(service.getDetection(check.id).status, 'cancelled');
  assert.equal(service.isActive(), false);
});
