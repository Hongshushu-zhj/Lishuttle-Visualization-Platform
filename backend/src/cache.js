const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('./config');
const { GROUND_LAYER } = require('./plotTypes');

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

function pngPath(sourceId, dataType, layer, variant = '') {
  return path.join(CACHE_DIR, sourceId, dataType, layerFileName(layer, variant));
}

function metaPath(sourceId, dataType, layer, variant = '') {
  return pngPath(sourceId, dataType, layer, variant) + '.meta.json';
}

// 有效性判断:记录 .dem 的路径/mtime/大小 + 渲染版本,任一不符即需重画
function isCached(sourceId, dataType, layer, demFile, variant = '') {
  const png = pngPath(sourceId, dataType, layer, variant);
  const meta = metaPath(sourceId, dataType, layer, variant);
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

function markCached(sourceId, dataType, layer, demFile, variant = '') {
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
      at: new Date().toISOString(),
    })
  );
}

module.exports = { RENDER_VERSION, pngPath, isCached, markCached, layerFileName, parseLayerFile };
