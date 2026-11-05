const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createMatlabRunner } = require('../src/matlabRunner');
const { resolveOutput } = require('../src/outputPaths');
const { png } = require('./fixtures/png.cjs');
function fixture(t, run, cache = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-run-output-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = resolveOutput({ source: { id: 'a', path: root }, taskId: '0', dataType: 'RSRP', fileName: 'test.png', settings: { outputMode: 'source' } });
  const figure = { output, pngFile: output.file, dataType: 'RSRP', layer: 'F1' };
  const runner = createMatlabRunner({ config: { matlabExe: 'unused' }, JOBS_DIR: path.join(root, 'jobs'), MATLAB_DIR: root, supervisor: { run: opts => run(opts, figure) }, cache });
  return { figure, execute: (done = () => {}, failed = () => {}) => runner.runMatlabJob({ id: 'job-1' }, [figure], done, failed), root };
}
test('runner publishes only complete PNGs, validates source, and removes temporary output after confirmed cancel', async t => {
  for (const mode of ['done', 'bad', 'changed', 'cancelled']) {
    let done = 0, failed = 0;
    const f = fixture(t, async (options, figure) => {
      fs.writeFileSync(figure.temporary, mode === 'bad' || mode === 'cancelled' ? Buffer.from('partial') : png());
      if (mode !== 'cancelled') options.onStdout('PROGRESS 1/1\nDONE\n');
      return { status: mode === 'cancelled' ? 'cancelled' : 'done', cleanupConfirmed: true };
    }, { assertInputs() { if (mode === 'changed') throw new Error('source changed'); } });
    await f.execute(() => done++, () => failed++);
    assert.equal(done, mode === 'done' ? 1 : 0);
    assert.equal(failed, ['bad','changed'].includes(mode) ? 1 : 0);
    assert.equal(fs.existsSync(f.figure.pngFile), mode === 'done');
    assert.equal(fs.existsSync(f.figure.temporary), false);
    assert.equal(fs.existsSync(f.figure.pngFile + '.antenna-lock'), false);
  }
});
test('unknown supervisor rejection must retain output lease until termination is proven', async t => {
  const f = fixture(t, async () => { throw new Error('transport lost'); });
  await assert.rejects(f.execute(), /transport lost/);
  assert.equal(fs.existsSync(f.figure.pngFile + '.antenna-lock'), true);
  assert.equal(fs.existsSync(path.join(f.root, 'jobs/job-1/output-cleanup.json')), false);
});
