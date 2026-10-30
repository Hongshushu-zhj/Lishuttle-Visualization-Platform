const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { png } = require('./fixtures/png.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-output-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = { path: path.join(root, 'source'), name: '同名源', id: 'source-a' }; fs.mkdirSync(path.join(source.path, 'pred'), { recursive: true });
  return { root, source };
}
test('两种输出策略、同名数据源隔离；拒绝越界、pred 输入树、链接逃逸及不能写入的目录', t => {
  const { resolveOutput, prepareOutput } = require('../src/outputPaths'); const { root, source } = fixture(t);
  const args = { source, taskId: '中文任务', dataType: 'RSRP', fileName: '一层.png', settings: { outputMode: 'source' } };
  const beside = resolveOutput(args); assert.equal(beside.file, path.join(source.path, '路损结果图', '中文任务', 'RSRP', '一层.png'));
  const settings = { outputMode: 'separate', outputRoot: path.join(root, 'separate') };
  const isolated = resolveOutput({ ...args, settings }); assert.notEqual(isolated.file, beside.file);
  assert.notEqual(isolated.file, resolveOutput({ ...args, source: { ...source, id: 'source-b' }, settings }).file);
  assert.throws(() => resolveOutput({ ...args, taskId: '../escape' }), /路径|任务/);
  assert.throws(() => resolveOutput({ ...args, settings: { ...settings, outputRoot: path.join(source.path, 'pred', 'bad') } }), /输入|pred/);
  fs.mkdirSync(path.join(root, 'outside')); fs.mkdirSync(path.dirname(isolated.directory), { recursive: true });
  fs.symlinkSync(path.join(root, 'outside'), isolated.directory, 'junction'); assert.throws(() => prepareOutput(isolated), /链接|越界|路径/);
  const blocked = path.join(root, 'file'); fs.writeFileSync(blocked, 'not-directory');
  assert.throws(() => prepareOutput(resolveOutput({ ...args, settings: { ...settings, outputRoot: path.join(blocked, 'results') } })));
  assert.equal(fs.readdirSync(path.join(source.path, 'pred')).length, 0);
});
test('published file itself must remain within snapshot directory and cannot follow an escaping junction', t => {
  const { resolveOutput, prepareOutput } = require('../src/outputPaths'); const { root, source } = fixture(t);
  const output = resolveOutput({ source, taskId: '0', dataType: 'RSRP', fileName: 'f.png', settings: { outputMode: 'source' } });
  assert.throws(() => prepareOutput({ ...output, file: path.join(root, 'outside.png') }), /路径|越界/);
});
test('a separate Node instance cannot acquire an occupied output file', t => {
  const { acquireOutputLock } = require('../src/outputPaths'); const { root } = fixture(t); const file = path.join(root, 'same.png');
  const lease = acquireOutputLock(file);
  const child = require('node:child_process').spawnSync(process.execPath, ['-e', `try { require(${JSON.stringify(path.resolve(__dirname, '../src/outputPaths'))}).acquireOutputLock(process.argv[1]); process.exit(9); } catch (e) { if (e.code !== 'OUTPUT_BUSY') throw e; }`, file], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); lease.release(true);
});
test('输出锁跨实例排他，未确认清理不释放，只接受所属结果证明；原 PID 存不存在不参与判断', t => {
  const { acquireOutputLock } = require('../src/outputPaths'); const { root } = fixture(t); const file = path.join(root, 'result.png');
  const lock = acquireOutputLock(file); assert.throws(() => acquireOutputLock(file), /占用|确认/);
  lock.release(false); assert.throws(() => acquireOutputLock(file), /占用|确认/);
  const proof = path.join(root, 'result.json'); lock.setProof(proof); fs.writeFileSync(proof, JSON.stringify({ cleanupConfirmed: true }));
  assert.throws(() => acquireOutputLock(file), /占用|确认/);
  fs.writeFileSync(proof, JSON.stringify({ cleanupConfirmed: true, outputCleanupConfirmed: true }));
  const next = acquireOutputLock(file); next.release(true); assert.equal(fs.existsSync(file + '.antenna-lock'), false);
});
test('完整 PNG 验证后同目录替换，损坏图或源变化保留原图，不发布半成品', t => {
  const { resolveOutput, prepareOutput, publishPng } = require('../src/outputPaths'); const { source } = fixture(t);
  const output = resolveOutput({ source, taskId: '0', dataType: 'RSRP', fileName: 'f.png', settings: { outputMode: 'source' } }); prepareOutput(output);
  fs.writeFileSync(output.file, png()); const before = fs.readFileSync(output.file); const temporary = output.file + '.new.png';
  fs.writeFileSync(temporary, before.subarray(0, 30)); assert.throws(() => publishPng({ temporary, output }), /PNG/); assert.deepEqual(fs.readFileSync(output.file), before);
  fs.writeFileSync(temporary, before); assert.throws(() => publishPng({ temporary, output, validateInputs() { throw new Error('源文件变化'); } }), /变化/);
  assert.deepEqual(fs.readFileSync(output.file), before); fs.writeFileSync(temporary, before); publishPng({ temporary, output }); assert.equal(fs.existsSync(temporary), false);
});
