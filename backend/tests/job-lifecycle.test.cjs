const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tick = () => new Promise(r => setImmediate(r));
function setup(t, runMatlabJob, extra = {}) {
  const { createJobQueue } = require('../src/jobQueue');
  const JOBS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-jobs-'));
  t.after(() => fs.rmSync(JOBS_DIR, { recursive: true, force: true }));
  const config = { matlabExe: 'D:\\MATLAB\\bin\\matlab.exe', jobTimeoutMinutes: 30, maxConcurrentJobs: 1 };
  const queue = createJobQueue({ JOBS_DIR, config, runMatlabJob, cache: { markCached() {} }, ...extra });
  return { queue, JOBS_DIR, config };
}
const figure = key => ({ key, status: 'pending', sourceId: 'source', dataType: 'RSRP', layer: key, pngFile: `D:\\results\\${key}.png`, url: `/api/images/source/RSRP/${key}.png` });
test('queued 取消不启动、重复取消幂等；running 等待退出才释放槽位，使用设置快照', async t => {
  let release, calls = 0, snapshot, aborted = false;
  const { queue, config } = setup(t, async (job, figures, done, fail, axes, options) => {
    calls++; snapshot = options.settingsSnapshot; options.signal.addEventListener('abort', () => { aborted = true; });
    await new Promise(r => { release = r; }); return { status: 'cancelled', cleanupConfirmed: true };
  });
  const first = queue.create([figure('a')]); await tick();
  const second = queue.create([figure('b')]); queue.cancel(second.id); queue.cancel(second.id);
  assert.equal(queue.get(second.id).status, 'cancelled'); assert.equal(calls, 1);
  config.jobTimeoutMinutes = 100; assert.equal(snapshot.jobTimeoutMinutes, 30);
  queue.cancel(first.id); assert.equal(queue.get(first.id).status, 'cancelling'); assert.equal(aborted, true);
  assert.equal(queue.hasActive(), true); release(); await queue.waitForIdle();
  assert.equal(queue.get(first.id).status, 'cancelled'); assert.equal(queue.hasActive(), false); assert.equal(calls, 1);
});
test('逐图部分失败和超时按实际结果计数，失败不阻塞后续任务；终态取消不改完成结果', async t => {
  let count = 0;
  const { queue } = setup(t, async (job, figures, done, fail) => {
    count++;
    if (count === 1) { done(0); fail(1, '缺层'); return { status: 'done', cleanupConfirmed: true }; }
    if (count === 2) return { status: 'timed_out', cleanupConfirmed: true };
    done(0); return { status: 'done', cleanupConfirmed: true };
  });
  const a = queue.create([figure('a'), figure('b')]), b = queue.create([figure('c')]), c = queue.create([figure('d')]);
  await queue.waitForIdle();
  assert.equal(queue.get(a.id).status, 'partial'); assert.deepEqual(queue.get(a.id).counts, { done: 1, failed: 1, cancelled: 0, pending: 0 });
  assert.equal(queue.get(b.id).status, 'timed_out'); assert.equal(queue.get(b.id).figures[0].status, 'timed_out');
  assert.equal(queue.get(c.id).status, 'done'); queue.cancel(c.id); assert.equal(queue.get(c.id).status, 'done');
});
test('摘要持久化，重启将活动记录标 interrupted 且不自动执行；初始写失败不启动 MATLAB', async t => {
  const { queue, JOBS_DIR, config } = setup(t, async () => ({ status: 'done', cleanupConfirmed: true }));
  const job = queue.create([figure('a')]); queue.cancel(job.id); await queue.waitForIdle();
  const file = path.join(JOBS_DIR, job.id, 'status.json'); const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.status = 'running'; record.figures[0].status = 'pending'; fs.writeFileSync(file, JSON.stringify(record));
  const { createJobQueue } = require('../src/jobQueue'); let runs = 0;
  const restored = createJobQueue({ JOBS_DIR, config, cache: {}, runMatlabJob: async () => { runs++; } });
  assert.equal(restored.get(job.id).status, 'interrupted'); assert.equal(restored.get(job.id).figures[0].status, 'interrupted'); await tick(); assert.equal(runs, 0);
  const blocked = createJobQueue({ config, cache: {}, runMatlabJob: async () => { runs++; }, jobStore: { load: () => [], save: () => { throw new Error('disk full'); } } });
  assert.throws(() => blocked.create([figure('b')]), /disk full/); await tick(); assert.equal(runs, 0);
});
test('无法确认所属进程退出时阻止后续任务和 shutdown 成功', async t => {
  let calls = 0;
  const { queue } = setup(t, async () => { calls++; return { status: 'cancelled', cleanupConfirmed: false }; });
  const a = queue.create([figure('a')]), b = queue.create([figure('b')]);
  await tick(); await tick();
  assert.equal(queue.get(a.id).errorDetails.code, 'PROCESS_CLEANUP_UNCONFIRMED'); assert.equal(queue.get(b.id).status, 'queued'); assert.equal(calls, 1);
  assert.throws(() => queue.create([figure('c')]), /退出|确认/); await assert.rejects(queue.shutdown(), /退出|确认/);
});
test('退出取消所有排队与活动任务，并等待实际清理', async t => {
  let release;
  const { queue } = setup(t, async (job, figures, done, fail, axes, options) => {
    await new Promise(r => { release = r; options.signal.addEventListener('abort', r); });
    return { status: 'cancelled', cleanupConfirmed: true };
  });
  const a = queue.create([figure('a')]); await tick(); const b = queue.create([figure('b')]);
  await queue.shutdown(); assert.equal(queue.get(a.id).status, 'cancelled'); assert.equal(queue.get(b.id).status, 'cancelled');
  assert.throws(() => queue.create([figure('c')]), /关闭|退出/);
});
test('运行中状态写入失败会取消进程，但仍等待清理，不能假报完成或启动后续任务', async t => {
  let writes = 0, aborted = false, release;
  const { queue } = setup(t, async (job, figures, done, fail, axes, options) => {
    options.signal.addEventListener('abort', () => { aborted = true; });
    try { done(0); } catch { /* runner waits for supervisor cleanup after callback failure */ }
    await new Promise(r => { release = r; }); return { status: 'cancelled', cleanupConfirmed: true };
  }, { jobStore: { load: () => [], save() { if (++writes >= 3) throw new Error('disk full'); } } });
  const job = queue.create([figure('a')]); await tick(); assert.equal(aborted, true); assert.equal(queue.hasActive(), true);
  release(); await queue.waitForIdle(); assert.equal(queue.get(job.id).status, 'failed');
  assert.equal(queue.get(job.id).errorDetails.code, 'JOB_STATE_WRITE_FAILED'); assert.throws(() => queue.create([figure('b')]), /保存/);
});

test('监管器核实恢复后绘图队列解除归属阻塞，但保留原失败记录', async t => {
  let blocked = '', calls = 0;
  const supervisor = { getBlockedReason: () => blocked, isBusy: () => !!blocked };
  const { queue } = setup(t, async (job, figures, done) => {
    if (++calls === 1) { blocked = '所属进程退出尚未确认'; return { status: 'failed', cleanupConfirmed: false }; }
    done(0); return { status: 'done', cleanupConfirmed: true };
  }, { supervisor });
  const first = queue.create([figure('a')]); await tick(); await tick();
  assert.equal(queue.get(first.id).errorDetails.code, 'PROCESS_CLEANUP_UNCONFIRMED');
  blocked = '';
  assert.equal(queue.getBlockedReason(), '');
  assert.equal(queue.hasActive(), false);
  const next = queue.create([figure('b')]); await queue.waitForIdle();
  assert.equal(queue.get(next.id).status, 'done');
  assert.equal(queue.get(first.id).status, 'failed');
});
