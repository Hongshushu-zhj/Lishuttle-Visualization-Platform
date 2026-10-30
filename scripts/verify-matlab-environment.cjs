const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createProcessSupervisor } = require('../backend/src/processSupervisor');
const { createMatlabEnvironment, validateMatlabExecutable } = require('../backend/src/matlabEnvironment');

async function main() {
  const index = process.argv.indexOf('--matlab');
  const executable = validateMatlabExecutable(process.argv[index + 1]);
  const root = path.resolve(__dirname, '..');
  const evidence = path.join(root, '.desktop-test-data'); fs.mkdirSync(evidence, { recursive: true });
  const directory = fs.mkdtempSync(path.join(evidence, "matlab-env 中文 ' "));
  const matlabDir = path.join(directory, "resources 中文 ' MATLAB");
  fs.mkdirSync(matlabDir);
  for (const name of fs.readdirSync(path.join(root, 'matlab'))) if (name.endsWith('.m')) fs.copyFileSync(path.join(root, 'matlab', name), path.join(matlabDir, name));
  const paths = { dataDir: path.join(directory, 'data'), matlabDir };
  const supervisor = createProcessSupervisor({ stateDir: path.join(paths.dataDir, 'processes') });
  const environment = createMatlabEnvironment({ paths, supervisor });
  const detection = environment.startDetection({ executable }); await environment.waitForIdle();
  const checked = environment.getDetection(detection.id);
  console.log('REAL_ENVIRONMENT ' + checked.status + ' ' + (checked.matlabVersion || ''));
  assert.equal(checked.status, 'passed', JSON.stringify(checked));
  const controller = new AbortController(); let ready = false;
  const cancellation = await supervisor.run({ executable, args: ['-batch', "fprintf('SUPERVISOR_REAL_READY\\n'); pause(120);"],
    cwd: matlabDir, signal: controller.signal, timeoutMs: 180000,
    onStdout(text) { if (text.includes('SUPERVISOR_REAL_READY')) { ready = true; controller.abort(); } } });
  assert.ok(ready, JSON.stringify(cancellation));
  assert.equal(cancellation.status, 'cancelled', JSON.stringify(cancellation)); assert.equal(cancellation.cleanupConfirmed, true);
  console.log('REAL_MATLAB_CANCEL_CLEANUP_OK');
  const timeout = await supervisor.run({ executable, args: ['-batch', 'pause(120);'], cwd: matlabDir, timeoutMs: 2000 });
  assert.equal(timeout.status, 'timed_out', JSON.stringify(timeout)); assert.equal(timeout.cleanupConfirmed, true);
  console.log('REAL_MATLAB_TIMEOUT_CLEANUP_OK');
  const result = { at: new Date().toISOString(), directory, detection: checked,
    cancellation: { status: cancellation.status, cleanupConfirmed: cancellation.cleanupConfirmed },
    timeout: { status: timeout.status, cleanupConfirmed: timeout.cleanupConfirmed },
    note: '真实 MATLAB；资源与运行路径含中文、空格及单引号；仅使用独立合成数据。未模拟或改动用户许可。' };
  fs.writeFileSync(path.join(evidence, 'matlab-environment-real.json'), JSON.stringify(result, null, 2));
  console.log('MATLAB_ENVIRONMENT_REAL_OK');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
