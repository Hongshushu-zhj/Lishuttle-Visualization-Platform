const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('./config');
const { GROUND_LAYER } = require('./plotTypes');
const sourcesStore = require('./sourcesStore');

const RESULTS_DIR_NAME = '路损结果图';

function resultsDir(sourceId) {
  const source = sourcesStore.get(sourceId);
  if (!source) throw new Error(`数据源不存在: ${sourceId}`);
  return path.resolve(source.path, RESULTS_DIR_NAME);
}

function safeSegment(value) {
  if (!value || value === '.' || value === '..' || /[\\/\\\\:\x00]/.test(value)) {
    throw new Error(`结果图路径不合法: ${value}`);
  }
  return value;
}

// 渲染逻辑版本:绘图脚本或默认渲染参数变更时递增,
// 已缓存的 PNG 会自动判定为过期并重新绘制(无需手动清缓存)。
const RENDER_VERSION = 2;

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

function resultFileName(sourceId, dataType, layer, variant = '') {
  const source = sourcesStore.get(sourceId);
  if (!source) throw new Error(`数据源不存在: ${sourceId}`);
  const type = source.scan.types[dataType];
  const info = type && type.layers.find((l) => l.key === layer);
  const label = info ? info.label : layer === GROUND_LAYER ? '地面' : layer;
  const mode = variant.includes('rel-center') ? '相对坐标-区域中心'
    : variant.includes('rel-ll') ? '相对坐标-左下角' : '绝对坐标';
  const range = variant.match(/(?:^|_)(u[0-9a-f]+)(?:_|$)/);
  const name = `${source.name}_${dataType}_${label}_${mode}${range ? `_对比范围-${range[1].slice(1)}` : ''}.png`;
  return name.replace(/[<>:"/\\\\|?*\x00-\x1f]/g, '_');
}

function pngPath(sourceId, dataType, layer, variant = '') {
  safeSegment(layerFileName(layer, variant));
  return path.join(resultsDir(sourceId), safeSegment(dataType), resultFileName(sourceId, dataType, layer, variant));
}

function metaPath(sourceId, dataType, layer, variant = '') {
  return pngPath(sourceId, dataType, layer, variant) + '.meta.json';
}

// 有效性判断:记录 .dem 的路径/mtime/大小 + 渲染版本,任一不符即需重画
function isCached(sourceId, dataType, layer, demFile, variant = '') {
  const png = pngPath(sourceId, dataType, layer, variant);
  const meta = metaPath(sourceId, dataType, layer, variant);
  // 旧平台缓存按需复制到数据源目录,保留原文件以便回退。
  const legacyName = layerFileName(layer, variant);
  if (!fs.existsSync(png) && (
    fs.existsSync(path.join(CACHE_DIR, sourceId, dataType, legacyName)) ||
    fs.existsSync(path.join(resultsDir(sourceId), dataType, legacyName))
  )) migrateSource(sourceId);
  if (!fs.existsSync(png) || !fs.existsSync(meta)) return false;
  try {
    const st = fs.statSync(demFile);
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    return (
      m.demPath === demFile &&
      m.mtimeMs === st.mtimeMs &&
      m.size === st.size &&
      m.renderVersion === RENDER_VERSION
    );
  } catch (e) {
    return false;
  }
}

function markCached(sourceId, dataType, layer, demFile, variant = '', axes = null) {
  const st = fs.statSync(demFile);
  const meta = metaPath(sourceId, dataType, layer, variant);
  fs.mkdirSync(path.dirname(meta), { recursive: true });
  fs.writeFileSync(
    meta,
    JSON.stringify({
      demPath: demFile,
      mtimeMs: st.mtimeMs,
      size: st.size,
      renderVersion: RENDER_VERSION,
      variant,
      axes, // 该图实际使用的坐标范围(便于事后核对渲染口径)
      at: new Date().toISOString(),
    })
  );
}

// 仅迁移平台注册的图片及其元数据,不覆盖目标目录里的已有结果。
function migrateSource(sourceId) {
  const source = sourcesStore.get(sourceId);
  if (!source || !fs.existsSync(source.path)) return 0;
  let count = 0;
  for (const dataType of Object.keys((source.scan && source.scan.types) || {})) {
    const localDir = path.join(resultsDir(sourceId), safeSegment(dataType));
    const dirs = [localDir, path.join(CACHE_DIR, sourceId, dataType)];
    for (const oldDir of dirs) {
    if (!fs.existsSync(oldDir)) continue;
    for (const file of fs.readdirSync(oldDir)) {
      const parsed = parseLayerFile(file);
      if (!parsed || !source.scan.types[dataType].layers.some((l) => l.key === parsed.layer)) continue;
      const target = pngPath(sourceId, dataType, parsed.layer, parsed.variant);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) {
        fs.copyFileSync(path.join(oldDir, file), target, fs.constants.COPYFILE_EXCL);
        count++;
      }
      const oldMeta = path.join(oldDir, file + '.meta.json');
      if (fs.existsSync(oldMeta) && !fs.existsSync(target + '.meta.json')) {
        fs.copyFileSync(oldMeta, target + '.meta.json', fs.constants.COPYFILE_EXCL);
      }
      // 已迁入数据源的旧名图改为易读名称,原平台缓存仍保留。
      if (oldDir === localDir && fs.existsSync(target + '.meta.json') &&
          fs.readFileSync(path.join(oldDir, file)).equals(fs.readFileSync(target)) &&
          fs.existsSync(oldMeta) && fs.readFileSync(oldMeta).equals(fs.readFileSync(target + '.meta.json'))) {
        fs.unlinkSync(path.join(oldDir, file));
        fs.unlinkSync(oldMeta);
      }
    }
    }
  }
  return count;
}

module.exports = { RENDER_VERSION, RESULTS_DIR_NAME, resultsDir, resultFileName, migrateSource, pngPath, isCached, markCached, layerFileName, parseLayerFile };
