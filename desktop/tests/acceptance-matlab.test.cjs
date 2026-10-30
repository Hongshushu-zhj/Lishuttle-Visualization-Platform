const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('外机 MATLAB 路径作为独立参数启动，转义单引号并记录真实版本', async () => {
  const { createMatlabRunner } = require('../../backend/src/matlabRunner');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "antenna test's-"));
  try {
    const job = { id: 'test' };
    let launched;
    const run = createMatlabRunner({ config: { matlabExe: "C:\\Program Files\\MATLAB's\\bin\\matlab.exe" }, JOBS_DIR: root, MATLAB_DIR: root,
      supervisor: { async run(options) {
        launched = options;
        options.onStdout('ANTENNA_MATLAB_VER');
        options.onStdout('SION 9.12.0.1884302 (R2022a)\nDONE');
        return { status: 'done', cleanupConfirmed: true, exitCode: 0, stdout: '', stderr: '' };
      } },
    });
    await run.runMatlabJob(job, [], () => {}, () => {});
    assert.equal(launched.executable, "C:\\Program Files\\MATLAB's\\bin\\matlab.exe");
    assert.equal(launched.cwd, root);
    assert.equal(launched.args[0], '-batch');
    assert.ok(launched.args[1].includes(root.replace(/'/g, "''")));
    assert.equal(job.matlabVersion, '9.12.0.1884302 (R2022a)');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
