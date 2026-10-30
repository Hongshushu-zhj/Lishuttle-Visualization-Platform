const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { scanSource } = require('./scanner');
const { PLOT_TYPES } = require('./plotTypes');
const { resolveRaster } = require('./rasterData');

function createAnalysisService({ store }) {
const VERSION = 1;
const MAX_ACTIVE = 2, MAX_QUEUE = 256, MAX_CACHE_BYTES = 32 * 1024 * 1024;
let active = 0, cacheBytes = 0;
const waiting = [], cache = new Map(), inFlight = new Map();
const invalid = message => Object.assign(new Error(message), { status: 400 });

function pump() {
  while (active < MAX_ACTIVE && waiting.length) {
    const { figure, resolve, reject } = waiting.shift(); active++;
    let worker, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; active--;
      if (worker) worker.terminate().catch(() => {});
      error ? reject(error) : resolve(result);
      pump();
    };
    try {
      worker = new Worker(path.join(__dirname, 'analysisWorker.js'), { workerData: figure });
      worker.once('message', value => finish(value.error ? new Error(value.error) : null, value.result));
      worker.once('error', finish);
      worker.once('exit', code => { if (!settled) finish(new Error(`统计线程退出 (${code})`)); });
    } catch (error) { finish(error); }
  }
}

function fingerprint(figure) {
  const stat = fs.statSync(figure.demFile, { bigint: true });
  const index = fs.statSync(path.join(figure.preddir, 'index.txt'), { bigint: true });
  return JSON.stringify([VERSION, figure.demFile, String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs),
    String(index.size), String(index.mtimeNs), figure.bounds, figure.indoor, figure.dataType]);
}

async function statistics(figure) {
  const key = fingerprint(figure);
  if (cache.has(key)) {
    const item = cache.get(key); cache.delete(key); cache.set(key, item);
    return item.result;
  }
  if (inFlight.has(key)) return inFlight.get(key);
  if (waiting.length >= MAX_QUEUE) throw new Error('统计队列已满，请稍后重试');
  const pending = new Promise((resolve, reject) => { waiting.push({ figure, resolve, reject }); pump(); })
    .then(result => {
      if (fingerprint(figure) !== key) throw new Error('源文件在分析过程中发生变化，请重新分析');
      const bytes = Buffer.byteLength(JSON.stringify(result));
      if (bytes <= MAX_CACHE_BYTES) {
        while (cacheBytes + bytes > MAX_CACHE_BYTES || cache.size >= 64) {
          const first = cache.keys().next().value; cacheBytes -= cache.get(first).bytes; cache.delete(first);
        }
        cache.set(key, { result, bytes }); cacheBytes += bytes;
      }
      return result;
    }).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

async function analyzeRequest(body) {
  const { sourceId, taskId, dataType, layers } = body || {};
  if (typeof sourceId !== 'string' || typeof taskId !== 'string' || !taskId || !Object.hasOwn(PLOT_TYPES, dataType)) throw invalid('请选择有效的数据源、任务和指标');
  if (!Array.isArray(layers) || !layers.length || layers.length > 256 || layers.some(l => typeof l !== 'string' || !l)) throw invalid('请选择 1～256 个有效层');
  const source = store.get(sourceId);
  if (!source || !fs.existsSync(source.path)) throw invalid('数据源不存在或已离线');
  const scan = scanSource(source.path);
  if (!scan.ok) throw invalid(scan.error);
  const task = scan.tasks[taskId];
  if (!task || !Object.hasOwn(scan.tasks, taskId)) throw invalid('请选择有效的任务');
  const type = task.types[dataType];
  if (!type || !Object.hasOwn(task.types, dataType)) throw invalid('当前任务没有该指标');
  const requested = [...new Set(layers)];
  // 有效层按扫描顺序输出；已删除/不存在的层仍返回明确错误。
  const ordered = [...type.layers.filter(l => requested.includes(l.key)).map(l => l.key), ...requested.filter(k => !type.layers.some(l => l.key === k))];
  const results = await Promise.all(ordered.map(async layer => {
    const info = type.layers.find(l => l.key === layer);
    const identity = { layer, layerLabel: info?.label || layer };
    try {
      if (!info) throw new Error('该层数据不存在，请刷新数据源');
      const figure = { ...resolveRaster(task, type, info), dataType, preddir: task.predDir };
      return { ...identity, ...await statistics(figure) };
    } catch (error) { return { ...identity, error: error.message }; }
  }));
  return { sourceId, sourceName: source.name, taskId, taskName: task.name, dataType,
    indoor: task.indoor, analyzedAt: new Date().toISOString(), rulesVersion: VERSION, layers: results };
}

return { analyzeRequest };
}
const { lazyService } = require('./lazyService');
module.exports = lazyService(() => createAnalysisService({ store: require('./sourcesStore') }), { createAnalysisService });
