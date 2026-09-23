const express = require('express');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { EXPORT_DIR } = require('./config');
const { scanSource } = require('./scanner');
const sourcesStore = require('./sourcesStore');
const jobQueue = require('./jobQueue');
const cache = require('./cache');
const exporter = require('./exporter');
const { listDrives, listDir } = require('./fsBrowse');
const { GROUND_LAYER, typeInfo, displayLabel, layerLabel } = require('./plotTypes');

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
    const type = source.scan.types[req.dataType];
    if (!type) throw httpErr(400, `数据源 ${source.name} 中没有数据类型 ${req.dataType}`);
    if (!type.known) throw httpErr(400, `数据类型 ${req.dataType} 暂无对应绘图脚本,暂不支持`);
    let layers = req.layers;
    if (!layers || layers.length === 0 || layers.includes('all')) {
      layers = type.layers.map((l) => l.key);
    }
    for (const layer of layers) {
      if (!type.layers.some((l) => l.key === layer)) continue; // 该源没有这一层,跳过
      const demFile =
        layer === GROUND_LAYER
          ? path.join(source.scan.predDir, type.file)
          : path.join(source.scan.predDir, layer, type.file);
      if (!fs.existsSync(demFile)) continue;
      figures.push({
        key: `${source.id}|${req.dataType}|${layer}`,
        sourceId: source.id,
        sourceName: source.name,
        dataType: req.dataType,
        layer,
        preddir: source.scan.predDir,
        demFile,
        pngFile: cache.pngPath(source.id, req.dataType, layer),
        url: `/api/images/${source.id}/${req.dataType}/${layer === GROUND_LAYER ? 'ground' : layer}.png`,
        status: 'pending',
      });
    }
  }
  return figures;
}

function pubFigure(f) {
  return {
    key: f.key,
    sourceId: f.sourceId,
    sourceName: f.sourceName,
    dataType: f.dataType,
    dataTypeLabel: displayLabel(f.dataType),
    layer: f.layer,
    layerLabel: layerLabel(f.layer),
    url: f.url,
    status: f.status,
    error: f.error || null,
  };
}

function pubSource(s) {
  const types = {};
  for (const [k, t] of Object.entries((s.scan && s.scan.types) || {})) {
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
    id: s.id,
    path: s.path,
    name: s.name,
    offline: !fs.existsSync(s.path),
    utm: (s.scan && s.scan.utm) || null,
    types,
  };
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

// ---------- 绘图 ----------
router.post('/plot', (req, res) => {
  try {
    const figures = buildFigures(req.body.requests);
    for (const f of figures) {
      f.status = cache.isCached(f.sourceId, f.dataType, f.layer, f.demFile) ? 'cached' : 'pending';
    }
    // dryRun:只返回已有图片的清单,不启动 MATLAB(切换类型/高度层时预览已画好的图)
    const dryRun = !!req.body.dryRun;
    const pendingCount = figures.filter((f) => f.status === 'pending').length;
    let jobId = null;
    if (!dryRun && pendingCount > 0) {
      jobId = jobQueue.create(figures).id;
    }
    res.json({ jobId, figures: figures.map(pubFigure) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/jobs/:id', (req, res) => {
  const job = jobQueue.get(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  res.json({
    id: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    failed: job.failed,
    error: job.error,
    figures: job.figures.map(pubFigure),
  });
});

// ---------- 图片 ----------
router.get('/images/:sourceId/:dataType/:file', (req, res) => {
  const { sourceId, dataType, file } = req.params;
  const layer = file.replace(/\.png$/i, '');
  const p = cache.pngPath(sourceId, dataType, layer);
  if (!fs.existsSync(p)) return res.status(404).json({ error: '图片不存在,请先绘图' });
  // ?download=1 时以下载方式返回,文件名带来源/类型/高度层
  if (req.query.download) {
    const source = sourcesStore.get(sourceId);
    const niceName = `${source ? source.name : sourceId}_${dataType}_${layerLabel(layer)}.png`;
    return res.download(p, niceName);
  }
  res.sendFile(p);
});

// ---------- 导出 ----------
router.post('/export', async (req, res) => {
  try {
    const figures = buildFigures(req.body.requests);
    const available = figures.filter((f) => cache.isCached(f.sourceId, f.dataType, f.layer, f.demFile));
    if (available.length === 0) return res.status(400).json({ error: '没有已生成的图片,请先绘图' });
    const { zipId, zipFile, done } = exporter.createZip(
      available.map((f) => ({
        sourceName: f.sourceName,
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
  const zipFile = path.join(EXPORT_DIR, `${req.params.zipId}.zip`);
  if (!fs.existsSync(zipFile)) return res.status(404).json({ error: '导出文件不存在' });
  res.download(zipFile, `figures_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`);
});

module.exports = router;
