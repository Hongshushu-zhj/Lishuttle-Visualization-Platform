const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

test('外机 MATLAB 路径作为独立参数启动，转义单引号并记录真实版本', async () => {
  const { createMatlabRunner } = require('../../backend/src/matlabRunner');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "antenna test's-"));
  try {
    const job = { id: 'test' };
    let launched;
    const run = createMatlabRunner({ config: { matlabExe: "C:\\Program Files\\MATLAB's\\bin\\matlab.exe" }, JOBS_DIR: root, MATLAB_DIR: root,
      launch(executable, args, options) {
        launched = { executable, args, options };
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
        queueMicrotask(() => {
          child.stdout.write('ANTENNA_MATLAB_VER');
          child.stdout.end('SION 9.12.0.1884302 (R2022a)\nDONE\n');
          child.emit('close', 0);
        });
        return child;
      },
    });
    await run.runMatlabJob(job, [], () => {}, () => {});
    assert.equal(launched.executable, "C:\\Program Files\\MATLAB's\\bin\\matlab.exe");
    assert.equal(launched.options.shell, false);
    assert.equal(launched.args[0], '-batch');
    assert.ok(launched.args[1].includes(root.replace(/'/g, "''")));
    assert.equal(job.matlabVersion, '9.12.0.1884302 (R2022a)');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
