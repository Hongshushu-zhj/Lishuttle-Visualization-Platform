const express = require('express');
const fs = require('fs');
const path = require('path');
const { scanSource } = require('./scanner');
const { rasterPreview } = require('./rasterPreview');
const { resolveRaster } = require('./rasterData');
const crypto = require('crypto');
const { listDrives, listDir } = require('./fsBrowse');
const { GROUND_LAYER, typeInfo, displayLabel, layerLabel } = require('./plotTypes');
const { normalizeCoordMode, unionRange, variantFor } = require('./renderOptions');
const { prepareOutput, publishPng, validatePng, acquireOutputLock } = require('./outputPaths');
const { atomicWriteJson } = require('./jsonStore');

function createRoutes({ config, EXPORT_DIR, sourcesStore, jobQueue, cache, exporter, analyzeRequest, openResultsFolder, openOutputFolder }) {
const router = express.Router();

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// 请求形如 [{ sourceId, dataType, layers: ['ground','10m',...] | ['all'] }]
// 生成 figure 对象:{ key, sourceId, sourceName, dataType, layer, preddir, demFile, pngFile, url, status }
function buildFigures(requests) {
  const figures = [];
  for (const req of requests || []) {
    const source = sourcesStore.get(req.sourceId);
    if (!source) throw httpErr(400, `数据源不存在: ${req.sourceId}`);
    if (!fs.existsSync(source.path)) throw httpErr(400, `数据源目录已不存在(离线): ${source.path}`);
    // 绘图前重新扫描,确保 index、楼层范围与墙线选择使用当前文件。
    const scan = scanSource(source.path);
    if (!scan.ok) throw httpErr(400, scan.error);
    sourcesStore.updateScan(source.id, scan);
    let task;
    try { task = sourcesStore.task(source.id, req.taskId); }
    catch (e) { throw httpErr(400, e.message); }
    const type = task.types[req.dataType];
    if (!type) throw httpErr(400, `数据源 ${source.name} 中没有数据类型 ${req.dataType}`);
    if (!type.known) throw httpErr(400, `数据类型 ${req.dataType} 暂无对应绘图脚本,暂不支持`);
    let layers = req.layers;
    if (!layers || layers.length === 0 || layers.includes('all')) {
      layers = type.layers.map((l) => l.key);
    }
    for (const layer of layers) {
      const layerInfo = type.layers.find((l) => l.key === layer);
      if (!layerInfo) continue; // 该源没有这一层,跳过
      const { demFile } = resolveRaster(task, type, layerInfo);
      if (!fs.existsSync(demFile)) continue;
      figures.push({
        key: `${source.id}|${task.id}|${req.dataType}|${layer}`,
        taskId: task.id,
        taskName: task.name,
        sourceId: source.id,
        sourceName: source.name,
        dataType: req.dataType,
        layer,
        layerLabel: layerInfo.label,
        preddir: task.predDir,
        demFile,
        indoor: !!task.indoor,
        wallsFile: task.wallsFile || null,
        bounds: layerInfo.bounds || type.bounds,
        pngFile: cache.pngPath(source.id, req.dataType, layer, '', task.id),
        url: `/api/images/${source.id}/${req.dataType}/${layer === GROUND_LAYER ? 'ground' : layer}.png`,
        status: 'pending',
      });
    }
  }
  return figures;
}

// 给一批 figure 套用渲染选项:
//   1) 统一坐标范围:取本批所有图范围的并集,保证同一批图坐标轴一致(跨源对比必需)
//      注意:室内是局部米制坐标、室外是 UTM 大坐标,两者不能合并成一个范围,
//      因此按坐标系分组,各组内部统一
//   2) 坐标显示方式:绝对坐标 / 相对坐标
// 结果写入每张图的 xlim/ylim/coordMode/pngFile/url,variant 用于区分不同渲染口径的缓存
function applyRenderOptions(figures, coordMode) {
  const mode = normalizeCoordMode(coordMode);
  const groups = new Map();
  for (const f of figures) {
    const key = f.indoor ? 'indoor' : 'outdoor';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  for (const group of groups.values()) {
    const unified = unionRange(group);
    for (const f of group) {
      f.coordMode = mode;
      if (unified) {
        f.xlim = [unified.left, unified.right];
        f.ylim = [unified.bottom, unified.top];
      }
      f.variant = variantFor(f, unified, mode);
      f.pngFile = cache.pngPath(f.sourceId, f.dataType, f.layer, f.variant, f.taskId);
      f.output = cache.outputFor(f.sourceId, f.dataType, f.layer, f.variant, f.taskId);
      f.inputSignature = cache.inputSignature(f);
      const file = cache.layerFileName(f.layer, f.variant);
      f.url = `/api/images/${f.sourceId}/${f.dataType}/${file}?taskId=${encodeURIComponent(f.taskId)}`;
    }
  }
  return figures;
}

function pubFigure(f, jobId) {
  return {
    key: f.key,
    sourceId: f.sourceId,
    sourceName: f.sourceName,
    taskId: f.taskId,
    taskName: f.taskName,
    dataType: f.dataType,
    dataTypeLabel: displayLabel(f.dataType),
    layer: f.layer,
    layerLabel: f.layerLabel || layerLabel(f.layer),
    url: jobId ? f.url + `${f.url.includes('?') ? '&' : '?'}jobId=${encodeURIComponent(jobId)}` : f.url,
    status: f.status,
    axes: f.axes || null,
    coordMode: f.coordMode || 'abs',
    xlim: f.xlim || null,
    ylim: f.ylim || null,
    error: f.error || null,
  };
}

function pubTask(s, task) {
  const types = {};
  for (const [k, t] of Object.entries(task.types || {})) {
    types[k] = {
      key: t.key,
      file: t.file,
      known: t.known,
      label: displayLabel(k),
      desc: typeInfo(k).desc,
      bounds: t.bounds,
      layers: t.layers.map((l) => ({ key: l.key, label: l.label })),
    };
  }
  return {
    id: task.id,
    name: task.name,
    utm: task.utm || null,
    indoor: !!task.indoor,
    wallsFile: task.wallsFile || null,
    wallsName: task.wallsFile ? path.basename(task.wallsFile) : null,
    resultsDir: cache.resultsDir(s.id, task.id),
    types,
  };
}

function pubSource(s) {
  const tasks = Object.values(s.scan.tasks || {}).map((task) => pubTask(s, task));
  const first = tasks.find((t) => t.id === '0') || tasks[0] || {};
  return { ...first, id: s.id, path: s.path, name: s.name,
    offline: !fs.existsSync(s.path), resultsDir: cache.resultsDir(s.id), tasks,
    warnings: s.scan.warnings || [] };
}

// ---------- 健康检查 ----------
router.get('/health', (req, res) => {
  res.json({ ok: true, matlab: fs.existsSync(config.matlabExe) ? config.matlabExe : null });
});

// ---------- 目录浏览(文件夹选择器) ----------
router.get('/fs/drives', (req, res) => {
  res.json({ drives: listDrives() });
});

router.get('/fs/list', (req, res) => {
  const p = req.query.path || process.cwd();
  try {
    res.json(listDir(p));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- 数据源 ----------
router.post('/sources', (req, res) => {
  const casePath = (req.body.path || '').trim();
  if (!casePath) return res.status(400).json({ error: '请提供文件夹路径' });
  if (!fs.existsSync(casePath)) return res.status(400).json({ error: `文件夹不存在: ${casePath}` });
  const scan = scanSource(casePath);
  if (!scan.ok) return res.status(400).json({ error: scan.error });
  const record = sourcesStore.add(casePath, scan);
  res.json(pubSource(record));
});

router.get('/sources', (req, res) => {
  res.json(sourcesStore.list().map(pubSource));
});

router.delete('/sources/:id', (req, res) => {
  sourcesStore.remove(req.params.id);
  res.json({ ok: true });
});

router.post('/sources/:id/refresh', (req, res) => {
  const s = sourcesStore.get(req.params.id);
  if (!s) return res.status(404).json({ error: '数据源不存在' });
  const scan = scanSource(s.path);
  if (!scan.ok) return res.status(400).json({ error: scan.error });
  res.json(pubSource(sourcesStore.updateScan(s.id, scan)));
});

router.post('/sources/:id/relocate', (req, res, next) => {
  try {
    const source = sourcesStore.get(req.params.id);
    if (!source) throw httpErr(404, '数据源不存在');
    const target = req.body?.path;
    if (typeof target !== 'string' || !path.isAbsolute(target)) throw httpErr(400, '请选择有效的绝对目录');
    const scan = scanSource(target); if (!scan.ok) throw httpErr(400, scan.error);
    const updated = { ...source, path: path.resolve(target), name: path.basename(target), scan, offline: false };
    sourcesStore.replace(sourcesStore.list().map(item => item.id === source.id ? updated : item));
    res.json(pubSource(updated));
  } catch (error) { next(error); }
});

router.post('/sources/:id/open-results', async (req, res) => {
  try {
    const folder = await openResultsFolder(req.params.id, req.body.dataType || '', undefined, req.body.taskId);
    res.json({ ok: true, path: folder });
  } catch (e) {
    res.status(e.status || 500).json({ error: `打开结果文件夹失败: ${e.message}` });
  }
});

// 全量 DEM 统计，不创建 MATLAB 绘图任务。
router.post('/analysis', async (req, res) => {
  try { res.json(await analyzeRequest(req.body)); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

// ---------- 绘图 ----------
router.post('/plot', (req, res) => {
  try {
    const coordMode = (req.body.options && req.body.options.coordMode) || 'abs';
    const figures = applyRenderOptions(buildFigures(req.body.requests), coordMode);
    for (const f of figures) {
      f.status = cache.isCached(f.sourceId, f.dataType, f.layer, f.demFile, f.variant, f.taskId)
        ? 'cached'
        : 'pending';
    }
    // dryRun:只返回已有图片的清单,不启动 MATLAB(切换类型/高度层时预览已画好的图)
    const dryRun = !!req.body.dryRun;
    const pendingCount = figures.filter((f) => f.status === 'pending').length;
    let jobId = null;
    if (!dryRun && pendingCount > 0) {
      jobId = jobQueue.create(figures).id;
    }
    res.json({ jobId, figures: figures.map(f => pubFigure(f)) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

function pubJob(job) { return { id: job.id, status: job.status, createdAt: job.createdAt, finishedAt: job.finishedAt,
  total: job.total, done: job.done, failed: job.failed, cancelled: job.cancelled, counts: job.counts,
  matlabVersion: job.matlabVersion || null, error: job.error, errorDetails: job.errorDetails, figures: job.figures.map(f => pubFigure(f, job.id)) }; }
router.get('/jobs', (req, res) => res.json(jobQueue.list().map(pubJob)));
function historyFigures(id) {
  const job = jobQueue.get(id); if (!job) throw httpErr(404, '任务不存在');
  const figures = job.figures.filter(f => ['done','cached'].includes(f.status) && f.output);
  for (const f of figures) { prepareOutput(f.output); if (f.pngFile !== f.output.file || !fs.existsSync(f.pngFile)) throw httpErr(404, '任务的历史图片已丢失'); }
  return figures;
}
router.post('/jobs/:id/export', async (req, res, next) => {
  try {
    const figures = historyFigures(req.params.id); if (!figures.length) throw httpErr(400, '没有可导出的成功图片');
    const { zipId, done } = exporter.createZip(figures); await done;
    res.json({ count: figures.length, url: `/api/export/${zipId}/download` });
  } catch (error) { next(error); }
});
router.post('/jobs/:id/open-results', async (req, res, next) => {
  try {
    const figure = historyFigures(req.params.id).find(f => f.key === req.body.key);
    if (!figure) throw httpErr(404, '没有对应的成功图片');
    res.json({ ok: true, path: await openOutputFolder(figure.output) });
  } catch (error) { next(error); }
});
router.post('/jobs/:id/cancel', (req, res, next) => { try { res.json(pubJob(jobQueue.cancel(req.params.id))); } catch (error) { next(error); } });
router.post('/jobs/:id/retry', (req, res, next) => {
  try {
    const previous = jobQueue.get(req.params.id); if (!previous) throw httpErr(404, '任务不存在');
    if (!['partial', 'failed', 'cancelled', 'timed_out', 'interrupted'].includes(previous.status)) throw httpErr(409, '任务尚未结束或无需重试');
    const retry = previous.figures.filter(f => !['done', 'cached'].includes(f.status));
    const requests = retry.map(f => ({ sourceId: f.sourceId, taskId: f.taskId, dataType: f.dataType, layers: [f.layer] }));
    const available = buildFigures(requests);
    const figures = available.map(f => {
      const old = retry.find(entry => entry.key === f.key);
      for (const key of ['coordMode', 'xlim', 'ylim', 'variant']) if (old?.[key] !== undefined) f[key] = old[key];
      f.pngFile = cache.pngPath(f.sourceId, f.dataType, f.layer, f.variant, f.taskId);
      f.output = cache.outputFor(f.sourceId, f.dataType, f.layer, f.variant, f.taskId);
      f.inputSignature = cache.inputSignature(f);
      f.url = `/api/images/${f.sourceId}/${f.dataType}/${cache.layerFileName(f.layer, f.variant)}?taskId=${encodeURIComponent(f.taskId)}`;
      return f;
    });
    if (!figures.length) throw httpErr(400, '原失败层的数据已不可用，请重新选择数据');
    res.json(pubJob(jobQueue.create(figures)));
  } catch (error) { next(error); }
});
router.get('/jobs/:id', (req, res) => {
  const job = jobQueue.get(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  res.json(pubJob(job));
});

// 交互预览只读取 DEM,不会创建 MATLAB 任务。
router.post('/preview', (req, res) => {
  try {
    const figures = buildFigures([{ sourceId: req.body.sourceId, taskId: req.body.taskId,
      dataType: req.body.dataType, layers: [req.body.layer] }]);
    const figure = figures.find((f) => f.layer === req.body.layer);
    if (!figure) return res.status(404).json({ error: '没有对应层的数据' });
    res.json(rasterPreview(figure));
  } catch (e) {
    res.status(e.status || 400).json({ error: `交互预览加载失败: ${e.message}` });
  }
});

// 浏览器画布包含标题、坐标、色标和叠加物,作为独立交互预览图保存。
router.post('/preview/save', (req, res) => {
  try {
    const { sourceId, taskId, dataType, layer, range, png } = req.body;
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] >= range[1]) {
      throw httpErr(400, '色标上下限不合法');
    }
    const figure = buildFigures([{ sourceId, taskId, dataType, layers: [layer] }]).find((f) => f.layer === layer);
    if (!figure) throw httpErr(404, '没有对应层的数据');
    if (typeof png !== 'string' || !png.startsWith('data:image/png;base64,') || png.length > 20 * 1024 * 1024) {
      throw httpErr(400, '请提交有效的 PNG 预览图(最大 15 MB)');
    }
    const bytes = Buffer.from(png.slice('data:image/png;base64,'.length), 'base64');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw httpErr(400, 'PNG 格式不合法');
    const mode = normalizeCoordMode(req.body.coordMode);
    const coordVariant = mode === 'abs' ? '' : mode;
    const base = cache.resultFileName(sourceId, dataType, layer, coordVariant, figure.taskId).slice(0, -4);
    const stamp = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10);
    const name = `${base}_交互预览_色标${range[0]}至${range[1]}_${stamp}.png`;
    validatePng(bytes);
    const output = cache.outputFor(sourceId, dataType, layer, coordVariant, figure.taskId);
    output.file = path.join(output.directory, name); prepareOutput(output); const file = output.file;
    const lease = acquireOutputLock(file), temporary = path.join(output.directory, '.' + crypto.randomUUID() + '.tmp.png');
    try {
      fs.writeFileSync(temporary, bytes, { flag: 'wx' }); publishPng({ temporary, output });
      atomicWriteJson(file + '.preview.json', { sourceId, taskId: figure.taskId, dataType, layer, range, coordMode: mode,
        sampled: !!req.body.sampled, at: new Date().toISOString() }, { backup: false });
    } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } lease.release(true); }
    res.json({ ok: true, path: file });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------- 图片 ----------
router.get('/images/:sourceId/:dataType/:file', (req, res) => {
  const { sourceId, dataType, file } = req.params;
  const parsed = cache.parseLayerFile(file);
  if (!parsed) return res.status(400).json({ error: `图片名不合法: ${file}` });
  if (req.query.jobId) {
    const historical = jobQueue.get(req.query.jobId)?.figures.find(f => f.sourceId === sourceId && f.taskId === req.query.taskId && f.dataType === dataType && f.layer === parsed.layer && (f.variant || '') === parsed.variant && ['done','cached'].includes(f.status));
    if (!historical?.output) return res.status(404).json({ error: '没有此任务的成功图片记录' });
    try { prepareOutput(historical.output); if (!fs.existsSync(historical.pngFile)) throw new Error('历史图片不存在'); }
    catch (error) { return res.status(404).json({ error: error.message }); }
    return req.query.download ? res.download(historical.pngFile, path.basename(historical.pngFile)) : res.sendFile(historical.pngFile);
  }
  const source = sourcesStore.get(sourceId);
  if (!source) return res.status(404).json({ error: '数据源不存在' });
  let task;
  try { task = sourcesStore.task(sourceId, req.query.taskId); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const type = task.types[dataType];
  const { layer, variant } = parsed;
  if (!type || !type.layers.some((l) => l.key === layer) || /[\\/\\\\:\x00]/.test(file)) {
    return res.status(400).json({ error: '图片路径不合法' });
  }
  const p = cache.pngPath(sourceId, dataType, layer, variant, task.id);
  if (!fs.existsSync(p)) return res.status(404).json({ error: '图片不存在,请先绘图' });
  // ?download=1 时以下载方式返回,文件名带来源/类型/高度层
  if (req.query.download) {
    const niceName = path.basename(p);
    return res.download(p, niceName);
  }
  res.sendFile(p);
});

// ---------- 导出 ----------
router.post('/export', async (req, res) => {
  try {
    // 必须与 /plot 使用同一套渲染选项(否则会指向不同口径的缓存文件)
    const coordMode = (req.body.options && req.body.options.coordMode) || 'abs';
    const figures = applyRenderOptions(buildFigures(req.body.requests), coordMode);
    const available = figures.filter((f) =>
      cache.isCached(f.sourceId, f.dataType, f.layer, f.demFile, f.variant, f.taskId)
    );
    if (available.length === 0) return res.status(400).json({ error: '没有已生成的图片,请先绘图' });
    const { zipId, zipFile, done } = exporter.createZip(
      available.map((f) => ({
        sourceName: f.sourceName,
        taskName: f.taskName,
        dataType: f.dataType,
        layer: f.layer,
        pngFile: f.pngFile,
      }))
    );
    await done;
    res.json({
      zipId,
      url: `/api/export/${zipId}/download`,
      count: available.length,
      requested: figures.length,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/export/:zipId/download', (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.zipId)) return res.status(400).json({ error: '导出标识无效' });
  const zipFile = path.join(EXPORT_DIR, `${req.params.zipId}.zip`);
  if (!fs.existsSync(zipFile)) return res.status(404).json({ error: '导出文件不存在' });
  res.download(zipFile, `figures_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`);
});

return router;
}
let defaultRouter;
module.exports = (...args) => {
  if (!defaultRouter) defaultRouter = createRoutes({ config: require('./config').config, EXPORT_DIR: require('./config').EXPORT_DIR,
    sourcesStore: require('./sourcesStore'), jobQueue: require('./jobQueue'), cache: require('./cache'), exporter: require('./exporter'),
    analyzeRequest: require('./analysisService').analyzeRequest, openResultsFolder: require('./openResultsFolder').openResultsFolder,
    openOutputFolder: require('./openResultsFolder').openOutputFolder });
  return defaultRouter(...args);
};
module.exports.createRoutes = createRoutes;
