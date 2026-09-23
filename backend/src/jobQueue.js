const crypto = require('crypto');
const { config } = require('./config');
const { runMatlabJob } = require('./matlabRunner');
const cache = require('./cache');

// 绘图任务队列:每个任务 = 一次 MATLAB 进程,包含一批待画图。
// 同一时间最多跑 maxConcurrentJobs 个 MATLAB 进程(默认 1)。
// job.figures[i].status: cached | pending | done | failed
class JobQueue {
  constructor() {
    this.queue = [];
    this.running = 0;
    this.jobs = new Map();
  }

  create(figures) {
    const id = crypto.randomUUID();
    const job = {
      id,
      status: 'queued',
      createdAt: new Date().toISOString(),
      total: figures.length,
      done: figures.filter((f) => f.status === 'cached').length,
      failed: 0,
      figures: figures.map((f) => ({ ...f })),
      error: null,
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this.pump();
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  pump() {
    const max = config.maxConcurrentJobs || 1;
    while (this.running < max && this.queue.length) {
      const id = this.queue.shift();
      this.startJob(this.jobs.get(id));
    }
  }

  async startJob(job) {
    job.status = 'running';
    this.running++;
    try {
      const pending = job.figures.filter((f) => f.status === 'pending');
      await runMatlabJob(
        job,
        pending,
        (idx) => {
          const f = pending[idx];
          f.status = 'done';
          job.done++;
          try {
            cache.markCached(f.sourceId, f.dataType, f.layer, f.demFile);
          } catch (e) {
            // 缓存标记失败不影响绘图结果本身
          }
        },
        (idx, msg) => {
          pending[idx].status = 'failed';
          pending[idx].error = msg;
          job.failed++;
        }
      );
      job.status = 'done';
    } catch (e) {
      job.status = 'failed';
      job.error = e.message;
      for (const f of job.figures) {
        if (f.status === 'pending') {
          f.status = 'failed';
          f.error = job.error;
        }
      }
    } finally {
      this.running--;
      this.pump();
    }
  }
}

module.exports = new JobQueue();
