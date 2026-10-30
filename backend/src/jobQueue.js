const crypto = require('node:crypto');
const path = require('node:path');
const { createJobStore, TERMINAL_STATES } = require('./jobStore');
const problem = (message, code, status = 409) => Object.assign(new Error(message), { code, status });
function createJobQueue({ config, JOBS_DIR, runMatlabJob, cache, supervisor, jobStore }) {
  jobStore ||= JOBS_DIR ? createJobStore({ directory: JOBS_DIR }) : { load: () => [], save() {} };
  const jobs = new Map(), queue = []; let active = null, stopping = false, blocked = '', scheduled = false;
  function count(job) {
    job.counts = { done: 0, failed: 0, cancelled: 0, pending: 0 };
    for (const f of job.figures) {
      if (['done', 'cached'].includes(f.status)) job.counts.done++;
      else if (f.status === 'failed') job.counts.failed++;
      else if (['cancelled', 'timed_out', 'interrupted'].includes(f.status)) job.counts.cancelled++;
      else job.counts.pending++;
    }
    job.done = job.counts.done; job.failed = job.counts.failed; job.cancelled = job.counts.cancelled;
  }
  function persist(job) {
    count(job);
    try { jobStore.save(job); }
    catch (error) {
      blocked = '任务记录无法保存，已停止新绘图：' + error.message;
      active?.controller.abort(); throw problem(error.message, 'JOB_STATE_WRITE_FAILED', 500);
    }
  }
  for (const job of jobStore.load()) {
    if (!TERMINAL_STATES.has(job.status)) {
      job.status = 'interrupted'; job.finishedAt = new Date().toISOString(); job.error = '应用上次运行被中断，未自动重跑';
      job.errorDetails = { code: 'JOB_INTERRUPTED', message: job.error, retryable: true, jobId: job.id };
      for (const f of job.figures) if (['pending', 'running'].includes(f.status)) f.status = 'interrupted';
      persist(job);
    }
    jobs.set(job.id, job);
  }
  const get = id => jobs.has(id) ? structuredClone(jobs.get(id)) : null;
  const blockedReason = () => blocked || supervisor?.getBlockedReason?.() || '';
  function schedule() { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; pump(); }); }
  function pump() {
    if (active || stopping || blockedReason()) return;
    while (queue.length) {
      const job = jobs.get(queue.shift()); if (job?.status !== 'queued') continue;
      const controller = new AbortController(), slot = { controller, job }; active = slot;
      slot.promise = execute(job, controller).finally(() => { if (!slot.unconfirmed) active = null; schedule(); });
      return;
    }
  }
  async function execute(job, controller) {
    let result;
    try {
      job.status = 'running'; job.startedAt = new Date().toISOString(); persist(job);
      const pending = job.figures.filter(f => f.status === 'pending');
      result = await runMatlabJob(job, pending,
        index => {
          const f = pending[index]; if (!f || f.status !== 'pending') throw problem('图片回报无效', 'JOB_FIGURE_INVALID');
          try { cache.markCached(f.sourceId, f.dataType, f.layer, f.demFile, f.variant, f.axes || null, f.taskId, f); f.status = 'done'; }
          catch (error) { f.status = 'failed'; f.error = '结果缓存发布失败：' + error.message; }
          persist(job);
        },
        (index, message) => { const f = pending[index]; if (!f) throw problem('图片回报无效', 'JOB_FIGURE_INVALID'); f.status = 'failed'; f.error = String(message); persist(job); },
        (index, axes) => { if (pending[index]) pending[index].axes = axes; },
        { signal: controller.signal, timeoutMs: job.settingsSnapshot.jobTimeoutMinutes * 60000, settingsSnapshot: job.settingsSnapshot, onRunPrepared: () => persist(job) });
      if (!result || result.cleanupConfirmed !== true) throw problem('MATLAB 所属进程退出尚未确认', 'PROCESS_CLEANUP_UNCONFIRMED');
      if (result.status !== 'done') throw Object.assign(problem(result.error || result.stderr || `任务已${result.status}`, 'MATLAB_RUN_FAILED'), { runResult: result });
      for (const f of pending) if (f.status === 'pending') { f.status = 'failed'; f.error = 'MATLAB 未返回本图完成结果'; }
      count(job); job.status = job.failed ? (job.done ? 'partial' : 'failed') : 'done';
      if (job.failed) job.error = `${job.failed} 张图片失败，可重试失败层`;
    } catch (error) {
      result ||= error.runResult;
      const unconfirmed = error.code === 'PROCESS_CLEANUP_UNCONFIRMED' || result?.cleanupConfirmed === false || !!supervisor?.getBlockedReason?.();
      if (unconfirmed) { blocked = 'MATLAB 所属进程退出尚未确认，已停止新绘图'; active.unconfirmed = true; }
      const end = !unconfirmed && ['cancelled', 'timed_out', 'interrupted'].includes(result?.status) ? result.status : 'failed';
      for (const f of job.figures) if (f.status === 'pending') { f.status = end; f.error = error.message; }
      count(job); job.status = end === 'failed' && job.done && !unconfirmed ? 'partial' : end;
      job.error = unconfirmed ? blocked : error.message;
      job.errorDetails = { code: unconfirmed ? 'PROCESS_CLEANUP_UNCONFIRMED' : error.code || 'MATLAB_RUN_FAILED', message: job.error, retryable: !unconfirmed, jobId: job.id, ...(result?.runDir ? { logId: path.basename(result.runDir) } : {}) };
    } finally {
      job.finishedAt = new Date().toISOString();
      try { persist(job); } catch (error) { job.status = 'failed'; job.error = blocked; job.errorDetails = { code: error.code, message: blocked, retryable: true, jobId: job.id }; }
    }
  }
  function create(figures) {
    if (stopping) throw problem('应用正在关闭，不能创建任务', 'APP_CLOSING');
    if (blockedReason()) throw problem(blockedReason(), 'PROCESS_CLEANUP_UNCONFIRMED');
    if (!active && supervisor?.isBusy()) throw problem('MATLAB 正在检测，稍后再绘图', 'MATLAB_BUSY');
    const job = { schemaVersion: 1, id: crypto.randomUUID(), status: 'queued', createdAt: new Date().toISOString(),
      total: figures.length, figures: structuredClone(figures), settingsSnapshot: { ...config },
      outputSnapshot: figures.map(f => ({ key: f.key, pngFile: f.pngFile })), error: null };
    persist(job); jobs.set(job.id, job); queue.push(job.id); schedule(); return get(job.id);
  }
  function cancel(id) {
    const job = jobs.get(id); if (!job) throw problem('任务不存在', 'JOB_NOT_FOUND', 404);
    if (TERMINAL_STATES.has(job.status) || job.status === 'cancelling') return get(id);
    if (job.status === 'queued') {
      job.status = 'cancelled'; for (const f of job.figures) if (f.status === 'pending') f.status = 'cancelled'; job.finishedAt = new Date().toISOString(); persist(job);
    } else { job.status = 'cancelling'; try { persist(job); } finally { active?.controller.abort(); } }
    return get(id);
  }
  async function waitForIdle() {
    do { await Promise.resolve(); if (active?.promise) await active.promise; else if (queue.some(id => jobs.get(id)?.status === 'queued') && !stopping && !blockedReason()) { schedule(); await new Promise(r => setImmediate(r)); } else return; }
    while (!blockedReason());
  }
  async function shutdown() {
    stopping = true;
    let failure;
    for (const job of jobs.values()) if (['queued', 'running', 'cancelling'].includes(job.status)) { try { cancel(job.id); } catch (error) { failure ||= error; } }
    if (active?.promise) await active.promise;
    if (blockedReason()) throw problem(blockedReason(), 'PROCESS_CLEANUP_UNCONFIRMED');
    if (failure) throw failure;
  }
  return { create, get, cancel, waitForIdle, shutdown, list: () => [...jobs.values()].map(job => get(job.id)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)),
    hasActive: () => !!active || queue.some(id => jobs.get(id)?.status === 'queued'), getBlockedReason: blockedReason };
}
const { lazyService } = require('./lazyService');
module.exports = lazyService(() => { const runtime = require('./config'); return createJobQueue({ config: runtime.config, JOBS_DIR: runtime.JOBS_DIR, runMatlabJob: require('./matlabRunner').runMatlabJob, cache: require('./cache') }); }, { createJobQueue });
