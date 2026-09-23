const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('./config');
const { GROUND_LAYER } = require('./plotTypes');

// PNG 缓存目录:data/cache/<sourceId>/<dataType>/<layer>.png
// 有效性通过 .meta.json 中记录的 .dem 文件路径、mtime、大小判断,
// 仿真重跑生成新的 .dem 后自动失效重画。
function layerFileName(layer) {
  return (layer === GROUND_LAYER ? 'ground' : layer) + '.png';
}

function pngPath(sourceId, dataType, layer) {
  return path.join(CACHE_DIR, sourceId, dataType, layerFileName(layer));
}

function metaPath(sourceId, dataType, layer) {
  return pngPath(sourceId, dataType, layer) + '.meta.json';
}

function isCached(sourceId, dataType, layer, demFile) {
  const png = pngPath(sourceId, dataType, layer);
  const meta = metaPath(sourceId, dataType, layer);
  if (!fs.existsSync(png) || !fs.existsSync(meta)) return false;
  try {
    const st = fs.statSync(demFile);
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    return m.demPath === demFile && m.mtimeMs === st.mtimeMs && m.size === st.size;
  } catch (e) {
    return false;
  }
}

function markCached(sourceId, dataType, layer, demFile) {
  const st = fs.statSync(demFile);
  const meta = metaPath(sourceId, dataType, layer);
  fs.mkdirSync(path.dirname(meta), { recursive: true });
  fs.writeFileSync(
    meta,
    JSON.stringify({
      demPath: demFile,
      mtimeMs: st.mtimeMs,
      size: st.size,
      at: new Date().toISOString(),
    })
  );
}

module.exports = { pngPath, isCached, markCached };
