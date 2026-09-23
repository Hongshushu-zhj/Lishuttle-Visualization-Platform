const fs = require('fs');
const path = require('path');
const { isKnown } = require('./plotTypes');
const { isDirectoryEntry } = require('./fsutil');

// 解析 pred/0/index.txt:首行 UTM <zone>,其余每行 "文件名.dem 左 右 下 上 分辨率"
function parseIndexFile(predDir) {
  const indexFile = path.join(predDir, 'index.txt');
  if (!fs.existsSync(indexFile)) return null;
  const text = fs.readFileSync(indexFile, 'utf8');
  const entries = [];
  let utm = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^UTM/i.test(line)) {
      utm = line;
      continue;
    }
    const m = line.match(/^(\S+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)$/);
    if (m) {
      entries.push({
        file: m[1],
        left: Number(m[2]),
        right: Number(m[3]),
        bottom: Number(m[4]),
        top: Number(m[5]),
        res: Number(m[6]),
      });
    }
  }
  return { utm, entries };
}

// 高度层排序:10m、20m、100m 按数字升序,非数字层按名称
function sortLayers(names) {
  const key = (n) => {
    const m = n.match(/^(\d+(?:\.\d+)?)/);
    return m ? [1, parseFloat(m[1]), n] : [0, Infinity, n];
  };
  return names.slice().sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0;
  });
}

// 扫描结果文件夹,自动识别可绘图的数据类型与高度层。
// 成功返回 { ok:true, utm, predDir, types:{ KEY:{key,file,known,bounds,layers:[{key,label}]} } }
function scanSource(caseDir) {
  const predDir = path.join(caseDir, 'pred', '0');
  const parsed = parseIndexFile(predDir);
  if (!parsed) {
    return {
      ok: false,
      error: `未找到 ${path.join(predDir, 'index.txt')} — 请选择正确的结果文件夹(需包含 pred\\0\\index.txt)`,
    };
  }
  const { utm, entries } = parsed;
  const types = {};
  let subdirs = [];
  try {
    subdirs = fs.readdirSync(predDir, { withFileTypes: true });
  } catch (e) {
    /* 目录不可读时按无子目录处理 */
  }
  for (const e of entries) {
    if (!/\.dem$/i.test(e.file)) continue;
    const key = path.basename(e.file, path.extname(e.file)).toUpperCase();
    const layers = [];
    if (fs.existsSync(path.join(predDir, e.file))) layers.push('ground');
    for (const sub of subdirs) {
      if (!isDirectoryEntry(predDir, sub)) continue;
      if (fs.existsSync(path.join(predDir, sub.name, e.file))) layers.push(sub.name);
    }
    const sorted = ['ground', ...sortLayers(layers.filter((n) => n !== 'ground'))];
    types[key] = {
      key,
      file: e.file,
      known: isKnown(key),
      bounds: { left: e.left, right: e.right, bottom: e.bottom, top: e.top, res: e.res },
      layers: sorted.map((l) => ({ key: l, label: l === 'ground' ? '地面' : l })),
    };
  }
  return { ok: true, utm, predDir, types };
}

module.exports = { scanSource, parseIndexFile };
