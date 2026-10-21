const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('./config');
const { GROUND_LAYER } = require('./plotTypes');
const sourcesStore = require('./sourcesStore');
const { scanTask } = require('./scanner');
const { createHash } = require('crypto');

const RESULTS_DIR_NAME = '路损结果图';

function resultsDir(sourceId, taskId) {
  const source = sourcesStore.get(sourceId);
  if (!source) throw new Error(`数据源不存在: ${sourceId}`);
  const root = path.resolve(source.path, RESULTS_DIR_NAME);
  return taskId === undefined ? root : path.join(root, safeSegment(sourcesStore.task(sourceId, taskId).id));
}

function safeSegment(value) {
  if (!value || value === '.' || value === '..' || /[\\/\\\\:\x00]/.test(value)) {
    throw new Error(`结果图路径不合法: ${value}`);
  }
  return value;
}

// 渲染逻辑版本:绘图脚本或默认渲染参数变更时递增,
// 已缓存的 PNG 会自动判定为过期并重新绘制(无需手动清缓存)。
const RENDER_VERSION = 3;

// 变体名追加在文件名里:ground.png / ground@u1a2b3c4d.png / ground@rel-ll.png
// 变体用于区分"同一张图的不同渲染口径"(统一坐标范围、相对坐标显示等)。
function layerFileName(layer, variant) {
  const base = layer === GROUND_LAYER ? 'ground' : layer;
  return variant ? `${base}@${variant}.png` : `${base}.png`;
}

function parseLayerFile(fileName) {
  const m = String(fileName).match(/^(.+?)(?:@([^@]+))?\.png$/i);
  if (!m) return null;
  return { layer: m[1], variant: m[2] || '' };
}

function resultFileName(sourceId, dataType, layer, variant = '', taskId) {
  const source = sourcesStore.get(sourceId);
  if (!source) throw new Error(`数据源不存在: ${sourceId}`);
  const task = sourcesStore.task(sourceId, taskId);
  const type = task.types[dataType];
  const info = type && type.layers.find((l) => l.key === layer);
  const label = info ? info.label : layer === GROUND_LAYER ? '地面' : layer;
  const mode = variant.includes('rel-center') ? '相对坐标-区域中心'
    : variant.includes('rel-ll') ? '相对坐标-左下角' : '绝对坐标';
  const range = variant.match(/(?:^|_)(u[0-9a-f]+)(?:_|$)/);
  const name = `${source.name}_${task.name}_${dataType}_${label}_${mode}${range ? `_对比范围-${range[1].slice(1)}` : ''}.png`;
  return name.replace(/[<>:"/\\\\|?*\x00-\x1f]/g, '_');
}

function pngPath(sourceId, dataType, layer, variant = '', taskId) {
  safeSegment(layerFileName(layer, variant));
  const task = sourcesStore.task(sourceId, taskId);
  return path.join(resultsDir(sourceId, task.id), safeSegment(dataType), resultFileName(sourceId, dataType, layer, variant, task.id));
}

function metaPath(sourceId, dataType, layer, variant = '', taskId) {
  return pngPath(sourceId, dataType, layer, variant, taskId) + '.meta.json';
}

// 小型索引与叠加文件计算内容签名,包含缺失状态,新增/删除文件也会使缓存失效。
function dependencySignature(sourceId, taskId) {
  const source = sourcesStore.get(sourceId);
  if (!source) throw new Error(`数据源不存在: ${sourceId}`);
  const task = sourcesStore.task(sourceId, taskId);
  const scan = scanTask(source.path, task.predDir);
  if (!scan.ok) throw new Error(scan.error);
  const files = [path.join(scan.predDir, 'index.txt')];
  if (scan.indoor) {
    if (scan.wallsFile) files.push(scan.wallsFile);
  } else {
    files.push(path.join(scan.predDir, 'building1'), path.join(scan.predDir, 'cells1.txt'));
  }
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(JSON.stringify(file));
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
    else hash.update('<missing>');
  }
  return hash.digest('hex');
}

// 有效性判断:.dem 路径/mtime/大小、索引/叠加文件内容、渲染版本均需一致
function isCached(sourceId, dataType, layer, demFile, variant = '', taskId) {
  const png = pngPath(sourceId, dataType, layer, variant, taskId);
  const meta = metaPath(sourceId, dataType, layer, variant, taskId);
  // 旧平台缓存按需复制到数据源目录,保留原文件以便回退。
  if (!fs.existsSync(png)) migrateSource(sourceId);
  if (!fs.existsSync(png) || !fs.existsSync(meta)) return false;
  try {
    const st = fs.statSync(demFile);
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    return (
      m.demPath === demFile &&
      m.mtimeMs === st.mtimeMs &&
      m.size === st.size &&
      m.renderVersion === RENDER_VERSION &&
      m.dependencies === dependencySignature(sourceId, taskId)
    );
  } catch (e) {
    return false;
  }
}

function markCached(sourceId, dataType, layer, demFile, variant = '', axes = null, taskId) {
  const st = fs.statSync(demFile);
  const meta = metaPath(sourceId, dataType, layer, variant, taskId);
  fs.mkdirSync(path.dirname(meta), { recursive: true });
  fs.writeFileSync(
    meta,
    JSON.stringify({
      demPath: demFile,
      mtimeMs: st.mtimeMs,
      size: st.size,
      renderVersion: RENDER_VERSION,
      dependencies: dependencySignature(sourceId, taskId),
      variant,
      axes, // 该图实际使用的坐标范围(便于事后核对渲染口径)
      at: new Date().toISOString(),
    })
  );
}

// 旧目录没有任务维度,仅通过元数据中的 DEM 路径确定归属,避免把任务结果混用。
function migrateSource(sourceId) {
  const source = sourcesStore.get(sourceId);
  if (!source || !fs.existsSync(source.path)) return 0;
  let count = 0;
  const tasks = Object.values(source.scan.tasks || {});
  for (const task of tasks) {
    for (const [dataType, type] of Object.entries(task.types)) {
      const dirs = [path.join(resultsDir(sourceId), safeSegment(dataType)), path.join(CACHE_DIR, sourceId, dataType)];
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir).filter((n) => /\.png$/i.test(n))) {
          const old = path.join(dir, file);
          let meta;
          try { meta = JSON.parse(fs.readFileSync(old + '.meta.json', 'utf8')); } catch { continue; }
          const layer = type.layers.find((l) => {
            const dem = path.join(task.predDir, type.flat || l.key === GROUND_LAYER ? '' : l.key, l.file || type.file);
            return path.resolve(dem).toLowerCase() === path.resolve(meta.demPath).toLowerCase();
          });
          if (!layer) continue;
          const variant = meta.variant || (parseLayerFile(file) || {}).variant || '';
          const target = pngPath(sourceId, dataType, layer.key, variant, task.id);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          if (!fs.existsSync(target)) {
            fs.copyFileSync(old, target, fs.constants.COPYFILE_EXCL);
            count++;
          }
          if (!fs.existsSync(target + '.meta.json')) fs.copyFileSync(old + '.meta.json', target + '.meta.json', fs.constants.COPYFILE_EXCL);
        }
      }
    }
  }
  return count;
}

module.exports = { RENDER_VERSION, RESULTS_DIR_NAME, resultsDir, resultFileName, migrateSource, pngPath, isCached, markCached, layerFileName, parseLayerFile };
